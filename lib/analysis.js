// lib/analysis.js — Auto-analysis orchestration, healing, DB persistence, concurrency
import { log } from './logging.js';
import { supabase } from './supabase.js';
import { HOUSE_ROOTS, detectAuctionHouse, HOUSE_DISPLAY_NAMES } from './houses.js';
import { MAX_AUCTIONS_PER_HOUSE, HEADERS } from './config.js';
import { normaliseUrl } from './utils.js';
import { validateUrl } from './security.js';
import { isCircuitOpen } from './harness/house-health.js';
import { getUnresolvedCount } from './harness/alert-router.js';
import { resetBrokenExtractors } from './extractors/index.js';
import { FALLBACK_CALENDAR } from './calendar.js';
import { _invalidateCalendarCache } from './pipeline/persist-lots.js';
import {
  isFirecrawlExtractEnabled,
  extractCatalogueNative,
  extractPaginatedCatalogue,
  extractCatalogueListing,
  recognisePattinsonLotsFromMarkdown,
  recogniseJohnPyeLotsFromMarkdown,
} from './pipeline/firecrawl-extract.js';
import {
  initHarnessBridge, resetCycleSignals,
  probe, scrapeStage, enrichStage, persistStage, cacheEnrichStage,
  healBrokenHouse as _healBrokenHouseImpl,
  getHealingState as _getHealingStateImpl,
  clearHealingCooldown as _clearHealingCooldownImpl,
  discoverAndUpdateCalendar as _discoverAndUpdateCalendarImpl,
  updateHouseSkill as _updateHouseSkillImpl,
  executeHealing,
  saveDailySnapshot,
  purgeStaleCaches,
  syncCalendar,
  qualityGate as qualityGateImpl,
  analyseLot as analyseLotImpl,
  W2N,
  JUNK_LOT_PATTERN,
  buildSearchText,
  upsertToLotsTable as upsertToLotsTableImpl,
  extractPriceFromText as extractPriceFromTextImpl,
  runEnrichmentWave as runEnrichmentWaveImpl,
  drainHygieneRetries,
  createDbRowToLot,
  dbRowToFrontendLot as dbRowToFrontendLotImpl,
  LOTS_SELECT as LOTS_SELECT_IMPL,
  computeScrapeDiff as computeScrapeDiffImpl,
  logActivityEvent as logActivityEventImpl,
} from './pipeline/index.js';
import { emitPipelineEvent } from './pipeline/types.js';

// Dependencies injected via initAnalysis() to avoid circular imports
let _deps = {};

export function initAnalysis(deps) {
  Object.assign(_deps, deps);

  // Wire up dbRowToLot with extractPostcode dependency
  dbRowToLot = createDbRowToLot({ extractPostcode: deps.extractPostcode });

  initHarnessBridge({
    healBrokenHouse,
    fireAlert: deps.harnessFireAlert,
  });
}

// ── State variables ──
let _autoAnalysisRunning = false;
// Gemini credit state now delegated to budget (auto-reset handled there too).
// Firecrawl auto-reset timers also handled by budget._autoReset().
let apiCallCount = 0;
let hashHitCount = 0;
const serverStartTime = new Date().toISOString();
// Healing state now managed by lib/pipeline/healing.js
let _enrichmentWaveRunning = false;

// ── State getters/setters ──
// Gemini exhaustion delegates to budget (backward compat for callers)
export function getCreditExhausted() { return _deps.budget ? _deps.budget.getCreditExhausted() : false; }
export function setCreditExhausted(v) { if (_deps.budget) _deps.budget.setCreditExhausted(v); }
export function getCreditExhaustedAt() { return _deps.budget ? _deps.budget.getCreditExhaustedAt() : 0; }
export function setCreditExhaustedAt(v) { if (_deps.budget) _deps.budget.setCreditExhaustedAt(v); }
export function getApiCallCount() { return apiCallCount; }
export function incApiCallCount() { apiCallCount++; }
export function getHashHitCount() { return hashHitCount; }
export function getServerStartTime() { return serverStartTime; }
export function isEnrichmentWaveRunning() { return _enrichmentWaveRunning; }
export function isAutoAnalysisRunning() { return _autoAnalysisRunning; }
export function getHealingState() { return _getHealingStateImpl(); }
export function clearHealingCooldown(slug) { _clearHealingCooldownImpl(slug); }

// ── qualityGate, analyseLot, W2N — delegated to pipeline modules ──
const qualityGate = qualityGateImpl;
const analyseLot = analyseLotImpl;

// ══════════════════════════════════════════════════════════════════
// HOUSE_NAME_MIGRATIONS + syncCalendarAndHouseNames
// ══════════════════════════════════════════════════════════════════
const HOUSE_NAME_MIGRATIONS = {
  'SDL Auctions': 'BTG Eddisons',
};

