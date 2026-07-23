// lib/pipeline/prune-from-snapshot.js — Move 3 Phase 3b: derive prune
// candidates from a snapshot diff rather than a heuristic over the live
// lots table.
//
// Why this exists: the legacy `selectPruneCandidates` in persist-lots.js
// works backwards from `existingLots` (every row ever stored for the
// catalogue) and the current scrape's URL set. That's correct but lossy —
// the denominator is "rows that share this catalogue_url string", which
// confused URL rotation cases (PR #22 patched the symptom; Move 2 + PR #27
// fixed the join key; this phase removes the heuristic entirely for
// auctions that have a snapshot history).
//
// New shape:
//   vanished = prevSnapshot.lot_url_set \ currentScrape.urlSet
//   candidate iff vanished AND in_play AND past grace window
//   regression iff currentCount drops sharply vs prev (safety net for
//     broken scrapes that return 0 lots)
//
// Pure functions only. Caller in persist-lots.js composes them with
// the existing I/O (UPDATE lots SET status='withdrawn' WHERE id IN (...))
// and falls back to the legacy path when no prevSnapshot is available
// (e.g. brand-new auctions, or any auction's first scrape after Phase 3a
// deployed). Once snapshots have rolled out for a week, the legacy path
// can be deleted.

const DEFAULT_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_RATIO_GATE = 0.5;
const DEFAULT_MIN_CURRENT_COUNT = 1;
const IN_PLAY = new Set(['available', 'stc', 'unsold']);

/**
 * The status set the prune is allowed to retire, as an array for the
 * retire_lots RPC's p_allowed_statuses. Derived from IN_PLAY so the DB-side
 * guard can never drift from the candidate filter: a lot this module is
 * willing to select is exactly a lot the RPC is willing to flip.
 */
export const PRUNE_RETIRE_STATUSES = [...IN_PLAY];

/**
 * Select lots to prune by diffing the previous snapshot's URL set against
 * the current scrape's URL set.
 *
 * @param {object} args
 * @param {string[]} args.prevUrlSet - URLs from the most-recent prior snapshot.
 * @param {string[]|Set<string>} args.currentUrlSet - URLs from this scrape.
 * @param {Array<object>} args.existingLots - Rows from the DB for this catalogue
 *   (used to resolve {url → lot} for the candidate set; same shape as
 *   persist-lots.js fetches at upsert time).
 * @param {Date|string} [args.now] - Defaults to current time.
 * @param {number} [args.graceMs] - Vanished-URL grace window (default 7d).
 *   Lots whose `last_seen_at` is younger than this don't get pruned —
 *   they may reappear in a near-future scrape.
 * @returns {{
 *   candidates: Array<object>,       // lots to mark 'withdrawn'
 *   vanishedCount: number,           // |prev \ current|
 *   prevCount: number,
 *   currentCount: number,
 *   ratio: number,                   // currentCount / prevCount
 * }}
 */
export function selectPruneCandidatesFromSnapshot({
  prevUrlSet,
  currentUrlSet,
  existingLots,
  now,
  graceMs = DEFAULT_GRACE_MS,
}) {
  const prev = new Set(prevUrlSet || []);
  const current = currentUrlSet instanceof Set
    ? currentUrlSet
    : new Set(currentUrlSet || []);

  const vanishedUrls = new Set();
  for (const u of prev) {
    if (!current.has(u)) vanishedUrls.add(u);
  }

  const lotsByUrl = new Map();
  for (const l of existingLots || []) {
    if (l && l.url) lotsByUrl.set(l.url, l);
  }

  const nowMs = (typeof now === 'string' ? new Date(now) : (now || new Date())).getTime();
  const cutoffMs = nowMs - graceMs;

  const candidates = [];
  for (const url of vanishedUrls) {
    const lot = lotsByUrl.get(url);
    if (!lot || !lot.id) continue;                  // unknown URL → can't act
    if (!IN_PLAY.has(lot.status)) continue;         // already terminal status
    if (!lot.last_seen_at) continue;                // no stamp → don't risk it
    if (new Date(lot.last_seen_at).getTime() >= cutoffMs) continue; // within grace
    candidates.push(lot);
  }

  const prevCount = prev.size;
  const currentCount = current.size;
  const ratio = prevCount > 0 ? currentCount / prevCount : 1;

  return { candidates, vanishedCount: vanishedUrls.size, prevCount, currentCount, ratio };
}

