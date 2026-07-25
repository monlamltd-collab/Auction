/**
 * Watcher horizon helpers (Task 5)
 * Run: node tests/test-watcher-horizon.js
 */
import {
  getUpcomingHorizon,
  pickHorizonUpserts,
  DEFAULT_HORIZON_DAYS,
} from '../lib/pipeline/watcher-horizon.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-25';

console.log('getUpcomingHorizon');
{
  const empty = getUpcomingHorizon([], { todayIso: TODAY });
  assert(empty.needsRefresh === true && empty.reasons.includes('no_upcoming'), 'empty needs refresh');

  const healthy = getUpcomingHorizon([
    { status: 'upcoming', date: '2026-08-18', catalogue_ready: true, url: 'https://x/a' },
  ], { todayIso: TODAY, horizonDays: 56 });
  assert(healthy.needsRefresh === false, 'ready in horizon OK');
  assert(healthy.hasReadyInHorizon === true, 'ready flag');
  assert(healthy.nearestDate === '2026-08-18', 'nearest');

  const notReady = getUpcomingHorizon([
    { status: 'upcoming', date: '2026-08-18', catalogue_ready: false, url: 'https://x/a' },
  ], { todayIso: TODAY });
  assert(notReady.needsRefresh === true, 'not ready needs refresh');
  assert(notReady.reasons.includes('upcoming_not_ready') || notReady.reasons.includes('horizon_not_ready'), 'reason not ready');

  const beyond = getUpcomingHorizon([
    { status: 'upcoming', date: '2027-01-15', catalogue_ready: true, url: 'https://x/a' },
  ], { todayIso: TODAY, horizonDays: 56 });
  assert(beyond.needsRefresh === false, 'ready beyond horizon still OK');
  assert(beyond.hasReadyInHorizon === false, 'not in horizon');
  assert(beyond.hasReady === true, 'has ready overall');

  const ignoresAlwaysOn = getUpcomingHorizon([
    { status: 'always_on', date: '2099-12-31', catalogue_ready: true, url: 'https://x/root' },
    { status: 'upcoming', date: '2026-07-01', catalogue_ready: true, url: 'https://x/old' }, // past
  ], { todayIso: TODAY });
  assert(ignoresAlwaysOn.needsRefresh === true, 'always_on + past only → still needs upcoming');
  assert(ignoresAlwaysOn.count === 0, 'no real upcoming counted');
}

console.log('\npickHorizonUpserts');
{
  const picks = pickHorizonUpserts([
    { url: 'https://x/past', date: '2024-01-01' },
    { url: 'https://x/b', date: '2026-09-01' },
    { url: 'https://x/a', date: '2026-08-01' },
    { url: 'https://x/a', date: '2026-08-01' }, // dup url
    { url: 'https://x/u' }, // undated
    { url: 'https://x/c', date: '2026-10-01' },
  ], { todayIso: TODAY, max: 3 });
  assert(picks.length === 3, 'max 3');
  assert(picks[0].url === 'https://x/a', 'soonest dated first');
  assert(picks[1].url === 'https://x/b', 'second');
  assert(picks[2].url === 'https://x/c', 'third dated before undated when enough dated');
  assert(DEFAULT_HORIZON_DAYS === 56, 'default 56');

  const withUndated = pickHorizonUpserts([
    { url: 'https://x/u' },
    { url: 'https://x/a', date: '2026-08-01' },
  ], { todayIso: TODAY, max: 3 });
  assert(withUndated[0].date === '2026-08-01', 'dated before undated');
  assert(withUndated[1].url === 'https://x/u', 'undated second');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
