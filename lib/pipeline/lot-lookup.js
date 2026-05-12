// lib/pipeline/lot-lookup.js — Dual-read helper for lots-by-catalogue lookups.
//
// Move 2 of the architectural realignment introduces `lots.auction_id` (FK to
// `auction_calendar.id`) as the canonical join key for "which auction does
// this lot belong to". Pre-Move-2, callers filtered by
// `(house, catalogue_url)` directly. The cut-over is gradual — the writer
// stamps `auction_id` from this PR forward, but only a subset of rows
// initially have it set, and the url_mismatch cohort (~43%) may never
// backfill cleanly.
//
// This module provides two read helpers that prefer auction_id when the
// caller can supply it, and fall back to (house, catalogue_url) otherwise.
// Both shapes match the inline Supabase calls they replace so cut-over
// is mechanical.

import { normaliseUrl } from '../utils.js';

/**
 * Fetch all lots for a single catalogue.
 *
 * @param {object} supabase - Supabase client.
 * @param {object} args
 * @param {string} args.house - Canonical house slug (e.g. 'allsop').
 * @param {string} args.catalogueUrl - Catalogue URL (will be normalised).
 * @param {string|null} [args.auctionId] - auction_calendar.id when known. If
 *   provided, takes precedence over (house, catalogueUrl). Pass null/undefined
 *   to force the legacy path.
 * @param {string} [args.select='*'] - Supabase select string.
 * @returns {Promise<{ data, error }>} Same shape as the underlying Supabase
 *   call so callers can destructure identically to the inline form.
 */
export async function getLotsForCatalogue(supabase, { house, catalogueUrl, auctionId, select = '*' }) {
  if (auctionId) {
    return supabase.from('lots').select(select).eq('auction_id', auctionId);
  }
  return supabase
    .from('lots')
    .select(select)
    .eq('house', house)
    .eq('catalogue_url', normaliseUrl(catalogueUrl));
}

/**
 * Fetch all lots across multiple catalogues. Used by routes/search.js where
 * `.in('catalogue_url', activeUrls)` reads a batch of catalogues at once.
 *
 * Partitions catalogues into "has auction_id" (queryable via `.in('auction_id', ids)`)
 * and "URL only" (queryable via `.in('catalogue_url', urls)`). Issues the
 * two queries in parallel and returns the merged row set.
 *
 * @param {object} supabase - Supabase client.
 * @param {Array<{url: string, auctionId?: string|null}>} catalogues
 * @param {object} [opts]
 * @param {string} [opts.select='*']
 * @param {function} [opts.applyFilters] - Optional callback `(query) => query`
 *   applied to BOTH scoped queries (auction_id + catalogue_url) before they
 *   execute. Use to attach status/location/score filters and an upstream
 *   `.order()` / `.limit()` that bounds each query's row count.
 * @param {function} [opts.sort] - Optional sort comparator applied to the
 *   merged result. Use when `applyFilters` ordered the per-query results but
 *   you also need to re-order the union (e.g. score-desc across two queries).
 * @param {number} [opts.limit] - Optional final limit applied AFTER merge and
 *   sort. Bounds the returned row count regardless of per-query yields.
 * @returns {Promise<{ data: Array, error: object|null }>}
 *   Same shape as a Supabase select. Errors from either underlying query
 *   surface in `error` (first non-null wins; second's error is logged).
 */
export async function getLotsForCatalogues(supabase, catalogues, opts = {}) {
  const { select = '*', applyFilters, sort, limit } = opts;
  const withId = [];
  const withoutId = [];
  for (const c of catalogues || []) {
    if (!c || !c.url) continue;
    if (c.auctionId) withId.push(c.auctionId);
    else withoutId.push(normaliseUrl(c.url));
  }

  const auctionIds = Array.from(new Set(withId));
  const urls = Array.from(new Set(withoutId));

  const queries = [];
  if (auctionIds.length > 0) {
    let q = supabase.from('lots').select(select).in('auction_id', auctionIds);
    if (applyFilters) q = applyFilters(q);
    queries.push(q);
  }
  if (urls.length > 0) {
    let q = supabase.from('lots').select(select).in('catalogue_url', urls);
    if (applyFilters) q = applyFilters(q);
    queries.push(q);
  }

  if (queries.length === 0) {
    return { data: [], error: null };
  }

  const results = await Promise.all(queries);
  const merged = [];
  const seen = new Set();
  let firstError = null;
  for (const r of results) {
    if (r.error && !firstError) firstError = r.error;
    if (r.error) console.warn(`LOT_LOOKUP: bulk read error: ${r.error.message}`);
    for (const row of (r.data || [])) {
      if (row && row.id && !seen.has(row.id)) {
        seen.add(row.id);
        merged.push(row);
      } else if (row && !row.id) {
        // No id selected — caller passed a narrow select. Can't dedup; pass through.
        merged.push(row);
      }
    }
  }

  if (sort) merged.sort(sort);
  const out = (limit != null && limit >= 0) ? merged.slice(0, limit) : merged;
  return { data: out, error: firstError };
}

// Exported for tests — pure partitioner so the dual-read shape is verifiable
// without standing up a Supabase mock.
export function _partitionCatalogues(catalogues) {
  const withId = [];
  const withoutId = [];
  for (const c of catalogues || []) {
    if (!c || !c.url) continue;
    if (c.auctionId) withId.push(c.auctionId);
    else withoutId.push(normaliseUrl(c.url));
  }
  return {
    auctionIds: Array.from(new Set(withId)),
    urls: Array.from(new Set(withoutId)),
  };
}
