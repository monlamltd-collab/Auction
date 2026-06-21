// lib/pipeline/multi-image-sweep.js
//
// Daily sweep that fills out lot.images galleries for active inventory.
//
// Catalogue scrapes capture a single image_url per lot. The frontend supports a
// multi-image carousel (lot.images array); the detail-page fetch on first
// contact populates it — but lots that pre-date the carousel, or where
// first-contact enrichment didn't fire cleanly, stay stuck. This sweep fills
// them so the gallery quietly completes.
//
// Two passes (both house-agnostic — no per-house code):
//   PASS 1 — cooldown-free cache reconciliation (FREE). For lots whose
//     lot_details cache already holds real photos (refreshed by first-contact /
//     enrichment / a prior fetch) but whose gallery is still empty, fill from
//     the cache. This is what unsticks the `no_images_found` backlog: a stale
//     imageless page was once cached, the sweep recorded no_images_found, the
//     14-day cooldown then blocked re-evaluation — even though the cache has
//     since been refreshed with photos. Reading cache costs nothing, so it
//     ignores the cooldown.
//   PASS 2 — urgency-first live fetch for not-cooled lots; urgent lots
//     (auction within SWEEP_URGENCY_DAYS) bypass the fair-share cap, the rest is
//     fair-shared — both bounded by the wall-clock guard. Fetches with
//     skipCache:true so a stale imageless cache can never drive a false
//     no_images_found verdict again (the root cause).
//
// Throughput: the old 200/day cap existed to bound Firecrawl spend. Post the
// Firecrawl→Crawlee migration, fetchLotPage renders via HTTP→Crawlee (no
// Firecrawl credits in this path), so the cap is now a politeness/wall-clock
// dial, not a cost guard — raised so current inventory reaches full gallery
// coverage in a few runs rather than weeks. Wall-clock is the real ceiling.

import { supabase } from '../supabase.js';
import { fetchLotPage } from '../scraper/lot-detail.js';
import { fireAlert } from '../harness/alert-router.js';
import { recordMultiImageSweep } from '../enrichment-manifest.js';
import { log } from '../logging.js';
// Round-robin selection across houses so a single big-catalogue auction can't
// starve smaller houses out of the daily sweep. Single source of truth shared
// with post-auction-sweep so fairness behaviour stays identical.
import { fairShareByHouse } from './post-auction-sweep.js';
// House-agnostic image primitives (unit-tested in tests/test-image-extract.js).
import { extractImagesFromHtml, computeBleedByHouse, dechromeGallery } from './image-extract.js';

const SWEEP_BATCH_LIMIT = 500;             // live-fetch cap/run — politeness dial now FC spend is out of this path; wall-clock is the real guard
const SWEEP_FETCH_POOL = 1500;             // pull this many candidate rows from the DB
const RECONCILE_CACHE_CAP = 600;           // cooldown-free cache-reconcile cap/run (bounds the cached-HTML payload pulled)
const SWEEP_WALL_CLOCK_MS = 30 * 60_000;   // hard cap — bail at 30 minutes, next run resumes
const SWEEP_COOLDOWN_DAYS = 14;            // gates the LIVE fetch only; cache reconciliation ignores it
const PER_FETCH_TIMEOUT_MS = 30000;
const FETCH_GAP_MS = 500;
const MIN_IMAGES_TARGET = 3;
const SWEEP_URGENCY_DAYS = 7;              // lots auctioning within this many days bypass the fair-share cap

const sleep = ms => new Promise(r => setTimeout(r, ms));

function zeroStats() {
  return {
    eligible: 0, fetched: 0, reconciledFromCache: 0,
    galleryAdded: 0, galleryPartial: 0, noImagesFound: 0,
    urlDead: 0, fetchFailed: 0, totalImagesAdded: 0,
  };
}

/**
 * Split not-cooled, under-target lots into `urgent` (auction within
 * `urgencyDays` of `today`) and `rest`. Urgent lots bypass the PASS-2 fair-share
 * cap so a large imminent-auction catalogue is fully swept before its sale; the
 * rest stay fair-shared. Pure + exported for unit testing. Dates compared as
 * 'YYYY-MM-DD' strings (lexicographic == chronological for ISO dates).
 * @param {Array<{auction_date?: string|null}>} fresh
 * @param {string} today - 'YYYY-MM-DD'
 * @param {number} [urgencyDays=SWEEP_URGENCY_DAYS]
 * @returns {{urgent: Array, rest: Array}}
 */
export function splitFreshByUrgency(fresh, today, urgencyDays = SWEEP_URGENCY_DAYS) {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + urgencyDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const urgent = [], rest = [];
  for (const lot of (fresh || [])) {
    const d = lot && lot.auction_date ? String(lot.auction_date).slice(0, 10) : null;
    if (d && d >= today && d <= cutoffIso) urgent.push(lot);
    else rest.push(lot);
  }
  return { urgent, rest };
}

