// tests/test-cliveemson-recogniser.js — recogniseCliveEmsonLotsFromMarkdown.
//
// Clive Emson is a JS-rendered SPA (rewriteUrl preferPuppeteer → Crawlee →
// turndown). Gemini under-extracts its dense single-page /properties/ catalogue
// and historically stored each lot's "View on Google Maps" pin as lots.url, so
// the multi-image sweep fetched a map and every gallery stayed blank. The
// recogniser anchors on the real detail link and emits the clean URL.
//
// Fixtures are the REAL turndown markdown shape verified live against auction
// 266 on 2026-06-22 (htmlToRecognitionMarkdown of /properties/, 150/150 lots):
// a per-lot Google-Maps pin, then a "grid" card linking /properties/{auc}/{lot}/
// and a "list" card linking a MALFORMED /properties/properties/{auc}/{lot}/.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseCliveEmsonLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const HEADER = `## Wednesday 17th June 2026, 11:00 AM\n\n[Addendum](https://www.cliveemson.co.uk/properties/auc266/legals/Online160626.pdf)\n\n`;

// LOT 1 — available flat. Renders TWICE: clean grid link, then the site's own
// malformed /properties/properties/ list link (with mangled location escapes).
const LOT1 = `[](https://maps.google.com/maps?q=51.3580000000,1.4392000000&t=&z=15&ie=UTF8&hl=en&iwloc=near)

[LOT 1

### WELL PRESENTED TWO-BEDROOM FLAT WITH GARDEN AND PARKING

Thanet Area - Kent Area

AVAILABLE AT**£150,000\\*\\+ FEES**

](https://www.cliveemson.co.uk/properties/266/1/)[Add to bookmarks](javascript:addBookmark('266','1','L',false);)

[LOT 1

### WELL PRESENTED TWO-BEDROOM FLAT WITH GARDEN AND PARKING

Thanet Area*\\-*\\\\
Kent Area

AVAILABLE AT**£150,000\\*\\+ FEES**

](https://www.cliveemson.co.uk/properties/properties/266/1/)[Add to bookmarks](javascript:addBookmark('266','1','L',false);)`;

// LOT 4 — sold house (sale price shown in place of a guide).
const LOT4_SOLD = `[](https://maps.google.com/maps?q=50.1238000000,-5.6860000000&t=&z=15&ie=UTF8&hl=en&iwloc=near)

[LOT 4

### TERRACED TWO-BEDROOM COTTAGE FOR UPDATING

Penzance - Cornwall

SOLD**£105,000**

](https://www.cliveemson.co.uk/properties/266/4/)[Add to bookmarks](javascript:addBookmark('266','4','L',false);)`;

// LOT 8 — postponed (no price line).
const LOT8_POSTPONED = `[LOT 8

### FREEHOLD SITE WITH PLANNING FOR 17 EMPLOYMENT UNITS

Canterbury Area - Kent Area

POSTPONED

](https://www.cliveemson.co.uk/properties/266/8/)[Add to bookmarks](javascript:addBookmark('266','8','L',false);)`;

// LOT 61 — withdrawn ("WITHDRAWN AFTER").
const LOT61_WITHDRAWN = `[LOT 61

### FREEHOLD PAIR OF FLATS FOR INVESTMENT

Gillingham - Kent

WITHDRAWN AFTER

](https://www.cliveemson.co.uk/properties/266/61/)[Add to bookmarks](javascript:addBookmark('266','61','L',false);)`;

// LOT 99 — terse "Town - Region" (<12 chars, no digit) → must be qualified with
// the headline so normaliseScrapedLot's looksLikeRealAddress doesn't drop it.
const LOT99_TERSE = `[LOT 99

### CHARMING DETACHED COTTAGE

Ryde - IOW

AVAILABLE AT**£90,000\\*\\+ FEES**

](https://www.cliveemson.co.uk/properties/266/99/)[Add to bookmarks](javascript:addBookmark('266','99','L',false);)`;

