// tests/test-johnpye-recogniser.js — John Pye Avada/Fusion post-card recogniser.
//
// johnpye.co.uk/properties/ was rebuilt onto an Avada/Fusion post-card grid. The
// old recogniser split the markdown on `\n- {CAPS}` and read the block's FIRST
// LINE as the title; the new cards open with an EMPTY anchor and carry the title
// on the NEXT line, so the split produced 2 blocks for the whole page and
// recovered 2 fabricated "lots" (the page <title> and the words "Auction
// Location") — both emitted as status='available'. Real recall: 0.
//
// The rebuild parses card blocks as RUNS of same-slug lot links. Verified 17/17
// against the live page 2026-07-21 (9 available / 8 sold, 0 leaks).
//
// The status parse is the anti-leak contract: this listing mixes live stock with
// SSTC / Under Offer stock, and on some cards the "under offer" marker exists
// ONLY on the button label (`/auctions/10040-2/` has a clean title). Status is
// therefore read from the WHOLE card, never the title alone.

import { recogniseJohnPyeLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';
import { normaliseScrapedLot } from '../lib/types/lot.js';
import { HOUSE_RECOGNISERS } from '../lib/scraper/house-recognisers.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// ── A near-future date inside the CURRENT year ──────────────────────────────
// The live card prints "Auction Ends | Thursday 30th Jul | 11:00am" with NO
// year, and parseAuctionDateFromBullet resolves a year-less date to the
// current-year occurrence only when it is still upcoming (returning null once
// past — the Maggs 2027 roll-forward guard). Deriving the fixture's day/month
// from today keeps the assertion true every day of the year, and clamping to
// 31 Dec keeps it inside the current year in late December.
const TODAY = new Date();
const yr = TODAY.getUTCFullYear();
const nineDays = new Date(Date.UTC(yr, TODAY.getUTCMonth(), TODAY.getUTCDate() + 9));
const target = nineDays.getUTCFullYear() === yr ? nineDays : new Date(Date.UTC(yr, 11, 31));
const EXPECTED_DATE = target.toISOString().slice(0, 10);
const DAY = target.getUTCDate();
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][target.getUTCMonth()];
const ORD = (DAY % 10 === 1 && DAY !== 11) ? 'st' : (DAY % 10 === 2 && DAY !== 12) ? 'nd' : (DAY % 10 === 3 && DAY !== 13) ? 'rd' : 'th';

