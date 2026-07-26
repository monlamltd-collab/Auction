// lib/pipeline/calendar-sync.js — Reconcile existing calendar rows without inventing sale format
import { log } from '../logging.js';
import { normaliseUrl } from '../utils.js';
import { HOUSE_ROOTS, RETIRED_HOUSES } from '../houses.js';
import { _invalidateCalendarCache } from './persist-lots.js';

/**
 * Reconcile existing active calendar rows conservatively.
 *
 * This function must never infer sale format or publication from HOUSE_ROOTS:
 * a canonical root may be a pre-publication shell for a traditional house.
 * It therefore deduplicates rows and realigns known always_on URLs while
 * preserving their existing catalogue_ready value. Watcher/discovery own
 * insertion and positive readiness transitions.
 *
 * @param {{ supabase: object }} deps
 */
export async function syncCalendar({ supabase }) {
  // Only count ACTIVE entries (upcoming dates or always_on) — stale past entries
  // don't count, otherwise houses with only expired entries never get always_on added
  const lookback7 = new Date();
  lookback7.setDate(lookback7.getDate() - 7);
  const lookbackStr = lookback7.toISOString().slice(0, 10);
  const { data: existingCalendar } = await supabase
    .from('auction_calendar')
    .select('id, house_slug, url, status, date, catalogue_ready')
    .or(`date.gte.${lookbackStr},status.eq.always_on`);
  // Exact-identity dedup below deliberately replaces the old "one always_on
  // row per house" rule: a house may legitimately expose multiple rolling
  // catalogues, so house_slug alone is not a safe delete key.

  // ── Deduplicate exact logical identities (normalised URL + date + status) ──
  // Distinct dates and distinct sale formats sharing a rolling URL are valid.
  const byUrl = new Map();
  for (const row of (existingCalendar || [])) {
    const norm = normaliseUrl(row.url);
    if (!norm) continue;
    const key = `${norm}|${String(row.date || '')}|${String(row.status || '')}`;
    if (!byUrl.has(key)) {
      byUrl.set(key, []);
    }
    byUrl.get(key).push(row);
  }
  let urlDedupDeleted = 0;
  for (const [, rows] of byUrl) {
    if (rows.length <= 1) continue;
    // Prefer always_on entries, then keep first
    rows.sort((a, b) => {
      if (a.status === 'always_on' && b.status !== 'always_on') return -1;
      if (b.status === 'always_on' && a.status !== 'always_on') return 1;
      return 0;
    });
    const toDelete = rows.slice(1).map(r => r.id);
    const { error } = await supabase.from('auction_calendar').delete().in('id', toDelete);
    if (!error) urlDedupDeleted += toDelete.length;
  }
  if (urlDedupDeleted > 0) {
    console.log(`AUTO-CALENDAR: Deduplicated ${urlDedupDeleted} duplicate URL entries`);
  }

  // Missing houses are intentionally NOT auto-created here. HOUSE_ROOTS is an
  // address registry, not evidence that a house is MMOA/always_on or published.
  // Discovery/watcher must verify and insert the appropriate row shape.

  // ── Reconcile drifted always-on URLs back to HOUSE_ROOTS ──
  // The Landwood bug (2026-04-17 → 2026-04-27): HOUSE_ROOTS held the
  // correct catalogue path but auction_calendar had drifted to the bare
  // root domain. Every nightly scrape hit the wrong page → 0 lots → no
  // self-heal because the calendar URL itself was the cause. The previous
  // "insert if missing" logic above let the drift persist for 10 days.
  //
  // Now: for every always_on entry, if its url doesn't match HOUSE_ROOTS,
  // realign. Scoped to always_on so we don't clobber per-auction-date
  // entries (those legitimately differ from the root).
  let urlsRealigned = 0;
  const repairedSlugs = new Set();
  const alwaysOnCounts = new Map();
  for (const row of (existingCalendar || [])) {
    if (row.status === 'always_on' && row.house_slug) {
      alwaysOnCounts.set(row.house_slug, (alwaysOnCounts.get(row.house_slug) || 0) + 1);
    }
  }
  for (const row of (existingCalendar || [])) {
    if (row.status !== 'always_on' || !row.house_slug) continue;
    if ((alwaysOnCounts.get(row.house_slug) || 0) !== 1) continue; // ambiguous multi-catalogue house
    const expected = HOUSE_ROOTS[row.house_slug];
    if (!expected) continue;  // slug no longer in HOUSE_ROOTS (decommissioned house)
    const urlAligned = normaliseUrl(row.url) === normaliseUrl(expected);
    if (urlAligned) continue; // already aligned; readiness is not ours to infer

    const { error } = await supabase
      .from('auction_calendar')
      .update({ url: expected, catalogue_ready: row.catalogue_ready, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (!error) {
      urlsRealigned++;
      repairedSlugs.add(row.house_slug);
      console.log(`AUTO-CALENDAR: realigned ${row.house_slug}: '${row.url}' → '${expected}' (catalogue_ready preserved as ${row.catalogue_ready === true})`);
    } else {
      console.warn(`AUTO-CALENDAR: Failed to realign ${row.house_slug}: ${error.message}`);
    }
  }
  if (urlsRealigned > 0) {
    console.log(`AUTO-CALENDAR: ${urlsRealigned} always_on URLs realigned to match HOUSE_ROOTS`);
  }

  // ── Verified dated-row readiness promotion ──
  // Canonical-root equality is NOT proof that a catalogue is published: some
  // houses (notably McHugh) serve a pre-publication shell at the same URL. The
  // selector therefore requires explicit verifiedRowIds. syncCalendar has no
  // lot-verification dependency, so it passes none and cannot force-ready rows;
  // watcher/discovery own the verified readiness transition.
  const todayStr = new Date().toISOString().slice(0, 10);
  const rescues = pickCatalogueReadyRescues({
    rows: existingCalendar || [],
    houseRoots: HOUSE_ROOTS,
    retiredHouses: RETIRED_HOUSES,
    repairedSlugs,
    todayStr,
  });
  let rescued = 0;
  for (const row of rescues) {
    const { error } = await supabase
      .from('auction_calendar')
      .update({ catalogue_ready: true, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (!error) {
      rescued++;
      console.log(`AUTO-CALENDAR: rescued ${row.house_slug} ${row.date}: catalogue_ready=true (explicit verifiedRowIds proof)`);
    } else {
      console.warn(`AUTO-CALENDAR: Failed to rescue ${row.house_slug}: ${error.message}`);
    }
  }
  if (rescued > 0) {
    console.log(`AUTO-CALENDAR: ${rescued} unscheduled house(s) rescued via dated-row catalogue_ready repair`);
  }

  // Legacy status migration was intentionally retired: title text alone is not
  // enough evidence to create an always_on/MMOA sentinel row.

  // syncCalendar may delete duplicate rows or realign an existing URL. Drop
  // the persist-lots cache once at the end so the next upsert sees the result.
  _invalidateCalendarCache();
}

/**
 * Pure selector for the dated-row rescue pass (exported for tests).
 *
 * Given the active-window calendar rows, return the rows whose
 * catalogue_ready flag should be flipped to true because their house would
 * otherwise be completely invisible to the scheduler. A row qualifies only
 * when ALL hold:
 *   - its house is in HOUSE_ROOTS, not retired, and was not just repaired by
 *     the always_on realign pass this run;
 *   - NO row for the house is already catalogue_ready=true;
 *   - the row is a dated `upcoming` entry with date >= today (always_on rows
 *     are the realign pass's job; past/merged rows stay untouched);
 *   - the row's URL normalises to the house's canonical HOUSE_ROOTS URL —
 *     i.e. it points at the permanently-live catalogue, so "catalogue not
 *     published yet" cannot be the reason the flag is false.
 *
 * @param {{ rows: Array<object>, houseRoots: Record<string,string>,
 *           retiredHouses: Set<string>, repairedSlugs?: Set<string>,
 *           todayStr: string }} p
 * @returns {Array<object>} rows to flip (subset of `rows`)
 */
export function pickCatalogueReadyRescues({ rows, houseRoots, retiredHouses, repairedSlugs = new Set(), verifiedRowIds = new Set(), todayStr }) {
  const bySlug = new Map();
  for (const row of rows) {
    if (!row.house_slug) continue;
    if (!bySlug.has(row.house_slug)) bySlug.set(row.house_slug, []);
    bySlug.get(row.house_slug).push(row);
  }
  const out = [];
  for (const [slug, slugRows] of bySlug) {
    const rootUrl = houseRoots[slug];
    if (!rootUrl) continue;
    if (retiredHouses.has(slug)) continue;
    if (repairedSlugs.has(slug)) continue;
    if (slugRows.some(r => r.catalogue_ready === true)) continue;
    for (const row of slugRows) {
      // Canonical-root equality is not proof of publication: McHugh serves a
      // pre-publication shell on the same URL. Require positive lot verification.
      if (!verifiedRowIds.has(row.id)) continue;
      if (row.status !== 'upcoming') continue;
      if (!row.date || String(row.date).slice(0, 10) < todayStr) continue;
      if (normaliseUrl(row.url) !== normaliseUrl(rootUrl)) continue;
      out.push(row);
    }
  }
  return out;
}
