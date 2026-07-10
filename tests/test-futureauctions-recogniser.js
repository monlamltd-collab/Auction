// tests/test-futureauctions-recogniser.js — Future Property Auctions recogniser.
//
// Classic ASP, fully server-rendered. A rolling timed-online catalogue of 749
// entries paginated by `?offset=N` in steps of 21. The house had NO recogniser and
// depended on the AI extractor (quota-dead most of the month), so it went dark
// despite a healthy, complete, static catalogue. Verified 749/749 = 100% recall
// against the live site 2026-07-10 (all available, 100% images, 748 auction dates).
//
// The card puts price / lot number / photo BEFORE the type-heading anchor and the
// address / auction date AFTER it, so the parser must look both ways. The address is
// only ever the TEXT of a maps.google.com link.
//
// Photos are served over plain HTTP; the frontend is HTTPS-only and
// isValidImageUrl() strips `http://`, so they must be upgraded (the documented
// `mixed_content_http_images` class this house hit in April).

import { recogniseFutureAuctionsLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const D = 'https://www.futurepropertyauctions.co.uk';
const MD = `
[
Lot 2
£230,000 *OPENING BID*
![](http://www.futurepropertyauctions.co.uk/upload/43917_14500677_IMG_00.jpg)
](${D}/property_details.asp?id=14509279)
#### [2 Bedroom  Flat](${D}/property_details.asp?id=14509279)     [](${D}/property_details.asp?id=14509279)
[12 Leslie Place, Flat 2, Stockbridge, Edinburgh](https://maps.google.com/maps?key=AI&q=55.9,-3.2&zoom=17)
-   **Timed Online Auction** - 16 Jul 2026
[View Details](${D}/property_details.asp?id=14509279)

[
Lot 3
£95,000 *OPENING BID*
![](http://www.futurepropertyauctions.co.uk/upload/43918_14500678_IMG_00.jpg)
](${D}/property_details.asp?id=14509280)
#### [Land & Plot](${D}/property_details.asp?id=14509280)
[Plot 4, Mains Road, Beith, Ayrshire](https://maps.google.com/maps?key=AI&q=55.7,-4.6&zoom=17)
-   **Timed Online Auction** - 30 Jul 2026
[View Details](${D}/property_details.asp?id=14509280)

[
Lot 4
£150,000 *OPENING BID*
![](http://www.futurepropertyauctions.co.uk/upload/43919_14500679_IMG_00.jpg)
](${D}/property_details.asp?id=14509281)
#### [3 Bedroom  Detached House](${D}/property_details.asp?id=14509281)
[7 Hill Street, Glasgow](https://maps.google.com/maps?key=AI&q=55.8,-4.2&zoom=17)
-   **Timed Online Auction** - 6 Aug 2026
Withdrawn
[View Details](${D}/property_details.asp?id=14509281)
`;

console.log('Future Property Auctions recogniser — 100% recall, https images, both-ways parse');
const lots = recogniseFutureAuctionsLotsFromMarkdown(MD);

// ── Recall ──
assert(lots.size === 3, `all 3 cards recovered (got ${lots.size})`);
assert(lots.has('14509279') && lots.has('14509280') && lots.has('14509281'), 'keyed by ?id=');

// ── Fields that live BEFORE the anchor (price / lot / photo) bind to the right lot ──
const a = lots.get('14509279'), b = lots.get('14509280'), c = lots.get('14509281');
assert(a.lot_number === '2' && b.lot_number === '3' && c.lot_number === '4', 'lot numbers bind to their own card');
assert(a.guide_price === '£230,000' && b.guide_price === '£95,000', 'prices bind to their own card (no bleed)');
assert(/43917_/.test(a.image_url) && /43918_/.test(b.image_url) && /43919_/.test(c.image_url), 'each lot gets its OWN photo (no bleed)');

// ── mixed_content_http_images: photos must be upgraded to https ──
for (const [id, l] of lots) assert(/^https:\/\//.test(l.image_url), `lot ${id} photo upgraded to https`);

// ── Fields that live AFTER the anchor (address / date) ──
assert(a.address === '12 Leslie Place, Flat 2, Stockbridge, Edinburgh', `address from the maps link (got "${a.address}")`);
assert(b.address === 'Plot 4, Mains Road, Beith, Ayrshire', 'second address correct');
assert(a.auction_date === '2026-07-16', `auction date parsed (got ${a.auction_date})`);
assert(b.auction_date === '2026-07-30', 'second auction date parsed');

// ── Status + classification ──
assert(a.lot_status === 'available' && b.lot_status === 'available', 'live lots are available');
assert(c.lot_status === 'withdrawn', 'Withdrawn lot never available');
assert(a.property_type === 'flat', 'flat classified');
assert(b.property_type === 'land', 'land classified');
assert(a.bedrooms === 2, `beds from the type heading (got ${a.bedrooms})`);

// ── Empty / garbage input never throws ──
assert(recogniseFutureAuctionsLotsFromMarkdown('').size === 0, 'empty markdown → empty map');
assert(recogniseFutureAuctionsLotsFromMarkdown(null).size === 0, 'null markdown → empty map');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
