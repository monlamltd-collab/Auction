// tests/test-williamhbrownnorwich-recogniser.js — William H Brown (Norwich) recogniser.
//
// The house went dark (58 lots, 0 live) because it had NO recogniser and leaned on
// the AI extractor. Its last good AI run (2026-07-11, 19 lots) then aged past
// get_active_lots' 7-day freshness window while later runs emitted a single junk
// lot (page LOGO as the image, the catalogue URL as the detail URL). The site is a
// hand-built static XHTML table, so a deterministic parse removes the AI dependency
// entirely. Verified 19/19 = 100% recall against the live page 2026-07-21.
//
// Three contracts are asserted here, each one a real trap this layout sets:
//   1. Recall + survival — lots are counted AFTER normaliseScrapedLot, not at the
//      regex (a recogniser that matches 19 and normalises 2 has fixed nothing).
//   2. Live boundary — the sale date lives in the lot URL slug; a catalogue left
//      up after its sale must never ship as live.
//   3. Photo binding — photo cells and text cells are SEPARATE table rows with
//      spacer cells between them, so images bind by shared detail URL. Positional
//      binding would smear one lot's photo across its neighbours, and the page
//      logo (an image link to the homepage) must never become a lot photo.

import { recogniseSequenceBranchLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';
import { normaliseScrapedLot } from '../lib/types/lot.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const TODAY = '2026-07-21';
const CATALOGUE = 'https://www.williamhbrownauctions-norwich.co.uk/Current_Auction.html';

// Mirrors the real turndown markdown: page chrome + logo image-link, the stray
// PAST-auction anchor in the intro line, a photo row, spacer cells, then the text
// row whose cards carry `\\` hard-breaks. String.raw so `\\` stays two LITERAL
// backslashes before a real newline (a plain template literal would swallow them).
const MD = String.raw`
[![William H Brown Auctions - Norwich](https://www.williamhbrownauctions-norwich.co.uk/images/general/WilliamHBrown-Norwich.jpg)](http://www.williamhbrownauctions-norwich.co.uk)

[Results](https://www.williamhbrownauctions-norwich.co.uk/Auction-Results.html)\\
[Home](https://www.williamhbrownauctions-norwich.co.uk)

# Current Auction

**Tuesday 28th July 2026** - Barnard Marcus Auctions - [View the entire sale](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/)[\\
](https://www.barnardmarcusauctions.co.uk/auctions/11-march-2025/)William H Brown Norwich lots included in this auction below. Click for further information.

[![](https://www.williamhbrownauctions-norwich.co.uk/images/auctions/2026/july26/234.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707599/)

![spacer](https://www.williamhbrownauctions-norwich.co.uk/images/general/Spacer.gif)

[![](https://www.williamhbrownauctions-norwich.co.uk/images/auctions/2026/july26/235.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707594/)

![spacer](https://www.williamhbrownauctions-norwich.co.uk/images/general/Spacer.gif)

[![](https://www.williamhbrownauctions-norwich.co.uk/images/auctions/2026/july26/236.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707585/)

[![](https://www.williamhbrownauctions-norwich.co.uk/images/auctions/2026/july26/237.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707595/)

[![](https://www.williamhbrownauctions-norwich.co.uk/images/auctions/2026/july26/241.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707586/)

[![](https://www.williamhbrownauctions-norwich.co.uk/images/auctions/2025/mar25/099.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/11-march-2025/699001/)

**[Lot 234](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707599/)**\\
20, Purdy Way, NORWICH,\\
Norfolk,\\
NR11 6DH\\
Guide: £120,000

**[Lot 235](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707594/)**\\
St. Davids House, Friday Market Place, WALSINGHAM,\\
Norfolk,\\
NR22 6DB\\
SOLD PRIOR\\
Guide: £325,000\\

**[Lot 236](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707585/)**\\
2 Church Farm , Banningham Road, NORWICH,\\
Norfolk,\\
NR11 6LS\\
Withdrawn\\
Guide: £150,000\\

**[Lot 237](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707595/)**\\
93, Fronks Road, HARWICH,\\
Essex,\\
CO12 4EQ\\
Guide: £400,000\\

**[Lot 241](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707586/)**\\
Plot adj, 25, Fengate, NORWICH,\\
Norfolk,\\
NR10 5PT\\
Guide: £70,000\\

**[Lot 99](https://www.barnardmarcusauctions.co.uk/auctions/11-march-2025/699001/)**\\
7, Old Sale Road, NORWICH,\\
Norfolk,\\
NR1 1AA\\
Guide: £95,000

![-](https://www.williamhbrownauctions-norwich.co.uk/images/general/Blue-Line.jpg)

William H Brown Property Auctions 5 Bank Plain, Norwich, Norfolk NR2 4SF\\
Tel: 01603 598975/7/8 | Email: [auctions.norwich@sequencehome.co.uk](mailto:auctions.norwich@sequencehome.co.uk)
`;

console.log('William H Brown (Norwich) recogniser — recall, live boundary, photo binding');
const lots = recogniseSequenceBranchLotsFromMarkdown(MD, TODAY);

// ── 1. Recall: every CURRENT card recovered, keyed by lot id; past sale dropped ──
// The stray 11-march-2025 card must NOT survive. Keeping it with its real past
// date and relying on a downstream gate was tried and reverted 2026-07-22: the
// sitemap's live cohort is an OR (`auction_date >= today` OR `last_seen_at` within
// 7d), so a re-seen past-dated `available` row is submitted to Google as live, and
// no sweep can retire it — ghost-sweep only flips lots UNSEEN for 7+ days, and a
// card still on the page is re-seen every scrape.
assert(lots.size === 5, `5 current cards recovered (got ${lots.size})`);
assert(['707599', '707594', '707585', '707595', '707586'].every(id => lots.has(id)), 'keyed by Sequence lot id');
assert(!lots.has('699001'), 'lot from the PAST 11-march-2025 sale is dropped (live boundary)');

// ── 2. Fields are real, not placeholders ──
const l234 = lots.get('707599');
assert(l234.address === '20, Purdy Way, NORWICH, Norfolk, NR11 6DH', `address joins the \\\\-broken lines (got "${l234.address}")`);
assert(l234.lot_number === '234', 'lot number parsed');
assert(l234.guide_price === '£120,000', `guide price parsed (got "${l234.guide_price}")`);
assert(l234.detail_url === 'https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707599/', 'detail URL is the Barnard Marcus lot page, not the catalogue');
assert(l234.auction_date === '2026-07-28', 'auction date parsed from the lot URL slug');
assert(lots.get('707586').property_type === 'land', '"Plot adj" classified as land');

// ── 3. Photo binding by shared detail URL — never positional, never chrome ──
assert(l234.image_url === 'https://www.williamhbrownauctions-norwich.co.uk/images/auctions/2026/july26/234.jpg', 'lot 234 gets its OWN photo');
assert(lots.get('707586').image_url.endsWith('/241.jpg'), 'lot 241 photo survives the interleaved spacer cells (bound by URL)');
const photos = [...lots.values()].map(l => l.image_url).filter(Boolean);
assert(photos.length === lots.size && new Set(photos).size === lots.size, 'every lot has its OWN distinct photo (no hero bleed, none missing)');
assert(![...lots.values()].some(l => /\/images\/general\//i.test(l.image_url)), 'page logo / spacer / rule chrome never used as a lot photo');

// ── 4. Anti-leak: sold / withdrawn never ship as available ──
assert(lots.get('707594').lot_status === 'sold', 'SOLD PRIOR lot is status=sold (never available)');
assert(lots.get('707585').lot_status === 'withdrawn', 'WITHDRAWN lot is status=withdrawn (never available)');
assert(lots.get('707594').address === 'St. Davids House, Friday Market Place, WALSINGHAM, Norfolk, NR22 6DB', 'status marker line stays OUT of the address');
assert([...lots.values()].filter(l => l.lot_status === 'available' && l.auction_date >= TODAY).length === 3,
  'exactly 3 available lots on the CURRENT sale');

// ── 5. Survival through normaliseScrapedLot — the count that actually ships ──
const normalised = [...lots.values()]
  .map(l => normaliseScrapedLot(l, { house: 'williamhbrownnorwich', catalogueUrl: CATALOGUE, extractionSource: 'static-recognition' }))
  .filter(Boolean);
assert(normalised.length === 5, `all 5 survive normaliseScrapedLot (got ${normalised.length})`);
assert(normalised.every(l => l.price > 0), 'every normalised lot carries a numeric price');
assert(normalised.every(l => l._auctionDate >= TODAY), 'no normalised lot carries a past auction date');
assert(!normalised.some(l => !l._auctionDate || l._auctionDate === '2099-12-31'),
  'no lot carries an empty or 2099 sentinel date (that is what kept dead lots live)');
assert(normalised.filter(l => l.status === 'available' && l._auctionDate >= TODAY).length === 3,
  'only 3 lots would ship as live+available through get_active_lots');
assert(!normalised.some(l => /5 Bank Plain/i.test(l.address)), 'the office address in the page footer is never emitted as a lot');
assert(!normalised.some(l => /Current_Auction\.html/i.test(l.url)), 'no lot falls back to the catalogue URL as its detail URL');

// ── 6. Defensive: junk input never throws ──
assert(recogniseSequenceBranchLotsFromMarkdown('').size === 0, 'empty markdown → empty map');
assert(recogniseSequenceBranchLotsFromMarkdown(null).size === 0, 'null markdown → empty map');
assert(recogniseSequenceBranchLotsFromMarkdown('# no lots here').size === 0, 'lot-less markdown → empty map');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
