// tests/test-rentals-comps.js — locks the contract of the rental-comps
// lookup that feeds the deal stacker:
//   • getPostcodeDistrict (pure)
//   • compsTypesForLot   (pure)
//   • estimateMonthlyRentSmart tier ordering (with a stubbed supabase)
//
// PR A — adds:
//   - 6-month recency window
//   - property_type filter (with NULLs allowed for OnTheMarket)
//   - district-level fallback (BS1 *) when full-postcode is thin
//
// The stubbed supabase records every filter applied and dispatches
// canned data based on which "tier" the query corresponds to. That way
// we test tier ordering without a live DB.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const enrichmentMod = await import('../lib/enrichment.js');
const {
  getPostcodeDistrict,
  compsTypesForLot,
  estimateMonthlyRentSmart,
  initEnrichment,
} = enrichmentMod;

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// ── getPostcodeDistrict ────────────────────────────────────────────────
console.log('\ngetPostcodeDistrict: canonical postcodes');
{
  assert(getPostcodeDistrict('BS1 4AB') === 'BS1', 'BS1 4AB → BS1');
  assert(getPostcodeDistrict('SW1A 1AA') === 'SW1A', 'SW1A 1AA → SW1A (with letter suffix)');
  assert(getPostcodeDistrict('EC1A 1BB') === 'EC1A', 'EC1A 1BB → EC1A (London exception)');
  assert(getPostcodeDistrict('M1 2AB') === 'M1', 'M1 2AB → M1 (single-letter area)');
  assert(getPostcodeDistrict('LS16 7JQ') === 'LS16', 'LS16 7JQ → LS16 (two-digit district)');
  assert(getPostcodeDistrict('bs1 4ab') === 'BS1', 'lowercase → uppercase');
}

console.log('\ngetPostcodeDistrict: junk / partial input');
{
  assert(getPostcodeDistrict('') === '', 'empty string → empty');
  assert(getPostcodeDistrict(null) === '', 'null → empty');
  assert(getPostcodeDistrict(undefined) === '', 'undefined → empty');
  assert(getPostcodeDistrict('not a postcode') === '', 'junk → empty');
  assert(getPostcodeDistrict('BS1') === '', 'partial (no second half) → empty (we want full units)');
  assert(getPostcodeDistrict('BS164 7JQ') === '', '4-char district (invalid shape) → empty');
  assert(getPostcodeDistrict(123) === '', 'non-string → empty');
}

// ── compsTypesForLot ──────────────────────────────────────────────────
console.log('\ncompsTypesForLot: residential mappings');
{
  assert(JSON.stringify(compsTypesForLot('house')) === JSON.stringify(['house', 'bungalow']),
    'house → [house, bungalow]');
  assert(JSON.stringify(compsTypesForLot('bungalow')) === JSON.stringify(['house', 'bungalow']),
    'bungalow → [house, bungalow]');
  assert(JSON.stringify(compsTypesForLot('flat')) === JSON.stringify(['flat', 'studio']),
    'flat → [flat, studio]');
}

console.log('\ncompsTypesForLot: non-residential → null (skip comps)');
{
  assert(compsTypesForLot('commercial') === null, 'commercial → null');
  assert(compsTypesForLot('land') === null, 'land → null');
  assert(compsTypesForLot('garage') === null, 'garage → null');
  assert(compsTypesForLot('other') === null, 'other → null');
  assert(compsTypesForLot(undefined) === null, 'undefined → null');
  assert(compsTypesForLot(null) === null, 'null → null');
  assert(compsTypesForLot('') === null, 'empty string → null');
}

// ── estimateMonthlyRentSmart: tier ordering with stubbed supabase ─────
//
// The stub records every filter applied to the query builder and
// returns canned rows based on a per-test handler.

