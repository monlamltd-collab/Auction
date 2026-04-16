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

// ═══════════════════════════════════════════════════════════════
// BROKEN EXTRACTOR TRACKING (auto-populated by audit, persisted to Supabase)
// ═══════════════════════════════════════════════════════════════
const BROKEN_EXTRACTORS = new Set();

// Load broken extractors from Supabase on startup
async function loadBrokenExtractors() {
  try {
    const { data, error } = await supabase
      .from('house_skills')
      .select('slug')
      .eq('status', 'broken');
    if (error) { console.warn('BROKEN: Failed to load broken extractors:', error.message); return; }
    if (data) {
      for (const row of data) {
        BROKEN_EXTRACTORS.add(row.slug);
      }
      if (BROKEN_EXTRACTORS.size > 0) {
        console.log(`BROKEN: Loaded ${BROKEN_EXTRACTORS.size} broken extractors from Supabase: ${[...BROKEN_EXTRACTORS].join(', ')}`);
      }
    }
  } catch (err) {
    console.warn('BROKEN: Failed to load broken extractors:', err.message);
  }
}
// Fire-and-forget on startup (don't block server startup)
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
import { sendWelcomeEmail } from './lib/email.js';

// Wire up the new-user callback so validateUserFromReq can trigger welcome emails
setOnNewUser((email, name) => sendWelcomeEmail(email, name).catch(() => {}));

app.use(authRouter);
app.use('/api/stripe', stripeRouter);
app.use(leadsRouter);

// validateUserFromReq moved to lib/auth.js (already imported above)

// ═══════════════════════════════════════════════════════════════
// PLACEHOLDER — routes below will be extracted in tasks 13-14
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// API: AUCTION CALENDAR
// ═══════════════════════════════════════════════════════════════

// Hardcoded fallback calendar — used when Supabase auction_calendar table is empty
// FALLBACK_CALENDAR, getAuctionCalendar, getCalendarAuctions moved to lib/calendar.js
app.get('/api/auctions', async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  try {
    const auctions = await getAuctionCalendar();
    res.json({ updated: new Date().toISOString(), count: auctions.length, auctions });
  } catch (e) {
    log.error('Calendar endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to load auction calendar' });
  }
});

