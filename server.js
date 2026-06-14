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
import compression from 'compression';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { getLastExtractorUsed } from './lib/scraper/state.js';
import { callAI, initAI } from './lib/ai-provider.js';
import { ResourceBudget } from './lib/resource-budget.js';
import {
  initScraper,
  FIRECRAWL_API_KEY, FIRECRAWL_SKIP, scrapeWithFirecrawl, scrapeRenderedPage,
  scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots, scrapeSymondsAndSampson,
  detectTotalPages, buildPageUrl, fetchPage, extractLotsWithAI,
  backfillImages, backfillImagesWithFirecrawl,
  backfillImagesFromLotPages, fetchLotPage, normaliseLotStatuses, puppeteer,
  isFcCreditExhausted, getFcExhaustedAt, setFcCreditExhausted, setFcExhaustedAt,
  isFcTemporarilyDown, getFcDownAt, setFcTemporarilyDown, setFcDownAt, setFcConsecutive5xx,
  getLastScrapeEngine, getLastAITier, enrichLotsFromLotPages,
  withTier,
} from './lib/scraper.js';

// ── Resource budget — single source of truth for resource state ──
const budget = new ResourceBudget();
if (puppeteer) budget.setPuppeteer(puppeteer);
// callAI MUST be injected here: lib/scraper/extraction.js::extractLotsWithAI
// reads it via state.getCallAI(). It was missing, so every AI-extraction
// batch threw `getCallAI(...) is not a function` — silently 0-lotting the
// Gemini fallback for days and, once Crawlee became primary (Firecrawl dead,
// 2026-06-11), the entire catalogue. callAI is a stable module function;
// its provider internals initialise later via initAI(), which is fine
// because extraction only runs long after boot.
// extractPostcode had the same gap (guarded, so it silently skipped postcode
// recovery in lot-detail.js rather than crashing). ESM imports are hoisted,
// so the line-38 import is initialised by the time this executes.
initScraper({ budget, callAI, extractPostcode });
import { extractPostcode, enrichLots, getCircuitBreakers, initEnrichment } from './lib/enrichment.js';
import { log, requestLoggerMiddleware } from './lib/logging.js';
import { validateEnv, ALLOWED_ORIGINS } from './lib/config.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_ENABLED } from './lib/supabase.js';
import { securityHeaders, csrfCheck } from './lib/security.js';
import { getClientIP, setOnNewUser } from './lib/auth.js';
import { initHouses, HOUSE_ROOTS, rewriteUrl } from './lib/houses.js';
import { applyUmamiInjection } from './lib/utils.js';
import { getCalendarAuctions } from './lib/calendar.js';

// ── Harness modules (adaptive resilience framework) ──
import { initAlerts, fireAlert as harnessFireAlert, resolveAlert as harnessResolveAlert } from './lib/harness/alert-router.js';
import { emitPipelineEvent } from './lib/pipeline/pipeline-events.js';
import { initHouseHealth, updateHealth as harnessUpdateHealth } from './lib/harness/house-health.js';
import { initDiscovery } from './lib/harness/house-discovery.js';
import { initManager, runManagerCycle, getManagerDirectives } from './lib/harness/manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

validateEnv();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy for correct client IP via req.ip / X-Forwarded-For
app.set('trust proxy', 1);

// gzip all responses — ~70% payload reduction on the HTML/JS-heavy index page
app.use(compression());

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

// Wire the budget alert hook through to the harness alert router. Indirect
// via setAlertHook to avoid a circular import (resource-budget → alert-router
// → resource-budget). MUST be set before the first scrape — bootDecision()
// runs after a 60s delay, so this ordering is safe.
budget.setAlertHook((payload) => harnessFireAlert(payload));

// Wire the pipeline-events hook so every booked Firecrawl call emits one
// 'firecrawl_call' row into pipeline_events. Same indirection rationale as
// setAlertHook above. Best-effort: emitPipelineEvent() swallows insert
// errors so observability writes never block scrape correctness.
budget.setEventHook((payload) => emitPipelineEvent(payload));

// Rehydrate the Firecrawl cycle-spend counter from pipeline_events so the
// monthly cap survives restarts — every deploy used to zero it, which is why
// the 80%/95% budget alerts never fired while the real plan drained dry
// (May–June 2026 incident). Best-effort: needs fc_cycle_spend() in Postgres.
budget.hydrateFcSpend(supabase)
  .then(r => { if (r) console.log(`ResourceBudget: hydrated Firecrawl spend from pipeline_events — cycle=${r.cycleCredits} today=${r.todayCredits}`); })
  .catch(e => console.warn('ResourceBudget: spend hydration failed (continuing with zeroed counters):', e.message));

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
import lotsRouter from './routes/lots.js';
import pricingRouter from './routes/pricing.js';
import digestRouter from './routes/digest.js';
import searchRouter, { invalidateAllLotsCache, warmAllLotsCache } from './routes/search.js';
import adminRouter from './routes/admin.js';
import userDataRouter from './routes/user_data.js';
import curatorRouter from './routes/curator.js';
import telegramWebhookRouter from './routes/telegram-webhook.js';
import { sendWelcomeEmail } from './lib/email.js';

// Wire up the new-user callback so validateUserFromReq can trigger welcome emails
setOnNewUser((email, name) => sendWelcomeEmail(email, name).catch(() => {}));

