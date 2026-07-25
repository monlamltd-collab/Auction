/**
 * Pins house discovery classification used by next-sale automation.
 * Run: node tests/test-house-class.js
 */
import {
  classifyHouseForDiscovery,
  looksLikeRollingRootUrl,
  isRealUpcomingDate,
  isRealFutureOrDatedSale,
  summariseDiscoveryClasses,
} from '../lib/pipeline/house-class.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

const TODAY = '2026-07-25';

console.log('date helpers');
assert(isRealFutureOrDatedSale('2026-08-01', TODAY), 'real date');
assert(!isRealFutureOrDatedSale('2099-12-31', TODAY), 'sentinel not real');
assert(!isRealFutureOrDatedSale(null, TODAY), 'null not real');
assert(isRealUpcomingDate('2026-08-01', TODAY), 'future upcoming');
assert(!isRealUpcomingDate('2026-07-01', TODAY), 'past not upcoming');
assert(looksLikeRollingRootUrl('https://x.example/current-auction'), 'rolling current');
assert(looksLikeRollingRootUrl('https://x.example/properties/?search=1'), 'rolling search');
assert(!looksLikeRollingRootUrl('https://x.example/auctions/28-july-2026'), 'dated path not rolling-ish by itself via keyword?');
// dated paths may still match somehow - ensure plain host root is not rolling
assert(!looksLikeRollingRootUrl('https://www.example-auctions.co.uk/'), 'bare root not rolling');

console.log('\nretired');
{
  const r = classifyHouseForDiscovery({
    slug: 'markjenkinson',
    retired: true,
    rootUrl: 'https://example.com/',
    calendarRows: [{ status: 'always_on', date: '2099-12-31' }],
    todayIso: TODAY,
  });
  assert(r.class === 'retired', 'class retired');
  assert(r.needsNextSaleWatch === false, 'retired no watch');
  assert(r.reasons.includes('retired'), 'reason retired');
}

console.log('\nexplicit AUCTION_DISCOVERY / Cat B');
{
  const r = classifyHouseForDiscovery({
    slug: 'savills',
    rootUrl: 'https://auctions.savills.co.uk/upcoming-auctions',
    discoveryConfig: { homepage: 'https://auctions.savills.co.uk/upcoming-auctions' },
    calendarRows: [{ status: 'always_on', date: '2099-12-31' }],
    todayIso: TODAY,
  });
  assert(r.class === 'traditional_rotating', 'catB → rotating');
  assert(r.needsNextSaleWatch === true, 'catB needs watch');
  assert(r.reasons.includes('explicit_auction_discovery_config'), 'explicit reason');
}

console.log('\nAH platform family');
{
  const r = classifyHouseForDiscovery({
    slug: 'auctionhousenorthwest',
    rootUrl: 'https://www.auctionhouse.co.uk/northwest/',
    platformHints: { ah: true },
    calendarRows: [{ status: 'always_on', date: '2099-12-31' }],
    todayIso: TODAY,
  });
  assert(r.class === 'traditional_rotating', 'AH → rotating');
  assert(r.needsNextSaleWatch === true, 'AH needs watch');
  assert(r.signals.platform === 'ah', 'platform ah');
}

console.log('\nEIG family');
{
  const r = classifyHouseForDiscovery({
    slug: 'fssproperty',
    rootUrl: 'https://www.fsspropertyauctions.co.uk/',
    platformHints: { eig: true },
    calendarRows: [{ status: 'always_on', date: '2099-12-31' }],
    todayIso: TODAY,
  });
  assert(r.class === 'traditional_rotating', 'EIG → rotating');
  assert(r.needsNextSaleWatch === true, 'EIG needs watch');
}

console.log('\ncalendar real upcoming → rotating');
{
  const r = classifyHouseForDiscovery({
    slug: 'robinsonhall',
    rootUrl: 'https://robinsonandhallauctions.co.uk/auctions/available-lots',
    calendarRows: [
      { status: 'upcoming', date: '2026-08-05', catalogue_ready: true },
    ],
    todayIso: TODAY,
  });
  assert(r.class === 'traditional_rotating', 'dated upcoming → rotating');
  assert(r.needsNextSaleWatch === true, 'dated upcoming needs watch');
  assert(r.signals.hasRealUpcoming === true, 'signal upcoming');
}