// Admin: seed the Supabase calendar from hardcoded data
app.post('/api/admin/seed-calendar', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const rows = FALLBACK_CALENDAR.map(a => ({
      house: a.house, house_slug: a.houseSlug, logo: a.logo,
      date: a.date, date_end: a.dateEnd || null, title: a.title,
      lots: a.lots || null, url: a.url, location: a.location,
      type: a.type, status: a.status, catalogue_ready: a.catalogueReady,
    }));
    const { data, error } = await supabase.from('auction_calendar').upsert(rows, { onConflict: 'url,date' });
    if (error) throw error;
    res.json({ message: `Seeded ${rows.length} auction entries`, count: rows.length });
  } catch (e) {
    log.error('Calendar seed error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: add/update a single auction
app.post('/api/admin/calendar', async (req, res) => {
  const { secret, auction } = req.body || {};
  const token = req.headers['x-admin-secret'] || secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!auction || !auction.house || !auction.date || !auction.url) {
    return res.status(400).json({ error: 'Missing required fields: house, date, url' });
  }
  try {
    const row = {
      house: auction.house,
      house_slug: auction.houseSlug || auction.house.toLowerCase().replace(/[^a-z0-9]/g, ''),
      logo: auction.logo || '🔨',
      date: auction.date,
      date_end: auction.dateEnd || null,
      title: auction.title || auction.date,
      lots: auction.lots || null,
      url: auction.url,
      location: auction.location || 'Online',
      type: auction.type || 'Residential & Commercial',
      status: auction.status || 'upcoming',
      catalogue_ready: auction.catalogueReady !== undefined ? auction.catalogueReady : false,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('auction_calendar').upsert(row, { onConflict: 'url,date' });
    if (error) throw error;
    res.json({ message: 'Auction saved', auction: row });
  } catch (e) {
    log.error('Calendar save error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: deduplicate the calendar — remove duplicate rows keeping the best one per house+date+url
app.post('/api/admin/dedup-calendar', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const { data, error } = await supabase.from('auction_calendar').select('id, house, date, url, catalogue_ready');
    if (error) throw error;

    const groups = new Map();
    for (const row of (data || [])) {
      const key = `${(row.house || '').toLowerCase()}|${row.date}|${normaliseUrl(row.url)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const toDelete = [];
    for (const [, rows] of groups) {
      if (rows.length <= 1) continue;
      // Keep the one with catalogue_ready=true, or the first one
      rows.sort((a, b) => (b.catalogue_ready ? 1 : 0) - (a.catalogue_ready ? 1 : 0));
      for (let i = 1; i < rows.length; i++) toDelete.push(rows[i].id);
    }

    if (toDelete.length > 0) {
      for (const id of toDelete) {
        await supabase.from('auction_calendar').delete().eq('id', id);
      }
    }

    res.json({ message: `Removed ${toDelete.length} duplicate calendar entries`, removed: toDelete.length });
  } catch (e) {
    log.error('Calendar dedup error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: trigger self-healing for a specific house or view healing status
app.post('/api/admin/heal', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  const { slug } = req.body || {};
  if (!slug) {
    // Return healing status for all houses
    const healingState = getHealingState();
    const status = {};
    for (const [s, state] of healingState) {
      status[s] = {
        lastAttempt: state.lastAttempt ? new Date(state.lastAttempt).toISOString() : null,
        attempts: state.attempts,
        onCooldown: state.cooldownUntil ? Date.now() < state.cooldownUntil : false,
        cooldownUntil: state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : null,
      };
    }
    return res.json({ healingState: status, totalTracked: healingState.size });
  }

  const rootUrl = HOUSE_ROOTS[slug];
  if (!rootUrl) return res.status(404).json({ error: `Unknown house slug: ${slug}` });

  // Clear cooldown to allow immediate retry
  clearHealingCooldown(slug);

  try {
    const healedUrl = await healBrokenHouse(slug, rootUrl);
    if (healedUrl) {
      res.json({ healed: true, slug, oldUrl: rootUrl, newUrl: healedUrl });
    } else {
      res.json({ healed: false, slug, message: 'Healing did not find a new URL' });
    }
  } catch (e) {
    log.error('Admin heal error', { slug, error: e.message });
    res.status(500).json({ error: 'Healing failed', detail: e.message });
  }
});

// Admin: delete an auction by ID
app.delete('/api/admin/calendar/:id', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const { error } = await supabase.from('auction_calendar').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Auction deleted' });
  } catch (e) {
    log.error('Calendar delete error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: DISCOVER CATALOGUES — find upcoming auction URLs from root pages
// ═══════════════════════════════════════════════════════════════
// Scrapes a house's root/listing page and uses Claude to extract catalogue links.
// This handles URL format changes (date slugs, query params, auction IDs) automatically.
app.post('/api/admin/discover-catalogues', async (req, res) => {
  const { secret, houses } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }

  const targetHouses = houses || Object.keys(HOUSE_ROOTS);
  const results = [];

  for (const slug of targetHouses) {
    const rootUrl = HOUSE_ROOTS[slug];
    if (!rootUrl) { results.push({ house: slug, error: 'No root URL configured' }); continue; }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(rootUrl, { headers: HEADERS, signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) { results.push({ house: slug, error: `HTTP ${resp.status}` }); continue; }
      const html = await resp.text();

      // Strip HTML to reduce token usage, keep links and text
      const stripped = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 8000);

      // Also extract all hrefs for Claude to reference
      const hrefMatches = [...html.matchAll(/href="([^"]*(?:auction|lot|catalogue|sale|property)[^"]*)"/gi)];
      const hrefs = [...new Set(hrefMatches.map(m => m[1]))].slice(0, 50);

      const aiText = await callAI(`You are analysing an auction house's listing page to find links to upcoming/current auction catalogues.

House: ${HOUSE_DISPLAY_NAMES[slug] || slug}
Root URL: ${rootUrl}

Page text (truncated):
${stripped}

Links found on page:
${hrefs.join('\n')}

Extract ALL auction catalogue links you can find. For each, provide:
- url: The full URL (resolve relative URLs against ${rootUrl})
- title: The auction title/date as shown on page
- date: The auction date in YYYY-MM-DD format if you can determine it (null if unclear)
- catalogueReady: true if the catalogue appears to have lots listed, false if "coming soon"

Return ONLY valid JSON: {"catalogues": [{"url": "...", "title": "...", "date": "...", "catalogueReady": true}]}
If no catalogues found, return {"catalogues": []}`, { tier: 'capable', maxTokens: 2000, taskType: 'discovery' });

      let catalogues = [];
      try {
        let text = aiText.trim();
        if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        catalogues = JSON.parse(text).catalogues || [];
      } catch (e) {
        results.push({ house: slug, error: 'AI returned invalid JSON', raw: aiText.substring(0, 200) });
        continue;
      }

      results.push({
        house: slug,
        displayName: HOUSE_DISPLAY_NAMES[slug] || slug,
        rootUrl,
        catalogues,
      });
    } catch (e) {
      results.push({ house: slug, error: e.message });
    }
  }

  res.json({ discovered: results.length, results });
});

// ═══════════════════════════════════════════════════════════════
// API: ANALYSE CATALOGUE
// ═══════════════════════════════════════════════════════════════
app.post('/api/analyse', async (req, res) => {
  const { url, budget, email } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  // ── Validate URL to prevent SSRF ──
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });

  // ── Check user is signed up (token-based auth with email fallback) ──
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'signup_required', message: 'Please sign up to use the analyser' });

  // ── Tier info (centralised via resolveEffectiveTier) ──
  const userTier = resolveEffectiveTier(user);
  const scanCount = user.analyses_count || 0;

  // ── Rate limiting (admin bypass with ADMIN_SECRET header) ──
  const isAdmin = process.env.ADMIN_SECRET && safeCompare(req.headers['x-admin-secret'], process.env.ADMIN_SECRET);
  const ip = getClientIP(req);
  const today = new Date().toISOString().slice(0, 10);

  // Atomic rate limit check: upsert+increment in one call via RPC, fallback to select
  let currentRequests = 0;
  try {
    const { data: rateRow } = await supabase.rpc('increment_rate_limit', { p_ip: ip, p_date: today });
    currentRequests = rateRow ?? 0;
  } catch {
    // Fallback if RPC not yet deployed: read then write (non-atomic)
    const { data: rateRow } = await supabase
      .from('rate_limits')
      .select('requests')
      .eq('ip', ip)
      .eq('date', today)
      .single();
    currentRequests = rateRow?.requests ?? 0;
  }

  if (!isAdmin && currentRequests >= RATE_LIMIT) {
    return res.status(429).json({
      error: 'rate_limited',
      message: `Daily limit reached (${RATE_LIMIT} analyses per day). Try again tomorrow.`
    });
  }

  // ── Check cache (metadata only — lot data comes from lots table) ──
  const normalisedUrl = normaliseUrl(url);
  const { data: cached } = await supabase
    .from('cached_analyses')
    .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, expires_at')
    .eq('url', normalisedUrl)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    console.log(`Cache hit for ${normalisedUrl} — reading lots from lots table`);
    const cachedSlug = HOUSE_DISPLAY_NAMES[cached.house]
      ? cached.house
      : Object.entries(HOUSE_DISPLAY_NAMES).find(([k, v]) => v === cached.house)?.[0] || cached.house;
    const cachedDisplayName = HOUSE_DISPLAY_NAMES[cachedSlug] || cached.house;
    const isPremium = userTier === 'premium';

    // Read fresh lot data from lots table (single source of truth)
    const { data: lotRows } = await supabase
      .from('lots')
      .select(LOTS_SELECT)
      .eq('catalogue_url', normalisedUrl)
      .order('score', { ascending: false, nullsFirst: false });

    const freshLots = (lotRows || []).map(dbRowToFrontendLot);
    const gatedLots = isPremium ? freshLots : stripAIFields(freshLots);

    // Recompute summary stats from fresh data
    const lotsWithPrice = freshLots.filter(l => l.price && l.price > 0);
    const yieldsArr = freshLots.map(l => l.estGrossYield).filter(y => y && y > 0);

    return res.json({
      house: cachedDisplayName,
      houseSlug: cachedSlug,
      recognised: cachedSlug !== 'unknown',
      totalLots: freshLots.length,
      titleSplits: freshLots.filter(l => l.titleSplit).length,
      topPicks: freshLots.filter(l => l.score >= 3).length,
      under100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avgYield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      devPotential: freshLots.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacantCount: freshLots.filter(l => l.vacant === true).length,
      lots: gatedLots,
      cached: true,
      blurred: !isPremium,
      scansUsed: scanCount,
      scanLimit: FREE_SCAN_LIMIT,
    });
  }

  // Rate counter already incremented atomically above (pre-cache check)
  // For cached responses, the count was bumped but that's acceptable (prevents cache-probe abuse)

  // ── Fresh analysis — stream progress via SSE ──
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  // Set up SSE stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const house = detectAuctionHouse(url);
    const rewritten = await rewriteUrl(url, house);
    const scrapeUrl = rewritten.baseUrl;
    const displayNameEarly = getHouseDisplayName(house, url);

    console.log(`House: ${house}, URL: ${scrapeUrl}, isApi: ${rewritten.isApi}, preferPuppeteer: ${!!rewritten.preferPuppeteer}`);
    sseWrite(res, 'phase', { step: 'connecting', house: displayNameEarly });

    // Validate URL first (skip for sites that block server-side fetches)
    if (!rewritten.preferPuppeteer) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const testResp = await fetch(url, { headers: HEADERS, signal: controller.signal });
        clearTimeout(timeout);
        if (!testResp.ok) {
          sseWrite(res, 'error', { message: `That URL returned an error (${testResp.status}). It may not be a catalogue page, or the catalogue hasn't been published yet.` });
          return res.end();
        }
      } catch (e) {
        sseWrite(res, 'error', { message: "Couldn't reach that URL. Check it's a valid catalogue page." });
        return res.end();
      }
    }

    let pages;
    let rawLots = [];

    sseWrite(res, 'phase', { step: 'scraping' });

    const onExtract = (batch, totalBatches, lotsFound) => {
      sseWrite(res, 'extract', { batch, totalBatches, lotsFound });
    };

    // ── PDF catalogues — send directly to Gemini ──
    if (isPdfUrl(url)) {
      log.info('pdf_detected', { url, house });
      rawLots = await extractLotsFromPdf(url);
    } else if (rewritten.paginateAs === 'allsop_api') {
      // Allsop API: parse JSON directly (no Gemini needed)
      pages = await scrapeAllsopApi(rewritten.baseUrl);
      sseWrite(res, 'scrape', { pages: pages.length });
      if (pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = extractAllsopLotsFromJson(pages);
      }
    } else if (rewritten.preferPuppeteer) {
      // JS-rendered sites: use Firecrawl+JSDOM (primary) or Puppeteer (fallback)
      console.log(`Scraping JS-rendered site for ${house} (Firecrawl primary, Puppeteer fallback)...`);

      try {
        // Paginated sites: build page URLs, scrape each with scrapeRenderedPage + extractWithJSDOM
        if (rewritten.paginateAs === 'savills_pages') {
          console.log(`Loading paginated Savills catalogue...`);
          const firstResult = await scrapeRenderedPage(scrapeUrl, house);
          // Detect total pages from first page HTML
          const dom = new JSDOM(firstResult.html, { url: scrapeUrl });
          const totalPages = (() => {
            const pageLinks = dom.window.document.querySelectorAll('a[href*="/page-"]');
            let max = 1;
            for (const a of pageLinks) {
              const m = a.textContent.trim().match(/^(\d+)$/);
              if (m) max = Math.max(max, parseInt(m[1]));
            }
            return max;
          })();
          dom.window.close();
          console.log(`Savills: detected ${totalPages} pages`);
          sseWrite(res, 'scrape', { pages: totalPages, lots: 0 });

          const firstPageLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
          sseWrite(res, 'scrape', { pages: totalPages, lots: rawLots.length });
          console.log(`Page 1: ${firstPageLots ? firstPageLots.length : 0} lots`);

          const maxPages = Math.min(totalPages, 50);
          for (let p = 2; p <= maxPages; p++) {
            try {
              const pageResult = await scrapeRenderedPage(`${scrapeUrl}/page-${p}`, house);
              const pageLots = extractWithJSDOM(pageResult.html, house, `${scrapeUrl}/page-${p}`, pageResult.images);
              if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
              console.log(`Page ${p}: ${pageLots ? pageLots.length : 0} lots`);
            } catch (e) {
              console.log(`Page ${p} failed: ${e.message}`);
            }
          }
          console.log(`Savills total: ${rawLots.length} lots from ${maxPages} pages via DOM extraction`);

        } else if (rewritten.paginateAs === 'sdl_pages') {
          console.log(`Loading paginated SDL catalogue...`);
          const firstResult = await scrapeRenderedPage(scrapeUrl, house);
          const sdlTotalPages = detectTotalPages(firstResult.html, scrapeUrl, house);
          console.log(`SDL: detected ${sdlTotalPages} pages`);

          const sdlFirstLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (sdlFirstLots && sdlFirstLots.length > 0) rawLots.push(...sdlFirstLots);
          console.log(`SDL Page 1: ${sdlFirstLots ? sdlFirstLots.length : 0} lots`);

          const sdlMaxPages = Math.min(sdlTotalPages, 40);
          for (let p = 2; p <= sdlMaxPages; p++) {
            const sep = scrapeUrl.includes('?') ? '&' : '?';
            const pageUrl = `${scrapeUrl}${sep}page=${p}`;
            try {
              const pageResult = await scrapeRenderedPage(pageUrl, house);
              const pageLots = extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
              if (pageLots && pageLots.length > 0) {
                rawLots.push(...pageLots);
                console.log(`SDL Page ${p}: ${pageLots.length} lots`);
              } else {
                console.log(`SDL Page ${p}: 0 lots — stopping pagination`);
                break;
              }
            } catch (e) {
              console.log(`SDL Page ${p} failed: ${e.message}`);
              break;
            }
          }
          console.log(`SDL total: ${rawLots.length} lots via DOM extraction`);

        } else if (rewritten.paginateAs === 'pugh_pages') {
          // Pugh: server-rendered Laravel — plain HTTP + JSDOM (no Firecrawl needed)
          console.log(`Loading paginated Pugh catalogue (plain HTTP)...`);
          const pughHtml1 = await fetchPage(scrapeUrl);
          const pughPage1Lots = extractWithJSDOM(pughHtml1, house, scrapeUrl);
          if (pughPage1Lots && pughPage1Lots.length > 0) rawLots.push(...pughPage1Lots);
          console.log(`Pugh Page 1: ${pughPage1Lots ? pughPage1Lots.length : 0} lots`);

          // Detect total pages from first page HTML
          const pughTotalPages = detectTotalPages(pughHtml1, scrapeUrl, house);
          const pughMaxPages = Math.min(pughTotalPages, 65);
          console.log(`Pugh: detected ${pughTotalPages} pages, loading up to ${pughMaxPages}`);

          for (let p = 2; p <= pughMaxPages; p++) {
            const pageUrl = buildPageUrl(scrapeUrl, p, house);
            try {
              const pageHtml = await fetchPage(pageUrl);
              const pageLots = extractWithJSDOM(pageHtml, house, pageUrl);
              if (pageLots && pageLots.length > 0) {
                rawLots.push(...pageLots);
                if (p % 10 === 0) console.log(`Pugh Page ${p}: ${pageLots.length} lots (total so far: ${rawLots.length})`);
              } else {
                console.log(`Pugh Page ${p}: 0 lots — stopping pagination`);
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            } catch (e) {
              console.log(`Pugh Page ${p} failed: ${e.message}`);
              break;
            }
          }
          console.log(`Pugh total: ${rawLots.length} lots via DOM extraction`);

        } else {
          // ── Generic extraction with auto-pagination ──
          console.log(`Loading ${scrapeUrl} for ${house}`);
          const analyseOpts = {};
          if (rewritten.waitFor) analyseOpts.waitFor = rewritten.waitFor;
          if (rewritten.actions) analyseOpts.actions = rewritten.actions;
          const firstResult = await scrapeRenderedPage(scrapeUrl, house, analyseOpts);

          const domLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (domLots && domLots.length >= 3) {
            rawLots.push(...domLots);
            console.log(`${house} Page 1: ${domLots.length} lots via DOM extraction`);

            // Auto-detect pagination from HTML
            const detectedPages = detectTotalPages(firstResult.html, scrapeUrl, house);
            if (detectedPages > 1) {
              const maxPages = Math.min(detectedPages, 25);
              console.log(`${house}: detected ${detectedPages} pages, loading up to ${maxPages}`);

              for (let p = 2; p <= maxPages; p++) {
                if (rawLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`${house}: lot cap reached at ${rawLots.length}`); break; }
                const pageUrl = buildPageUrl(scrapeUrl, p, house);
                try {
                  const pageResult = await scrapeRenderedPage(pageUrl, house);
                  const pageLots = extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
                  if (pageLots && pageLots.length > 0) {
                    rawLots.push(...pageLots);
                    console.log(`${house} Page ${p}: ${pageLots.length} lots`);
                  } else {
                    console.log(`${house} Page ${p}: 0 lots — stopping pagination`);
                    break;
                  }
                } catch (e) {
                  console.log(`${house} Page ${p} failed: ${e.message}`);
                  break;
                }
              }
            }
            if (rawLots.length > MAX_LOTS_PER_SCRAPE) {
              console.log(`${house}: capping ${rawLots.length} lots to ${MAX_LOTS_PER_SCRAPE}`);
              rawLots = rawLots.slice(0, MAX_LOTS_PER_SCRAPE);
            }
            setLastExtractorUsed(DOM_EXTRACTORS[house] ? 'dom-house' : 'dom-generic');
            console.log(`${house} total: ${rawLots.length} lots via DOM extraction (no Claude needed)`);
          } else {
            // Fall back to Claude extraction
            if (domLots && domLots.length > 0) {
              console.log(`DOM extractor found only ${domLots.length} lots for ${house} (below threshold of 3), falling back to Claude`);
            }
            console.log(`Got ${firstResult.html.length} chars, sending to Claude...`);
            const renderedPages = [{ page: 1, html: firstResult.html, markdown: firstResult.markdown }];
            sseWrite(res, 'phase', { step: 'extracting' });
            rawLots = await extractLotsWithAI(renderedPages, house, onExtract, scrapeUrl);
            console.log(`Claude extracted ${rawLots.length} lots from rendered content`);

            // ── DOM→Gemini merge: harvest URLs + images from DOM, merge into Gemini lots ──
            if (rawLots.length > 0 && firstResult.html) {
              const domHarvest = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
              if (domHarvest && domHarvest.length > 0) {
                const domByLot = {};
                for (const d of domHarvest) { if (d.lot) domByLot[d.lot] = d; }
                let urlsMerged = 0, imgsMerged = 0;
                for (const lot of rawLots) {
                  const dom = domByLot[lot.lot];
                  if (!dom) continue;
                  if (!lot.url && dom.url) { lot.url = dom.url; urlsMerged++; }
                  if (!lot.imageUrl && dom.imageUrl) { lot.imageUrl = dom.imageUrl; imgsMerged++; }
                }
                if (urlsMerged === 0 && imgsMerged === 0 && domHarvest.length >= rawLots.length * 0.5) {
                  for (let i = 0; i < rawLots.length && i < domHarvest.length; i++) {
                    if (!rawLots[i].url && domHarvest[i].url) { rawLots[i].url = domHarvest[i].url; urlsMerged++; }
                    if (!rawLots[i].imageUrl && domHarvest[i].imageUrl) { rawLots[i].imageUrl = domHarvest[i].imageUrl; imgsMerged++; }
                  }
                }
                if (urlsMerged > 0 || imgsMerged > 0) {
                  console.log(`DOM→Gemini merge for ${house}: ${urlsMerged} URLs, ${imgsMerged} images`);
                }
              }
            }
          }
        }
      } catch (err) {
        log.error('JS-rendered scraping failed', { house, error: err.message });
        sseWrite(res, 'error', { message: 'Scraping engine unavailable — please try again in a moment.' });
        return res.end();
      }
    } else {
      // Standard static HTML scraping
      pages = await scrapeAllPages(scrapeUrl, house);
      sseWrite(res, 'scrape', { pages: pages ? pages.length : 0 });
      if (pages && pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = await extractLotsWithAI(pages, house, onExtract, scrapeUrl);
      }
      // Rendered page fallback if static scraping found nothing
      const SKIP_PUPPETEER = ['philliparnold','knightfrank'];
      if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
        console.log(`No lots from static HTML, trying rendered scraping for ${house}...`);
        try {
          const rendered = await scrapeRenderedPage(url, house);
          if (rendered.html) {
            const renderedLots = extractWithJSDOM(rendered.html, house, url, rendered.images);
            if (renderedLots && renderedLots.length > 0) {
              rawLots = renderedLots;
              console.log(`Rendered scraping got ${rawLots.length} lots via DOM extraction`);
            } else {
              const renderedPages = [{ page: 1, html: rendered.html, markdown: rendered.markdown }];
              sseWrite(res, 'phase', { step: 'extracting' });
              rawLots = await extractLotsWithAI(renderedPages, house, onExtract, scrapeUrl);
              console.log(`Claude extracted ${rawLots.length} lots from rendered content`);
              // DOM→Gemini merge
              if (rawLots.length > 0) {
                const domH = extractWithJSDOM(rendered.html, house, url, rendered.images);
                if (domH && domH.length > 0) {
                  const byLot = {}; for (const d of domH) { if (d.lot) byLot[d.lot] = d; }
                  let um = 0, im = 0;
                  for (const lot of rawLots) {
                    const d = byLot[lot.lot]; if (!d) continue;
                    if (!lot.url && d.url) { lot.url = d.url; um++; }
                    if (!lot.imageUrl && d.imageUrl) { lot.imageUrl = d.imageUrl; im++; }
                  }
                  if (um === 0 && im === 0 && domH.length >= rawLots.length * 0.5) {
                    for (let i = 0; i < rawLots.length && i < domH.length; i++) {
                      if (!rawLots[i].url && domH[i].url) { rawLots[i].url = domH[i].url; um++; }
                      if (!rawLots[i].imageUrl && domH[i].imageUrl) { rawLots[i].imageUrl = domH[i].imageUrl; im++; }
                    }
                  }
                  if (um > 0 || im > 0) console.log(`DOM→Gemini merge (fallback): ${um} URLs, ${im} images`);
                }
              }
            }
          }
        } catch (err) {
          console.log(`Rendered scraping fallback failed for ${house}: ${err.message}`);
        }
      }
    }
    
    if (pages && pages.length === 0 && rawLots.length === 0) {
      sseWrite(res, 'error', { message: "Couldn't find any content on that page." });
      return res.end();
    }

    if (rawLots.length === 0) {
      sseWrite(res, 'error', { message: "Couldn't find any auction lots. Make sure you're linking to the catalogue page, not the auction house homepage." });
      return res.end();
    }

    sseWrite(res, 'phase', { step: 'scoring', lots: rawLots.length });

    const analysed = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);

    // ── Enrich with Land Registry + rental yields (also resolves lot URLs) ──
    console.log('Starting Land Registry + rental yield enrichment...');
    sseWrite(res, 'phase', { step: 'enriching', lots: analysed.length });
    await enrichLots(analysed, house, url, (done, total) => {
      sseWrite(res, 'enrich', { postcodes: done, total });
    });

    // ── Unified lot-page enrichment: single fetch per lot extracts all missing data ──
    // (address, image, tenure, leaseLength, condition, beds, propType)
    await enrichLotsFromLotPages(analysed);

    // ── Harness enrichment: gap-filling, cross-lot inference, cache carry-forward ──
    const { data: prevLotRows } = await supabase
      .from('lots')
      .select(LOTS_SELECT)
      .eq('catalogue_url', normalisedUrl);
    const harnessResult = enrichBatch(analysed, house, {
      previousCache: (prevLotRows || []).map(dbRowToFrontendLot),
    });
    const enrichedAnalysed = harnessResult.lots;
    if (harnessResult.stats.enriched > 0) {
      console.log(`HARNESS (manual): ${house}: enriched ${harnessResult.stats.enriched} lots (${harnessResult.stats.fieldsImproved.join(', ')})`);
    }
    // Re-score after enrichment fills gaps (e.g. tenure, beds may affect score)
    for (const lot of enrichedAnalysed) {
      const rescored = analyseLot(lot);
      Object.assign(lot, rescored);
    }

    // ── Fundability badges — fire-and-forget, never blocks pipeline ──
    try {
      await enrichLotsWithFundability(enrichedAnalysed);
    } catch (e) {
      console.warn('Fundability enrichment failed (non-fatal):', e.message);
    }

    // ── Cache results ──
    const displayName = getHouseDisplayName(house, url);
    const expiresAt = new Date(Date.now() + getCacheTTL(house)).toISOString();

    // Log unknown house successes for future house addition
    if (house === 'unknown' && enrichedAnalysed.length >= 3) {
      log.info('NEW_HOUSE_CANDIDATE', { hostname: new URL(url).hostname, lots: enrichedAnalysed.length, url });
    }

    // Check if catalogue data actually changed before invalidating preset cache
    const { data: prevCached } = await supabase
      .from('cached_analyses')
      .select('total_lots, top_picks, title_splits')
      .eq('url', normalisedUrl)
      .single();

    // ── Quality gate — validate batch before caching ──
    // prevLotRows already fetched above for enrichBatch
    const qg = qualityGate(enrichedAnalysed, house, prevCached, (prevLotRows || []).map(dbRowToFrontendLot));
    // For manual analyses, log but don't reject — user explicitly asked for this
    if (qg.alerts.length > 0) {
      for (const a of qg.alerts) sseWrite(res, 'warn', { message: a });
    }

    const lotsWithPrice = enrichedAnalysed.filter(l => l.price && l.price > 0);
    const yieldsArr = enrichedAnalysed.map(l => l.estGrossYield).filter(y => y && y > 0);

    const catalogueChanged = !prevCached
      || prevCached.total_lots !== enrichedAnalysed.length
      || prevCached.top_picks !== enrichedAnalysed.filter(l => l.score >= 3).length
      || prevCached.title_splits !== enrichedAnalysed.filter(l => l.titleSplit).length;

    await supabase.from('cached_analyses').upsert({
      url: normalisedUrl,
      house: house,
      total_lots: enrichedAnalysed.length,
      title_splits: enrichedAnalysed.filter(l => l.titleSplit).length,
      top_picks: enrichedAnalysed.filter(l => l.score >= 3).length,
      under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      dev_potential: enrichedAnalysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacant_count: enrichedAnalysed.filter(l => l.vacant === true).length,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      last_scraped_at: new Date().toISOString(),
      scraped_with: getLastScrapeEngine(),
    extracted_with: getLastExtractorUsed(),
    ai_tier: getLastAITier(),
    }, { onConflict: 'url' });

    // ── Upsert individual lots to lots table (single source of truth) ──
    normaliseLotStatuses(enrichedAnalysed); // Normalize before write — canonical statuses only
    await upsertToLotsTable(enrichedAnalysed, house, url, {
      scrapedWith: getLastScrapeEngine(),
      extractedWith: getLastExtractorUsed(),
    });

    // Mark preset cache entries as partially stale (only the changed catalogue needs re-searching)
    if (catalogueChanged) {
      const { data: affected } = await supabase
        .from('smart_search_cache')
        .select('query_key, stale_urls')
        .contains('source_urls', [normalisedUrl]);
      if (affected && affected.length > 0) {
        for (const row of affected) {
          const updatedStale = [...new Set([...(row.stale_urls || []), normalisedUrl])];
          await supabase.from('smart_search_cache')
            .update({ stale_urls: updatedStale })
            .eq('query_key', row.query_key);
        }
        console.log(`Marked ${affected.length} preset cache entries stale for: ${normalisedUrl}`);
      }
    }

    // ── Update user count ──
    await supabase.from('users')
      .update({ analyses_count: (user.analyses_count || 0) + 1 })
      .eq('id', user.id);

    // Log activity event
    logActivityEvent('analysis', { house: displayName, url: normalisedUrl, lots_found: enrichedAnalysed.length }, user?.email, getClientIP(req));

    const updatedScanCount = (user.analyses_count || 0) + 1;

    const isPremium = userTier === 'premium';
    const gatedAnalysed = isPremium ? enrichedAnalysed : stripAIFields(enrichedAnalysed);
    sseWrite(res, 'done', {
      house: displayName,
      houseSlug: house,
      recognised: house !== 'unknown',
      totalLots: enrichedAnalysed.length,
      titleSplits: enrichedAnalysed.filter(l => l.titleSplit).length,
      topPicks: enrichedAnalysed.filter(l => l.score >= 3).length,
      under100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avgYield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      devPotential: enrichedAnalysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacantCount: enrichedAnalysed.filter(l => l.vacant === true).length,
      lots: gatedAnalysed,
      cached: false,
      blurred: !isPremium,
      scansUsed: updatedScanCount,
      scanLimit: FREE_SCAN_LIMIT,
    });
    return res.end();
  } catch (err) {
    log.error('Analysis SSE error', { error: err.message });
    sseWrite(res, 'error', { message: 'Analysis failed' });
    return res.end();
  }
});

// ═══════════════════════════════════════════════════════════════
// PRESET QUERIES — cached for instant results
// ═══════════════════════════════════════════════════════════════
const PRESET_QUERIES = {
  'Properties needing heavy refurbishment': 'heavy-refurb',
  'Freehold multi-unit blocks for title splitting': 'title-splits',
  'High yield investments over 8%': 'high-yield-8',
  'Development land with planning': 'dev-land',
  'Probate or executor sales': 'probate',
  'Best scoring deals': 'top-picks',
  'Vacant properties': 'vacant',
  'Properties under £100k': 'under-100k',
  'Commercial property': 'commercial',
  'Land and development sites': 'land-dev',
  'Flats and apartments': 'flats',
};