async function syncCalendarAndHouseNames() {
  if (!supabase) return;
  try {
    // 1) Upsert all FALLBACK_CALENDAR entries into auction_calendar
    const rows = FALLBACK_CALENDAR.map(a => ({
      house: a.house, house_slug: a.houseSlug, logo: a.logo,
      date: a.date, date_end: a.dateEnd || null, title: a.title,
      lots: a.lots || null, url: a.url, location: a.location,
      type: a.type, status: a.status, catalogue_ready: a.catalogueReady,
      updated_at: new Date().toISOString(),
    }));
    const { error: calErr } = await supabase.from('auction_calendar').upsert(rows, { onConflict: 'url,date' });
    if (calErr) console.error('Calendar sync error:', calErr.message);
    else { console.log(`Calendar sync: upserted ${rows.length} entries`); _invalidateCalendarCache(); }

    // 2) Fix stale house names in cached_analyses
    for (const [oldName, newName] of Object.entries(HOUSE_NAME_MIGRATIONS)) {
      const { data, error } = await supabase
        .from('cached_analyses')
        .update({ house: newName })
        .eq('house', oldName);
      if (error) console.error(`House rename ${oldName} → ${newName} error:`, error.message);
      else console.log(`House rename: ${oldName} → ${newName}`);
    }

    // 3) Purge stale calendar entries for past dates
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('auction_calendar').delete().lt('date', today);
    _invalidateCalendarCache();
    console.log('Calendar sync: purged past-date entries');
  } catch (e) {
    console.error('syncCalendarAndHouseNames error:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// createSemaphore + runWave
// ══════════════════════════════════════════════════════════════════
function createSemaphore(max) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise(resolve => queue.push(resolve));
      active++;
    },
    release() {
      active--;
      if (queue.length > 0) queue.shift()();
    },
  };
}

async function runWave(auctions, concurrency, label, processFn) {
  if (auctions.length === 0) return { analysed: 0, skipped: 0, failed: 0 };
  console.log(`WAVE [${label}]: ${auctions.length} houses at concurrency ${concurrency}`);
  const sem = createSemaphore(concurrency);
  const results = await Promise.allSettled(
    auctions.map(async (auction) => {
      await sem.acquire();
      try {
        return await processFn(auction);
      } finally {
        sem.release();
      }
    })
  );
  let analysed = 0, skipped = 0, failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value === 'analysed') analysed++;
      else if (r.value === 'skipped') skipped++;
      else if (r.value === 'failed') failed++;
    } else {
      failed++;
    }
  }
  console.log(`WAVE [${label}]: done — ${analysed} analysed, ${skipped} cached, ${failed} failed`);
  return { analysed, skipped, failed };
}

// ══════════════════════════════════════════════════════════════════
// autoAnalyseAll + _doAutoAnalyseAll
// ══════════════════════════════════════════════════════════════════
async function autoAnalyseAll() {
  if (getCreditExhausted()) {
    console.log('AUTO: Gemini API rate limited — DOM-only houses will still be processed');
  }
  if (_autoAnalysisRunning) {
    console.log('AUTO: Analysis already running, skipping this invocation');
    return { skipped: true, reason: 'already_running' };
  }
  _autoAnalysisRunning = true;
  try {
    return await _doAutoAnalyseAll();
  } finally {
    _autoAnalysisRunning = false;
  }
}

