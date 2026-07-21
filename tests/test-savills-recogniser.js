// tests/test-savills-recogniser.js — Savills static-catalogue recogniser + resolver.
//
// Savills (500 lots historically) sat at 0 live because it had NO recogniser and
// leaned on the AI extractor, which dies whenever the AI quota is exhausted — and
// its recall sentinel was ALSO broken (`(?=$|[/?#])` never matched a lot URL
// inside markdown's `](…)` or HTML's `href="…"`), so the blackout was never
// flagged. Verified 306/306 = 100% recall against the four live upcoming
// catalogues, 2026-07-21 (297 available / 5 sold / 4 withdrawn).
//
// Three contracts are load-bearing here:
//   1. ANTI-LEAK — SOLD PRIOR / WITHDRAWN PRIOR lots sit inline with available
//      ones and must never persist as `available`; bullet prose that merely says
//      "sold off on long lease" must never flip an available lot.
//   2. NO DIVIDER BLEED — the catalogue interleaves section-divider pseudo-lots
//      ("Lot 0", empty address, "Guide Price TBA"). Their fields must not land on
//      the next real lot.
//   3. SENTINEL — must count lot ids in both markdown and raw HTML.

import {
  recogniseSavillsLotsFromMarkdown,
  resolveSavillsCatalogueUrl,
} from '../lib/pipeline/firecrawl-extract.js';
import { parseSavillsAuctionSlug } from '../lib/utils.js';
import { RECALL_SENTINELS, sentinelIdsFromText } from '../lib/scraper/recall-sentinels.js';
import { normaliseScrapedLot } from '../lib/types/lot.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// Mirrors the real turndown markdown: a gallery of image links, the bid block,
// an optional status badge, the address anchor, bullets, then the "Full details"
// terminator. Card 1 is preceded by a SECTION DIVIDER (empty address anchor);
// card 3 is SOLD PRIOR; card 4 is WITHDRAWN PRIOR; card 5 carries only prose
// that mentions "sold" and must stay available.
const MD = String.raw`
-   -   [![ 1](https://resize.auctions.savills.co.uk/resized/images/w650/lots/227/24101/divider.png)](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/-24101)

    1/1

    Lot 0

    Guide Price TBA

    Your Bid £0

    [](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/-24101)

    -   Commercial Section
    -   Lots 200-299

    £

    Cancel proxy bid [Full details](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/-24101)

-   -   [![10 Brooklyn Avenue, Loughton, Essex IG10 1BL 2](https://resize.auctions.savills.co.uk/resized/images/w650/lots/226/23486/aaa1.jpeg)](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/10-brooklyn-avenue-loughton-essex-ig10-1bl-23983)
    -   [![10 Brooklyn Avenue, Loughton, Essex IG10 1BL 2](https://resize.auctions.savills.co.uk/resized/images/w650/lots/226/23486/aaa2.jpeg)](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/10-brooklyn-avenue-loughton-essex-ig10-1bl-23983)

    1/23

    Lot 1

    Guide Price £400,000

    Your Bid £0

    [10 Brooklyn Avenue, Loughton, Essex IG10 1BL](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/10-brooklyn-avenue-loughton-essex-ig10-1bl-23983)

    -   **To be offered on Tuesday 28 July**
    -   Detached bungalow
    -   Two bedrooms
    -   In need of modernisation

    £

    Cancel proxy bid [Full details](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/10-brooklyn-avenue-loughton-essex-ig10-1bl-23983)

-   -   [![Flat A, 68 Rattray Road, Brixton, London SW2 1BE 3](https://resize.auctions.savills.co.uk/resized/images/w650/lots/227/23767/bbb1.jpeg)](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/flat-a-68-rattray-road-brixton-london-sw2-1be-23767)

    1/9

    Lot 2

    Guide Price £335,000

    Your Bid £0

    [Flat A, 68 Rattray Road, Brixton, London SW2 1BE](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/flat-a-68-rattray-road-brixton-london-sw2-1be-23767)

    -   **To be offered on Wednesday 29 July**
    -   Leasehold flat

    £

    Cancel proxy bid [Full details](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/flat-a-68-rattray-road-brixton-london-sw2-1be-23767)

-   -   [![107 Parklands, Malmesbury, Wiltshire, SN16 0QL 142](https://resize.auctions.savills.co.uk/resized/images/w650/lots/226/23481/ccc1.jpeg)](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/107-parklands-malmesbury-wiltshire-sn16-0ql-24097)

    1/14

    Lot 141

    Guide Price £105,000

    Your Bid £0

    Sold Prior

    [107 Parklands, Malmesbury, Wiltshire, SN16 0QL](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/107-parklands-malmesbury-wiltshire-sn16-0ql-24097)

    -   Two bedroom semi-detached bungalow
    -   Vacant

    £

    Cancel proxy bid [Full details](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/107-parklands-malmesbury-wiltshire-sn16-0ql-24097)

-   -   [![70B Longridge Road, Earls Court, London SW5 9SQ 84](https://resize.auctions.savills.co.uk/resized/images/w650/lots/226/23475/ddd1.jpeg)](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/70b-longridge-road-earls-court-london-sw5-9sq-23475)

    1/6

    Lot 83

    Guide Price £285,000

    Your Bid £0

    Withdrawn Prior

    [70B Longridge Road, Earls Court, London SW5 9SQ](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/70b-longridge-road-earls-court-london-sw5-9sq-23475)

    -   Leasehold flat

    £

    Cancel proxy bid [Full details](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/70b-longridge-road-earls-court-london-sw5-9sq-23475)

-   -   [![32 Waterloo Road, Blackpool FY4 1AB 287](https://resize.auctions.savills.co.uk/resized/images/w650/lots/227/24158/eee1.jpeg)](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/32-waterloo-road-blackpool-fy4-1ab-24158)

    1/4

    Lot 286

    Guide Price £95,000

    Your Bid £0

    [32 Waterloo Road, Blackpool FY4 1AB](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/32-waterloo-road-blackpool-fy4-1ab-24158)

    -   Upper parts sold off on long lease
    -   To be offered on 14 July unless withdrawn
    -   Freehold commercial premises

    £

    Cancel proxy bid [Full details](http://auctions.savills.co.uk/auctions/28--29-july-2026-227/32-waterloo-road-blackpool-fy4-1ab-24158)
`;

