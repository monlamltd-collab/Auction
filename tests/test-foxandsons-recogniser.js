// tests/test-foxandsons-recogniser.js — Fox & Sons (Sequence/Connells branch).
//
// Fox & Sons serves the SAME hand-built static XHTML template as Bagshaws
// Residential and William H Brown (Norwich), so all three share
// recogniseSequenceBranchLotsFromMarkdown. This file pins the traps that are
// specific to the Fox & Sons page, all of which the AI extractor fell into while
// the house had no recogniser (`ai_only_freshness_rot` — it shipped 4 fabricated
// rows and let a past June sale sit in `available`):
//
//   1. NAV LINKS — the page's own nav (`Catalogue_request.html`,
//      `Legal_Documents.html`, `Auction-Results.html`) must never become a lot.
//      The AI invented lots at all three URLs.
//   2. FOOTER OFFICE ADDRESS — "32/34 London Road, Southampton" is the branch
//      office in the page footer. The AI emitted it as a property.
//   3. PAGE CHROME AS PHOTO — `images/general/Blue-Line.jpg` and `Spacer.gif` sit
//      between the lot thumbnails. The AI used Blue-Line.jpg as a lot image.
//   4. TRAILING `+` GUIDES — Fox writes "Guide: £165,000 +" (Bagshaws does not).
//   5. UNLINKED WITHDRAWN LOT — "**Lot 143** Withdrawn Prior." has no anchor at
//      all, so it is not a lot URL and must not be invented into one.
//
// Verified 21/21 = 100% of the recall sentinel against the live page 2026-07-22,
// counted as SURVIVORS of normaliseScrapedLot.

import { recogniseSequenceBranchLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';
import { normaliseScrapedLot } from '../lib/types/lot.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const CATALOGUE = 'https://www.foxandsonsauctions.co.uk/';

// Real turndown markdown from the live page: logo, nav, thumbnails interleaved
// with spacer GIFs, the text cards, the unlinked withdrawn lot, then the footer.
// String.raw so `\\` stays two LITERAL backslashes before a newline.
const MD = String.raw`
[![Fox & Sons Auctioneers](https://www.foxandsonsauctions.co.uk/images/general/Fox-sons-Logo.jpg)](https://www.foxandsonsauctions.co.uk/index.html)

![-](https://www.foxandsonsauctions.co.uk/images/general/Blue-Line.jpg)

[Catalogue Request](https://www.foxandsonsauctions.co.uk/Catalogue_request.html)\\
[Legal Documents](https://www.foxandsonsauctions.co.uk/Legal_Documents.html)\\
[Results](https://www.foxandsonsauctions.co.uk/Auction-Results.html)

**Tuesday 28th July 2026** - Barnard Marcus Auctions - [View the entire sale](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/) Fox & Sons Lots included in this auction below. Click for further information.

[![](https://www.foxandsonsauctions.co.uk/images/auctions/2026/july26/138.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707922/)

![spacer](https://www.foxandsonsauctions.co.uk/images/general/Spacer.gif)

[![](https://www.foxandsonsauctions.co.uk/images/auctions/2026/july26/147.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707931/)

![spacer](https://www.foxandsonsauctions.co.uk/images/general/Spacer.gif)

[![](https://www.foxandsonsauctions.co.uk/images/auctions/2026/july26/150.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707844/)

**[Lot 138](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707922/)**\\
10 Virginia Park Road, GOSPORT,\\
Hampshire,\\
PO12 3DZ\\
Guide: £165,000 +

**[Lot 147](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707931/)**\\
Land on north east side of, 68 Bracken Road, North Baddesley, SOUTHAMPTON, Hampshire,\\
SO52 9DN\\
Guide: £25,000 +\\

**[Lot 150](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707844/)**\\
Flat 12, Heathlands Court, Beaulieu Road, Dibden Purlieu, SOUTHAMPTON,\\
SO45 4BB\\
Guide: £30,000 +\\

**Lot 143** Withdrawn Prior.

![-](https://www.foxandsonsauctions.co.uk/images/general/Blue-Line.jpg)

\\

Fox & Sons Property Auctions 32/34 London Road, Southampton, Hampshire SO15 2AG\\
Tel: 02380 338066 | | Email: [auctions.southampton@sequencehome.co.uk](mailto:auctions.southampton@sequencehome.co.uk)
`;

console.log('Fox & Sons recogniser — shared Sequence template, anti-fabrication');
const lots = recogniseSequenceBranchLotsFromMarkdown(MD);

// ── Recall: exactly the linked lot cards, keyed by Sequence lot id ──
assert(lots.size === 3, `all 3 linked cards recovered (got ${lots.size})`);
assert(['707922', '707931', '707844'].every(id => lots.has(id)), 'keyed by Sequence lot id (matches the recall sentinel capture)');

// ── 1 + 2 + 5. Anti-fabrication: the exact rows the AI invented ──
const addrs = [...lots.values()].map(l => l.address).join(' | ');
const urls = [...lots.values()].map(l => l.detail_url).join(' | ');
assert(!/32\/34 London Road/i.test(addrs), 'the footer OFFICE address is never emitted as a lot');
assert(!/Catalogue_request|Legal_Documents|Auction-Results/i.test(urls), 'nav links never become lot detail URLs');
assert(!urls.split(' | ').some(u => /foxandsonsauctions\.co\.uk\/?$/.test(u)), 'no lot falls back to the catalogue root as its detail URL');
assert(![...lots.values()].some(l => /^143$/.test(l.lot_number)), 'the UNLINKED "Lot 143 Withdrawn Prior" is not invented into a lot');
assert([...lots.values()].every(l => /^https:\/\/www\.barnardmarcusauctions\.co\.uk\/auctions\/28-july-2026\/\d{6}\/$/.test(l.detail_url)),
  'every lot points at a real Barnard Marcus lot page');

// ── 3. Page chrome is never a lot photo ──
assert(![...lots.values()].some(l => /\/images\/general\//i.test(l.image_url)), 'Blue-Line / Spacer / logo chrome never used as a lot photo');
assert(new Set([...lots.values()].map(l => l.image_url)).size === 3, 'every lot has a DISTINCT photo (no hero bleed)');
assert(lots.get('707931').image_url.endsWith('/147.jpg'), 'photo binds by shared lot URL across the interleaved spacer cells');

// ── 4. Fox writes guides with a trailing "+" ──
assert(lots.get('707922').guide_price === '£165,000', `trailing "+" stripped from the guide (got ${lots.get('707922').guide_price})`);
assert(lots.get('707844').guide_price === '£30,000', 'guide parsed on the last card too');

// ── Address + type ──
assert(lots.get('707922').address === '10 Virginia Park Road, GOSPORT, Hampshire, PO12 3DZ',
  `address joined across hard-breaks (got ${lots.get('707922').address})`);
assert(lots.get('707931').property_type === 'land', '"Land on north east side of" classified as land');
assert(lots.get('707844').property_type === 'flat', '"Flat 12, Heathlands Court" classified as flat');

// ── Auction date from the URL slug — the fix for the 2099 sentinel ──
assert([...lots.values()].every(l => l.auction_date === '2026-07-28'), 'every lot carries the real sale date parsed from the URL slug');

// ── The count that actually ships: survivors of normaliseScrapedLot ──
const norm = [...lots.values()]
  .map(l => normaliseScrapedLot(l, { house: 'foxandsons', catalogueUrl: CATALOGUE, extractionSource: 'static-recognition' }))
  .filter(Boolean);
assert(norm.length === 3, `all 3 survive normaliseScrapedLot (got ${norm.length})`);
assert(norm.every(l => l.price > 0), 'every survivor carries a numeric price');
assert(norm.every(l => l._auctionDate === '2026-07-28'), 'real auction date survives normalisation (never the 2099 sentinel)');
assert(norm.every(l => l.status === 'available'), 'the three live lots ship as available');

// ── Defensive ──
assert(recogniseSequenceBranchLotsFromMarkdown('').size === 0, 'empty markdown → empty map');
assert(recogniseSequenceBranchLotsFromMarkdown(null).size === 0, 'null markdown → empty map');
assert(recogniseSequenceBranchLotsFromMarkdown('# no lots here').size === 0, 'lot-less page → empty map');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