async function _doAutoAnalyseAll() {
  console.log('\n═══ AUTO-ANALYSIS: checking all catalogue-ready auctions ═══');
  if (!process.env.GEMINI_API_KEY) { console.log('AUTO: No Gemini API key, skipping'); return; }

  // ── Reset broken extractors so fixed ones get retried each cycle ──
  resetBrokenExtractors();

  // ── Step 0: Purge stale cached_analyses rows ──
  try {
    await purgeStaleCaches({ supabase });
  } catch (e) {
    console.warn('AUTO-PURGE: cleanup failed (non-fatal) —', e.message);
  }

  // ── Step 0.5: Ensure every HOUSE_ROOTS entry has a calendar entry ──
  try {
    await syncCalendar({ supabase });
  } catch (e) {
    console.warn('AUTO-CALENDAR: root URL insertion failed (non-fatal) —', e.message);
  }

  // ── Step 1: Analyse all catalogue-ready auctions FIRST ──
  // Discovery is deferred to AFTER scraping so users see fresh lots quickly.
  const allReady = await _deps.getCalendarAuctions();
  // Limit to nearest MAX_AUCTIONS_PER_HOUSE upcoming dates per house
  const byHouse = {};
  for (const a of allReady) {
    const h = a.house || 'unknown';
    if (!byHouse[h]) byHouse[h] = [];
    byHouse[h].push(a);
  }
  const ready = [];
  for (const [h, auctions] of Object.entries(byHouse)) {
    auctions.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    ready.push(...auctions.slice(0, MAX_AUCTIONS_PER_HOUSE));
    for (const skippedA of auctions.slice(MAX_AUCTIONS_PER_HOUSE)) {
      console.log(`Skipping ${h} ${skippedA.date || skippedA.url} — beyond ${MAX_AUCTIONS_PER_HOUSE}-auction lookahead limit`);
    }
  }
  console.log(`AUTO: ${ready.length} catalogue-ready auctions to check (${allReady.length} total, limited to ${MAX_AUCTIONS_PER_HOUSE} per house)`);

  // ── Manager pre-scrape cycle → get directives ──
  // Gated on unresolved alerts: when nothing is broken, skip the Gemini-
  // backed cycle and use defaults (empty skip_houses + priority_houses).
  // Saves ~95% of manager Gemini calls. Override with FORCE_MANAGER=true.
  // getUnresolvedCount() returns -1 on DB errors → run anyway (fail open).
  let directives;
  try {
    const force = process.env.FORCE_MANAGER === 'true';
    const unresolved = await getUnresolvedCount();
    if (force || unresolved !== 0) {
      const preReport = await _deps.runManagerCycle();
      if (preReport && !preReport.skipped) {
        console.log(`MANAGER PRE-SCRAPE: Cycle ${preReport.cycle} — ${preReport.actions_taken.length} actions (unresolved=${unresolved}${force ? ', forced' : ''})`);
      }
    } else {
      console.log('MANAGER PRE-SCRAPE: skipped (no unresolved alerts)');
    }
    directives = _deps.getManagerDirectives();
  } catch (mgrErr) {
    console.warn('MANAGER PRE-SCRAPE: failed (non-fatal):', mgrErr.message);
    directives = _deps.getManagerDirectives(); // returns defaults
  }

  // ── Reset per-cycle signal buffers ──
  resetCycleSignals();

  // ── Partition into DOM houses vs Gemini houses ──
  const skipSet = new Set(directives.skip_houses || []);
  const priorityOrder = (directives.priority_houses || []).reduce((m, slug, i) => { m[slug] = i; return m; }, {});

  const domHouses = [];
  const geminiHouses = [];
  const skippedByManager = [];

  for (const auction of ready) {
    const slug = detectAuctionHouse(auction.url);
    if (skipSet.has(slug)) {
      skippedByManager.push(auction);
      console.log(`AUTO: Skipping ${auction.house} — manager directive (${(directives.skip_reasons || {})[slug] || 'skipped'})`);
      continue;
    }
    auction._slug = slug;
    auction._priority = priorityOrder[slug] !== undefined ? priorityOrder[slug] : 999;
    if (slug && _deps.DOM_EXTRACTORS[slug]) {
      domHouses.push(auction);
    } else {
      geminiHouses.push(auction);
    }
  }

  // ── Boost never-scraped houses to the front of the queue ──
  // Houses that have never been scraped (no cached_analyses entry) should be
  // processed first so they don't languish behind already-cached re-checks.
  const { data: cachedHouses } = await supabase
    .from('cached_analyses')
    .select('house');
  const cachedHouseSet = new Set((cachedHouses || []).map(r => r.house));
  for (const auction of [...domHouses, ...geminiHouses]) {
    const slug = auction._slug || detectAuctionHouse(auction.url);
    if (!cachedHouseSet.has(slug)) {
      // Never-scraped houses get top priority (below explicit manager priorities)
      auction._priority = Math.min(auction._priority, 1);
    }
  }

  // Sort by manager priority (lower = higher priority)
  domHouses.sort((a, b) => a._priority - b._priority);
  geminiHouses.sort((a, b) => a._priority - b._priority);

  const neverScrapedCount = [...domHouses, ...geminiHouses].filter(a => a._priority <= 1).length;
  console.log(`AUTO: Partitioned — ${domHouses.length} DOM houses, ${geminiHouses.length} Gemini houses, ${skippedByManager.length} skipped by manager, ${neverScrapedCount} never-scraped boosted`);

  // ── Per-auction processing function (same logic as before, no 5s pause) ──
  async function processAuction(auction) {
    try {
      const normalisedUrl = normaliseUrl(auction.url);

      // Check if we already have a fresh cache
      const { data: cached } = await supabase
        .from('cached_analyses')
        .select('url, total_lots, created_at')
        .eq('url', normalisedUrl)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cached && cached.total_lots > 0) {
        // Read lots from lots table (single source of truth)
        const { data: lotRows } = await supabase
          .from('lots')
          .select(LOTS_SELECT)
          .eq('catalogue_url', normalisedUrl);
        const cachedLots = (lotRows || []).map(dbRowToFrontendLot);

        // ── Delegate to cache-enrich-stage module ──
        await cacheEnrichStage(
          { auction, normalisedUrl, cachedLots, cachedTotalLots: cached.total_lots },
          {
            rewriteUrl: _deps.rewriteUrl,
            scrapeAllsopApi: _deps.scrapeAllsopApi,
            enrichAllsopLots: _deps.enrichAllsopLots,
            backfillImages: _deps.backfillImages,
            backfillImagesFromLotPages: _deps.backfillImagesFromLotPages,
            backfillImagesWithFirecrawl: _deps.backfillImagesWithFirecrawl,
            backfillImagesWithPuppeteer: _deps.backfillImagesWithPuppeteer,
            normaliseLotStatuses: _deps.normaliseLotStatuses,
            upsertToLotsTable,
            FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
            isFcCreditExhausted: _deps.isFcCreditExhausted,
            puppeteer: _deps.puppeteer,
          },
        );
        return 'skipped';
      }

      console.log(`AUTO: Analysing ${auction.house} — ${auction.url}`);
      const HOUSE_TIMEOUT_MS = 90000;

      await Promise.race([
        autoAnalyseOne(auction.url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('House scrape timeout (90s)')), HOUSE_TIMEOUT_MS))
      ]);
      return 'analysed';

    } catch (e) {
      console.error(`AUTO: ✗ ${auction.house} failed: ${e.message}`);
      return 'failed';
    }
  }

  // ── Wave 1: DOM houses at high concurrency ──
  const wave1 = await runWave(domHouses, directives.dom_concurrency || 10, 'DOM', processAuction);

  // ── Wave 2: Gemini houses at low concurrency ──
  const wave2 = await runWave(geminiHouses, directives.gemini_concurrency || 3, 'Gemini', processAuction);

  const analysed = wave1.analysed + wave2.analysed;
  const skipped = wave1.skipped + wave2.skipped + skippedByManager.length;
  const failed = wave1.failed + wave2.failed;

  console.log(`═══ AUTO-ANALYSIS COMPLETE: ${analysed} analysed, ${skipped} cached/skipped, ${failed} failed ═══\n`);

  // ── Step 3: Proactive healing sweep for houses with unresolved 0-lot regressions ──
  if (_deps.FIRECRAWL_API_KEY && !_deps.isFcCreditExhausted()) {
    try {
      const { data: unresolvedAlerts } = await supabase
        .from('pipeline_alerts')
        .select('house, message')
        .in('event_type', ['extractor_regression', 'quality_gate_reject', 'auto_analyse_failure'])
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (unresolvedAlerts && unresolvedAlerts.length > 0) {
        // Deduplicate by house
        const housesToHeal = [...new Set(unresolvedAlerts.map(a => a.house).filter(Boolean))];
        console.log(`HEAL-SWEEP: ${housesToHeal.length} houses with unresolved issues: ${housesToHeal.join(', ')}`);

        let healed = 0;
        for (const slug of housesToHeal) {
          const rootUrl = HOUSE_ROOTS[slug];
          if (!rootUrl) continue;

          const healedUrl = await healBrokenHouse(slug, rootUrl);
          if (healedUrl) {
            healed++;
            // Try re-analysing with the healed URL
            try {
              await autoAnalyseOne(healedUrl);
            } catch { /* already logged inside */ }
          }
        }
        if (healed > 0) {
          console.log(`HEAL-SWEEP: ✓ Healed ${healed}/${housesToHeal.length} houses`);
        }
      }
    } catch (healErr) {
      console.warn('HEAL-SWEEP: failed (non-fatal) —', healErr.message);
    }
  }

  // ── Step 4: Discover new catalogues AFTER scraping ──
  // Discovery is expensive (Firecrawl + Gemini per house) so runs after lots are live.
  if (getCreditExhausted()) {
    console.log('AUTO-DISCOVER: Skipping — Gemini API rate limited (discovery requires AI)');
  } else {
    await discoverAndUpdateCalendar().catch(e =>
      console.error('AUTO-DISCOVER: failed —', e.message)
    );
  }

  // ── Harness: Manager post-scrape cycle (corrective actions) ──
  try {
    // Gated like the pre-scrape cycle. Note: this runs AFTER the scrape
    // pass, so any new alerts raised during the pass (regression detected,
    // healing fired, etc.) will have created rows in pipeline_alerts —
    // the count helper picks them up here.
    const force = process.env.FORCE_MANAGER === 'true';
    const unresolved = await getUnresolvedCount();
    if (force || unresolved !== 0) {
      const postReport = await _deps.runManagerCycle();
      if (postReport && !postReport.skipped) {
        console.log(`MANAGER POST-SCRAPE: Cycle ${postReport.cycle}: ${postReport.actions_taken.length} actions, effectiveness ${postReport.effectiveness_score} (unresolved=${unresolved}${force ? ', forced' : ''})`);
      }
    } else {
      console.log('MANAGER POST-SCRAPE: skipped (no unresolved alerts after pass)');
    }
  } catch (mgrErr) {
    console.warn('MANAGER POST-SCRAPE: failed (non-fatal):', mgrErr.message);
  }

  // ── Save daily analytics snapshot ──
  try { await saveDailySnapshot(); } catch (e) { console.warn('Daily snapshot failed:', e.message); }

  return { analysed, skipped, failed, total: ready.length };
}

