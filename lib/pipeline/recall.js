// lib/pipeline/recall.js — Move 3 Phase 3c: derive scrape-recall metrics
// from the catalogue_snapshots history.
//
// Recall = |today.lot_url_set ∩ yesterday.lot_url_set| / |yesterday.lot_url_set|
// — the fraction of last scrape's lots that we still see this scrape. A high
// number (>= ~0.95 in steady state) means the scraper is reliably re-finding
// the same catalogue. A sudden drop is the canonical "venmore at 2%" signal
// the old RECALL_SENTINELS regex was trying to catch — except now it's a
// structural metric, not a per-house regex.

const PERFECT_RECALL = 1;

/**
 * Compute recall as the fraction of `prevUrlSet` that's still present in
 * `currentUrlSet`. Defined as 1 when `prevUrlSet` is empty (a brand-new
 * catalogue can't fail to recover what it never had).
 *
 * @param {string[]|Set<string>} prevUrlSet
 * @param {string[]|Set<string>} currentUrlSet
 * @returns {number} 0..1 inclusive.
 */
export function computeRecall(prevUrlSet, currentUrlSet) {
  const prev = prevUrlSet instanceof Set ? prevUrlSet : new Set(prevUrlSet || []);
  if (prev.size === 0) return PERFECT_RECALL;
  const current = currentUrlSet instanceof Set ? currentUrlSet : new Set(currentUrlSet || []);
  let intersection = 0;
  for (const u of prev) {
    if (current.has(u)) intersection++;
  }
  return intersection / prev.size;
}

/**
 * Aggregate per-auction recall figures across many snapshot pairs.
 * Useful for the admin dashboard: average across all auctions, plus the
 * worst N performers for triage.
 *
 * @param {Array<{ auction_id?: string, recall: number, prevCount?: number, currentCount?: number }>} pairs
 * @param {object} [opts]
 * @param {number} [opts.worstN=5]
 * @returns {{
 *   count: number,
 *   averageRecall: number,
 *   medianRecall: number,
 *   minRecall: number,
 *   maxRecall: number,
 *   worst: Array<object>,
 * }}
 */
export function summariseRecall(pairs, { worstN = 5 } = {}) {
  const list = Array.isArray(pairs) ? pairs.filter(p => p && typeof p.recall === 'number') : [];
  if (list.length === 0) {
    return { count: 0, averageRecall: PERFECT_RECALL, medianRecall: PERFECT_RECALL, minRecall: PERFECT_RECALL, maxRecall: PERFECT_RECALL, worst: [] };
  }
  const sorted = [...list].sort((a, b) => a.recall - b.recall);
  const sum = list.reduce((acc, p) => acc + p.recall, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[mid].recall
    : (sorted[mid - 1].recall + sorted[mid].recall) / 2;
  return {
    count: list.length,
    averageRecall: sum / list.length,
    medianRecall: median,
    minRecall: sorted[0].recall,
    maxRecall: sorted[sorted.length - 1].recall,
    worst: sorted.slice(0, Math.max(0, worstN)),
  };
}

/**
 * Fetch the most recent pair of snapshots per auction and compute recall
 * for each. Returns one row per auction that has at least 2 snapshots
 * within the window; auctions with fewer are skipped (no prior to compare).
 *
 * @param {object} supabase
 * @param {object} [opts]
 * @param {number} [opts.sinceMs=24*60*60*1000] - Look-back window (default 24h).
 * @param {number} [opts.limit=500] - Cap on auctions to evaluate.
 * @returns {Promise<Array<{
 *   auction_id: string,
 *   recall: number,
 *   prev_count: number,
 *   current_count: number,
 *   prev_scraped_at: string,
 *   current_scraped_at: string,
 * }>>}
 */
export async function fetchRecallReport(supabase, { sinceMs = 24 * 60 * 60 * 1000, limit = 500 } = {}) {
  const sinceIso = new Date(Date.now() - sinceMs).toISOString();
  // Pull all snapshots within the window. We only need the lot_url_set + count
  // so we can compute recall without doing the set diff in SQL (Postgres
  // doesn't have a built-in intersection-cardinality on text[]).
  const { data: rows, error } = await supabase
    .from('catalogue_snapshots')
    .select('auction_id, scraped_at, lot_url_set, lot_count')
    .gte('scraped_at', sinceIso)
    .order('scraped_at', { ascending: false })
    .limit(limit * 4); // headroom — we'll group by auction below

  if (error || !rows) return [];

  // Group by auction_id, pick the two most recent per auction.
  const byAuction = new Map();
  for (const r of rows) {
    if (!byAuction.has(r.auction_id)) byAuction.set(r.auction_id, []);
    const list = byAuction.get(r.auction_id);
    if (list.length < 2) list.push(r);
  }

  const report = [];
  for (const [auctionId, snapshots] of byAuction.entries()) {
    if (snapshots.length < 2) continue;
    const [current, prev] = snapshots; // ordered DESC, so [0]=current, [1]=prev
    const recall = computeRecall(prev.lot_url_set, current.lot_url_set);
    report.push({
      auction_id: auctionId,
      recall,
      prev_count: prev.lot_count,
      current_count: current.lot_count,
      prev_scraped_at: prev.scraped_at,
      current_scraped_at: current.scraped_at,
    });
    if (report.length >= limit) break;
  }
  return report;
}
