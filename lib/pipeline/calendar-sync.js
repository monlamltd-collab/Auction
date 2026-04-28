// lib/pipeline/calendar-sync.js — Ensure every HOUSE_ROOTS entry has at least one calendar entry
import { log } from '../logging.js';
import { normaliseUrl } from '../utils.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../houses.js';

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
    .select('id, house_slug, url, status')
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
  for (const row of (existingCalendar || [])) {
    if (row.status !== 'always_on' || !row.house_slug) continue;
    const expected = HOUSE_ROOTS[row.house_slug];
    if (!expected) continue;  // slug no longer in HOUSE_ROOTS (decommissioned house)
    if (normaliseUrl(row.url) === normaliseUrl(expected)) continue; // already aligned

    const { error } = await supabase
      .from('auction_calendar')
      .update({ url: expected, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (!error) {
      urlsRealigned++;
      console.log(`AUTO-CALENDAR: realigned ${row.house_slug}: '${row.url}' → '${expected}'`);
    } else {
      console.warn(`AUTO-CALENDAR: Failed to realign ${row.house_slug}: ${error.message}`);
    }
  }
  if (urlsRealigned > 0) {
    console.log(`AUTO-CALENDAR: ${urlsRealigned} always_on URLs realigned to match HOUSE_ROOTS`);
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
}
