// lib/analysis.js — Auto-analysis orchestration, healing, DB persistence, concurrency
import { log } from './logging.js';
import { supabase } from './supabase.js';
import { HOUSE_ROOTS, detectAuctionHouse, HOUSE_DISPLAY_NAMES, RETIRED_HOUSES } from './houses.js';
import { MAX_AUCTIONS_PER_HOUSE, HEADERS } from './config.js';
import { normaliseUrl } from './utils.js';
import { validateUrl } from './security.js';
import { isCircuitOpen } from './harness/house-health.js';
import { getUnresolvedCount, fireAlert } from './harness/alert-router.js';
// resetBrokenExtractors retired 2026-05-08 with the DOM-extractor system.
import { FALLBACK_CALENDAR } from './calendar.js';
import { _invalidateCalendarCache } from './pipeline/persist-lots.js';
import { getLotsForCatalogue } from './pipeline/lot-lookup.js';
import { getCataloguePage1Hash, setCataloguePage1Hash } from './pipeline/house-skills.js';
import { createHash } from 'crypto';
import {
  extractCatalogueNative,
  extractPaginatedCatalogue,
  extractCatalogueListing,
} from './pipeline/firecrawl-extract.js';
// ── Best-engine-first router (docs/ENGINE-ROUTER.md) ──
import { HOUSE_RECOGNISERS, houseRecogniser } from './scraper/house-recognisers.js';
import { ENGINES, recordEngineOutcome } from './scraper/engine-router.js';
import { resolveEngineForHouse, isCrawleeEnabled, isShadowMode } from './pipeline/engine-decision.js';
import { hasCrawlee, scrapeWithCrawlee } from './scraper/crawlee.js';
import { getBudget, setLastScrapeEngine, setLastExtractorUsed } from './scraper/state.js';
import { isPdfUrl } from './scraper/extraction.js';
import { resolveRecallSentinel } from './scraper/recall-sentinels.js';
import { computeStructureFingerprint, compareFingerprints } from './scraper/structure-fingerprint.js';
import { getExtractionTier, recordExtractionRecall, shouldFlagForRecogniser } from './scraper/extraction-tier.js';
import { renderAndExtractWithCrawlee } from './pipeline/crawlee-extract.js';
import { htmlToRecognitionMarkdown } from './scraper/html-to-markdown.js';
import { fetchPage } from './scraper/http.js';
import { evaluateParity } from './pipeline/parity-gate.js';
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
  computeScrapeDiff as computeScrapeDiffImpl,
  logActivityEvent as logActivityEventImpl,
} from './pipeline/index.js';
import { dbRowToLot, LOTS_SELECT, normaliseScrapedLot } from './types/lot.js';
import { emitPipelineEvent } from './pipeline/types.js';
import { isEligibleNow, isPastAttemptFloor, computeUnscheduledHouses, attemptFloorHours, recordScrapeOutcome } from './pipeline/scheduling.js';

// Dependencies injected via initAnalysis() to avoid circular imports
let _deps = {};