// Real turndown markdown from the live grid, trimmed to six representative
// cards + the nav chrome that must NOT be mistaken for lots. Card order/shape
// is verbatim: empty anchor → title → anchor → image → anchor → description →
// [View Property] → contact boilerplate → button label.
//
// The grid is rendered twice on the real page (desktop + small-screen); the
// last card is repeated here so the dedupe is exercised.
const MD = `
-   [Property Auctions](https://www.johnpye.co.uk/properties/properties)
-   [General Auctions](https://www.johnpye.co.uk/properties/general-auctions)
-   [Vehicle Auctions](https://www.johnpye.co.uk/properties/vehicle-auctions)

-   [](https://www.johnpye.co.uk/auctions/serviced-offices-to-rent-mercury-house-north-gate-nottingham-ng7-7fn/)

    Serviced Offices To Rent – Mercury House, North Gate, Nottingham NG7 7FN

    [![](https://www.johnpye.co.uk/wp-content/uploads/2025/06/John-Pye-Previews-jpso-BANNER.jpg.webp)](https://www.johnpye.co.uk/auctions/serviced-offices-to-rent-mercury-house-north-gate-nottingham-ng7-7fn/)

    Serviced Offices To Rent - Mercury House, North Gate, Nottingham NG7 7FN

    [View Property](https://www.johnpye.co.uk/auctions/serviced-offices-to-rent-mercury-house-north-gate-nottingham-ng7-7fn/)

    To view or submit an offer please contact John Pye Property by email at property@johnpye.co.uk or on 0115 970 6060

    To Let

-   [](https://www.johnpye.co.uk/auctions/for-sale-by-online-auction-108-the-dale-ashley-loggerheads-tf9-4np-detached-3-bedroom-house/)

    For Sale By Online Auction – 108 The Dale, Ashley, Loggerheads, TF9 4NP – Detached Three-bedroom House – Guide Price £375,000+

    [![](https://www.johnpye.co.uk/wp-content/uploads/2026/05/John-Pye-Previews-Template-Banner.jpg.webp)](https://www.johnpye.co.uk/auctions/for-sale-by-online-auction-108-the-dale-ashley-loggerheads-tf9-4np-detached-3-bedroom-house/)

    For Sale By Online Auction - 108 The Dale, Ashley, Loggerheads, TF9 4NP - Detached Three-bedroom House - Guide Price £375,000+

    [Preview Auction](https://www.johnpye.co.uk/auctions/for-sale-by-online-auction-108-the-dale-ashley-loggerheads-tf9-4np-detached-3-bedroom-house/)

    Viewing – Please contact property@johnpye.co.uk or call 0115 970 6060

    Auction Ends | Thursday ${DAY}${ORD} ${MON} | 11:00am

-   [](https://www.johnpye.co.uk/auctions/for-sale-by-private-treaty-three-bedroom-semi-detached-house-35-grove-close-thulston-derbyshire-de72-3ey/)

    For Sale By Private Treaty – Three Bedroom Semi-Detached House – 35 Grove Close, Thulston, Derbyshire DE72 3EY

    [![](https://www.johnpye.co.uk/wp-content/uploads/2025/07/John-Pye-Previews-Template-Banner-8.jpg.webp)](https://www.johnpye.co.uk/auctions/for-sale-by-private-treaty-three-bedroom-semi-detached-house-35-grove-close-thulston-derbyshire-de72-3ey/)

    For Sale By Private Treaty - Three Bedroom Semi-Detached House - 35 Grove Close, Thulston, Derbyshire DE72 3EY - Charming Village Green Location - Close To Open Countryside - Suit Owner Occupier or Investor

    [View Property](https://www.johnpye.co.uk/auctions/for-sale-by-private-treaty-three-bedroom-semi-detached-house-35-grove-close-thulston-derbyshire-de72-3ey/)

    To view or submit an offer please contact John Pye Property by email at property@johnpye.co.uk or on 0115 970 6060

    For Sale By Private Treaty

-   [](https://www.johnpye.co.uk/auctions/10040-2/)

    40 Murrayfield Drive, Wirral, CH46 3RS

    [![](https://www.johnpye.co.uk/wp-content/uploads/2024/12/prop-7.png.webp)](https://www.johnpye.co.uk/auctions/10040-2/)

    House - Semi-Detached - 40 Murrayfield Drive, Wirral, CH46 3RS - Asking Price: £125,000

    [View Property](https://www.johnpye.co.uk/auctions/10040-2/)

    To view or submit an offer please contact John Pye Property by email at property@johnpye.co.uk or on 0115 970 6060

    For Sale by Private Treaty - UNDER OFFER

-   [](https://www.johnpye.co.uk/auctions/8-cheshire-way-wirral-ch61-5xy/)

    SSTC – 8 Cheshire Way, Wirral, CH61 5XY

    [![](https://www.johnpye.co.uk/wp-content/uploads/2024/12/John-Pye-Previews-Template-Banner_-3.png.webp)](https://www.johnpye.co.uk/auctions/8-cheshire-way-wirral-ch61-5xy/)

    SSTC - 8 Cheshire Way, Wirral, CH61 5XY - House - Semi-Detached - SSTC

    [View Property](https://www.johnpye.co.uk/auctions/8-cheshire-way-wirral-ch61-5xy/)

    To view or submit an offer please contact John Pye Property by email at property@johnpye.co.uk or on 0115 970 6060

    For Sale By Private Treaty

-   [](https://www.johnpye.co.uk/auctions/for-sale-by-private-treaty-alvaston-and-crewton-mens-social-club-12-trent-street-alvaston-derby-de24-8ry/)

    For Sale by Private Treaty – Alvaston and Crewton Men's Social Club, 12 Trent Street, Alvaston Derby, DE24 8RY – Offers In Excess of £625,000

    [![](https://www.johnpye.co.uk/wp-content/uploads/2025/04/John-Pye-Previews-Template-Banner-1.jpg.webp)](https://www.johnpye.co.uk/auctions/for-sale-by-private-treaty-alvaston-and-crewton-mens-social-club-12-trent-street-alvaston-derby-de24-8ry/)

    For Sale by Private Treaty - Alvaston and Crewton Men's Social Club, 12 Trent Street, Alvaston Derby, DE24 8RY

    [View Property](https://www.johnpye.co.uk/auctions/for-sale-by-private-treaty-alvaston-and-crewton-mens-social-club-12-trent-street-alvaston-derby-de24-8ry/)

    To view or submit an offer please contact John Pye Property by email at property@johnpye.co.uk or on 0115 970 6060

    For Sale By Private Treaty

-   [](https://www.johnpye.co.uk/auctions/8-cheshire-way-wirral-ch61-5xy/)

    SSTC – 8 Cheshire Way, Wirral, CH61 5XY

    [![](https://www.johnpye.co.uk/wp-content/uploads/2024/12/John-Pye-Previews-Template-Banner_-3.png.webp)](https://www.johnpye.co.uk/auctions/8-cheshire-way-wirral-ch61-5xy/)

    [View Property](https://www.johnpye.co.uk/auctions/8-cheshire-way-wirral-ch61-5xy/)

    For Sale By Private Treaty
`;

