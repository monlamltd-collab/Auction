// lib/pipeline/floor-plan-sweep.js
//
// Daily sweep that fills lot.floor_plans — the source auction house's floor
// plan(s) — for active inventory.
//
// Why this exists: `floor_plans` was only ever populated by the Firecrawl JSON
// extractor (`floor_plan_url` in lib/scraper/lot-schema.js). That path is gated
// off post-Crawlee-migration, and the lean rebuild then renamed the column
// (floor_plan_url text -> floor_plans jsonb), so on 2026-07-10 *zero* of 6,251
// active lots carried a floor plan — while roughly three quarters of their
// detail pages publish one. Catalogue listings almost never show a plan; it
// lives on the lot detail page, which is exactly what this sweep reads.
//
// Two passes, mirroring narrative-sweep.js:
//   PASS 1 — cache reconciliation (FREE). ~half of visible lots already have
//     fresh detail-page HTML in lot_details (written by first-contact,
//     enrichment, the image sweep and the narrative sweep). Extract the plan
//     straight from cache — no fetch, no cost.
//   PASS 2 — live fetch for the remainder, fair-shared across houses, bounded
//     by the wall-clock guard. fetchLotPage's HTTP->Crawlee chain costs no
//     Firecrawl credits.
//
// Convergence: every lot we actually examine gets an `floor_plan_sweep` stamp
// in the enrichment manifest, whether or not a plan was found. The stamp arms
// the 14-day cooldown, so a lot whose page genuinely has no plan (bare land,
// houses that don't publish plans) drops out of the live-fetch set instead of
// being re-fetched every night. Same mechanism the narrative sweep uses.

import { supabase } from '../supabase.js';
import { fetchLotPage } from '../scraper/lot-detail.js';
import { fireAlert } from '../harness/alert-router.js';
import { recordFloorPlanSweep } from '../enrichment-manifest.js';
import { log } from '../logging.js';
import { fairShareByHouse } from './post-auction-sweep.js';
// House-agnostic floor-plan primitive (unit-tested in tests/test-image-extract.js).
import { extractFloorPlansFromHtml } from './image-extract.js';

const SWEEP_BATCH_LIMIT = 400;             // live-fetch cap/run — politeness dial; wall-clock is the real guard
const SWEEP_FETCH_POOL = 2000;             // candidate rows pulled from the DB
const RECONCILE_CACHE_CAP = 500;           // cache-reconcile rows/run (bounds the HTML payload pulled)
const SWEEP_WALL_CLOCK_MS = 25 * 60_000;   // hard cap — bail, next run resumes
const SWEEP_COOLDOWN_DAYS = 14;            // gates the LIVE fetch only; cache pass ignores it
const PER_FETCH_TIMEOUT_MS = 30000;
const FETCH_GAP_MS = 500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function zeroStats() {
  return {
    eligible: 0, fetched: 0, reconciledFromCache: 0,
    floorPlansAdded: 0, noFloorPlanFound: 0,
    urlDead: 0, fetchFailed: 0, totalPlansAdded: 0,
  };
}

/** A lot still needs a plan when floor_plans is null or an empty array. */
function needsFloorPlan(lot) {
  return !Array.isArray(lot.floor_plans) || lot.floor_plans.length === 0;
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
      log.warn('floor-plan-sweep: cache batch read failed (continuing)', { err: error.message });
      continue;
    }
    for (const row of (data || [])) if (row.html) map.set(row.url, row.html);
  }
  return map;
}

/**
 * Fill lot.floor_plans for visible lots that have none.
 * @param {object} [opts]
 * @param {string} [opts.house] - restrict to one house slug (operator use).
 * @param {number} [opts.batchLimit] - override the live-fetch cap.
 */
