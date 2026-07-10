// tests/test-bamboo-recogniser.js — shared Bamboo Auctions platform recogniser.
//
// ~11 houses run on {house}.bambooauctions.com (hunters, lsk, stags, carterjonas,
// fisherGerman, webbers, allwalesauction, hawkesford, howkinsandharrison, rendells,
// 247propertyauctions). It's Next.js SSR, so a plain HTTP fetch returns every card —
// yet none had a recogniser, so all depended on the AI extractor (quota-dead most of
// the month) and several went dark. Verified 100% recall on all 11 live sites
// 2026-07-10 (173 lots, 75 available).
//
// Two regressions this locks, both found against live pages:
//  1. ADDRESS — the `###` heading is often only a short TITLE ("The Downs"); the full
//     postal address is the line AFTER it. Taking the heading blindly made
//     normaliseScrapedLot reject 18 of hunters' 20 lots as non-addresses.
//  2. DOT SLUGS — lot slugs may contain a dot ("…-bodwen-st.-austell-…"). An
//     id-shaped anchor class stops at the dot so the closing `)` never matches and
//     the card is silently dropped (webbers lost 3 of 19).
//
// ANTI-LEAK: most Bamboo cards are SOLD-prior (howkinsandharrison 18/20). The AI
// extractor smears them as `available`; the SOLD badge is parsed deterministically.

import { recogniseBambooLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const CDN = 'https://cdn.bambooauctions.com/property/img';
const LOGO = 'https://s3-eu-west-1.amazonaws.com/bamboo-cdn/property/img/9319bb44.png';

// Card 1: LIVE, heading IS the full address, countdown.
// Card 2: LIVE, heading is a short TITLE, full address on the next line.
// Card 3: SOLD.
// Card 4: LIVE with a DOT in the slug.
// Card 5: Ended (auction over) -> unsold.
const MD = `
[
![Land off Station Road, Lilbourne, Rugby, CV23 0SX](https://h.bambooauctions.com/_next/image?url=${encodeURIComponent(CDN + '/a1.jpg')}&w=3840&q=75)
Traditional
Ends in
12d
3h
### Land off Station Road, Lilbourne, Rugby, CV23 0SX
Land off Station Road, Rugby, CV23 0SX
![howkinsandharrison logo](https://h.bambooauctions.com/_next/image?url=${encodeURIComponent(LOGO)}&w=1080&q=75)
£100,000
Land
](https://howkinsandharrison.bambooauctions.com/property/lilbourne-rugby-cv23-0sx-6836739)
[
![The Downs](https://r.bambooauctions.com/_next/image?url=${encodeURIComponent(CDN + '/b2.jpg')}&w=3840&q=75)
Accepting Offers
### The Downs
The Downs, Newton Abbot, TQ12 6AF
![rendells logo](https://r.bambooauctions.com/_next/image?url=${encodeURIComponent(LOGO)}&w=1080&q=75)
£175,000
Land
](https://rendells.bambooauctions.com/property/the-downs-8569625)
[
![Land off Sandy Lane, Fillongley, CV7 8DD](https://h.bambooauctions.com/_next/image?url=${encodeURIComponent(CDN + '/c3.webp')}&w=3840&q=75)
Traditional
SOLD
### Land off Sandy Lane, Fillongley, CV7 8DD
Land off Sandy Lane, Fillongley, CV7 8DD
![howkinsandharrison logo](https://h.bambooauctions.com/_next/image?url=${encodeURIComponent(LOGO)}&w=1080&q=75)
£48,500
Land
](https://howkinsandharrison.bambooauctions.com/property/land-off-sandy-lane-fillongley-warwickshire-cv7-8dd-7598750)
[
![Moorland View](https://w.bambooauctions.com/_next/image?url=${encodeURIComponent(CDN + '/d4.jpg')}&w=3840&q=75)
Traditional
Ends in
5d
### Moorland View
Moorland View, Bodwen, St Austell, Cornwall, PL26 8RG
![webbers logo](https://w.bambooauctions.com/_next/image?url=${encodeURIComponent(LOGO)}&w=1080&q=75)
£193,500
3
1
Detached
](https://webbers.bambooauctions.com/property/moorland-view-bodwen-st.-austell-cornwall-pl26-8rg-4455667)
[
![Old Hall](https://l.bambooauctions.com/_next/image?url=${encodeURIComponent(CDN + '/e5.jpg')}&w=3840&q=75)
Traditional
Ended
### Old Hall
Old Hall, Bury St Edmunds, Suffolk, IP33 1AA
![lsk logo](https://l.bambooauctions.com/_next/image?url=${encodeURIComponent(LOGO)}&w=1080&q=75)
£250,000
Detached
](https://lacyscottandknight.bambooauctions.com/property/old-hall-bury-1234567)
`;

console.log('Bamboo platform recogniser — 100% recall, real addresses, sold never available');
const lots = recogniseBambooLotsFromMarkdown(MD);

// ── Recall: every card recovered, including the DOT-slug one ──
assert(lots.size === 5, `all 5 cards recovered (got ${lots.size})`);
assert(lots.has('moorland-view-bodwen-st'), 'DOT-slug card recovered (webbers regression)');

// ── Address: full postal address wins over a short title heading ──
assert(lots.get('the-downs-8569625').address === 'The Downs, Newton Abbot, TQ12 6AF',
  `short title heading -> full address subline used (got "${lots.get('the-downs-8569625').address}")`);
assert(lots.get('lilbourne-rugby-cv23-0sx-6836739').address.includes('CV23 0SX'),
  'heading with a postcode is used directly');
assert(lots.get('moorland-view-bodwen-st').address.includes('PL26 8RG'), 'dot-slug lot gets its full address');

// ── Anti-leak: status parsed per card ──
assert(lots.get('lilbourne-rugby-cv23-0sx-6836739').lot_status === 'available', 'countdown card = available');
assert(lots.get('the-downs-8569625').lot_status === 'available', '"Accepting Offers" = available');
assert(lots.get('land-off-sandy-lane-fillongley-warwickshire-cv7-8dd-7598750').lot_status === 'sold', 'SOLD card never available');
assert(lots.get('old-hall-bury-1234567').lot_status === 'unsold', '"Ended" card never available');
assert([...lots.values()].filter(l => l.lot_status === 'available').length === 3, 'exactly 3 available lots');

// ── Image: the house LOGO is never chosen as the lot photo ──
for (const [id, l] of lots) {
  assert(!!l.image_url && !/bamboo-cdn/.test(decodeURIComponent(l.image_url)), `lot ${id.slice(0, 18)} uses its own photo, not the logo`);
}
assert(new Set([...lots.values()].map(l => l.image_url)).size === 5, 'every lot has a DISTINCT photo (no hero bleed)');

// ── Fields ──
assert(lots.get('lilbourne-rugby-cv23-0sx-6836739').guide_price === '£100,000', 'guide price parsed');
assert(lots.get('moorland-view-bodwen-st').bedrooms === null || typeof lots.get('moorland-view-bodwen-st').bedrooms === 'number', 'bedrooms is number|null');
assert(lots.get('the-downs-8569625').property_type === 'land', 'property type parsed');
assert(/\/property\//.test(lots.get('the-downs-8569625').detail_url), 'detail url kept');

// ── Empty / garbage input never throws ──
assert(recogniseBambooLotsFromMarkdown('').size === 0, 'empty markdown → empty map');
assert(recogniseBambooLotsFromMarkdown(null).size === 0, 'null markdown → empty map');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
