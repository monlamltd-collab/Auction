/**
 * Saved-search email alerts — pure-function tests.
 *
 * Covers the matcher (which lots satisfy a given filter set) and the
 * email-body renderer. The cycle runner itself is exercised manually
 * once the daily cron starts firing in production; the matcher is the
 * load-bearing piece.
 *
 * Run: node tests/test-saved-search-alerts.js
 */

import { matchLotAgainstFilters, renderAlertEmail } from '../lib/pipeline/saved-search-alerts.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const baseLot = {
  id: 'b9b0f77e-0001-0000-0000-000000000001',
  _house: 'allsop',
  lot: 1,
  url: 'https://example.com/lot/1',
  address: '12 Acacia Avenue, Bristol, BS1 1AB',
  postcode: 'BS1 1AB',
  price: 250000,
  priceText: '£250,000',
  propType: 'house',
  beds: 3,
  tenure: 'Freehold',
  condition: 'needs_modernisation',
  imageUrl: 'https://example.com/img.jpg',
  status: 'available',
  score: 7.5,
  dealType: 'refurb',
  _searchText: '12 acacia avenue bristol bs1 1ab',
};

// ── Test 1: empty filter set matches anything available ──
console.log('Test 1: empty filters match a normal lot');
{
  assert(matchLotAgainstFilters(baseLot, {}) === true, 'empty filter passes a normal lot');
  assert(matchLotAgainstFilters(null, {}) === false, 'null lot rejected');
  assert(matchLotAgainstFilters(baseLot, null) === false, 'null filters rejected');
}

// ── Test 2: price band ──
console.log('\nTest 2: price band filter');
{
  assert(matchLotAgainstFilters(baseLot, { minPrice: '100000' }) === true, 'min 100k, lot 250k → ok');
  assert(matchLotAgainstFilters(baseLot, { minPrice: '300000' }) === false, 'min 300k, lot 250k → reject');
  assert(matchLotAgainstFilters(baseLot, { maxPrice: '500000' }) === true, 'max 500k, lot 250k → ok');
  assert(matchLotAgainstFilters(baseLot, { maxPrice: '200000' }) === false, 'max 200k, lot 250k → reject');
  assert(matchLotAgainstFilters(baseLot, { minPrice: '200000', maxPrice: '300000' }) === true, 'band 200-300k, lot 250k → ok');
  assert(matchLotAgainstFilters({ ...baseLot, price: null }, { maxPrice: '500000' }) === false, 'null price rejected when max set');
}

// ── Test 3: excludePOA ──
console.log('\nTest 3: excludePOA');
{
  assert(matchLotAgainstFilters({ ...baseLot, price: null }, { excludePOA: 'yes' }) === false, 'null price hidden by excludePOA');
  assert(matchLotAgainstFilters({ ...baseLot, price: 0 }, { excludePOA: 'yes' }) === false, 'zero price hidden by excludePOA');
  assert(matchLotAgainstFilters(baseLot, { excludePOA: 'yes' }) === true, 'real price not hidden');
}

// ── Test 4: beds (N+) ──
console.log('\nTest 4: beds N+ filter');
{
  assert(matchLotAgainstFilters(baseLot, { beds: '2' }) === true, '2+ beds, lot has 3 → ok');
  assert(matchLotAgainstFilters(baseLot, { beds: '3' }) === true, '3+ beds, lot has 3 → ok');
  assert(matchLotAgainstFilters(baseLot, { beds: '4' }) === false, '4+ beds, lot has 3 → reject');
  assert(matchLotAgainstFilters({ ...baseLot, beds: null }, { beds: '2' }) === false, 'no beds value, 2+ filter → reject');
}

// ── Test 5: prop type substring ──
console.log('\nTest 5: prop type');
{
  assert(matchLotAgainstFilters(baseLot, { type: 'house' }) === true, 'house filter matches house lot');
  assert(matchLotAgainstFilters(baseLot, { type: 'flat' }) === false, 'flat filter rejects house lot');
  assert(matchLotAgainstFilters({ ...baseLot, propType: 'semi-detached house' }, { type: 'house' }) === true, 'substring match');
}

// ── Test 6: status ──
console.log('\nTest 6: status filter');
{
  assert(matchLotAgainstFilters(baseLot, { status: 'all' }) === true, 'status=all matches available lot');
  assert(matchLotAgainstFilters(baseLot, { status: 'available' }) === true, 'available matches');
  assert(matchLotAgainstFilters({ ...baseLot, status: 'sold' }, { status: 'available' }) === false, 'sold rejected when available');
  assert(matchLotAgainstFilters({ ...baseLot, status: 'unsold' }, { status: 'unsold' }) === true, 'unsold matches');
  assert(matchLotAgainstFilters({ ...baseLot, status: 'no_bid' }, { status: 'unsold' }) === true, 'no_bid synonym for unsold');
}