const ALL = [HEADER, LOT1, LOT4_SOLD, LOT8_POSTPONED, LOT61_WITHDRAWN, LOT99_TERSE].join('\n\n');

console.log('Test 1: parses every distinct lot, keyed by the sentinel {lot} id');
const map = recogniseCliveEmsonLotsFromMarkdown(ALL);
assert(map instanceof Map, 'returns a Map');
assert(map.size === 5, `5 distinct lots — LOT 1 grid+list dedup to one (got ${map.size})`);
assert(['1', '4', '8', '61', '99'].every(id => map.has(id)), 'keyed by url {lot} id');

console.log('\nTest 2: clean card — address, guide price, type, status, date, URL');
const a = map.get('1');
assert(a && a.address === 'Thanet Area - Kent Area', `town-county address (got "${a?.address}")`);
assert(a && a.guide_price === '£150,000', `guide_price (got "${a?.guide_price}")`);
assert(a && a.property_type === 'flat', `property_type flat (got "${a?.property_type}")`);
assert(a && a.lot_status === 'available', `available (got "${a?.lot_status}")`);
assert(a && a.lot_number === 1, `numeric lot_number (got ${a?.lot_number})`);
assert(a && a.auction_date === '2026-06-17', `auction_date from header (got "${a?.auction_date}")`);
assert(a && a.detail_url === 'https://www.cliveemson.co.uk/properties/266/1/', `clean detail URL (got "${a?.detail_url}")`);

console.log('\nTest 3: the Google-Maps pin is NEVER stored as the lot URL, and the');
console.log('        malformed /properties/properties/ duplicate is normalised away');
for (const lot of map.values()) {
  assert(!/maps\.google/.test(lot.detail_url), `no maps URL for lot (got "${lot.detail_url}")`);
  assert(!/properties\/properties/.test(lot.detail_url), `no doubled prefix (got "${lot.detail_url}")`);
}

console.log('\nTest 4: status parsing — sold / postponed / withdrawn');
assert(map.get('4').lot_status === 'sold', `sold (got "${map.get('4')?.lot_status}")`);
assert(map.get('4').guide_price === '£105,000', `sold price captured (got "${map.get('4')?.guide_price}")`);
assert(map.get('4').property_type === 'house', `cottage → house (got "${map.get('4')?.property_type}")`);
assert(map.get('8').lot_status === 'postponed', `postponed (got "${map.get('8')?.lot_status}")`);
assert(map.get('8').guide_price === '', `postponed → no price (got "${map.get('8')?.guide_price}")`);
assert(map.get('61').lot_status === 'withdrawn', `withdrawn (got "${map.get('61')?.lot_status}")`);
assert(map.get('61').property_type === 'flat', `pair of flats → flat (got "${map.get('61')?.property_type}")`);

console.log('\nTest 5: terse location qualified with the headline (lot retained)');
const t = map.get('99');
assert(t && t.address === 'CHARMING DETACHED COTTAGE, Ryde - IOW', `qualified address (got "${t?.address}")`);

console.log('\nTest 6: image_url left empty (the multi-image sweep fills the gallery)');
assert([...map.values()].every(l => l.image_url === ''), 'all image_url empty');

console.log('\nTest 7: dedup + junk-safe');
assert(recogniseCliveEmsonLotsFromMarkdown(HEADER + LOT1).size === 1, 'grid+list of one lot → 1');
assert(recogniseCliveEmsonLotsFromMarkdown('[](https://maps.google.com/maps?q=51.3,1.4&z=15)').size === 0, 'lone maps pin → 0');
assert(recogniseCliveEmsonLotsFromMarkdown('').size === 0, 'empty → 0');
assert(recogniseCliveEmsonLotsFromMarkdown(null).size === 0, 'null → 0');
assert(recogniseCliveEmsonLotsFromMarkdown('[LOT 1\n\n### X House\n\nLeeds - Yorkshire\n\nAVAILABLE AT**£1**\n\n](https://example.com/properties/266/1/)').size === 0, 'non-cliveemson host → 0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
