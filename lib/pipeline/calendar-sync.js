// lib/pipeline/calendar-sync.js — Ensure every HOUSE_ROOTS entry has at least one calendar entry
import { log } from '../logging.js';
import { normaliseUrl } from '../utils.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES, RETIRED_HOUSES } from '../houses.js';
import { _invalidateCalendarCache } from './persist-lots.js';

/**
 * Ensure every HOUSE_ROOTS entry has at least one active calendar entry.
 * Many houses (EIG, AH UK, etc.) have root URLs that ARE the catalogue page.
 * Without a calendar entry, they never get analysed. These are "always-on"
 * houses — their catalogue is permanently live, not tied to a specific date.
 *
 * Also deduplicates always_on entries and migrates legacy entries.
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
  const calendarSlugs = new Set((existingCalendar || []).map(r => r.house_slug).filter(Boolean));
  const calendarUrls = new Set((existingCalendar || []).map(r => normaliseUrl(r.url)));

  // ── Deduplicate: remove duplicate always_on entries per house_slug ──
  const alwaysOnBySlug = new Map();
  for (const row of (existingCalendar || [])) {
    if (row.status !== 'always_on' || !row.house_slug) continue;
    if (!alwaysOnBySlug.has(row.house_slug)) {
      alwaysOnBySlug.set(row.house_slug, []);
    }
    alwaysOnBySlug.get(row.house_slug).push(row.id);
  }
  let dedupDeleted = 0;
  for (const [slug, ids] of alwaysOnBySlug) {
    if (ids.length <= 1) continue;
    const toDelete = ids.slice(1);
    const { error } = await supabase.from('auction_calendar').delete().in('id', toDelete);
    if (!error) dedupDeleted += toDelete.length;
  }
  if (dedupDeleted > 0) {
    console.log(`AUTO-CALENDAR: Deduplicated ${dedupDeleted} duplicate always_on entries`);
  }

  // ── Deduplicate: remove duplicate entries with same normalised URL ──
  const byUrl = new Map();
  for (const row of (existingCalendar || [])) {
    const norm = normaliseUrl(row.url);
    if (!norm) continue;
    if (!byUrl.has(norm)) {
      byUrl.set(norm, []);
    }
    byUrl.get(norm).push(row);
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

  // ── Insert missing always-on entries ──
  let autoInserted = 0;
  for (const [slug, rootUrl] of Object.entries(HOUSE_ROOTS)) {
    if (RETIRED_HOUSES.has(slug)) continue;
    const normUrl = normaliseUrl(rootUrl);
    if (calendarSlugs.has(slug) || calendarUrls.has(normUrl)) continue;
    // Auto-insert as always-on catalogue with sentinel date (won't be purged)
    const { error } = await supabase.from('auction_calendar').insert({
      house: HOUSE_DISPLAY_NAMES[slug] || slug,
      house_slug: slug,
      logo: '🔨',
      date: '2099-12-31',
      title: 'Current Catalogue',
      url: rootUrl,
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'always_on',
      catalogue_ready: true,
      updated_at: new Date().toISOString(),
    });
    if (!error) {
      autoInserted++;
    } else {
      console.warn(`AUTO-CALENDAR: Failed to insert ${slug}: ${error.message || JSON.stringify(error)}`);
    }
  }
  console.log(`AUTO-CALENDAR: Step 0.5 complete — ${autoInserted} new always-on entries inserted, ${calendarSlugs.size} active slugs found, ${Object.keys(HOUSE_ROOTS).length} total houses`);

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
  for (const row of (existingCalendar || [])) {
    if (row.status !== 'always_on' || !row.house_slug) continue;
    const expected = HOUSE_ROOTS[row.house_slug];
    if (!expected) continue;  // slug no longer in HOUSE_ROOTS (decommissioned house)
    const urlAligned = normaliseUrl(row.url) === normaliseUrl(expected);
    // An always_on catalogue is permanently live by definition, so it must be
    // catalogue_ready — getCalendarAuctions filters on it. A false value here is
    // an anomaly that silently drops the house from scheduling (barnardmarcus:
    // always_on + catalogue_ready=false + homepage URL → 0 scheduled scrapes for
    // 3 weeks, 2026-06-17). Realign the URL AND repair the flag in one pass.
    if (urlAligned && row.catalogue_ready === true) continue; // already correct

    const { error } = await supabase
      .from('auction_calendar')
      .update({ url: expected, catalogue_ready: true, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (!error) {
      urlsRealigned++;
      repairedSlugs.add(row.house_slug);
      console.log(`AUTO-CALENDAR: realigned ${row.house_slug}: '${row.url}' → '${expected}' (catalogue_ready=true)`);
    } else {
      console.warn(`AUTO-CALENDAR: Failed to realign ${row.house_slug}: ${error.message}`);
    }
  }
  if (urlsRealigned > 0) {
    console.log(`AUTO-CALENDAR: ${urlsRealigned} always_on URLs realigned to match HOUSE_ROOTS`);
  }

  // ── Rescue fully-unscheduled houses with dated rows ──
  // The realign pass above is scoped to always_on rows, so a house whose ONLY
  // rows are dated `upcoming` ones with catalogue_ready=false has no repair
  // path — and the always_on backstop insert further up is suppressed because
  // ANY row (even an unschedulable one) puts the slug in calendarSlugs.
  // getCalendarAuctions filters .eq(catalogue_ready, true), so such a house is
  // silently invisible to the scheduler (mchughandco 269 lots / bondwolfe 87
  // lots, stale 15 days, found 2026-06-28). Rescue is deliberately narrow:
  // only when the house has NO schedulable row at all, and only rows whose URL
  // already IS the canonical HOUSE_ROOTS catalogue (a permanently-live listing
  // by definition — the "catalogue not published yet" caveat can't apply).
  // Bespoke per-auction URLs are NOT force-readied; those surface via the
  // house_unscheduled queue guardrail in _doAutoAnalyseAll instead.
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
      console.log(`AUTO-CALENDAR: rescued ${row.house_slug} ${row.date}: catalogue_ready=true (URL is canonical root; house had no schedulable row)`);
    } else {
      console.warn(`AUTO-CALENDAR: Failed to rescue ${row.house_slug}: ${error.message}`);
    }
  }
  if (rescued > 0) {
    console.log(`AUTO-CALENDAR: ${rescued} unscheduled house(s) rescued via dated-row catalogue_ready repair`);
  }

  // ── Migrate legacy entries to always_on ──
  const { data: migratable } = await supabase
    .from('auction_calendar')
    .select('id')
    .eq('title', 'Current Catalogue')
    .neq('status', 'always_on');
  if (migratable && migratable.length > 0) {
    const { error: migErr } = await supabase
      .from('auction_calendar')
      .update({ status: 'always_on', date: '2099-12-31' })
      .eq('title', 'Current Catalogue')
      .neq('status', 'always_on');
    if (!migErr) {
      console.log(`AUTO-CALENDAR: Migrated ${migratable.length} legacy entries to always_on`);
    }
  }

  // syncCalendar potentially deletes, inserts, updates, and migrates rows in
  // auction_calendar. Drop the persist-lots cache once at the end so the
  // next upsert sees the post-sync state — cheaper than invalidating after
  // every individual mutation above.
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
export function pickCatalogueReadyRescues({ rows, houseRoots, retiredHouses, repairedSlugs = new Set(), todayStr }) {
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
      if (row.status !== 'upcoming') continue;
      if (!row.date || String(row.date).slice(0, 10) < todayStr) continue;
      if (normaliseUrl(row.url) !== normaliseUrl(rootUrl)) continue;
      out.push(row);
    }
  }
  return out;
}
