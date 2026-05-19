/**
 * Backlog-digest card-builder tests
 * =================================
 * Covers buildBacklogCardForAlert — the pure function that turns a stale
 * pipeline_alerts row into a Telegram card. The query/send flow itself
 * (sendBacklogDigest) is exercised only at runtime against the real DB.
 *
 * Run: node tests/test-telegram-backlog.js
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://test.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { buildBacklogCardForAlert } = await import('../lib/pipeline/telegram-backlog.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

console.log('Test 1: buildBacklogCardForAlert returns null without id');
{
  assert(buildBacklogCardForAlert(null) === null, 'null alert → null');
  assert(buildBacklogCardForAlert({}) === null, 'alert with no id → null');
}

console.log('\nTest 2: drift alert with candidate URL gets Apply + Re-heal + Snooze + Dismiss');
{
  const card = buildBacklogCardForAlert({
    id: 'a1',
    event_type: 'house_url_drift_detected',
    house: 'savills',
    message: 'Homepage now points at a different catalogue URL: https://savills.co.uk/new',
    meta: { from: 'https://savills.co.uk/old', to: 'https://savills.co.uk/new', sameDomain: true },
    created_at: FIVE_DAYS_AGO,
  });
  assert(card !== null, 'card returned');
  assert(/URL drift/.test(card.message), 'labelled as URL drift');
  assert(/5d old/.test(card.message), 'age label rendered');
  const cbs = card.buttons.flat().map(b => b.callback_data);
  assert(cbs.includes('accept:a1'), 'accept callback present (candidate URL exists)');
  assert(cbs.includes('rerun:a1'), 'rerun callback present (has slug)');
  assert(cbs.includes('snooze:a1') && cbs.includes('dismiss:a1'), 'snooze + dismiss always present');
}

console.log('\nTest 3: parked alert with no candidate URL skips Apply button');
{
  const card = buildBacklogCardForAlert({
    id: 'p1',
    event_type: 'house_domain_parked',
    house: 'dead',
    message: 'Homepage looks parked.',
    meta: {},
    created_at: FIVE_DAYS_AGO,
  });
  const cbs = card.buttons.flat().map(b => b.callback_data);
  assert(!cbs.includes('accept:p1'), 'no accept (no candidate URL)');
  assert(cbs.includes('rerun:p1'), 'rerun still present (has slug)');
  assert(cbs.includes('snooze:p1') && cbs.includes('dismiss:p1'), 'snooze + dismiss');
}

console.log('\nTest 4: system-level alert (no slug) only gets Snooze + Dismiss');
{
  const card = buildBacklogCardForAlert({
    id: 's1',
    event_type: 'healing_failed',
    house: null,
    message: 'something system-wide',
    meta: {},
    created_at: FIVE_DAYS_AGO,
  });
  const cbs = card.buttons.flat().map(b => b.callback_data);
  assert(!cbs.includes('accept:s1'), 'no accept');
  assert(!cbs.includes('rerun:s1'), 'no rerun (no slug to clear cooldown for)');
  assert(cbs.includes('snooze:s1') && cbs.includes('dismiss:s1'), 'snooze + dismiss');
}

console.log('\nTest 5: long message gets truncated');
{
  const longMsg = 'x'.repeat(500);
  const card = buildBacklogCardForAlert({
    id: 't1',
    event_type: 'house_domain_parked',
    house: 'x',
    message: longMsg,
    meta: {},
    created_at: FIVE_DAYS_AGO,
  });
  assert(card.message.includes('…'), 'truncation indicator present');
  assert(!card.message.includes(longMsg), 'full message not present (was truncated)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