// ── Route mounting (order matters for middleware) ──
app.use(authRouter);
app.use('/api/stripe', stripeRouter);
app.use(leadsRouter);
app.use(calendarRouter);
app.use(analyseRouter);
app.use(lotsRouter);
app.use(pricingRouter);
app.use(digestRouter);
app.use(curatorRouter);
app.use(searchRouter);
app.use(adminRouter);
app.use(userDataRouter);
app.use(telegramWebhookRouter);

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL — must be AFTER all route registrations
// ═══════════════════════════════════════════════════════════════
// Read index.html + inject env-derived config ONCE at startup rather than
// on every request (saves ~200-300ms FCP). All injected values are static
// for the server's lifetime (Supabase URL / anon key / auth-enabled flag /
// Umami website id), so a single precomputed string is equivalent.
const _indexHtmlCache = (() => {
  try {
    let html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
    html = html.replace("window.__SUPABASE_URL__ || ''", JSON.stringify(SUPABASE_URL || ''));
    html = html.replace("window.__SUPABASE_ANON_KEY__ || ''", JSON.stringify(SUPABASE_ANON_KEY || ''));
    html = html.replace("window.__AUTH_ENABLED__ || false", AUTH_ENABLED ? 'true' : 'false');
    // Live house count — beats the old hardcoded "30+" / "173" sprinkled through
    // the landing copy. Single source of truth = HOUSE_ROOTS in lib/houses.js.
    const houseCount = Object.keys(HOUSE_ROOTS).length;
    html = html.replaceAll('__HOUSE_COUNT__', String(houseCount));
    html = applyUmamiInjection(html, process.env.UMAMI_WEBSITE_ID);
    if (!process.env.UMAMI_WEBSITE_ID) {
      log.warn('UMAMI_WEBSITE_ID unset — analytics script stripped from served HTML');
    }
    log.info('index.html cached at startup', { bytes: html.length });
    return html;
  } catch (e) {
    log.error('Failed to preload index.html at startup — will fall back to sendFile', { error: e.message });
    return null;
  }
})();

app.get('*', (req, res) => {
  // 'no-store' (rather than just 'no-cache') prevents Edge/Chrome's
  // back-forward cache from restoring a stale HTML+JS snapshot after a
  // deploy. Cost is one ~80KB doc fetch per page visit — negligible.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  if (_indexHtmlCache) {
    res.type('html').send(_indexHtmlCache);
  } else {
    res.sendFile(join(__dirname, 'index.html'));
  }
});

// ── Error handling — must come after all routes ──
// Sentry was initialised at the top of this file but never given an Express
// error handler, so route errors reached neither Sentry nor the client as
// JSON (2026-06-10 audit). Express 4 only routes sync throws and explicit
// next(err) calls here — async rejections without try/catch still escape to
// the unhandledRejection hook below (full asyncHandler wrapping is a
// separate roadmap item, WORKSTREAMS Phase 5).
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
app.use((err, req, res, next) => {
  log.error('Unhandled route error', { method: req.method, path: req.path, error: err?.message || String(err) });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  log.error('Unhandled promise rejection', { error: msg });
  if (process.env.SENTRY_DSN) Sentry.captureException(reason instanceof Error ? reason : new Error(msg));
});

// ═══════════════════════════════════════════════════════════════
// DEPENDENCY INJECTION — wire up lib/analysis.js and harness/manager.js
// ═══════════════════════════════════════════════════════════════
import { initAnalysis, autoAnalyseAll, healBrokenHouse, runEnrichmentWave, drainHygieneRetries } from './lib/analysis.js';
import { auditStatusDrift } from './lib/harness/sub-agents.js';
import { initWatcher, watchAuctionCalendar } from './lib/pipeline/auction-watcher.js';
import { syncCalendar } from './lib/pipeline/calendar-sync.js';
import { pickNextHouseForDrift } from './lib/pipeline/drift-scheduler.js';
import { initRentals, drainStaleRentals } from './lib/rentals/index.js';
import { initHpi } from './lib/land-registry-hpi.js';
import { initCompanies } from './lib/land-registry-companies.js';
import { sweepPostAuctionStatuses } from './lib/pipeline/post-auction-sweep.js';
import { sweepSameDayStatuses } from './lib/pipeline/same-day-sweep.js';
import { sweepMultiImages } from './lib/pipeline/multi-image-sweep.js';

initAnalysis({
  // Resource budget (new: centralised resource state)
  budget,
  // Scraper (legacy deps — will migrate to budget incrementally)
  FIRECRAWL_API_KEY, FIRECRAWL_SKIP, scrapeWithFirecrawl, scrapeRenderedPage,
  scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots, scrapeSymondsAndSampson,
  detectTotalPages, buildPageUrl, fetchPage, extractLotsWithAI,
  backfillImages, backfillImagesWithFirecrawl,
  backfillImagesFromLotPages, fetchLotPage, normaliseLotStatuses, puppeteer,
  isFcCreditExhausted, getFcExhaustedAt, setFcCreditExhausted, setFcExhaustedAt,
  isFcTemporarilyDown, getFcDownAt, setFcTemporarilyDown, setFcDownAt, setFcConsecutive5xx,
  getLastScrapeEngine, getLastAITier,
  // Extractor provenance — DOM extractors retired 2026-05-08; getter
  // remains for stamping lots.extracted_with ('firecrawl-json' | 'gemini').
  getLastExtractorUsed,
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
  healBrokenHouse,
  getCircuitBreakers,
});

// Wire auction-watcher deps. Tier-2 AI fallback uses Firecrawl FIRE-1 via
// the agentExtract export from lib/scraper/firecrawl.js (default in initWatcher).
initWatcher({
  scrapeWithFirecrawl,
  fireAlert: harnessFireAlert,
  budget,
});

