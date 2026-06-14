// tests/test-symondsandsampson-scraper.js — pickSoonestEvent + extractSymondsLotsFromMarkdown.
//
// symondsandsampson is Cloudflare-blocked; only Firecrawl proxy:'stealth' passes.
// The two-tier scraper resolves the soonest upcoming event from the stable events
// page, then parses /property/{id}/{pc}/{town}/{slug} lots from the event page.
// These fixtures match the REAL tier-1 stealth markdown (verified 2026-06-14) and
// the documented tier-2 lot-URL structure. Network (scrapeWithFirecrawl) is not
// exercised here — only the pure parsing functions.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { pickSoonestEvent, extractSymondsLotsFromMarkdown } = await import('../lib/scraper/symondsandsampson.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// ── Tier 1: events-page markdown (matches the real stealth layout) ──
const EVENTS_MD = `### **The Digby Hall, Hound Street, Sherborne, Dorset DT9 3AA**

#### Friday, 19 June 2026 1:00 PM \\- 5:00 PM

Lots are usually listed approximately 6 weeks prior to the auction date

If you are considering including a property in one of our auctions, please contact the Auction Department or your local office...

[View Event](https://auctions.symondsandsampson.co.uk/event/property-auction-jun2026-digbyhall)

[Add to Calendar](https://auctions.symondsandsampson.co.uk/downloadevent/property-auction-jun2026-digbyhall)

### **Merley House, Merley House Lane, Wimborne, Dorset BH21 3AA**

#### Thursday, 23 July 2026 2:00 PM \\- 5:00 PM

[View Event](https://auctions.symondsandsampson.co.uk/event/property-auction-jul2026-merleyhouse)`;

console.log('Test 1: pickSoonestEvent → soonest future event');
const e1 = pickSoonestEvent(EVENTS_MD, '2026-06-14');
assert(!!e1, 'returns an event');
assert(e1 && e1.eventUrl.endsWith('/event/property-auction-jun2026-digbyhall'), `picks June event (got "${e1?.eventUrl}")`);
assert(e1 && e1.auctionDateIso === '2026-06-19', `auction date 2026-06-19 (got "${e1?.auctionDateIso}")`);

console.log('\nTest 2: pickSoonestEvent skips a past event');
const e2 = pickSoonestEvent(EVENTS_MD, '2026-06-20'); // 19 June now past
assert(e2 && e2.auctionDateIso === '2026-07-23', `rolls to July (got "${e2?.auctionDateIso}")`);

console.log('\nTest 3: pickSoonestEvent → null when all events past, and safe on junk');
assert(pickSoonestEvent(EVENTS_MD, '2026-08-01') === null, 'all past → null');
assert(pickSoonestEvent('', '2026-06-14') === null, 'empty → null');
assert(pickSoonestEvent(null, '2026-06-14') === null, 'null → null');

// ── Tier 2: event-page lot layouts ──
// Layout A — heading text-link carries the address (propertysolvers-style).
const LOT_A = `[![Quarry Close](https://auctions.symondsandsampson.co.uk/img/quarry-close.jpg)](https://auctions.symondsandsampson.co.uk/property/dwr00073d/bh19/swanage/quarry-close/flat/1-bedroom)

### [12 Quarry Close, Swanage, Dorset BH19 1AB](https://auctions.symondsandsampson.co.uk/property/dwr00073d/bh19/swanage/quarry-close/flat/1-bedroom)

£150,000 Guide Price

[View Property](https://auctions.symondsandsampson.co.uk/property/dwr00073d/bh19/swanage/quarry-close/flat/1-bedroom)`;

// Layout B — address only in a heading; the link is a generic CTA.
const LOT_B = `### 5 High Street, Sherborne, Dorset DT9 3LF

[View Property](https://auctions.symondsandsampson.co.uk/property/abc12345x/dt9/sherborne/high-street/house/3-bedroom)

Guide Price £325,000`;

// Layout C — lot appears ONLY as an image-wrapped link (no address text).
const LOT_C = `[![](https://auctions.symondsandsampson.co.uk/img/plot.jpg)](https://auctions.symondsandsampson.co.uk/property/zzz99999q/ta20/chard/mill-lane/land)`;

console.log('\nTest 4: Layout A — heading text-link address + price + image');
const mA = extractSymondsLotsFromMarkdown(LOT_A, '2026-06-19');
const a = mA.get('dwr00073d');
assert(mA.size === 1, `1 lot (got ${mA.size})`);
assert(a && a.address === '12 Quarry Close, Swanage, Dorset BH19 1AB', `address (got "${a?.address}")`);
assert(a && a.guide_price === '£150,000', `guide_price (got "${a?.guide_price}")`);
assert(a && a.image_url.endsWith('quarry-close.jpg'), `image (got "${a?.image_url}")`);
assert(a && a.detail_url.includes('/property/dwr00073d/'), 'detail_url captured');
assert(a && a.lot_status === 'available', `available (got "${a?.lot_status}")`);
assert(a && a.auction_date === '2026-06-19', `auction_date stamped (got "${a?.auction_date}")`);
assert(a && a.property_type === 'Flat', `type from URL (got "${a?.property_type}")`);
assert(a && a.bedrooms === 1, `beds from URL (got ${a?.bedrooms})`);

console.log('\nTest 5: Layout B — address from heading, CTA link ignored, price after');
const mB = extractSymondsLotsFromMarkdown(LOT_B, '2026-06-19');
const b = mB.get('abc12345x');
assert(b && b.address === '5 High Street, Sherborne, Dorset DT9 3LF', `heading address (got "${b?.address}")`);
assert(b && b.guide_price === '£325,000', `guide_price (got "${b?.guide_price}")`);
assert(b && b.bedrooms === 3, `beds (got ${b?.bedrooms})`);

console.log('\nTest 6: Layout C — image-only lot still captured (URL-derived address)');
const mC = extractSymondsLotsFromMarkdown(LOT_C, '2026-06-19');
const c = mC.get('zzz99999q');
assert(mC.size === 1, `1 lot (got ${mC.size})`);
assert(c && /Mill Lane/i.test(c.address) && /Chard/i.test(c.address) && /TA20/.test(c.address), `URL-derived address (got "${c?.address}")`);
assert(c && c.property_type === 'Land', `type Land (got "${c?.property_type}")`);

console.log('\nTest 7: dedup by lot id + safe on junk');
assert(extractSymondsLotsFromMarkdown(LOT_A + '\n\n' + LOT_A, '2026-06-19').size === 1, 'same lot twice → 1');
assert(extractSymondsLotsFromMarkdown('', '2026-06-19').size === 0, 'empty → 0');
assert(extractSymondsLotsFromMarkdown(null, '2026-06-19').size === 0, 'null → 0');
assert(extractSymondsLotsFromMarkdown('### [Nope](https://example.com/x)', '2026-06-19').size === 0, 'non-S&S link → 0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
