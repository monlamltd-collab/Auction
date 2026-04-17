// Sentry must be imported before everything else for proper instrumentation
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
  });
  console.log('Sentry error tracking enabled');
}

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { DOM_EXTRACTORS, initExtractors, getLastExtractorUsed, extractWithJSDOM } from './lib/extractors.js';
import { callAI, initAI } from './lib/ai-provider.js';
import { ResourceBudget } from './lib/resource-budget.js';
import {
  initScraper,
  FIRECRAWL_API_KEY, FIRECRAWL_SKIP, scrapeWithFirecrawl, scrapeRenderedPage,
  scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots,
  detectTotalPages, buildPageUrl, fetchPage, extractLotsWithAI,
  backfillImages, backfillImagesWithFirecrawl, backfillImagesWithPuppeteer,
  backfillImagesFromLotPages, fetchLotPage, normaliseLotStatuses, puppeteer,
  isFcCreditExhausted, getFcExhaustedAt, setFcCreditExhausted, setFcExhaustedAt,
  isFcTemporarilyDown, getFcDownAt, setFcTemporarilyDown, setFcDownAt, setFcConsecutive5xx,
  getLastScrapeEngine, getLastAITier,
} from './lib/scraper.js';

// ── Resource budget — single source of truth for resource state ──
const budget = new ResourceBudget();
if (puppeteer) budget.setPuppeteer(puppeteer);
initScraper({ budget });
import { extractPostcode, enrichLots, enrichLotsFromLotPages, getCircuitBreakers } from './lib/enrichment.js';
import { log, requestLoggerMiddleware } from './lib/logging.js';
import { validateEnv, ALLOWED_ORIGINS } from './lib/config.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_ENABLED } from './lib/supabase.js';
import { securityHeaders, csrfCheck } from './lib/security.js';
import { getClientIP, setOnNewUser } from './lib/auth.js';
import { initHouses, HOUSE_ROOTS, rewriteUrl } from './lib/houses.js';
import { getCalendarAuctions } from './lib/calendar.js';

// ── Harness modules (adaptive resilience framework) ──
import { initAlerts, fireAlert as harnessFireAlert, resolveAlert as harnessResolveAlert } from './lib/harness/alert-router.js';
import { initHouseHealth, updateHealth as harnessUpdateHealth } from './lib/harness/house-health.js';
import { initDiscovery } from './lib/harness/house-discovery.js';
import { initGenerator } from './lib/harness/extractor-generator.js';
import { initManager, runManagerCycle, getManagerDirectives } from './lib/harness/manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

validateEnv();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy for correct client IP via req.ip / X-Forwarded-For
app.set('trust proxy', 1);

// Stripe webhook needs raw body for signature verification — MUST come before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '100kb' }));

// ═══════════════════════════════════════════════════════════════
// CORS (ALLOWED_ORIGINS from lib/config.js)
// ═══════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

import { BROKEN_EXTRACTORS, loadBrokenExtractors } from './routes/analyse.js';
loadBrokenExtractors().then(() => initExtractors({ brokenExtractors: BROKEN_EXTRACTORS }));

// ── Security middleware (from lib/security.js) ──
app.use(securityHeaders);
app.use(csrfCheck);

// ── Request logging (from lib/logging.js) ──
app.use(requestLoggerMiddleware(getClientIP));

// ═══════════════════════════════════════════════════════════════
// AI PROVIDER — Model selection & rate limiting in lib/ai-provider.js
// ═══════════════════════════════════════════════════════════════
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
initAI(genAI, supabase);

// ── Harness initialization ──
initAlerts(supabase);
initHouseHealth(supabase).catch(e => console.warn('Harness: health init failed:', e.message));
initDiscovery(supabase, callAI);
initGenerator(supabase, callAI);

// Inject server-level dependencies into lib/houses.js (rewriteUrl needs these)
initHouses({
  firecrawlApiKey: FIRECRAWL_API_KEY,
  getFcCreditExhausted: isFcCreditExhausted,
  scrapeWithFirecrawlFn: scrapeWithFirecrawl,
});