// ══════════════════════════════════════════════════════════════════
// healBrokenHouse — thin wrapper delegating to lib/pipeline/healing.js
// ══════════════════════════════════════════════════════════════════
async function healBrokenHouse(slug, oldUrl) {
  return _healBrokenHouseImpl(slug, oldUrl, {
    FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
    scrapeWithFirecrawl: _deps.scrapeWithFirecrawl,
    callAI: _deps.callAI,
    extractWithJSDOM: _deps.extractWithJSDOM,
    HEADERS,
  });
}

// ══════════════════════════════════════════════════════════════════
// discoverAndUpdateCalendar — thin wrapper delegating to lib/pipeline/discovery.js
// ══════════════════════════════════════════════════════════════════
async function discoverAndUpdateCalendar() {
  return _discoverAndUpdateCalendarImpl({
    FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
    isFcCreditExhausted: _deps.isFcCreditExhausted,
    scrapeWithFirecrawl: _deps.scrapeWithFirecrawl,
    callAI: _deps.callAI,
    HEADERS,
  });
}

// ── JUNK_LOT_PATTERN, buildSearchText, upsertToLotsTable — delegated to lib/pipeline/persist-lots.js ──
const upsertToLotsTable = upsertToLotsTableImpl;

// ══════════════════════════════════════════════════════════════════
// autoAnalyseOne
// ══════════════════════════════════════════════════════════════════
async function autoAnalyseOne(url) {
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) { log.warn('autoAnalyseOne skipped — invalid URL', { url, reason: urlCheck.error }); return []; }
  const house = detectAuctionHouse(url);

  try {
  // ── Harness: circuit breaker check ──
  if (isCircuitOpen(house)) {
    console.log(`AUTO: Skipping ${house} — circuit breaker open`);
    // Make the silent skip observable — without this, an admin manually
    // calling /api/admin/rescrape sees a "Rescraping…" response but no
    // downstream evidence (this is what kept stags failures invisible
    // for hours after the bamboo URL migration).
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'circuit_breaker_skip',
        severity: 'info',
        house,
        message: `Skipped ${HOUSE_DISPLAY_NAMES[house] || house}: circuit breaker open. Reset via SQL: UPDATE house_skills SET circuit_state='closed', circuit_opened_at=NULL, consecutive_failures=0 WHERE slug='${house}';`,
      });
    } catch { /* non-fatal — best-effort observability */ }
    return;
  }

  // Skip Knight Frank forthcoming-auctions index page — it's a discovery page, not a catalogue.
  // Actual catalogue URLs like /auction/3833/... are discovered and analysed separately.
  if (house === 'knightfrank' && url.toLowerCase().includes('forthcoming-auctions')) {
    console.log(`AUTO: Skipping ${house} forthcoming-auctions index page (not a catalogue)`);
    return;
  }

  const rewritten = await _deps.rewriteUrl(url, house);
  if (rewritten.blocked) {
    console.log(`AUTO: Skipping ${house} — marked as blocked (anti-bot protection)`);
    return [];
  }
  const scrapeUrl = rewritten.baseUrl;
  const normalisedUrl = normaliseUrl(url);

  // ── Per-house overrides for the Firecrawl-only catalogue path ──
  // Houses with quirks that need non-default treatment. Recall is achieved
  // primarily by CATALOGUE_PROMPT, with optional per-house markdown recognition
  // for lots the JSON extractor under-counts. Recognisers run on Firecrawl's
  // own markdown output (no extra Firecrawl calls) — see file header in
  // lib/pipeline/firecrawl-extract.js for why this is "Firecrawl at the heart"
  // and not DOM extraction.
  const HOUSE_OVERRIDES = {
    pattinson: {
      maxPages: 84,
      paginateAs: 'pattinson_p',
      // Pattinson silently drops the connection when changeTracking is on
      // (any mode). Verified 2026-05-04: same body via curl with changeTracking
      // returns "server closed abruptly" after ~60s. Without it, full content
      // returns in <1s. We accept the cost of always re-scraping.
      changeTracking: false,
      recallSentinelPattern: /\/property\/(\d+)/g,
      recogniseFromMarkdown: recognisePattinsonLotsFromMarkdown,
      validatePage1: (result) => {
        const md = result.markdown || '';
        const ids = [...md.matchAll(/\/property\/(\d+)/g)];
        if (ids.length < 15) { console.log(`AUTO: pattinson page 1 only ${ids.length} property URLs — degraded render`); return false; }
        return true;
      },
    },
    johnpye: {
      maxPages: 1,
      recallSentinelPattern: /\/auctions\/([\w-]{10,})/g,
      recogniseFromMarkdown: recogniseJohnPyeLotsFromMarkdown,
    },
  };
  if (isFirecrawlExtractEnabled() && HOUSE_OVERRIDES[house]) {
    try {
      const tpResult = await extractCatalogueListing(scrapeUrl, house, HOUSE_OVERRIDES[house]);
      if (tpResult.lots.length > 0) {
        console.log(`AUTO: ${house} — Firecrawl JSON: ${tpResult.lots.length} lots`);
        const enrichDeps = {
          analyseLot,
          enrichLots: _deps.enrichLots,
          enrichLotsFromLotPages: _deps.enrichLotsFromLotPages,
          backfillImagesWithFirecrawl: _deps.backfillImagesWithFirecrawl,
          backfillImagesWithPuppeteer: _deps.backfillImagesWithPuppeteer,
          FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
          isFcCreditExhausted: _deps.isFcCreditExhausted,
          puppeteer: _deps.puppeteer,
        };
        const { lots: enrichedLots } = await enrichStage(
          { rawLots: tpResult.lots, house, url },
          enrichDeps,
        );
        const persistDeps = {
          qualityGate,
          dbRowToFrontendLot,
          upsertToLotsTable,
          updateHouseSkill,
          computeScrapeDiff,
          normaliseLotStatuses: _deps.normaliseLotStatuses,
          getLastScrapeEngine: _deps.getLastScrapeEngine,
          getLastExtractorUsed: _deps.getLastExtractorUsed,
          getLastAITier: _deps.getLastAITier,
          harnessUpdateHealth: _deps.harnessUpdateHealth,
          harnessFireAlert: _deps.harnessFireAlert,
          harnessResolveAlert: _deps.harnessResolveAlert,
        };
        await persistStage(
          { lots: enrichedLots, house, url, normalisedUrl, rewritten, contentHash: null },
          persistDeps,
        );
        return;
      }
      console.log(`AUTO: ${house} — Firecrawl JSON returned 0 lots, falling back to legacy`);
    } catch (tpErr) {
      console.log(`AUTO: ${house} — Firecrawl JSON error (${tpErr.message}), falling back to legacy`);
    }
  }

  // ── Firecrawl-native extraction (feature-flagged) ──
  const FC_EXTRACT_SKIP = [];
  const FORCE_EXTRACT_HOUSES = ['barnardmarcus', 'network', 'bondwolfe'];

  // Recall sentinel: per-house regex (one capture group = lot id) used for
  // logging only. The function counts how many distinct ids appear in the
  // markdown vs how many made it into JSON, so we can spot recall regressions
  // without per-house extractors. Top 13 houses by lot count, derived from
  // production lot URLs as of 2026-05-05. Houses NOT in this map still scrape;
  // they just don't emit the recall-ratio log line.
  const RECALL_SENTINELS = {
    // EIG-platform sites — /lot/details/{id} or /lot/redirect/{id}
    paulfosh: /\/lot\/(?:details|redirect)\/(\d+)/g,
    harmanhealy: /\/lot\/(?:details|redirect)\/(\d+)/g,
    tcpa: /\/lot\/(?:details|redirect)\/(\d+)/g,
    firstforauctions: /\/lot\/(?:details|redirect)\/(\d+)/g,
    purplebricksgoto: /\/lot\/(?:details|redirect)\/(\d+)/g,
    auctionhouse: /\/lot\/(?:details|redirect)\/(\d+)/g,
    auctionhouseuklondon: /\/lot\/(?:details|redirect)\/(\d+)/g,
    auctionhousenational: /\/lot\/(?:details|redirect)\/(\d+)/g,
    // Hollis Morgan — /property-details/{id}/...
    hollismorgan: /\/property-details\/(\d+)/g,
    // Pugh — slug-style ID: /property/{slug}
    pugh: /\/property\/([a-z0-9_-]{12,})/gi,
    // Edward Mellor — /property-for-sale/{id}
    edwardmellor: /\/property-for-sale\/(\d+)/g,
    // Future Property Auctions — query string ID. Two slugs in DB (legacy + current).
    futureauctions: /property_details\.asp\?id=(\d+)/gi,
    'future property auctions': /property_details\.asp\?id=(\d+)/gi,
    // Savills — /auctions/{date-id}/{slug-{lot-id}}
    savills: /\/auctions\/[\w-]+\/[\w-]+-(\d{4,6})(?=$|[\/?#])/gi,
    // SDL deliberately omitted — federated white-label network, no single regex
    // covers charlesdarrow.co.uk, btgeddisonspropertyauctions.com, etc.
  };

  if (isFirecrawlExtractEnabled() && rewritten.paginateAs !== 'allsop_api' && !FC_EXTRACT_SKIP.includes(house)) {
    try {
      const forceExtract = FORCE_EXTRACT_HOUSES.includes(house);
      const isPaginated = rewritten.paginateAs && rewritten.paginateAs !== 'allsop_api';
      const recallSentinelPattern = RECALL_SENTINELS[house] || null;
      const fcResult = isPaginated
        ? await extractPaginatedCatalogue(scrapeUrl, house, { paginateAs: rewritten.paginateAs, forceExtract, recallSentinelPattern })
        : await extractCatalogueNative(scrapeUrl, house, { forceExtract, recallSentinelPattern });
      if (fcResult.skipped) {
        console.log(`AUTO: ${house} unchanged (Firecrawl changeTracking) — skipping`);
        hashHitCount++;
        return;
      }
      if (fcResult.lots.length > 0) {
        console.log(`AUTO: ${house} — Firecrawl extract: ${fcResult.lots.length} lots`);
        const enrichDeps = {
          analyseLot,
          enrichLots: _deps.enrichLots,
          enrichLotsFromLotPages: _deps.enrichLotsFromLotPages,
          backfillImagesWithFirecrawl: _deps.backfillImagesWithFirecrawl,
          backfillImagesWithPuppeteer: _deps.backfillImagesWithPuppeteer,
          FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
          isFcCreditExhausted: _deps.isFcCreditExhausted,
          puppeteer: _deps.puppeteer,
        };
        const { lots: enrichedLots } = await enrichStage(
          { rawLots: fcResult.lots, house, url },
          enrichDeps,
        );
        const persistDeps = {
          qualityGate,
          dbRowToFrontendLot,
          upsertToLotsTable,
          updateHouseSkill,
          computeScrapeDiff,
          normaliseLotStatuses: _deps.normaliseLotStatuses,
          getLastScrapeEngine: _deps.getLastScrapeEngine,
          getLastExtractorUsed: _deps.getLastExtractorUsed,
          getLastAITier: _deps.getLastAITier,
          harnessUpdateHealth: _deps.harnessUpdateHealth,
          harnessFireAlert: _deps.harnessFireAlert,
          harnessResolveAlert: _deps.harnessResolveAlert,
        };
        await persistStage(
          { lots: enrichedLots, house, url, normalisedUrl, rewritten, contentHash: null },
          persistDeps,
        );
        return;
      }
      // 0 lots — try agent mode only for explicitly configured houses
      const AGENT_TIMEOUT = { acuitus: 600000, foxandsons: 300000 };
      if (AGENT_TIMEOUT[house]) {
        const timeout = AGENT_TIMEOUT[house];
        console.log(`AUTO: ${house} — 0 lots from extraction, trying agent mode (timeout ${timeout}ms)`);
        try {
          const { extractWithAgent } = await import('./pipeline/firecrawl-extract.js');
          const agentResult = await extractWithAgent(scrapeUrl, house, { timeout });
          if (agentResult.lots.length > 0) {
            console.log(`AUTO: ${house} — agent extract: ${agentResult.lots.length} lots`);
            const enrichDeps = {
              analyseLot,
              enrichLots: _deps.enrichLots,
              enrichLotsFromLotPages: _deps.enrichLotsFromLotPages,
              backfillImagesWithFirecrawl: _deps.backfillImagesWithFirecrawl,
              backfillImagesWithPuppeteer: _deps.backfillImagesWithPuppeteer,
              FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
              isFcCreditExhausted: _deps.isFcCreditExhausted,
              puppeteer: _deps.puppeteer,
            };
            const { lots: enrichedLots } = await enrichStage(
              { rawLots: agentResult.lots, house, url },
              enrichDeps,
            );
            const persistDeps = {
              qualityGate,
              dbRowToFrontendLot,
              upsertToLotsTable,
              updateHouseSkill,
              computeScrapeDiff,
              normaliseLotStatuses: _deps.normaliseLotStatuses,
              getLastScrapeEngine: _deps.getLastScrapeEngine,
              getLastExtractorUsed: _deps.getLastExtractorUsed,
              getLastAITier: _deps.getLastAITier,
              harnessUpdateHealth: _deps.harnessUpdateHealth,
              harnessFireAlert: _deps.harnessFireAlert,
              harnessResolveAlert: _deps.harnessResolveAlert,
            };
            await persistStage(
              { lots: enrichedLots, house, url, normalisedUrl, rewritten, contentHash: null },
              persistDeps,
            );
            return;
          }
        } catch (agentErr) {
          console.log(`AUTO: ${house} — agent mode failed: ${agentErr.message}`);
        }
      }
      console.log(`AUTO: ${house} — Firecrawl extract returned 0 lots, falling back to legacy pipeline`);
    } catch (fcErr) {
      console.log(`AUTO: ${house} — Firecrawl extract error (${fcErr.message}), falling back to legacy pipeline`);
    }
  }

  // ── Stage 1: Probe — HTML change detection ──
  const probeResult = await probe(
    { url, house, scrapeUrl, normalisedUrl },
    { budget: _deps.budget, scrapeWithFirecrawl: _deps.scrapeWithFirecrawl, fetchPage: _deps.fetchPage },
  );
  if (probeResult.skip) {
    hashHitCount++;
    return;
  }
  autoAnalyseOne._lastContentHash = probeResult.contentHash;

  // ── Stage 2: Scrape — fetch raw lots from catalogue ──
  const scrapeDeps = {
    scrapeAllsopApi: _deps.scrapeAllsopApi,
    extractAllsopLotsFromJson: _deps.extractAllsopLotsFromJson,
    scrapeRenderedPage: _deps.scrapeRenderedPage,
    extractWithJSDOM: _deps.extractWithJSDOM,
    detectTotalPages: _deps.detectTotalPages,
    buildPageUrl: _deps.buildPageUrl,
    fetchPage: _deps.fetchPage,
    scrapeAllPages: _deps.scrapeAllPages,
    extractLotsWithAI: _deps.extractLotsWithAI,
    isFcCreditExhausted: _deps.isFcCreditExhausted,
    isCreditExhausted: () => _deps.budget ? _deps.budget.getCreditExhausted() : false,
    puppeteer: _deps.puppeteer,
    healBrokenHouse,
    getLastScrapeEngine: _deps.getLastScrapeEngine,
  };
  const { rawLots } = await scrapeStage(
    { house, url, scrapeUrl, rewritten },
    scrapeDeps,
  );

  if (rawLots.length === 0) {
    // Self-healing: use confidence-gated healing for ALL zero-lot cases
    // (no longer gated on prevSkill.last_lot_count > 0 — new houses with wrong URLs get healed too)
    let healResult = null;
    try {
      healResult = await executeHealing(house);
      if (healResult) {
        console.log(`HEAL: ✓ ${house} healed — re-analysing with new URL: ${healResult}`);
        try {
          await autoAnalyseOne(healResult);
          try {
            await supabase.from('pipeline_alerts')
              .update({ resolved: true, resolved_at: new Date().toISOString() })
              .eq('house', house)
              .in('event_type', ['extractor_regression', 'auto_analyse_failure'])
              .eq('resolved', false);
          } catch { /* non-fatal */ }
        } catch (reErr) {
          console.log(`HEAL: Re-analysis with healed URL failed for ${house}: ${reErr.message}`);
        }
      }
    } catch (healErr) { console.warn('HEAL: Self-healing failed:', healErr.message); }
    if (!healResult) {
      // No replacement URL found — make the silent zero-lot return observable
      // so admins see something in the panel (without this it looked like the
      // pipeline did nothing at all).
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'zero_lots_no_heal',
          // 'warning' (not 'warn') is the value the alert-router escalation
          // logic and downstream queries match against. 'warn' was a silent
          // typo that left this alert unmatched by every status filter.
          severity: 'warning',
          house,
          message: `${HOUSE_DISPLAY_NAMES[house] || house} returned 0 lots and no replacement URL was found. The catalogue URL may be stale, the extractor broken, or the page may genuinely be empty.`,
        });
      } catch { /* non-fatal */ }
    }
    return;
  }

  // ── Stage 3: Enrich — score, EPC/flood/tenure, image backfill, fundability ──
  const enrichDeps = {
    analyseLot,
    enrichLots: _deps.enrichLots,
    enrichLotsFromLotPages: _deps.enrichLotsFromLotPages,
    backfillImagesWithFirecrawl: _deps.backfillImagesWithFirecrawl,
    backfillImagesWithPuppeteer: _deps.backfillImagesWithPuppeteer,
    FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
    isFcCreditExhausted: _deps.isFcCreditExhausted,
    puppeteer: _deps.puppeteer,
  };
  const { lots: enrichedLots } = await enrichStage(
    { rawLots, house, url },
    enrichDeps,
  );

  // ── Stage 4: Persist — quality gate, harness, cache upsert, lots upsert, skill tracking ──
  const persistDeps = {
    qualityGate,
    dbRowToFrontendLot,
    upsertToLotsTable,
    updateHouseSkill,
    computeScrapeDiff,
    normaliseLotStatuses: _deps.normaliseLotStatuses,
    getLastScrapeEngine: _deps.getLastScrapeEngine,
    getLastExtractorUsed: _deps.getLastExtractorUsed,
    getLastAITier: _deps.getLastAITier,
    harnessUpdateHealth: _deps.harnessUpdateHealth,
    harnessFireAlert: _deps.harnessFireAlert,
    harnessResolveAlert: _deps.harnessResolveAlert,
  };
  await persistStage(
    { lots: enrichedLots, house, url, normalisedUrl, rewritten, contentHash: probeResult.contentHash },
    persistDeps,
  );

  } catch (autoErr) {
    // ── Pipeline alert: auto-analyse failure ──
    console.error(`AUTO: autoAnalyseOne failed for ${house}:`, autoErr.message);
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'auto_analyse_failure',
        severity: 'error',
        house,
        message: `Auto-analyse failed for ${HOUSE_DISPLAY_NAMES[house] || house}: ${autoErr.message}`
      });
    } catch (alertErr) { console.warn('ALERT: Failed to record auto-analyse failure:', alertErr.message); }

    // Emit scrape failure event so harness-bridge can trigger confidence-gated healing
    try {
      emitPipelineEvent({
        event: 'scrape_all_tiers_failed',
        house,
        url,
        lastError: autoErr.message,
      });
      await executeHealing(house);
    } catch (healErr) { console.warn('HEAL: Post-failure healing failed:', healErr.message); }
  }
}