console.log('Savills recogniser — 100% recall, no divider bleed, sold/withdrawn never available');
const lots = recogniseSavillsLotsFromMarkdown(MD);

// ── Recall: every REAL card, keyed by lot id; the divider is not a lot ──
assert(lots.size === 5, `5 real lots recovered, divider excluded (got ${lots.size})`);
assert(['23983', '23767', '24097', '23475', '24158'].every(id => lots.has(id)), 'keyed by lot id');
assert(!lots.has('24101'), 'section divider (empty address anchor) never becomes a lot');

// ── Anti-leak: status per card ──
assert(lots.get('23983').lot_status === 'available', 'lot 1 available');
assert(lots.get('23767').lot_status === 'available', 'lot 2 available');
assert(lots.get('24097').lot_status === 'sold', 'SOLD PRIOR lot is status=sold (never available)');
assert(lots.get('23475').lot_status === 'withdrawn', 'WITHDRAWN PRIOR lot is status=withdrawn (never available)');
assert(lots.get('24158').lot_status === 'available',
  'bullet prose "sold off on long lease" does NOT flip an available lot to sold');
assert([...lots.values()].filter(l => l.lot_status === 'available').length === 3, 'exactly 3 available lots');

// ── No divider bleed: the pseudo-lot's "Lot 0 / Guide Price TBA" must not stick ──
const l1 = lots.get('23983');
assert(l1.lot_number === '1', `lot number is the card's own, not the divider's "Lot 0" (got ${l1.lot_number})`);
assert(l1.guide_price === '£400,000', `guide price is the card's own, not the divider's TBA (got ${l1.guide_price})`);

// ── Fields ──
assert(l1.address === '10 Brooklyn Avenue, Loughton, Essex IG10 1BL', `address parsed (got ${l1.address})`);
assert(l1.detail_url === 'https://auctions.savills.co.uk/auctions/28--29-july-2026-227/10-brooklyn-avenue-loughton-essex-ig10-1bl-23983',
  `detail url upgraded http→https (got ${l1.detail_url})`);
assert(/aaa1\.jpeg$/.test(l1.image_url), `first gallery image bound to the lot (got ${l1.image_url.slice(-20)})`);
assert(/bbb1\.jpeg$/.test(lots.get('23767').image_url), 'lot 2 gets its OWN photo (no bleed from lot 1)');
assert(l1.bedrooms === 2 && l1.property_type === 'bungalow', `beds/type inferred (got ${l1.bedrooms}/${l1.property_type})`);
assert(l1.bullets.length === 4 && l1.bullets[1] === 'Detached bungalow', `bullets captured (got ${l1.bullets.length})`);

// ── Two-day sale: the per-lot "To be offered on …" bullet picks the right day ──
assert(l1.auction_date === '2026-07-28', `day-1 lot dated from its bullet (got ${l1.auction_date})`);
assert(lots.get('23767').auction_date === '2026-07-29', `day-2 lot dated from its bullet (got ${lots.get('23767').auction_date})`);
assert(lots.get('24097').auction_date === '2026-07-29', `lot with no offer-date bullet falls back to the sale's LAST day (got ${lots.get('24097').auction_date})`);
assert(lots.get('24158').auction_date === '2026-07-29',
  `an off-sale date in prose ("14 July") is rejected, not used as the auction date (got ${lots.get('24158').auction_date})`);

// ── Everything survives normaliseScrapedLot (the real persistence funnel) ──
const norm = [...lots.values()]
  .map(l => normaliseScrapedLot(l, { house: 'savills', catalogueUrl: 'https://auctions.savills.co.uk/auctions/28--29-july-2026-227', extractionSource: 'static-recognition' }))
  .filter(Boolean);
