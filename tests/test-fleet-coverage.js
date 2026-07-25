/**
 * Fleet population coverage tests
 * Run: node tests/test-fleet-coverage.js
 */
import {
  analyseHouseSpine,
  scoreHousePopulation,
  computeFleetCoverage,
  formatFleetCoverageForTelegram,
  isFleetCoverageAlertsEnabled,
  buildFleetCoverageFromMaps,
  DEFAULT_HORIZON_DAYS,
} from '../lib/pipeline/fleet-coverage.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-25';
const HORIZON_END = '2026-09-19'; // 56 days from TODAY

console.log('analyseHouseSpine');
{
  const spine = analyseHouseSpine({
    calendarRows: [
      { status: 'always_on', date: '2099-12-31', catalogue_ready: true },
      { status: 'upcoming', date: '2026-08-05', catalogue_ready: true },
      { status: 'upcoming', date: '2026-12-01', catalogue_ready: false },
      { status: 'upcoming', date: '2025-01-01', catalogue_ready: true }, // past
    ],
    available_n: 10,
    avail_seen_7d: 4,
  }, { todayIso: TODAY, horizonEnd: HORIZON_END, freshDays: 7 });
  assert(spine.hasAlwaysOn === true, 'always_on detected');
  assert(spine.upcomingReal === 2, 'two real upcoming (past excluded, sentinel excluded)');
  assert(spine.upcomingReady === 1, 'one ready upcoming overall');
  assert(spine.upcomingInHorizon === 1, 'one in horizon');
  assert(spine.upcomingReadyInHorizon === 1, 'ready in horizon');
  assert(spine.nearestUpcoming === '2026-08-05', 'nearest');
  assert(spine.fresh === true, 'fresh via seen7');
}

console.log('\nscoreHousePopulation');
{
  const freshMmoa = scoreHousePopulation({
    discoveryClass: 'mmoa',
    spine: { fresh: true, availableN: 5, upcomingReadyInHorizon: 0, upcomingInHorizon: 0, upcomingReal: 0, upcomingReady: 0, hasAlwaysOn: true },
  });
  assert(freshMmoa.credit === 1 && !freshMmoa.dark, 'mmoa fresh full credit');

  const staleMmoa = scoreHousePopulation({
    discoveryClass: 'mmoa',
    spine: { fresh: false, availableN: 5, upcomingReadyInHorizon: 0, upcomingInHorizon: 0, upcomingReal: 0, upcomingReady: 0, hasAlwaysOn: true },
  });
  assert(staleMmoa.credit === 0 && staleMmoa.reason === 'stale_scrape', 'mmoa stale dark');

  const emptyExplained = scoreHousePopulation({
    discoveryClass: 'mmoa',
    spine: { fresh: false, availableN: 0, upcomingReadyInHorizon: 0, upcomingInHorizon: 0, upcomingReal: 0, upcomingReady: 0, hasAlwaysOn: true },
    explainedMissReason: 'no_stock_seasonal',
  });
  assert(emptyExplained.credit === 1 && !emptyExplained.dark, 'explained empty mmoa credit');

  const tradReady = scoreHousePopulation({
    discoveryClass: 'traditional_rotating',
    spine: { fresh: false, availableN: 0, upcomingReadyInHorizon: 1, upcomingInHorizon: 1, upcomingReal: 1, upcomingReady: 1, hasAlwaysOn: false },
  });
  assert(tradReady.credit === 1 && !tradReady.dark, 'trad ready horizon credit');

  const tradNotReady = scoreHousePopulation({
    discoveryClass: 'traditional_rotating',
    spine: { fresh: false, availableN: 0, upcomingReadyInHorizon: 0, upcomingInHorizon: 1, upcomingReal: 1, upcomingReady: 0, hasAlwaysOn: false },
  });
  assert(tradNotReady.reason === 'upcoming_not_ready', 'trad not ready');

  const tradDark = scoreHousePopulation({
    discoveryClass: 'traditional_rotating',
    spine: { fresh: false, availableN: 0, upcomingReadyInHorizon: 0, upcomingInHorizon: 0, upcomingReal: 0, upcomingReady: 0, hasAlwaysOn: false },
  });
  assert(tradDark.reason === 'no_upcoming_row', 'trad dark no row');

  const tradFreshNoUpcoming = scoreHousePopulation({
    discoveryClass: 'traditional_rotating',
    spine: { fresh: true, availableN: 20, upcomingReadyInHorizon: 0, upcomingInHorizon: 0, upcomingReal: 0, upcomingReady: 0, hasAlwaysOn: true },
  });
  assert(tradFreshNoUpcoming.credit === 1 && tradFreshNoUpcoming.dark === true, 'trad class with mmoa fresh still at-risk');
  assert(tradFreshNoUpcoming.reason === 'discover_miss', 'discover_miss reason');
}

