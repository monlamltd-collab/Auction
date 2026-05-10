// lib/pipeline/post-auction-sweep.js
//
// Post-auction status sweep. For lots whose auction_date has passed but
// whose status is still 'available' or 'unsold' (i.e. we never re-fetched
// after the gavel fell), we re-scrape the detail page once and capture
// the source's final status — sold / unsold / withdrawn / stc / ended.
//
// Why this matters: status only updates on a fresh scrape, and most houses'
// catalogue pages drop expired lots so the cron never revisits them. Without
// this sweep, lots stay frozen at 'available' indefinitely. Worse, genuinely
// unsold lots — the motivated-seller pipeline — are indistinguishable from
// "auction passed, status unconfirmed, who knows" lots in the UI.
//
// Outcome:
//   - Definitive status updates → lots correctly tagged sold/unsold/withdrawn
//   - Unsold lots become a curated category for the frontend filter
//   - Lots whose source never updates → tagged in manifest with no_change so
//     we don't keep retrying them forever (cooldown by last_seen_at)
//   - Lots whose detail page 404s → tagged url_dead — manual review territory
//
// Idempotent: re-running is safe. Only touches rows where last_seen_at is
// older than the cooldown window, so consecutive runs don't double-fetch.
//
// Wired in as a daily Tier 4 in server.js scheduleTick (after the main
// scrape cycle so we don't compete for Firecrawl credits).

import { supabase } from '../supabase.js';
import { fetchLotPage } from '../scraper/lot-detail.js';
import { detectSourceStatus } from '../harness/sub-agents.js';
import { fireAlert } from '../harness/alert-router.js';
import { recordPostAuctionRescrape } from '../enrichment-manifest.js';
import { log } from '../logging.js';

// Tunables — kept inline rather than promoting to config.js because this
// sweep has no other knobs and these values map 1:1 to the daily budget.
//
// Why a wall-clock budget rather than a row count: most fetches are free
// HTTP and only fall back to a Firecrawl credit on failure, so the real
// constraint is run time (we don't want this tier to bleed into the next
// scheduled job). Old SWEEP_BATCH_LIMIT=100 was over-conservative — it
// left a 4-day backlog every time the candidate pool exceeded ~400 lots
// (e.g. TCPA's 227-lot auction date). The new SWEEP_BATCH_LIMIT covers
// every realistic daily pool, and SWEEP_WALL_CLOCK_MS is the actual
// safety: if the run hits 30 minutes the loop bails and the next cron
// picks up where it left off.
const SWEEP_BATCH_LIMIT = 1500;           // soft ceiling — almost never hit; wall-clock is the real guard
const SWEEP_FETCH_POOL = 5000;            // pull this many eligible rows from DB before fair-share trim
const SWEEP_WALL_CLOCK_MS = 30 * 60_000;  // hard cap — bail if the run runs past 30 minutes
const SWEEP_COOLDOWN_HOURS = 12;          // skip lots re-fetched within this window
const POST_AUCTION_LOOKBACK_DAYS = 30;    // ignore lots whose auction passed > 30d ago
const POST_AUCTION_MIN_AGE_HOURS = 24;    // and whose auction passed < 24h ago (give site time to update)
const URL_DEAD_UNSOLD_THRESHOLD_DAYS = 3; // url_dead post-auction lot → flip to 'unsold' once auction is at least this old
const FETCH_GAP_MS = 500;                 // be polite — 500ms between fetches
const PER_FETCH_TIMEOUT_MS = 30000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Round-robin selection across houses so a single big-catalogue auction
// (e.g. TCPA's 227 candidates on one date) can't starve smaller houses
// out of the daily SWEEP_BATCH_LIMIT. Pre-sorted input is preserved
// within each house bucket so we still hit the most-recent auction first
// per house. Exported for unit tests.
export function fairShareByHouse(candidates, batchLimit) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const buckets = new Map();
  for (const lot of candidates) {
    const h = lot && lot.house ? lot.house : '__unknown__';
    if (!buckets.has(h)) buckets.set(h, []);
    buckets.get(h).push(lot);
  }
  const out = [];
  let added = true;
  while (added && out.length < batchLimit) {
    added = false;
    for (const arr of buckets.values()) {
      if (arr.length === 0) continue;
      out.push(arr.shift());
      added = true;
      if (out.length >= batchLimit) break;
    }
  }
  return out;
}

