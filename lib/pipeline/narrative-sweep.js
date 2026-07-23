// lib/pipeline/narrative-sweep.js
//
// Daily sweep that fills lot.description — the source auction house's own
// narrative — for active inventory.
//
// Catalogue scrapes capture short bullets; the real narrative ("The property
// comprises…", situation, accommodation) lives on the lot detail page. The
// audit of 2026-07-04 found the portfolio averaging under 50 characters of
// narrative per lot (Bond Wolfe: 16) while the source pages carry 300–2,500
// characters. This sweep extracts it house-agnostically.
//
// Two passes, mirroring multi-image-sweep.js:
//   PASS 1 — cache reconciliation (FREE). ~79% of visible lots already have
//     fresh detail-page HTML in lot_details (written by first-contact,
//     enrichment and the image sweep). Extract narrative straight from the
//     cache — no fetch, no cost.
//   PASS 2 — live fetch for the remainder, fair-shared across houses,
//     bounded by the wall-clock guard. fetchLotPage's HTTP→Crawlee chain
//     costs no Firecrawl credits.
//
// Cross-lot boilerplate ("how to bid", guide-price definitions, agent
// disclaimers) is stripped by computeDescriptionBleed across each run's
// staged results — repeated paragraphs are chrome, unique ones are narrative.

import { supabase } from '../supabase.js';
import { fetchLotPage } from '../scraper/lot-detail.js';
import { fireAlert } from '../harness/alert-router.js';
import { recordNarrativeSweep } from '../enrichment-manifest.js';
import { log } from '../logging.js';
import { fairShareByHouse } from './post-auction-sweep.js';
import { analyseLot } from './scoring.js';
import { buildSearchText } from './persist-lots.js';
import { LOTS_SELECT, dbRowToLot } from '../types/lot.js';
import { Worker } from 'worker_threads';
import {
  computeDescriptionBleed, assembleDescription,
  shouldUpgradeDescription,
} from './description-extract.js';

// jsdom@24 leaks ~1.5MB of unreclaimable heap PER PARSE (see the worker file
// header) — at sweep scale that OOM-killed the prod process daily at 07:00.
// Each batch is parsed in a short-lived worker thread instead: the leak dies
// with the worker. A worker error/timeout resolves to null per input (those
// lots simply aren't staged this run and retry next sweep), never throws.
const EXTRACT_WORKER_PATH = new URL('./description-extract-worker.js', import.meta.url);
const EXTRACT_WORKER_TIMEOUT_MS = 90_000;

function extractParasBatchIsolated(htmls) {
  if (!htmls || htmls.length === 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const fallback = () => htmls.map(() => null);
    let w;
    try {
      w = new Worker(EXTRACT_WORKER_PATH, { workerData: { htmls } });
    } catch (err) {
      log.warn('narrative-sweep: extract worker failed to start', { err: err.message });
      return resolve(fallback());
    }
    timer = setTimeout(() => {
      log.warn('narrative-sweep: extract worker timeout — batch skipped, lots retry next run', { batch: htmls.length });
      try { w.terminate(); } catch { /* already dead */ }
      finish(fallback());
    }, EXTRACT_WORKER_TIMEOUT_MS);
    w.once('message', (parasList) => { finish(parasList); w.terminate().catch(() => {}); });
    w.once('error', (err) => {
      log.warn('narrative-sweep: extract worker error — batch skipped', { err: err.message });
      finish(fallback());
    });
    w.once('exit', () => finish(fallback())); // exit without message → skip batch
  });
}

const SWEEP_BATCH_LIMIT = 400;             // live-fetch cap/run — politeness dial; wall-clock is the real guard
const SWEEP_FETCH_POOL = 2000;             // candidate rows pulled from the DB
const RECONCILE_CACHE_CAP = 2000;          // cache-reconcile rows/run (memory-safe since chunked streaming)
// Cache reconciliation streams in small chunks: ≤ this many raw detail-page
// HTMLs are ever held in memory at once. Bulk-loading the whole cap (500 pages
// × up to multi-MB each) OOM-killed the entire prod process at 07:00 daily —
// the container died with no stack, rebooted, re-fired the sweep inside the
// 5-minute schedule window, and died again (2026-07-22 boot-loop, 3 crashes in
// 5 min). Peak memory is now one chunk regardless of the cap above.
const CACHE_CHUNK = 25;
const SWEEP_WALL_CLOCK_MS = 25 * 60_000;   // hard cap — bail, next run resumes
const SWEEP_COOLDOWN_DAYS = 14;            // gates the LIVE fetch only; cache pass ignores it
const PER_FETCH_TIMEOUT_MS = 30000;
const FETCH_GAP_MS = 500;
// A stored description shorter than this is treated as "still under target" —
// eligible for upgrade. Was 80, which declared a single wrapped recogniser
// bullet "done" and permanently locked out the source's 300–2,500-char
// narrative sitting in the detail-page cache. The prefer-longer guard in
// persistOutcome makes re-sweeping safe: stored text only ever grows.
const DESCRIPTION_TARGET_CHARS = 300;
const BLEED_MIN_LOTS = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function zeroStats() {
  return {
    eligible: 0, fetched: 0, reconciledFromCache: 0,
    descriptionAdded: 0, noDescriptionFound: 0,
    urlDead: 0, fetchFailed: 0, totalCharsAdded: 0,
  };
}