// Wire rental-scraper deps (rollout #7 — postcode rental comps).
// Plain HTTP, no Firecrawl credit, monthly cadence. Drained via the
// admin /api/admin/rentals/drain endpoint or future cron.
initRentals({ supabase });

// Wire enrichment dependencies — without this, the supabase reference in
// lib/enrichment.js stays null and every LR cache lookup, queryLandRegistry
// call, and HMLR enrichment pass silently skips. Symptom in the wild: every
// lot's land_registry status was 'circuit_open' because queryLandRegistry
// returned api_error → lrBreaker tripped → all subsequent lots short-
// circuited as circuit_open without ever hitting the DB.
initEnrichment({ supabase });

// Wire HMLR bulk-loaded query modules (HPI, CCOD/OCOD).
// Data refreshed monthly via scripts/refresh-hmlr-hpi.mjs and
// scripts/refresh-hmlr-companies.mjs.
initHpi({ supabase });
initCompanies({ supabase });

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

const _scheduleState = {
  lastFullPass: 0, lastFreeEnrich: 0, lastStatusDrift: 0,
  lastRentalDrain: 0, lastRetryDrain: 0, lastPostAuctionSweep: 0,
  lastBudgetLog: 0, lastMultiImageSweep: 0, lastHmlrRefresh: 0,
  // Phase 5 tiers (alert-sweep / coverage-digest / sitemap-regen):
  lastAlertSweep: 0, lastCoverageDigest: 0, lastSitemapRegen: 0,
  // Tier 12 (homepage-watch):
  lastHomepageWatch: 0,
  // Tier 13 (saved-search alerts — Pro feature):
  lastSavedSearchAlerts: 0,
  // Tier 14 (weekly digest — Mondays only):
  lastWeeklyDigest: 0,
  // Tier 15 (phantom-lot sweep — daily):
  lastPhantomSweep: 0,
  // Tier 16 (curator cycle — daily, generates 8 picks for admin review):
  lastCuratorCycle: 0,
  // Tier 17 (daily curator digest — daily, sends approved picks to subscribers):
  lastDailyDigest: 0,
  lastFreshnessDigest: 0,
  // Tier 18 (same-day status sweep — daily 20:00 UK, today's auctions only):
  lastSameDaySweep: 0,
  // Tier 19 (unsold-lot alerts — daily 08:10 UK; endpoint existed since April
  // but no scheduler ever called it until the 2026-06-10 tidy):
  lastUnsoldAlerts: 0,
};

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

    // Round-robin: pick the house whose drift data is stalest, so every
    // house gets sampled over time instead of just the highest-volume one.
    const slugs = Object.keys(byHouse);
    const { data: skillRows } = await supabase
      .from('house_skills')
      .select('slug,last_drift_checked_at')
      .in('slug', slugs);
    const lastCheckedMap = {};
    for (const row of skillRows || []) lastCheckedMap[row.slug] = row.last_drift_checked_at;

    const nextHouse = pickNextHouseForDrift(byHouse, lastCheckedMap);
    if (!nextHouse) {
      console.log('STATUS-DRIFT: no candidate house selected');
      return;
    }
    const nextLots = byHouse[nextHouse];
    console.log(`STATUS-DRIFT: checking ${nextHouse} (${nextLots.length} upcoming lots, sampling 10, last checked ${lastCheckedMap[nextHouse] || 'never'})`);

    // Record the attempt timestamp regardless of outcome — otherwise a single
    // persistently-throwing house would monopolise every tick (re-picked as
    // "stalest" forever). Transient failures still get re-sampled on the next
    // full rotation; persistent failures surface via alerts, not by starving
    // the scheduler.
    try {
      await auditStatusDrift(nextHouse, nextLots, { sampleSize: 10 });
    } finally {
      try {
        await supabase
          .from('house_skills')
          .update({ last_drift_checked_at: new Date().toISOString() })
          .eq('slug', nextHouse);
      } catch (updErr) {
        console.warn(`STATUS-DRIFT: failed to record check for ${nextHouse}:`, updErr.message);
      }
    }
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
        try { await syncCalendar({ supabase }); } catch (e) { console.error('SCHEDULE boot syncCalendar failed (non-fatal):', e.message); }
        await autoAnalyseAll();
      }).catch(e => console.error('SCHEDULE boot full pass failed:', e.message));
    } else {
      console.log(`SCHEDULE: boot — skipping full pass (last scrape ${hoursSince}h ago); running free enrichment`);
      _scheduleState.lastFreeEnrich = Date.now();
      withTier('free-enrichment', () => runEnrichmentWave({ freeOnly: true, drainRetries: false })).catch(e => console.error('SCHEDULE boot enrichment failed:', e.message));
    }
  } catch (e) {
    console.warn('SCHEDULE: boot DB check failed, defaulting to free enrichment:', e.message);
    withTier('free-enrichment', () => runEnrichmentWave({ freeOnly: true })).catch(() => {});
  }
}