/**
 * Decide whether a scrape looks like a regression — i.e. lot count dropped
 * sharply. Used to GATE prune actions: when a scrape returns much less than
 * the previous, the safer call is to skip prune and surface an alert
 * (matches the legacy ratio-gate behaviour at persist-lots.js:654).
 *
 * @param {object} args
 * @param {number} args.prevCount
 * @param {number} args.currentCount
 * @param {number} [args.ratioGate=0.5]
 * @param {number} [args.minCurrentCount=1] - When prevCount >= minCurrentCount
 *   but currentCount < minCurrentCount, treat as a total-collapse failure
 *   regardless of ratio (catches scrapes that returned 0 from a previously
 *   non-empty catalogue).
 * @returns {{ severe: boolean, ratio: number, reason: string|null }}
 */
export function detectScrapeRegression({
  prevCount,
  currentCount,
  ratioGate = DEFAULT_RATIO_GATE,
  minCurrentCount = DEFAULT_MIN_CURRENT_COUNT,
}) {
  const ratio = prevCount > 0 ? currentCount / prevCount : 1;

  if (prevCount >= minCurrentCount && currentCount < minCurrentCount) {
    return { severe: true, ratio, reason: 'current_count_collapsed' };
  }
  if (ratio < ratioGate) {
    return { severe: true, ratio, reason: 'ratio_below_gate' };
  }
  return { severe: false, ratio, reason: null };
}

/**
 * Retire the selected candidates in batches, reporting which ones ACTUALLY
 * flipped so the caller can emit lot_events for those and only those.
 *
 * Split out of persist-lots.js so this can be tested without a database — the
 * two things worth getting wrong here (counting rows that didn't flip, and
 * asserting withdrawals in lot_events that never landed in `lots`) are both
 * invisible to a pure candidate-selection test.
 *
 * Mirrors runGhostSweep's flip loop deliberately: a batch that errors or
 * reports 0 rows is skipped whole — no count, no events — and the lots stay in
 * play for the next scrape to retry. Batch granularity is as fine as the RPC's
 * INT return allows; a partial flip (a lot sold between candidate selection and
 * the flip) is counted honestly by `pruned` but the batch's events are still
 * emitted, matching the sweep. Partial flips are rare and self-correct on the
 * next scrape.
 *
 * @param {object} args
 * @param {Array<object>} args.candidates - Lots to retire ({ id, status, ... }).
 * @param {(ids: string[]) => Promise<number>} args.flipLots - Performs one
 *   batch; resolves to rows ACTUALLY updated. May throw.
 * @param {number} [args.batchSize=100]
 * @param {(msg: string) => void} [args.onBatchFailure] - Called once per failed batch.
 * @returns {Promise<{ pruned: number, flipped: Array<object>, failedBatches: number, failedLots: number }>}
 */
export async function flipPruneCandidates({
  candidates,
  flipLots,
  batchSize = 100,
  onBatchFailure,
}) {
  const all = candidates || [];
  let pruned = 0;
  let failedBatches = 0;
  let failedLots = 0;
  const flipped = [];

  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize);
    let updated = 0;
    let err = null;
    try {
      updated = await flipLots(batch.map(c => c.id));
    } catch (e) {
      err = e;
    }
    if (err || !(updated > 0)) {
      // The flip did NOT land. Emitting events for this batch would write
      // withdrawals to lot_events (the source of truth) that never happened
      // in `lots` — the exact integrity bug ghost-sweep guards against.
      failedBatches++;
      failedLots += batch.length;
      if (onBatchFailure) {
        onBatchFailure(err ? err.message : 'retire_lots reported 0 rows updated');
      }
      continue;
    }
    pruned += updated;
    flipped.push(...batch);
  }

  return { pruned, flipped, failedBatches, failedLots };
}

export const _internals = {
  DEFAULT_GRACE_MS,
  DEFAULT_RATIO_GATE,
  DEFAULT_MIN_CURRENT_COUNT,
  IN_PLAY,
};