// ── Deterministic preset filters — bypass Gemini entirely ──
// Each preset defines: filter (lot => boolean), sort (compare fn), report (count => string)
const PRESET_FILTERS = {
  'top-picks': {
    filter: l => (l.score || 0) >= 3,
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} high-scoring investment opportunities (score 3+) across ${total} auction lots. These properties show the strongest combination of investment signals — such as below-market pricing, development potential, motivated sellers, and value-add condition. Higher scores indicate more overlapping opportunity signals.`
      : `No lots currently score 3 or above. Scores are based on investment signals like condition, tenure, yield, and seller motivation. Try browsing the full directory or check back when new catalogues are analysed.`,
  },
  'under-100k': {
    filter: l => l.price && l.price > 0 && l.price < 100000,
    sort: (a, b) => (a.price || Infinity) - (b.price || Infinity),
    report: (n, total) => n > 0
      ? `Found ${n} properties listed under £100,000 across ${total} lots. These are sorted by guide price, lowest first. Remember that guide prices at auction are often below the expected sale price.`
      : `No properties currently listed under £100,000. Guide prices change as new catalogues are published — check back soon.`,
  },
  'vacant': {
    filter: l => l.vacant === true,
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} vacant properties across ${total} lots, sorted by investment score. Vacant possession means faster completion and immediate access for refurbishment or re-letting.`
      : `No properties explicitly listed as vacant possession. Some lots may still be vacant but not stated in the listing — check individual lot details.`,
  },
  'flats': {
    filter: l => l.propType === 'flat',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} flats and apartments across ${total} lots, sorted by investment score. Check tenure carefully — most flats are leasehold.`
      : `No flats or apartments found in current catalogues.`,
  },
  'high-yield-8': {
    filter: l => l.estGrossYield && l.estGrossYield >= 8,
    sort: (a, b) => (b.estGrossYield || 0) - (a.estGrossYield || 0),
    report: (n, total) => n > 0
      ? `Found ${n} properties with estimated gross yield of 8% or above across ${total} lots, sorted by yield. These yields are estimates based on guide price and local rental data — verify with your own research.`
      : `No properties currently show an estimated gross yield of 8% or above. Yields are calculated from guide prices and local rental data, so they update as new catalogues are published.`,
  },
  'title-splits': {
    filter: l => l.titleSplit === true,
    sort: (a, b) => (b.units || 0) - (a.units || 0) || (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} potential title split opportunities across ${total} lots — freehold properties containing multiple self-contained units. Sorted by unit count. Title splitting can unlock significant value but requires legal and planning checks.`
      : `No title split opportunities detected in current catalogues. These are identified by freehold multi-unit properties where individual flats could be sold separately.`,
  },
  'probate': {
    filter: l => (l.opps || []).some(o => /executor|probate/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} probate and executor sales across ${total} lots, sorted by investment score. These often come with motivated sellers and potential for below-market pricing.`
      : `No probate or executor sales found in current catalogues. These are identified by keywords like "executor", "probate", "estate of" in lot descriptions.`,
  },
  'heavy-refurb': {
    filter: l => l.condition === 'needs work' || l.condition === 'poor',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} properties needing refurbishment across ${total} lots, sorted by investment score. These range from cosmetic updates to full renovations — check lot details for specifics.`
      : `No properties explicitly described as needing refurbishment in current catalogues.`,
  },
  'dev-land': {
    filter: l => (l.opps || []).some(o => /development/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} development opportunities across ${total} lots, sorted by investment score. These include properties with planning permission, development potential, or conversion opportunities.`
      : `No development opportunities found in current catalogues. These are identified by keywords like "planning permission", "development potential", "conversion" in lot descriptions.`,
  },
  'commercial': {
    filter: l => l.propType === 'commercial',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} commercial properties across ${total} lots, sorted by investment score. Includes shops, offices, retail units, industrial premises, and investment portfolios.`
      : `No commercial properties found in current catalogues.`,
  },
  'land-dev': {
    filter: l => l.propType === 'land' || (l.opps || []).some(o => /development/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} land and development sites across ${total} lots, sorted by investment score. Includes building plots, development sites, and properties with planning permission.`
      : `No land or development sites found in current catalogues.`,
  },
};

function isPresetQuery(query) {
  return PRESET_QUERIES[query] || null;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH QUERY PARSER — extracts structured column filters
// from natural language queries so the lots table can be queried
// with SQL before sending the narrowed set to Gemini.
// ═══════════════════════════════════════════════════════════════
function parseSmartSearchQuery(query) {
  const result = { filters: {}, softFilters: {}, locationTerms: [], freeText: [], intentWords: [], concepts: [], original: query };
  let q = query.toLowerCase().trim();

  // ── Concept detection — compound intents that shouldn't be split into individual hard filters ──
  // "block(s) of flats" / "blocks of apartments" → multi-unit freehold concept
  if (/blocks?\s+of\s+(?:flats?|apartments?)/i.test(q)) {
    result.concepts.push('multi_unit_freehold');
    q = q.replace(/blocks?\s+of\s+(?:flats?|apartments?)/gi, '').trim();
  }
  // "could title split" / "title split potential" / "potential to title split"
  if (/(?:could|potential\s+to)\s+title\s+split/i.test(q)) {
    result.concepts.push('title_split_potential');
    q = q.replace(/(?:could|potential\s+to)\s+title\s+split/gi, '').trim();
  }
  // "HMO conversion" / "convert to HMO"
  if (/(?:hmo\s+conversion|convert(?:ed)?\s+to\s+hmo)/i.test(q)) {
    result.concepts.push('hmo_conversion');
    q = q.replace(/(?:hmo\s+conversion|convert(?:ed)?\s+to\s+hmo)/gi, '').trim();
  }
  // "development site" / "development opportunity"
  if (/development\s+(?:site|opportunity|potential|plot)/i.test(q)) {
    result.concepts.push('development');
    q = q.replace(/development\s+(?:site|opportunity|potential|plot)/gi, '').trim();
  }
  // "flip" / "buy to flip" / "quick flip"
  if (/(?:buy\s+to\s+|quick\s+)?flip/i.test(q)) {
    result.concepts.push('flip');
    q = q.replace(/(?:buy\s+to\s+|quick\s+)?flip/gi, '').trim();
  }
  // "buy to let" / "BTL" / "rental"
  if (/(?:buy\s+to\s+let|btl|rental\s+(?:investment|property|yield))/i.test(q)) {
    result.concepts.push('buy_to_let');
    q = q.replace(/(?:buy\s+to\s+let|btl|rental\s+(?:investment|property|yield))/gi, '').trim();
  }

  // ── Multi-word phrases (extract before splitting into words) ──
  // title_split as standalone phrase (not part of a concept) → soft filter
  if (/title\s+split/i.test(q)) { result.softFilters.title_split = true; q = q.replace(/title\s+splits?/gi, '').trim(); }
  if (/need(?:s|ing)?\s+work/i.test(q)) { result.softFilters.condition = ['needs work', 'poor']; q = q.replace(/need(?:s|ing)?\s+(?:of\s+)?work/gi, '').trim(); }
  if (/poor\s+condition/i.test(q)) { result.softFilters.condition = ['needs work', 'poor']; q = q.replace(/poor\s+condition/gi, '').trim(); }
  if (/good\s+condition/i.test(q)) { result.filters.condition = ['good']; q = q.replace(/good\s+condition/gi, '').trim(); }
  if (/share\s+of\s+freehold/i.test(q)) { result.filters.tenure = 'Share of Freehold'; q = q.replace(/share\s+of\s+freehold/gi, '').trim(); }
  if (/high\s+yield/i.test(q)) { result.filters.sortBy = 'yield'; q = q.replace(/high\s+yield/gi, '').trim(); }
  if (/deal\s+stack/i.test(q)) { result.concepts.push('deal_stack'); q = q.replace(/deal\s+stack(?:ing)?/gi, '').trim(); }

  // ── Multi-word location names (must extract before splitting) ──
  const multiWordLocations = {
    'milton keynes': 'Milton Keynes', 'st albans': 'St Albans', 'stoke on trent': 'Stoke',
    'weston-super-mare': 'Weston-super-Mare', 'weston super mare': 'Weston-super-Mare',
    'tunbridge wells': 'Tunbridge', 'bury st edmunds': 'Bury St Edmunds',
    'kings lynn': 'Kings Lynn', 'great yarmouth': 'Great Yarmouth',
    'hemel hempstead': 'Hemel Hempstead', 'st helens': 'St Helens',
    'west bromwich': 'West Bromwich', 'sutton coldfield': 'Sutton Coldfield',
    'stratford-upon-avon': 'Stratford-upon-Avon', 'stratford upon avon': 'Stratford-upon-Avon',
    'bishop auckland': 'Bishop Auckland', 'south shields': 'South Shields',
    'port talbot': 'Port Talbot', 'isle of wight': 'Isle of Wight',
    'fort william': 'Fort William', 'east kilbride': 'East Kilbride',
    'barrow in furness': 'Barrow', 'colwyn bay': 'Colwyn Bay',
  };
  for (const [phrase, canonical] of Object.entries(multiWordLocations)) {
    if (q.includes(phrase)) { result.locationTerms.push(canonical); q = q.replace(new RegExp(phrase.replace(/[-]/g, '\\-'), 'gi'), '').trim(); }
  }

  // ── Region names → postcode prefix filters ──
  const regionPostcodes = {
    'london': ['E','EC','N','NW','SE','SW','W','WC','EN','HA','IG','KT','TW','UB','BR','CR','DA','SM','RM'],
    'south east': ['BN','CT','GU','ME','MK','OX','PO','RG','RH','SL','SO','TN','HP'],
    'south west': ['BA','BH','BS','DT','EX','GL','PL','SN','SP','TA','TQ','TR'],
    'east': ['AL','CB','CM','CO','IP','LU','NR','PE','SG','SS','WD'],
    'west midlands': ['B','CV','DY','HR','ST','TF','WR','WS','WV'],
    'east midlands': ['DE','DN','LE','LN','NG','NN'],
    'north west': ['BB','BL','CA','CH','CW','FY','L','LA','M','OL','PR','SK','WA','WN'],
    'north east': ['DH','DL','HG','NE','SR','TS'],
    'yorkshire': ['BD','DN','HD','HG','HU','HX','LS','S','WF','YO'],
    'wales': ['CF','LD','LL','NP','SA','SY'],
    'scotland': ['AB','DD','DG','EH','FK','G','HS','IV','KA','KW','KY','ML','PA','PH','TD','ZE'],
  };
  // Check region phrases (must check multi-word first)
  const regionOrder = ['south east','south west','west midlands','east midlands','north west','north east','east','yorkshire','wales','scotland'];
  for (const region of regionOrder) {
    if (q.includes(region)) {
      result.filters.regionPostcodes = regionPostcodes[region];
      result.filters.regionName = region;
      q = q.replace(new RegExp(region, 'gi'), '').trim();
      break;
    }
  }

  // ── Price patterns ──
  const underMatch = q.match(/(?:under|below|max|up\s+to|less\s+than)\s*£?\s*(\d[\d,]*)\s*k?\b/i);
  if (underMatch) {
    let price = parseInt(underMatch[1].replace(/,/g, ''));
    if (price < 10000) price *= 1000;
    result.filters.maxPrice = price;
    q = q.replace(underMatch[0], '').trim();
  }
  const overMatch = q.match(/(?:over|above|min|more\s+than|from)\s*£?\s*(\d[\d,]*)\s*k?\b/i);
  if (overMatch) {
    let price = parseInt(overMatch[1].replace(/,/g, ''));
    if (price < 10000) price *= 1000;
    result.filters.minPrice = price;
    q = q.replace(overMatch[0], '').trim();
  }

  // ── Beds ──
  const bedMatch = q.match(/(\d+)\s*(?:bed(?:room)?s?\b)/i);
  if (bedMatch) { result.filters.beds = parseInt(bedMatch[1]); q = q.replace(bedMatch[0], '').trim(); }

  // ── Word classification ──
  const propTypes = { house: 'house', houses: 'house', property: null, properties: null, flat: 'flat', flats: 'flat', apartment: 'flat', apartments: 'flat', land: 'land', commercial: 'commercial', garage: 'garage', bungalow: 'bungalow' };
  const conditionWords = { refurb: ['needs work', 'poor'], refurbishment: ['needs work', 'poor'], derelict: ['poor'], dilapidated: ['poor'], rundown: ['needs work', 'poor'] };

  // Intent words — carry meaning for AI ranking but NOT for SQL filtering
  const intentWords = new Set([
    'best','good','great','top','cheap','cheapest','bargain','bargains','deal','deals',
    'interesting','opportunity','opportunities','investment','investments','promising',
    'strong','value','undervalued','potential','recommend','recommended','find','show',
    'search','looking','want','need','any','all','the','with','for','and','near',
    'around','area','region','in','at','on','from','to','what','where','which','how',
    'can','could','should','would','some','these','those','most','more','very','really',
    'please','thanks','help','me','my','give','list','lots','auction','auctions','market',
  ]);

  // Known UK cities/towns for location detection
  const knownLocations = new Set([
    'london','manchester','birmingham','leeds','sheffield','liverpool','bristol','newcastle','nottingham',
    'cardiff','edinburgh','glasgow','belfast','bradford','leicester','coventry','hull','wolverhampton',
    'stoke','derby','swansea','southampton','portsmouth','plymouth','exeter','reading','oxford','cambridge',
    'brighton','bournemouth','bath','york','chester','lancaster','durham','norwich','ipswich','luton',
    'sunderland','middlesbrough','blackpool','bolton','burnley','rochdale','wigan','warrington','crewe',
    'gloucester','cheltenham','swindon','taunton','peterborough','northampton','lincoln','doncaster',
    'halifax','huddersfield','wakefield','barnsley','rotherham','harrogate','scarborough','carlisle',
    'preston','accrington','salford','oldham','stockport','macclesfield','stafford','tamworth',
    'shrewsbury','telford','hereford','worcester','redditch','nuneaton','rugby','solihull',
    'walsall','dudley','kidderminster','chesterfield','mansfield','grantham','loughborough','corby',
    'kettering','wellingborough','buxton','matlock','colchester','chelmsford','southend','basildon',
    'stevenage','watford','hertford','hastings','eastbourne','crawley','chichester',
    'basingstoke','winchester','folkestone','margate','dover','ashford','woking','guildford','maidstone',
    'canterbury','tunbridge','chatham','dartford','gravesend','poole','weymouth','dorchester','barnstaple',
    'yeovil','bridgwater','salisbury','chippenham','truro','penzance','newquay','falmouth',
    'carmarthen','wrexham','bangor','newport','llandudno','aberystwyth','barry','bridgend','neath',
    'llanelli','haverfordwest','pembroke','brecon','aberdeen','dundee','inverness','stirling','perth',
    'falkirk','paisley','kilmarnock','ayr','dumfries','dunfermline','livingston',
    'croydon','bromley','sutton','kingston','richmond','ealing','hounslow','brent','harrow','barnet',
    'enfield','brixton','peckham','hackney','islington','camden','greenwich','lewisham','southwark',
    'lambeth','wandsworth','tottenham','stratford','ilford','romford','dagenham','woolwich','deptford',
  ]);

  const words = q.split(/\s+/).filter(w => w.length > 1);
  const consumed = new Set();
  for (const word of words) {
    const w = word.replace(/[^a-z0-9-]/g, '');
    if (!w) continue;
    if (w === 'freehold' && !result.filters.tenure) { result.filters.tenure = 'Freehold'; consumed.add(word); }
    else if (w === 'leasehold' && !result.filters.tenure) { result.filters.tenure = 'Leasehold'; consumed.add(word); }
    else if (w === 'vacant') { result.softFilters.vacant = true; consumed.add(word); }
    else if (w === 'unsold' || w === 'failed') { result.filters.statusOverride = 'unsold'; consumed.add(word); }
    else if (w === 'development') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'hmo') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'repossession' || w === 'repossessed' || w === 'receivership') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'yield') { result.filters.sortBy = result.filters.sortBy || 'yield'; consumed.add(word); }
    else if (propTypes[w] !== undefined) { if (propTypes[w]) result.softFilters.prop_type = propTypes[w]; consumed.add(word); }
    else if (conditionWords[w] && !result.softFilters.condition) { result.softFilters.condition = conditionWords[w]; consumed.add(word); }
    else if (knownLocations.has(w)) { result.locationTerms.push(w); consumed.add(word); }
    // Postcode prefix (e.g. BS1, M1, LS2)
    else if (/^[a-z]{1,2}\d{1,2}[a-z]?$/i.test(w)) { result.locationTerms.push(w.toUpperCase()); consumed.add(word); }
    // Intent/filler words — strip from SQL, pass context to Gemini
    else if (intentWords.has(w)) { result.intentWords.push(w); consumed.add(word); }
  }

  // Remaining unconsumed words → freeText for full-text search (NOT location)
  for (const word of words) {
    if (consumed.has(word)) continue;
    const w = word.replace(/[^a-z0-9-]/g, '');
    if (!w || w.length < 3) continue;
    result.freeText.push(w);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH: Column-filtered database query + AI analysis
// ═══════════════════════════════════════════════════════════════
app.post('/api/smart-search', async (req, res) => {
  const { query, soldFilter } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  // Authenticate user
  const user = await validateUserFromReq(req);

  // Anonymous users cannot use AI search at all — must sign up
  if (!user) {
    return res.status(403).json({ error: 'premium_required', message: 'Sign up for free to get 5 AI searches per day, or upgrade to Pro for unlimited.' });
  }

  // ── Rate limiting (free: 5/day, premium/trial: unlimited) ──
  const searchLimit = getAISearchLimit(user);
  const searchToday = new Date().toISOString().slice(0, 10);
  let searchesUsed = 0;
  const _searchIp = req.ip || 'unknown';
  const _searchKey = `aisearch:${_searchIp}`;

  if (searchLimit !== Infinity) {
    if (user) {
      const userSearchDate = user.ai_searches_date ? new Date(user.ai_searches_date).toISOString().slice(0, 10) : null;
      if (userSearchDate === searchToday) searchesUsed = user.ai_searches_today || 0;
      if (searchesUsed >= searchLimit) {
        return res.status(429).json({
          error: 'rate_limited',
          message: `You've used all ${searchLimit} AI searches for today. Upgrade to Pro for unlimited.`,
          searchesUsed, searchLimit,
        });
      }
    } else {
      try {
        const { data: sr } = await supabase.from('rate_limits').select('requests').eq('ip', _searchKey).eq('date', searchToday).single();
        searchesUsed = sr?.requests || 0;
      } catch { /* no row yet */ }
      if (searchesUsed >= searchLimit) {
        return res.status(429).json({
          error: 'rate_limited',
          message: `You've used all ${searchLimit} free AI searches for today. Sign up for 10 per day!`,
          searchesUsed, searchLimit, signup_prompt: true,
        });
      }
    }
  }

  // Helper: increment search counter AFTER successful response
  async function incrementSearchCounter() {
    try {
      if (user) {
        await supabase.from('users').update({ ai_searches_today: searchesUsed + 1, ai_searches_date: searchToday }).eq('id', user.id);
      } else {
        const { data: sr } = await supabase.from('rate_limits').select('requests').eq('ip', _searchKey).eq('date', searchToday).single();
        if (sr) { await supabase.from('rate_limits').update({ requests: (sr.requests || 0) + 1 }).eq('ip', _searchKey).eq('date', searchToday); }
        else { await supabase.from('rate_limits').insert({ ip: _searchKey, date: searchToday, requests: 1 }); }
      }
      searchesUsed += 1;
    } catch { /* non-critical */ }
  }

  const presetSlug = isPresetQuery(query);
  const sf = soldFilter || 'all';

  // ── Deterministic preset fast path — no AI needed ──
  // Presets like "Best scoring deals", "Under £100k", "Vacant" etc. can be resolved
  // by filtering/sorting on precomputed lot fields. Reads from lots table (single source of truth).
  const presetFilter = presetSlug ? PRESET_FILTERS[presetSlug] : null;
  if (presetFilter) {
    try {
      // Query lots table directly — get all lots from active catalogues
      const { data: activeCatalogues } = await supabase
        .from('cached_analyses')
        .select('house, url')
        .gt('expires_at', new Date().toISOString());

      if (!activeCatalogues || activeCatalogues.length === 0) {
        await incrementSearchCounter();
        return res.json({ results: [], report: 'No cached auction data available. Please analyse some auction catalogues first.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
      }

      const activeUrls = [...new Set(activeCatalogues.map(c => c.url))];

      // Build status filter at DB level
      let dbQuery = supabase.from('lots').select(LOTS_SELECT).in('catalogue_url', activeUrls);
      if (sf === 'available') dbQuery = dbQuery.or('status.eq.available,status.is.null');
      else if (sf === 'sold') dbQuery = dbQuery.in('status', ['sold', 'stc', 'withdrawn']);
      else if (sf === 'unsold') dbQuery = dbQuery.eq('status', 'unsold');
      else if (sf === 'stc') dbQuery = dbQuery.eq('status', 'stc');
      else if (sf === 'withdrawn') dbQuery = dbQuery.eq('status', 'withdrawn');
      else if (sf !== 'everything') dbQuery = dbQuery.or('status.eq.available,status.eq.unsold,status.is.null');

      dbQuery = dbQuery.order('score', { ascending: false, nullsFirst: false }).limit(2000);
      const { data: lotRows } = await dbQuery;

      if (!lotRows || lotRows.length === 0) {
        await incrementSearchCounter();
        return res.json({ results: [], report: 'No lots found matching criteria.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
      }

      const allLots = lotRows.map(dbRowToFrontendLot);
      const sources = [];
      const sourceMap = {};
      for (const c of activeCatalogues) {
        if (!sourceMap[c.url]) { sourceMap[c.url] = { house: c.house, url: c.url, count: 0 }; sources.push(sourceMap[c.url]); }
      }
      for (const lot of allLots) {
        if (sourceMap[lot._sourceUrl]) sourceMap[lot._sourceUrl].count++;
      }

      // Apply preset filter and sort
      const matchingLots = allLots.filter(presetFilter.filter);
      matchingLots.sort(presetFilter.sort);

      const report = presetFilter.report(matchingLots.length, allLots.length);

      log.info('smart_search_deterministic', { preset: presetSlug, matches: matchingLots.length, total: allLots.length });
      logActivityEvent('smart_search', { query, results_count: matchingLots.length, deterministic: true }, user?.email, getClientIP(req));

      await incrementSearchCounter();
      return res.json({
        results: matchingLots,
        report,
        sources,
        totalSearched: allLots.length,
        searchesUsed, searchLimit,
      });
    } catch (err) {
      log.warn('Deterministic preset search failed, falling through to AI search', { preset: presetSlug, error: err.message });
      // Fall through to Gemini-based search below
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    log.warn('smart-search: GEMINI_API_KEY not set');
    return res.status(500).json({ error: 'key_missing', message: 'AI search is not configured — GEMINI_API_KEY is missing.' });
  }
  if (getCreditExhausted()) {
    const exhaustedAgo = getCreditExhaustedAt() ? Math.round((Date.now() - getCreditExhaustedAt()) / 60000) : '?';
    log.warn('smart-search: blocked by creditExhausted flag', { exhaustedMinutesAgo: exhaustedAgo });
    return res.status(503).json({ error: 'ai_quota_exhausted', message: `Gemini API rate limit hit ${exhaustedAgo}min ago. Auto-resets after 1 hour. Try again soon.`, exhaustedMinutesAgo: exhaustedAgo });
  }
  const keyPrefix = (process.env.GEMINI_API_KEY || '').substring(0, 10);
  log.info('smart-search pre-flight', { tier: 'fast', keyPrefix: keyPrefix + '...', query: query.substring(0, 60) });

  try {
    // ═══════════════════════════════════════════════════════════
    // LAYER 1: Parse query into structured column filters
    // ═══════════════════════════════════════════════════════════
    const sqParsed = parseSmartSearchQuery(query);
    log.info('smart-search parsed', sqParsed);

    // ── Get active catalogue URLs for freshness gate ──
    const { data: activeCatalogues } = await supabase
      .from('cached_analyses')
      .select('url, house')
      .gt('expires_at', new Date().toISOString());

    if (!activeCatalogues || activeCatalogues.length === 0) {
      await incrementSearchCounter();
      return res.json({ results: [], report: 'No active auction data available.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
    }
    const activeUrls = [...new Set(activeCatalogues.map(c => c.url))];

    // ── Build lots query with column filters ──
    let dbQuery = supabase.from('lots').select(LOTS_SELECT);
    dbQuery = dbQuery.in('catalogue_url', activeUrls);

    // Status: query-level override ("unsold Bristol") takes priority over dropdown filter
    const effectiveSold = sqParsed.filters.statusOverride || sf;
    if (effectiveSold === 'available') dbQuery = dbQuery.or('status.eq.available,status.is.null');
    else if (effectiveSold === 'sold') dbQuery = dbQuery.in('status', ['sold', 'stc', 'withdrawn']);
    else if (effectiveSold === 'unsold') dbQuery = dbQuery.eq('status', 'unsold');
    else if (effectiveSold === 'stc') dbQuery = dbQuery.eq('status', 'stc');
    else if (effectiveSold === 'withdrawn') dbQuery = dbQuery.eq('status', 'withdrawn');
    else if (effectiveSold !== 'everything') dbQuery = dbQuery.or('status.eq.available,status.eq.unsold,status.is.null');

    // ── Hard filters: price, location, tenure, beds — things the user definitely wants to constrain ──
    if (sqParsed.filters.tenure) dbQuery = dbQuery.ilike('tenure', sqParsed.filters.tenure);
    if (sqParsed.filters.maxPrice) dbQuery = dbQuery.lte('price', sqParsed.filters.maxPrice);
    if (sqParsed.filters.minPrice) dbQuery = dbQuery.gte('price', sqParsed.filters.minPrice);
    if (sqParsed.filters.beds) dbQuery = dbQuery.gte('beds', sqParsed.filters.beds);
    if (sqParsed.filters.condition) dbQuery = dbQuery.in('condition', sqParsed.filters.condition);

    // Location: address ILIKE for city/town names
    for (const loc of sqParsed.locationTerms) {
      dbQuery = dbQuery.ilike('address', `%${loc}%`);
    }
    // Region: postcode prefix matching (e.g. "South West" → BS, BA, EX, GL, PL, etc.)
    if (sqParsed.filters.regionPostcodes) {
      const pcOr = sqParsed.filters.regionPostcodes.map(p => `postcode.ilike.${p}%`).join(',');
      dbQuery = dbQuery.or(pcOr);
    }

    // ── Concept-based broadening — build OR conditions for semantic intent ──
    const conceptOrClauses = [];
    for (const concept of sqParsed.concepts) {
      if (concept === 'multi_unit_freehold') {
        // A "block of flats" could be listed as any prop_type, but will have units > 1 or
        // mention flats/apartments in search_text. Tenure freehold is handled as hard filter above.
        conceptOrClauses.push('units.gt.1');
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('search_text.ilike.%flats%');
        conceptOrClauses.push('search_text.ilike.%apartments%');
        conceptOrClauses.push('search_text.ilike.%block%');
        conceptOrClauses.push('search_text.ilike.%units%');
        conceptOrClauses.push('prop_type.eq.flat');
      } else if (concept === 'title_split_potential') {
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('units.gt.1');
        conceptOrClauses.push('search_text.ilike.%title split%');
        conceptOrClauses.push('search_text.ilike.%flats%');
        conceptOrClauses.push('search_text.ilike.%block%');
      } else if (concept === 'hmo_conversion') {
        conceptOrClauses.push('search_text.ilike.%hmo%');
        conceptOrClauses.push('beds.gte.4');
        conceptOrClauses.push('search_text.ilike.%conversion%');
      } else if (concept === 'development') {
        conceptOrClauses.push('search_text.ilike.%development%');
        conceptOrClauses.push('search_text.ilike.%planning%');
        conceptOrClauses.push('prop_type.eq.land');
        conceptOrClauses.push('deal_type.ilike.%development%');
      } else if (concept === 'flip') {
        conceptOrClauses.push('condition.in.(needs work,poor)');
        conceptOrClauses.push('below_market.gt.10');
        conceptOrClauses.push('search_text.ilike.%modernisation%');
        conceptOrClauses.push('search_text.ilike.%refurb%');
      } else if (concept === 'buy_to_let') {
        conceptOrClauses.push('est_gross_yield.gt.5');
        conceptOrClauses.push('search_text.ilike.%tenant%');
        conceptOrClauses.push('search_text.ilike.%rental%');
        conceptOrClauses.push('search_text.ilike.%let%');
      } else if (concept === 'deal_stack') {
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('condition.in.(needs work,poor)');
        conceptOrClauses.push('below_market.gt.15');
      }
    }

    // ── Soft filters — OR-based signals that widen the net, not hard constraints ──
    // These get added to the concept OR clauses so the DB returns candidates matching ANY signal
    const softOrClauses = [];
    if (sqParsed.softFilters.title_split) softOrClauses.push('title_split.eq.true', 'search_text.ilike.%title split%', 'units.gt.1');
    if (sqParsed.softFilters.vacant) softOrClauses.push('vacant.eq.true', 'search_text.ilike.%vacant%');
    if (sqParsed.softFilters.prop_type) softOrClauses.push(`prop_type.eq.${sqParsed.softFilters.prop_type}`, `search_text.ilike.%${sqParsed.softFilters.prop_type}%`);
    if (sqParsed.softFilters.condition) {
      softOrClauses.push(`condition.in.(${sqParsed.softFilters.condition.join(',')})`);
      softOrClauses.push('search_text.ilike.%refurb%', 'search_text.ilike.%modernisation%');
    }

    // Combine concept + soft clauses into one big OR
    const allOrClauses = [...conceptOrClauses, ...softOrClauses];
    if (allOrClauses.length > 0) {
      dbQuery = dbQuery.or(allOrClauses.join(','));
    }

    // Full-text search for remaining unstructured terms (use OR not AND for broader results)
    if (sqParsed.freeText.length > 0) {
      const tsTerms = sqParsed.freeText.map(t => t.replace(/[^a-z0-9]/gi, '')).filter(Boolean);
      if (tsTerms.length) dbQuery = dbQuery.textSearch('search_vector', tsTerms.join(' | '));
    }

    // Sort by yield if requested, otherwise by score
    const sortCol = sqParsed.filters.sortBy === 'yield' ? 'est_gross_yield' : 'score';
    dbQuery = dbQuery.order(sortCol, { ascending: false, nullsFirst: false }).limit(500);
    const { data: lotRows, error: lotErr } = await dbQuery;

    // ── Also include persisted unsold lots from expired catalogues (30-day window) ──
    let unsoldExtra = [];
    if (effectiveSold === 'unsold' || effectiveSold === 'all' || sf === 'everything') {
      const unsoldCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      let unsoldQuery = supabase.from('lots').select(LOTS_SELECT)
        .in('status', ['unsold', 'withdrawn'])
        .gte('auction_date', unsoldCutoff);
      // Apply same hard filters to unsold lots
      if (sqParsed.filters.tenure) unsoldQuery = unsoldQuery.ilike('tenure', sqParsed.filters.tenure);
      if (sqParsed.filters.maxPrice) unsoldQuery = unsoldQuery.lte('price', sqParsed.filters.maxPrice);
      if (sqParsed.filters.minPrice) unsoldQuery = unsoldQuery.gte('price', sqParsed.filters.minPrice);
      for (const loc of sqParsed.locationTerms) unsoldQuery = unsoldQuery.ilike('address', `%${loc}%`);
      if (sqParsed.filters.regionPostcodes) unsoldQuery = unsoldQuery.or(sqParsed.filters.regionPostcodes.map(p => `postcode.ilike.${p}%`).join(','));
      // Apply same concept/soft OR clauses
      if (allOrClauses.length > 0) unsoldQuery = unsoldQuery.or(allOrClauses.join(','));
      unsoldQuery = unsoldQuery.order(sortCol, { ascending: false, nullsFirst: false }).limit(200);
      const { data: unsoldRows } = await unsoldQuery;
      unsoldExtra = unsoldRows || [];
    }

    if (lotErr) {
      log.error('smart-search lots query failed', { error: lotErr.message });
      return res.status(500).json({ error: 'db_error', message: 'Database query failed.' });
    }

    // Merge active + persisted unsold, dedup by URL
    const allRows = [...(lotRows || []).map(dbRowToFrontendLot), ...unsoldExtra.map(dbRowToFrontendLot)];
    const dedupMap = new Map();
    for (const lot of allRows) {
      const key = lot.url || `${lot._house}|${(lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').trim()}`;
      const existing = dedupMap.get(key);
      if (existing) {
        const richness = l => (l.score || 0) * 10 + (l.imageUrl ? 5 : 0) + (l.bullets?.length || 0);
        if (richness(lot) > richness(existing)) dedupMap.set(key, lot);
      } else {
        dedupMap.set(key, lot);
      }
    }
    const filteredLots = [...dedupMap.values()];

    // Build sources summary
    const sourceMap = new Map();
    for (const lot of filteredLots) {
      if (!sourceMap.has(lot._sourceUrl)) sourceMap.set(lot._sourceUrl, { house: lot._house, url: lot._sourceUrl, count: 0 });
      sourceMap.get(lot._sourceUrl).count++;
    }
    const sources = [...sourceMap.values()];

    const totalSearched = filteredLots.length;
    log.info('smart-search layer1', { query, columnFilters: sqParsed.filters, softFilters: sqParsed.softFilters, concepts: sqParsed.concepts, locations: sqParsed.locationTerms, freeText: sqParsed.freeText, results: totalSearched });

    // ═══════════════════════════════════════════════════════════
    // LAYER 2: Send matching lots' search_text to Gemini
    // ═══════════════════════════════════════════════════════════
    // If column filters narrowed to 0, return early
    if (filteredLots.length === 0) {
      await incrementSearchCounter();
      const filterDesc = [
        ...sqParsed.locationTerms,
        sqParsed.softFilters.title_split ? 'title split' : '',
        sqParsed.softFilters.vacant ? 'vacant' : '',
        sqParsed.filters.tenure || '',
        sqParsed.softFilters.prop_type || '',
        sqParsed.filters.maxPrice ? `under £${sqParsed.filters.maxPrice.toLocaleString()}` : '',
        ...sqParsed.freeText,
        ...sqParsed.concepts.map(c => c.replace(/_/g, ' ')),
      ].filter(Boolean).join(', ');
      return res.json({ results: [], report: `No lots found matching: ${filterDesc}. Try broadening your search.`, sources: [], totalSearched: 0, searchesUsed, searchLimit });
    }

    // Always send to Gemini — even small sets benefit from investment commentary
    // Cap at 200 lots for Gemini context
    const geminiLots = filteredLots.slice(0, 200);
    const lotSummaries = geminiLots.map((l, i) => {
      const meta = [
        l.status && l.status !== 'available' ? `STATUS:${l.status}` : '',
        l.propType ? `Type:${l.propType}` : '',
        l.tenure ? `Tenure:${l.tenure}` : '',
        l.beds ? `${l.beds}bed` : '',
        l.condition ? `Cond:${l.condition}` : '',
        l.estGrossYield ? `Yield:${l.estGrossYield}%` : '',
        l.belowMarket ? `${l.belowMarket}%belowMkt` : '',
        l.vacant ? 'VACANT' : '',
        l.titleSplit ? 'TITLE_SPLIT' : '',
      ].filter(Boolean).join(' ');
      const context = (l._searchText || '').substring(0, 500);
      return `[${i}] ${l._house} L${l.lot}: ${l.address} | £${l.price || '?'} | Score:${l.score || 0} | ${meta} | ${context}`;
    }).join('\n');

    const soldInstruction = sf === 'available' ? '\nIMPORTANT: Showing only available (unsold) lots.' :
      sf === 'sold' ? '\nIMPORTANT: Showing sold/STC/withdrawn lots only.' :
      sf === 'unsold' ? '\nIMPORTANT: Showing unsold (failed at auction) lots only.' : '';

    // Build filter description for Gemini context
    const appliedFilters = [
      ...sqParsed.locationTerms.map(l => `location: ${l}`),
      sqParsed.filters.regionName ? `region: ${sqParsed.filters.regionName}` : '',
      sqParsed.softFilters.title_split ? 'title split potential (soft)' : '',
      sqParsed.softFilters.vacant ? 'vacant (soft)' : '',
      sqParsed.filters.tenure ? `tenure: ${sqParsed.filters.tenure}` : '',
      sqParsed.softFilters.prop_type ? `type: ${sqParsed.softFilters.prop_type} (soft)` : '',
      sqParsed.filters.beds ? `${sqParsed.filters.beds}+ beds` : '',
      sqParsed.filters.maxPrice ? `under £${sqParsed.filters.maxPrice.toLocaleString()}` : '',
      sqParsed.filters.minPrice ? `over £${sqParsed.filters.minPrice.toLocaleString()}` : '',
      (sqParsed.softFilters.condition || sqParsed.filters.condition) ? `condition: ${(sqParsed.softFilters.condition || sqParsed.filters.condition).join('/')}` : '',
      ...sqParsed.freeText.map(t => `keyword: ${t}`),
      ...sqParsed.concepts.map(c => `concept: ${c.replace(/_/g, ' ')}`),
    ].filter(Boolean);
    const filterNote = appliedFilters.length ? `\nDatabase pre-filters applied: ${appliedFilters.join(', ')}` : '';

    // Build concept explanation for Gemini
    const conceptExplanations = {
      multi_unit_freehold: 'The user wants freehold buildings containing multiple flats/units that could be sold individually — look for blocks of flats, multi-unit properties, properties with 2+ units.',
      title_split_potential: 'The user wants properties where individual units could be split onto separate titles — look for multi-unit freehold properties, blocks of flats, houses converted to flats.',
      hmo_conversion: 'The user wants properties suitable for conversion to Houses in Multiple Occupation — look for large houses (4+ beds), existing HMOs, properties with conversion potential.',
      development: 'The user wants development opportunities — look for land, properties with planning permission, sites with development potential.',
      flip: 'The user wants properties to buy, refurbish, and sell quickly — look for below market value properties in poor condition with good locations.',
      buy_to_let: 'The user wants rental investment properties — look for good yields, existing tenancies, properties in rental demand areas.',
      deal_stack: 'The user wants properties with multiple value-add angles — look for title split potential combined with refurbishment needs and below market value.',
    };
    const conceptNote = sqParsed.concepts.length > 0
      ? '\n\nSEARCH CONCEPTS:\n' + sqParsed.concepts.map(c => `- ${conceptExplanations[c] || c}`).join('\n')
      : '';

    const responseText = await callAI(`You are a UK property investment analyst. A user has searched across auction lots and the database returned ${totalSearched} candidate lots (showing top ${geminiLots.length} by score).${soldInstruction}${filterNote}${conceptNote}

Their search query: "${query}"

These lots were retrieved using broad matching to avoid missing relevant results. Your job is to:
1. CAREFULLY rank and select lots that genuinely match the user's intent — read the search_text context for each lot
2. Be generous but not indiscriminate — include lots that COULD match even if not perfectly tagged
3. Write a brief investment report (2-3 paragraphs) with actionable insights

Lots (broad database matches, sorted by score):
${lotSummaries}

Respond in this exact JSON format:
{"indices":[0,5,12],"report":"Your report here..."}

Return the indices of the best matching lots. If few lots match well, that's fine — quality over quantity. Focus your report on investment insights specific to the user's search intent.`, { tier: 'fast', maxTokens: 4000, taskType: 'search' });
    log.info('smart_search_full', { tier: 'fast', preFiltered: totalSearched, sentToAI: geminiLots.length });

    let aiParsed;
    try {
      let cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      aiParsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
    } catch (e) {
      console.log('Smart search JSON parse failed:', e.message, 'Raw:', responseText.substring(0, 200));
      const reportMatch = responseText.match(/"report"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      const indicesMatch = responseText.match(/"indices"\s*:\s*\[([\d,\s]*)\]/);
      aiParsed = {
        indices: indicesMatch ? indicesMatch[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) : [],
        report: reportMatch ? reportMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : 'Search completed.'
      };
    }

    let matchingLots = (aiParsed.indices || [])
      .filter(i => i >= 0 && i < geminiLots.length)
      .map(i => geminiLots[i]);

    // Fallback: if Gemini returned nothing, return all pre-filtered lots (they already match)
    if (matchingLots.length === 0) {
      matchingLots = geminiLots;
      log.info('smart-search ai-empty-fallback', { returning: matchingLots.length });
      if (!aiParsed.report || aiParsed.report === 'Search completed.') {
        aiParsed.report = `Found ${totalSearched} lot${totalSearched !== 1 ? 's' : ''} matching "${query}". Sorted by investment score.`;
      }
    }

    // Strip _searchText from response (large, not needed by frontend)
    for (const lot of matchingLots) delete lot._searchText;

    await incrementSearchCounter();
    logActivityEvent('smart_search', { query, results_count: matchingLots.length, mode: 'db_plus_ai', preFiltered: totalSearched }, user?.email, getClientIP(req));

    return res.json({
      results: matchingLots,
      report: aiParsed.report || '',
      sources, totalSearched, searchesUsed, searchLimit,
    });
  } catch (err) {
    const msg = err.message || String(err);
    log.error('Smart search error', { error: msg, status: err.status, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
    if (err.status === 429 || /quota|rate.limit|resource.exhausted/i.test(msg)) {
      setCreditExhausted(true); setCreditExhaustedAt(Date.now());
      return res.status(503).json({ error: 'ai_quota_exhausted', message: 'AI rate limit hit. Auto-resets after 1 hour.', provider: process.env.AI_PROVIDER || 'gemini', tier: 'fast' });
    }
    if (err.status === 401 || err.status === 403 || /invalid.api.key|unauthorized|forbidden/i.test(msg)) {
      return res.status(500).json({ error: 'key_invalid', message: 'AI API key is invalid or expired. Check environment variables in Railway.', provider: process.env.AI_PROVIDER || 'gemini' });
    }
    return res.status(500).json({ error: 'api_error', message: 'Smart search failed.', detail: msg, provider: process.env.AI_PROVIDER || 'gemini', tier: 'fast' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN: Cache Status & Manual Refresh
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// API: ALL LOTS — pre-load every cached lot for frontend filtering
// ═══════════════════════════════════════════════════════════════
app.get('/api/all-lots', rateLimit(60000, 30), async (req, res) => {
  try {
    if (!supabase) return res.json({ lots: [], sources: [], stripeEnabled: STRIPE_ENABLED });

    const includePast = req.query.includePast === 'true';
    const user = await validateUserFromReq(req);

    // ── Step 1: Get active catalogue URLs from cached_analyses ──
    const { data: activeCatalogues } = await supabase
      .from('cached_analyses')
      .select('url, house, created_at')
      .gt('expires_at', new Date().toISOString());

    if (!activeCatalogues || activeCatalogues.length === 0) return res.json({ lots: [], sources: [], stripeEnabled: STRIPE_ENABLED });

    const activeUrls = [...new Set(activeCatalogues.map(c => normaliseUrl(c.url)))];

    // ── Step 2: Query individual lots via RPC (returns JSON blob — bypasses PostgREST row limit) ──
    const { data: lotRows, error: lotErr } = await supabase.rpc('get_active_lots');

    if (lotErr) {
      log.error('all-lots: get_active_lots RPC failed', { error: lotErr.message });
      return res.json({ lots: [], sources: [], stripeEnabled: STRIPE_ENABLED });
    }

    if (!lotRows || lotRows.length === 0) {
      return res.json({ lots: [], sources: [], stripeEnabled: STRIPE_ENABLED });
    }

    // ── Step 2b: Include persisted unsold lots from expired catalogues (30-day window) ──
    // This is a key Phase 4 benefit — unsold lots stay visible even after catalogue expires
    const unsoldCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: unsoldRows } = await supabase
      .from('lots')
      .select('*')
      .in('status', ['unsold', 'withdrawn'])
      .gte('auction_date', unsoldCutoff.slice(0, 10))
      .limit(1000);

    // Merge unsold lots, avoiding duplicates with active catalogue lots
    const activeLotKeys = new Set((lotRows || []).map(r => `${r.house}|${r.url}`));
    const extraUnsold = (unsoldRows || []).filter(r => !activeLotKeys.has(`${r.house}|${r.url}`));

    const allLotRows = [...(lotRows || []), ...extraUnsold];
    const rawTotal = allLotRows.length;
    log.info('all-lots query', { activeCatalogues: activeCatalogues.length, activeLots: (lotRows || []).length, persistedUnsold: extraUnsold.length, rawLotCount: rawTotal });

    // ── Step 3: Map snake_case DB columns → camelCase frontend format ──
    const lots = allLotRows.map(r => ({
      _house: r.house,
      lot: r.lot_number,
      url: r.url,
      _sourceUrl: r.catalogue_url,
      address: r.address,
      postcode: r.postcode,
      price: r.price,
      priceText: r.price_text,
      propType: r.prop_type,
      beds: r.beds,
      tenure: r.tenure,
      leaseLength: r.lease_length,
      sqft: r.sqft,
      condition: r.condition,
      imageUrl: r.image_url,
      bullets: r.bullets || [],
      units: r.units || 0,
      _auctionDate: r.auction_date,
      status: r.status,
      soldPrice: r.sold_price,
      epcRating: r.epc_rating,
      epcScore: r.epc_score,
      epcDate: r.epc_date,
      floodZone: r.flood_zone,
      floodRiskLevel: r.flood_risk,
      streetAvg: r.street_avg,
      streetSales: r.street_sales,
      streetSalesCount: r.street_sales_count,
      belowMarket: r.below_market,
      estMonthlyRent: r.est_monthly_rent,
      estAnnualRent: r.est_annual_rent,
      estGrossYield: r.est_gross_yield != null ? parseFloat(r.est_gross_yield) : null,
      score: r.score != null ? parseFloat(r.score) : null,
      scoreBreakdown: r.score_breakdown || [],
      opps: r.opps || [],
      risks: r.risks || [],
      dealType: r.deal_type,
      vacant: r.vacant,
      titleSplit: r.title_split,
    }));

    // Normalise statuses + extract lease length from bullets (handles edge cases)
    normaliseLotStatuses(lots);

    // Within-house address dedup (URL dedup handled by lots table unique constraint)
    // Group by house for address dedup (same logic as before, just no URL dedup needed)
    const lotsByHouse = new Map();
    for (const lot of lots) {
      const h = lot._house;
      if (!lotsByHouse.has(h)) lotsByHouse.set(h, []);
      lotsByHouse.get(h).push(lot);
    }

    const dedupedAll = [];
    for (const [house, houseLots] of lotsByHouse) {
      const byAddr = new Map();
      for (const lot of houseLots) {
        const normAddr = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
        const addrKey = normAddr + '|' + (lot.price || '');
        if (normAddr.length > 5) {
          const existing = byAddr.get(addrKey);
          if (existing) {
            const richness = (l) => (l.imageUrl ? 10 : 0) + (l.bullets?.length || 0);
            if (richness(lot) > richness(existing)) byAddr.set(addrKey, lot);
          } else {
            byAddr.set(addrKey, lot);
          }
        } else {
          byAddr.set(`__short_${byAddr.size}`, lot);
        }
      }
      const deduped = [...byAddr.values()];
      const removed = houseLots.length - deduped.length;
      if (removed > 0) console.log(`Dedup ${house}: ${houseLots.length} → ${deduped.length} (removed ${removed})`);
      dedupedAll.push(...deduped);
    }

    // Build sources array — one entry per catalogue (matches old cached_analyses behavior)
    const sources = [];
    const catalogueUpdatedAt = new Map(activeCatalogues.map(c => [normaliseUrl(c.url), c.created_at]));
    const lotsByCatalogue = new Map();
    for (const lot of dedupedAll) {
      const catUrl = lot._sourceUrl;
      if (!lotsByCatalogue.has(catUrl)) lotsByCatalogue.set(catUrl, { house: lot._house, count: 0 });
      lotsByCatalogue.get(catUrl).count++;
    }
    for (const [catUrl, info] of lotsByCatalogue) {
      sources.push({ house: info.house, url: catUrl, count: info.count, updatedAt: catalogueUpdatedAt.get(catUrl) });
    }

    // Replace lots array content with deduped results
    lots.length = 0;
    lots.push(...dedupedAll);

    // ── Attach _auctionDate from calendar (DB + fallback) ──
    const urlDateMap = {};
    // Load from database calendar first
    try {
      const { data: calRows } = await supabase.from('auction_calendar').select('url, date').gte('date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
      if (calRows) for (const a of calRows) {
        const nu = normaliseUrl(a.url);
        if (nu && a.date && (!urlDateMap[nu] || a.date < urlDateMap[nu])) urlDateMap[nu] = a.date;
      }
    } catch { /* fallback below */ }
    // Fallback calendar overlay
    for (const a of FALLBACK_CALENDAR) {
      const nu = normaliseUrl(a.url);
      if (!urlDateMap[nu] || a.date < urlDateMap[nu]) urlDateMap[nu] = a.date;
    }
    for (const lot of lots) {
      // Per-lot end date from bullets (EIG timed auctions) takes priority
      let lotEndDate = null;
      if (lot.bullets && Array.isArray(lot.bullets)) {
        for (const b of lot.bullets) {
          const m = b.match(/Auction\s*Ends?:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
          if (m) { lotEndDate = m[3] + '-' + m[2] + '-' + m[1]; break; }
        }
      }
      if (lotEndDate) {
        lot._auctionDate = lotEndDate;
      } else if (!lot._auctionDate) {
        // Fallback to calendar lookup only if lots table didn't have a date
        const su = normaliseUrl(lot._sourceUrl);
        const rawDate = urlDateMap[su] || null;
        lot._auctionDate = (rawDate && rawDate > '2098-01-01') ? null : rawDate;
      }
    }

    // ── Server-side future-only filtering (7-day grace period) ──
    if (!includePast) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const beforeFilter = lots.length;
      const filtered = lots.filter(lot => {
        if (!lot._auctionDate) return true; // Include lots with no date
        return lot._auctionDate >= cutoffStr;
      });
      const pastRemoved = beforeFilter - filtered.length;
      if (pastRemoved > 0) console.log(`Future-only filter: removed ${pastRemoved} past lots (cutoff: ${cutoffStr})`);
      lots.length = 0;
      lots.push(...filtered);
    }

    // ── Phase 3: Cross-auction dedup by normalised address (same house only) ──
    // Only dedup lots listed by the SAME house at different auction dates (e.g., timed vs live)
    // Cross-house duplicates are kept — users want to see the same property from different houses
    const crossAddrMap = new Map();
    for (const lot of lots) {
      const normAddr = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
      if (normAddr.length <= 5) continue;
      const houseAddr = `${lot._house}|${normAddr}`;
      const entry = crossAddrMap.get(houseAddr);
      if (entry) {
        entry.count++;
        const entryDate = entry.lot._auctionDate || '9999-12-31';
        const lotDate = lot._auctionDate || '9999-12-31';
        if (lotDate < entryDate) entry.lot = lot;
      } else {
        crossAddrMap.set(houseAddr, { lot, count: 1 });
      }
    }
    const keptLots = new Set();
    const dupAddrs = new Set();
    for (const [key, entry] of crossAddrMap) {
      keptLots.add(entry.lot);
      if (entry.count > 1) dupAddrs.add(key);
    }
    const beforeCross = lots.length;
    const finalLots = lots.filter(l => {
      const normAddr = (l.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
      if (normAddr.length <= 5) { l._alsoInFutureAuctions = false; return true; }
      const houseAddr = `${l._house}|${normAddr}`;
      if (keptLots.has(l)) { l._alsoInFutureAuctions = dupAddrs.has(houseAddr); return true; }
      return false;
    });
    const crossRemoved = beforeCross - finalLots.length;
    if (crossRemoved > 0) console.log(`Cross-auction dedup: removed ${crossRemoved} duplicate lots (same house, different dates)`);

    // Sanitise junk lots — remove non-property entries (email addresses, field labels, etc.)
    const junkAddr = /^(enquiries|info|sales|contact|admin|hello)@|^£[\d,]+|^Properties?$/i;
    const junkAddr2 = /^(Lot|View|More|See|Click|Browse)\s|^Property Type$/i;
    const beforeJunkLot = finalLots.length;
    const cleanLots = finalLots.filter(l => {
      const addr = (l.address || '').trim();
      if (addr.length < 5) return false;
      if (junkAddr.test(addr) || junkAddr2.test(addr)) return false;
      return true;
    });
    const junkLotRemoved = beforeJunkLot - cleanLots.length;
    if (junkLotRemoved > 0) console.log(`Lot sanitiser: removed ${junkLotRemoved} junk lots (non-property entries)`);

    // Sanitise image URLs — strip junk images (logos, council branding, ad trackers, placeholders)
    const junkImg = /logo|icon|\.svg|favicon|banner|flannels|kirklees|\brdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|spacer|pixel|1x1|placeholder|no-image|noimage|spinner|badge|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\./i;
    let imgStripped = 0;
    for (const lot of cleanLots) {
      if (lot.imageUrl && junkImg.test(lot.imageUrl)) { lot.imageUrl = undefined; imgStripped++; }
    }
    if (imgStripped > 0) console.log(`Image sanitiser: stripped ${imgStripped} junk images`);

    // Validate image URLs — must be https + known extension or CDN domain
    let imgInvalid = 0;
    for (const lot of cleanLots) {
      if (lot.imageUrl && !isValidImageUrl(lot.imageUrl)) { lot.imageUrl = undefined; imgInvalid++; }
    }
    if (imgInvalid > 0) console.log(`Image validator: rejected ${imgInvalid} invalid image URLs`);

    // Ensure every lot has a URL — fallback to catalogue page if no lot-specific link
    for (const lot of cleanLots) {
      if (!lot.url && lot._sourceUrl) lot.url = lot._sourceUrl;
    }

    // ── Diagnostic: pipeline summary ──
    log.info('all-lots pipeline', {
      rawFromDb: rawTotal,
      afterAddressDedup: dedupedAll.length,
      afterCrossAuctionDedup: finalLots.length,
      afterJunkRemoval: cleanLots.length,
      junkRemoved: junkLotRemoved,
      imgStripped
    });

    // ── Post-processing enrichment fixes ──
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const lot of cleanLots) {
      // 1. Auto-reclassify past-auction lots as "unsold" if still "available"
      if (lot._auctionDate && lot._auctionDate < todayStr &&
          (!lot.status || lot.status === 'available')) {
        lot.status = 'unsold';
      }

      // 2. Structural risk flag for ultra-low prices
      if (lot.price && lot.price < 25000 && lot.propType !== 'land' && lot.propType !== 'other') {
        if (!lot.risks) lot.risks = [];
        if (!lot.risks.some(r => /low.*price|significant works/i.test(r))) {
          lot.risks.push('Very low guide — likely significant works required');
        }
      }

      // 3. Infer propType from address/title when "other" or "unknown"
      if (!lot.propType || lot.propType === 'other' || lot.propType === 'unknown') {
        const addr = (lot.address || '').toLowerCase();
        if (/\bflat\b|\bapt\b|\bapartment\b/.test(addr)) lot.propType = 'flat';
        else if (/\bhouse\b|\bcottage\b|\bvilla\b|\blodge\b/.test(addr)) lot.propType = 'house';
        else if (/\bbungalow\b/.test(addr)) lot.propType = 'house';
        else if (/\bland\b|\bplot\b|\bgarage\b|\bparking\b|\bkiosk\b/.test(addr)) lot.propType = 'land';
        else if (/\bshop\b|\boffice\b|\bwarehouse\b|\bindustrial\b|\bhotel\b|\bpub\b/.test(addr)) lot.propType = 'commercial';
      }

      // 4. Mark fallback rent estimates so they're not confused with real data
      if (lot.estAnnualRent && lot.estMonthlyRent) {
        const defaultRent = Math.round(825 * 1.10); // VOA_RENTS._default[2] * RENT_UPLIFT._default
        if (lot.estMonthlyRent === defaultRent && !lot.beds) {
          lot._rentEstimated = true; // Signal to frontend this is a generic estimate
        }
      }

      // 5. Freehold opp tag for residential if not already present
      if (lot.tenure === 'Freehold' && ['house', 'bungalow'].includes(lot.propType)) {
        if (lot.opps && !lot.opps.includes('Freehold')) lot.opps.push('Freehold');
      }

      // 6. Days since auction failed (for unsold lots)
      if (lot.status === 'unsold' && lot._auctionDate) {
        const auctionMs = new Date(lot._auctionDate).getTime();
        if (!isNaN(auctionMs)) {
          lot.daysSinceAuction = Math.floor((Date.now() - auctionMs) / 86400000);
        }
      }
    }

    // 7. High-turnover block warning — flag addresses where same building has many sales
    const streetCounts = {};
    for (const lot of cleanLots) {
      if (!lot.streetSalesCount) continue;
      // Group by building/block — use first line of address (e.g. "123 High Street")
      const addr = (lot.address || '').split(',')[0].trim().toLowerCase();
      if (!addr) continue;
      // Extract building name/number pattern
      const buildingMatch = addr.match(/^(.+?)(?:\s+flat\s+\d+|\s+apartment\s+\d+)?$/i);
      const building = buildingMatch ? buildingMatch[1] : addr;
      if (!streetCounts[building]) streetCounts[building] = { count: 0, lots: [] };
      streetCounts[building].count += lot.streetSalesCount;
      streetCounts[building].lots.push(lot);
    }
    for (const [building, data] of Object.entries(streetCounts)) {
      if (data.count > 8) {
        for (const lot of data.lots) {
          if (!lot.risks) lot.risks = [];
          if (!lot.risks.some(r => /high.?turnover/i.test(r))) {
            lot.risks.push(`High-turnover block (${data.count} sales nearby)`);
          }
        }
      }
    }

    // Directory data: free for all, but AI analysis layer requires signup
    // Anonymous users see address/price/image/house but not scores/opps/risks/dealType
    const adminToken = req.headers['x-admin-secret'] || '';
    const isAdmin = process.env.ADMIN_SECRET && safeCompare(adminToken, process.env.ADMIN_SECRET);
    const isSignedIn = !!user || isAdmin;
    if (!isSignedIn) {
      for (const lot of cleanLots) {
        lot.score = null;
        lot.opps = [];
        lot.risks = [];
        lot.scoreBreakdown = [];
        lot.dealType = null;
        lot.condition = null;
        lot.vacant = null;
        lot.titleSplit = null;
        lot.estGrossYield = null;
        lot.anonGated = true;   // Signal to frontend to show signup prompt
        delete lot.blurred;
      }
    } else {
      for (const lot of cleanLots) { delete lot.blurred; }
    }
    // ── Load house logos from house_skills ──
    const uniqueHouses = new Set(sources.map(s => s.house));
    let houseMeta = {};
    try {
      const { data: skills } = await supabase
        .from('house_skills')
        .select('slug, logo_url')
        .not('logo_url', 'is', null);
      if (skills) {
        for (const s of skills) houseMeta[s.slug] = { logoUrl: s.logo_url };
      }
    } catch { /* non-fatal */ }

    res.json({
      lots: cleanLots,
      sources,
      houseMeta,
      houseCount: uniqueHouses.size,
      blurred: false,
      anonGated: !isSignedIn,
      stripeEnabled: STRIPE_ENABLED,
      _debug: {
        activeCatalogues: activeCatalogues.length,
        rawLotCount: rawTotal,
        afterAddressDedup: lots.length,
        afterCrossAuctionDedup: finalLots.length,
        afterJunkRemoval: cleanLots.length,
        source: 'lots_table'
      }
    });
  } catch (e) {
    log.error('All lots error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/cache-status', async (req, res) => {
  // Require admin auth to prevent internal state leakage
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, created_at, expires_at, scraped_with, extracted_with, ai_tier, last_scraped_at')
      .order('house');

    const allAuctions = await getCalendarAuctions();
    const ready = allAuctions.filter(a => a.catalogueReady);
    const cachedUrls = new Set((cached || []).map(c => normaliseUrl(c.url)));

    const now = new Date().toISOString();
    const activeCached = (cached || []).filter(c => c.expires_at > now);
    const expiredCached = (cached || []).filter(c => c.expires_at <= now);
    const totalLots = (cached || []).reduce((s, c) => s + (c.total_lots || 0), 0);
    const activeLots = activeCached.reduce((s, c) => s + (c.total_lots || 0), 0);
    const expiredLots = expiredCached.reduce((s, c) => s + (c.total_lots || 0), 0);
    const missingRaw = ready.filter(a => !cachedUrls.has(normaliseUrl(a.url)));
    // Dedup missing entries by house+date so each auction appears once, not once per lot URL
    const missingMap = new Map();
    for (const a of missingRaw) {
      const key = `${a.house}::${a.date}`;
      if (!missingMap.has(key)) missingMap.set(key, a);
    }
    const missing = [...missingMap.values()];

    res.json({
      summary: {
        totalCached: (cached || []).length,
        activeCached: activeCached.length,
        expiredCached: expiredCached.length,
        totalReady: ready.length,
        totalLots,
        activeLots,
        expiredLots,
        missingCount: missing.length,
      },
      cached: (cached || []).map(c => ({ ...c, _expired: c.expires_at <= now })),
      missing: missing.map(a => ({ house: a.house, url: a.url, date: a.date, status: a.status || 'upcoming' })),
    });
  } catch (e) {
    log.error('Cache status error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/refresh-cache', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  res.json({ message: 'Auto-analysis triggered. Check server logs for progress.' });
  // Run async — don't block the response
  autoAnalyseAll().catch(e => console.error('Manual refresh failed:', e));
});

// Admin: backfill images for all cached catalogues (no AI tokens used)
app.post('/api/admin/backfill-images', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Get active catalogues (metadata only)
    const { data: activeCats } = await supabase
      .from('cached_analyses')
      .select('url, house')
      .gt('expires_at', new Date().toISOString());

    if (!activeCats || activeCats.length === 0) return res.json({ message: 'No cached catalogues found', results: [] });

    const results = [];
    for (const entry of activeCats) {
      // Read lots from lots table
      const { data: lotRows } = await supabase
        .from('lots')
        .select(LOTS_SELECT)
        .eq('catalogue_url', entry.url);
      const lots = (lotRows || []).map(dbRowToFrontendLot);
      const missingImages = lots.filter(l => !l.imageUrl).length;
      if (missingImages === 0) {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: 0, gained: 0, status: 'skipped — all have images' });
        continue;
      }

      let gained = 0;

      // Step 1: Plain HTTP backfill from catalogue page (works for server-rendered sites)
      const lotsWithUrl = lots.filter(l => l.url && !l.imageUrl).length;
      if (lotsWithUrl > 0) {
        const updated = await backfillImages(entry.url, lots);
        if (updated) {
          gained += updated.filter(l => l.imageUrl).length - (lots.length - missingImages);
        }
        // Step 2: Deep backfill from individual lot pages
        const stillMissing = lots.filter(l => l.url && !l.imageUrl).length;
        if (stillMissing > 0) {
          const deepGained = await backfillImagesFromLotPages(lots);
          gained += deepGained;
        }
      }

      // Step 3: Rendered backfill — try both engines for best coverage
      const stillNoImages = lots.filter(l => !l.imageUrl).length;
      if (stillNoImages > 0 && PUPPETEER_IMAGE_HOUSES.has(entry.house)) {
        // Pass 1: Firecrawl
        if (FIRECRAWL_API_KEY && !isFcCreditExhausted()) {
          gained += await backfillImagesWithFirecrawl(entry.url, lots, entry.house);
        }
        // Pass 2: Puppeteer for remaining
        const afterFc = lots.filter(l => !l.imageUrl).length;
        if (afterFc > 0 && puppeteer) {
          gained += await backfillImagesWithPuppeteer(entry.url, lots, entry.house);
        }
      }

      if (gained > 0) {
        // Write enriched lots back to lots table
        normaliseLotStatuses(lots);
        await upsertToLotsTable(lots, entry.house, entry.url, { scrapedWith: 'image-backfill' });
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: missingImages, gained, status: 'updated' });
      } else {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: missingImages, gained: 0, status: 'no matches found' });
      }
    }

    const totalGained = results.reduce((s, r) => s + r.gained, 0);
    res.json({ message: `Backfill complete. ${totalGained} images added across ${activeCats.length} catalogues.`, results });
  } catch (err) {
    log.error('Image backfill error', { error: err.message });
    res.status(500).json({ error: 'Image backfill failed. Check server logs.' });
  }
});

// Admin-only: clear cached analyses to force re-scrape
app.post('/api/admin/clear-cache', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const house = req.body?.house;
    let query;
    if (house) {
      query = supabase.from('cached_analyses').delete().eq('house', house);
    } else {
      query = supabase.from('cached_analyses').delete().neq('url', '');
    }
    const { data, error } = await query.select();
    if (error) throw error;

    const cleared = data ? data.length : 0;
    const houses = data ? [...new Set(data.map(r => r.house))].filter(Boolean) : [];
    log.info('Cache cleared', { house: house || 'ALL', cleared });
    res.json({
      message: house
        ? `Cache cleared for ${house}. ${cleared} entries deleted. Next autoAnalyseAll will re-scrape.`
        : `All cache cleared. ${cleared} entries deleted. Next autoAnalyseAll will re-scrape.`,
      cleared, houses,
    });
  } catch (err) {
    log.error('Cache clear error', { error: err.message });
    res.status(500).json({ error: 'Cache clear failed' });
  }
});

// Admin-only: rescrape a specific house (clear cache + trigger immediate re-analysis)
app.post('/api/admin/rescrape', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { house } = req.body || {};
  if (!house) return res.status(400).json({ error: 'house slug is required' });

  try {
    // 1. Delete cached data for this house
    const { data: deleted } = await supabase
      .from('cached_analyses')
      .delete()
      .eq('house', house)
      .select('url');
    const cleared = deleted ? deleted.length : 0;

    // 2. Find calendar URLs for this house to re-scrape
    const calendar = await getAuctionCalendar();
    const urls = calendar
      .filter(a => a.houseSlug === house || (a.house || '').toLowerCase().replace(/[^a-z]/g, '') === house)
      .map(a => a.url)
      .filter(Boolean);

    // Fallback to HOUSE_ROOTS if no calendar entries
    if (urls.length === 0 && HOUSE_ROOTS[house]) {
      urls.push(HOUSE_ROOTS[house]);
    }

    if (urls.length === 0) {
      return res.json({ message: `Cache cleared (${cleared} entries) but no URLs found to rescrape for ${house}`, cleared, urls: [] });
    }

    // 3. Trigger re-analysis in background (don't block response)
    res.json({ message: `Rescraping ${house}: cleared ${cleared} cached entries, now analysing ${urls.length} URL(s)`, cleared, urls });

    for (const url of urls) {
      try {
        await autoAnalyseOne(url);
      } catch (err) {
        log.error('Rescrape autoAnalyseOne error', { house, url, error: err.message });
      }
    }
    log.info('Rescrape complete', { house, urls: urls.length });
  } catch (err) {
    log.error('Rescrape error', { house, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Rescrape failed: ' + err.message });
  }
});

// Admin-only: GET broken extractors list
app.get('/api/admin/broken-extractors', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.json({
    broken: [...BROKEN_EXTRACTORS],
    count: BROKEN_EXTRACTORS.size,
  });
});

// Admin-only: POST enable/disable broken extractors
app.post('/api/admin/broken-extractors', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { house, action, reason } = req.body || {};
  if (!house || !action) {
    return res.status(400).json({ error: 'house and action (disable|enable) are required' });
  }

  if (action === 'disable') {
    BROKEN_EXTRACTORS.add(house);
    console.log(`BROKEN: Disabled extractor for ${house}${reason ? ': ' + reason : ''}`);

    // Persist to Supabase house_skills
    try {
      await supabase.from('house_skills')
        .update({ status: 'broken', notes: reason || 'Auto-disabled by audit' })
        .eq('slug', house);
    } catch (err) { console.warn('BROKEN: Failed to persist disable:', err.message); }

    // Pipeline alert
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'extractor_broken',
        severity: 'error',
        house,
        message: `Extractor disabled for ${HOUSE_DISPLAY_NAMES[house] || house}: ${reason || 'manual disable'}`,
      });
    } catch (err) { console.warn('BROKEN: Failed to send alert:', err.message); }

    res.json({ message: `Extractor for ${house} disabled`, broken: [...BROKEN_EXTRACTORS] });

  } else if (action === 'enable') {
    BROKEN_EXTRACTORS.delete(house);
    console.log(`BROKEN: Re-enabled extractor for ${house}`);

    // Persist to Supabase house_skills
    try {
      await supabase.from('house_skills')
        .update({ status: 'healthy', notes: 'Re-enabled after fix' })
        .eq('slug', house);
    } catch (err) { console.warn('BROKEN: Failed to persist enable:', err.message); }

    // Pipeline alert
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'extractor_fixed',
        severity: 'info',
        house,
        message: `Extractor re-enabled for ${HOUSE_DISPLAY_NAMES[house] || house}`,
      });
    } catch (err) { console.warn('BROKEN: Failed to send alert:', err.message); }

    res.json({ message: `Extractor for ${house} re-enabled`, broken: [...BROKEN_EXTRACTORS] });

  } else {
    res.status(400).json({ error: 'action must be "disable" or "enable"' });
  }
});

