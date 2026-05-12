// lib/pipeline/backfill-auction-id-logic.js — Pure matching logic for the
// Move 2 backfill (scripts/backfill-auction-id.mjs). Extracted so tests can
// verify it without a Supabase mock.
//
// Indexing strategy: build a Map keyed on `${house_slug}|${url}`, where url
// is taken as-is from auction_calendar (already normalised by the SQL trigger
// from PR #24). When multiple calendar rows share a key, the FIRST .set()
// wins — caller passes rows ordered by date DESC so "first" = "most recent".

import { normaliseUrl } from '../utils.js';

/**
 * Build a (house_slug, url) → { id, date } index from calendar rows.
 *
 * Caller is responsible for ordering rows by date DESC so the most-recent
 * calendar row wins on a key collision. The url is taken as-is (the SQL
 * trigger has already canonicalised it); house_slug is taken as-is.
 *
 * @param {Array<{id: string, house_slug: string, url: string, date: string}>} rows
 * @returns {Map<string, { id: string, date: string }>}
 */
export function buildCalendarIndex(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r || !r.id || !r.house_slug || !r.url) continue;
    const k = `${r.house_slug}|${r.url}`;
    if (!map.has(k)) map.set(k, { id: r.id, date: r.date });
  }
  return map;
}

/**
 * Match a single lot against the calendar index.
 *
 * @param {{ house: string, catalogue_url: string }} lot
 * @param {Map<string, { id: string, date: string }>} calIndex
 * @returns {{ id: string, date: string } | null}
 */
export function matchLotToCalendar(lot, calIndex) {
  if (!lot || !lot.house || !lot.catalogue_url || !calIndex) return null;
  const k = `${lot.house}|${normaliseUrl(lot.catalogue_url)}`;
  return calIndex.get(k) || null;
}