function scheduleTick() {
  const { hour, minute } = getUkHourMinute();
  const now = Date.now();

  // Surface Firecrawl credit usage hourly (top of the hour). Cheap
  // observability — every campaign-driven spike now leaves a trail in the
  // server log so we can diagnose 9k-credit-day surprises immediately
  // instead of two weeks later from the Firecrawl dashboard.
  if (minute === 0 && now - _scheduleState.lastBudgetLog > 50 * 60 * 1000) {
    _scheduleState.lastBudgetLog = now;
    const fc = budget.getFirecrawlStatus();
    console.log(
      `BUDGET-FC: today=${fc.creditsUsedToday}/${fc.dailyBudget} ` +
      `cycle=${fc.creditsUsed}/${fc.monthlyBudget} ` +
      `tiers=${JSON.stringify(fc.creditsByTier)} ` +
      `flags=${[fc.dailyCapHit && 'daily-cap', fc.monthlyCapHit && 'monthly-cap', fc.creditExhausted && 'plan-exhausted', fc.temporarilyDown && 'down'].filter(Boolean).join(',') || 'ok'}`
    );
  }

  // Tier 1: Full pass at 03:00 UK — watcher first (discovers Cat B URLs),
  // then autoAnalyseAll scrapes whatever the calendar now points at.
  if (hour === 3 && minute < 5 && now - _scheduleState.lastFullPass > 60 * 60 * 1000) {
    _scheduleState.lastFullPass = now;
    console.log('SCHEDULE: 03:00 UK — running auction-watcher then full autoAnalyseAll');
    withTier('full', async () => {
      try { await watchAuctionCalendar(); } catch (e) { console.error('SCHEDULE watcher failed (non-fatal):', e.message); }
      try { await syncCalendar(supabase, { log }); } catch (e) { console.error('SCHEDULE syncCalendar failed (non-fatal):', e.message); }
      await autoAnalyseAll();
      invalidateAllLotsCache(); // fresh scrape data should appear immediately
    }).catch(e => console.error('SCHEDULE full pass failed:', e.message));
  }

  // Tier 2: Free enrichment every 30 min (retry drain excluded — runs on Tier 5)
  if (now - _scheduleState.lastFreeEnrich > 30 * 60 * 1000) {
    _scheduleState.lastFreeEnrich = now;
    withTier('free-enrichment', () => runEnrichmentWave({ freeOnly: true, drainRetries: false })).catch(e => console.error('SCHEDULE free enrichment failed:', e.message));
  }

  // Tier 3: Status drift hourly 09–18 UK
  if (hour >= 9 && hour <= 18 && minute < 5 && now - _scheduleState.lastStatusDrift > 50 * 60 * 1000) {
    _scheduleState.lastStatusDrift = now;
    withTier('status-drift', () => statusDriftTick());
  }

  // Tier 5: Enrichment retry drain — twice daily at 03:05 and 13:00 UK.
  // Runs after the 03:00 full pass and at a quiet midday window. Kept off
  // the 30-min enrichment tick to avoid continuous individual DB PATCHes.
  if ((hour === 3 && minute >= 5 && minute < 10) || (hour === 13 && minute < 5)) {
    if (now - _scheduleState.lastRetryDrain > 6 * 60 * 60 * 1000) {
      _scheduleState.lastRetryDrain = now;
      console.log(`SCHEDULE: ${hour}:${String(minute).padStart(2,'0')} UK — running enrichment retry drain`);
      drainHygieneRetries()
        .then(r => console.log(`SCHEDULE retry drain: attempted=${r.attempted} ok=${r.ok} retried=${r.retried} gaveUp=${r.gaveUp} deferred=${r.deferred}`))
        .catch(e => console.error('SCHEDULE retry drain failed:', e.message));
    }
  }

  // Tier 4: Rental drain daily at 04:00 UK — runs after the 03:00 full
  // pass settles and before status-drift starts at 09:00. Limit 50 means
  // we cycle through ~500 active-auction postcodes × 3 sources every ~30
  // days — exactly the freshness window in lib/rentals/index.js.
  // OpenRent is Firecrawl-backed; SpareRoom + OnTheMarket are plain HTTP.
  if (hour === 4 && minute < 5 && now - _scheduleState.lastRentalDrain > 60 * 60 * 1000) {
    _scheduleState.lastRentalDrain = now;
    console.log('SCHEDULE: 04:00 UK — running drainStaleRentals(limit=50)');
    drainStaleRentals({ limit: 50 })
      .then(r => console.log(`SCHEDULE rental drain: attempted=${r.attempted} ok=${r.ok} errors=${r.errors} skipped=${r.skipped || 0}`))
      .catch(e => console.error('SCHEDULE rental drain failed:', e.message));
  }

  // Tier 6: Post-auction status sweep daily at 05:00 UK. For lots whose
  // auction date passed 1–30 days ago AND status is still 'available' or
  // 'unsold', re-fetch the detail page once and capture the source's final
  // status (sold/unsold/withdrawn/stc). Crucial for surfacing the
  // motivated-seller pipeline (genuinely-unsold lots) accurately —
  // without this, ~500 lots stay frozen at 'available' forever.
  // Batch limit 100 — clears typical daily backlog while staying cheap.
  if (hour === 5 && minute < 5 && now - _scheduleState.lastPostAuctionSweep > 60 * 60 * 1000) {
    _scheduleState.lastPostAuctionSweep = now;
    console.log('SCHEDULE: 05:00 UK — running sweepPostAuctionStatuses');
    sweepPostAuctionStatuses()
      .then(r => console.log(`SCHEDULE post-auction sweep: eligible=${r.eligible} fetched=${r.fetched} updated=${r.statusUpdated} unchanged=${r.noChange} dead=${r.urlDead} failed=${r.fetchFailed}`))
      .catch(e => console.error('SCHEDULE post-auction sweep failed:', e.message));
  }

  // Tier 7b: daily catalogue-freshness digest — 08:00 UK, after the overnight
  // full pass (~02:00) and post-auction sweep (05:00) so it reports on them.
  // Replaces the operator's manual morning SQL: freshness buckets, engine
  // vitals (extraction calls / failures / hallucinations blocked / crawler
  // restarts) and the post-auction backlog, to Telegram.
  if (hour === 8 && minute < 5 && now - _scheduleState.lastFreshnessDigest > 6 * 60 * 60 * 1000) {
    _scheduleState.lastFreshnessDigest = now;
    console.log('SCHEDULE: 08:00 UK — sending freshness digest');
    import('./lib/pipeline/freshness-digest.js')
      .then(({ runFreshnessDigest }) => runFreshnessDigest(supabase))
      .catch(e => console.error('SCHEDULE freshness digest failed:', e.message));
  }

  // Tier 8: HMLR bulk-dataset refresh — once a month on the 7th at 02:00 UK.
  // HPI publishes around the 17th and CCOD/OCOD on the 1st, so the 7th of
  // the *following* month is comfortably past both publication dates.
  // Sequential to avoid a memory spike (CCOD streams 4.4M rows; postcodes-
  // only mode keeps the upserted set tiny). Each loader is idempotent —
  // re-running the same month is a no-op via PK conflict.
  const todayDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' })).getDate();
  if (todayDate === 7 && hour === 2 && minute < 5 && now - _scheduleState.lastHmlrRefresh > 24 * 60 * 60 * 1000) {
    _scheduleState.lastHmlrRefresh = now;
    console.log('SCHEDULE: 7th 02:00 UK — running HMLR refresh (HPI + CCOD + OCOD)');
    (async () => {
      const { spawn } = await import('node:child_process');
      const runLoader = (dataset, args) => new Promise((resolve) => {
        const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
        child.on('exit', code => {
          console.log(`SCHEDULE HMLR ${dataset} exit=${code}`);
          if (code !== 0) {
            harnessFireAlert({
              type: 'hmlr_refresh_failed',
              severity: 'warning',
              house: null,
              message: `HMLR ${dataset} loader exited with code ${code}`,
              meta: { dataset, exitCode: code, args },
            });
          }
          resolve(code);
        });
        child.on('error', err => {
          console.error(`SCHEDULE HMLR ${dataset} spawn error:`, err.message);
          harnessFireAlert({
            type: 'hmlr_refresh_failed',
            severity: 'warning',
            house: null,
            message: `HMLR ${dataset} loader failed to spawn: ${err.message}`,
            meta: { dataset, args, error: err.message },
          });
          resolve(-1);
        });
      });
      try {
        // One bad dataset shouldn't kill the rest — runLoader resolves either
        // way and the alert above gets fired per-dataset.
        await runLoader('HPI',  ['scripts/refresh-hmlr-hpi.mjs']);
        await runLoader('OCOD', ['scripts/refresh-hmlr-companies.mjs', '--dataset=ocod', '--postcodes-only']);
        await runLoader('CCOD', ['scripts/refresh-hmlr-companies.mjs', '--dataset=ccod', '--postcodes-only']);
        await runLoader('PPD',  ['scripts/refresh-hmlr-ppd.mjs', '--postcodes-only']);
      } catch (e) {
        console.error('SCHEDULE HMLR refresh failed:', e.message);
        harnessFireAlert({
          type: 'hmlr_refresh_failed',
          severity: 'error',
          house: null,
          message: `HMLR refresh chain crashed: ${e.message}`,
          meta: { error: e.message },
        });
      }
    })();
  }

  // Tier 7: Multi-image gallery sweep daily at 06:00 UK. Active lots with
  // fewer than 3 images get their detail page fetched once (50/day, 14-day
  // cooldown) so the carousel quietly fills out as the backlog drains.
  // ~50 Firecrawl credits/day = ~1,500/month — fits inside the steady-state
  // budget with comfortable headroom.
  if (hour === 6 && minute < 5 && now - _scheduleState.lastMultiImageSweep > 60 * 60 * 1000) {
    _scheduleState.lastMultiImageSweep = now;
    console.log('SCHEDULE: 06:00 UK — running sweepMultiImages');
    sweepMultiImages()
      .then(r => console.log(`SCHEDULE multi-image sweep: eligible=${r.eligible} fetched=${r.fetched} galleries=${r.galleryAdded} partial=${r.galleryPartial} noimgs=${r.noImagesFound} dead=${r.urlDead} failed=${r.fetchFailed} +${r.totalImagesAdded}imgs`))
      .catch(e => console.error('SCHEDULE multi-image sweep failed:', e.message));
  }

  // Tier 9: Alert sweeper, daily 02:30 UK. Resolves pipeline_alerts older
  // than 30 days where the per-type "now healthy" predicate confirms the
  // underlying problem is gone (lib/pipeline/alert-sweeper.js).
  if (hour === 2 && minute >= 30 && minute < 35 && now - _scheduleState.lastAlertSweep > 60 * 60 * 1000) {
    _scheduleState.lastAlertSweep = now;
    console.log('SCHEDULE: 02:30 UK — running alert sweeper');
    import('./lib/pipeline/alert-sweeper.js')
      .then(({ sweepStaleAlerts }) => sweepStaleAlerts(supabase))
      .then(r => console.log(`SCHEDULE alert sweep: scanned=${r.scanned} resolved=${r.resolved.length} skipped(no-predicate)=${r.skippedNoPredicate} skipped(unhealthy)=${r.skippedNotHealthy}`))
      .catch(e => console.error('SCHEDULE alert sweep failed:', e.message));
  }

  // Tier 10: Coverage digest, daily 09:00 UK. Aggregates enrichment_manifest
  // distribution across last-7-day lots and posts the summary to Telegram.
  // Day-over-day deltas come from coverage_snapshots (graceful degrade if
  // the table doesn't exist yet — see migrations/2026-05-09-coverage-snapshots.sql).
  if (hour === 9 && minute < 5 && now - _scheduleState.lastCoverageDigest > 60 * 60 * 1000) {
    _scheduleState.lastCoverageDigest = now;
    console.log('SCHEDULE: 09:00 UK — running coverage digest');
    Promise.all([
      import('./lib/pipeline/coverage-digest.js'),
      import('./lib/telegram.js'),
    ])
      .then(async ([{ buildCoverageDigest, formatDigestForTelegram }, telegram]) => {
        const digest = await buildCoverageDigest(supabase);
        console.log(`SCHEDULE coverage digest: total=${digest.totalLots} epc=${digest.coverage?.epc_pct}% image=${digest.coverage?.image_pct}%`);
        const sender = telegram.sendNotification || telegram.default?.sendNotification;
        if (sender) await sender(formatDigestForTelegram(digest));
      })
      .catch(e => console.error('SCHEDULE coverage digest failed:', e.message));
  }

  // Tier 11: Sitemap regeneration, daily 04:30 UK. Rewrites public/sitemap.xml
  // with the four static URLs plus one entry per upcoming/recent lot — keeps
  // search engines pointed at the freshest deep links from Phase 4 (/lot/:id).
  if (hour === 4 && minute >= 30 && minute < 35 && now - _scheduleState.lastSitemapRegen > 60 * 60 * 1000) {
    _scheduleState.lastSitemapRegen = now;
    console.log('SCHEDULE: 04:30 UK — regenerating sitemap.xml');
    import('./scripts/regenerate-sitemap.mjs')
      .then(({ regenerateSitemap }) => regenerateSitemap({ dry: false }))
      .then(r => console.log(`SCHEDULE sitemap: wrote=${r.wrote} urls=${r.urlCount} bytes=${r.bytes}`))
      .catch(e => console.error('SCHEDULE sitemap regen failed:', e.message));
  }

  // Tier 12: Homepage watch at 03:30 UK, every other day (epoch-day parity).
  // For every house in HOUSE_ROOTS, ask Firecrawl whether the homepage
  // changed since last visit and what catalogue URL it currently links to.
  // Drift on the same domain triggers healBrokenHouse() automatically;
  // new-domain drift / parked / no-longer-auction fires alerts for human
  // review. ~150 Firecrawl credits/run; every other day ≈ ~2,250/month.
  // URL drift is also caught by the nightly 0-lot healing path, so a ≤1-day
  // detection lag is acceptable. Kill switch: HOMEPAGE_WATCH_ENABLED=false.
  // Scheduled at 03:30 to give the 03:00 full pass a clear runway and
  // pick up any URL changes the full pass just discovered.
  if (hour === 3 && minute >= 30 && minute < 35
      && Math.floor(now / 86400000) % 2 === 0
      && now - _scheduleState.lastHomepageWatch > 60 * 60 * 1000) {
    _scheduleState.lastHomepageWatch = now;
    console.log('SCHEDULE: 03:30 UK — running homepage watch');
    Promise.all([
      import('./lib/pipeline/homepage-watch.js'),
      import('./lib/telegram.js'),
    ])
      .then(async ([{ runHomepageWatchCycle }, telegram]) => {
        const sendTelegram = telegram.sendNotification;
        const sendActionableCard = telegram.sendActionableCard;
        const { classifyNewDomainDrift } = await import('./lib/pipeline/healing.js');
        const result = await runHomepageWatchCycle(supabase, {
          fireAlert: harnessFireAlert,
          healBrokenHouse,
          sendTelegram,
          sendActionableCard,
          classifyNewDomainDrift,
          log,
        });
        if (result.skipped) {
          console.log(`SCHEDULE homepage watch: skipped (${result.reason})`);
        } else {
          const s = result.summary;
          console.log(`SCHEDULE homepage watch: total=${s.total} unchanged=${s.unchanged} drift=${s.drift} healed=${s.healed} alerts=${s.alerts} errors=${s.errors}`);
        }

        // Backlog digest — surface unresolved alerts older than 24h as
        // actionable cards so the long tail doesn't decay into noise.
        try {
          const { sendBacklogDigest } = await import('./lib/pipeline/telegram-backlog.js');
          const backlog = await sendBacklogDigest(supabase, { sendTelegram, sendActionableCard, log });
          if (backlog.sent > 0) console.log(`SCHEDULE backlog digest: sent ${backlog.sent} cards (${backlog.total} total open)`);
        } catch (e) { console.warn('SCHEDULE backlog digest failed:', e.message); }
      })
      .catch(e => console.error('SCHEDULE homepage watch failed:', e.message));
  }

  // Tier 13: Saved-search email alerts, daily 08:00 UK. For every Pro
  // user with notify_email=true on a saved search, query lots seen since
  // last_notified_at that match the saved filter set, send a digest
  // email, and advance last_notified_at on success. Skips quiet days
  // (no matches → no email → no timestamp move).
  // Kill switch: SAVED_SEARCH_ALERTS_ENABLED=false.
  if (hour === 8 && minute < 5 && now - _scheduleState.lastSavedSearchAlerts > 60 * 60 * 1000) {
    _scheduleState.lastSavedSearchAlerts = now;
    console.log('SCHEDULE: 08:00 UK — running saved-search email alerts');
    Promise.all([
      import('./lib/pipeline/saved-search-alerts.js'),
      import('./lib/email.js'),
    ])
      .then(async ([{ runSavedSearchAlertsCycle }, email]) => {
        const result = await runSavedSearchAlertsCycle(supabase, {
          sendEmail: email.sendTransactionalEmail,
          log,
        });
        if (result.skipped) {
          console.log(`SCHEDULE saved-search alerts: skipped (${result.reason || 'unknown'})`);
        } else if (result.error) {
          console.error('SCHEDULE saved-search alerts: query error', result.error);
        } else {
          const s = result.summary;
          console.log(`SCHEDULE saved-search alerts: total=${s.total} eligible=${s.eligible} sent=${s.sent} skipped=${s.skipped} errors=${s.errors}`);
        }
      })
      .catch(e => console.error('SCHEDULE saved-search alerts failed:', e.message));
  }

  // Tier 19: Unsold-lot alert emails, daily 08:10 UK. The POST
  // /api/cron/unsold-alerts endpoint was fully built in April but nothing
  // ever invoked it (2026-06-10 audit). Module no-ops without RESEND key.
  if (hour === 8 && minute >= 10 && minute < 15 && now - _scheduleState.lastUnsoldAlerts > 60 * 60 * 1000) {
    _scheduleState.lastUnsoldAlerts = now;
    console.log('SCHEDULE: 08:10 UK — running unsold-lot alert emails');
    import('./lib/pipeline/unsold-alerts.js')
      .then(({ runUnsoldAlertsCycle }) => runUnsoldAlertsCycle(supabase))
      .then(r => console.log(`SCHEDULE unsold alerts: sent=${r.sent} total=${r.total}${r.skipped ? ` (${r.skipped})` : ''}`))
      .catch(e => console.error('SCHEDULE unsold alerts failed:', e.message));
  }

  // Tier 14: Weekly digest, Mondays 09:00 UK. Pulls top scored lots from
  // the last 7 days and emails every email_signups row with
  // digest_optin=true that hasn't been sent in the past 5 days.
  // Kill switch: WEEKLY_DIGEST_ENABLED=false.
  const isMonday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' })).getDay() === 1;
  if (isMonday && hour === 9 && minute < 5 && now - _scheduleState.lastWeeklyDigest > 6 * 24 * 60 * 60 * 1000) {
    _scheduleState.lastWeeklyDigest = now;
    console.log('SCHEDULE: Monday 09:00 UK — running weekly digest');
    Promise.all([
      import('./lib/pipeline/weekly-digest.js'),
      import('./lib/email.js'),
    ])
      .then(async ([{ runWeeklyDigestCycle }, email]) => {
        const result = await runWeeklyDigestCycle(supabase, {
          sendEmail: email.sendTransactionalEmail,
          log,
        });
        if (result.skipped) {
          console.log(`SCHEDULE weekly digest: skipped (${result.reason || 'unknown'})`);
        } else if (result.error) {
          console.error('SCHEDULE weekly digest: query error', result.error);
        } else {
          const s = result.summary;
          console.log(`SCHEDULE weekly digest: total=${s.total} sent=${s.sent} skipped=${s.skipped} errors=${s.errors}${s.reason ? ` reason=${s.reason}` : ''}`);
        }
      })
      .catch(e => console.error('SCHEDULE weekly digest failed:', e.message));
  }

  // Tier 15: Phantom-lot sweeper, daily 02:45 UK. Walks active lots
  // (last_seen_at within 30d, status != extraction_failure) and re-runs
  // the looksLikeRealAddress() predicate. Failures get flipped to
  // status='extraction_failure' so they drop out of the user feed
  // without being hard-deleted (history preserved). Catches old rows
  // that survived from before placeholder phrases were added to the
  // extractor deny-list.
  // Kill switch: PHANTOM_SWEEP_ENABLED=false.
  if (hour === 2 && minute >= 45 && minute < 50 && now - _scheduleState.lastPhantomSweep > 23 * 60 * 60 * 1000) {
    _scheduleState.lastPhantomSweep = now;
    console.log('SCHEDULE: 02:45 UK — running phantom-lot sweep');
    import('./lib/pipeline/phantom-lot-sweep.js')
      .then(async ({ runPhantomLotSweep }) => {
        const result = await runPhantomLotSweep(supabase, {
          log,
          alertHook: (payload) => harnessFireAlert(payload),
        });
        if (result.skipped) {
          console.log(`SCHEDULE phantom-sweep: skipped (${result.reason || 'unknown'})`);
        } else if (result.error) {
          console.error('SCHEDULE phantom-sweep: query error', result.error);
        } else {
          const s = result.summary;
          console.log(`SCHEDULE phantom-sweep: scanned=${s.scanned} flagged=${s.flagged}`);
        }
      })
      .catch(e => console.error('SCHEDULE phantom-sweep failed:', e.message));
  }

  // Tier 16: Curator cycle, daily 05:30 UK. Selects up to 8 high-quality
  // lots from today's data, generates investor-grade prose via Gemini Pro,
  // and persists each as status='pending' for admin review. Runs after
  // the 03:00 full pass + 05:00 post-auction sweep so the candidate pool
  // is fresh. ~£0.10/run in Gemini Pro tokens.
  // Kill switch: CURATOR_ENABLED=false.
  if (hour === 5 && minute >= 30 && minute < 35 && now - _scheduleState.lastCuratorCycle > 23 * 60 * 60 * 1000) {
    _scheduleState.lastCuratorCycle = now;
    console.log('SCHEDULE: 05:30 UK — running curator cycle');
    import('./lib/pipeline/curator-cycle.js')
      .then(({ runCuratorCycle }) => runCuratorCycle(supabase))
      .then(result => {
        if (result.skipped) {
          console.log(`SCHEDULE curator-cycle: skipped (${result.reason || 'unknown'})`);
        } else if (result.error) {
          console.error('SCHEDULE curator-cycle: error', result.error);
        } else {
          const s = result.summary;
          console.log(`SCHEDULE curator-cycle: candidates=${s.candidates} selected=${s.selected} generated=${s.generated} inserted=${s.inserted}${s.reason ? ` reason=${s.reason}` : ''}`);
        }
      })
      .catch(e => console.error('SCHEDULE curator-cycle failed:', e.message));
  }

  // Tier 17: Daily curator digest, 12:00 UK. Sends today's APPROVED picks
  // to every email_signups row with daily_digest_optin=true. Scheduled at
  // noon (rather than 09:00 alongside the weekly) so the operator has the
  // morning to review the 05:30 picks at /admin/curator. The cycle skips
  // sends if fewer than 3 picks are approved (better silent than thin).
  // Kill switch: DAILY_DIGEST_ENABLED=false.
  if (hour === 12 && minute < 5 && now - _scheduleState.lastDailyDigest > 6 * 60 * 60 * 1000) {
    _scheduleState.lastDailyDigest = now;
    console.log('SCHEDULE: 12:00 UK — running daily curator digest');
    Promise.all([
      import('./lib/pipeline/daily-digest.js'),
      import('./lib/email.js'),
    ])
      .then(async ([{ runDailyDigestCycle }, email]) => {
        const result = await runDailyDigestCycle(supabase, {
          sendEmail: email.sendTransactionalEmail,
          log,
        });
        if (result.skipped) {
          console.log(`SCHEDULE daily-digest: skipped (${result.reason || 'unknown'})`);
        } else if (result.error) {
          console.error('SCHEDULE daily-digest: error', result.error);
        } else {
          const s = result.summary;
          console.log(`SCHEDULE daily-digest: total=${s.total} sent=${s.sent} skipped=${s.skipped} errors=${s.errors}${s.reason ? ` reason=${s.reason}` : ''}`);
        }
      })
      .catch(e => console.error('SCHEDULE daily-digest failed:', e.message));
  }

  // Tier 18: Same-day status sweep, daily 20:00 UK. Re-fetch lots whose
  // auction is TODAY and status is still 'available' or 'unsold', flipping
  // them to sold/unsold/withdrawn the same evening when the auction site
  // updates. Closes the gap left by Tier 6 (post-auction-sweep), which waits
  // 24h after auction_date by design. Lower wall-clock budget (15 min) and
  // smaller cohort (today's auctions only, no 30-day backlog). ~10 active
  // houses × ~50 lots avg = ~500 fetches/day, most plain-HTTP and free —
  // <1% of the 100k Firecrawl plan quota.
  if (hour === 20 && minute < 5 && now - _scheduleState.lastSameDaySweep > 60 * 60 * 1000) {
    _scheduleState.lastSameDaySweep = now;
    console.log('SCHEDULE: 20:00 UK — running sweepSameDayStatuses');
    sweepSameDayStatuses()
      .then(r => console.log(`SCHEDULE same-day sweep: eligible=${r.eligible} fetched=${r.fetched} updated=${r.statusUpdated} unchanged=${r.noChange} dead=${r.urlDead} failed=${r.fetchFailed}`))
      .catch(e => console.error('SCHEDULE same-day sweep failed:', e.message));
  }
}

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
// Process role gate. With Railway running >1 web instance the schedulers and
// cache warmer would duplicate work (two boot full-passes, two cron ticks
// every minute, two cache warmers stomping on each other).
//   ROLE=web    → HTTP only, no scheduled jobs
//   ROLE=worker → scheduled jobs (HTTP listener still runs as a health target)
//   unset       → both, as before (single-process backwards-compatible default)
// TODO(scheduler): once >1 worker instance is configured, wrap scheduleTick
// and warmAllLotsCache in pg_try_advisory_lock so concurrent workers can't
// re-run the same tick. Requires a migration to expose the lock helper.
const ROLE = process.env.ROLE || '';
const RUN_SCHEDULERS = ROLE !== 'web';