// ── computeScrapeDiff — delegated to lib/pipeline/scrape-diff.js ──
const computeScrapeDiff = computeScrapeDiffImpl;

// ── updateHouseSkill — thin wrapper delegating to lib/pipeline/house-skills.js ──
async function updateHouseSkill(slug, params) {
  return _updateHouseSkillImpl(slug, params, { DOM_EXTRACTORS: _deps.DOM_EXTRACTORS });
}

// ── dbRowToLot, dbRowToFrontendLot, LOTS_SELECT — delegated to lib/pipeline/lot-mappers.js ──
// dbRowToLot needs _deps.extractPostcode, so we create it lazily after initAnalysis()
let dbRowToLot;
const dbRowToFrontendLot = dbRowToFrontendLotImpl;
const LOTS_SELECT = LOTS_SELECT_IMPL;

// ── upsertLotGroups — thin wrapper using _deps ──
async function upsertLotGroups(lotObjs, source) {
  const groups = {};
  for (const lot of lotObjs) {
    const key = `${lot._house}|${lot._catalogueUrl}`;
    if (!groups[key]) groups[key] = { house: lot._house, catalogueUrl: lot._catalogueUrl, lots: [] };
    groups[key].lots.push(lot);
  }
  let total = 0;
  for (const [, g] of Object.entries(groups)) {
    _deps.normaliseLotStatuses(g.lots);
    await upsertToLotsTable(g.lots, g.house, g.catalogueUrl, { scrapedWith: source });
    total += g.lots.length;
  }
  return total;
}

