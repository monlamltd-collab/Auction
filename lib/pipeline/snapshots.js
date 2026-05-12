// lib/pipeline/snapshots.js — Move 3 Phase 3a: catalogue snapshot writer.
//
// One row per successful scrape, capturing the canonical set of lot URLs
// returned by that scrape, indexed by `auction_id`. Future phases will use
// these to derive prune candidates (3b), recall metrics (3c), and a
// time-travel debug endpoint (3d). This phase is writer-only — rows
// accumulate, nothing reads them yet.
//
// Pure functions (buildLotUrlSet, computeContentHash) are exported and
// tested in isolation; the I/O wrapper (writeSnapshot) is only exercised
// end-to-end via the persist-lots integration.

import { createHash } from 'node:crypto';
import { normaliseUrl } from '../utils.js';

/**
 * Build the canonical sorted-unique URL set for a snapshot.
 *
 * @param {Array<{url?: string}>} rows - Lot rows about to be persisted.
 * @returns {string[]} Lowercase-normalised, deduplicated, sorted URL list.
 */
export function buildLotUrlSet(rows) {
  const seen = new Set();
  for (const r of rows || []) {
    if (!r) continue;
    const u = r.url;
    if (!u || typeof u !== 'string') continue;
    // Synthetic URLs (`__synthetic__…`) are stable identifiers used when the
    // scrape couldn't recover the lot's detail URL — preserve them as-is.
    const norm = u.startsWith('__synthetic__') ? u : normaliseUrl(u);
    if (norm) seen.add(norm);
  }
  return [...seen].sort();
}

/**
 * Hash the canonical URL set so two scrapes returning the same lots
 * produce the same fingerprint. Stable across process restarts.
 *
 * @param {string[]} urlSet - Output of `buildLotUrlSet`.
 * @returns {string} 64-char hex SHA-256 of the joined sorted set.
 */
export function computeContentHash(urlSet) {
  const h = createHash('sha256');
  // newline-joined so two URLs differing only by suffix can't collide.
  // urlSet is already sorted + unique from buildLotUrlSet.
  h.update((urlSet || []).join('\n'));
  return h.digest('hex');
}

/**
 * Determine the scrape_status for a snapshot row based on the previous
 * snapshot's content_hash. `'full'` when content changed (or this is the
 * first snapshot); `'unchanged'` when the hash matches the latest prior
 * snapshot for the same auction. Callers may pass `'partial'` or
 * `'failed'` explicitly to override.
 *
 * @param {string} currentHash
 * @param {string|null} previousHash - Latest hash for the same auction, or null.
 * @returns {'full'|'unchanged'}
 */
export function deriveScrapeStatus(currentHash, previousHash) {
  if (previousHash && previousHash === currentHash) return 'unchanged';
  return 'full';
}

/**
 * Look up the most-recent snapshot for an auction. Cheap (one row, indexed
 * on `(auction_id, scraped_at DESC)`). Used both by `writeSnapshot` for
 * status derivation and by the snapshot-diff prune path so callers can
 * fetch the prev snapshot once and reuse it for both purposes.
 *
 * @param {object} supabase
 * @param {string|null} auctionId
 * @returns {Promise<{ content_hash: string, lot_url_set: string[], lot_count: number, scraped_at: string } | null>}
 */
export async function getLatestSnapshot(supabase, auctionId) {
  if (!auctionId) return null;
  try {
    const { data } = await supabase
      .from('catalogue_snapshots')
      .select('content_hash, lot_url_set, lot_count, scraped_at')
      .eq('auction_id', auctionId)
      .order('scraped_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

/**
 * Write one snapshot row for this scrape. Best-effort — failure is logged
 * but never propagated (snapshots are derived data, not a critical path).
 *
 * Skips entirely when `auctionId` is null: snapshots are auction-keyed by
 * design, and the url_mismatch cohort (Move 2) has NULL `auction_id`.
 * Those scrapes will surface in snapshots once Follow-up B reconciliation
 * lands and the writer starts stamping `auction_id` for them.
 *
 * @param {object} supabase
 * @param {object} args
 * @param {string|null} args.auctionId
 * @param {Array<{url?: string}>} args.rows
 * @param {string|null} [args.extractedWith]
 * @param {string|null} [args.scrapedWith]
 * @param {'full'|'unchanged'|'partial'|'failed'} [args.statusOverride] - Force a
 *   specific scrape_status (e.g. 'partial' when the harness flagged a soft fail).
 * @param {object|null} [args.prevSnapshot] - Optional pre-fetched previous
 *   snapshot (from `getLatestSnapshot`). When supplied, avoids a duplicate
 *   query inside this function.
 * @returns {Promise<{ written: boolean, hash: string|null, status: string|null }>}
 */
export async function writeSnapshot(supabase, args) {
  const { auctionId, rows, extractedWith = null, scrapedWith = null, statusOverride = null, prevSnapshot } = args;
  if (!auctionId) {
    return { written: false, hash: null, status: null };
  }
  const urlSet = buildLotUrlSet(rows);
  const contentHash = computeContentHash(urlSet);

  let status = statusOverride;
  if (!status) {
    // Caller can supply prevSnapshot to skip the redundant lookup; otherwise
    // fetch the latest prior snapshot's content_hash for this auction so we
    // can mark `unchanged` cleanly.
    let previousHash = null;
    if (prevSnapshot !== undefined) {
      previousHash = prevSnapshot?.content_hash || null;
    } else {
      try {
        const prev = await getLatestSnapshot(supabase, auctionId);
        previousHash = prev?.content_hash || null;
      } catch {
        previousHash = null;
      }
    }
    status = deriveScrapeStatus(contentHash, previousHash);
  }

  const payload = {
    auction_id: auctionId,
    lot_url_set: urlSet,
    lot_count: urlSet.length,
    content_hash: contentHash,
    scrape_status: status,
    extracted_with: extractedWith,
    scraped_with: scrapedWith,
  };

  try {
    const { error } = await supabase.from('catalogue_snapshots').insert(payload);
    if (error) {
      console.warn(`SNAPSHOTS: insert failed for auction_id=${auctionId}: ${error.message}`);
      return { written: false, hash: contentHash, status };
    }
    return { written: true, hash: contentHash, status };
  } catch (e) {
    console.warn(`SNAPSHOTS: insert threw for auction_id=${auctionId}: ${e.message}`);
    return { written: false, hash: contentHash, status };
  }
}
