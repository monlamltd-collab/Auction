// tests/test-smart-query-parse.js — locks the price-parsing contract of
// lib/search-query-parse.js::parseSmartSearchQuery. Regression for the
// 2026-07-07 audit findings: "under 1.5m" parsed to a hard £1,000 cap
// (decimal/magnitude blindness + the <10000 ×1000 shorthand), "under 2m"
// parsed to no filter at all while leaking 'under' into freeText ilike
// noise, and "under 5000" was silently multiplied into a £5M cap.

import { parseSmartSearchQuery, REGION_POSTCODES } from '../lib/search-query-parse.js';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
function priceOf(q) {
  const r = parseSmartSearchQuery(q);
  return { max: r.filters.maxPrice, min: r.filters.minPrice, free: r.freeText };
}

console.log('\nprice: decimal + magnitude suffixes (the £1,000-cap regression)');
{
  assert(priceOf('houses under 1.5m').max === 1500000, "'under 1.5m' → £1.5M cap");
  assert(priceOf('under £1.5m').max === 1500000, "'under £1.5m' → £1.5M cap");
  assert(priceOf('under 1.5 million').max === 1500000, "'under 1.5 million' → £1.5M cap");
  assert(priceOf('under 2 million').max === 2000000, "'under 2 million' → £2M cap");
  assert(priceOf('flats under 2m').max === 2000000, "'under 2m' → £2M cap (was: no filter)");
  assert(priceOf('over 1m').min === 1000000, "'over 1m' → £1M floor (was: no filter)");
  assert(priceOf('over 1.2m').min === 1200000, "'over 1.2m' → £1.2M floor");
  assert(priceOf('250 grand max').max === 250000, "'250 grand max' → £250k cap");
}

console.log('\nprice: k-suffix and literal amounts unchanged');
{
  assert(priceOf('under 100k').max === 100000, "'under 100k' → £100k");
  assert(priceOf('over 250k').min === 250000, "'over 250k' → £250k");
  assert(priceOf('under 250,000').max === 250000, "'under 250,000' → £250k");
  assert(priceOf('under £1,500,000').max === 1500000, "'under £1,500,000' → £1.5M");
}

console.log('\nprice: bare-shorthand heuristic only below 1000');
{
  assert(priceOf('under 500').max === 500000, "'under 500' → £500k (shorthand kept)");
  assert(priceOf('garages under 5000').max === 5000, "'under 5000' → £5,000 literal (was £5M)");
  assert(priceOf('under 9999').max === 9999, "'under 9999' → £9,999 literal");
}

console.log('\nprice: between-ranges');
{
  const r = priceOf('between 100k and 200k');
  assert(r.min === 100000 && r.max === 200000, "'between 100k and 200k' → £100k–£200k");
  const r2 = priceOf('houses between £150,000 and £300,000');
  assert(r2.min === 150000 && r2.max === 300000, "'between £150,000 and £300,000' → range");
  const beds = parseSmartSearchQuery('between 4 and 6 beds');
  assert(beds.filters.minPrice === undefined && beds.filters.maxPrice === undefined,
    "'between 4 and 6 beds' does NOT parse as a price range");
}

console.log('\nfreeText: comparison words never leak into ilike noise');
{
  const r = parseSmartSearchQuery('flats under 2m');
  assert(!r.freeText.includes('under'), "'under' absent from freeText");
  const r2 = parseSmartSearchQuery('over 1m in leeds');
  assert(!r2.freeText.includes('over'), "'over' absent from freeText");
  const r3 = parseSmartSearchQuery('max budget 200');
  assert(!r3.freeText.includes('max') && !r3.freeText.includes('budget'),
    "'max'/'budget' absent from freeText");
}

console.log('\nexisting contract intact');
{
  const r = parseSmartSearchQuery('3 bed freehold house in bristol under 200k');
  assert(r.filters.beds === 3, 'beds parsed');
  assert(r.filters.tenure === 'Freehold', 'tenure parsed');
  assert(r.softFilters.prop_type === 'house', 'prop type parsed');
  assert(r.locationTerms.includes('bristol'), 'location parsed');
  assert(r.filters.maxPrice === 200000, 'price parsed');
  const r2 = parseSmartSearchQuery('blocks of flats to title split');
  assert(r2.concepts.includes('multi_unit_freehold'), 'concept detection intact');
}

console.log('\nregion map: exported for the UI-dropdown → AI-scope path');
{
  // The smart-search route imports REGION_POSTCODES to fold the fLocation
  // dropdown into the same scoping the query-text region path uses. If this
  // export or its keys drift, the region dropdown silently stops reaching the
  // AI and the "N matches vs 1 card" desync returns (2026-07-09 fix).
  assert(REGION_POSTCODES && typeof REGION_POSTCODES === 'object', 'REGION_POSTCODES is exported');
  assert(Array.isArray(REGION_POSTCODES['south west']), "'south west' key present");
  assert(REGION_POSTCODES['south west'].includes('BA'), "'south west' includes BA (Yeovil/Bath)");
  assert(!REGION_POSTCODES['south west'].includes('B'), "'south west' excludes bare 'B' (Birmingham)");
  // Query-text region path still populates filters from the same map — the
  // route's dropdown injection only fires when this is absent.
  const r = parseSmartSearchQuery('flats in south west');
  assert(r.filters.regionName === 'south west', 'query-text region sets regionName');
  assert(r.filters.regionPostcodes === REGION_POSTCODES['south west'],
    'query-text region reuses the exported map (single source of truth)');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
