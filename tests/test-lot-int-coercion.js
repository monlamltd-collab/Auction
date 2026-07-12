// tests/test-lot-int-coercion.js — regression for the production write error
// `invalid input syntax for type integer: "2.5"`.
//
// The Firecrawl JSON-extract schema declares `bedrooms` a NUMBER, so AI
// extraction can emit a fractional value (2.5); normaliseScrapedLot passed it
// straight through to the INTEGER `beds` column. Postgres rejects "2.5", which
// fails the ENTIRE 50-row batch upsert and silently drops those lots. lotToDbRow
// now coerces every integer column (round numeric-ish, null anything else).

import { lotToDbRow } from '../lib/types/lot.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const INT_COLS = ['price', 'beds', 'lease_length', 'sqft', 'units', 'epc_score',
  'flood_zone', 'street_sales_count', 'below_market', 'est_monthly_rent'];

console.log('Test 1: fractional beds (2.5) is rounded to an integer, never passed through as-is');
{
  const row = lotToDbRow({ url: 'https://x/1', address: '1 Test St, London, E1 1AA', beds: 2.5 });
  assert(row.beds === 3, `beds 2.5 -> 3 (got ${row.beds})`);
  assert(Number.isInteger(row.beds), 'beds is an integer');
}

console.log('\nTest 2: a numeric STRING "4.5" is coerced (AI/JSON can emit strings too)');
{
  const row = lotToDbRow({ url: 'https://x/2', address: '2 Test St, London, E1 1AA', below_market: '2.5', belowMarket: '2.5' });
  assert(row.below_market === 3, `below_market "2.5" -> 3 (got ${row.below_market})`);
}

console.log('\nTest 3: every integer column coerces a fractional value');
{
  const lot = { url: 'https://x/3', address: '3 Test St, London, E1 1AA',
    price: 125000.4, beds: 1.5, leaseLength: 99.5, sqft: 800.5, units: 2.5,
    epcScore: 60.5, floodZone: 2.5, streetSalesCount: 3.5, belowMarket: 4.5, estMonthlyRent: 950.5 };
  const row = lotToDbRow(lot);
  for (const c of INT_COLS) {
    assert(Number.isInteger(row[c]), `${c} is an integer (got ${row[c]})`);
  }
}

console.log('\nTest 4: clean integers and nulls are preserved; undefined is skipped');
{
  const row = lotToDbRow({ url: 'https://x/4', address: '4 Test St, London, E1 1AA', beds: 3, sqft: null });
  assert(row.beds === 3, 'integer beds preserved');
  assert(row.sqft === null, 'null sqft preserved as null');
  assert(!('units' in row), 'undefined units column is not written (no clobber)');
}

console.log('\nTest 5: a non-numeric value becomes null rather than crashing the batch');
{
  const row = lotToDbRow({ url: 'https://x/5', address: '5 Test St, London, E1 1AA', beds: 'studio' });
  assert(row.beds === null, `unparseable beds -> null (got ${JSON.stringify(row.beds)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