export function initAnalysis(deps) {
  Object.assign(_deps, deps);

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

    // 3) Past-date calendar rows accumulate harmlessly — DON'T purge.
    //
    // Pre-Move-2 this used to `.delete().lt('date', today)`. That was safe
    // when `lots.catalogue_url` was the join key (the lots stayed pointed
    // at a URL string). After Move 2 + Follow-up H, lots reference
    // auction_calendar by FK with NOT NULL — deleting a past-date row
    // would either nullify lots' auction_id (violating NOT NULL → DELETE
    // fails loudly) or cascade-delete the lots (losing history).
    //
    // The calendar is small (~300 rows). Letting past auctions accumulate
    // is cheaper than the engineering needed to archive-instead-of-delete
    // while preserving FK integrity. Admin views that filter by date
    // window already hide them implicitly.
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

  // Slugs that made it into the calendar-derived queue at all. The silent-drop
  // guardrail below diffs this against the expected active-house set — taken
  // BEFORE the retired/manager filters, which are deliberate and logged;
  // absence HERE means getCalendarAuctions itself dropped the house
  // (catalogue_ready=false on every row, or no calendar row at all).
  const readySlugs = new Set(ready.map(a => detectAuctionHouse(a.url)));

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

  // DOM/Gemini partition retired 2026-05-08 with the DOM-extractor system.
  // Every house now flows through the unified Firecrawl JSON extract path
  // (with Gemini as a 0-lots fallback), so a single ordered queue with one
  // concurrency setting is the correct shape.
  const houses = [];
  const skippedByManager = [];

  for (const auction of ready) {
    const slug = detectAuctionHouse(auction.url);
    if (RETIRED_HOUSES.has(slug)) {
      console.log(`AUTO: Skipping ${auction.house} — house retired from active rotation`);
      continue;
    }
    if (skipSet.has(slug)) {
      skippedByManager.push(auction);
      console.log(`AUTO: Skipping ${auction.house} — manager directive (${(directives.skip_reasons || {})[slug] || 'skipped'})`);
      continue;
    }
    auction._slug = slug;
    auction._priority = priorityOrder[slug] !== undefined ? priorityOrder[slug] : 999;
    houses.push(auction);
  }

  // ── Boost never-scraped houses to the front of the queue ──
  // Houses that have never been scraped (no cached_analyses entry) should be
  // processed first so they don't languish behind already-cached re-checks.
  const { data: cachedHouses } = await supabase
    .from('cached_analyses')
    .select('house');
  const cachedHouseSet = new Set((cachedHouses || []).map(r => r.house));
  for (const auction of houses) {
    const slug = auction._slug || detectAuctionHouse(auction.url);
    if (!cachedHouseSet.has(slug)) {
      // Never-scraped houses get top priority (below explicit manager priorities)
      auction._priority = Math.min(auction._priority, 1);
    }
  }

  // Sort by manager priority (lower = higher priority)
  houses.sort((a, b) => a._priority - b._priority);

  // Adaptive scheduling filter: skip houses whose next_scrape_at is in the
  // future. Stable catalogues (consecutive 'same' results from Firecrawl
  // changeTracking) earn longer intervals via lib/pipeline/scheduling.js.
  // The 7d clamp inside computeScheduleUpdate only helps houses that get
  // ATTEMPTED (it runs post-scrape) — the attempt floor below is what actually
  // guarantees an attempt at least every FRESHNESS_FLOOR_HOURS (default 48h).
  // Bypass via /api/admin/rescrape (calls autoAnalyseOne directly).
  let skippedAdaptive = 0;
  let floorBoosted = 0;
  // Full-table fetch (~170 rows, trivial): queued houses need engine policy +
  // last_probe_at for the attempt floor; the silent-drop guardrail below needs
  // dormant state for houses that are NOT in the queue. One select serves all.
  const { data: skillRows } = await supabase
    .from('house_skills')
    .select('slug, next_scrape_at, last_probe_at, dormant, preferred_engine, engine_locked, engine_stats');
  const skillBySlug = new Map((skillRows || []).map(r => [r.slug, r]));
  {
    const now = new Date();
    const eligible = [];
    for (const auction of houses) {
      const slug = auction._slug || detectAuctionHouse(auction.url);
      const skill = skillBySlug.get(slug);
      // Freshness floor: a house not ATTEMPTED in >FRESHNESS_FLOOR_HOURS
      // (default 48h) is queued regardless of adaptive backoff, boosted to the
      // front, and (in processAuction) bypasses the cache-hit short-circuit so
      // the scrape is real. Attempt-keyed (last_probe_at) so broken houses
      // don't hot-loop — their attempts stamp the clock, and the circuit
      // breaker still limits them to one trial per 24h.
      const floorBreached = isPastAttemptFloor(skill, now);
      if (isEligibleNow(skill, now) || floorBreached) {
        // Carry the engine policy (preferred_engine / engine_locked / engine_stats)
        // into autoAnalyseOne so the router doesn't need a per-house select.
        auction._engineSkill = skill || null;
        if (floorBreached) {
          auction._floorBoost = true;
          auction._priority = Math.min(auction._priority, 2);
          floorBoosted++;
          console.log(`AUTO: Freshness floor — boosting ${auction.house} (last attempt ${skill?.last_probe_at || 'never'}, floor ${attemptFloorHours()}h)`);
        }
        eligible.push(auction);
      } else {
        skippedAdaptive++;
        console.log(`AUTO: Skipping ${auction.house} — next_scrape_at ${skill.next_scrape_at} not yet reached`);
      }
    }
    houses.length = 0;
    houses.push(...eligible);
  }
  // Re-sort: floor boosts assign priorities after the earlier sort.
  houses.sort((a, b) => a._priority - b._priority);

  // ── Silent-drop guardrail ──
  // An active house absent from `ready` was dropped before any of the loud,
  // deliberate filters ran — catalogue_ready=false on every calendar row (the
  // barnardmarcus 2026-06-17 / mchughandco+bondwolfe 2026-06-28 class), or no
  // calendar row at all. That state previously hid for weeks; surface it every
  // pass. fireAlert dedups (6h window) and escalates on the 3rd day.
  const dormantSlugs = new Set((skillRows || []).filter(r => r.dormant === true).map(r => r.slug));
  const unscheduled = computeUnscheduledHouses({
    rootSlugs: Object.keys(HOUSE_ROOTS),
    retiredSlugs: RETIRED_HOUSES,
    dormantSlugs,
    scheduledSlugs: readySlugs,
  });
  if (unscheduled.length > 0) {
    console.warn(`AUTO: GUARDRAIL — ${unscheduled.length} active house(s) silently unscheduled: ${unscheduled.join(', ')}`);
    for (const slug of unscheduled) {
      try {
        await fireAlert({
          type: 'house_unscheduled',
          severity: 'warning',
          house: slug,
          message: `${HOUSE_DISPLAY_NAMES[slug] || slug} is active but absent from the scrape queue — getCalendarAuctions returned no row for it (needs catalogue_ready=true within the date window). Likely catalogue_ready=false on all its rows, or no calendar row at all.`,
          meta: { source: 'queue_guardrail' },
        });
      } catch { /* alerting must never break the pass */ }
    }
  }

  const neverScrapedCount = houses.filter(a => a._priority <= 1).length;
  console.log(`AUTO: Queued ${houses.length} houses (${skippedByManager.length} skipped by manager, ${skippedAdaptive} skipped by adaptive cadence, ${neverScrapedCount} never-scraped boosted, ${floorBoosted} freshness-floor boosted, ${unscheduled.length} unscheduled-alerted)`);

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

      // Floor-boosted houses skip the cache short-circuit: their last real
      // ATTEMPT is older than the freshness floor, so serving cache-enrich
      // here would leave them stale for another pass (a fresh cached_analyses
      // row can outlive the last probe when written by on-demand analysis).
      // The page-1-hash probe inside autoAnalyseOne still short-circuits an
      // unchanged catalogue, so the forced pass stays cheap.
      if (cached && cached.total_lots > 0 && !auction._floorBoost) {
        // Read lots from lots table (single source of truth). Move 2: dual-read
        // helper — no auctionId resolved at this call site yet, so falls back
        // to the legacy (house, catalogue_url) path.
        const { data: lotRows } = await getLotsForCatalogue(supabase, {
          house: auction.house,
          catalogueUrl: normalisedUrl,
          select: LOTS_SELECT,
        });
        const cachedLots = (lotRows || []).map(dbRowToLot);

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
      // Engine-aware timeout: Crawlee drives a LOCAL Chromium (multi-page renders
      // take minutes — Pattinson especially), so the 90s Firecrawl budget would
      // mark every Crawlee house "failed" while the orphaned run keeps going.
      // Give likely-Crawlee houses a longer window. (review F1)
      const slug = auction._slug || detectAuctionHouse(auction.url);
      const crawleeLikely = hasCrawlee() && (
        process.env.CRAWLEE_DEFAULT === 'true'
        || isCrawleeEnabled(slug)
        || auction._engineSkill?.preferred_engine === 'crawlee'
        || !getBudget()?.canUseFirecrawl?.()
      );
      const HOUSE_TIMEOUT_MS = crawleeLikely
        ? parseInt(process.env.CRAWLEE_HOUSE_TIMEOUT_MS || '600000')
        : 90000;

      await Promise.race([
        autoAnalyseOne(auction.url, { engineSkill: auction._engineSkill }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`House scrape timeout (${Math.round(HOUSE_TIMEOUT_MS / 1000)}s)`)), HOUSE_TIMEOUT_MS))
      ]);
      return 'analysed';

    } catch (e) {
      console.error(`AUTO: ✗ ${auction.house} failed: ${e.message}`);
      return 'failed';
    }
  }

  // ── Single Firecrawl-fronted wave at moderate concurrency ──
  // (the per-tier dom/gemini partition retired with the DOM-extractor system)
  const concurrency = directives.scrape_concurrency || directives.dom_concurrency || directives.gemini_concurrency || 5;
  const wave = await runWave(houses, concurrency, 'Firecrawl', processAuction);

  const analysed = wave.analysed;
  const skipped = wave.skipped + skippedByManager.length;
  const failed = wave.failed;

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
// AI inference uses Firecrawl FIRE-1 via lib/scraper/firecrawl.js::agentExtract
// (the healing module imports it directly as a default; no injection needed).
// ══════════════════════════════════════════════════════════════════
async function healBrokenHouse(slug, oldUrl) {
  return _healBrokenHouseImpl(slug, oldUrl, {
    FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
    scrapeWithFirecrawl: _deps.scrapeWithFirecrawl,
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
async function autoAnalyseOne(url, opts = {}) {
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) { log.warn('autoAnalyseOne skipped — invalid URL', { url, reason: urlCheck.error }); return []; }
  const house = detectAuctionHouse(url);
  // forceFresh: bypass Firecrawl changeTracking — set by /api/admin/rescrape
  // and similar manual triggers so a "Firecrawl says unchanged" answer can't
  // short-circuit a re-scrape that the operator explicitly asked for. The
  // automatic cron path does not set this and continues to benefit from
  // changeTracking's credit savings.
  const forceFresh = !!opts.forceFresh;
  // ignoreCircuit: an explicit operator rescrape bypasses the in-memory circuit
  // breaker. `isCircuitOpen` reads house-health.js's _healthMap, which is loaded
  // ONLY at server startup — so a manual `UPDATE house_skills SET
  // circuit_state='closed'` never reaches the running process, and the harness
  // manager re-opens the circuit from in-memory health=0 regardless. That
  // deadlocks a house that's been FIXED (e.g. a recogniser shipped) but is still
  // circuit-broken: it can't scrape to raise its health, so the circuit never
  // closes, so it never scrapes. /api/admin/rescrape sets this so the one
  // corrective scrape runs; on success updateHealth() recomputes health and
  // closes the circuit for good. The cron path never sets it — circuit respected.
  const ignoreCircuit = !!opts.ignoreCircuit;
  // Adaptive scheduling: 'same' | 'changed' | 'error' | null (no attempt).
  // Stamped at each outcome point; recorded once in the finally block via
  // recordScrapeOutcome → house_skills.{next_scrape_at,consecutive_same_count,...}.
  // Skip paths (circuit breaker, blocked, knightfrank index) leave it null
  // so no cadence state changes from a non-attempt.
  let outcome = null;
  // Liveness: set true when a zero-lot run was rescued by self-healing (the
  // catalogue URL was repaired and re-analysed). Suppresses the silent-failure
  // health-degrade in the finally so a successfully-healed house isn't marked
  // degraded by the outer 'error' outcome.
  let healedSuccessfully = false;
  // Engine-router: a house_skills patch (engine_stats and/or a preferred_engine
  // promotion) to write once in the finally block. Stays null unless an engine
  // decision actually ran. See docs/ENGINE-ROUTER.md.
  let enginePatch = null;
  // Guard against running the Crawlee primary twice in one pass: a recogniser
  // house can hit it in the HOUSE_OVERRIDES block (0 lots → falls to Firecrawl
  // → that fails too → control reaches the primary block, which would resolve
  // crawlee again). One render+extract attempt per cycle is enough.
  let crawleeTried = false;

  try {
  // ── Harness: circuit breaker check (skipped for explicit operator rescrapes) ──
  if (!ignoreCircuit && isCircuitOpen(house)) {
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

  // Enrich + persist a raw lot batch through the standard stages. Shared by the
  // Firecrawl and Crawlee paths so the engine that produced the lots doesn't
  // change how they're enriched, scored, or stored — provenance (scraped_with /
  // extracted_with) flows from state.js stamps set during render/extract.
  const enrichAndPersistLots = async (rawLots) => {
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
    const { lots: enrichedLots } = await enrichStage({ rawLots, house, url }, enrichDeps);
    const persistDeps = {
      qualityGate,
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
    await persistStage({ lots: enrichedLots, house, url, normalisedUrl, rewritten, contentHash: null }, persistDeps);
  };

  // ── Crawlee engine helpers (shared by the HOUSE_OVERRIDES and primary blocks) ──
  const engineSkill = opts.engineSkill || null;
  const pct = (r) => (r == null ? 'n/a' : `${(r * 100).toFixed(0)}%`);

  // Extraction model tier for this house, from the auto-promotion policy: a
  // house whose rolling Crawlee+Gemini recall settled below the weak floor is
  // bumped from Flash-Lite ('fast') to a stronger model ('capable') so the lots
  // Flash-Lite dropped are recovered. State lives in engine_stats._extraction.
  const extractionTier = getExtractionTier(engineSkill, house);
  if (extractionTier === 'capable') {
    console.log(`AUTO: ${house} — extraction tier 'capable' (auto-promoted on weak recall, ewma ${pct(engineSkill?.engine_stats?._extraction?.ewma)})`);
  }

  // Below this recall a Crawlee run is too lossy to serve as PRIMARY *when
  // Firecrawl is available* — fall through to the Firecrawl safety net. When
  // Firecrawl is exhausted there is no net, so we serve the degraded-but-
  // present result regardless (better than a stale catalogue). (review F8)
  const CRAWLEE_RECALL_FLOOR = parseFloat(process.env.CRAWLEE_RECALL_FLOOR || '0.85');
  // How long a multi-page Crawlee render may run before it stops adding pages,
  // leaving headroom under the house timeout for Gemini extraction. (review F1)
  const CRAWLEE_RENDER_BUDGET_MS = parseInt(process.env.CRAWLEE_RENDER_BUDGET_MS || '420000');
  const CRAWLEE_PROMOTE_PASSES = parseInt(process.env.CRAWLEE_PROMOTE_PASSES || '2');

  // Fold a Crawlee run outcome into the freshest stats we have — a prior
  // patch from this same pass (e.g. failed primary, then shadow) must not be
  // overwritten, or the failure run vanishes from engine_stats telemetry.
  const foldCrawleeStats = (outcomeFields, extractionRecall = undefined, fingerprint = undefined) => {
    const base = recordEngineOutcome(
      enginePatch?.engine_stats || engineSkill?.engine_stats || {},
      'crawlee',
      outcomeFields,
    );
    // Stamp the structure fingerprint (primary path only — the shadow path
    // doesn't render its own page 1) onto the same engine_stats patch.
    if (fingerprint) base._fingerprint = fingerprint;
    // Fold the same run's recall into the extraction-tier policy (only when a
    // recall was actually measured — page-1 render failures pass nothing).
    if (extractionRecall !== undefined) {
      base._extraction = recordExtractionRecall(base._extraction, extractionRecall, { at: outcomeFields.at });
      // A house that's leaned on the 'capable' model crutch for several runs
      // has earned a DETERMINISTIC fix — surface it once as a work item. The
      // strong model masks the weak recall; the recogniser removes the cause.
      if (shouldFlagForRecogniser(base._extraction)) {
        base._extraction = { ...base._extraction, recogniserFlaggedAt: outcomeFields.at || new Date().toISOString() };
        fireAlert({
          type: 'needs_recogniser',
          severity: 'warning',
          house,
          message: `${house} has needed the capable extraction tier for ${base._extraction.capableRuns} runs (recall ewma ${Math.round((base._extraction.ewma || 0) * 100)}%). Write a markdown recogniser (HOUSE_RECOGNISERS pattern) so the cheap model hits full recall deterministically.`,
          meta: { ewma: base._extraction.ewma, capableRuns: base._extraction.capableRuns, tier: 'capable' },
        }).catch(() => {});
      }
    }
    return base;
  };

  // Promoted / locked / config-default / zero-credit-failover. Renders page 1
  // ONCE (reused for both the change-gate hash and as page 1 of the multi-page
  // render — no double render), bounds the render with a deadline, and honours
  // the recall floor. Returns { done, outcome, enginePatch }: done=false → the
  // caller falls through to the Firecrawl safety net.
  const runCrawleePrimary = async ({ recogniseFromMarkdown = null, recallSentinelPattern = null, maxPages = 1, paginateAs = null, reason = '' }) => {
    crawleeTried = true;
    const now = new Date().toISOString();
    let page1 = null;
    try { page1 = await scrapeWithCrawlee(scrapeUrl); }
    catch (e) { console.log(`AUTO: ${house} crawlee page-1 render failed (${e.message})`); }
    if (!page1?.html) {
      return { done: false, outcome: null, enginePatch: { engine_stats: foldCrawleeStats({ success: false, recall: null, credits: 0, at: now }) } };
    }
    // Free page-1 change gate.
    if (!forceFresh) {
      try {
        const prior = await getCataloguePage1Hash(house);
        if (prior && prior === createHash('md5').update(page1.html).digest('hex')) {
          console.log(`AUTO: ${house} unchanged (crawlee page-1 hash) — skipping extract`);
          hashHitCount++;
          return { done: true, outcome: 'same', enginePatch: null };
        }
      } catch { /* fail open */ }
    }
    // ── Structure fingerprint: proactive presentation-change detection ──
    // Compare this render's structural shape (class vocabulary + signal
    // counts) to the last run's. A step-change means the house rebuilt its
    // template — alert BEFORE extraction quietly under-recalls, naming what
    // moved. The new fingerprint is persisted regardless (alert once per
    // change, then the new shape becomes the baseline).
    let fingerprint = null;
    try {
      fingerprint = computeStructureFingerprint(page1.html, recallSentinelPattern);
      const fpVerdict = compareFingerprints(engineSkill?.engine_stats?._fingerprint, fingerprint);
      if (fpVerdict.drift) {
        console.warn(`AUTO: ${house} — STRUCTURE DRIFT: ${fpVerdict.reasons.join('; ')}`);
        fireAlert({
          type: 'structure_drift',
          severity: 'warning',
          house,
          message: `${house} page structure changed: ${fpVerdict.reasons.join('; ')}. Verify the next extraction's recall and refresh the sentinel/recogniser if needed.`,
          meta: { similarity: fpVerdict.similarity, reasons: fpVerdict.reasons, counts: fingerprint?.counts },
        }).catch(() => {});
      }
    } catch { /* fingerprinting must never block the scrape */ }
    const cr = await renderAndExtractWithCrawlee(scrapeUrl, house, {
      maxPages, paginateAs, recallSentinelPattern, recogniseFromMarkdown, tier: extractionTier,
      prefetchedPage1: page1, deadlineAt: Date.now() + CRAWLEE_RENDER_BUDGET_MS,
    });
    const fcAvailable = !!getBudget()?.canUseFirecrawl?.();
    const lossy = cr.recall != null && cr.recall < CRAWLEE_RECALL_FLOOR;
    if (cr.lots.length === 0 || (fcAvailable && lossy)) {
      console.log(`AUTO: ${house} — Crawlee ${cr.lots.length} lots, recall ${pct(cr.recall)} → ${fcAvailable ? 'falling back to Firecrawl' : 'no FC fallback, serving best available'}`);
      if (cr.lots.length === 0 || fcAvailable) {
        return { done: false, outcome: null, enginePatch: { engine_stats: foldCrawleeStats({ success: cr.lots.length > 0, recall: cr.recall, credits: 0, at: now }, cr.recall, fingerprint) } };
      }
    }
    console.log(`AUTO: ${house} — Crawlee+Gemini${reason ? ` (${reason})` : ''}: ${cr.lots.length} lots (recall ${pct(cr.recall)}${cr.recognised ? `, +${cr.recognised} recognised` : ''})`);
    // Queryable recall history for the trial — the Firecrawl path emits this
    // (firecrawl-extract.js) but the Crawlee path otherwise wouldn't. (review F13)
    if (cr.recall != null) {
      fireAlert({
        type: 'recall_diagnostic',
        severity: cr.recall < CRAWLEE_RECALL_FLOOR ? 'warning' : 'info',
        house,
        message: `Crawlee recall ${pct(cr.recall)}: ${cr.lots.length}/${cr.sentinelLots} (${reason})`,
        meta: { engine: 'crawlee', recall: cr.recall, lots: cr.lots.length, sentinelLots: cr.sentinelLots, recognised: cr.recognised, reason },
      }).catch(() => {});
    }
    await enrichAndPersistLots(cr.lots);
    if (cr.renderedPages[0]?.html) {
      try { await setCataloguePage1Hash(house, createHash('md5').update(cr.renderedPages[0].html).digest('hex')); } catch { /* best-effort */ }
    }
    return { done: true, outcome: 'changed', enginePatch: { engine_stats: foldCrawleeStats({ success: true, recall: cr.recall, credits: 0, at: now }, cr.recall, fingerprint) } };
  };

  // Shadow: after Firecrawl persisted, run Crawlee as a challenger and let the
  // parity gate decide promotion. Promotion requires CRAWLEE_PROMOTE_PASSES
  // CONSECUTIVE parity passes (review F9), tracked in engine_stats._parityPasses,
  // so one lucky run on a volatile catalogue can't flip a house live.
  const runCrawleeShadow = async ({ recogniseFromMarkdown = null, recallSentinelPattern = null, maxPages = 1, paginateAs = null, fcResult }) => {
    try {
      const cr = await renderAndExtractWithCrawlee(scrapeUrl, house, {
        maxPages, paginateAs, recallSentinelPattern, recogniseFromMarkdown, tier: extractionTier,
        deadlineAt: Date.now() + CRAWLEE_RENDER_BUDGET_MS,
      });
      const verdict = evaluateParity({
        incumbent: { lots: fcResult.lots, recall: fcResult.recall },
        challenger: { lots: cr.lots, recall: cr.recall },
        house,
      });
      const prevPasses = engineSkill?.engine_stats?._parityPasses || 0;
      const passes = verdict.promote ? prevPasses + 1 : 0;
      const promoteNow = passes >= CRAWLEE_PROMOTE_PASSES;
      const engine_stats = { ...foldCrawleeStats({ success: cr.lots.length > 0, recall: cr.recall, credits: 0, at: new Date().toISOString() }, cr.recall), _parityPasses: passes };
      console.log(`AUTO: ${house} — engine parity ${verdict.promote ? `PASS ${passes}/${CRAWLEE_PROMOTE_PASSES}${promoteNow ? ' → promoting' : ''}` : 'hold'} (${verdict.reason})`);
      fireAlert({
        type: 'engine_parity',
        severity: 'info',
        house,
        message: `Crawlee vs Firecrawl on ${house}: ${promoteNow ? 'PROMOTE' : verdict.promote ? `pass ${passes}/${CRAWLEE_PROMOTE_PASSES}` : 'hold'} — fc ${fcResult.lots.length} lots/${pct(fcResult.recall)} q${verdict.incBatchQuality}, cr ${cr.lots.length} lots/${pct(cr.recall)} q${verdict.chBatchQuality}`,
        meta: { verdict, parityPasses: passes },
      }).catch(() => {});
      return promoteNow ? { engine_stats, preferred_engine: 'crawlee' } : { engine_stats };
    } catch (e) { console.log(`AUTO: ${house} — shadow compare failed: ${e.message}`); return null; }
  };

  // Resolve the engine for this house. recogniseFromMarkdown (when present) is
  // always passed into the Crawlee path so recogniser houses keep full recall.
  const resolveEngine = (recogniseFromMarkdown) => resolveEngineForHouse({
    house, rewritten, catalogueUrl: scrapeUrl, engineSkill,
    hasMarkdownRecogniser: !!recogniseFromMarkdown,
  });
  // A house is a shadow-migration candidate when config + structure allow it and
  // it isn't already promoted. Recogniser houses ARE candidates now (Phase 3).
  // crawleeTried: never render the same catalogue twice in one pass (a failed
  // Crawlee primary already produced this cycle's engine_stats evidence).
  const isCrawleeCandidate = () => hasCrawlee() && isCrawleeEnabled(house)
    && !isPdfUrl(scrapeUrl) && rewritten.paginateAs !== 'allsop_api' && rewritten.paginateAs !== 'symondsandsampson_stealth'
    && engineSkill?.preferred_engine !== 'crawlee'
    && !engineSkill?.engine_locked   // a locked house must not shadow-promote (review F9)
    && !crawleeTried;

  // ── Per-house overrides for the Firecrawl-only catalogue path ──
  // Houses with quirks that need non-default treatment. Recall is achieved
  // primarily by CATALOGUE_PROMPT, with optional per-house markdown recognition
  // for lots the JSON extractor under-counts. Recognisers run on Firecrawl's
  // own markdown output (no extra Firecrawl calls) — see file header in
  // lib/pipeline/firecrawl-extract.js for why this is "Firecrawl at the heart"
  // and not DOM extraction.
  // Recogniser + sentinel + page cap come from the shared registry
  // (lib/scraper/house-recognisers.js) so the cron and on-demand paths can't
  // drift; the per-house extras (paginateAs, changeTracking, validatePage1)
  // are added here.
  const HOUSE_OVERRIDES = {
    pattinson: {
      ...HOUSE_RECOGNISERS.pattinson,
      paginateAs: 'pattinson_p',
      // Pattinson silently drops the connection when changeTracking is on
      // (any mode). Verified 2026-05-04: same body via curl with changeTracking
      // returns "server closed abruptly" after ~60s. Without it, full content
      // returns in <1s. We accept the cost of always re-scraping.
      changeTracking: false,
      validatePage1: (result) => {
        const md = result.markdown || '';
        const ids = [...md.matchAll(/\/property\/(\d+)/g)];
        if (ids.length < 15) { console.log(`AUTO: pattinson page 1 only ${ids.length} property URLs — degraded render`); return false; }
        return true;
      },
    },
    johnpye: { ...HOUSE_RECOGNISERS.johnpye },
    // McHugh & Co runs on the EIG platform but routes through their own
    // domain. The catalogue page returns ~500 KB of markdown with 200+
    // lots inline — too dense for the JSON extractor in one shot.
    mchughandco: { ...HOUSE_RECOGNISERS.mchughandco },
    // Mark Jenkinson runs three concurrent auctions on /auction/{token} URLs.
    // The JSON extractor under-counted (15/73) and mis-classified survivors as
    // sold — the recogniser parses the markdown deterministically.
    markjenkinson: { ...HOUSE_RECOGNISERS.markjenkinson },
    // Maggs & Allen `/search-auction/?auction={N}`. JSON gets ~24/38 lots; the
    // recogniser recovers the SOLD-overlay and "LOT TBC" blocks it drops.
    // changeTracking: false — Firecrawl's changeTracking returned empty
    // payloads on ~half of scrapes (Pattinson precedent), so always re-render.
    maggsandallen: { ...HOUSE_RECOGNISERS.maggsandallen, changeTracking: false },
    // Hollis Morgan `/search-auction/` — own CMS shape (`#### Lot N` /
    // `### address` / `[SHOW ME MORE](.../property-details/<id>/...)`), 100+ lots.
    hollismorgan: { ...HOUSE_RECOGNISERS.hollismorgan },
  };
  if (HOUSE_OVERRIDES[house]) {
    try {
      const ovr = HOUSE_OVERRIDES[house];
      const { engine: ovrEngine, reason: ovrReason } = resolveEngine(ovr.recogniseFromMarkdown);

      // ── Crawlee (promoted / locked / zero-credit failover) — recogniser-aware ──
      // Recogniser houses now reach Crawlee via the turndown bridge (Phase 3).
      // ovrEngine is 'crawlee' only when promoted/locked, or when Firecrawl is
      // exhausted (failover) — otherwise it's firecrawl and we skip this.
      if (ovrEngine === ENGINES.CRAWLEE) {
        console.log(`AUTO: ${house} → engine crawlee (${ovrReason})`);
        const res = await runCrawleePrimary({
          recogniseFromMarkdown: ovr.recogniseFromMarkdown,
          recallSentinelPattern: ovr.recallSentinelPattern,
          maxPages: ovr.maxPages || 1,
          paginateAs: ovr.paginateAs || null,
          reason: ovrReason,
        });
        if (res.enginePatch) enginePatch = res.enginePatch;
        if (res.done) { outcome = res.outcome; return; }
        // 0 lots from Crawlee — fall through to the Firecrawl path below.
      }

      // Firecrawl JSON extract removed (CF-bypass-only). Recogniser houses are
      // served by the Crawlee primary above; if it yields 0 lots we fall through
      // to the legacy render pipeline (Crawlee → Puppeteer → HTTP + Gemini) below.
    } catch (ovrErr) {
      console.log(`AUTO: ${house} — primary engine error (${ovrErr.message}), falling back to legacy`);
    }
  }

  // ── Firecrawl-native extraction (unconditional since 2026-05-08) ──
  // The feature flag and FORCE_EXTRACT_HOUSES safelist were retired with
  // the DOM-extractor system. Firecrawl JSON extract runs for every house
  // except the Allsop JSON-API exception (handled via paginateAs upstream).
  const FC_EXTRACT_SKIP = [];


  // Recall sentinels (per-house structural-change detectors) live in
  // lib/scraper/recall-sentinels.js — one shared map for the cron path, the
  // on-demand path, and the ops scripts. Resolution ladder: HOUSE_OVERRIDES
  // pattern → explicit RECALL_SENTINELS entry → platform auto-detection → null
  // (which must be documented in KNOWN_SENTINEL_GAPS or the coverage test fails).

  if (rewritten.paginateAs !== 'allsop_api' && rewritten.paginateAs !== 'symondsandsampson_stealth' && !FC_EXTRACT_SKIP.includes(house)) {
    try {
      // Firecrawl extract is unconditional for every non-Allsop house.
      // forceExtract=false lets changeTracking short-circuit unchanged pages.
      // The /api/admin/rescrape endpoint passes forceFresh to bypass this so
      // an operator can re-scrape after an upstream URL/recogniser change
      // without waiting for the Firecrawl change-hash to expire.
      const forceExtract = forceFresh;
      const isPaginated = rewritten.paginateAs && rewritten.paginateAs !== 'allsop_api' && rewritten.paginateAs !== 'symondsandsampson_stealth';
      // Per-house override (the 6 in HOUSE_OVERRIDES) wins; otherwise a shared
      // PLATFORM recogniser (e.g. the ~33 auctionhouse.co.uk franchise sites)
      // via houseRecogniser(). Recogniser houses keep their registry sentinel
      // even on this path (RECALL_SENTINELS has no entries for pattinson/johnpye).
      const rec = HOUSE_OVERRIDES[house] || houseRecogniser(house);
      const recallSentinelPattern = resolveRecallSentinel(house, rec?.recallSentinelPattern);

      const recogniser = rec?.recogniseFromMarkdown || null;

      // ── Static-HTTP catalogue (SSR houses) — bypass the browser render ──
      // BTG Eddisons (sdl) serves its whole catalogue server-rendered at
      // ?page=1&limit=500 WITH inline "Guide Price: £X". A browser render
      // (Crawlee networkidle2 + scroll) lets the EIG widget re-hydrate the grid
      // and DROP those guide labels — guide-price coverage collapsed 92%→16%
      // after the Firecrawl→Crawlee migration. A plain HTTP fetch keeps the SSR
      // HTML, so the same turndown→recogniser path recovers the guides. Scoped
      // to the staticCatalogue flag (sdl only); on 0 lots / fetch failure we
      // fall through to the engine router below so the house degrades, not breaks.
      if (rec?.staticCatalogue && recogniser) {
        try {
          const html = await (_deps.fetchPage || fetchPage)(scrapeUrl);
          if (!forceFresh) {
            const prior = await getCataloguePage1Hash(house).catch(() => null);
            if (prior && prior === createHash('md5').update(html).digest('hex')) {
              console.log(`AUTO: ${house} unchanged (static page-1 hash) — skipping`);
              hashHitCount++; outcome = 'same'; return;
            }
          }
          const md = htmlToRecognitionMarkdown(html, scrapeUrl);
          const map = recogniser(md);
          const rawLots = [...(map?.values?.() || [])]
            .map(l => normaliseScrapedLot(l, { house, catalogueUrl: scrapeUrl, extractionSource: 'static-recognition' }))
            .filter(Boolean);
          if (rawLots.length > 0) {
            console.log(`AUTO: ${house} → static HTTP catalogue: ${rawLots.length} lots`);
            // Stamp provenance for persist / house_skills.extractor (the static
            // path doesn't pass through the engine/Gemini stampers).
            setLastScrapeEngine('http');
            setLastExtractorUsed('recogniser');
            await enrichAndPersistLots(rawLots);
            try { await setCataloguePage1Hash(house, createHash('md5').update(html).digest('hex')); } catch { /* best-effort */ }
            outcome = 'changed';
            return;
          }
          console.log(`AUTO: ${house} — static recognition 0 lots, falling through to engine router`);
        } catch (e) {
          console.log(`AUTO: ${house} — static catalogue fetch failed (${e.message}), falling through`);
        }
      }

      // ── Best-engine-first router (docs/ENGINE-ROUTER.md) ──
      const { engine: chosenEngine, reason: engineReason } = resolveEngine(recogniser);
      const crawleeMaxPages = rec?.maxPages || (isPaginated ? 25 : 1);

      // Promoted / locked / zero-credit failover → Crawlee only (recogniser-aware).
      // crawleeTried guards the recogniser houses that already ran Crawlee in
      // the HOUSE_OVERRIDES block this pass — one render+extract per cycle.
      if (chosenEngine === ENGINES.CRAWLEE && !crawleeTried) {
        console.log(`AUTO: ${house} → engine crawlee (${engineReason})`);
        const res = await runCrawleePrimary({ recogniseFromMarkdown: recogniser, recallSentinelPattern, maxPages: crawleeMaxPages, paginateAs: rewritten.paginateAs || null, reason: engineReason });
        if (res.enginePatch) enginePatch = res.enginePatch;
        if (res.done) { outcome = res.outcome; return; }
        // 0 lots from Crawlee — fall through to the legacy render pipeline below.
      }

      // Firecrawl JSON extract + FIRE-1 agent removed (CF-bypass-only). The
      // Crawlee primary above serves the house; if it yields 0 lots we fall
      // through to the legacy render pipeline (Crawlee → Puppeteer → HTTP +
      // Gemini) below.
    } catch (primaryErr) {
      console.log(`AUTO: ${house} — primary engine error (${primaryErr.message}), falling back to legacy pipeline`);
    }
  }

  // ── Stage 1: Probe — HTML change detection ──
  const probeResult = await probe(
    { url, house, scrapeUrl, normalisedUrl },
    { fetchPage: _deps.fetchPage },
  );
  if (probeResult.skip) {
    hashHitCount++;
    outcome = 'same';
    return;
  }
  autoAnalyseOne._lastContentHash = probeResult.contentHash;

  // ── Stage 2: Scrape — fetch raw lots from catalogue ──
  const scrapeDeps = {
    scrapeAllsopApi: _deps.scrapeAllsopApi,
    extractAllsopLotsFromJson: _deps.extractAllsopLotsFromJson,
    scrapeSymondsAndSampson: _deps.scrapeSymondsAndSampson,
    scrapeRenderedPage: _deps.scrapeRenderedPage,
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
          // The recursive call re-analysed under the repaired URL (recording its
          // own outcome/liveness). Mark this so the outer 'error' below doesn't
          // degrade a house that just recovered.
          healedSuccessfully = true;
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
    outcome = 'error';
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
  outcome = 'changed';

  } catch (autoErr) {
    outcome = 'error';
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
  } finally {
    // Adaptive scheduling: persist this scrape's outcome so the cadence
    // for next run reflects what actually happened. outcome stays null on
    // pure-skip paths (circuit breaker, blocked, knightfrank index) so
    // those don't perturb the backoff state.
    if (outcome && house) {
      try {
        await recordScrapeOutcome(supabase, house, outcome);
      } catch (e) {
        console.warn(`scheduling: recordScrapeOutcome failed for ${house}: ${e.message}`);
      }
    }
    // ── Liveness: degrade a house whose run extracted NOTHING ──
    // The happy path updates health inside persistStage; this covers the
    // zero-lot / exception outcomes that return BEFORE persist. Without it,
    // house_skills.status and the in-memory health map stay 'healthy' from the
    // last good run while the DB lots persist — the exact blind spot that let
    // 6+ dead crawlers read as "all clear" on 2026-06-17. Skipped when healing
    // already recovered the house this cycle.
    if (outcome === 'error' && house && !healedSuccessfully) {
      try {
        if (_deps.harnessUpdateHealth) {
          _deps.harnessUpdateHealth(house, { lots: { lots: [], batchQuality: 0 }, extractionMethod: 'none' });
        }
        // Stamp the per-run extracted count (distinct from total-lots-in-DB) so
        // the health surfaces can tell a dead crawler from a live, full feed.
        await supabase.from('house_skills').update({ last_extracted_count: 0 }).eq('slug', house);
      } catch (e) {
        console.warn(`liveness: failed to record zero-extraction for ${house}: ${e.message}`);
      }
    }
    // Engine-router: persist engine_stats and any preferred_engine promotion.
    // Best-effort — the scrape itself already succeeded; telemetry is a side channel.
    if (enginePatch && house) {
      try {
        await supabase.from('house_skills').update(enginePatch).eq('slug', house);
      } catch (e) {
        console.warn(`engine-router: house_skills update failed for ${house}: ${e.message}`);
      }
    }
    // Outcome side channel for callers that need to know what this run did
    // ('same' | 'changed' | 'error' | null) without changing the return shape
    // every existing caller ignores. The freshness pulse uses it to flap-damp
    // houses whose page-1 hash churns. Per-call callback → race-free under
    // concurrent autoAnalyseOne runs (unlike a static property).
    if (typeof opts.onOutcome === 'function') {
      try { opts.onOutcome(outcome); } catch { /* observer must never break the scrape */ }
    }
  }
}

// ── computeScrapeDiff — delegated to lib/pipeline/scrape-diff.js ──
const computeScrapeDiff = computeScrapeDiffImpl;

// ── updateHouseSkill — thin wrapper delegating to lib/pipeline/house-skills.js ──
async function updateHouseSkill(slug, params) {
  return _updateHouseSkillImpl(slug, params);
}

// ── dbRowToLot, LOTS_SELECT — imported directly from lib/types/lot.js (canonical) ──
// The legacy createDbRowToLot factory + dbRowToFrontendLot duplicate mapper were
// retired with the lot-contract consolidation. dbRowToLot is now a pure function
// returning the consolidated union shape used by both internal and frontend consumers.

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
export { upsertLotGroups };
export { extractPriceFromText, runEnrichmentWave, drainHygieneRetries, logActivityEvent };