export async function sweepFloorPlans(opts = {}) {
  const startedAt = Date.now();
  const cooldownCutoff = new Date(Date.now() - SWEEP_COOLDOWN_DAYS * 86400000).toISOString();
  const houseScope = opts.house || null;
  const batchLimit = opts.batchLimit || SWEEP_BATCH_LIMIT;
  // Same visibility rationale as the image/narrative sweeps: only sweep lots a
  // user could actually see (21-day gate + generous margin).
  const recencyCutoff = new Date(Date.now() - 45 * 86400000).toISOString();

  let q = supabase
    .from('lots')
    .select('id, house, url, floor_plans, auction_date, enrichment_manifest')
    .in('status', ['available', 'unsold', 'stc'])
    .not('url', 'is', null)
    .gte('last_seen_at', recencyCutoff)
    .order('auction_date', { ascending: true, nullsFirst: false })
    .limit(SWEEP_FETCH_POOL);
  if (houseScope) q = q.eq('house', houseScope);
  const { data: rawCandidates, error } = await q;

  if (error) {
    log.error('floor-plan-sweep: candidate query failed', { err: error.message });
    return zeroStats();
  }

  const underTarget = (rawCandidates || []).filter(needsFloorPlan);
  if (underTarget.length === 0) {
    log.info('floor-plan-sweep: no candidates missing a floor plan');
    return zeroStats();
  }

  // Cooldown split — cooled lots can only be helped for free from cache.
  const cooled = [];
  const fresh = [];
  for (const lot of underTarget) {
    const lastSweep = lot.enrichment_manifest?.floor_plan_sweep?.recorded_at;
    if (lastSweep && lastSweep > cooldownCutoff) cooled.push(lot);
    else fresh.push(lot);
  }

  const stats = { ...zeroStats(), wallClockBailed: false };
  const staged = []; // { lot, plans }

  // ── PASS 1 — cache reconciliation (no fetch, no cost) ──
  // Cache-first for ALL candidates, not just cooled ones: about half of visible
  // lots already hold fresh detail HTML, so much of the backlog clears free.
  const cacheTargets = [...cooled, ...fresh].slice(0, RECONCILE_CACHE_CAP);
  const cacheMap = await loadFreshCache(cacheTargets.map(l => l.url));
  const servedFromCache = new Set();
  for (const lot of cacheTargets) {
    const html = cacheMap.get(lot.url);
    if (!html) continue;
    staged.push({ lot, plans: extractFloorPlansFromHtml(html, lot.url) });
    servedFromCache.add(lot.id);
    stats.reconciledFromCache++;
  }

  // ── PASS 2 — live fetch for not-cooled lots without cache ──
  const fetchable = fresh.filter(l => !servedFromCache.has(l.id));
  const eligible = fairShareByHouse(fetchable, batchLimit);
  stats.eligible = eligible.length;
  log.info('floor-plan-sweep: starting', {
    house: houseScope, pool: (rawCandidates || []).length, underTarget: underTarget.length,
    cooled: cooled.length, reconciledFromCache: stats.reconciledFromCache,
    scheduledFetch: eligible.length,
  });

  for (const lot of eligible) {
    if (Date.now() - startedAt > SWEEP_WALL_CLOCK_MS) {
      stats.wallClockBailed = true;
      log.warn('floor-plan-sweep: wall-clock budget reached — stopping early', {
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
      await persistOutcome(lot, { status: 'fetch_failed', error: err.message, plans: [] });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    stats.fetched++;

    if (!fetchResult || !fetchResult.html) {
      stats.urlDead++;
      await persistOutcome(lot, { status: 'url_dead', plans: [] });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    staged.push({ lot, plans: extractFloorPlansFromHtml(fetchResult.html, fetchResult.url || lot.url) });
    await sleep(FETCH_GAP_MS);
  }

  // ── Persist staged outcomes (manifest always stamped — silent failures banned) ──
  for (const { lot, plans } of staged) {
    if (plans.length > 0) {
      stats.floorPlansAdded++;
      stats.totalPlansAdded += plans.length;
      await persistOutcome(lot, { status: 'captured', plans });
    } else {
      stats.noFloorPlanFound++;
      await persistOutcome(lot, { status: 'none_found', plans: [] });
    }
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  log.info('floor-plan-sweep: complete', { elapsedSec, ...stats });

  await fireAlert({
    type: 'floor_plan_sweep',
    severity: 'info',
    house: null,
    message: `Floor-plan sweep: ${stats.reconciledFromCache} from cache, ${stats.fetched}/${stats.eligible} fetched, ${stats.floorPlansAdded} lots gained a plan (+${stats.totalPlansAdded} plans), ${stats.noFloorPlanFound} none found, ${stats.urlDead} dead, ${stats.fetchFailed} failed`,
    meta: { ...stats, elapsedSec },
  }).catch(err => log.warn('floor-plan-sweep: fireAlert failed', { err: err.message }));

  return stats;
}

async function persistOutcome(lot, outcome) {
  const manifest = lot.enrichment_manifest || {};
  recordFloorPlanSweep(manifest, {
    status: outcome.status,
    floor_plan_count: outcome.plans ? outcome.plans.length : 0,
    error: outcome.error ?? null,
  });

  const update = { enrichment_manifest: manifest };
  // Never overwrite a plan we already hold — first capture wins, and the
  // candidate filter means we only ever reach lots that had none.
  if (outcome.plans && outcome.plans.length > 0 && needsFloorPlan(lot)) {
    update.floor_plans = outcome.plans;
  }

  const { error } = await supabase.from('lots').update(update).eq('id', lot.id);
  if (error) {
    log.warn('floor-plan-sweep: lot update failed', { id: lot.id, err: error.message });
  }
}
