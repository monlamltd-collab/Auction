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
import { randomBytes, createHash } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { DOM_EXTRACTORS, UNIVERSAL_DOM_EXTRACTOR, extractWithJSDOM, initExtractors, getLastExtractorUsed, setLastExtractorUsed } from './lib/extractors.js';
import { callAI, initAI, getAICostSummary } from './lib/ai-provider.js';
import {
  initScraper, FIRECRAWL_API_KEY, FIRECRAWL_SKIP,
  scrapeWithFirecrawl, scrapeRenderedPage, scrapePageWithFirecrawl,
  fetchPage, scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots,
  detectTotalPages, buildPageUrl, scrapeWithPuppeteer,
  acquirePage, getBrowser, hasPuppeteer, puppeteer,
  extractLotsWithAI, extractLotsFromPdf, isPdfUrl, stripHtml,
  backfillImages, backfillImagesWithFirecrawl, backfillImagesWithPuppeteer,
  backfillImagesFromLotPages, fetchLotPage, enrichLotsFromLotPages,
  normaliseLotStatuses, isValidImageUrl, IMG_EXTENSIONS, IMG_CDN_DOMAINS,
  HOUSE_EXTRACTION_HINTS,
  getFirecrawlStatus, getFcCreditsUsed, isFcCreditExhausted, getFcExhaustedAt,
  getFcFallbackCount, getFcErrorCount, getFcRequestCount,
  isFcTemporarilyDown, getFcDownAt, getFcConsecutive5xx, getFcLastError, getFcLastErrorAt,
  setFcCreditExhausted, setFcExhaustedAt, setFcCreditsUsed,
  setFcTemporarilyDown, setFcDownAt, setFcConsecutive5xx,
  getLastScrapeEngine, setLastScrapeEngine, getLastAITier, setLastAITier,
} from './lib/scraper.js';
import { log, sseWrite, requestLoggerMiddleware } from './lib/logging.js';
import { validateEnv, STRIPE_ENABLED, RATE_LIMIT_PER_DAY, CACHE_DAYS, CACHE_TIERS, getCacheTTL, HEADERS, MAX_PAGES, MAX_PUPPETEER_PAGES, MAX_LOTS_PER_SCRAPE, MAX_AUCTIONS_PER_HOUSE, TIMEOUT, ALLOWED_ORIGINS, FREE_SCAN_LIMIT, FREE_PREVIEW_LOTS, resolveEffectiveTier, getAISearchLimit, truncateAddress, stripAIFields } from './lib/config.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_ENABLED, SUPABASE_JWT_SECRET } from './lib/supabase.js';
import { securityHeaders, csrfCheck, validateUrl } from './lib/security.js';
import { verifySupabaseToken, safeCompare, getClientIP, rateLimit, validateUserFromReq, setOnNewUser } from './lib/auth.js';
import { HOUSE_ROOTS, PUPPETEER_IMAGE_HOUSES, detectAuctionHouse, HOUSE_DISPLAY_NAMES, getHouseDisplayName, rewriteUrl, initHouses } from './lib/houses.js';

// ── Harness modules (adaptive resilience framework) ──
import { initAlerts, fireAlert as harnessFireAlert, resolveAlert as harnessResolveAlert, getUnresolved as harnessGetUnresolved } from './lib/harness/alert-router.js';
import { validateBatch } from './lib/harness/data-contract.js';
import { detectRegression } from './lib/harness/regression-detector.js';
import { evaluateGate } from './lib/harness/quality-gate.js';
import { initHouseHealth, updateHealth as harnessUpdateHealth, getHealth as harnessGetHealth, getAllHealth, isCircuitOpen, getBaseline } from './lib/harness/house-health.js';
import { enrichBatch, getEnrichmentReport } from './lib/harness/enrichment-engine.js';
import { initDiscovery, discoverNewHouses, getDiscoveryQueue, approveCandidate, getDiscoveryBudget } from './lib/harness/house-discovery.js';
import { initGenerator } from './lib/harness/extractor-generator.js';
import { initManager, runManagerCycle, getManagerReport, getManagerDirectives, setManagerConfig, getManagerConfig } from './lib/harness/manager.js';
import { enrichLotsWithFundability } from './lib/fundability.js';
import { initEnrichment, extractPostcode, extractStreet, queryLandRegistry, estimateMonthlyRent, buildLotUrl, fetchEPCByPostcode, matchEPCToLot, fetchFloodZone, enrichLots, ensureEnrichmentCacheTable, getCircuitBreakers } from './lib/enrichment.js';
import { escHtml, normaliseUrl } from './lib/utils.js';
import { FALLBACK_CALENDAR, getAuctionCalendar, getCalendarAuctions } from './lib/calendar.js';
import {
  initAnalysis, qualityGate, analyseLot, W2N,
  HOUSE_NAME_MIGRATIONS, syncCalendarAndHouseNames,
  createSemaphore, runWave,
  autoAnalyseAll, autoAnalyseOne,
  healBrokenHouse, discoverAndUpdateCalendar,
  JUNK_LOT_PATTERN, buildSearchText, upsertToLotsTable,
  computeScrapeDiff, updateHouseSkill, saveDailySnapshot,
  dbRowToLot, dbRowToFrontendLot, LOTS_SELECT, upsertLotGroups,
  extractPriceFromText, runEnrichmentWave, logActivityEvent,
  getCreditExhausted, setCreditExhausted, getCreditExhaustedAt, setCreditExhaustedAt,
  getApiCallCount, incApiCallCount, getHashHitCount, getServerStartTime,
  isEnrichmentWaveRunning, isAutoAnalysisRunning,
  getHealingState, clearHealingCooldown,
} from './lib/analysis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

validateEnv();

// escHtml and normaliseUrl moved to lib/utils.js

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

// BROKEN_EXTRACTORS tracking moved to routes/analyse.js
import { BROKEN_EXTRACTORS, loadBrokenExtractors } from './routes/analyse.js';
loadBrokenExtractors().then(() => initExtractors({ brokenExtractors: BROKEN_EXTRACTORS }));

// ── Security middleware (from lib/security.js) ──
app.use(securityHeaders);
app.use(csrfCheck);

// ── Request logging (from lib/logging.js) ──
app.use(requestLoggerMiddleware(getClientIP));

// ── Config constants from lib/config.js ──
const RATE_LIMIT = RATE_LIMIT_PER_DAY;
// PUPPETEER_IMAGE_HOUSES now imported from lib/houses.js

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
// Manager init deferred to after HOUSE_ROOTS and DOM_EXTRACTORS are defined (see below)

// Inject server-level dependencies into lib/houses.js (rewriteUrl needs these)
initHouses({
  firecrawlApiKey: FIRECRAWL_API_KEY,
  getFcCreditExhausted: isFcCreditExhausted,
  scrapeWithFirecrawlFn: scrapeWithFirecrawl,
});

// qualityGate — moved to lib/analysis.js

// scrapeRenderedPage, scrapePageWithFirecrawl, backfillImagesWithFirecrawl,
// HOUSE_EXTRACTION_HINTS — all moved to lib/scraper.js
// HOUSE_ROOTS, PUPPETEER_IMAGE_HOUSES, detectAuctionHouse, HOUSE_DISPLAY_NAMES, getHouseDisplayName, rewriteUrl
// now imported from lib/houses.js

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

// Helper: get catalogue-ready auctions (used by auto-analyse)