/**
 * Run a single post-auction status sweep pass.
 *
 * @returns {Promise<{
 *   eligible: number, fetched: number,
 *   statusUpdated: number, noChange: number, urlDead: number, fetchFailed: number,
 *   transitions: Record<string, number>,
 * }>}
 */
export async function sweepPostAuctionStatuses() {
  const startedAt = Date.now();
  const cutoffOldest = new Date(Date.now() - POST_AUCTION_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const cutoffNewest = new Date(Date.now() - POST_AUCTION_MIN_AGE_HOURS * 3600000).toISOString().slice(0, 10);
  const cooldownCutoff = new Date(Date.now() - SWEEP_COOLDOWN_HOURS * 3600000).toISOString();

  // ── Find candidates ───────────────────────────────────────────────
  // Lots whose auction passed in the last 30 days, status is still
  // available/unsold (i.e. needs confirmation), and we haven't re-fetched
  // them in the last cooldown window.
  const { data: rawCandidates, error: queryErr } = await supabase
    .from('lots')
    .select('id, house, url, status, auction_date, last_seen_at, enrichment_manifest, address')
    .in('status', ['available', 'unsold'])
    .not('url', 'is', null)
    .gte('auction_date', cutoffOldest)
    .lte('auction_date', cutoffNewest)
    .lt('last_seen_at', cooldownCutoff)
    .order('auction_date', { ascending: false })
    .limit(SWEEP_FETCH_POOL);

  if (queryErr) {
    log.error('post-auction-sweep: candidate query failed', { err: queryErr.message });
    return { eligible: 0, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, transitions: {} };
  }
  if (!rawCandidates || rawCandidates.length === 0) {
    log.info('post-auction-sweep: no candidates found');
    return { eligible: 0, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, transitions: {} };
  }

  // Fair-share across houses — without this, a single big catalogue (e.g. TCPA's
  // 227 lots on one auction date) consumes the entire SWEEP_BATCH_LIMIT and
  // starves smaller houses (Hollis Morgan, Cottons, etc.) so their post-
  // auction status never gets updated. With round-robin every house gets a
  // proportional slice each run.
  const candidates = fairShareByHouse(rawCandidates, SWEEP_BATCH_LIMIT);
  const houseCounts = candidates.reduce((acc, l) => { acc[l.house] = (acc[l.house] || 0) + 1; return acc; }, {});
  log.info('post-auction-sweep: starting', { pool: rawCandidates.length, eligible: candidates.length, houseCounts });

  // ── Process serially with a small gap (rate-limit politeness) ────
  const stats = { eligible: candidates.length, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, wallClockBailed: false, transitions: {} };

  for (const lot of candidates) {
    if (Date.now() - startedAt > SWEEP_WALL_CLOCK_MS) {
      stats.wallClockBailed = true;
      log.warn('post-auction-sweep: wall-clock budget reached — stopping early', {
        elapsedSec: Math.round((Date.now() - startedAt) / 1000),
        processedSoFar: stats.fetched + stats.urlDead + stats.fetchFailed,
        skipped: candidates.length - (stats.fetched + stats.urlDead + stats.fetchFailed),
      });
      break;
    }
    let fetchResult = null;
    try {
      fetchResult = await Promise.race([
        fetchLotPage(lot.url, { house: lot.house, skipCache: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('per-fetch timeout')), PER_FETCH_TIMEOUT_MS)),
      ]);
    } catch (err) {
      // Network / timeout / parse error
      stats.fetchFailed++;
      await persistOutcome(lot, {
        status: 'fetch_failed',
        error: err.message,
        oldStatus: lot.status,
        newStatus: lot.status,
      });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    stats.fetched++;

    // fetchLotPage returns null on definitive 404 / 410
    if (!fetchResult || !fetchResult.html) {
      stats.urlDead++;
      // Heuristic: if the auction passed at least URL_DEAD_UNSOLD_THRESHOLD_DAYS
      // ago and the lot is still 'available' in our DB, the most likely
      // explanation for a dead URL is that the source took the lot down because
      // it didn't sell (or sold to a private buyer not announced publicly).
      // Flip to 'unsold' so the lot stops appearing on the live feed and shows
      // up under the "Recently unsold" filter — that's the motivated-seller
      // pipeline. Caller can override the threshold for testing via
      // process.env.URL_DEAD_UNSOLD_DAYS, otherwise the constant applies.
      const thresholdDays = parseInt(process.env.URL_DEAD_UNSOLD_DAYS, 10) || URL_DEAD_UNSOLD_THRESHOLD_DAYS;
      const auctionPassedDays = lot.auction_date
        ? Math.floor((Date.now() - new Date(lot.auction_date).getTime()) / 86400000)
        : 0;
      const inferUnsold = lot.status === 'available' && auctionPassedDays >= thresholdDays;
      const newStatus = inferUnsold ? 'unsold' : lot.status;
      if (inferUnsold) {
        stats.statusUpdated++;
        const key = `${lot.status}->unsold (url_dead)`;
        stats.transitions[key] = (stats.transitions[key] || 0) + 1;
      }
      await persistOutcome(lot, {
        status: 'url_dead',
        oldStatus: lot.status,
        newStatus,
      });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    const newStatus = detectSourceStatus(fetchResult.html);

    if (newStatus === lot.status) {
      stats.noChange++;
      await persistOutcome(lot, {
        status: 'no_change',
        oldStatus: lot.status,
        newStatus,
      });
    } else {
      stats.statusUpdated++;
      const key = `${lot.status}->${newStatus}`;
      stats.transitions[key] = (stats.transitions[key] || 0) + 1;
      await persistOutcome(lot, {
        status: 'status_updated',
        oldStatus: lot.status,
        newStatus,
      });
    }

    await sleep(FETCH_GAP_MS);
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  log.info('post-auction-sweep: complete', {
    elapsedSec,
    ...stats,
  });

  // ── Fire summary alert ────────────────────────────────────────────
  // Severity = info; this isn't a failure — it's normal hygiene.
  await fireAlert({
    type: 'post_auction_sweep',
    severity: 'info',
    house: null,
    message: `Post-auction sweep: ${stats.fetched}/${stats.eligible} fetched, ${stats.statusUpdated} updated, ${stats.noChange} unchanged, ${stats.urlDead} dead URLs, ${stats.fetchFailed} fetch failures`,
    meta: { ...stats, elapsedSec },
  }).catch(err => log.warn('post-auction-sweep: fireAlert failed', { err: err.message }));

  return stats;
}

/**
 * Persist the outcome of a single lot's re-fetch:
 *   - update lots.status when it changed
 *   - bump lots.last_seen_at so the cooldown window applies
 *   - append the post_auction_rescrape entry to enrichment_manifest
 */
async function persistOutcome(lot, outcome) {
  const manifest = lot.enrichment_manifest || {};
  recordPostAuctionRescrape(manifest, {
    status: outcome.status,
    old_status: outcome.oldStatus,
    new_status: outcome.newStatus,
    error: outcome.error || null,
  });

  const update = {
    last_seen_at: new Date().toISOString(),
    enrichment_manifest: manifest,
  };
  // Only mutate status when we have a definitive new value AND it actually
  // differs from the old one. Two paths set newStatus !== oldStatus:
  //   1. status_updated — the source page said something definitive
  //   2. url_dead — caller inferred 'unsold' for an old-auction available lot
  // In both cases we trust the caller's newStatus. For everything else
  // (no_change / fetch_failed / url_dead-without-inference) the row keeps its
  // existing status while last_seen_at refreshes (cooldown prevents loops).
  const flips = ['status_updated', 'url_dead'];
  if (flips.includes(outcome.status) && outcome.newStatus && outcome.newStatus !== outcome.oldStatus) {
    update.status = outcome.newStatus;
  }

  const { error } = await supabase
    .from('lots')
    .update(update)
    .eq('id', lot.id);

  if (error) {
    log.warn('post-auction-sweep: lot update failed', { id: lot.id, err: error.message });
  }
}
