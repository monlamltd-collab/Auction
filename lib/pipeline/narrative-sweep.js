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
import {
  extractDescriptionParas, computeDescriptionBleed, assembleDescription,
  DESCRIPTION_MIN_CHARS,
} from './description-extract.js';

const SWEEP_BATCH_LIMIT = 400;             // live-fetch cap/run — politeness dial; wall-clock is the real guard
const SWEEP_FETCH_POOL = 2000;             // candidate rows pulled from the DB
const RECONCILE_CACHE_CAP = 500;           // cache-reconcile rows/run (bounds the HTML payload pulled)
const SWEEP_WALL_CLOCK_MS = 25 * 60_000;   // hard cap — bail, next run resumes
const SWEEP_COOLDOWN_DAYS = 14;            // gates the LIVE fetch only; cache pass ignores it
const PER_FETCH_TIMEOUT_MS = 30000;
const FETCH_GAP_MS = 500;
// A stored description shorter than this is treated as "still missing" — a
// single recogniser bullet wrapped upstream, not real narrative.
const DESCRIPTION_TARGET_CHARS = 80;
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
    .select('id, house, url, description, auction_date, enrichment_manifest')
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
  const cacheTargets = [...cooled, ...fresh].slice(0, RECONCILE_CACHE_CAP);
  const cacheMap = await loadFreshCache(cacheTargets.map(l => l.url));
  const servedFromCache = new Set();
  for (const lot of cacheTargets) {
    const html = cacheMap.get(lot.url);
    if (!html) continue;
    staged.push({ lot, paras: extractDescriptionParas(html) });
    servedFromCache.add(lot.id);
    stats.reconciledFromCache++;
  }

  // ── PASS 2 — live fetch for not-cooled lots without cache ──
  const fetchable = fresh.filter(l => !servedFromCache.has(l.id));
  const eligible = fairShareByHouse(fetchable, batchLimit);
  stats.eligible = eligible.length;
  log.info('narrative-sweep: starting', {
    house: houseScope, pool: (rawCandidates || []).length, underTarget: underTarget.length,
    cooled: cooled.length, reconciledFromCache: stats.reconciledFromCache,
    scheduledFetch: eligible.length,
  });

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

    staged.push({ lot, paras: extractDescriptionParas(fetchResult.html) });
    await sleep(FETCH_GAP_MS);
  }

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
    if (description && description.length >= DESCRIPTION_MIN_CHARS) {
      stats.descriptionAdded++;
      stats.totalCharsAdded += description.length;
      await persistOutcome(lot, { status: 'description_added', description, chars: description.length });
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
  const manifest = lot.enrichment_manifest || {};
  recordNarrativeSweep(manifest, {
    status: outcome.status,
    chars: outcome.chars ?? null,
    error: outcome.error ?? null,
  });

  const update = { enrichment_manifest: manifest };
  if (outcome.description) update.description = outcome.description;

  const { error } = await supabase.from('lots').update(update).eq('id', lot.id);
  if (error) {
    log.warn('narrative-sweep: lot update failed', { id: lot.id, err: error.message });
  }
}
