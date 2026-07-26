/**
 * Dry-run watcher must not mutate process-local coordination state.
 * Run: node tests/test-watcher-dryrun-coordination.js
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const {
  setWatcherHandledSlugs,
  getWatcherHandledSlugs,
  clearWatcherHandledSlugs,
} = await import('../lib/pipeline/cycle-coordination.js');
const { watchAuctionCalendar } = await import('../lib/pipeline/auction-watcher.js');
const { evaluateDiscoveryEligibility } = await import('../lib/pipeline/discovery-eligibility.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

clearWatcherHandledSlugs();
setWatcherHandledSlugs(['seed-house']);
const before = [...getWatcherHandledSlugs()].sort();

const summary = await watchAuctionCalendar({
  slugs: ['mchughandco'],
  dryRun: true,
  skipAi: true,
  expandEnabled: false,
  force: true,
  concurrency: 1,
});

const after = [...getWatcherHandledSlugs()].sort();
assert(JSON.stringify(before) === JSON.stringify(after), 'dry-run leaves watcher-handled coordination unchanged');
assert(Array.isArray(summary.handledSlugs), 'dry-run still returns a handledSlugs report field');

// Real discovery eligibility must still see the pre-seeded handled slug, not a
// dry-run-cleared empty set.
const e = evaluateDiscoveryEligibility({
  slug: 'seed-house',
  todayIso: '2026-07-25',
  handledByWatcherThisCycle: getWatcherHandledSlugs().has('seed-house'),
  calendarRows: [],
  classifyInput: { slug: 'seed-house', discoveryConfig: {}, calendarRows: [] },
});
assert(e.eligible === false && e.bucket === 'watcher_handled', 'seeded handled slug still blocks real discovery after dry-run');

clearWatcherHandledSlugs();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
