// tests/test-bagshaws-recogniser.js — Bagshaws Residential static-catalogue recogniser.
//
// The house went dark (82 lots stored, 0 live) because it had NO recogniser and
// leaned on the AI extractor: the last good AI pass (11 Jul 2026) got 22 of 23
// and dropped the SOLD-PRIOR lot, and every pass since produced a single junk row
// (url = the catalogue root), so the 22 real lots aged out of get_active_lots'
// 7-day freshness window. One plain-HTTP fetch of the hand-maintained catalogue
// page carries all 23 cards; this recogniser parses them deterministically.
// Verified 23/23 = 100% recall against the live page 2026-07-21.
//
// Three contracts this test pins:
//   1. ANTI-LEAK — a `**Sold Prior**` lot must never emit status='available'.
//   2. AUCTION DATE — parsed from the lot-URL slug (`28-july-2026`). Without it
//      the house's only auction_calendar row (a 2099-12-31 always_on placeholder)
//      would keep every lot "live" forever after the hammer falls.
//   3. BROKEN ANCHOR — one lot's text link is `href="link"` (a hand-editing typo
//      on the live page). Its URL + photo are recovered from the thumbnail block,
//      whose image basename IS the lot number, rather than dropping the lot.

import { recogniseSequenceBranchLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';
import { normaliseScrapedLot } from '../lib/types/lot.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// Mirrors the real turndown markdown: a row of thumbnail links, then a row of
// text blocks, both pointing at the same lot URLs. String.raw so the `\\`
// hard-break stays two LITERAL backslashes followed by a real newline (a plain
// template literal would treat `\<newline>` as a line continuation and collapse
// the exact shape the recogniser has to cope with).
//
// Lot 257 reproduces the live `href="link"` typo (turndown absolutises it to the
// house's own host). Lot 274 is SOLD PRIOR — no guide price, a status line instead.
const MD = String.raw`
**Bagshaws Residential Lots are 253 to 275 inclusive.**

Click on the image to link to that lot\\

[![](https://www.bagshawsauctions.co.uk/images/auctions/2026/july26/253.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707826/)



[![](https://www.bagshawsauctions.co.uk/images/auctions/2026/july26/257.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707825/)



[![](https://www.bagshawsauctions.co.uk/images/auctions/2026/july26/266.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707838/)



[![](https://www.bagshawsauctions.co.uk/images/auctions/2026/july26/274.jpg)](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707842/)

**[Lot 253](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707826/)**\\
22, Thorn Street, DERBY,\\
Derbyshire,\\
DE23 6LZ\\
Guide: £60,000

**[Lot 257](https://www.bagshawsauctions.co.uk/link)**\\
66, Wythburn Road, CHESTERFIELD, Derbyshire,\\
S41 8DR\\
Guide: £50,000\\

**[Lot 266](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707838/)**\\
226, Abbeydale Road South,\\
SHEFFIELD,\\
South Yorkshire,\\
S17 3LA\\
Guide: £700,000

**[Lot 274](https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707842/)**\\
274, Uttoxeter New Road, DERBY, Derbyshire,\\
DE22 3LL\\
**Sold Prior**

![spacer](https://www.bagshawsauctions.co.uk/images/general/Spacer.gif)

[![Bagshaws Residential](https://www.bagshawsauctions.co.uk/images/general/Bagshaws-Logo.jpg)](https://www.bagshawsauctions.co.uk)

[![Sequence](https://www.bagshawsauctions.co.uk/images/general/Sequence-Logo.jpg)](http://www.sequenceauctions.co.uk)
`;

console.log('Bagshaws recogniser — 100% recall, sold-prior never available, real auction date');
const lots = recogniseSequenceBranchLotsFromMarkdown(MD);

// ── Recall: every card recovered, keyed by the Sentinel lot id ──
assert(lots.size === 4, `all 4 cards recovered (got ${lots.size})`);
assert(lots.has('707826') && lots.has('707825') && lots.has('707838') && lots.has('707842'),
  `keyed by Sequence lot id (got ${[...lots.keys()].join(', ')})`);

// ── Anti-leak: SOLD PRIOR must never ship as available ──
assert(lots.get('707842').lot_status === 'sold', 'SOLD PRIOR lot is status=sold (never available)');
// Status text must NOT reach `bullets`: persist-lots resolves the sale date as
// `bulletDate || _auctionDate || calendarDate` (bullets FIRST) and
// parseAuctionDateFromBullet matches any bare "DD Month YYYY", so a hand-typed
// "Postponed to 15 September 2026" would override the authoritative slug date.
assert([...lots.values()].every(l => l.bullets.length === 0), 'no lot emits bullets (a dated status line must never outrank the URL-slug date)');
const DATED_STATUS_MD = MD.replace('**Sold Prior**', '**Postponed to 15 September 2026**');
const datedStatus = recogniseSequenceBranchLotsFromMarkdown(DATED_STATUS_MD);
assert(datedStatus.get('707842').auction_date === '2026-07-28', 'a status line carrying its own date does not become the auction date');
assert(datedStatus.get('707842').lot_status === 'withdrawn', 'a "Postponed" lot is withdrawn, never available');
assert(lots.get('707842').guide_price === '', 'sold lot has no guide price (no bleed from a neighbour)');
assert([...lots.values()].filter(l => l.lot_status === 'available').length === 3, 'exactly 3 available lots');

// ── Broken text anchor: lot 257 recovered via its thumbnail ──
const l257 = lots.get('707825');
assert(!!l257, 'lot with a broken href="link" anchor is still recovered');
assert(l257.detail_url === 'https://www.barnardmarcusauctions.co.uk/auctions/28-july-2026/707825/',
  `broken anchor falls back to the thumbnail's lot URL (got ${l257 && l257.detail_url})`);
assert(/july26\/257\.jpg$/.test(l257.image_url), 'thumbnail bound by image basename = lot number');

// ── Auction date parsed from the URL slug (beats the 2099 always_on calendar row) ──
assert([...lots.values()].every(l => l.auction_date === '2026-07-28'),
  'every lot carries the real sale date 2026-07-28 parsed from the URL slug');

// ── Fields ──
const l253 = lots.get('707826');
assert(l253.lot_number === '253', `lot number parsed (got ${l253.lot_number})`);
assert(l253.address === '22, Thorn Street, DERBY, Derbyshire, DE23 6LZ',
  `address joined across hard-breaks, no double commas (got ${l253.address})`);
assert(l253.guide_price === '£60,000', `guide price parsed (got ${l253.guide_price})`);
assert(/july26\/253\.jpg$/.test(l253.image_url), 'own photo bound to the lot, no bleed');
assert(lots.get('707838').address === '226, Abbeydale Road South, SHEFFIELD, South Yorkshire, S17 3LA',
  `4-line address joined correctly (got ${lots.get('707838').address})`);
assert(new Set([...lots.values()].map(l => l.image_url)).size === 4, 'every lot has a DISTINCT photo (no hero bleed)');

// ── Page furniture is not a lot ──
assert(![...lots.values()].some(l => /logo|spacer|sequence/i.test(l.image_url)),
  'logo / spacer / footer images never bind to a lot');

// ── The real contract: what SURVIVES normaliseScrapedLot ──
const norm = [...lots.values()]
  .map(l => normaliseScrapedLot(l, { house: 'bagshaws', catalogueUrl: 'https://www.bagshawsauctions.co.uk/', extractionSource: 'static-recognition' }))
  .filter(Boolean);
assert(norm.length === 4, `all 4 lots survive normaliseScrapedLot (got ${norm.length})`);
assert(norm.every(l => l._auctionDate === '2026-07-28'), 'auction date survives normalisation');
assert(norm.filter(l => l.status === 'available').length === 3, 'still exactly 3 available after normalisation');
assert(norm.find(l => l.lot === '253').price === 60000, 'guide price parsed to an integer');
assert(norm.every(l => /^https:\/\//.test(l.url)), 'every lot has an absolute detail URL');

// ── A PAST sale is dropped outright, never rolled forward, never kept ──
// Two failure modes this pins at once:
//   1. The Maggs 2026-05-12 incident — a no-year bullet rolled forward 12 months,
//      resurrecting an ended catalogue as "live". The date here is unambiguous in
//      the URL, so it can never be rolled forward.
//   2. Keeping the lot with its real past date and relying on a downstream gate
//      (tried and reverted 2026-07-22). get_active_lots does gate on
//      `auction_date >= current_date - 1`, but lib/sitemap.js's live cohort is an
//      OR with `last_seen_at` within 7d, so a re-seen past-dated `available` row
//      is submitted to Google as a live listing — and ghost-sweep can never
//      retire it, because it only flips lots UNSEEN for 7+ days and this card is
//      re-seen on every scrape.
const PAST_MD = MD.replace(/28-july-2026/g, '19-may-2026');
const pastLots = recogniseSequenceBranchLotsFromMarkdown(PAST_MD);
assert(pastLots.size === 0, `every lot of a past-dated catalogue is dropped (got ${pastLots.size})`);

// ── ...but the boundary is the sale date, not "any date" — a FUTURE sale is kept ──
const FUTURE_MD = MD.replace(/28-july-2026/g, '28-july-2099');
assert(recogniseSequenceBranchLotsFromMarkdown(FUTURE_MD).size === 4, 'a future-dated catalogue is fully parsed');
// Injectable today: on the day of the sale the lots are still live.
assert(recogniseSequenceBranchLotsFromMarkdown(MD, '2026-07-28').size === 4, 'lots are still live ON the sale day');
assert(recogniseSequenceBranchLotsFromMarkdown(MD, '2026-07-29').size === 0, 'lots are gone the day AFTER the sale');

// ── Empty / garbage input never throws ──
assert(recogniseSequenceBranchLotsFromMarkdown('').size === 0, 'empty markdown → empty map');
assert(recogniseSequenceBranchLotsFromMarkdown(null).size === 0, 'null markdown → empty map');
assert(recogniseSequenceBranchLotsFromMarkdown('# no lots here').size === 0, 'lot-less page → empty map');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
