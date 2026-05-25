// lib/analysis.js — Auto-analysis orchestration, healing, DB persistence, concurrency
import { log } from './logging.js';
import { supabase } from './supabase.js';
import { HOUSE_ROOTS, detectAuctionHouse, HOUSE_DISPLAY_NAMES, RETIRED_HOUSES } from './houses.js';
import { MAX_AUCTIONS_PER_HOUSE, HEADERS } from './config.js';
import { normaliseUrl } from './utils.js';
import { validateUrl } from './security.js';
import { isCircuitOpen } from './harness/house-health.js';
import { getUnresolvedCount } from './harness/alert-router.js';
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
  recognisePattinsonLotsFromMarkdown,
  recogniseJohnPyeLotsFromMarkdown,
  recogniseMcHughLotsFromMarkdown,
  recogniseMarkJenkinsonLotsFromMarkdown,
  recogniseMaggsLotsFromMarkdown,
  recogniseHollisMorganLotsFromMarkdown,
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
  computeScrapeDiff as computeScrapeDiffImpl,
  logActivityEvent as logActivityEventImpl,
} from './pipeline/index.js';
import { dbRowToLot, LOTS_SELECT } from './types/lot.js';
import { emitPipelineEvent } from './pipeline/types.js';
import { isEligibleNow, recordScrapeOutcome } from './pipeline/scheduling.js';

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
  // The freshness floor inside computeScheduleUpdate caps interval at 7d
  // so no house goes longer than a week without a full extract.
  // Bypass via /api/admin/rescrape (calls autoAnalyseOne directly).
  const houseSlugs = houses.map(a => a._slug || detectAuctionHouse(a.url));
  let skippedAdaptive = 0;
  if (houseSlugs.length > 0) {
    const { data: skillRows } = await supabase
      .from('house_skills')
      .select('slug, next_scrape_at')
      .in('slug', houseSlugs);
    const skillBySlug = new Map((skillRows || []).map(r => [r.slug, r]));
    const now = new Date();
    const eligible = [];
    for (const auction of houses) {
      const slug = auction._slug || detectAuctionHouse(auction.url);
      const skill = skillBySlug.get(slug);
      if (isEligibleNow(skill, now)) {
        eligible.push(auction);
      } else {
        skippedAdaptive++;
        console.log(`AUTO: Skipping ${auction.house} — next_scrape_at ${skill.next_scrape_at} not yet reached`);
      }
    }
    houses.length = 0;
    houses.push(...eligible);
  }

  const neverScrapedCount = houses.filter(a => a._priority <= 1).length;
  console.log(`AUTO: Queued ${houses.length} houses (${skippedByManager.length} skipped by manager, ${skippedAdaptive} skipped by adaptive cadence, ${neverScrapedCount} never-scraped boosted)`);

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
  // Adaptive scheduling: 'same' | 'changed' | 'error' | null (no attempt).
  // Stamped at each outcome point; recorded once in the finally block via
  // recordScrapeOutcome → house_skills.{next_scrape_at,consecutive_same_count,...}.
  // Skip paths (circuit breaker, blocked, knightfrank index) leave it null
  // so no cadence state changes from a non-attempt.
  let outcome = null;

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
    // McHugh & Co runs on the EIG platform but routes through their own
    // domain. The catalogue page returns ~500 KB of markdown with 200+
    // lots inline — too dense for the JSON extractor in one shot. The
    // recogniser parses the stable `### Lot N` / `#### {address}` blocks
    // following each `/lot/details/{N}` link to recover full recall.
    mchughandco: {
      maxPages: 1,
      recallSentinelPattern: /\/lot\/(?:details|redirect)\/(\d+)/g,
      recogniseFromMarkdown: recogniseMcHughLotsFromMarkdown,
    },
    // Mark Jenkinson runs three concurrent auctions on /auction/{token}
    // URLs (seeded into auction_calendar with their dates). Each catalogue
    // returns 10–170 lots in a stable block layout. The JSON extractor
    // under-counted (15/73 observed) and mis-classified all surviving
    // lots as sold — the recogniser parses the markdown deterministically.
    markjenkinson: {
      maxPages: 1,
      recallSentinelPattern: /markjenkinson\.co\.uk\/property\/([a-z0-9_]+)/gi,
      recogniseFromMarkdown: recogniseMarkJenkinsonLotsFromMarkdown,
    },
    // Maggs & Allen `/search-auction/?auction={N}` view. The JSON extractor
    // gets ~24/38 lots — it drops any lot preceded by SOLD-overlay images
    // and the "LOT TBC" entries used to preview the next auction. The
    // markdown recogniser parses every **LOT N** / **LOT TBC** block and
    // recovers the missing ones. Verified 2026-05-11 on /?auction=3 (current
    // 20 May 2026 catalogue: 31 numbered lots + 7 LOT TBC June 25 previews).
    //
    // changeTracking: false — Pattinson precedent. Without this, Firecrawl's
    // changeTracking layer was returning an empty payload (no markdown, no
    // JSON lots) on roughly half of scrapes from 2026-05-10 onward, causing
    // the recogniser to see empty markdown and the orchestrator to fall back
    // to Gemini, which mis-classified all 9 lots as `status='stc'`. Always
    // re-rendering is cheaper than the bad-data cleanup that follows the
    // alternative.
    maggsandallen: {
      maxPages: 1,
      changeTracking: false,
      recallSentinelPattern: /\/property-details\/(\d+)\//g,
      recogniseFromMarkdown: recogniseMaggsLotsFromMarkdown,
    },
    // Hollis Morgan `/search-auction/` returns 100+ lot cards using their own
    // CMS shape (`#### Lot N` / `### address` / `#### **£price**` / bullets /
    // [SHOW ME MORE](.../property-details/<id>/...)). Not EIG white-label —
    // the visual similarity to Maggs is coincidental. Verified 2026-05-11
    // probe: Maggs shape matches 0 lots; Hollis-specific shape matches 118.
    hollismorgan: {
      maxPages: 1,
      recallSentinelPattern: /\/property-details\/(\d+)/g,
      recogniseFromMarkdown: recogniseHollisMorganLotsFromMarkdown,
    },
  };
  if (HOUSE_OVERRIDES[house]) {
    try {
      const ovr = HOUSE_OVERRIDES[house];

      // Page-1 content-hash gate. changeTracking crashes Pattinson and
      // returns empty payloads for Maggs (see the override comments above),
      // so those houses can't use Firecrawl's native unchanged-check. For
      // the paginated one (Pattinson — 84 pages), a single ~1-credit rawHtml
      // hash of page 1 lets us skip the whole extract when nothing changed.
      let page1Hash = null;
      if (ovr.changeTracking === false && ovr.maxPages > 1 && !forceFresh) {
        try {
          const r = await _deps.scrapeWithFirecrawl(scrapeUrl, { formats: ['rawHtml'] });
          const html = r?.html || '';
          if (html) {
            page1Hash = createHash('md5').update(html).digest('hex');
            const priorHash = await getCataloguePage1Hash(house);
            if (priorHash && priorHash === page1Hash) {
              console.log(`AUTO: ${house} unchanged (page-1 hash gate) — skipping ${ovr.maxPages}-page extract`);
              hashHitCount++;
              outcome = 'same';
              return;
            }
          }
        } catch (probeErr) {
          // Fail open — a failed probe just means we run the full extract.
          console.log(`AUTO: ${house} — page-1 hash probe failed (${probeErr.message}), full extract`);
        }
      }

      const tpResult = await extractCatalogueListing(scrapeUrl, house, ovr);
      if (tpResult.skipped) {
        console.log(`AUTO: ${house} unchanged (Firecrawl changeTracking) — skipping`);
        hashHitCount++;
        outcome = 'same';
        return;
      }
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
        // Persisted OK — store page 1's hash so the next run can gate on it.
        if (page1Hash) await setCataloguePage1Hash(house, page1Hash);
        outcome = 'changed';
        return;
      }
      console.log(`AUTO: ${house} — Firecrawl JSON returned 0 lots, falling back to legacy`);
    } catch (tpErr) {
      console.log(`AUTO: ${house} — Firecrawl JSON error (${tpErr.message}), falling back to legacy`);
    }
  }

  // ── Firecrawl-native extraction (unconditional since 2026-05-08) ──
  // The feature flag and FORCE_EXTRACT_HOUSES safelist were retired with
  // the DOM-extractor system. Firecrawl JSON extract runs for every house
  // except the Allsop JSON-API exception (handled via paginateAs upstream).
  const FC_EXTRACT_SKIP = [];

  // Recall sentinel: per-house regex (one capture group = lot id) used for
  // logging + recall_diagnostic alerts. Counts how many distinct lot ids appear
  // in Firecrawl markdown vs how many made it into JSON — exposes recall
  // regressions without per-house extractors. Houses without any sentinel still
  // scrape; they just don't emit the recall metric.
  //
  // Resolution order (see detectPlatformSentinel + line 648 below):
  //   1. Per-house override in HOUSE_OVERRIDES (pattinson, johnpye)
  //   2. Explicit entry in RECALL_SENTINELS (this map — bespoke patterns + whitelabel platforms)
  //   3. Auto-detection from HOUSE_ROOTS URL via detectPlatformSentinel()
  //   4. null (no sentinel — the house is a coverage blind spot)
  const RECALL_SENTINELS = {
    // EIG-platform sites — /lot/details/{id} or /lot/redirect/{id}
    // Whitelabel EIG (custom domains) need explicit entries; the *.eigonlineauctions.com
    // and *.eigpropertyauctions.co.uk variants are auto-detected by detectPlatformSentinel().
    paulfosh: /\/lot\/(?:details|redirect)\/(\d+)/g,
    harmanhealy: /\/lot\/(?:details|redirect)\/(\d+)/g,
    tcpa: /\/lot\/(?:details|redirect)\/(\d+)/g,
    firstforauctions: /\/lot\/(?:details|redirect)\/(\d+)/g,
    purplebricksgoto: /\/lot\/(?:details|redirect)\/(\d+)/g,
    auctionhouse: /\/lot\/(?:details|redirect)\/(\d+)/g,
    auctionhouseuklondon: /\/lot\/(?:details|redirect)\/(\d+)/g,
    auctionhousenational: /\/lot\/(?:details|redirect)\/(\d+)/g,
    // Whitelabel EIG verified via lots.url sample (2026-05-05) — same /lot/details/{id} format:
    seelauctions:             /\/lot\/(?:details|redirect)\/(\d+)/g, // online.seelauctions.co.uk
    sheldonbosley:            /\/lot\/(?:details|redirect)\/(\d+)/g, // online.sbkauctions.co.uk
    benjaminstevens:          /\/lot\/(?:details|redirect)\/(\d+)/g, // online.benjaminstevensauctions.co.uk
    hmox:                     /\/lot\/(?:details|redirect)\/(\d+)/g, // auctions.hmox.co.uk
    henrysykes:               /\/lot\/(?:details|redirect)\/(\d+)/g, // onlineauctions.henrysykes.co.uk
    sarahmains:               /\/lot\/(?:details|redirect)\/(\d+)/g, // www.auctionworks.co.uk
    cotswoldpropertyauctions: /\/lot\/(?:details|redirect)\/(\d+)/g, // cotswoldpropertyauctions.co.uk — pattern inferred (no lots in DB yet)
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

    // Network (BTG Eddisons live-stream catalogue) —
    // /properties/{lot-id-with-suffix}/for-auction-{location}
    network: /btgeddisonspropertyauctions\.com\/properties\/([\w-]+?)(?:-\d+)?\/for-auction/gi,

    // ── Bespoke houses (added 2026-05-05, regexes derived from lots.url samples) ──
    // Numeric ID at end of path
    andrewcraig:               /\/property\/[a-z0-9-]+\/(\d{5,})/gi,
    auctionestates:            /\/property\/[a-z0-9-]+-(\d{5,})(?:[/?#]|$)/gi,
    bradleyhall:               /\/lot\/details\/(\d+)/gi,
    bradleysdevon:             /\/properties\/(\d{6,})\/sales/gi,
    cleetompkinson:            /\/properties\/(\d{6,})\/sales/gi,
    connectuk:                 /\/property-details\/sales\/[a-z0-9-]+\/(\d+)/gi,
    gth:                       /gth\.net\/properties\/(\d{6,})\/sales/gi,
    johnfrancis:               /johnfrancis\.co\.uk\/properties\/(\d{6,})\/sales/gi,
    knightfrank:               /knightfrankauctions\.com\/property\/(\d+)/gi,
    landwood:                  /landwoodpropertyauctions\.com\/lot\/details\/(\d+)/gi,
    lsh:                       /propertyauctions\.lsh\.co\.uk\/lot\/details\/(\d+)/gi,
    maggsandallen:             /maggsandallen\.co\.uk\/property-details\/(\d+)/gi,
    mccartneys:                /mccartneys\.co\.uk\/property-details\/(\d+)/gi,
    nesbits:                   /nesbits\.co\.uk\/property\/[a-z0-9-]+\/(\d+)/gi,
    robinjessop:               /\/lot\/details\/(\d+)/gi,
    shonkibros:                /shonkibros\.com\/auctions\/lot\/details\/\d+\/(\d+)/gi,
    suttonkersh:               /suttonkersh\.co\.uk\/properties\/lot\/(\d+)/gi,
    walkersingleton:           /onlinesales\.walkersingleton\.co\.uk\/auctions\/info\/id\/(\d+)/gi,
    cheffins:                  /cheffins\.co\.uk\/property-auctions\/lot-view,[a-z0-9-]+_(\d+)\.htm/gi,
    cheffinstimed:             /\/lot\/details\/(\d+)/gi,
    goldings:                  /goldingsauctions\.co\.uk\/lot\/([a-z0-9-]+)/gi,

    // Slug-only paths
    agentsproperty:            /agentspropertyauction\.com\/property\/([a-z0-9-]+)\/?/gi,
    auctionhammermidlands:     /auctionhammermidlands\.co\.uk\/property\/([a-z0-9-]+)\/?/gi,
    cityandruralpropertyauctions: /cityandruralpropertyauctions\.com\/property\/([a-z0-9-]+)\/?/gi,
    dawsons:                   /dawsonsproperty\.co\.uk\/auction\/([a-z0-9-]+)/gi,
    durrants:                  /durrants\.com\/property\/([a-z0-9-]+)\/?/gi,
    jjmorris:                  /jjmorris\.com\/properties\/sale\/[a-z-]+\/[a-z-]+\/([a-z0-9-]+)\/?/gi,
    pearsonferrier:            /pearsonferrier\.co\.uk\/property\/([a-z0-9-]+)\/?/gi,
    philliparnold:             /philliparnoldauctions\.co\.uk\/auction\/property\/([a-z0-9-]+)\/?/gi,
    probateauction:            /probate\.auction\/properties\/([a-z0-9-]+)\/?/gi,
    propertysolvers:           /auctions\.propertysolvers\.co\.uk\/auction-property-for-sale\/([a-z0-9-]+)\/?/gi,
    robinsonhall:              /robinsonandhallauctions\.co\.uk\/property\/([a-z0-9-]+)\/?/gi,
    strettons:                 /strettons\.co\.uk\/auction-property-for-sale\/([a-z0-9-]+-[a-f0-9]{20,})/gi,
    underthehammer:            /underthehammer\.com\/for-auction\/([a-z0-9-]+)(?:[/?#]|$)/gi,
    symondsandsampson:         /auctions\.symondsandsampson\.co\.uk\/property\/[a-z-]+\/([a-z0-9-]+)/gi,
    brutonknowles:             /brutonknowles\.co\.uk\/property\/([a-z0-9-]+)\/?/gi,

    // Query-string IDs
    barnettross:               /barnettross\.co\.uk\/property\.php\?id=(\d+)/gi,
    cottons:                   /cottons\.co\.uk\/current-auction\.htm\?lid=(\d+)/gi,
    countrywide:               /countrywidepropertyauctions\.co\.uk\/property_details\.php\?[^"\s)]*id=(\d+)/gi,
    sharpesauctions:           /sharpesauctions\.co\.uk\/product-details\.php\?viewid=(\d+)/gi,
    venmore:                   /venmoreauctions\.co\.uk\/Property-Details\?property_reference=([A-Z0-9]+)/gi,

    // Reference-code IDs
    buttersjohnbee:            /buttersjohnbee\.com\/listings\/[a-z_]+_sale-([A-Za-z0-9]+)/gi,
    iamsold:                   /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi,
    kivells:                   /kivells\.com\/properties\/([A-Z]{3}\d{6})/gi,
    pearsons:                  /pearsons\.com\/auctions\/[a-z0-9-]+\/([A-Z]+_\d+)/gi,

    // iamSold platform — lots always route through iamsold.co.uk regardless of
    // the estate-agent's own domain (same 32-char hex UUID format as iamsold).
    driversnorris:              /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi,
    wrightmarshall:             /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi,
    davidjames:                 /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi,

    // SDL / BTG Eddisons network — same path structure as 'network' above but
    // sdlauctions.co.uk is the SDL-branded subdomain for scargillmann.
    sdl:                        /btgeddisonspropertyauctions\.com\/properties\/([\w-]+?)(?:-\d+)?\/for-auction/gi,
    scargillmann:               /sdlauctions\.co\.uk\/properties\/([\w-]+?)(?:-\d+)?\/for-auction/gi,

    // Allsop platform (barnardmarcus hosts foxandsons + bagshaws lots too)
    barnardmarcus:             /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi,
    foxandsons:                /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi,
    bagshaws:                  /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi,

    // Major houses — patterns inferred from extractor selectors (no DB samples yet)
    acuitus:                   /acuitus\.co\.uk\/property\/([a-z0-9-]+)/gi,
    allsop:                    /allsop\.co\.uk\/(?:residential|commercial)\/lot\/(\d+)/gi,
    bondwolfe:                 /bondwolfe\.com\/(?:property|properties|lot)\/([a-z0-9-]+)/gi,
    bidx1:                     /bidx1\.com\/[a-z]{2}\/property\/([a-z0-9-]+)/gi,
    // McHugh runs on the EIG platform but on their own domain — the standard
    // EIG /lot/details/{N} pattern applies. Earlier bespoke pattern
    // (/auction-property|lot/{slug}) never matched the real URLs.
    mchughandco:               /\/lot\/(?:details|redirect)\/(\d+)/g,

    // ── 8 houses sourced from propertyauctions.io sitemap (2026-05-06, Tier 1) ──
    // Hammertime is on EIG platform — sentinel auto-applies via detectPlatformSentinel(),
    // but listed explicitly for uniformity per the "every house gets a sentinel" rule.
    hammertime:                /\/lot\/(?:details|redirect)\/(\d+)/g,
    // Clean patterns — verified from sample lot URLs in discovery research
    swpropertyauctions:        /swpropertyauctions\.co\.uk\/lot\/details\/(\d+)/gi,
    theauctioncompany:         /theauctioncompany\.co\.uk\/lot\/details\/(\d+)/gi,
    // Mixed sample (auction-event + lot pages) — covers both
    auctionproperty:           /auctionproperty\.co\.uk\/(?:property|auction)\/([a-z0-9-]+)/gi,
    // Fallback patterns — discovery script's catalogueUrl was the homepage so
    // exact lot URL not yet observed. Generic keyword-match regex catches
    // /lot/, /property/, /auction/, /listing/ paths with an ID/slug. Will
    // surface real recall once first scrape lands; refine then.
    auctiondepartment:         /auctiondepartment\.com\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
    landmarkauctions:          /landmarkauctions\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
    rocketauctions:            /rocketauctions\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
    swiftauctions:             /swiftpropertyauctions\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,

    // ── 12 houses sourced from Firecrawl /v2/search (2026-05-06) ──
    // Clean patterns observed in lot URLs:
    braveheart:                /braveheartauctions\.co\.uk\/product\/([a-z0-9-]+)/gi,
    gogogone:                  /gogogone\.com\/auction\/(\d+)/gi,
    opagroup:                  /opagroup\.co\.uk\/lot\/details\/(\d+)/gi,
    barneyestates:             /barneyestates\.co\.uk\/property\/([a-z0-9-]+)/gi,
    // Specific multi-segment lot URL structures (manually crafted):
    midulsterauctions:         /online\.midulsterauctions\.com\/lot-details\/index\/catalog\/\d+\/lot\/(\d+)/gi,
    belfastauctions:           /belfastauctions\.com\/catalogue\/lot\/[A-F0-9]+\/[A-F0-9]+\/([a-z0-9-]+)/gi,
    // Fallback patterns — homepage scan didn't reveal lot URL pattern;
    // refine after first recall_diagnostic alert lands:
    firstchoiceauctions:       /firstchoicepropertyauctions\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
    palaceauctions:            /palaceauctions\.com\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
    whoobid:                   /whoobid\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
    propertyauctionhouseswansea: /thepropertyauctionhouse\.com\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
    auctionsni:                /auctionsni\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
    nationalresidential:       /national-residential\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,

    // ── Bespoke houses — patterns sourced from live lot URLs (research 2026-05-22) ──

    // Numeric/path ID patterns:
    aldreds:              /aldreds\.co\.uk\/properties-for-sale\/property\/(\d+[\w-]*)/gi,
    bramleys:             /bramleys\.com\/property-details\/(\d+)/gi,
    cliveemson:           /cliveemson\.co\.uk\/properties\/\d+\/(\d+)/gi,
    earles:               /earlesgroup\.co\.uk\/property-details\/(\d+)/gi,
    grahamwatkins:        /grahamwatkins\.(?:co\.uk|com)\/property\/(\d+)/gi,
    hairandson:           /hairandson\.co\.uk\/lot-details\?lot=(\d+)/gi,
    leonards:             /leonards-property\.co\.uk\/property\.php\?id=(\d+)/gi,
    mellerbraggins:       /mellerbraggins\.com\/property\/[\w-]+\/(\d+)/gi,
    phippsandpritchard:   /phippsandpritchard\.co\.uk\/properties\/(\d+)/gi,
    screetons:            /screetons\.co\.uk\/property\/[\w-]+\/(\d+)/gi,
    taylerandfletcher:    /taylerandfletcher\.co\.uk\/for-sale\/[\w-]+\/[\w-]+\/[\w-]+\/(\d+)/gi,
    webbers:              /webbers\.co\.uk\/property-for-sale\/[\w-]+\/(\d+)/gi,
    wilsons:              /wilsonsauctions\.com\/auctions\/[\w-]+\/lots\/(\d+)/gi,
    woolleyandwallis:     /woolleyandwallis\.co\.uk\/departments\/[\w-]+\/[\w]+\/view-lot\/(\d+)/gi,
    yoowin:               /yoowin\.co\.uk\/lot\/details\/(\d+)/gi,

    // Slug-only paths:
    auctionhouselondon:   /auctionhouselondon\.co\.uk\/lot\/([\w-]+-\d+)/gi,
    bakerwynnewilson:     /bakerwynneandwilson\.com\/property\/([\w-]+)/gi,
    clarkegammon:         /clarkegammon\.co\.uk\/property\/([\w-]+)/gi,
    cloughandco:          /cloughco\.com\/property\/([\w-]+)/gi,
    gherbertbanks:        /gherbertbanks\.co\.uk\/property\/([\w-]+)/gi,
    halls:                /hallsgb\.com\/property_post_item\/([\w-]+)/gi,
    humberts:             /humberts\.com\/property\/([\w-]+)/gi,
    morganbeddoe:         /morgan-beddoe\.co\.uk\/property\/([\w-]+)/gi,
    nicholasjames:        /nicholasjamesproperty\.co\.uk\/property\/([\w-]+)/gi,
    opendoor:             /opendoorauctions\.co\.uk\/properties-for-sale\/([\w-]+)/gi,
    pennineways:          /pennine-ways\.co\.uk\/property\/([\w-]+)/gi,
    phillipssmithanddunn: /phillipsland\.com\/property\/([\w-]+)/gi,
    primepropertyauctions: /primepropertyauctions\.co\.uk\/property\/([\w-]+)/gi,
    smithandsons:         /smithandsons\.net\/auctionproperties\/([\w-]+)/gi,
    wmsykes:              /wmsykes\.co\.uk\/property\/([\w-]+)/gi,

    // Hash/special ID paths:
    strakers:             /strakers\.co\.uk\/(?:auction-)?property-for-sale\/[\w-]+-([0-9a-f]{24})/gi,

    // gwilymrichards lists via Knight Frank Auctions — same host as 'knightfrank' above
    gwilymrichards:       /knightfrankauctions\.com\/property\/(\d+)/gi,
  };

  // Platform-level sentinel auto-detection. EIG, Auction House UK, and Bamboo
  // each share a stable lot URL format across all houses on the platform — so
  // any house whose HOUSE_ROOTS URL is on one of these domains gets the right
  // pattern automatically, no per-house entry needed. Whitelabel sites on
  // custom domains (e.g. harman-healy.co.uk runs on EIG) need an explicit
  // RECALL_SENTINELS entry above.
  function detectPlatformSentinel(slug) {
    const rootUrl = HOUSE_ROOTS[slug] || '';
    // EIG + Auction House UK: both use /lot/details/{id} or /lot/redirect/{id}
    if (rootUrl.includes('eigonlineauctions.com') ||
        rootUrl.includes('eigpropertyauctions.co.uk') ||
        rootUrl.includes('auctionhouse.co.uk')) {
      return /\/lot\/(?:details|redirect)\/(\d+)/g;
    }
    // Bamboo Auctions: /property/{slug-id}
    if (rootUrl.includes('bambooauctions.com')) {
      return /\/property\/([a-z0-9_-]{6,})/gi;
    }
    return null;
  }

  if (rewritten.paginateAs !== 'allsop_api' && !FC_EXTRACT_SKIP.includes(house)) {
    try {
      // Firecrawl extract is unconditional for every non-Allsop house.
      // forceExtract=false lets changeTracking short-circuit unchanged pages.
      // The /api/admin/rescrape endpoint passes forceFresh to bypass this so
      // an operator can re-scrape after an upstream URL/recogniser change
      // without waiting for the Firecrawl change-hash to expire.
      const forceExtract = forceFresh;
      const isPaginated = rewritten.paginateAs && rewritten.paginateAs !== 'allsop_api';
      const recallSentinelPattern = RECALL_SENTINELS[house] || detectPlatformSentinel(house) || null;
      const fcResult = isPaginated
        ? await extractPaginatedCatalogue(scrapeUrl, house, { paginateAs: rewritten.paginateAs, forceExtract, recallSentinelPattern })
        : await extractCatalogueNative(scrapeUrl, house, { forceExtract, recallSentinelPattern });
      if (fcResult.skipped) {
        console.log(`AUTO: ${house} unchanged (Firecrawl changeTracking) — skipping`);
        hashHitCount++;
        outcome = 'same';
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
        outcome = 'changed';
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
            outcome = 'changed';
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