app.listen(PORT, () => {
  console.log(`Bridgematch running on port ${PORT}${ROLE ? ` (role=${ROLE})` : ''}`);
  if (!process.env.SUPABASE_URL) console.warn('SUPABASE_URL not set');
  if (!process.env.SUPABASE_SERVICE_KEY) console.warn('SUPABASE_SERVICE_KEY not set');

  if (!RUN_SCHEDULERS) {
    console.log('SCHEDULE: skipping boot/tick/cache-warm — ROLE=web');
    return;
  }

  // Boot decision after 60s — gives DB connection time to settle
  setTimeout(bootDecision, 60000);
  // Cron-like ticker — every minute, decide what to run
  setInterval(scheduleTick, 60000);

  // ── Pre-warm /api/all-lots cache for both anon + signed-in variants ──
  // Without this, the first visitor after every boot/TTL-expiry pays the
  // full ~3-4s pipeline cost. Daily auction updates + a 10-min cache TTL
  // mean repeat-warming every 8 min keeps the cache continuously fresh.
  // Calls the pipeline function directly — no internal HTTP, no Umami noise.
  setTimeout(() => warmAllLotsCache().catch(e => console.warn('initial warm failed:', e.message)), 5000);
  setInterval(() => warmAllLotsCache().catch(e => console.warn('periodic warm failed:', e.message)), 8 * 60 * 1000);
});

