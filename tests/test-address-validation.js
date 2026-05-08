// tests/test-address-validation.js — looksLikeRealAddress against the
// placeholder phrases observed in the production lots table on 2026-05-05
// (1,231 stranded rows across 425 dupe-groups, all caused by extraction
// failures where the LLM returned property-type descriptors / banner text
// as the address).

import { looksLikeRealAddress } from '../lib/pipeline/firecrawl-extract.js';

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name} — expected ${expected}, got ${actual}`);
    failed++;
  }
}

console.log('looksLikeRealAddress: real UK addresses (should accept)');
check('full address with postcode', looksLikeRealAddress('123 Acacia Road, London, NW1 2AB'), true);
check('flat with postcode', looksLikeRealAddress('Flat 4, 22 High Street, Bristol, BS1 5TR'), true);
check('rural with postcode', looksLikeRealAddress('Land at The Gavel, South Molton, Devon, EX36 4BP'), true);
check('compact postcode', looksLikeRealAddress('1 Smith Lane, Hull, HU1 3AA'), true);
check('postcode with no space', looksLikeRealAddress('27 Park Road, Manchester, M14 5DL'), true);
check('long address with embedded postcode', looksLikeRealAddress('Apt. 62 East Float Quay, Dock Road, Birkenhead, CH41 1DN'), true);

console.log('\nlooksLikeRealAddress: real addresses without postcodes (tentatively accept)');
check('rural no postcode', looksLikeRealAddress('Land at North Field, off Brewers Lane'), true);
check('long descriptive no postcode', looksLikeRealAddress('Commercial Investment, Dalintober Street, Glasgow'), true);

console.log('\nlooksLikeRealAddress: placeholder property-type descriptors (should reject)');
check('"A three bedroom semi-detached house"', looksLikeRealAddress('A three bedroom semi-detached house'), false);
check('"A two bedroom first floor flat"', looksLikeRealAddress('A two bedroom first floor flat'), false);
check('"A one bedroom flat"', looksLikeRealAddress('A one bedroom flat'), false);
check('"A two bedroom mid-terrace house"', looksLikeRealAddress('A two bedroom mid-terrace house'), false);
check('"Three bedroom semi-detached house"', looksLikeRealAddress('Three bedroom semi-detached house'), false);
check('"Three bedroom mid-terrace house"', looksLikeRealAddress('Three bedroom mid-terrace house'), false);
check('"3 Bedroom House - Semi-Detached"', looksLikeRealAddress('3 Bedroom House - Semi-Detached'), false);
check('"2 bed flat"', looksLikeRealAddress('2 bed flat'), false);

console.log('\nlooksLikeRealAddress: banners / button labels / status text (should reject)');
check('"Virtual Viewing"', looksLikeRealAddress('Virtual Viewing'), false);
check('"Sold prior to auction, for an undisclosed amount"', looksLikeRealAddress('Sold prior to auction, for an undisclosed amount'), false);
check('"National online auction bidding now open!"', looksLikeRealAddress('National online auction bidding now open! Click to view lots'), false);
check('"Click to view full details"', looksLikeRealAddress('Click to view full details'), false);
check('"Lot 47"', looksLikeRealAddress('Lot 47'), false);
check('"Property 12"', looksLikeRealAddress('Property 12'), false);
check('"View property"', looksLikeRealAddress('View property'), false);
check('"Bidding Now Open"', looksLikeRealAddress('Bidding Now Open'), false);

console.log('\nlooksLikeRealAddress: widget / modal titles (should reject)');
check('"Add to calendar"', looksLikeRealAddress('Add to calendar'), false);
check('"Add to favourites"', looksLikeRealAddress('Add to favourites'), false);
check('"Add to shortlist"', looksLikeRealAddress('Add to shortlist'), false);
check('"Save property"', looksLikeRealAddress('Save property'), false);
check('"Share this property"', looksLikeRealAddress('Share this property'), false);
check('"Register to bid"', looksLikeRealAddress('Register to bid'), false);
check('"Looking to bid in our next Auction"', looksLikeRealAddress('Looking to bid in our next Auction'), false);
check('"Next auction date"', looksLikeRealAddress('Next auction date'), false);

console.log('\nlooksLikeRealAddress: malformed / missing input (should reject)');
check('null', looksLikeRealAddress(null), false);
check('undefined', looksLikeRealAddress(undefined), false);
check('empty string', looksLikeRealAddress(''), false);
check('whitespace only', looksLikeRealAddress('   '), false);
check('too short', looksLikeRealAddress('A street'), false);
check('non-string', looksLikeRealAddress(42), false);

console.log('\nlooksLikeRealAddress: borderline (real address that LOOKS like a descriptor)');
check('"3 Bedroom House - Semi-Detached, Acre Rigg Road, Peterlee"',
  looksLikeRealAddress('3 Bedroom House - Semi-Detached, Acre Rigg Road, Peterlee'), false);
// ↑ The "3 Bedroom House" prefix matches the placeholder pattern. Acceptable
// loss — the second clause has the real address; will be re-extracted on the
// next cycle once Phase 1's prompt tightening lands.

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
