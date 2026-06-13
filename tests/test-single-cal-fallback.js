/**
 * Pure-function tests for the single-calendar-row fallback in
 * resolveCalendarEntry (lib/pipeline/persist-lots.js).
 *
 * Move 2 / Follow-up E covers the url_mismatch cohort by attributing
 * lots to the only calendar row available for a house when no URL match
 * exists. Multi-row houses get no fallback (would mis-attribute).
 *
 * Run: node tests/test-single-cal-fallback.js
 */

// Stub Supabase env so the persist-lots.js module graph doesn't error on
// import (same shim used by tests/test-prune-vanished.js).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { resolveCalendarEntry, pickCalendarEntryForUrl } = await import('../lib/pipeline/persist-lots.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Build a calMap of the shape getCalendarDateMap() returns.
function buildMap(rows) {
  const urlMap = new Map();
  const houseMap = new Map();
  for (const r of rows) {
    const k = r.url; // tests use already-normalised URLs to keep deps small
    if (k && !urlMap.has(k)) urlMap.set(k, { date: r.date, id: r.id });
    if (r.house_slug) {
      if (!houseMap.has(r.house_slug)) houseMap.set(r.house_slug, []);
      houseMap.get(r.house_slug).push({ date: r.date, id: r.id, status: r.status || null });
    }
  }
  return { urlMap, houseMap };
}

console.log('Test 1: direct URL match wins');
{
  const m = buildMap([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/may', date: '2026-05-20' },
    { id: 'a-2', house_slug: 'allsop', url: 'https://allsop.co.uk/jun', date: '2026-06-20' },
  ]);
  const e = resolveCalendarEntry(m, 'allsop', 'https://allsop.co.uk/may');
  assert(e && e.id === 'a-1', 'matched by URL');
}

console.log('\nTest 2: URL miss with single-cal house → fallback fires');
{
  // Landwood-style: one calendar row, lots' URL doesn't match.
  const m = buildMap([
    { id: 'l-1', house_slug: 'landwood', url: 'https://landwoodpropertyauctions.com/future-auctions?showall=true', date: '2099-12-31' },
  ]);
  const e = resolveCalendarEntry(m, 'landwood', 'https://landwoodpropertyauctions.com'); // bare, doesn't match
  assert(e && e.id === 'l-1', 'fallback to single calendar row');
}

console.log('\nTest 3: URL miss with multi-cal house → NO fallback');
{
  // sdl umbrella: multiple calendar rows. Mis-attribution risk → no fallback.
  const m = buildMap([
    { id: 's-1', house_slug: 'sdl', url: 'https://sdlauctions.co.uk/x', date: '2026-05-20' },
    { id: 's-2', house_slug: 'sdl', url: 'https://charlesdarrow.co.uk/y', date: '2026-06-20' },
  ]);
  const e = resolveCalendarEntry(m, 'sdl', 'https://btgeddisons.com/z'); // doesn't match either
  assert(e === null, 'multi-row house → no fallback (lot stays NULL)');
}

console.log('\nTest 4: URL miss with unknown house → null');
{
  const m = buildMap([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/x', date: '2026-05-20' },
  ]);
  const e = resolveCalendarEntry(m, 'newhouse', 'https://newhouse.co.uk/x');
  assert(e === null, 'unknown house with no calendar rows → null');
}

console.log('\nTest 5: URL miss with empty calendar → null');
{
  const m = buildMap([]);
  const e = resolveCalendarEntry(m, 'landwood', 'https://landwoodpropertyauctions.com');
  assert(e === null, 'empty calendar → null');
}

console.log('\nTest 6: null calMap → null (defensive)');
{
  assert(resolveCalendarEntry(null, 'landwood', 'x') === null, 'null calMap → null');
  assert(resolveCalendarEntry(undefined, 'landwood', 'x') === null, 'undefined calMap → null');
}

console.log('\nTest 7: URL match takes precedence over fallback');
{
  // Allsop has 1 calendar row. The URL matches. Direct match wins.
  // (Asserts the fallback doesn't override a successful direct match.)
  const m = buildMap([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/x', date: '2026-05-20' },
  ]);
  const e = resolveCalendarEntry(m, 'allsop', 'https://allsop.co.uk/x');
  assert(e && e.id === 'a-1', 'direct match used (not fallback)');
}

