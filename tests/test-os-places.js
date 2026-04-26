/**
 * OS Places Client Test Suite
 * ===========================
 * Tests the OS Data Hub Places API wrapper: input gating, status vocabulary,
 * circuit breaker behaviour, and cache short-circuit.
 *
 * Network is stubbed via global fetch mocking — no real OS API calls.
 *
 * Run: node tests/test-os-places.js
 */

// Provide dummy Supabase env so the supabase client (imported by os-places.js)
// doesn't throw at module load. We don't exercise the cache path in these tests.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { lookupAddress, getCircuitStatus, _resetCircuitForTest } = await import('../lib/os-places.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const realFetch = global.fetch;
function stubFetch(impl) { global.fetch = impl; }
function restoreFetch() { global.fetch = realFetch; }

async function run() {
  console.log('\n═══ OS Places client ═══\n');

  // ── Input gating ──────────────────────────────────────────────
  console.log('Input gating:');
  {
    const r = await lookupAddress({ address: '', postcode: 'EX18 7DP' });
    assert(r.status === 'skipped_no_address', 'empty address → skipped_no_address');
  }
  {
    const r = await lookupAddress({ address: 'A', postcode: 'EX18 7DP' });
    assert(r.status === 'skipped_no_address', 'tiny address → skipped_no_address');
  }
  {
    const prev = process.env.OS_DATA_HUB_KEY;
    delete process.env.OS_DATA_HUB_KEY;
    const r = await lookupAddress({ address: '12 Test Street', postcode: 'EX18 7DP' });
    assert(r.status === 'skipped_no_creds', 'missing key → skipped_no_creds');
    if (prev) process.env.OS_DATA_HUB_KEY = prev;
  }

  // ── Successful lookup ────────────────────────────────────────
  console.log('\nSuccessful lookup:');
  {
    process.env.OS_DATA_HUB_KEY = 'test-key';
    _resetCircuitForTest();
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          DPA: {
            UPRN: '100040217919',
            ADDRESS: '12, TEST STREET, EXAMPLE, EX18 7DP',
            CLASSIFICATION_CODE: 'RD',
            LAT: 50.9123,
            LNG: -3.8456,
            MATCH: '0.92',
          },
        }],
      }),
    }));
    const r = await lookupAddress({ address: '12 Test Street', postcode: 'EX18 7DP' });
    assert(r.status === 'ok', 'happy path → ok');
    assert(r.uprn === '100040217919', 'UPRN extracted');
    assert(r.lat === 50.9123 && r.lng === -3.8456, 'lat/lng extracted');
    assert(r.matchScore >= 0.9, 'match score plumbed through');
    restoreFetch();
  }

  // ── Low confidence rejection ─────────────────────────────────
  console.log('\nLow-confidence rejection:');
  {
    _resetCircuitForTest();
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ DPA: { UPRN: '1', ADDRESS: 'X', MATCH: '0.15' } }] }),
    }));
    const r = await lookupAddress({ address: 'something vague', postcode: 'EX18 7DP' });
    assert(r.status === 'low_confidence', 'score < 0.3 → low_confidence');
    assert(!r.uprn, 'no UPRN returned for low-confidence match');
    restoreFetch();
  }

  // ── No match ─────────────────────────────────────────────────
  console.log('\nNo match:');
  {
    _resetCircuitForTest();
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
    const r = await lookupAddress({ address: 'nowhere road', postcode: 'EX18 7DP' });
    assert(r.status === 'no_match', 'empty results → no_match');
    restoreFetch();
  }

  // ── HTTP error + circuit breaker ─────────────────────────────
  console.log('\nHTTP error + circuit breaker:');
  {
    _resetCircuitForTest();
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const r1 = await lookupAddress({ address: '12 Test Street', postcode: 'EX18 7DP' });
    const r2 = await lookupAddress({ address: '12 Test Street', postcode: 'EX18 7DP' });
    const r3 = await lookupAddress({ address: '12 Test Street', postcode: 'EX18 7DP' });
    assert(r1.status === 'api_error' && r1.httpStatus === 500, 'first 500 → api_error');
    assert(r2.status === 'api_error', 'second 500 → api_error');
    assert(r3.status === 'api_error', 'third 500 → api_error');
    const status = getCircuitStatus();
    assert(status.open, 'circuit is open after 3 failures');

    // Next call should short-circuit
    const r4 = await lookupAddress({ address: '12 Test Street', postcode: 'EX18 7DP' });
    assert(r4.status === 'circuit_open', '4th call returns circuit_open');
    restoreFetch();
    _resetCircuitForTest();
  }

  console.log(`\n══════════════════════════════════`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