console.log('\ncomputeFleetCoverage integration');
{
  const digest = computeFleetCoverage([
    {
      slug: 'futureauctions',
      rootUrl: 'https://example.com/current-auctions/',
      calendarRows: [{ status: 'always_on', date: '2099-12-31', catalogue_ready: true }],
      available_n: 100,
      avail_seen_7d: 80,
    },
    {
      slug: 'savills',
      rootUrl: 'https://auctions.savills.co.uk/upcoming-auctions',
      discoveryConfig: { homepage: 'x' },
      calendarRows: [
        { status: 'upcoming', date: '2026-08-18', catalogue_ready: true },
      ],
      available_n: 50,
      avail_seen_7d: 50,
    },
    {
      slug: 'maggsandallen',
      rootUrl: 'https://www.maggsandallen.co.uk/',
      discoveryConfig: { homepage: 'x', platform: 'eig-whitelabel' },
      calendarRows: [{ status: 'always_on', date: '2099-12-31', catalogue_ready: true }],
      available_n: 10,
      avail_seen_7d: 10,
    },
    {
      slug: 'mchughandco',
      rootUrl: 'https://mchughandco.com/',
      calendarRows: [
        { status: 'upcoming', date: '2026-09-16', catalogue_ready: false },
      ],
      available_n: 0,
      avail_seen_7d: 0,
    },
    {
      slug: 'retired-noise',
      retired: true,
      rootUrl: 'https://x/',
      calendarRows: [],
    },
    {
      slug: 'darktrad',
      rootUrl: 'https://regional.example/property-auctions/',
      calendarRows: [],
      available_n: 0,
      avail_seen_7d: 0,
    },
  ], { todayIso: TODAY, horizonDays: DEFAULT_HORIZON_DAYS });

  assert(digest.active_total === 5, 'retired excluded → 5 active');
  assert(digest.counts.mmoa_fresh === 1, 'one pure mmoa fresh');
  assert(digest.counts.trad_with_ready_horizon >= 1, 'savills ready horizon');
  assert(digest.dark_houses_total >= 2, 'at least maggs discover_miss + mchugh not ready + darktrad');
  assert(digest.scores.fleet_populate_score > 0, 'score positive');
  assert(digest.horizon_days === 56, 'default horizon 56');

  // ranking: no_upcoming / not_ready before discover_miss noise ideally
  const reasons = digest.dark_houses.map((d) => d.reason);
  assert(reasons.includes('upcoming_not_ready'), 'mchugh in dark list');
  assert(reasons.includes('no_upcoming_row') || reasons.includes('discover_miss'), 'trad gaps present');
}

console.log('\nformatFleetCoverageForTelegram');
{
  const digest = computeFleetCoverage([
    {
      slug: 'evil<script>',
      rootUrl: 'https://example.com/property-auctions/',
      calendarRows: [],
      available_n: 3,
      avail_seen_7d: 0,
    },
  ], { todayIso: TODAY });
  const html = formatFleetCoverageForTelegram(digest);
  assert(html.includes('fleet population') || html.includes('Fleet') || html.includes('🏗'), 'title present');
  assert(!html.includes('<script>'), 'raw script tag not present');
  assert(html.includes('<script>') || html.includes('evil'), 'slug escaped or present safely');
  assert(html.includes('Score:'), 'score line');
}

console.log('\nflag + maps builder');
{
  assert(isFleetCoverageAlertsEnabled({ FLEET_COVERAGE_ALERTS_ENABLED: 'true' }) === true, 'flag on');
  assert(isFleetCoverageAlertsEnabled({ FLEET_COVERAGE_ALERTS_ENABLED: '' }) === true, 'empty default on');
  assert(isFleetCoverageAlertsEnabled({}) === true, 'flag missing on');
  assert(isFleetCoverageAlertsEnabled({ FLEET_COVERAGE_ALERTS_ENABLED: 'false' }) === false, 'flag off');
  assert(isFleetCoverageAlertsEnabled({ FLEET_COVERAGE_ALERTS_ENABLED: '0' }) === false, '0 off');

  const dig = buildFleetCoverageFromMaps({
    houseRoots: {
      a: 'https://a.example/current',
      b: 'https://b.example/upcoming-auctions',
      dead: 'https://dead.example/',
    },
    retiredHouses: ['dead'],
    discoveryConfigs: { b: { homepage: 'x' } },
    ahSlugs: [],
    calendarBySlug: {
      a: [{ status: 'always_on', date: '2099-12-31', catalogue_ready: true }],
      b: [{ status: 'upcoming', date: '2026-08-01', catalogue_ready: true }],
    },
    lotsBySlug: {
      a: { available_n: 5, avail_seen_7d: 5 },
      b: { available_n: 2, avail_seen_7d: 2 },
    },
    options: { todayIso: TODAY },
  });
  // buildFleetCoverageFromMaps is async in module? I exported async function - need await
}

// await map builder
const dig = await buildFleetCoverageFromMaps({
  houseRoots: {
    a: 'https://a.example/current',
    b: 'https://b.example/upcoming-auctions',
    dead: 'https://dead.example/',
  },
  retiredHouses: ['dead'],
  discoveryConfigs: { b: { homepage: 'x' } },
  ahSlugs: [],
  calendarBySlug: {
    a: [{ status: 'always_on', date: '2099-12-31', catalogue_ready: true }],
    b: [{ status: 'upcoming', date: '2026-08-01', catalogue_ready: true }],
  },
  lotsBySlug: {
    a: { available_n: 5, avail_seen_7d: 5 },
    b: { available_n: 2, avail_seen_7d: 2 },
  },
  options: { todayIso: TODAY },
});
assert(dig.active_total === 2, 'maps builder active 2');
assert(dig.scores.fleet_populate_score === 100, 'both credit → 100');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
