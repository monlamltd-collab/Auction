// tests/test-lot-detail-status-guard.js — regression for the 2026-06-13
// incident's third layer: enrichLotsFromLotPages used detectSourceStatus()
// (a whole-page grep) to overwrite 'available' lots with sold/stc. Site
// chrome — hollismorgan's "Sold Archive" nav and "SOLD SUBJECT" ticker —
// fabricated statuses for genuinely-available lots (65/71 flipped, zero
// 'available' persisted, get_active_lots hid the house). The same pass's
// always-deep policy nulled imageUrl before fetching and destroyed the
// catalogue image whenever the refill found nothing.
//
// Contracts:
//   1. The detail pass never changes lot.status — lifecycle is owned by
//      catalogue extraction + recogniser corroboration + the sweeps.
//   2. always-deep restores the prior catalogue value when the detail page
//      yields no replacement, and keeps the detail value when it does.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { enrichLotsFromLotPages } = await import('../lib/scraper/lot-detail.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// A detail page whose CHROME mentions sold (nav + ticker) but whose lot is
// genuinely available — the hollismorgan shape.
const AMBIENT_SOLD_HTML = `
<html><head><title>21 High Street, Easton, Bristol</title></head><body>
<nav><a href="/sold-archive">Sold Archive</a><a href="/sold-developments">Sold Developments</a></nav>
<div class="ticker">SOLD SUBJECT TO CONTRACT: 12 Other Road (different lot)</div>
<h1>21 High Street, Easton, Bristol BS5 6DW</h1>
<p>Auction Guide Price £250,000. Freehold house, vacant possession.</p>
<img src="https://www.hollismorgan.co.uk/resize/123/0/480.detail-photo.jpg">
</body></html>`;

console.log('Test 1: ambient SOLD chrome does not flip an available lot');
{
  const lot = {
    house: 'hollismorgan',
    url: 'https://www.hollismorgan.co.uk/property-details/123/x/y',
    address: '21 High Street, Easton, Bristol BS5 6DW',
    status: 'available',
    imageUrl: 'https://www.hollismorgan.co.uk/resize/123/0/480.catalogue.jpg',
    bullets: [],
  };
  await enrichLotsFromLotPages([lot], {
    fetchLotPage: async () => ({ html: AMBIENT_SOLD_HTML, url: lot.url, source: 'http' }),
  });
  assert(lot.status === 'available', `status untouched by detail chrome (got ${lot.status})`);
}

console.log('\nTest 2: always-deep restores catalogue imageUrl when refill fails');
{
  const lot = {
    house: 'hollismorgan', // always-deep profile with overwriteFields: ['imageUrl']
    url: 'https://www.hollismorgan.co.uk/property-details/124/x/y',
    address: '1 Test Street, Bristol BS1 1AA',
    status: 'available',
    imageUrl: 'https://www.hollismorgan.co.uk/resize/124/0/480.catalogue.jpg',
    bullets: [],
  };
  await enrichLotsFromLotPages([lot], {
    fetchLotPage: async () => null, // detail fetch fails outright
  });
  assert(lot.imageUrl === 'https://www.hollismorgan.co.uk/resize/124/0/480.catalogue.jpg',
    `catalogue image restored after failed refill (got ${lot.imageUrl})`);
  assert(!Object.keys(lot).some(k => k.startsWith('_priorDeep_')), 'temp stash cleaned up');
}

console.log('\nTest 3: always-deep keeps the detail-page image when one is found');
{
  const lot = {
    house: 'hollismorgan',
    url: 'https://www.hollismorgan.co.uk/property-details/125/x/y',
    address: '2 Test Street, Bristol BS1 1AB',
    status: 'available',
    imageUrl: 'https://www.hollismorgan.co.uk/resize/125/0/480.catalogue.jpg',
    bullets: [],
  };
  await enrichLotsFromLotPages([lot], {
    fetchLotPage: async () => ({
      html: '<html><body><h1>2 Test Street</h1><img src="https://www.hollismorgan.co.uk/resize/125/0/1170.detail-hero.jpg"></body></html>',
      url: lot.url, source: 'http',
    }),
  });
  assert(lot.imageUrl === 'https://www.hollismorgan.co.uk/resize/125/0/1170.detail-hero.jpg',
    `detail image wins when found (got ${lot.imageUrl})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