function makeSupabaseStub(handler) {
  function makeBuilder() {
    const filters = [];
    const builder = {
      from(t)         { filters.push(['from', t]);         return builder; },
      select(c)       { filters.push(['select', c]);        return builder; },
      eq(col, val)    { filters.push(['eq', col, val]);     return builder; },
      gt(col, val)    { filters.push(['gt', col, val]);     return builder; },
      gte(col, val)   { filters.push(['gte', col, val]);    return builder; },
      like(col, val)  { filters.push(['like', col, val]);   return builder; },
      or(s)           { filters.push(['or', s]);            return builder; },
      // Final await resolution — supabase builder is thenable.
      then(resolve, reject) {
        try { resolve(handler(filters)); }
        catch (err) { reject(err); }
      },
    };
    return builder;
  }
  return { from: (t) => makeBuilder().from(t) };
}

// Helpers for the handler to inspect the filters array.
function findEq(filters, col) {
  const f = filters.find(f => f[0] === 'eq' && f[1] === col);
  return f ? f[2] : undefined;
}
function findLike(filters, col) {
  const f = filters.find(f => f[0] === 'like' && f[1] === col);
  return f ? f[2] : undefined;
}
function isUnitScope(filters) { return findEq(filters, 'postcode') !== undefined; }
function isDistrictScope(filters) { return findLike(filters, 'postcode') !== undefined; }
function isBedsExact(filters) { return findEq(filters, 'beds') !== undefined; }

// Make N rows of {rent_pcm: …} for the stub.
const rows = (rents) => ({ data: rents.map(r => ({ rent_pcm: r })), error: null });
const empty = () => ({ data: [], error: null });

console.log('\nestimateMonthlyRentSmart: Tier 1 wins when typed comps ≥3');
{
  // 3 listings at the unit + beds level. Should never reach Tier 2.
  let queriesSeen = 0;
  initEnrichment({ supabase: makeSupabaseStub(filters => {
    queriesSeen++;
    if (isUnitScope(filters) && isBedsExact(filters)) return rows([1400, 1450, 1500]);
    return rows([9999, 9999, 9999]); // would-be wrong if we leaked here
  }) });

  const r = await estimateMonthlyRentSmart({
    address: '12 Whitehouse Rd, Bristol',
    beds: 2,
    units: 1,
    postcode: 'BS1 4AB',
    propType: 'flat',
  });
  assert(r.source === 'comps_unit_typed', `source=comps_unit_typed (got ${r.source})`);
  assert(r.sample === 3, `sample=3 (got ${r.sample})`);
  assert(r.rent === 1450, `median 1400/1450/1500 → 1450 (got ${r.rent})`);
  assert(queriesSeen === 1, 'only 1 query — stops at Tier 1');
}

console.log('\nestimateMonthlyRentSmart: falls Tier 1 → 2 → 3 → 4 → static');
{
  // Tier 1 (unit + beds): 0 → fall
  // Tier 2 (unit any beds): 0 → fall
  // Tier 3 (district + beds): 0 → fall
  // Tier 4 (district any beds): 4 listings → win
  let queriesSeen = 0;
  initEnrichment({ supabase: makeSupabaseStub(filters => {
    queriesSeen++;
    if (isDistrictScope(filters) && !isBedsExact(filters)) return rows([1100, 1200, 1300, 1400]);
    return empty();
  }) });

  const r = await estimateMonthlyRentSmart({
    address: '5 Acacia Ave',
    beds: 3,
    units: 1,
    postcode: 'BS1 4AB',
    propType: 'house',
  });
  assert(r.source === 'comps_district', `source=comps_district (got ${r.source})`);
  assert(r.sample === 4, `sample=4 (got ${r.sample})`);
  assert(r.rent === 1250, `median of 1100/1200/1300/1400 = 1250 (got ${r.rent})`);
  assert(queriesSeen === 4, 'walked all 4 tiers (got ' + queriesSeen + ')');
}

console.log('\nestimateMonthlyRentSmart: thin baseline → static');
{
  // Every tier returns 1-2 listings, below MIN_COMP_SAMPLE=3.
  initEnrichment({ supabase: makeSupabaseStub(_ => rows([1200, 1400])) });

  const r = await estimateMonthlyRentSmart({
    address: '99 Rural Lane',
    beds: 2,
    units: 1,
    postcode: 'TR1 2AB',  // valid district 'TR1'
    propType: 'house',
  });
  assert(r.source === 'static', `source=static (got ${r.source})`);
  assert(r.sample === 0, 'sample=0 for static');
  assert(r.rent > 0, 'static rent is non-zero (VOA fallback)');
}