// Admin-only: test DOM extractor on a URL (diagnostics)
app.post('/api/admin/test-extractor', rateLimit(60000, 5), async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  const house = req.body.house || detectAuctionHouse(url);

  try {
    // Use Firecrawl+JSDOM (primary) or Puppeteer (fallback) to render the page
    const result = await scrapeRenderedPage(url, house);
    const html = result.html;
    const dom = new JSDOM(html, { url });
    const { document } = dom.window;

    // Check which CSS selectors match on the rendered page
    const test = sel => document.querySelectorAll(sel).length;
    const selectorMatches = {
      '.property-card': test('.property-card'), '.lot-card': test('.lot-card'),
      '.lot': test('.lot'), '.lot-panel': test('.lot-panel'),
      '.property-list-card': test('.property-list-card'), '.search-result': test('.search-result'),
      'article': test('article'), '.current-lots-single': test('.current-lots-single'),
      '.lot-item': test('.lot-item'), '[class*="property"]': test('[class*="property"]'),
      '[class*="lot"]': test('[class*="lot"]'), 'img[src]': test('img[src]'),
      'img[data-src]': test('img[data-src]'), '.swiper-slide img': test('.swiper-slide img'),
      '[data-mainpic]': test('[data-mainpic]'),
    };

    const pageTitle = document.title || '';
    dom.window.close();

    // Run the actual DOM extractor via JSDOM (pass Firecrawl images if available)
    const lots = extractWithJSDOM(html, house, url, result?.images);
    const hasImages = lots ? lots.filter(l => l.imageUrl).length : 0;
    const hasUrls = lots ? lots.filter(l => l.url && l.url !== '').length : 0;

    res.json({
      house, url, pageTitle,
      hasExtractor: !!DOM_EXTRACTORS[house],
      lotCount: lots ? lots.length : 0,
      lotsWithImages: hasImages,
      lotsWithUrls: hasUrls,
      sampleLots: lots ? lots.slice(0, 3) : [],
      selectorMatches,
      scrapedWith: FIRECRAWL_API_KEY && !isFcCreditExhausted() && !FIRECRAWL_SKIP.has(house) ? 'firecrawl' : (puppeteer ? 'puppeteer' : 'http'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, house });
  }
});