console.log('John Pye recogniser — Avada card grid, 100% recall, no ended leak');
const lots = recogniseJohnPyeLotsFromMarkdown(MD);

// ── Recall: every SALE card recovered, keyed by lot slug ──
assert(lots.size === 5, `all 5 sale cards recovered (got ${lots.size})`);
assert(
  lots.has('for-sale-by-online-auction-108-the-dale-ashley-loggerheads-tf9-4np-detached-3-bedroom-house')
  && lots.has('for-sale-by-private-treaty-three-bedroom-semi-detached-house-35-grove-close-thulston-derbyshire-de72-3ey')
  && lots.has('10040-2')
  && lots.has('8-cheshire-way-wirral-ch61-5xy')
  && lots.has('for-sale-by-private-treaty-alvaston-and-crewton-mens-social-club-12-trent-street-alvaston-derby-de24-8ry'),
  'keyed by lot slug (incl. the short numeric slug 10040-2 the old sentinel missed)');

// ── Non-lot links never become lots ──
assert(!lots.has('properties') && !lots.has('general-auctions') && !lots.has('vehicle-auctions'),
  '/properties/{category} nav tiles are not lots');
assert(!lots.has('serviced-offices-to-rent-mercury-house-north-gate-nottingham-ng7-7fn'),
  '"To Let" lettings card is dropped (not a sale lot)');

// ── Anti-leak: status parsed from the WHOLE card ──
assert(lots.get('10040-2').lot_status === 'sold',
  'UNDER OFFER on the button label only → sold (clean title must not win)');
assert(lots.get('8-cheshire-way-wirral-ch61-5xy').lot_status === 'sold', 'SSTC in title → sold');
assert(lots.get('for-sale-by-online-auction-108-the-dale-ashley-loggerheads-tf9-4np-detached-3-bedroom-house').lot_status === 'available', 'timed online-auction lot is available');
assert(lots.get('for-sale-by-private-treaty-three-bedroom-semi-detached-house-35-grove-close-thulston-derbyshire-de72-3ey').lot_status === 'available', 'private-treaty lot is available');
assert([...lots.values()].filter(l => l.lot_status === 'available').length === 3, 'exactly 3 available lots');

// ── Address: the title segment carrying the postcode ──
const dale = lots.get('for-sale-by-online-auction-108-the-dale-ashley-loggerheads-tf9-4np-detached-3-bedroom-house');
assert(dale.address === '108 The Dale, Ashley, Loggerheads, TF9 4NP',
  `status prefix + descriptor + price segments stripped (got "${dale.address}")`);