assert(norm.length === 5, `all 5 lots survive normaliseScrapedLot (got ${norm.length})`);
assert(norm.filter(l => l.status === 'available').length === 3, 'exactly 3 lots would ship as available');
assert(norm.every(l => l.imageUrl.startsWith('https://')), 'every image url is https (no mixed-content blocking)');
assert(norm.every(l => l.price > 0), 'every lot carries a parsed guide price');

// ── Recall sentinel: must count ids in BOTH markdown and raw HTML ──
const S = RECALL_SENTINELS.savills;
const mdIds = sentinelIdsFromText(MD, S);
assert(mdIds.size === 5, `sentinel counts 5 lot ids in markdown "](…)" form (got ${mdIds.size})`);
const HTML = '<a class="lot-name" href="http://auctions.savills.co.uk/auctions/28--29-july-2026-227/10-brooklyn-avenue-loughton-essex-ig10-1bl-23983" title="x">x</a>';
assert(sentinelIdsFromText(HTML, S).has('23983'), 'sentinel counts a lot id in HTML href="…" form');
assert(!sentinelIdsFromText('<a href="http://auctions.savills.co.uk/auctions/28--29-july-2026-227/-24101">x</a>', S).size,
  'sentinel does not count the section divider (no address slug)');
assert(!sentinelIdsFromText('[x](https://auctions.savills.co.uk/auctions/28-july-2026-227/page-1/quantity-100/property_type-253)', S).size,
  'sentinel does not count catalogue filter/pagination links');

// ── Auction slug parsing ──
console.log('\nSavills auction-slug date parsing');
const range = parseSavillsAuctionSlug('28--29-july-2026-227');
assert(range.startIso === '2026-07-28' && range.endIso === '2026-07-29', `two-day range (got ${range && range.startIso}..${range && range.endIso})`);
assert(range.auctionId === '227', 'rotating auction id captured');
const single = parseSavillsAuctionSlug('31-march-2026-220');
assert(single.startIso === '2026-03-31' && single.endIso === '2026-03-31', 'single-day sale');
const cross = parseSavillsAuctionSlug('30-june--1-july-2026-231');
assert(cross.startIso === '2026-06-30' && cross.endIso === '2026-07-01', `cross-month range (got ${cross && cross.startIso}..${cross && cross.endIso})`);
assert(parseSavillsAuctionSlug('upcoming-auctions') === null, 'non-dated slug → null');
assert(parseSavillsAuctionSlug('') === null && parseSavillsAuctionSlug(null) === null, 'empty/null → null');

// ── Calendar resolver: every upcoming sale, ordered, sized from its own count ──
console.log('\nSavills calendar resolver');
const CALENDAR = `
<div class="upcoming-calendar__row">
  <p class="upcoming-calendar-content__auction_properties">288 properties for sale</p>
  <a href="https://auctions.savills.co.uk/auctions/28--29-july-2026-227">View catalogue</a>
</div>
<div class="upcoming-calendar__row">
  <a href="https://auctions.savills.co.uk/auctions/18-august-2026-240">View catalogue</a>
</div>
<div class="upcoming-calendar__row">
  <p class="upcoming-calendar-content__auction_properties">12 properties for sale</p>
  <a href="https://auctions.savills.co.uk/auctions/6-may-2026-222">View catalogue</a>
</div>`;
const fakeFetch = async () => CALENDAR;
const targets = await resolveSavillsCatalogueUrl('https://auctions.savills.co.uk/upcoming-auctions', fakeFetch, '2026-07-21');
assert(Array.isArray(targets), 'resolver returns a target LIST (multiple live sales)');
assert(!targets.some(t => t.url.includes('6-may-2026-222')), 'a finished sale still on the calendar is dropped');
assert(targets.filter(t => t.url.includes('28--29-july-2026-227')).length === 4,
  `288 lots → ceil(288/100)+1 = 4 page targets (got ${targets.filter(t => t.url.includes('28--29-july')).length})`);
assert(targets[0].url === 'https://auctions.savills.co.uk/auctions/28--29-july-2026-227/page-1/quantity-100', `page-1 first (got ${targets[0].url})`);
assert(targets[0].auctionDateIso === '2026-07-29', `sale end date stamped (got ${targets[0].auctionDateIso})`);
const aug = targets.filter(t => t.url.includes('18-august-2026-240'));
assert(aug.length === 1 && aug[0].url.endsWith('/page-1/quantity-500'), `sale with no published count → one wide page (got ${aug.map(t => t.url)})`);
assert(targets.findIndex(t => t.url.includes('18-august')) > targets.findIndex(t => t.url.includes('july')),
  'sales ordered soonest-first');
assert(await resolveSavillsCatalogueUrl('x', async () => '<html>no auctions</html>', '2026-07-21') === null,
  'no upcoming sale → null (genuine zero, not a crash)');
assert(await resolveSavillsCatalogueUrl('x', async () => { throw new Error('net'); }, '2026-07-21') === null,
  'calendar fetch failure → null, never throws');

// ── Empty / garbage input never throws ──
assert(recogniseSavillsLotsFromMarkdown('').size === 0, 'empty markdown → empty map');
assert(recogniseSavillsLotsFromMarkdown(null).size === 0, 'null markdown → empty map');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