// Admin-only: analyse all catalogue-ready auctions
app.post('/api/analyse-all', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Trigger auto-analysis and wait for it to complete
  try {
    const result = await autoAnalyseAll();
    res.json(result);
  } catch (e) {
    log.error('Refresh cache error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Scrape only houses that have never been cached — much lighter than autoAnalyseAll
app.post('/api/analyse-new', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Get all catalogue-ready auctions
    const allAuctions = await getCalendarAuctions();
    const ready = allAuctions.filter(a => a.catalogueReady);

    // Get already-cached URLs
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('url');
    const cachedUrls = new Set((cached || []).map(c => normaliseUrl(c.url)));

    // Filter to only uncached
    const uncached = ready.filter(a => !cachedUrls.has(normaliseUrl(a.url)));

    // Dedup by house
    const byHouse = new Map();
    for (const a of uncached) {
      if (!byHouse.has(a.house)) byHouse.set(a.house, a);
    }
    const toScrape = [...byHouse.values()];

    log.info(`ANALYSE-NEW: ${toScrape.length} uncached houses to scrape (${ready.length} total ready, ${cachedUrls.size} cached)`);
    res.json({
      message: `Scraping ${toScrape.length} new houses in background`,
      houses: toScrape.map(a => a.house),
      total: toScrape.length,
    });

    // Run in background — process in parallel batches for speed
    // With probe skip for uncached houses, each only does 1 Firecrawl call.
    // Gemini rate limit is 15 RPM but DOM-extractor houses don't need Gemini.
    const CONCURRENCY = 5;
    let done = 0, failed = 0;
    for (let i = 0; i < toScrape.length; i += CONCURRENCY) {
      const batch = toScrape.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (auction, idx) => {
          const n = i + idx + 1;
          console.log(`ANALYSE-NEW: [${n}/${toScrape.length}] ${auction.house} — ${auction.url}`);
          await autoAnalyseOne(auction.url);
          return auction.house;
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') { done++; }
        else { failed++; console.error(`ANALYSE-NEW: ✗ failed: ${r.reason?.message || r.reason}`); }
      }
      // Brief pause between batches (autoAnalyseOne has its own Gemini rate limiting)
      if (i + CONCURRENCY < toScrape.length) await new Promise(r => setTimeout(r, 1000));
    }
    console.log(`ANALYSE-NEW COMPLETE: ${done} succeeded, ${failed} failed out of ${toScrape.length}`);
  } catch (e) {
    log.error('Analyse-new error', { error: e.message });
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════
app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, 'admin.html'));
});

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL
// ═══════════════════════════════════════════════════════════════
app.get('/welcome', (req, res) => {
  res.sendFile(join(__dirname, 'welcome.html'));
});

