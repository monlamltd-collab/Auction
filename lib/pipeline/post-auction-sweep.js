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
const SWEEP_BATCH_LIMIT = 100;            // max lots re-fetched per run
const SWEEP_COOLDOWN_HOURS = 12;          // skip lots re-fetched within this window
const POST_AUCTION_LOOKBACK_DAYS = 30;    // ignore lots whose auction passed > 30d ago
const POST_AUCTION_MIN_AGE_HOURS = 24;    // and whose auction passed < 24h ago (give site time to update)
const FETCH_GAP_MS = 500;                 // be polite — 500ms between fetches
const PER_FETCH_TIMEOUT_MS = 30000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  const { data: candidates, error: queryErr } = await supabase
    .from('lots')
    .select('id, house, url, status, auction_date, last_seen_at, enrichment_manifest, address')
    .in('status', ['available', 'unsold'])
    .not('url', 'is', null)
    .gte('auction_date', cutoffOldest)
    .lte('auction_date', cutoffNewest)
    .lt('last_seen_at', cooldownCutoff)
    .order('auction_date', { ascending: false })
    .limit(SWEEP_BATCH_LIMIT);

  if (queryErr) {
    log.error('post-auction-sweep: candidate query failed', { err: queryErr.message });
    return { eligible: 0, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, transitions: {} };
  }
  if (!candidates || candidates.length === 0) {
    log.info('post-auction-sweep: no candidates found');
    return { eligible: 0, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, transitions: {} };
  }

  log.info('post-auction-sweep: starting', { eligible: candidates.length });

  // ── Process serially with a small gap (rate-limit politeness) ────
  const stats = { eligible: candidates.length, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, transitions: {} };

  for (const lot of candidates) {
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
      await persistOutcome(lot, {
        status: 'url_dead',
        oldStatus: lot.status,
        newStatus: lot.status,
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
  // Only mutate status when the source said something definitive AND it
  // actually differs. Otherwise the row keeps its existing status while
  // last_seen_at refreshes (which prevents re-fetch loops via cooldown).
  if (outcome.status === 'status_updated' && outcome.newStatus && outcome.newStatus !== outcome.oldStatus) {
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