// ── extractPriceFromText — delegated to lib/pipeline/enrichment-wave.js ──
const extractPriceFromText = extractPriceFromTextImpl;

// ── runEnrichmentWave — thin wrapper with guard + deps injection ──
// opts.freeOnly: skip Firecrawl-eligible passes (used by 30-min continuous tick)
async function runEnrichmentWave(opts = {}) {
  if (_enrichmentWaveRunning) { console.log('HYGIENE: Already running, skipping'); return; }
  _enrichmentWaveRunning = true;
  try {
    await runEnrichmentWaveImpl({
      fetchLotPage: _deps.fetchLotPage,
      enrichLotsFromLotPages: _deps.enrichLotsFromLotPages,
      enrichLots: _deps.enrichLots,
      normaliseLotStatuses: _deps.normaliseLotStatuses,
      extractPostcode: _deps.extractPostcode,
      analyseLot,
      dbRowToLot,
      upsertToLotsTable,
      upsertLotGroups,
    }, opts);
  } catch (e) {
    console.error('HYGIENE: Fatal error:', e.message);
  } finally {
    _enrichmentWaveRunning = false;
  }
}

// ── logActivityEvent — delegated to lib/pipeline/activity-log.js ──
const logActivityEvent = logActivityEventImpl;

// ══════════════════════════════════════════════════════════════════
// Exports
// ══════════════════════════════════════════════════════════════════
export { qualityGate, analyseLot, W2N };
export { HOUSE_NAME_MIGRATIONS, syncCalendarAndHouseNames };
export { createSemaphore, runWave };
export { autoAnalyseAll, autoAnalyseOne };
export { healBrokenHouse, discoverAndUpdateCalendar };
export { JUNK_LOT_PATTERN, buildSearchText, upsertToLotsTable };
export { computeScrapeDiff, updateHouseSkill, saveDailySnapshot };
export { dbRowToLot, dbRowToFrontendLot, LOTS_SELECT, upsertLotGroups };
export { extractPriceFromText, runEnrichmentWave, drainHygieneRetries, logActivityEvent };
