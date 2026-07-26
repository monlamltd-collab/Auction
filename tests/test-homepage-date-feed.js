/**
 * Homepage date feed scorer (Task 7)
 * Run: node tests/test-homepage-date-feed.js
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const {
  scoreHomepageDateCandidate,
  buildHomepageDateCandidates,
  AUTO_UPSERT_MIN,
  MEDIUM_MIN,
} = await import('../lib/pipeline/homepage-date-feed.js');
const { parseUkDate } = await import('../lib/utils/auction-date-parse.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-25';

console.log('parseUkDate shared');
assert(parseUkDate('19 May 2026') === '2026-05-19', '19 May 2026');
assert(parseUkDate('Wednesday 14th May 2026') === '2026-05-14', 'ordinal weekday');
assert(parseUkDate('2026-08-01') === '2026-08-01', 'iso passthrough');

console.log('\nhigh confidence same-domain future');
{
  const c = scoreHomepageDateCandidate({
    slug: 'maggsandallen',
    rootUrl: 'https://www.maggsandallen.co.uk/',
    catalogueUrl: 'https://www.maggsandallen.co.uk/search-auction-aug/',
    nextAuctionDateRaw: '12 August 2026',
    todayIso: TODAY,
    houseClass: 'traditional_rotating',
    needsNextSaleWatch: true,
    calendarRows: [],
    healVerdict: { ok: true },
  });
  assert(c.confidence >= AUTO_UPSERT_MIN, `conf ${c.confidence} >= 80`);
  assert(c.action === 'auto_upsert', 'auto_upsert');
  assert(c.date === '2026-08-12', 'parsed date');
}

console.log('\ncross-domain not auto');
{
  const c = scoreHomepageDateCandidate({
    slug: 'x',
    rootUrl: 'https://www.example.com/',
    catalogueUrl: 'https://other.com/catalogue',
    nextAuctionDateRaw: '2026-08-12',
    todayIso: TODAY,
    houseClass: 'traditional_rotating',
    needsNextSaleWatch: true,
    healVerdict: { ok: true },
  });
  assert(c.action !== 'auto_upsert', 'no auto cross-domain');
}

console.log('\nlot url rejected');
{
  const c = scoreHomepageDateCandidate({
    slug: 'x',
    rootUrl: 'https://www.example.com/',
    catalogueUrl: 'https://www.example.com/lot/12345',
    nextAuctionDateRaw: '2026-08-12',
    todayIso: TODAY,
  });
  assert(c.action === 'skip', 'lot skip');
  assert(c.reasons.includes('lot_level_url'), 'lot reason');
}

console.log('\nmedium without heal');
{
  const c = scoreHomepageDateCandidate({
    slug: 'savills',
    rootUrl: 'https://auctions.savills.co.uk/',
    catalogueUrl: 'https://auctions.savills.co.uk/auctions/next',
    nextAuctionDateRaw: '2026-09-01',
    todayIso: TODAY,
    houseClass: 'traditional_rotating',
    needsNextSaleWatch: true,
    calendarRows: [],
  });
  assert(c.confidence >= MEDIUM_MIN, `medium conf ${c.confidence}`);
  // without heal +40 domain +25 date +10 dark = 75 → ready_to_apply or auto if ≥80
  assert(['auto_upsert', 'ready_to_apply'].includes(c.action), `action ${c.action}`);
}

console.log('\nretired skip');
{
  const c = scoreHomepageDateCandidate({
    slug: 'pugh',
    retired: true,
    catalogueUrl: 'https://x.com',
    nextAuctionDateRaw: '2026-08-01',
    todayIso: TODAY,
  });
  assert(c.action === 'skip', 'retired skip');
}

console.log('\nbuild list');
{
  const list = buildHomepageDateCandidates([
    {
      slug: 'demo',
      last_extracted_catalogue_url: 'https://demo.example/search-auction/',
      last_next_auction_date: '1 September 2026',
    },
  ], {
    todayIso: TODAY,
    houseRoots: { demo: 'https://demo.example/' },
    calendarBySlug: {},
  });
  assert(list.length === 1, 'one candidate');
  assert(list[0].date === '2026-09-01', 'built date');
}

console.log('\nstrict watcher ownership');
{
  const list = buildHomepageDateCandidates([{
    slug: 'mchughandco',
    last_extracted_catalogue_url: 'https://mchughandco.com/current-auction',
    last_next_auction_date: '16 September 2026',
  }], {
    todayIso: TODAY,
    calendarBySlug: {},
  });
  assert(list[0].action === 'record', 'homepage feed cannot bypass McHugh date+lot verification');
  assert(list[0].reasons.includes('strict_watcher_verification_required'), 'strict-owner reason recorded');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
