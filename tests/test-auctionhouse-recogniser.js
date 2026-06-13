// tests/test-auctionhouse-recogniser.js — the Auction House UK platform recogniser.
//
// auctionhouse.co.uk runs ~33 regional franchise sites off ONE template, each
// rendering its ENTIRE catalogue on a single search-results page (London =
// 848 lots, no pagination). The Gemini extractor only pulled a token-limited
// slice (~105/848); this deterministic recogniser parses every card from the
// turndown markdown for full recall at zero LLM cost.
//
// Fixture mirrors the live card shapes captured 2026-06-13 from
// /london/auction/search-results — both lot-URL forms, all price/status
// variants, lettered lot numbers, and type-only (no-bed) land/commercial cards.
//
// Run: node tests/test-auctionhouse-recogniser.js

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseAuctionHouseLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');
const { houseRecogniser, resolvePlatformRecogniser } = await import('../lib/scraper/house-recognisers.js');
const { resolveRecallSentinel } = await import('../lib/scraper/recall-sentinels.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const card = (addr, img, lot, marker, type, url) =>
  `![Property for Auction in London - ${addr}](${img})\n\n${lot}\n\n${marker}\n\n${type}\n\n${addr}\n\n](${url})\n\n[\n\n`;

const SAMPLE =
  'Auction lots (11 Lots)\n\n[Grid view](https://auctionhouse.co.uk/london)\n\n* * *\n\n[\n\n' +
  // 1: available, £+, region-path URL, numeric lot
  card('82 Harley Road, Harlesden, London, NW10 8AX', 'https://auctionhouse.co.uk/lot-image/888799', 'Lot 1', '\\*Guide | £375,000+ (plus fees)', '3 Bed Terraced House', 'https://auctionhouse.co.uk/london/auction/lot/149431') +
  // 2: available, RANGE price, redirect URL form
  card('6 Enfield Road, Blackpool, Lancashire, FY1 2RB', 'https://cdn.eigpropertyauctions.co.uk/ams/images/x_web_medium', 'Lot 29', '\\*Guide | £30,000 - £50,000 (plus fees)', '3 Bed Terraced House', 'https://online.auctionhouse.co.uk/lot/redirect/347417') +
  // 3: available, No Reserve
  card('5 Sea View, Brighton, BN1 1AA', 'https://auctionhouse.co.uk/lot-image/3', 'Lot 5', '\\*Guide | No Reserve (plus fees)', '2 Bed Flat', 'https://auctionhouse.co.uk/london/auction/lot/300') +
  // 4: available, LETTERED lot number
  card('64 Chesterford Road, Manor Park, London, E12 6LB', 'https://auctionhouse.co.uk/lot-image/4', 'Lot 10A', '\\*Guide | £270,000+ (plus fees)', '3 Bed Terraced House', 'https://auctionhouse.co.uk/london/auction/lot/222') +
  // 5: SOLD with hammer price (no guide line)
  card('8 Dover Close, Cricklewood, London, NW2 1AB', 'https://auctionhouse.co.uk/lot-image/5', 'Lot 46', 'Sold £296,000', '2 Bed Flat', 'https://auctionhouse.co.uk/london/auction/lot/333') +
  // 6: SOLD PRIOR
  card('66 Powis Street, Woolwich, London, SE18 6LQ', 'https://auctionhouse.co.uk/lot-image/6', 'Lot 48', 'Sold Prior', '2 Bed Flat', 'https://auctionhouse.co.uk/london/auction/lot/444') +
  // 7: WITHDRAWN
  card('137-139 Mellison Road, Tooting, London, SW17 9AT', 'https://auctionhouse.co.uk/lot-image/7', 'Lot 36', 'Withdrawn', '3 Bed Terraced House', 'https://auctionhouse.co.uk/london/auction/lot/555') +
  // 8: POSTPONED → withdrawn
  card('3 Costons Court, Greenford, Middlesex, UB6 8RW', 'https://auctionhouse.co.uk/lot-image/8', 'Lot 12', 'Postponed', '2 Bed Flat', 'https://auctionhouse.co.uk/london/auction/lot/666') +
  // 9: COMMERCIAL, type-only (no beds)
  card('14 High Street, Croydon, CR0 1AA', 'https://auctionhouse.co.uk/lot-image/9', 'Lot 60', '\\*Guide | £100,000+ (plus fees)', 'Commercial Property', 'https://auctionhouse.co.uk/london/auction/lot/777') +
  // 10: LAND, type-only
  card('Plot adj 5 Mill Lane, Romford, RM1 2AB', 'https://auctionhouse.co.uk/lot-image/10', 'Lot 61', '\\*Guide | £50,000+ (plus fees)', 'Land', 'https://auctionhouse.co.uk/london/auction/lot/888') +
  // 11: DUPLICATE id 149431 (same lot linked twice) — must dedup
  card('82 Harley Road, Harlesden, London, NW10 8AX', 'https://auctionhouse.co.uk/lot-image/888799', 'Lot 1', '\\*Guide | £375,000+ (plus fees)', '3 Bed Terraced House', 'https://auctionhouse.co.uk/london/auction/lot/149431');

const lots = recogniseAuctionHouseLotsFromMarkdown(SAMPLE);

console.log('Test 1: parses all 10 distinct lots (dup deduped)');
assert(lots instanceof Map, 'returns a Map');
assert(lots.size === 10, `10 distinct lots, got ${lots.size}`);

console.log('\nTest 2: keys are the trailing lot ids — BOTH URL forms');
assert(lots.has('149431'), 'region-path /auction/lot/149431');
assert(lots.has('347417'), 'redirect /lot/redirect/347417');

console.log('\nTest 3: available lot — £+ price, address, image, beds, type');
{
  const l = lots.get('149431');
  assert(l.lot_status === 'available', `status available, got ${l.lot_status}`);
  assert(l.guide_price === '£375,000+', `guide_price, got ${l.guide_price}`);
  assert(l.address === '82 Harley Road, Harlesden, London, NW10 8AX', `address: ${l.address}`);
  assert(l.bedrooms === 3, `beds 3, got ${l.bedrooms}`);
  assert(l.property_type === 'house', `type house, got ${l.property_type}`);
  assert(l.image_url === 'https://auctionhouse.co.uk/lot-image/888799', 'image url');
  assert(l.lot_number === '1', `lot_number "1", got ${JSON.stringify(l.lot_number)}`);
}

console.log('\nTest 4: range + No Reserve prices preserved verbatim');
assert(lots.get('347417').guide_price === '£30,000 - £50,000', `range: ${lots.get('347417').guide_price}`);
assert(lots.get('300').guide_price === 'No Reserve', `no reserve: ${lots.get('300').guide_price}`);

console.log('\nTest 5: lettered lot number kept as text');
assert(lots.get('222').lot_number === '10A', `lot_number "10A", got ${JSON.stringify(lots.get('222').lot_number)}`);

console.log('\nTest 6: status parsed deterministically (never persisted as available)');
assert(lots.get('333').lot_status === 'sold', `Sold £X → sold, got ${lots.get('333').lot_status}`);
assert(lots.get('333').guide_price === '', 'sold lot has no guide price');
assert(lots.get('444').lot_status === 'sold', `Sold Prior → sold, got ${lots.get('444').lot_status}`);
assert(lots.get('555').lot_status === 'withdrawn', `Withdrawn, got ${lots.get('555').lot_status}`);
assert(lots.get('666').lot_status === 'withdrawn', `Postponed → withdrawn, got ${lots.get('666').lot_status}`);

console.log('\nTest 7: type-only (no-bed) land/commercial cards');
{
  const com = lots.get('777'), land = lots.get('888');
  assert(com.property_type === 'commercial' && com.bedrooms === null, `commercial, no beds (got ${com.property_type}/${com.bedrooms})`);
  assert(land.property_type === 'land' && land.bedrooms === null, `land, no beds (got ${land.property_type}/${land.bedrooms})`);
}

console.log('\nTest 8: empty / junk input is safe');
assert(recogniseAuctionHouseLotsFromMarkdown('').size === 0, 'empty string → empty Map');
assert(recogniseAuctionHouseLotsFromMarkdown(null).size === 0, 'null → empty Map');
assert(recogniseAuctionHouseLotsFromMarkdown('no cards here').size === 0, 'no cards → empty Map');

console.log('\nTest 9: platform wiring — franchise houses resolve to the recogniser');
{
  const rec = houseRecogniser('auctionhouseuklondon');
  assert(!!rec && rec.recogniseFromMarkdown === recogniseAuctionHouseLotsFromMarkdown, 'auctionhouseuklondon → platform recogniser');
  assert(!!resolvePlatformRecogniser('auctionhousenational'), 'auctionhousenational → platform recogniser');
  assert(resolvePlatformRecogniser('hollismorgan') === null, 'non-franchise house → no platform recogniser');
  // The separate company auctionhouselondon.co.uk must NOT match the franchise.
  assert(resolvePlatformRecogniser('auctionhouselondon') === null, 'auctionhouselondon (separate co.) excluded');
  // Sentinel resolves to the both-forms pattern and matches both URL shapes.
  const sentinel = resolveRecallSentinel('auctionhouseuklondon', rec?.recallSentinelPattern);
  assert(!!'x/london/auction/lot/149431'.match(sentinel), 'sentinel matches /auction/lot/ form');
  assert(!!'x/lot/redirect/347417'.match(new RegExp(sentinel.source)), 'sentinel matches /lot/redirect/ form');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