// ═══════════════════════════════════════════════════════════════
// STATIC FILES
// ═══════════════════════════════════════════════════════════════
app.use('/public', express.static(join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// ROUTE MODULES
// ═══════════════════════════════════════════════════════════════
import authRouter from './routes/auth.js';
import stripeRouter from './routes/stripe.js';
import leadsRouter from './routes/leads.js';
import calendarRouter from './routes/calendar.js';
import analyseRouter from './routes/analyse.js';
import searchRouter from './routes/search.js';
import adminRouter from './routes/admin.js';
import { sendWelcomeEmail } from './lib/email.js';

// Wire up the new-user callback so validateUserFromReq can trigger welcome emails
setOnNewUser((email, name) => sendWelcomeEmail(email, name).catch(() => {}));

// ── Route mounting (order matters for middleware) ──
app.use(authRouter);
app.use('/api/stripe', stripeRouter);
app.use(leadsRouter);
app.use(calendarRouter);
app.use(analyseRouter);
app.use(searchRouter);
app.use(adminRouter);

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL — must be AFTER all route registrations
// ═══════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  try {
    let html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
    // Inject Supabase config — JSON.stringify escapes any special chars to prevent XSS
    html = html.replace("window.__SUPABASE_URL__ || ''", JSON.stringify(SUPABASE_URL || ''));
    html = html.replace("window.__SUPABASE_ANON_KEY__ || ''", JSON.stringify(SUPABASE_ANON_KEY || ''));
    html = html.replace("window.__AUTH_ENABLED__ || false", AUTH_ENABLED ? 'true' : 'false');
    // Inject Umami website ID from env so the HTML doesn't need hardcoded IDs
    if (process.env.UMAMI_WEBSITE_ID) {
      html = html.replace('data-website-id=""', `data-website-id="${process.env.UMAMI_WEBSITE_ID}"`);
    }
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (e) {
    log.error('Failed to inject config into index.html', { error: e.message });
    res.sendFile(join(__dirname, 'index.html'));
  }
});

// ═══════════════════════════════════════════════════════════════
// DEPENDENCY INJECTION — wire up lib/analysis.js and harness/manager.js
// ═══════════════════════════════════════════════════════════════
import { initAnalysis, autoAnalyseAll, healBrokenHouse } from './lib/analysis.js';

initAnalysis({
  // Resource budget (new: centralised resource state)
  budget,
  // Scraper (legacy deps — will migrate to budget incrementally)
  FIRECRAWL_API_KEY, FIRECRAWL_SKIP, scrapeWithFirecrawl, scrapeRenderedPage,
  scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots,
  detectTotalPages, buildPageUrl, fetchPage, extractLotsWithAI,
  backfillImages, backfillImagesWithFirecrawl, backfillImagesWithPuppeteer,
  backfillImagesFromLotPages, fetchLotPage, normaliseLotStatuses, puppeteer,
  isFcCreditExhausted, getFcExhaustedAt, setFcCreditExhausted, setFcExhaustedAt,
  isFcTemporarilyDown, getFcDownAt, setFcTemporarilyDown, setFcDownAt, setFcConsecutive5xx,
  getLastScrapeEngine, getLastAITier,
  // Extractors
  DOM_EXTRACTORS, extractWithJSDOM, getLastExtractorUsed,
  // Enrichment
  extractPostcode, enrichLots, enrichLotsFromLotPages,
  // Houses
  rewriteUrl,
  // Calendar
  getCalendarAuctions,
  // AI
  callAI,
  // Harness
  runManagerCycle, getManagerDirectives,
  harnessFireAlert, harnessResolveAlert, harnessUpdateHealth,
});

initManager({
  supabase, callAI,
  houseRoots: HOUSE_ROOTS,
  domExtractors: DOM_EXTRACTORS,
  healBrokenHouse,
  getCircuitBreakers,
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`Bridgematch running on port ${PORT}`);
  if (!process.env.SUPABASE_URL) console.warn('SUPABASE_URL not set');
  if (!process.env.SUPABASE_SERVICE_KEY) console.warn('SUPABASE_SERVICE_KEY not set');

  // Auto-analyse all catalogue-ready auctions — 30s after startup, then every 6 hours
  setTimeout(() => autoAnalyseAll(), 30000);
  setInterval(() => autoAnalyseAll(), 6 * 60 * 60 * 1000);
});

