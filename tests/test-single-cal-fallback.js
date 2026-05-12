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

const { resolveCalendarEntry } = await import('../lib/pipeline/persist-lots.js');

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
      houseMap.get(r.house_slug).push({ date: r.date, id: r.id });
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