assert(lots.get('8-cheshire-way-wirral-ch61-5xy').address === '8 Cheshire Way, Wirral, CH61 5XY', 'SSTC prefix stripped from address');
assert(lots.get('10040-2').address === '40 Murrayfield Drive, Wirral, CH46 3RS', 'undecorated title parses as-is');
assert(/^Alvaston and Crewton Men.s Social Club, 12 Trent Street, Alvaston Derby, DE24 8RY$/
  .test(lots.get('for-sale-by-private-treaty-alvaston-and-crewton-mens-social-club-12-trent-street-alvaston-derby-de24-8ry').address),
  'trailing "Offers In Excess of £…" segment excluded from address');

// ── Price ──
assert(dale.guide_price === 'Guide Price £375,000+', `guide price incl. the "+" (got "${dale.guide_price}")`);
assert(lots.get('10040-2').guide_price === 'Asking Price £125,000', `"Asking Price:" colon form parsed (got "${lots.get('10040-2').guide_price}")`);
assert(lots.get('for-sale-by-private-treaty-alvaston-and-crewton-mens-social-club-12-trent-street-alvaston-derby-de24-8ry').guide_price === 'Offers In Excess of £625,000',
  'Offers In Excess of parsed, source casing preserved');
assert(lots.get('for-sale-by-private-treaty-three-bedroom-semi-detached-house-35-grove-close-thulston-derbyshire-de72-3ey').guide_price === '',
  'card the source publishes with no price → empty (never a neighbour\'s price)');

// ── Auction date from the "Auction Ends | …" button ──
assert(dale.auction_date === EXPECTED_DATE, `timed lot carries the auction end date (got "${dale.auction_date}", want ${EXPECTED_DATE})`);
assert(lots.get('10040-2').auction_date === '', 'private-treaty lot has no auction date (calendar supplies it)');

// ── Images bind to their own card, no bleed ──
assert(/prop-7\.png/.test(lots.get('10040-2').image_url), 'lot gets its OWN image');
assert(new Set([...lots.values()].map(l => l.image_url)).size === 5, 'every card has a distinct image (no hero bleed)');

// ── Detail URLs ──
assert(lots.get('10040-2').detail_url === 'https://www.johnpye.co.uk/auctions/10040-2/', 'detail url rebuilt on the /auctions/ prefix');

// ── Fields ──
assert(dale.bedrooms === 3 && dale.property_type === 'house', 'beds + prop type inferred from the descriptor');
assert(lots.get('for-sale-by-private-treaty-alvaston-and-crewton-mens-social-club-12-trent-street-alvaston-derby-de24-8ry').property_type === 'commercial', 'social club → commercial');

// ── Survives the canonical contract ──
const normalised = [...lots.values()]
  .map(l => normaliseScrapedLot(l, { house: 'johnpye', catalogueUrl: 'https://www.johnpye.co.uk/properties/', extractionSource: 'static-recognition' }))
  .filter(Boolean);
assert(normalised.length === 5, `all 5 survive normaliseScrapedLot (got ${normalised.length})`);
assert(normalised.filter(l => l.status === 'available').length === 3, 'still 3 available after normalisation — no sold lot leaks as available');
assert(normalised.find(l => l.address.startsWith('108 The Dale'))._auctionDate === EXPECTED_DATE, 'auction date survives normalisation');
assert(normalised.find(l => l.address.startsWith('40 Murrayfield')).price === 125000, 'price parsed to an integer');

// ── Recall sentinel parity: the registered sentinel sees exactly the lots the
//    recogniser returns (it used to count nav tiles and miss numeric slugs) ──
const sent = HOUSE_RECOGNISERS.johnpye.recallSentinelPattern;
const sentinelIds = new Set([...MD.matchAll(new RegExp(sent.source, sent.flags))].map(m => m[1].toLowerCase()));
assert(sentinelIds.size === lots.size, `sentinel parity: ${sentinelIds.size} sentinel ids vs ${lots.size} recognised`);
assert(HOUSE_RECOGNISERS.johnpye.staticCatalogue === true, 'registered as staticCatalogue (no AI extractor, no browser render)');

// ── Empty / garbage input never throws ──
assert(recogniseJohnPyeLotsFromMarkdown('').size === 0, 'empty markdown → empty map');
assert(recogniseJohnPyeLotsFromMarkdown(null).size === 0, 'null markdown → empty map');
assert(recogniseJohnPyeLotsFromMarkdown('no john pye links here at all').size === 0, 'unrelated markdown → empty map');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