// Batch-read fresh lot_details cache HTML for a set of URLs (chunked IN()).
async function loadFreshCache(urls) {
  const map = new Map();
  const nowIso = new Date().toISOString();
  const CHUNK = 50;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('lot_details')
      .select('url, html')
      .in('url', chunk)
      .gt('expires_at', nowIso);
    if (error) {
      log.warn('narrative-sweep: cache batch read failed (continuing)', { err: error.message });
      continue;
    }
    for (const row of (data || [])) if (row.html) map.set(row.url, row.html);
  }
  return map;
}

/**
 * Fill lot.description for visible lots that have little or no narrative.
 * @param {object} [opts]
 * @param {string} [opts.house] - restrict to one house slug (operator use).
 * @param {number} [opts.batchLimit] - override the live-fetch cap.
 */
export async function sweepNarratives(opts = {}) {
  const startedAt = Date.now();
  const cooldownCutoff = new Date(Date.now() - SWEEP_COOLDOWN_DAYS * 86400000).toISOString();
  const houseScope = opts.house || null;
  const batchLimit = opts.batchLimit || SWEEP_BATCH_LIMIT;
  // Same visibility rationale as multi-image-sweep: only sweep lots a user
  // could actually see (21-day gate + generous margin).
  const recencyCutoff = new Date(Date.now() - 45 * 86400000).toISOString();

  let q = supabase
    .from('lots')
    .select('id, house, url, description, auction_date, enrichment_manifest, beds')
    .in('status', ['available', 'unsold', 'stc'])
    .not('url', 'is', null)
    .gte('last_seen_at', recencyCutoff)
    .order('auction_date', { ascending: true, nullsFirst: false })
    .limit(SWEEP_FETCH_POOL);
  if (houseScope) q = q.eq('house', houseScope);
  const { data: rawCandidates, error } = await q;

  if (error) {
    log.error('narrative-sweep: candidate query failed', { err: error.message });
    return zeroStats();
  }

  const underTarget = (rawCandidates || []).filter(
    lot => !lot.description || lot.description.length < DESCRIPTION_TARGET_CHARS,
  );
  if (underTarget.length === 0) {
    log.info('narrative-sweep: no candidates below narrative target');
    return zeroStats();
  }

  // Cooldown split — cooled lots can only be helped for free from cache.
  const cooled = [];
  const fresh = [];
  for (const lot of underTarget) {
    const lastSweep = lot.enrichment_manifest?.narrative_sweep?.recorded_at;
    if (lastSweep && lastSweep > cooldownCutoff) cooled.push(lot);
    else fresh.push(lot);
  }

  const stats = { ...zeroStats(), wallClockBailed: false };
  const staged = []; // { lot, paras }

  // ── PASS 1 — cache reconciliation (no fetch, no cost) ──
  // Cache-first for ALL candidates, not just cooled ones: 79% of visible lots
  // already have fresh HTML, so most of the backlog clears without a fetch.
  // STREAMED in CACHE_CHUNK batches: load a chunk of HTML, extract the (small)
  // paragraph lists, and let the raw HTML go before the next chunk — the paras
  // kept for the bleed pass are ~1-3KB/lot, the HTML is not. Wall-clock guard
  // applies here too: a clean bail persists everything staged so far.
  const cacheTargets = [...cooled, ...fresh].slice(0, RECONCILE_CACHE_CAP);
  const servedFromCache = new Set();
  for (let i = 0; i < cacheTargets.length; i += CACHE_CHUNK) {
    if (Date.now() - startedAt > SWEEP_WALL_CLOCK_MS) {
      stats.wallClockBailed = true;
      log.warn('narrative-sweep: wall-clock budget reached in cache pass — stopping early', {
        elapsedSec: Math.round((Date.now() - startedAt) / 1000), reconciled: stats.reconciledFromCache,
      });
      break;
    }
    const chunk = cacheTargets.slice(i, i + CACHE_CHUNK);
    const cacheMap = await loadFreshCache(chunk.map(l => l.url));
    const withHtml = chunk.filter(l => cacheMap.get(l.url));
    const parasList = await extractParasBatchIsolated(withHtml.map(l => cacheMap.get(l.url)));
    withHtml.forEach((lot, idx) => {
      if (parasList[idx] == null) return; // worker failure — retry next run
      staged.push({ lot, paras: parasList[idx] });
      servedFromCache.add(lot.id);
      stats.reconciledFromCache++;
    });
    cacheMap.clear();
    // Yield between chunks: lets GC reclaim the chunk's HTML + JSDOM transients
    // and keeps the event loop responsive to HTTP traffic mid-sweep.
    await sleep(25);
    // Memory heartbeat every ~500 lots — this path OOM-killed the whole prod
    // process before it was streamed (2026-07-22 boot-loop), so its footprint
    // stays observable. One log line per 20 chunks, not noise.
    if ((i / CACHE_CHUNK) % 20 === 19) {
      const mu = process.memoryUsage();
      log.info('narrative-sweep: cache pass heartbeat', {
        reconciled: stats.reconciledFromCache, staged: staged.length,
        rssMb: Math.round(mu.rss / 1048576), heapMb: Math.round(mu.heapUsed / 1048576),
      });
    }
  }

  // ── PASS 2 — live fetch for not-cooled lots without cache ──
  const fetchable = fresh.filter(l => !servedFromCache.has(l.id));
  // Deal-signal priority: 5+ bed lots carry the highest archetype upside per
  // character of narrative (HMO / investment-valuation detection), so they go
  // first within the fair-share cap.
  fetchable.sort((a, b) => ((b.beds >= 5) ? 1 : 0) - ((a.beds >= 5) ? 1 : 0));
  const eligible = fairShareByHouse(fetchable, batchLimit);
  stats.eligible = eligible.length;
  log.info('narrative-sweep: starting', {
    house: houseScope, pool: (rawCandidates || []).length, underTarget: underTarget.length,
    cooled: cooled.length, reconciledFromCache: stats.reconciledFromCache,
    scheduledFetch: eligible.length,
  });

  // Fetched pages buffer in small batches and extract through the same
  // short-lived worker as the cache pass — an inline parse here would leak the
  // same ~1.5MB/page that killed the process (up to 400 fetches/run = ~600MB).
  let fetchBuffer = []; // { lot, html }
  const flushFetchBuffer = async () => {
    if (fetchBuffer.length === 0) return;
    const batch = fetchBuffer;
    fetchBuffer = [];
    const parasList = await extractParasBatchIsolated(batch.map(b => b.html));
    batch.forEach((b, idx) => {
      if (parasList[idx] == null) return; // worker failure — retry next run
      staged.push({ lot: b.lot, paras: parasList[idx] });
    });
  };

  for (const lot of eligible) {
    if (Date.now() - startedAt > SWEEP_WALL_CLOCK_MS) {
      stats.wallClockBailed = true;
      log.warn('narrative-sweep: wall-clock budget reached — stopping early', {
        elapsedSec: Math.round((Date.now() - startedAt) / 1000),
        processedSoFar: stats.fetched + stats.urlDead + stats.fetchFailed,
      });
      break;
    }
    let fetchResult;
    try {
      fetchResult = await Promise.race([
        fetchLotPage(lot.url, { house: lot.house, skipCache: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('per-fetch timeout')), PER_FETCH_TIMEOUT_MS)),
      ]);
    } catch (err) {
      stats.fetchFailed++;
      await persistOutcome(lot, { status: 'fetch_failed', error: err.message, description: null });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    stats.fetched++;

    if (!fetchResult || !fetchResult.html) {
      stats.urlDead++;
      await persistOutcome(lot, { status: 'url_dead', description: null });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    fetchBuffer.push({ lot, html: fetchResult.html });
    if (fetchBuffer.length >= CACHE_CHUNK) await flushFetchBuffer();
    await sleep(FETCH_GAP_MS);
  }
  await flushFetchBuffer(); // includes the wall-clock-bail remainder

  // ── Cross-lot boilerplate strip, then persist ──
  const bleed = computeDescriptionBleed(
    staged.map(s => ({ house: s.lot.house, paras: s.paras })),
    BLEED_MIN_LOTS,
  );
  if (bleed.size) {
    const paras = [...bleed.values()].reduce((n, set) => n + set.size, 0);
    log.info('narrative-sweep: cross-lot boilerplate strip active', { houses: bleed.size, paras });
  }

  for (const { lot, paras } of staged) {
    const description = assembleDescription(paras, bleed.get(lot.house || ''));
    if (shouldUpgradeDescription(lot.description, description)) {
      stats.descriptionAdded++;
      stats.totalCharsAdded += description.length;
      await persistOutcome(lot, { status: 'description_added', description, chars: description.length });
    } else if (description) {
      // Extracted text is no longer than what's stored — prefer-longer says the
      // narrative only ever grows. Record the attempt (starts the cooldown)
      // without touching the row.
      stats.noDescriptionFound++;
      await persistOutcome(lot, { status: 'shorter_than_existing', chars: description.length, description: null });
    } else {
      stats.noDescriptionFound++;
      await persistOutcome(lot, { status: 'no_description_found', description: null });
    }
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  log.info('narrative-sweep: complete', { elapsedSec, ...stats });

  await fireAlert({
    type: 'narrative_sweep',
    severity: 'info',
    house: null,
    message: `Narrative sweep: ${stats.reconciledFromCache} from cache, ${stats.fetched}/${stats.eligible} fetched, ${stats.descriptionAdded} descriptions added (${Math.round(stats.totalCharsAdded / 1000)}k chars), ${stats.noDescriptionFound} none found, ${stats.urlDead} dead, ${stats.fetchFailed} failed`,
    meta: { ...stats, elapsedSec },
  }).catch(err => log.warn('narrative-sweep: fireAlert failed', { err: err.message }));

  return stats;
}

async function persistOutcome(lot, outcome) {
  let manifest = lot.enrichment_manifest || {};
  let update = {};

  // A newly-harvested narrative must feed detection, not just display: before
  // 2026-07-13 this wrote description via a bare .update(), so sweep text
  // never re-ran analyseLot and never reached search_text until the next
  // catalogue upsert. Re-analyse from the full row and upgrade in place.
  if (outcome.description) {
    const re = await reanalyseWithNarrative(lot.id, outcome.description)
      .catch(err => { log.warn('narrative-sweep: re-analyse failed (description still saved)', { id: lot.id, err: err.message }); return null; });
    if (re) {
      manifest = re.manifest || manifest;
      delete re.manifest;
      update = re;
    }
    update.description = outcome.description;
  }

  recordNarrativeSweep(manifest, {
    status: outcome.status,
    chars: outcome.chars ?? null,
    error: outcome.error ?? null,
  });
  update.enrichment_manifest = manifest;

  const { error } = await supabase.from('lots').update(update).eq('id', lot.id);
  if (error) {
    log.warn('narrative-sweep: lot update failed', { id: lot.id, err: error.message });
  }
}

// Re-run analyseLot over the full row with the new narrative folded in, and
// return the columns to upgrade. Merge rules mirror enrichment-wave Pass 3:
// richer text may only upgrade — signal arrays union, structured fields fill
// only when empty, deal_type never downgrades to Standard, title_split never
// unsets. score/scoreBreakdown are recomputed wholesale (that is the point:
// truer text, truer score — including newly-revealed risks).
async function reanalyseWithNarrative(lotId, description) {
  const { data: row, error } = await supabase
    .from('lots').select(LOTS_SELECT).eq('id', lotId).single();
  if (error || !row) return null;

  const lot = dbRowToLot(row);
  lot.description = description;
  const analysed = analyseLot(lot);

  const merged = { ...lot };
  merged.score = analysed.score;
  merged.scoreBreakdown = analysed.scoreBreakdown;
  for (const f of ['propType', 'beds', 'tenure', 'condition', 'vacant']) {
    if (merged[f] == null || merged[f] === '') merged[f] = analysed[f];
  }
  merged.opps = [...new Set([...(lot.opps || []), ...(analysed.opps || [])])];
  merged.risks = [...new Set([...(lot.risks || []), ...(analysed.risks || [])])];
  merged.dealSignals = [...new Set([...(lot.dealSignals || []), ...(analysed.dealSignals || [])])];
  if (analysed.dealType && analysed.dealType !== 'Standard') merged.dealType = analysed.dealType;
  if (analysed.titleSplit) {
    merged.titleSplit = true;
    merged.units = Math.max(lot.units || 0, analysed.units || 0);
  }
  if (analysed.statedIncomePa != null) {
    merged.statedIncomePa = analysed.statedIncomePa;
    merged.incomeKind = analysed.incomeKind;
  }

  return {
    score: merged.score,
    score_breakdown: merged.scoreBreakdown,
    opps: merged.opps,
    risks: merged.risks,
    deal_type: merged.dealType || null,
    deal_signals: merged.dealSignals,
    stated_income_pa: merged.statedIncomePa ?? null,
    income_kind: merged.incomeKind || null,
    title_split: merged.titleSplit || null,
    units: merged.units || 0,
    search_text: buildSearchText(merged),
    manifest: analysed._enrichment || null,
  };
}
