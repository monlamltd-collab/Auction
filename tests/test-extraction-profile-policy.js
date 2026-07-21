// tests/test-extraction-profile-policy.js — pins the EXTRACTION_PROFILE
// 'never-deep' semantics in enrichLotsFromLotPages.
//
// Until 2026-07-22 the 'never-deep' branch ran `if (isGapFillTarget(l))
// targets.push(l)` — byte-identical to the 'gap-fill' fallthrough — so the
// policy was dead config. And because isGapFillTarget tests `!l.condition` and
// `l.vacant == null`, which neither never-deep house's JSON API publishes,
// EVERY lot requalified on EVERY cycle forever. On underthehammer that meant up
// to DETAIL_FETCH_CAP_PER_RUN (80) Crawlee browser renders per cycle against
// Next.js SPA shells that add nothing the API hadn't already supplied.
//
// Contracts:
//   1. never-deep skips an already-known lot no matter how gappy it looks.
//   2. never-deep still deep-fetches FIRST-CONTACT lots — the kitchen-sink pass
//      (enrich-stage.js) is a separate invariant, bounded to once per lot URL.
//   3. The same gappy lot on a default (gap-fill) house IS fetched — i.e. the
//      two policies genuinely differ. This is the anti-dead-config assertion:
//      it fails if never-deep is ever reverted to the gap-fill body.
//   4. The configured never-deep houses are rich-catalogue houses.
//
// Offline-safe: the fetchLotPage test seam means no network / no Supabase.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { enrichLotsFromLotPages } = await import('../lib/scraper/lot-detail.js');
const { EXTRACTION_PROFILE, getProfile } = await import('../lib/houses.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// A lot as the underthehammer / allsop JSON APIs actually deliver it: address,
// postcode, price, beds, tenure, type and an image all present — but no
// `condition` and no `vacant`, which isGapFillTarget both test for. Under the
// old code this shape was a perpetual deep-fetch target.
const richApiLot = (over = {}) => ({
  house: 'underthehammer',
  url: 'https://www.underthehammer.com/property/a0YQ400000Z4P8XMAV',
  address: '30 Princes Street, Bishop Auckland, DL4 1AX',
  postcode: 'DL4 1AX',
  price: 30000,
  beds: 2,
  tenure: 'Freehold',
  propType: 'terraced',
  imageUrl: 'https://advwebsaprod0.blob.core.windows.net/property-images/x/1.jpg',
  status: 'available',
  bullets: [],
  ...over,
});

// Counts fetches and returns a page with nothing useful on it (an SPA shell).
function countingFetcher() {
  const calls = [];
  return {
    calls,
    fetchLotPage: async (url) => {
      calls.push(url);
      return { html: '<html><body><div id="__next"></div></body></html>', url, source: 'crawlee' };
    },
  };
}

console.log("Test 1: never-deep skips an already-known lot, however gappy");
{
  const f = countingFetcher();
  // Deliberately gappy in EVERY way isGapFillTarget can detect.
  const lot = richApiLot({
    address: '', postcode: null, price: null, beds: null,
    tenure: null, propType: 'unknown', imageUrl: null,
  });
  await enrichLotsFromLotPages([lot], { fetchLotPage: f.fetchLotPage });
  assert(f.calls.length === 0, `zero detail fetches for a known never-deep lot (got ${f.calls.length})`);
}

console.log('\nTest 2: never-deep still deep-fetches a FIRST-CONTACT lot');
{
  const f = countingFetcher();
  const lot = richApiLot({ _isFirstContact: true });
  await enrichLotsFromLotPages([lot], { fetchLotPage: f.fetchLotPage });
  assert(f.calls.length === 1, `first-contact bypasses never-deep (got ${f.calls.length} fetches)`);
}

console.log('\nTest 3: never-deep and gap-fill genuinely differ (anti-dead-config)');
{
  // Same rich-API lot shape on a house with no EXTRACTION_PROFILE entry, so it
  // takes the default gap-fill policy. Missing condition/vacant make it a
  // gap-fill target — exactly what never-deep must NOT do.
  const f = countingFetcher();
  const lot = richApiLot({ house: 'anunconfiguredhouse', url: 'https://x.test/lot/1' });
  await enrichLotsFromLotPages([lot], { fetchLotPage: f.fetchLotPage });
  assert(getProfile('anunconfiguredhouse').policy === 'gap-fill', 'unconfigured house defaults to gap-fill');
  assert(f.calls.length === 1,
    `gap-fill DOES fetch the same lot never-deep skipped (got ${f.calls.length}) — if this is 1 and test 1 is 0, the policies differ`);
}

console.log('\nTest 4: never-deep is only configured on rich catalogues');
{
  const neverDeep = Object.entries(EXTRACTION_PROFILE).filter(([, p]) => p.policy === 'never-deep');
  assert(neverDeep.length > 0, `at least one never-deep house configured (got ${neverDeep.length})`);
  assert(neverDeep.every(([, p]) => p.catalogue === 'rich'),
    `every never-deep house has a rich catalogue (${neverDeep.map(([s, p]) => `${s}:${p.catalogue}`).join(' ')})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
