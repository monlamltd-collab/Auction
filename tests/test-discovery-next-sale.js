/**
 * Discovery next-sale eligibility (Task 4)
 * Run: node tests/test-discovery-next-sale.js
 */
import {
  evaluateDiscoveryEligibility,
  selectDiscoveryTargets,
  DEFAULT_RECHECK_DAYS,
} from '../lib/pipeline/discovery-eligibility.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-25';

console.log('retired / mmoa skipped');
{
  const retired = evaluateDiscoveryEligibility({
    slug: 'gone',
    todayIso: TODAY,
    classifyInput: { slug: 'gone', retired: true },
  });
  assert(retired.eligible === false && retired.bucket === 'retired', 'retired skip');

  const mmoa = evaluateDiscoveryEligibility({
    slug: 'sdva',
    todayIso: TODAY,
    calendarRows: [
      { status: 'always_on', date: '2099-12-31', catalogue_ready: true, url: 'https://x/current' },
    ],
    classifyInput: {
      slug: 'sdva',
      rootUrl: 'https://example.com/current-auctions',
      calendarRows: [
        { status: 'always_on', date: '2099-12-31', catalogue_ready: true, url: 'https://x/current' },
      ],
    },
  });
  assert(mmoa.eligible === false, 'mmoa no watch');
  assert(mmoa.classification.class === 'mmoa', 'class mmoa');
}

console.log('\nalready on calendar but unhealthy → still eligible');
{
  const e = evaluateDiscoveryEligibility({
    slug: 'allsop',
    todayIso: TODAY,
    calendarRows: [
      { status: 'upcoming', date: '2026-08-10', catalogue_ready: false, url: 'https://x/a' },
    ],
    classifyInput: {
      slug: 'allsop',
      discoveryConfig: { homepage: 'https://www.allsop.co.uk/' },
      calendarRows: [
        { status: 'upcoming', date: '2026-08-10', catalogue_ready: false, url: 'https://x/a' },
      ],
    },
  });
  assert(e.eligible === true, 'unhealthy upcoming still eligible');
  assert(e.bucket === 'unhealthy' || e.bucket === 'dark', 'unhealthy bucket');
}

console.log('\ndark traditional eligible high priority');
{
  const e = evaluateDiscoveryEligibility({
    slug: 'maggsandallen',
    todayIso: TODAY,
    calendarRows: [],
    classifyInput: {
      slug: 'maggsandallen',
      discoveryConfig: { platform: 'eig-whitelabel' },
      calendarRows: [],
    },
  });
  assert(e.eligible === true && e.bucket === 'dark', 'dark eligible');
  assert(e.priority >= 90, 'high priority');
}

console.log('\nhealthy + recent recheck skip');
{
  const e = evaluateDiscoveryEligibility({
    slug: 'savills',
    todayIso: TODAY,
    lastDiscoveryAt: '2026-07-24T12:00:00.000Z',
    calendarRows: [
      { status: 'upcoming', date: '2026-09-01', catalogue_ready: true, url: 'https://x/a' },
      { status: 'upcoming', date: '2026-10-01', catalogue_ready: true, url: 'https://x/b' },
    ],
    classifyInput: {
      slug: 'savills',
      discoveryConfig: {},
      calendarRows: [
        { status: 'upcoming', date: '2026-09-01', catalogue_ready: true, url: 'https://x/a' },
        { status: 'upcoming', date: '2026-10-01', catalogue_ready: true, url: 'https://x/b' },
      ],
    },
  });
  assert(e.eligible === false, 'healthy skip');
  assert(e.bucket === 'healthy_skip', 'healthy_skip bucket');
}

console.log('\nsingle sale weekly recheck when stale');
{
  const e = evaluateDiscoveryEligibility({
    slug: 'savills',
    todayIso: TODAY,
    lastDiscoveryAt: '2026-07-01',
    recheckDays: DEFAULT_RECHECK_DAYS,
    calendarRows: [
      { status: 'upcoming', date: '2026-09-15', catalogue_ready: true, url: 'https://x/a' },
    ],
    classifyInput: {
      slug: 'savills',
      discoveryConfig: {},
      calendarRows: [
        { status: 'upcoming', date: '2026-09-15', catalogue_ready: true, url: 'https://x/a' },
      ],
    },
  });
  assert(e.eligible === true && e.bucket === 'recheck', 'weekly recheck single sale');
}

console.log('\nwatcher handled skips');
{
  const e = evaluateDiscoveryEligibility({
    slug: 'maggsandallen',
    todayIso: TODAY,
    handledByWatcherThisCycle: true,
    calendarRows: [],
    classifyInput: {
      slug: 'maggsandallen',
      discoveryConfig: {},
      calendarRows: [],
    },
  });
  assert(e.eligible === false && e.bucket === 'watcher_handled', 'watcher skip');
}

console.log('\nbudget select prioritises dark');
{
  const evals = [
    { slug: 'a', eligible: true, priority: 50, bucket: 'recheck' },
    { slug: 'b', eligible: true, priority: 95, bucket: 'dark' },
    { slug: 'c', eligible: true, priority: 90, bucket: 'dark' },
    { slug: 'd', eligible: true, priority: 55, bucket: 'recheck' },
    { slug: 'e', eligible: false, priority: 0, bucket: 'healthy_skip' },
  ];
  const sel = selectDiscoveryTargets(evals, { darkBudget: 1, recheckBudget: 1 });
  assert(sel.selected.length === 2, 'two selected');
  assert(sel.selected[0].slug === 'b', 'dark first by priority');
  assert(sel.darkUsed === 1 && sel.recheckUsed === 1, 'budgets applied');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