console.log('\nTest 8: URL miss but house has exactly one row across different houses');
{
  // mccartneys is single-cal; allsop is multi-cal; lookup mccartneys.
  const m = buildMap([
    { id: 'm-1', house_slug: 'mccartneys', url: 'https://mccartneys.co.uk/property-search/?department=property-land-auctions', date: '2099-12-31' },
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/may', date: '2026-05-20' },
    { id: 'a-2', house_slug: 'allsop', url: 'https://allsop.co.uk/jun', date: '2026-06-20' },
  ]);
  const e = resolveCalendarEntry(m, 'mccartneys', 'https://mccartneys.co.uk/auctions'); // doesn't match
  assert(e && e.id === 'm-1', 'mccartneys (single-cal) gets fallback');
  const e2 = resolveCalendarEntry(m, 'allsop', 'https://allsop.co.uk/aug'); // doesn't match
  assert(e2 === null, 'allsop (multi-cal) gets no fallback');
}

console.log('\nTest 9: house with single row but null house_slug-keyed entry is defensively null');
{
  // Edge case: caller passes house='', null, or undefined → no house key lookup.
  const m = buildMap([
    { id: 'l-1', house_slug: 'landwood', url: 'https://x.com', date: '2099-12-31' },
  ]);
  assert(resolveCalendarEntry(m, '', 'https://nope.com') === null, 'empty house string → no fallback');
  assert(resolveCalendarEntry(m, null, 'https://nope.com') === null, 'null house → no fallback');
  assert(resolveCalendarEntry(m, undefined, 'https://nope.com') === null, 'undefined house → no fallback');
}

// ─────────────────────────────────────────────────────────────
// Follow-up F: always_on fallback (the generalisation of #5)
// ─────────────────────────────────────────────────────────────

console.log('\nTest 10: always_on fallback — multi-cal house, one always_on → falls back to always_on');
{
  // buttersjohnbee-style: 1 always_on + 1 upcoming. URL doesn't match either.
  const m = buildMap([
    { id: 'b-always', house_slug: 'buttersjohnbee', url: 'https://buttersjohnbee.com/listings?viewtype=gallery&...', date: '2099-12-31', status: 'always_on' },
    { id: 'b-upcoming', house_slug: 'buttersjohnbee', url: 'https://buttersjohnbee.com/properties-for-auction', date: '2026-05-24', status: 'upcoming' },
  ]);
  const e = resolveCalendarEntry(m, 'buttersjohnbee', 'https://buttersjohnbee.com/listings?auction=1&status=all');
  assert(e && e.id === 'b-always', 'always_on row picked (not the upcoming row)');
}

console.log('\nTest 11: always_on fallback — multiple always_on → NO fallback');
{
  // sdl-style: 3 always_on rows after PR #32 (sdlauctions, charlesdarrow, btgeddisons).
  // URL doesn't match any. Ambiguous → no fallback.
  const m = buildMap([
    { id: 's-1', house_slug: 'sdl', url: 'https://sdlauctions.co.uk/x', date: '2099-12-31', status: 'always_on' },
    { id: 's-2', house_slug: 'sdl', url: 'https://charlesdarrow.co.uk/y', date: '2099-12-31', status: 'always_on' },
    { id: 's-3', house_slug: 'sdl', url: 'https://btgeddisons.com/z', date: '2099-12-31', status: 'always_on' },
  ]);
  const e = resolveCalendarEntry(m, 'sdl', 'https://unknown.com/w');
  assert(e === null, 'multiple always_on rows → ambiguous → no fallback');
}

console.log('\nTest 12: always_on fallback — no always_on, only specific-date rows → NO fallback');
{
  // maggsandallen-style: 3 specific-month rows. None always_on. Lot URL doesn't match.
  // We can't pick a date arbitrarily → no fallback.
  const m = buildMap([
    { id: 'm-apr', house_slug: 'maggsandallen', url: 'https://x/apr', date: '2026-04-15', status: 'upcoming' },
    { id: 'm-may', house_slug: 'maggsandallen', url: 'https://x/may', date: '2026-05-15', status: 'upcoming' },
    { id: 'm-jun', house_slug: 'maggsandallen', url: 'https://x/jun', date: '2026-06-15', status: 'upcoming' },
  ]);
  const e = resolveCalendarEntry(m, 'maggsandallen', 'https://x/?orderby=lot_no');
  assert(e === null, 'no always_on + multiple specific-date → no fallback');
}

console.log('\nTest 13: always_on fallback — exactly 1 always_on among many specific-date');
{
  // Mixed: 1 always_on + many specific-date. Always_on wins.
  const m = buildMap([
    { id: 'b-1', house_slug: 'h', url: 'https://x/may', date: '2026-05-15', status: 'upcoming' },
    { id: 'b-2', house_slug: 'h', url: 'https://x/jun', date: '2026-06-15', status: 'upcoming' },
    { id: 'b-always', house_slug: 'h', url: 'https://x/all', date: '2099-12-31', status: 'always_on' },
    { id: 'b-3', house_slug: 'h', url: 'https://x/jul', date: '2026-07-15', status: 'upcoming' },
  ]);
  const e = resolveCalendarEntry(m, 'h', 'https://x/unknown');
  assert(e && e.id === 'b-always', 'always_on among many specific-date rows still wins');
}