// ── Test 7: tenure ──
console.log('\nTest 7: tenure');
{
  assert(matchLotAgainstFilters(baseLot, { tenure: 'Freehold' }) === true, 'Freehold matches');
  assert(matchLotAgainstFilters(baseLot, { tenure: 'Leasehold' }) === false, 'Leasehold rejects Freehold lot');
  assert(matchLotAgainstFilters({ ...baseLot, tenure: 'freehold' }, { tenure: 'Freehold' }) === true, 'case-insensitive');
}

// ── Test 8: location / town ──
console.log('\nTest 8: location and town');
{
  assert(matchLotAgainstFilters(baseLot, { location: 'south west' }) === false, 'south-west region not in address');
  assert(matchLotAgainstFilters(baseLot, { town: 'Bristol' }) === true, 'town Bristol in address');
  assert(matchLotAgainstFilters(baseLot, { town: 'Manchester' }) === false, 'town Manchester not in address');
  assert(matchLotAgainstFilters(baseLot, { town: 'BRISTOL' }) === true, 'town case-insensitive');
}

// ── Test 9: postcode prefix ──
console.log('\nTest 9: postcode prefix');
{
  assert(matchLotAgainstFilters(baseLot, { postcode: 'BS1' }) === true, 'BS1 matches BS1 1AB');
  assert(matchLotAgainstFilters(baseLot, { postcode: 'BS' }) === true, 'BS matches BS1 1AB');
  assert(matchLotAgainstFilters(baseLot, { postcode: 'M1' }) === false, 'M1 rejects BS1 1AB');
  assert(matchLotAgainstFilters(baseLot, { postcode: 'bs1' }) === true, 'lowercase normalised');
}

// ── Test 10: deal + condition ──
console.log('\nTest 10: deal + condition');
{
  assert(matchLotAgainstFilters(baseLot, { deal: 'refurb' }) === true, 'refurb matches');
  assert(matchLotAgainstFilters(baseLot, { deal: 'btl' }) === false, 'btl rejects refurb');
  assert(matchLotAgainstFilters(baseLot, { condition: 'modernisation' }) === true, 'condition substring');
}

// ── Test 11: multiple filters AND together ──
console.log('\nTest 11: AND of filters');
{
  const f = { minPrice: '200000', maxPrice: '300000', beds: '3', type: 'house', tenure: 'Freehold', town: 'Bristol' };
  assert(matchLotAgainstFilters(baseLot, f) === true, 'all filters satisfied');
  assert(matchLotAgainstFilters({ ...baseLot, beds: 2 }, f) === false, 'fails beds → reject');
  assert(matchLotAgainstFilters({ ...baseLot, tenure: 'Leasehold' }, f) === false, 'fails tenure → reject');
}

// ── Test 12: email renderer ──
console.log('\nTest 12: renderAlertEmail');
{
  const out = renderAlertEmail({
    searchName: 'Bristol BTL',
    matches: [baseLot],
  });
  assert(out.subject === '1 new lot match your saved search "Bristol BTL"', 'subject for 1 match');
  assert(out.html.includes('12 Acacia Avenue, Bristol, BS1 1AB'), 'address rendered');
  assert(out.html.includes('£250,000'), 'price rendered');
  assert(out.html.includes('/lot/' + baseLot.id), 'deep link to lot detail page');
  assert(out.html.includes('Score 7.5/10'), 'score rendered');
  assert(out.html.includes('"Bristol BTL"'), 'search name in body');

  const out2 = renderAlertEmail({ searchName: 'X', matches: [baseLot, baseLot, baseLot] });
  assert(out2.subject.startsWith('3 new lots'), 'plural for >1');

  // Tier-scaled depth (2026-07-04: alerts free for all; Pro = full depth).
  // 11 matches → free shows 5 cards + overflow + upgrade hint; Pro shows 10.
  const many = Array.from({ length: 11 }, (_, i) => ({ ...baseLot, id: 'b9b0f77e-0001-0000-0000-' + String(i).padStart(12, '0') }));
  const freeOut = renderAlertEmail({ searchName: 'X', matches: many });
  assert(freeOut.html.includes('and 6 more matches'), 'free tier (default) caps at 5 cards');
  assert(freeOut.html.includes('Pro members get every match'), 'free overflow carries the upgrade hint');
  const proOut = renderAlertEmail({ searchName: 'X', matches: many, tier: 'premium' });
  assert(proOut.html.includes('and 1 more matches'), 'premium caps at 10 cards');
  assert(!proOut.html.includes('Pro members get every match'), 'no upgrade hint for premium');
  const fewOut = renderAlertEmail({ searchName: 'X', matches: [baseLot, baseLot] });
  assert(!fewOut.html.includes('more matches'), 'no overflow line under the cap');
}

// ── Test 13: subject + html escape user-controlled name ──
console.log('\nTest 13: search name is HTML-escaped in body');
{
  const out = renderAlertEmail({ searchName: '<script>alert(1)</script>', matches: [baseLot] });
  assert(!out.html.includes('<script>alert(1)</script>'), 'script tag not present raw');
  assert(out.html.includes('&lt;script&gt;'), 'escaped form present');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
