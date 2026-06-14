// tests/test-propertysolvers-recogniser.js — recognisePropertysolversLotsFromMarkdown.
//
// Property Solvers renders ~121 lots on one /auction-property-for-sale/ page;
// Gemini token-limited to ~48% (58/121, recall_diagnostic 2026-06-14). The lot
// links are all in the markdown, so this recogniser recovers every lot. Fixtures
// match the REAL turndown output verified live 2026-06-14 (htmlToRecognitionMarkdown
// of auctions.propertysolvers.co.uk/auction-property-for-sale/).

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recognisePropertysolversLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const CARD1 = `[![Ingham Street, Padiham, Burnley, BB12 8DR](https://auctions.propertysolvers.co.uk/wp-content/uploads/2026/06/Ingham-Street-Front-768x512.jpg)](https://auctions.propertysolvers.co.uk/auction-property-for-sale/ingham-street-padiham-burnley-bb12-8dr/)

### [Ingham Street, Padiham, Burnley, BB12 8DR](https://auctions.propertysolvers.co.uk/auction-property-for-sale/ingham-street-padiham-burnley-bb12-8dr/)

£60,000 Guide Price

This property is to be offered for sale by PROPERTY SOLVERS ONLINE UNCONDITIONAL AUCTION (28-DAY IMMEDIATE EXCHANGE).

[More Details](https://auctions.propertysolvers.co.uk/auction-property-for-sale/ingham-street-padiham-burnley-bb12-8dr/) [Call now 0800 044 3798](tel:0800 044 3798)`;

const CARD2 = `[![Barley House, 211 Ecclesall Road, Sheffield, S11 8HR](https://auctions.propertysolvers.co.uk/wp-content/uploads/2026/06/Barley-House-Front-768x512.jpeg)](https://auctions.propertysolvers.co.uk/auction-property-for-sale/barley-house-211-ecclesall-road-sheffield-s11-8hr/)

### [Barley House, 211 Ecclesall Road, Sheffield, S11 8HR](https://auctions.propertysolvers.co.uk/auction-property-for-sale/barley-house-211-ecclesall-road-sheffield-s11-8hr/)

£250,000 Guide Price

A substantial freehold building.

[More Details](https://auctions.propertysolvers.co.uk/auction-property-for-sale/barley-house-211-ecclesall-road-sheffield-s11-8hr/)`;

console.log('Test 1: parses both lots, keyed by slug');
const map = recognisePropertysolversLotsFromMarkdown(CARD1 + '\n\n' + CARD2);
assert(map instanceof Map && map.size === 2, `Map of 2 (got ${map.size})`);

console.log('\nTest 2: lot 1 fields');
const a = map.get('ingham-street-padiham-burnley-bb12-8dr');
assert(!!a, 'keyed by slug');
assert(a.address === 'Ingham Street, Padiham, Burnley, BB12 8DR', `address (got "${a.address}")`);
assert(a.guide_price === '£60,000', `guide_price (got "${a.guide_price}")`);
assert(a.image_url === 'https://auctions.propertysolvers.co.uk/wp-content/uploads/2026/06/Ingham-Street-Front-768x512.jpg', `image (got "${a.image_url}")`);
assert(a.detail_url.includes('/auction-property-for-sale/ingham-street'), 'detail_url captured');
assert(a.lot_status === 'available', `available (got "${a.lot_status}")`);

console.log('\nTest 3: lot 2 price');
const b = map.get('barley-house-211-ecclesall-road-sheffield-s11-8hr');
assert(b && b.guide_price === '£250,000', `guide_price (got "${b?.guide_price}")`);
assert(b && b.address.includes('Ecclesall Road'), 'address');

console.log('\nTest 4: dedup by slug');
assert(recognisePropertysolversLotsFromMarkdown(CARD1 + '\n\n' + CARD1).size === 1, 'same lot twice → 1');

console.log('\nTest 5: junk / empty safe');
assert(recognisePropertysolversLotsFromMarkdown('').size === 0, 'empty → 0');
assert(recognisePropertysolversLotsFromMarkdown('### [No lots](https://example.com/x)').size === 0, 'non-PS heading → 0');
assert(recognisePropertysolversLotsFromMarkdown(null).size === 0, 'null → 0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