// ═══════════════════════════════════════════════════════════════
// LEGAL PAGES
// ═══════════════════════════════════════════════════════════════
app.get('/privacy', (req, res) => {
  res.sendFile(join(__dirname, 'privacy.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(join(__dirname, 'terms.html'));
});

// ═══════════════════════════════════════════════════════════════
// BRIDGEMATCH LITE
// ═══════════════════════════════════════════════════════════════
app.get('/check', (req, res) => {
  if (process.env.UMAMI_WEBSITE_ID) {
    try {
      let html = readFileSync(join(__dirname, 'bridgematch-lite.html'), 'utf-8');
      html = html.replace('data-website-id=""', `data-website-id="${process.env.UMAMI_WEBSITE_ID}"`);
      return res.type('html').send(html);
    } catch (e) { /* fall through to sendFile */ }
  }
  res.sendFile(join(__dirname, 'bridgematch-lite.html'));
});

app.get('/api/admin/daily-stats', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: events } = await supabase
      .from('activity_events')
      .select('action, detail, user_email')
      .gte('created_at', since);

    const rows = events || [];
    const analyses = rows.filter(r => r.action === 'analysis').length;
    const smart_searches = rows.filter(r => r.action === 'smart_search').length;
    const leads = rows.filter(r => r.action === 'lead_submit').length;
    const unique_users = new Set(rows.filter(r => r.user_email).map(r => r.user_email)).size;

    res.json({ analyses, smart_searches, leads, unique_users, total_events: rows.length });
  } catch (e) {
    log.error('Daily stats error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Per-house skill files (health dashboard) ──
app.get('/api/skills', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data, error } = await supabase.from('house_skills').select('*').order('slug');
    if (error) throw error;
    const skills = data || [];
    const healthy = skills.filter(s => s.status === 'healthy').length;
    const degraded = skills.filter(s => s.status === 'degraded').length;
    const broken = skills.filter(s => s.status === 'broken').length;
    res.json({ skills, summary: { total: skills.length, healthy, degraded, broken } });
  } catch (e) {
    log.error('Skills endpoint error', { error: e.message });
    res.json({ skills: [], summary: { total: 0, healthy: 0, degraded: 0, broken: 0 } });
  }
});

