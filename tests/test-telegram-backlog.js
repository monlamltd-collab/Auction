/**
 * Backlog-digest card-builder + filter tests
 * Run: node tests/test-telegram-backlog.js
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://test.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
delete process.env.BACKLOG_DIGEST_ENABLED;

const {
  buildBacklogCardForAlert,
  isDigestWorthyAlert,
  isBacklogDigestEnabled,
  sendBacklogDigest,
  candidateUrlOf,
} = await import('../lib/pipeline/telegram-backlog.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
const SEVENTY_FIVE_DAYS_AGO = new Date(Date.now() - 75 * 24 * 60 * 60 * 1000).toISOString();
const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

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
  assert(/Candidate: https:\/\/savills\.co\.uk\/new/.test(card.message), 'candidate shown');
  const cbs = card.buttons.flat().map(b => b.callback_data);
  assert(cbs.includes('accept:a1'), 'accept callback present (candidate URL exists)');
  assert(cbs.includes('rerun:a1'), 'rerun callback present (has slug)');
  assert(cbs.includes('snooze:a1') && cbs.includes('dismiss:a1'), 'snooze + dismiss always present');
}

console.log('\nTest 3: parked alerts are never carded');
{
  const card = buildBacklogCardForAlert({
    id: 'p1',
    event_type: 'house_domain_parked',
    house: 'romanway',
    message: 'Homepage looks parked.',
    meta: {},
    created_at: FIVE_DAYS_AGO,
  });
  assert(card === null, 'parked → no card');
  assert(isDigestWorthyAlert({
    id: 'p1', event_type: 'house_domain_parked', house: 'romanway',
    created_at: FIVE_DAYS_AGO, meta: {},
  }) === false, 'parked not digest-worthy');
}

console.log('\nTest 4: merger with null candidate is NOT digest-worthy / no card');
{
  const alert = {
    id: 'm1',
    event_type: 'house_merger_suspected',
    house: 'driversnorris',
    message: 'possible merger or rebrand: null',
    meta: { to: null, candidate_url: null },
    created_at: FIVE_DAYS_AGO,
  };
  assert(candidateUrlOf(alert) === null, 'null candidate rejected');
  assert(isDigestWorthyAlert(alert) === false, 'null-URL merger filtered');
  assert(buildBacklogCardForAlert(alert) === null, 'null-URL merger not carded');
}

console.log('\nTest 5: 75-day-old drift is filtered even with candidate');
{
  const alert = {
    id: 'old1',
    event_type: 'house_url_drift_detected',
    house: 'regionalauctioneers',
    message: 'Homepage now points at catalogue',
    meta: { to: 'https://example.com/catalogue' },
    created_at: SEVENTY_FIVE_DAYS_AGO,
  };
  assert(isDigestWorthyAlert(alert) === false, '75d old filtered');
}

console.log('\nTest 6: too-fresh alert filtered');
{
  const alert = {
    id: 'fresh1',
    event_type: 'house_url_drift_detected',
    house: 'savills',
    meta: { to: 'https://example.com/x' },
    created_at: TWO_HOURS_AGO,
  };
  assert(isDigestWorthyAlert(alert) === false, '2h old still too fresh');
}

console.log('\nTest 7: digest disabled by default');
{
  assert(isBacklogDigestEnabled() === false, 'BACKLOG_DIGEST_ENABLED default off');
  const r = await sendBacklogDigest({}, {
    sendActionableCard: async () => ({ messageId: 1 }),
    sendTelegram: async () => {},
  });
  assert(r.reason === 'disabled' && r.sent === 0, 'sendBacklogDigest no-ops when disabled');
}

console.log('\nTest 8: long message gets truncated when card builds');
{
  const longMsg = 'x'.repeat(500);
  // use non-parked type with no URL requirement — healing_failed without slug
  // still needs candidate if URL_FIXABLE... healing_failed is URL_FIXABLE.
  // Use house_no_longer_auction which is actionable but not URL_FIXABLE? 
  // Actually house_no_longer_auction is in set and not in URL_FIXABLE_TYPES.
  const card = buildBacklogCardForAlert({
    id: 't1',
    event_type: 'house_no_longer_auction',
    house: 'x',
    message: longMsg,
    meta: {},
    created_at: FIVE_DAYS_AGO,
  });
  assert(card !== null, 'no-longer-auction card builds');
  assert(card.message.includes('…'), 'truncation indicator present');
  assert(!card.message.includes(longMsg), 'full message not present (was truncated)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