console.log('\npure MMOA always_on rolling — no watch (must not thrash)');
{
  const r = classifyHouseForDiscovery({
    slug: 'futureauctions',
    rootUrl: 'https://www.futurepropertyauctions.co.uk/current-auctions/',
    calendarRows: [{ status: 'always_on', date: '2099-12-31', catalogue_ready: true }],
    todayIso: TODAY,
  });
  assert(r.class === 'mmoa', 'rolling always_on → mmoa');
  assert(r.needsNextSaleWatch === false, 'mmoa no next-sale AI watch');
  assert(r.signals.rollingRoot === true, 'rolling root detected');
}

console.log('\nalways_on only, no rolling keyword — still mmoa conservative');
{
  const r = classifyHouseForDiscovery({
    slug: 'somehouse',
    rootUrl: 'https://www.somehouseauctions.co.uk/',
    calendarRows: [{ status: 'always_on', date: '2099-12-31' }],
    todayIso: TODAY,
  });
  assert(r.class === 'mmoa', 'always_on only → mmoa');
  assert(r.needsNextSaleWatch === false, 'no watch');
}

console.log('\nhomepage next date on always_on promotes to rotating watch');
{
  const r = classifyHouseForDiscovery({
    slug: 'promoted',
    rootUrl: 'https://www.example.com/current-auction',
    calendarRows: [{ status: 'always_on', date: '2099-12-31' }],
    homepageWatch: { last_next_auction_date: '19 August 2026' },
    todayIso: TODAY,
  });
  assert(r.class === 'traditional_rotating', 'homepage date promotes class');
  assert(r.needsNextSaleWatch === true, 'homepage date enables watch');
  assert(r.reasons.includes('homepage_next_auction_date_present_on_always_on'), 'reason');
}

console.log('\nhomepage date changing');
{
  const r = classifyHouseForDiscovery({
    slug: 'changer',
    rootUrl: 'https://www.example.com/current-auction',
    calendarRows: [{ status: 'always_on', date: '2099-12-31' }],
    homepageWatch: {
      last_next_auction_date: '2026-09-01',
      prev_next_auction_date: '2026-08-01',
    },
    todayIso: TODAY,
  });
  assert(r.class === 'traditional_rotating', 'changing date → rotating');
  assert(r.reasons.includes('homepage_next_auction_date_changing'), 'changing reason');
}

console.log('\nstatic root no calendar dates → traditional_static watch (dark-capable)');
{
  const r = classifyHouseForDiscovery({
    slug: 'staticnew',
    rootUrl: 'https://www.regionalagent.co.uk/property-auctions/',
    calendarRows: [],
    todayIso: TODAY,
  });
  assert(r.class === 'traditional_static', 'static class');
  assert(r.needsNextSaleWatch === true, 'static dark needs watch');
}

console.log('\nunknown opportunistic');
{
  const r = classifyHouseForDiscovery({
    slug: 'weird',
    rootUrl: null,
    calendarRows: [],
    todayIso: TODAY,
  });
  assert(r.class === 'unknown', 'unknown class');
  assert(r.needsNextSaleWatch === true, 'unknown watch opportunistic');
}

console.log('\nsentinel-only calendar does not count as real dated');
{
  const r = classifyHouseForDiscovery({
    slug: 'x',
    rootUrl: 'https://x.com/current',
    calendarRows: [
      { status: 'upcoming', date: '2099-12-31' }, // junk
      { status: 'always_on', date: '2099-12-31' },
    ],
    todayIso: TODAY,
  });
  assert(r.signals.hasRealDatedCalendar === false, 'sentinel ignored for real dated');
  assert(r.class === 'mmoa', 'falls through to mmoa');
}

console.log('\nsummariseDiscoveryClasses');
{
  const s = summariseDiscoveryClasses([
    { slug: 'a', retired: true, todayIso: TODAY },
    {
      slug: 'b',
      rootUrl: 'https://x/current',
      calendarRows: [{ status: 'always_on', date: '2099-12-31' }],
      todayIso: TODAY,
    },
    {
      slug: 'c',
      discoveryConfig: {},
      todayIso: TODAY,
    },
  ]);
  assert(s.total === 3, 'total 3');
  assert(s.byClass.retired === 1, '1 retired');
  assert(s.byClass.mmoa === 1, '1 mmoa');
  assert(s.byClass.traditional_rotating === 1, '1 rotating');
  assert(s.needsWatch === 1, 'only catB needs watch among three');
  assert(s.noWatch === 2, 'two no watch');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