// ── AI cost monitoring endpoint ──
app.get('/api/admin/ai-costs', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const summary = getAICostSummary();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let byModel = [];
    const { data, error } = await supabase
      .from('ai_usage')
      .select('provider, model, tokens_in, tokens_out, est_cost')
      .gte('created_at', todayStart.toISOString());
    if (!error && data) {
      const groups = {};
      for (const row of data) {
        const key = `${row.provider}/${row.model}`;
        if (!groups[key]) groups[key] = { provider: row.provider, model: row.model, calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
        groups[key].calls++;
        groups[key].tokens_in += row.tokens_in || 0;
        groups[key].tokens_out += row.tokens_out || 0;
        groups[key].cost += parseFloat(row.est_cost) || 0;
      }
      byModel = Object.values(groups);
    }
    res.json({
      dailyTotal: summary.dailyCostTotal,
      budget: summary.budget,
      budgetExceeded: summary.budgetExceeded,
      callCount: summary.callCount,
      provider: summary.provider,
      byModel,
    });
  } catch (err) {
    console.error('AI costs endpoint error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Consolidated system health endpoint ──
app.get('/api/admin/system-health', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    // 1. Broken extractors
    const brokenExtractors = [...BROKEN_EXTRACTORS];

    // 2. AI costs
    const aiSummary = getAICostSummary();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let byModel = {};
    const { data: aiData } = await supabase
      .from('ai_usage')
      .select('provider, model, tokens_in, tokens_out, est_cost')
      .gte('created_at', todayStart.toISOString());
    if (aiData) {
      for (const row of aiData) {
        const key = `${row.provider}/${row.model}`;
        if (!byModel[key]) byModel[key] = { calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
        byModel[key].calls++;
        byModel[key].tokens_in += row.tokens_in || 0;
        byModel[key].tokens_out += row.tokens_out || 0;
        byModel[key].cost += parseFloat(row.est_cost) || 0;
      }
    }
    const aiCosts = {
      dailyTotal: aiSummary.dailyCostTotal,
      budget: aiSummary.budget,
      overBudget: aiSummary.budgetExceeded,
      byModel,
      callCount: aiSummary.callCount,
    };

    // 3. Coverage — per-house lot counts and image coverage
    const [{ data: cachedMeta }, { data: lotRows }, { data: skills }] = await Promise.all([
      supabase.from('cached_analyses').select('house, expires_at, created_at'),
      supabase.from('lots').select('house, image_url, beds'),
      supabase.from('house_skills').select('slug, status, last_scraped'),
    ]);

    const skillMap = {};
    if (skills) {
      for (const s of skills) skillMap[s.slug] = s;
    }

    const now = new Date();
    const houseMap = {};
    let totalLots = 0;
    let totalImages = 0;
    let totalLotsForImg = 0;

    // Build house metadata from cached_analyses (staleness, last scraped)
    if (cachedMeta) {
      for (const row of cachedMeta) {
        const slug = row.house;
        if (!houseMap[slug]) {
          houseMap[slug] = { slug, displayName: HOUSE_DISPLAY_NAMES[slug] || slug, lotCount: 0, imageCoverage: 0, bedCoverage: 0, status: 'active', lastScraped: null, _imgCount: 0, _lotCount: 0, _bedCount: 0, _hasExpiredCache: false };
        }
        const h = houseMap[slug];
        if (row.created_at && (!h.lastScraped || row.created_at > h.lastScraped)) {
          h.lastScraped = row.created_at;
        }
        if (row.expires_at && new Date(row.expires_at) < now) {
          h._hasExpiredCache = true;
        }
      }
    }

    // Build lot coverage from lots table
    if (lotRows) {
      for (const lot of lotRows) {
        const slug = lot.house;
        if (!houseMap[slug]) {
          houseMap[slug] = { slug, displayName: HOUSE_DISPLAY_NAMES[slug] || slug, lotCount: 0, imageCoverage: 0, bedCoverage: 0, status: 'active', lastScraped: null, _imgCount: 0, _lotCount: 0, _bedCount: 0, _hasExpiredCache: false };
        }
        const h = houseMap[slug];
        h.lotCount++;
        h._lotCount++;
        totalLots++;
        totalLotsForImg++;
        if (lot.image_url) { h._imgCount++; totalImages++; }
        if (lot.beds != null) { h._bedCount++; }
      }
    }

    // Mark stale only if cache expired AND no lots (evaluated after both loops)
    for (const h of Object.values(houseMap)) {
      if (h._hasExpiredCache && h.lotCount === 0) h.status = 'stale';
    }

    const houses = Object.values(houseMap).map(h => {
      const skill = skillMap[h.slug];
      if (skill && skill.status === 'broken') h.status = 'broken';
      if (skill && skill.last_scraped) h.lastScraped = skill.last_scraped;
      h.imageCoverage = h._lotCount > 0 ? Math.round(h._imgCount / h._lotCount * 100) : 0;
      h.bedCoverage = h._lotCount > 0 ? Math.round(h._bedCount / h._lotCount * 100) : 0;
      delete h._imgCount;
      delete h._bedCount;
      delete h._lotCount;
      delete h._hasExpiredCache;
      return h;
    });

    const activeHouses = houses.filter(h => h.status === 'active').length;
    const staleHouses = houses.filter(h => h.status === 'stale').length;

    const coverage = {
      houses,
      totalHouses: houses.length,
      activeHouses,
      staleHouses,
      totalLots,
      avgImageCoverage: totalLotsForImg > 0 ? Math.round(totalImages / totalLotsForImg * 100) : 0,
      avgBedCoverage: totalLots > 0 ? Math.round(houses.reduce((s, h) => s + (h.bedCoverage * h.lotCount / 100), 0) / totalLots * 100) : 0,
      lowBedCoverageHouses: houses.filter(h => h.lotCount > 5 && h.bedCoverage < 50).map(h => ({ slug: h.slug, lots: h.lotCount, bedCoverage: h.bedCoverage + '%' })),
    };

    // 4. Pipeline health
    const pipeline = {
      firecrawl: {
        status: isFcCreditExhausted() ? 'exhausted' : isFcTemporarilyDown() ? 'down' : 'ok',
        creditsUsed: getFcCreditsUsed(),
        creditBudget: getFirecrawlStatus().monthlyBudget,
        exhausted: isFcCreditExhausted(),
      },
      gemini: {
        status: getCreditExhausted() ? 'exhausted' : 'ok',
        exhausted: getCreditExhausted(),
        provider: process.env.AI_PROVIDER || 'gemini',
      },
      puppeteer: {
        status: puppeteer ? 'available' : 'unavailable',
        available: !!puppeteer,
      },
      autoAnalyse: {
        running: isAutoAnalysisRunning(),
        lastRun: null,
        nextRun: null,
      },
    };

    res.json({ brokenExtractors, aiCosts, coverage, pipeline });
  } catch (err) {
    console.error('System health endpoint error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Missing images admin endpoint ──
app.get('/api/admin/missing-images', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  try {
    const houseFilter = req.query.house || '';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    // Query lots table for lots missing images (from active catalogues)
    let lotQuery = supabase
      .from('lots')
      .select('house, lot_number, address, catalogue_url, auction_date, image_url')
      .or('image_url.is.null,image_url.eq.');

    if (houseFilter) {
      lotQuery = lotQuery.ilike('house', `%${houseFilter}%`);
    }

    // Filter to active catalogues at DB level + apply limit
    const { data: activeCats } = await supabase
      .from('cached_analyses')
      .select('url')
      .gte('expires_at', new Date().toISOString());
    const activeUrls = (activeCats || []).map(c => c.url);
    if (activeUrls.length > 0) {
      lotQuery = lotQuery.in('catalogue_url', activeUrls);
    }
    lotQuery = lotQuery.limit(2000);

    const { data: missingRows, error } = await lotQuery;
    if (error) throw error;

    const missingLots = [];
    const houseCounts = {};

    for (const row of (missingRows || [])) {
      missingLots.push({
        house: row.house,
        lotNumber: row.lot_number || null,
        address: row.address || '',
        catalogueUrl: row.catalogue_url,
        auctionDate: row.auction_date || null,
      });
      houseCounts[row.house] = (houseCounts[row.house] || 0) + 1;
    }

    // Apply pagination
    const paginated = missingLots.slice(offset, offset + limit);

    res.json({
      total: missingLots.length,
      houses: Object.keys(houseCounts).length,
      houseCounts,
      offset,
      limit,
      results: paginated,
    });
  } catch (e) {
    log.error('Missing images endpoint error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/cost-monitor', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: cached } = await supabase.from('cached_analyses').select('house, expires_at');
    const now = new Date();
    const houses = cached || [];
    const freshCount = houses.filter(h => h.expires_at && new Date(h.expires_at) > now).length;
    const SKIP_PUPPETEER_LIST = ['philliparnold','knightfrank'];
    res.json({
      weeklyEstimate: {
        geminiApiCalls: getApiCallCount(),
        estimatedCost: 0,
        creditExhausted: getCreditExhausted(),
        lastResetAt: getServerStartTime()
      },
      cacheStats: {
        totalHouses: houses.length,
        housesWithFreshCache: freshCount,
        housesWithStaleCache: houses.length - freshCount,
        contentHashHits: getHashHitCount()
      },
      firecrawl: {
        enabled: !!FIRECRAWL_API_KEY,
        ...getFirecrawlStatus(),
        skipHouses: [...FIRECRAWL_SKIP],
      },
      puppeteerSkipList: SKIP_PUPPETEER_LIST,
      puppeteerAvailable: !!puppeteer,
      lookaheadLimit: MAX_AUCTIONS_PER_HOUSE,
      pageCapLimit: MAX_PUPPETEER_PAGES,
      lotsCapLimit: MAX_LOTS_PER_SCRAPE
    });
  } catch (e) {
    log.error('Cost monitor error', { error: e.message });
    res.status(500).json({ error: 'Cost monitor failed. Check server logs.' });
  }
});

app.get('/api/quality-report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    // Get cache metadata (no lots JSONB) and lots from lots table
    const [{ data: cached }, { data: lotRows }] = await Promise.all([
      supabase.from('cached_analyses').select('house, url, expires_at, created_at, content_hash'),
      supabase.from('lots').select(LOTS_SELECT),
    ]);

    const now = new Date();
    const report = { houses: [], issues: [], summary: {} };
    let totalLots = 0, housesWithZero = 0, staleHouses = 0;

    // Group cache metadata by house
    const cacheByHouse = {};
    for (const row of (cached || [])) {
      const h = row.house || 'unknown';
      if (!cacheByHouse[h]) cacheByHouse[h] = { urls: [], isStale: true, created_at: null };
      cacheByHouse[h].urls.push(row.url);
      const isStale = row.expires_at && new Date(row.expires_at) < now;
      if (!isStale) cacheByHouse[h].isStale = false;
      if (!cacheByHouse[h].created_at || (row.created_at && new Date(row.created_at) > new Date(cacheByHouse[h].created_at))) {
        cacheByHouse[h].created_at = row.created_at;
      }
    }

    // Group lots by house
    const lotsByHouse = {};
    for (const row of (lotRows || [])) {
      const h = row.house || 'unknown';
      if (!lotsByHouse[h]) lotsByHouse[h] = [];
      lotsByHouse[h].push(row);
    }

    // Merge: all houses from cache metadata + any houses only in lots table
    const allHouses = new Set([...Object.keys(cacheByHouse), ...Object.keys(lotsByHouse)]);

    for (const house of allHouses) {
      const cache = cacheByHouse[house] || { urls: [], isStale: true, created_at: null };
      const rows = lotsByHouse[house] || [];
      const lots = rows.map(dbRowToFrontendLot);
      const isStale = cache.isStale;
      const ageHours = cache.created_at ? Math.round((now - new Date(cache.created_at)) / 3600000) : null;

      const withImage = lots.filter(l => l.imageUrl).length;
      const imgCoverage = lots.length ? Math.round((withImage / lots.length) * 100) : 0;

      totalLots += lots.length;
      if (lots.length === 0) housesWithZero++;
      if (isStale) staleHouses++;

      let fieldCoverage = null;
      try {
        ({ fieldCoverage } = validateBatch(lots, house));
      } catch (_e) { /* non-fatal */ }

      const entry = { house, lots: lots.length, images: withImage, imgCoverage, ageHours, stale: !!isStale, fieldCoverage };
      report.houses.push(entry);

      if (lots.length === 0) report.issues.push({ severity: 'critical', house, msg: 'Zero lots — extractor may be broken' });
      if (imgCoverage < 30 && lots.length > 0) report.issues.push({ severity: 'warn', house, msg: `Low image coverage: ${imgCoverage}%` });
      if (isStale) report.issues.push({ severity: 'info', house, msg: `Cache stale (${ageHours}h old)` });
    }

    report.summary = { totalHouses: allHouses.size, totalLots, housesWithZero, staleHouses };
    res.json(report);
  } catch (e) {
    log.error('Quality report error', { error: e.message });
    res.status(500).json({ error: 'Quality report failed. Check server logs.' });
  }
});


// Scraping functions (fetchPage, scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson,
// enrichAllsopLots, detectTotalPages, buildPageUrl, acquirePage, getBrowser, scrapeWithPuppeteer,
// extractLotsWithAI, isPdfUrl, extractLotsFromPdf, stripHtml, normaliseLotStatuses,
// backfillImages, fetchLotPage, backfillImagesFromLotPages, enrichLotsFromLotPages,
// backfillImagesWithPuppeteer, extractWithDOM) — all moved to lib/scraper.js

// W2N, analyseLot — moved to lib/analysis.js
// HOUSE_NAME_MIGRATIONS, syncCalendarAndHouseNames — moved to lib/analysis.js

// ═══════════════════════════════════════════════════════════════
// HARNESS ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/house-health', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(getAllHealth());
});

app.get('/api/discovery/candidates', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const candidates = await getDiscoveryQueue();
  res.json({ candidates, budget: getDiscoveryBudget() });
});

