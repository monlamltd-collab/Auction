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
import { DOM_EXTRACTORS, initExtractors, getLastExtractorUsed, extractWithJSDOM } from './lib/extractors/index.js';
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
  getLastScrapeEngine, getLastAITier, enrichLotsFromLotPages,
  withTier,
} from './lib/scraper.js';

// ── Resource budget — single source of truth for resource state ──
const budget = new ResourceBudget();
if (puppeteer) budget.setPuppeteer(puppeteer);
initScraper({ budget });
import { extractPostcode, enrichLots, getCircuitBreakers } from './lib/enrichment.js';
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
import { initAnalysis, autoAnalyseAll, healBrokenHouse, runEnrichmentWave } from './lib/analysis.js';
import { auditStatusDrift } from './lib/harness/sub-agents.js';
import { initWatcher, watchAuctionCalendar } from './lib/pipeline/auction-watcher.js';

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

// Wire auction-watcher deps (Firecrawl + AI for Tier 2 fallback)
initWatcher({
  scrapeWithFirecrawl,
  callAI,
  fireAlert: harnessFireAlert,
  budget,
});

// ═══════════════════════════════════════════════════════════════
// THREE-TIER SCHEDULING
// ═══════════════════════════════════════════════════════════════
// Tier 1 — Full pass: 03:00 UK, runs autoAnalyseAll (catalogue scrape +
//          detail-page hydration + image backfill). Firecrawl-heavy.
// Tier 2 — Free enrichment: every 30 min, runs runEnrichmentWave({freeOnly:true}).
//          Uses only free APIs (EPC, flood, Land Registry, postcodes.io).
// Tier 3 — Status drift: hourly 09:00–18:00 UK, samples upcoming-auction
//          lots to catch SOLD/Withdrawn close to auction. Small Firecrawl spend.
// Boot   — Runs free enrichment after 60s. Triggers full pass only if last
//          DB scrape was >25h ago, or if FORCE_BOOT_SCRAPE=true is set.

const _scheduleState = { lastFullPass: 0, lastFreeEnrich: 0, lastStatusDrift: 0 };

function getUkHourMinute() {
  const ukNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  return { hour: ukNow.getHours(), minute: ukNow.getMinutes() };
}

async function statusDriftTick() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const plus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const { data: lots } = await supabase
      .from('lots')
      .select('id,house,url,status,address,lot_number,auction_date')
      .not('url', 'like', '__synthetic__%')
      .not('auction_date', 'is', null)
      .gte('auction_date', today)
      .lte('auction_date', plus7)
      .or('status.is.null,status.eq.available')
      .limit(100);
    if (!lots || lots.length === 0) {
      console.log('STATUS-DRIFT: no upcoming-auction lots to check');
      return;
    }
    const byHouse = {};
    for (const l of lots) (byHouse[l.house || 'unknown'] = byHouse[l.house || 'unknown'] || []).push(l);
    const [topHouse, topLots] = Object.entries(byHouse).sort((a, b) => b[1].length - a[1].length)[0];
    console.log(`STATUS-DRIFT: checking ${topHouse} (${topLots.length} upcoming lots, sampling 10)`);
    await auditStatusDrift(topHouse, topLots, { sampleSize: 10 });
  } catch (e) {
    console.warn('STATUS-DRIFT: tick failed:', e.message);
  }
}

async function bootDecision() {
  try {
    const { data } = await supabase
      .from('lots')
      .select('last_seen_at')
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastSeen = data?.last_seen_at ? new Date(data.last_seen_at).getTime() : 0;
    const hoursSince = lastSeen ? Math.round((Date.now() - lastSeen) / 3600000) : Infinity;
    if (process.env.FORCE_BOOT_SCRAPE === 'true' || hoursSince > 25) {
      console.log(`SCHEDULE: boot — running full pass (last scrape ${hoursSince}h ago${process.env.FORCE_BOOT_SCRAPE === 'true' ? ', FORCE_BOOT_SCRAPE set' : ''})`);
      _scheduleState.lastFullPass = Date.now();
      withTier('full', async () => {
        try { await watchAuctionCalendar(); } catch (e) { console.error('SCHEDULE boot watcher failed (non-fatal):', e.message); }
        await autoAnalyseAll();
      }).catch(e => console.error('SCHEDULE boot full pass failed:', e.message));
    } else {
      console.log(`SCHEDULE: boot — skipping full pass (last scrape ${hoursSince}h ago); running free enrichment`);
      _scheduleState.lastFreeEnrich = Date.now();
      withTier('free-enrichment', () => runEnrichmentWave({ freeOnly: true })).catch(e => console.error('SCHEDULE boot enrichment failed:', e.message));
    }
  } catch (e) {
    console.warn('SCHEDULE: boot DB check failed, defaulting to free enrichment:', e.message);
    withTier('free-enrichment', () => runEnrichmentWave({ freeOnly: true })).catch(() => {});
  }
}

function scheduleTick() {
  const { hour, minute } = getUkHourMinute();
  const now = Date.now();

  // Tier 1: Full pass at 03:00 UK — watcher first (discovers Cat B URLs),
  // then autoAnalyseAll scrapes whatever the calendar now points at.
  if (hour === 3 && minute < 5 && now - _scheduleState.lastFullPass > 60 * 60 * 1000) {
    _scheduleState.lastFullPass = now;
    console.log('SCHEDULE: 03:00 UK — running auction-watcher then full autoAnalyseAll');
    withTier('full', async () => {
      try { await watchAuctionCalendar(); } catch (e) { console.error('SCHEDULE watcher failed (non-fatal):', e.message); }
      await autoAnalyseAll();
    }).catch(e => console.error('SCHEDULE full pass failed:', e.message));
  }

  // Tier 2: Free enrichment every 30 min
  if (now - _scheduleState.lastFreeEnrich > 30 * 60 * 1000) {
    _scheduleState.lastFreeEnrich = now;
    withTier('free-enrichment', () => runEnrichmentWave({ freeOnly: true })).catch(e => console.error('SCHEDULE free enrichment failed:', e.message));
  }

  // Tier 3: Status drift hourly 09–18 UK
  if (hour >= 9 && hour <= 18 && minute < 5 && now - _scheduleState.lastStatusDrift > 50 * 60 * 1000) {
    _scheduleState.lastStatusDrift = now;
    withTier('status-drift', () => statusDriftTick());
  }
}

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`Bridgematch running on port ${PORT}`);
  if (!process.env.SUPABASE_URL) console.warn('SUPABASE_URL not set');
  if (!process.env.SUPABASE_SERVICE_KEY) console.warn('SUPABASE_SERVICE_KEY not set');

  // Boot decision after 60s — gives DB connection time to settle
  setTimeout(bootDecision, 60000);
  // Cron-like ticker — every minute, decide what to run
  setInterval(scheduleTick, 60000);
});

