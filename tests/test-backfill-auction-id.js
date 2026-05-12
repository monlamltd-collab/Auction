/**
 * Pure-function tests for the Move 2 backfill matching logic at
 * lib/pipeline/backfill-auction-id-logic.js.
 *
 * Run: node tests/test-backfill-auction-id.js
 */

import {
  buildCalendarIndex,
  matchLotToCalendar,
} from '../lib/pipeline/backfill-auction-id-logic.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: buildCalendarIndex — keys are (house_slug, url)');
{
  const idx = buildCalendarIndex([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/auctions/may-2026', date: '2026-05-20' },
    { id: 'b-1', house_slug: 'savills', url: 'https://savills.co.uk/auctions/may', date: '2026-05-21' },
  ]);
  assert(idx.size === 2, '2 rows → 2 keys');
  assert(idx.has('allsop|https://allsop.co.uk/auctions/may-2026'), 'allsop key present');
  assert(idx.has('savills|https://savills.co.uk/auctions/may'), 'savills key present');
  const allsop = idx.get('allsop|https://allsop.co.uk/auctions/may-2026');
  assert(allsop.id === 'a-1' && allsop.date === '2026-05-20', 'allsop entry shape correct');
}

console.log('\nTest 2: buildCalendarIndex — most-recent wins on key collision (caller orders DESC)');
{
  // Caller orders by date DESC. First .set() is most recent.
  const idx = buildCalendarIndex([
    { id: 'a-newer', house_slug: 'allsop', url: 'https://allsop.co.uk/x', date: '2026-05-20' },
    { id: 'a-older', house_slug: 'allsop', url: 'https://allsop.co.uk/x', date: '2025-12-01' },
  ]);
  assert(idx.size === 1, 'one entry for the colliding key');
  assert(idx.get('allsop|https://allsop.co.uk/x').id === 'a-newer', 'most-recent id wins');
}

console.log('\nTest 3: buildCalendarIndex — skips malformed rows');
{
  const idx = buildCalendarIndex([
    null,
    undefined,
    {},
    { id: '', house_slug: 'allsop', url: 'https://x', date: '2026-05-20' },
    { id: 'ok', house_slug: 'allsop', url: 'https://x', date: '2026-05-20' },
    { id: 'no-slug', url: 'https://y' },
    { id: 'no-url', house_slug: 'allsop' },
  ]);
  assert(idx.size === 1, 'only the well-formed row indexed');
  assert(idx.has('allsop|https://x'), 'the good key is present');
}

console.log('\nTest 4: buildCalendarIndex — null/undefined input');
{
  assert(buildCalendarIndex(null).size === 0, 'null → empty map');
  assert(buildCalendarIndex(undefined).size === 0, 'undefined → empty map');
  assert(buildCalendarIndex([]).size === 0, '[] → empty map');
}

console.log('\nTest 5: matchLotToCalendar — direct match');
{
  const idx = buildCalendarIndex([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/may', date: '2026-05-20' },
  ]);
  const m = matchLotToCalendar({ house: 'allsop', catalogue_url: 'https://allsop.co.uk/may' }, idx);
  assert(m && m.id === 'a-1', 'matched and returned a-1');
}

console.log('\nTest 6: matchLotToCalendar — normalises lot.catalogue_url before lookup');
{
  // Index holds normalised form. Lot might have trailing slash / mixed case / www. prefix.
  const idx = buildCalendarIndex([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/may', date: '2026-05-20' },
  ]);
  const variants = [
    'https://allsop.co.uk/may/',          // trailing slash
    'HTTPS://Allsop.co.uk/may',           // mixed case
    'https://www.allsop.co.uk/may',       // www. prefix
    'http://allsop.co.uk/may',            // http:// scheme
  ];
  for (const v of variants) {
    const m = matchLotToCalendar({ house: 'allsop', catalogue_url: v }, idx);
    assert(m && m.id === 'a-1', `variant matched: ${v}`);
  }
}

console.log('\nTest 7: matchLotToCalendar — house mismatch returns null');
{
  const idx = buildCalendarIndex([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/may', date: '2026-05-20' },
  ]);
  const m = matchLotToCalendar({ house: 'savills', catalogue_url: 'https://allsop.co.uk/may' }, idx);
  assert(m === null, 'wrong house returns null');
}

console.log('\nTest 8: matchLotToCalendar — url mismatch returns null');
{
  const idx = buildCalendarIndex([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/may', date: '2026-05-20' },
  ]);
  const m = matchLotToCalendar({ house: 'allsop', catalogue_url: 'https://allsop.co.uk/november' }, idx);
  assert(m === null, 'unknown url returns null');
}

console.log('\nTest 9: matchLotToCalendar — malformed lot returns null');
{
  const idx = buildCalendarIndex([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/may', date: '2026-05-20' },
  ]);
  assert(matchLotToCalendar(null, idx) === null, 'null lot → null');
  assert(matchLotToCalendar({}, idx) === null, 'empty lot → null');
  assert(matchLotToCalendar({ house: 'allsop' }, idx) === null, 'missing catalogue_url → null');
  assert(matchLotToCalendar({ catalogue_url: 'x' }, idx) === null, 'missing house → null');
  assert(matchLotToCalendar({ house: 'allsop', catalogue_url: 'x' }, null) === null, 'null index → null');
}

console.log('\nTest 10: idempotency — re-matching the same lot returns the same result');
{
  const idx = buildCalendarIndex([
    { id: 'a-1', house_slug: 'allsop', url: 'https://allsop.co.uk/may', date: '2026-05-20' },
    { id: 'a-2', house_slug: 'allsop', url: 'https://allsop.co.uk/jun', date: '2026-06-20' },
  ]);
  const lot = { house: 'allsop', catalogue_url: 'https://allsop.co.uk/may' };
  const m1 = matchLotToCalendar(lot, idx);
  const m2 = matchLotToCalendar(lot, idx);
  const m3 = matchLotToCalendar(lot, idx);
  assert(m1.id === m2.id && m2.id === m3.id && m1.id === 'a-1', 'idempotent: same lot → same auction id (3 runs)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
