// tests/test-epc-band-extract.js — extractEpcBand (lib/scraper/lot-detail.js).
//
// Many auction houses publish the EPC band on the listing/detail page ("EPC
// rating: D") even when they withhold the house number — so the address→OS/EPC
// API match can't run, but the band is right there. extractEpcBand pulls it
// directly (sidestepping the OS quota), and is conservative: it refuses to
// guess on multi-band commercial listings. Verified against real Pattinson
// pages 2026-06-13: "EPC rating: D" (residential) and "EPC Ratings - C & D"
// (multi-unit retail).

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { extractEpcBand } = await import('../lib/scraper/lot-detail.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('Test 1: clean residential "EPC rating: D" (real Pattinson lot)');
assert(extractEpcBand('Gladstone Street, Blackpool FY4 2AL EPC rating: D Heating supply: Gas Electricity: National Grid') === 'D',
  'pulls D from "EPC rating: D"');

console.log('\nTest 2: multi-band commercial "EPC Ratings - C & D" → null (never guess)');
assert(extractEpcBand('29 Retail in CT14 Beach Street, Deal EPC Ratings - C & D Additional Information please contact') === null,
  'ambiguous multi-band → null');

console.log('\nTest 3: "Energy Performance Certificate rating C"');
assert(extractEpcBand('Tenure Freehold Energy Performance Certificate rating C, council tax band B') === 'C',
  'pulls C from energy-performance-certificate phrasing');

console.log('\nTest 4: bare "EPC: B"');
assert(extractEpcBand('Guide price £120,000. EPC: B. Vacant possession.') === 'B', 'pulls B from "EPC: B"');

console.log('\nTest 5: no EPC label → null (no false positives from stray letters)');
assert(extractEpcBand('Gas central heating, grade A location, an energy efficient boiler') === null,
  'no EPC/energy-rating label → null');
assert(extractEpcBand('A two bedroom terraced house in good order, freehold') === null,
  'prose with stray capitals → null');

console.log('\nTest 6: two different bands across the page → null (ambiguous)');
assert(extractEpcBand('Unit 1 EPC rating: D. Unit 2 EPC rating: F. Two flats sold together.') === null,
  'two distinct labelled bands → null');

console.log('\nTest 7: same band twice → still resolves (not ambiguous)');
assert(extractEpcBand('EPC rating: E in the brochure. Confirmed EPC rating: E.') === 'E',
  'repeated identical band → E');

console.log('\nTest 8: junk / empty input is safe');
assert(extractEpcBand('') === null, 'empty → null');
assert(extractEpcBand(null) === null, 'null → null');
assert(extractEpcBand(12345) === null, 'non-string → null');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