console.log('\nestimateMonthlyRentSmart: commercial / land / garage skip comps');
{
  let queriesSeen = 0;
  initEnrichment({ supabase: makeSupabaseStub(_ => { queriesSeen++; return rows([1200, 1300, 1400]); }) });

  for (const pt of ['commercial', 'land', 'garage', 'other', undefined, null]) {
    queriesSeen = 0;
    const r = await estimateMonthlyRentSmart({
      address: '1 Industrial Rd', beds: 2, units: 1, postcode: 'BS1 4AB', propType: pt,
    });
    assert(r.source === 'static', `propType=${pt} → static`);
    assert(queriesSeen === 0, `propType=${pt} → no DB queries fired`);
  }
}

console.log('\nestimateMonthlyRentSmart: no postcode → static (no queries)');
{
  let queriesSeen = 0;
  initEnrichment({ supabase: makeSupabaseStub(_ => { queriesSeen++; return rows([1500, 1600, 1700]); }) });

  const r = await estimateMonthlyRentSmart({
    address: '1 Mystery Rd', beds: 2, units: 1, postcode: null, propType: 'flat',
  });
  assert(r.source === 'static', 'no postcode → static');
  assert(queriesSeen === 0, 'no DB queries when postcode missing');
}

console.log('\nestimateMonthlyRentSmart: unit×N when units≥2 (block of flats)');
{
  initEnrichment({ supabase: makeSupabaseStub(filters => {
    if (isUnitScope(filters) && isBedsExact(filters)) return rows([1000, 1000, 1000]);
    return empty();
  }) });

  const r = await estimateMonthlyRentSmart({
    address: '1-4 Maple St', beds: 1, units: 4, postcode: 'BS1 4AB', propType: 'flat',
  });
  assert(r.rent === 4000, `median 1000 × units 4 = 4000 (got ${r.rent})`);
  assert(r.source === 'comps_unit_typed', 'source still comps_unit_typed (multi-unit flag is downstream)');
}

console.log('\nestimateMonthlyRentSmart: type filter applied + nulls included');
{
  let savedTypeFilter = null;
  initEnrichment({ supabase: makeSupabaseStub(filters => {
    const orFilter = filters.find(f => f[0] === 'or');
    if (orFilter) savedTypeFilter = orFilter[1];
    return empty();
  }) });

  await estimateMonthlyRentSmart({
    address: 'X', beds: 2, units: 1, postcode: 'BS1 4AB', propType: 'flat',
  });
  assert(savedTypeFilter && savedTypeFilter.includes('flat,studio'),
    "type filter contains 'flat,studio' for a flat lot");
  assert(savedTypeFilter && savedTypeFilter.includes('property_type.is.null'),
    "type filter still allows NULLs (so OnTheMarket data isn't dropped)");
}

console.log('\nestimateMonthlyRentSmart: 6-month recency cutoff applied');
{
  let savedCutoff = null;
  initEnrichment({ supabase: makeSupabaseStub(filters => {
    const f = filters.find(x => x[0] === 'gte' && x[1] === 'scraped_at');
    if (f) savedCutoff = f[2];
    return empty();
  }) });

  await estimateMonthlyRentSmart({
    address: 'X', beds: 2, units: 1, postcode: 'BS1 4AB', propType: 'flat',
  });
  assert(savedCutoff !== null, 'recency cutoff applied to query');
  if (savedCutoff) {
    const cutoffMs = Date.parse(savedCutoff);
    const expectedMs = Date.now() - 6 * 30 * 24 * 60 * 60 * 1000;
    // Allow ±2 days of drift (month boundaries don't divide evenly into ms).
    const drift = Math.abs(cutoffMs - expectedMs);
    assert(drift < 3 * 24 * 60 * 60 * 1000, `cutoff is ~6 months ago (drift ${Math.round(drift / 86400000)}d)`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
