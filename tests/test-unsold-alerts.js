/**
 * Unsold-alerts cycle tests
 * =========================
 * Covers lib/pipeline/unsold-alerts.js — extracted 2026-06-10 from
 * routes/auth.js and wired into scheduleTick Tier 19 (the endpoint was
 * fully built in April but nothing ever called it).
 *
 * Run: node tests/test-unsold-alerts.js
 */

// lib/email.js (imported for the AB email helpers) transitively constructs
// the Supabase client, which validates env at module load. Stub the env
// before a dynamic import so the test runs without real credentials.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'stub-anon-key';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'stub-service-key';
const { runUnsoldAlertsCycle } = await import('../lib/pipeline/unsold-alerts.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Chainable thenable stub mirroring the supabase-js query builder surface
// the cycle touches: from().select().eq().or().limit(), from().select().in(),
// from().update().eq().
function stubSupabase({ alerts = [], alertsError = null, users = [], lots = [] } = {}) {
  const updates = [];
  const calls = [];
  function from(table) {
    calls.push(table);
    const state = { table, op: 'select', payload: null, id: null };
    const b = {
      select() { return b; },
      update(payload) { state.op = 'update'; state.payload = payload; return b; },
      eq(col, val) { if (state.op === 'update' && col === 'id') state.id = val; return b; },
      or() { return b; },
      in() { return b; },
      limit() { return b; },
      then(resolve) {
        if (state.op === 'update') {
          updates.push({ table, id: state.id, payload: state.payload });
          return resolve({ data: null, error: null });
        }
        if (table === 'unsold_alerts') return resolve({ data: alerts, error: alertsError });
        if (table === 'users') return resolve({ data: users, error: null });
        if (table === 'lots') return resolve({ data: lots, error: null });
        return resolve({ data: null, error: null });
      },
    };
    return b;
  }
  return { from, _updates: updates, _calls: calls };
}

function withResendKey(value, fn) {
  const prev = process.env.RESEND_API_KEY;
  if (value === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prev;
  });
}

const LOT_ROW = {
  house: 'savills', url: 'https://example.com/lot/1',
  address: '1 Test Street, Leeds', postcode: 'LS1 1AA',
  price: 150000, status: 'unsold', auction_date: '2026-06-01',
};

// ── Test 1: no RESEND_API_KEY → skipped, zero queries ──
console.log('Test 1: missing RESEND_API_KEY short-circuits');
await withResendKey(undefined, async () => {
  const sb = stubSupabase();
  const r = await runUnsoldAlertsCycle(sb);
  assert(r.sent === 0 && r.skipped, 'returns sent=0 with skipped reason');
  assert(sb._calls.length === 0, 'no supabase queries issued');
});

// ── Test 2: no due alerts → sent 0 ──
console.log('\nTest 2: zero due alerts');
await withResendKey('test-key', async () => {
  const sb = stubSupabase({ alerts: [] });
  const r = await runUnsoldAlertsCycle(sb);
  assert(r.sent === 0 && r.total === 0, 'sent=0 total=0');
});

// ── Test 3: one alert + matching lot → one email + last_sent_at advanced ──
console.log('\nTest 3: happy path sends and stamps last_sent_at');
await withResendKey('test-key', async () => {
  const fetched = [];
  const fetchFn = async (url, opts) => { fetched.push({ url, opts }); return { ok: true }; };
  const sb = stubSupabase({
    alerts: [{ id: 'a1', user_id: 'u1', filters: {}, frequency: 'daily', last_sent_at: null }],
    users: [{ id: 'u1', email: 'simon@example.com', name: 'Simon D' }],
    lots: [LOT_ROW],
  });
  const r = await runUnsoldAlertsCycle(sb, { fetchFn });
  assert(r.sent === 1 && r.total === 1, 'one alert sent');
  assert(fetched.length === 1 && fetched[0].url.includes('api.resend.com'), 'Resend called once');
  const body = JSON.parse(fetched[0].opts.body);
  assert(body.to[0] === 'simon@example.com', 'addressed to the subscriber');
  assert(/Unsold Lot Alert/.test(body.html), 'email body rendered');
  assert(sb._updates.length === 1 && sb._updates[0].id === 'a1' && sb._updates[0].payload.last_sent_at, 'last_sent_at stamped');
});

// ── Test 4: filters exclude everything → no email, no stamp ──
console.log('\nTest 4: non-matching filters skip the send');
await withResendKey('test-key', async () => {
  const fetched = [];
  const fetchFn = async (url, opts) => { fetched.push({ url, opts }); return { ok: true }; };
  const sb = stubSupabase({
    alerts: [{ id: 'a1', user_id: 'u1', filters: { minPrice: 99000000 }, frequency: 'daily', last_sent_at: null }],
    users: [{ id: 'u1', email: 'simon@example.com', name: 'Simon D' }],
    lots: [LOT_ROW],
  });
  const r = await runUnsoldAlertsCycle(sb, { fetchFn });
  assert(r.sent === 0 && r.total === 1, 'alert considered but nothing sent');
  assert(fetched.length === 0, 'Resend not called');
  assert(sb._updates.length === 0, 'last_sent_at untouched');
});

// ── Test 5: alerts query error throws ──
console.log('\nTest 5: alerts query error propagates');
await withResendKey('test-key', async () => {
  const sb = stubSupabase({ alertsError: { message: 'boom' } });
  let threw = false;
  try { await runUnsoldAlertsCycle(sb); } catch { threw = true; }
  assert(threw, 'throws on alerts query error');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