// Batch-read fresh lot_details cache HTML for a set of URLs (chunked IN()).
async function loadFreshCache(urls) {
  const map = new Map();
  const nowIso = new Date().toISOString();
  const CHUNK = 100;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('lot_details')
      .select('url, html')
      .in('url', chunk)
      .gt('expires_at', nowIso);
    if (error) {
      log.warn('multi-image-sweep: cache batch read failed (continuing)', { err: error.message });
      continue;
    }
    for (const row of (data || [])) if (row.html) map.set(row.url, row.html);
  }
  return map;
}

export async function sweepMultiImages() {
  const startedAt = Date.now();
  const cooldownCutoff = new Date(Date.now() - SWEEP_COOLDOWN_DAYS * 86400000).toISOString();
  const today = new Date(Date.now()).toISOString().slice(0, 10);

  // Current-auction lots FIRST (Tier 1, soonest-auction-first); Tier 2 tops up
  // with the past/undated backlog only if Tier 1 underfills the pool.
  const tier1 = await supabase
    .from('lots')
    .select('id, house, url, images, image_url, auction_date, enrichment_manifest')
    .in('status', ['available', 'unsold'])
    .not('url', 'is', null)
    .or(`images.is.null,images.eq.[]`)
    .gte('auction_date', today)
    .order('auction_date', { ascending: true })
    .limit(SWEEP_FETCH_POOL);

  if (tier1.error) {
    log.error('multi-image-sweep: candidate query failed', { err: tier1.error.message });
    return zeroStats();
  }

  let rawCandidates = tier1.data || [];

  if (rawCandidates.length < SWEEP_FETCH_POOL) {
    const tier2 = await supabase
      .from('lots')
      .select('id, house, url, images, image_url, auction_date, enrichment_manifest')
      .in('status', ['available', 'unsold'])
      .not('url', 'is', null)
      .or(`images.is.null,images.eq.[]`)
      .or(`auction_date.is.null,auction_date.lt.${today}`)
      .order('first_seen_at', { ascending: true })
      .limit(SWEEP_FETCH_POOL - rawCandidates.length);
    if (tier2.error) {
      log.warn('multi-image-sweep: backlog top-up query failed (continuing with upcoming only)', { err: tier2.error.message });
    } else {
      rawCandidates = rawCandidates.concat(tier2.data || []);
    }
  }

  if (rawCandidates.length === 0) {
    log.info('multi-image-sweep: no candidates with empty/null images');
    return zeroStats();
  }

  // Only lots still under the gallery target are worth working.
  const underTarget = rawCandidates.filter(
    lot => (Array.isArray(lot.images) ? lot.images.length : 0) < MIN_IMAGES_TARGET,
  );

  if (underTarget.length === 0) {
    log.info('multi-image-sweep: all candidates already at/above gallery target');
    return zeroStats();
  }

  // Split by cooldown. A cooled lot was swept recently — re-fetching it now
  // would burn the budget the cooldown protects, so it can only be helped for
  // FREE from cache (PASS 1). A fresh lot gets a live fetch (PASS 2).
  const cooled = [];
  const fresh = [];
  for (const lot of underTarget) {
    const lastSweep = lot.enrichment_manifest?.multi_image_sweep?.recorded_at;
    if (lastSweep && lastSweep > cooldownCutoff) cooled.push(lot);
    else fresh.push(lot);
  }

  const stats = { ...zeroStats(), wallClockBailed: false };
  const staged = []; // { lot, images }

  // ── PASS 1 — cooldown-free cache reconciliation (no fetch, no cost) ──
  const reconcileTargets = cooled.slice(0, RECONCILE_CACHE_CAP);
  if (reconcileTargets.length > 0) {
    const cacheMap = await loadFreshCache(reconcileTargets.map(l => l.url));
    for (const lot of reconcileTargets) {
      const html = cacheMap.get(lot.url);
      if (!html) continue;
      const images = extractImagesFromHtml(html, lot.url);
      if (images.length > 0) {
        staged.push({ lot, images });
        stats.reconciledFromCache++;
      }
    }
  }

  // ── PASS 2 — live fetch for not-cooled lots ──
  // Urgency-first: lots auctioning within SWEEP_URGENCY_DAYS bypass the fair-share
  // cap (still bounded by the wall-clock guard below) so a large imminent-auction
  // catalogue is fully swept before its sale; the long tail stays fair-shared so no
  // single big house starves the others. `today` is computed at the top of this fn.
  const { urgent, rest } = splitFreshByUrgency(fresh, today, SWEEP_URGENCY_DAYS);
  const eligible = [...urgent, ...fairShareByHouse(rest, SWEEP_BATCH_LIMIT)];
  stats.eligible = eligible.length;
  log.info('multi-image-sweep: starting', {
    pool: rawCandidates.length, underTarget: underTarget.length,
    cooled: cooled.length, reconciledFromCache: stats.reconciledFromCache,
    urgent: urgent.length, fairShared: eligible.length - urgent.length,
    scheduledFetch: eligible.length,
  });

  for (const lot of eligible) {
    if (Date.now() - startedAt > SWEEP_WALL_CLOCK_MS) {
      stats.wallClockBailed = true;
      log.warn('multi-image-sweep: wall-clock budget reached — stopping early', {
        elapsedSec: Math.round((Date.now() - startedAt) / 1000),
        processedSoFar: stats.fetched + stats.urlDead + stats.fetchFailed,
      });
      break;
    }
    let fetchResult;
    try {
      // skipCache:true — never let a stale imageless cache drive the verdict
      // (the root cause of the false `no_images_found` backlog). fetchLotPage's
      // own HTTP→Crawlee chain is cheap post-Firecrawl-migration.
      fetchResult = await Promise.race([
        fetchLotPage(lot.url, { house: lot.house, skipCache: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('per-fetch timeout')), PER_FETCH_TIMEOUT_MS)),
      ]);
    } catch (err) {
      stats.fetchFailed++;
      await persistOutcome(lot, { status: 'fetch_failed', error: err.message, images: [] });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    stats.fetched++;

    if (!fetchResult || !fetchResult.html) {
      stats.urlDead++;
      await persistOutcome(lot, { status: 'url_dead', images: [] });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    const images = extractImagesFromHtml(fetchResult.html, fetchResult.url || lot.url);
    staged.push({ lot, images });
    await sleep(FETCH_GAP_MS);
  }

  // ── Generic clean across everything gathered this run ──
  // computeBleedByHouse finds images shared across >=3 lots of a house; then
  // dechromeGallery strips chrome + bleed per lot WITH the never-blank-via-bleed
  // guard (a genuinely shared real photo is preserved) and chooses a real
  // thumbnail. Same cleaner the retroactive /api/admin/dechrome-images uses.
  const bleedByHouse = computeBleedByHouse(
    staged.map(s => ({ house: s.lot.house, lotKey: s.lot.id, urls: s.images })),
  );
  for (const s of staged) {
    const bleed = bleedByHouse.get(s.lot.house || '') || new Set();
    const r = dechromeGallery(s.images, s.lot.image_url, bleed);
    s.images = r.images;
    s.newThumb = r.imageUrl;
  }
  if (bleedByHouse.size) {
    const urls = [...bleedByHouse.values()].reduce((n, set) => n + set.size, 0);
    log.info('multi-image-sweep: shared-image guard active', { houses: bleedByHouse.size, urls });
  }

  // ── Persist staged outcomes (manifest always stamped — silent failures banned) ──
  for (const { lot, images, newThumb } of staged) {
    if (images.length === 0) {
      stats.noImagesFound++;
      await persistOutcome(lot, { status: 'no_images_found', images: [] });
    } else if (images.length < MIN_IMAGES_TARGET) {
      stats.galleryPartial++;
      stats.totalImagesAdded += images.length;
      await persistOutcome(lot, { status: 'gallery_partial', images, imageCount: images.length, newThumb });
    } else {
      stats.galleryAdded++;
      stats.totalImagesAdded += images.length;
      await persistOutcome(lot, { status: 'gallery_added', images, imageCount: images.length, newThumb });
    }
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  log.info('multi-image-sweep: complete', { elapsedSec, ...stats });

  await fireAlert({
    type: 'multi_image_sweep',
    severity: 'info',
    house: null,
    message: `Multi-image sweep: ${stats.reconciledFromCache} reconciled from cache, ${stats.fetched}/${stats.eligible} fetched, ${stats.galleryAdded} galleries added, ${stats.galleryPartial} partial, ${stats.noImagesFound} no images, ${stats.urlDead} dead, ${stats.fetchFailed} failed (+${stats.totalImagesAdded} images total)`,
    meta: { ...stats, elapsedSec },
  }).catch(err => log.warn('multi-image-sweep: fireAlert failed', { err: err.message }));

  return stats;
}

async function persistOutcome(lot, outcome) {
  const manifest = lot.enrichment_manifest || {};
  recordMultiImageSweep(manifest, {
    status: outcome.status,
    image_count: outcome.imageCount ?? null,
    error: outcome.error ?? null,
  });

  const update = { enrichment_manifest: manifest };

  if (outcome.images && outcome.images.length > 0) {
    update.images = outcome.images;
    // newThumb is dechromeGallery's chosen card image (a real photo, or a
    // deliberately-kept image when the guard fired). Write it only when it
    // differs from the stored thumbnail.
    if (outcome.newThumb && outcome.newThumb !== lot.image_url) {
      update.image_url = outcome.newThumb;
    }
  }

  const { error } = await supabase.from('lots').update(update).eq('id', lot.id);
  if (error) {
    log.warn('multi-image-sweep: lot update failed', { id: lot.id, err: error.message });
  }
}
