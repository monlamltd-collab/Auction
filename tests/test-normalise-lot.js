/**
 * Pure-function tests for normaliseLot in lib/pipeline/firecrawl-extract.js.
 *
 * The bullets policy is the load-bearing piece this test locks: recogniser-
 * supplied multi-element arrays must survive verbatim; the historical
 * `[raw.description]` fallback must still fire when bullets are absent or
 * empty. Without this guard the bullets channel silently degrades whenever
 * a future recogniser starts producing arrays.
 *
 * Run: node tests/test-normalise-lot.js
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { normaliseLot } = await import('../lib/pipeline/firecrawl-extract.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const ADDR = '30, Avonvale Road, Redfield, Bristol, BS5 9RL';
const HOUSE = 'maggsandallen';
const CAT_URL = 'https://www.maggsandallen.co.uk/search-auction/?auction=3';

console.log('Test 1: raw.bullets is a multi-element array → preserved verbatim');
{
  const raw = {
    address: ADDR,
    bullets: ['20 May LIVE ONLINE AUCTION', 'Victorian House', '3 Bedrooms', 'Close to St Georges Park'],
    description: '20 May LIVE ONLINE AUCTION',
  };
  const out = normaliseLot(raw, HOUSE, CAT_URL);
  assert(Array.isArray(out.bullets), 'returned bullets is an array');
  assert(out.bullets.length === 4, `length === 4, got ${out.bullets.length}`);
  assert(out.bullets[0] === '20 May LIVE ONLINE AUCTION', 'first bullet preserved');
  assert(out.bullets[3] === 'Close to St Georges Park', 'fourth bullet preserved');
  assert(out.bullets === raw.bullets, 'reference-equal to the input array');
}

console.log('\nTest 2: raw.bullets absent + raw.description present → fall back to [desc]');
{
  const raw = { address: ADDR, description: 'A nice flat in Clifton' };
  const out = normaliseLot(raw, HOUSE, CAT_URL);
  assert(out.bullets.length === 1, `length === 1, got ${out.bullets.length}`);
  assert(out.bullets[0] === 'A nice flat in Clifton', 'description wrapped as single element');
}

console.log('\nTest 3: both absent → empty array (not null/undefined)');
{
  const raw = { address: ADDR };
  const out = normaliseLot(raw, HOUSE, CAT_URL);
  assert(Array.isArray(out.bullets), 'still an array');
  assert(out.bullets.length === 0, `length === 0, got ${out.bullets.length}`);
}

console.log('\nTest 4: raw.bullets is empty [] + raw.description present → fall back to [desc]');
{
  // Empty arrays are falsy as a recogniser signal; we shouldn't strand the
  // description when the recogniser explicitly set an empty array.
  const raw = { address: ADDR, bullets: [], description: 'A nice flat in Clifton' };
  const out = normaliseLot(raw, HOUSE, CAT_URL);
  assert(out.bullets.length === 1, `length === 1, got ${out.bullets.length}`);
  assert(out.bullets[0] === 'A nice flat in Clifton', 'description used despite empty bullets');
}

console.log('\nTest 5: raw.bullets is a single-element array → preserved');
{
  const raw = { address: ADDR, bullets: ['Solo bullet'], description: 'A nice flat in Clifton' };
  const out = normaliseLot(raw, HOUSE, CAT_URL);
  assert(out.bullets.length === 1, 'length === 1');
  assert(out.bullets[0] === 'Solo bullet', 'bullets[0] wins over description');
}

console.log('\nTest 6: invalid address → returns null (unchanged contract)');
{
  // looksLikeRealAddress rejects descriptors/banners — that gate must still
  // apply regardless of the bullets shape.
  assert(normaliseLot({ address: 'Virtual Viewing', bullets: ['x'] }, HOUSE, CAT_URL) === null,
    'placeholder address → null');
  assert(normaliseLot({ address: null, bullets: ['x'] }, HOUSE, CAT_URL) === null,
    'null address → null');
  assert(normaliseLot({ address: '' }, HOUSE, CAT_URL) === null,
    'empty address → null');
}

console.log('\nTest 7: other fields still flow through normally');
{
  const raw = {
    address: ADDR,
    lot_number: 7,
    guide_price: '£215,000+',
    bedrooms: 3,
    tenure: 'freehold',
    image_url: 'https://example.com/photo.jpg',
    detail_url: 'https://example.com/lot/7',
    property_type: 'house',
    lot_status: 'available',
    auction_date: '2026-05-20',
    bullets: ['one', 'two'],
  };
  const out = normaliseLot(raw, HOUSE, CAT_URL);
  assert(out.address === ADDR, 'address');
  assert(out.lotNumber === 7, 'lotNumber');
  assert(out.priceStr === '£215,000+', 'priceStr');
  assert(out.beds === 3, 'beds');
  assert(out.tenure === 'freehold', 'tenure');
  assert(out.imageUrl === 'https://example.com/photo.jpg', 'imageUrl');
  assert(out.url === 'https://example.com/lot/7', 'url');
  assert(out.propType === 'house', 'propType');
  assert(out.lotStatus === 'available', 'lotStatus');
  assert(out.auctionDate === '2026-05-20', 'auctionDate');
  assert(out.house === HOUSE, 'house');
  assert(out.catalogueUrl === CAT_URL, 'catalogueUrl');
  assert(out._extractionSource === 'firecrawl-json', '_extractionSource stamp');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