app.post('/api/discovery/approve', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  const ok = await approveCandidate(url);
  res.json({ approved: ok });
});

app.get('/api/enrichment/report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const house = req.query.house || null;
  // Get lots from lots table to generate report
  if (house) {
    const { data: lotRows } = await supabase.from('lots')
      .select(LOTS_SELECT)
      .eq('house', house);
    if (lotRows && lotRows.length > 0) {
      return res.json(getEnrichmentReport(lotRows.map(dbRowToFrontendLot), house));
    }
  }
  res.json({ message: 'Provide ?house=slug for per-house report' });
});

app.get('/api/manager/report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const report = getManagerReport();
  res.json(report || { message: 'No manager cycle has run yet' });
});

app.post('/api/manager/cycle', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const report = await runManagerCycle();
  res.json(report);
});

app.post('/api/manager/config', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { config } = req.body || {};
  if (!config) return res.status(400).json({ error: 'config object required' });
  const updated = setManagerConfig(config);
  res.json(updated);
});

app.get('/api/harness/status', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const health = getAllHealth();
  const healthCounts = { healthy: 0, degraded: 0, broken: 0 };
  for (const h of Object.values(health)) {
    if (h.status === 'broken') healthCounts.broken++;
    else if (h.status === 'degraded') healthCounts.degraded++;
    else healthCounts.healthy++;
  }
  res.json({
    health: healthCounts,
    houses: Object.keys(health).length,
    manager: getManagerReport() || { message: 'No cycle yet' },
    managerConfig: getManagerConfig(),
    discoveryBudget: getDiscoveryBudget(),
  });
});

// Sentry error handler — must be after all routes, before app.listen
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Initialize enrichment module with supabase dependency
initEnrichment({ supabase });

// Initialize scraper with server-level dependencies
initScraper({
  callAI,
  getCreditExhausted: () => getCreditExhausted(),
  setCreditExhausted: (v) => setCreditExhausted(v),
  setCreditExhaustedAt: (v) => setCreditExhaustedAt(v),
  getApiCallCount: () => getApiCallCount(),
  incApiCallCount: () => incApiCallCount(),
  extractPostcode,
});

// Initialize analysis module with all dependencies
initAnalysis({
  callAI, getAICostSummary,
  scrapeRenderedPage, scrapePageWithFirecrawl, scrapeWithFirecrawl,
  backfillImagesWithFirecrawl, backfillImagesWithPuppeteer, backfillImages, backfillImagesFromLotPages,
  extractLotsWithAI, extractWithJSDOM, normaliseLotStatuses,
  fetchLotPage, fetchPage, scrapeAllPages,
  scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots,
  detectTotalPages, buildPageUrl, scrapeWithPuppeteer,
  enrichLots, enrichLotsFromLotPages, extractPostcode,
  rewriteUrl, getCalendarAuctions,
  runManagerCycle, getManagerDirectives,
  harnessFireAlert, harnessResolveAlert, harnessUpdateHealth,
  getLastExtractorUsed, setLastExtractorUsed,
  getLastScrapeEngine, setLastScrapeEngine,
  getLastAITier, setLastAITier,
  DOM_EXTRACTORS, BROKEN_EXTRACTORS,
  FIRECRAWL_API_KEY, FIRECRAWL_SKIP,
  isFcCreditExhausted, getFcExhaustedAt, setFcCreditExhausted, setFcExhaustedAt,
  setFcCreditsUsed, getFcCreditsUsed,
  isFcTemporarilyDown, getFcDownAt, setFcTemporarilyDown, setFcDownAt,
  setFcConsecutive5xx, getFcConsecutive5xx,
  puppeteer, getCircuitBreakers,
});

app.listen(PORT, () => {
  log.info('server_start', { port: PORT });
  if (!process.env.SUPABASE_URL) log.warn('missing_env', { var: 'SUPABASE_URL' });
  if (!process.env.SUPABASE_SERVICE_KEY) log.warn('missing_env', { var: 'SUPABASE_SERVICE_KEY' });
  if (!process.env.GEMINI_API_KEY) log.warn('missing_env', { var: 'GEMINI_API_KEY' });

  // ── Harness manager initialization (after HOUSE_ROOTS + DOM_EXTRACTORS available) ──
  initManager({
    supabase, callAI,
    houseRoots: HOUSE_ROOTS, domExtractors: DOM_EXTRACTORS,
    healBrokenHouse,
    getCircuitBreakers,
  });

  // ── Ensure enrichment_cache table exists ──
  setTimeout(() => ensureEnrichmentCacheTable(), 3000);

  // ── Sync calendar + fix stale house names on startup ──
  setTimeout(() => syncCalendarAndHouseNames(), 5000);

  // ── Auto-analyse all catalogue-ready auctions ──
  // Run 30s after startup (let everything initialise), then every 6 hours
  setTimeout(() => autoAnalyseAll(), 30000);
  setInterval(() => autoAnalyseAll(), 6 * 60 * 60 * 1000);

  // ── Data hygiene engine ──
  // Run 2 min after startup, then every 30 min. No excuses — every lot gets
  // price, postcode, EPC, flood, comps, yield as fast as possible.
  setTimeout(() => runEnrichmentWave(), 2 * 60 * 1000);
  setInterval(() => runEnrichmentWave(), 30 * 60 * 1000);

  // ── Daily analytics snapshot at midnight ──
  function scheduleNextMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 5, 0); // 00:00:05 tomorrow
    const ms = midnight.getTime() - now.getTime();
    setTimeout(async () => {
      try { await saveDailySnapshot(); console.log('ANALYTICS: Midnight snapshot saved'); }
      catch (e) { console.warn('ANALYTICS: Midnight snapshot failed:', e.message); }
      scheduleNextMidnight(); // schedule the next one
    }, ms);
    console.log(`ANALYTICS: Next midnight snapshot in ${Math.round(ms / 60000)} minutes`);
  }
  scheduleNextMidnight();
});

// State variables, createSemaphore, runWave, autoAnalyseAll, _doAutoAnalyseAll — moved to lib/analysis.js
// healBrokenHouse, discoverAndUpdateCalendar — moved to lib/analysis.js
// discoverAndUpdateCalendar — moved to lib/analysis.js
// JUNK_LOT_PATTERN, buildSearchText, upsertToLotsTable — moved to lib/analysis.js
// autoAnalyseOne — moved to lib/analysis.js
// computeScrapeDiff, updateHouseSkill, saveDailySnapshot — moved to lib/analysis.js

// ── Pipeline Alerts API endpoint ──
app.get('/api/admin/alerts', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: active } = await supabase
      .from('pipeline_alerts')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: recent } = await supabase
      .from('pipeline_alerts')
      .select('*')
      .eq('resolved', true)
      .order('resolved_at', { ascending: false })
      .limit(20);

    res.json({ active: active || [], recent: recent || [] });
  } catch (e) {
    log.error('Alerts endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// ── Data Freshness API endpoint ──
app.get('/api/admin/freshness', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: houses } = await supabase
      .from('house_skills')
      .select('slug, house, status, last_verified, last_lot_count, image_coverage, last_diff')
      .order('house');

    res.json({ houses: houses || [] });
  } catch (e) {
    log.error('Freshness endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch freshness data' });
  }
});

// ── Umami Cloud API helpers ──
async function fetchUmamiStats(startAt, endAt) {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!websiteId || !apiKey) return null;
  try {
    const res = await fetch(
      `https://api.umami.is/v1/websites/${websiteId}/stats?startAt=${startAt}&endAt=${endAt}`,
      { headers: { 'x-umami-api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('Umami stats API error', { error: e.message });
    return null;
  }
}

async function fetchUmamiMetrics(startAt, endAt, type) {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!websiteId || !apiKey) return [];
  try {
    const res = await fetch(
      `https://api.umami.is/v1/websites/${websiteId}/metrics?startAt=${startAt}&endAt=${endAt}&type=${type}`,
      { headers: { 'x-umami-api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    log.warn('Umami metrics API error', { error: e.message });
    return [];
  }
}

// ── Analytics API endpoint ──
app.get('/api/admin/analytics', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endAt = Date.now();
    const startAt = endAt - days * 24 * 60 * 60 * 1000;

    const [snapshots, umamiStats, umamiReferrers, activityEvents] = await Promise.all([
      supabase.from('analytics_snapshots').select('*').gte('date', since).order('date', { ascending: true }),
      fetchUmamiStats(startAt, endAt),
      fetchUmamiMetrics(startAt, endAt, 'referrer'),
      supabase.from('activity_events').select('action, detail, created_at, user_email')
        .gte('created_at', new Date(startAt).toISOString())
        .order('created_at', { ascending: true }),
    ]);

    res.json({
      snapshots: snapshots.data || [],
      umami: umamiStats,
      referrers: umamiReferrers,
      events: activityEvents.data || [],
    });
  } catch (e) {
    log.error('Analytics endpoint error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Seed today's snapshot on demand ──
app.post('/api/admin/seed-snapshot', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    await saveDailySnapshot();
    res.json({ ok: true, message: 'Snapshot saved' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Re-enrich lots with missing data ──
app.post('/api/admin/re-enrich', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const limit = Math.min(req.body?.limit || 200, 500);
    const house = req.body?.house || null; // optional: target specific house
    const dryRun = req.body?.dryRun !== false;

    console.log(`RE-ENRICH: Starting (limit=${limit}, house=${house || 'all'}, dryRun=${dryRun})...`);

    // Find lots needing enrichment: no enriched_at, or no score and recently seen
    let query = supabase
      .from('lots')
      .select('*')
      .or('enriched_at.is.null,score.is.null')
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    if (house) query = query.eq('house', house);

    const { data: lots, error: lotsErr } = await query;
    if (lotsErr) throw new Error(`Failed to fetch lots: ${lotsErr.message}`);
    if (!lots || lots.length === 0) return res.json({ enriched: 0, message: 'No lots need enrichment' });

    // Group by house + catalogue_url for batch processing
    const groups = {};
    for (const lot of lots) {
      const key = `${lot.house}|${lot.catalogue_url}`;
      if (!groups[key]) groups[key] = { house: lot.house, catalogueUrl: lot.catalogue_url, lots: [] };
      groups[key].lots.push(lot);
    }

    if (dryRun) {
      const perHouse = {};
      for (const lot of lots) perHouse[lot.house] = (perHouse[lot.house] || 0) + 1;
      const gaps = {
        noScore: lots.filter(l => l.score == null).length,
        noEnrichedAt: lots.filter(l => !l.enriched_at).length,
        noPostcode: lots.filter(l => !l.postcode).length,
        noStreetAvg: lots.filter(l => l.street_avg == null).length,
        noYield: lots.filter(l => l.est_gross_yield == null).length,
        noCondition: lots.filter(l => !l.condition).length,
        noEpc: lots.filter(l => !l.epc_rating).length,
      };
      return res.json({ dryRun: true, found: lots.length, perHouse, gaps, message: 'POST with { "dryRun": false } to execute' });
    }

    let totalEnriched = 0;
    for (const [, group] of Object.entries(groups)) {
      try {
        // Convert DB rows back to in-memory lot format (includes postcode extraction + metadata)
        const lotObjs = group.lots.map(dbRowToLot);

        // Re-analyse lots that have no score (rebuilds scoring from scratch)
        const needsAnalysis = lotObjs.filter(l => l.score === 0 && (!l.scoreBreakdown || l.scoreBreakdown.length === 0));
        for (let i = 0; i < needsAnalysis.length; i++) {
          const reanalysed = analyseLot(needsAnalysis[i]);
          Object.assign(needsAnalysis[i], reanalysed);
        }

        // Run enrichLots for street comps, yield, EPC, flood
        await enrichLots(lotObjs, group.house, group.catalogueUrl);

        // Write enriched data back to lots table
        normaliseLotStatuses(lotObjs);
        await upsertToLotsTable(lotObjs, group.house, group.catalogueUrl, {
          scrapedWith: 're-enrich',
        });
        totalEnriched += lotObjs.length;
        console.log(`RE-ENRICH: ✓ ${group.house}: ${lotObjs.length} lots re-enriched`);
      } catch (groupErr) {
        console.warn(`RE-ENRICH: Failed for ${group.house}: ${groupErr.message}`);
      }
    }

    console.log(`RE-ENRICH: Complete — ${totalEnriched}/${lots.length} lots enriched`);
    res.json({ enriched: totalEnriched, total: lots.length, groups: Object.keys(groups).length });
  } catch (e) {
    console.error('RE-ENRICH: Failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DATA HYGIENE ENGINE
// ═══════════════════════════════════════════════════════════════
// Runs every 30 minutes. No waiting — every cycle does EVERYTHING for every
// lot that's missing any non-negotiable field. A lot without price/postcode/
// address is useless. Keep hammering until 100% hygiene or explicitly POA.
//
// Non-negotiable fields (lot is useless without these):
//   address, postcode, price, image, prop_type, beds
// Free-if-we-have-postcode (no excuse not to have):
//   EPC, flood risk, street comps, yield
// Lot-page enrichment (fetched per-lot if still missing):
//   tenure, condition, vacant, lease length

// dbRowToLot, dbRowToFrontendLot, LOTS_SELECT, upsertLotGroups,
// extractPriceFromText, runEnrichmentWave — all moved to lib/analysis.js

// ── Manual trigger for enrichment waves ──
app.post('/api/admin/enrich-waves', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  if (isEnrichmentWaveRunning()) return res.json({ ok: false, message: 'Enrichment wave already running' });
  runEnrichmentWave().catch(e => console.error('Manual enrichment wave failed:', e.message));
  res.json({ ok: true, message: 'Enrichment wave started in background' });
});

// ── Lightweight event tracking for client-only actions ──
app.post('/api/track/event', rateLimit(60000, 30), async (req, res) => {
  const { action, detail } = req.body || {};
  const allowed = ['deal_stacking', 'csv_export', 'bridgematch_open'];
  if (!action || !allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const user = await validateUserFromReq(req).catch(() => null);
  logActivityEvent(action, detail || {}, user?.email || null, getClientIP(req));
  res.json({ ok: true });
});

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