console.log('\nTest 14: always_on fallback — does NOT override direct URL match');
{
  const m = buildMap([
    { id: 'm-may', house_slug: 'h', url: 'https://x/may', date: '2026-05-15', status: 'upcoming' },
    { id: 'b-always', house_slug: 'h', url: 'https://x/all', date: '2099-12-31', status: 'always_on' },
  ]);
  const e = resolveCalendarEntry(m, 'h', 'https://x/may');
  assert(e && e.id === 'm-may', 'direct URL match wins, not always_on');
}

console.log('\nTest 15: always_on fallback — single-cal-row rule still wins when only 1 row');
{
  // Single row with status=upcoming. Single-cal rule (Test 2) still fires —
  // we don't care about status when there's just one row.
  const m = buildMap([
    { id: 'l-1', house_slug: 'landwood', url: 'https://landwood.com/x', date: '2099-12-31', status: 'upcoming' },
  ]);
  const e = resolveCalendarEntry(m, 'landwood', 'https://landwood.com/bare');
  assert(e && e.id === 'l-1', 'single-cal rule fires regardless of status');
}

// ─────────────────────────────────────────────────────────────
// Rolling catalogue-URL selection: pickCalendarEntryForUrl
//
// A house that reuses ONE catalogue URL (e.g. "/current-auction") across
// monthly sales accumulates several calendar rows on that URL. The OLD rule
// in getCalendarDateMap was "earliest date wins", which bound the URL to the
// STALEST past auction. mchughandco 2026-06-13: 271 live lots stamped with a
// month-old 2026-05-13 date (the real upcoming sale was 2026-06-30) →
// auction_date < today → hidden from the live view. The live catalogue at a
// rolling URL is always the SOONEST UPCOMING auction.
// ─────────────────────────────────────────────────────────────

const TODAY = '2026-06-13';

console.log('\nTest 16: rolling URL — soonest UPCOMING wins over a stale past row (mchughandco)');
{
  // Calendar rows arrive date-ASC, so the stale past row is first — the bug.
  const e = pickCalendarEntryForUrl(
    [{ id: 'may', date: '2026-05-13' }, { id: 'jun', date: '2026-06-30' }],
    TODAY,
  );
  assert(e && e.id === 'jun', `picks the future auction, not the month-old one (got ${e && e.id})`);
}

console.log('\nTest 17: rolling URL — soonest of MULTIPLE upcoming rows wins');
{
  const e = pickCalendarEntryForUrl(
    [{ id: 'jul', date: '2026-07-28' }, { id: 'jun', date: '2026-06-30' }],
    TODAY,
  );
  assert(e && e.id === 'jun', `nearest upcoming auction (got ${e && e.id})`);
}

console.log('\nTest 18: rolling URL — all rows past → MOST RECENT (least stale) wins, not earliest');
{
  const e = pickCalendarEntryForUrl(
    [{ id: 'apr', date: '2026-04-15' }, { id: 'may', date: '2026-05-13' }],
    TODAY,
  );
  assert(e && e.id === 'may', `most recent past auction when none upcoming (got ${e && e.id})`);
}

console.log('\nTest 19: rolling URL — today counts as upcoming (>=)');
{
  const e = pickCalendarEntryForUrl(
    [{ id: 'today', date: TODAY }, { id: 'jul', date: '2026-07-28' }],
    TODAY,
  );
  assert(e && e.id === 'today', `an auction dated today is live, not past (got ${e && e.id})`);
}

console.log('\nTest 20: rolling URL — single row / empty / null-date edge cases');
{
  assert(pickCalendarEntryForUrl([{ id: 'only', date: '2026-06-30' }], TODAY)?.id === 'only', 'single row returned as-is');
  assert(pickCalendarEntryForUrl([], TODAY) === null, 'empty → null');
  assert(pickCalendarEntryForUrl(null, TODAY) === null, 'null → null');
  // A row with no date can't be ranked; a dated row beside it wins.
  const e = pickCalendarEntryForUrl([{ id: 'nodate', date: null }, { id: 'jun', date: '2026-06-30' }], TODAY);
  assert(e && e.id === 'jun', 'dated row preferred over a null-date row');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
