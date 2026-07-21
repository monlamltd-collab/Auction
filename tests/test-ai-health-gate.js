/**
 * AI-outage gate on updateHealth().
 *
 * Regression test for the circuit "treadmill": when the AI stack goes quota-dead
 * every AI-dependent house returns 0 lots at once. Before this gate, each of
 * those zeros counted as a consecutive failure, so one outage tripped the whole
 * fleet's circuit breakers and took healthy houses OUT of the scrape rotation —
 * 46 circuits opened in the 2026-07-15 event, and 40 of them re-tripped within
 * 4 days of a manual SQL reset.
 *
 * A zero produced while extraction COULD NOT RUN says nothing about the house,
 * so it must be a non-event: health, circuit state and the failure counter all
 * unchanged. A zero produced while the AI was UP must still indict the house.
 *
 * Run: node tests/test-ai-health-gate.js
 */

import { initHouseHealth, updateHealth, getHealth } from '../lib/harness/house-health.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

function mockSupabase(rows) {
  return {
    from() {
      return {
        select() { return Promise.resolve({ data: rows, error: null }); },
        update() { return { eq() { return Promise.resolve({ error: null }); } }; },
      };
    },
  };
}

// Two healthy houses, one already near the circuit threshold.
const rows = [
  { slug: 'ai_house',   circuit_state: 'closed', circuit_opened_at: null, health_score: 100, consecutive_failures: 0 },
  { slug: 'brittle',    circuit_state: 'closed', circuit_opened_at: null, health_score: 100, consecutive_failures: 2 },
  { slug: 'real_break', circuit_state: 'closed', circuit_opened_at: null, health_score: 100, consecutive_failures: 0 },
];
await initHouseHealth(mockSupabase(rows));

const ZERO = { lots: { lots: [], batchQuality: 0 }, extractionMethod: 'none' };
const someLots = (n) => ({
  lots: { lots: Array.from({ length: n }, (_, i) => ({ address: `${i} Test St` })), batchQuality: 80, fieldCoverage: { imageUrl: 90 } },
  extractionMethod: 'recogniser',
});

console.log('AI-outage gate — an unrunnable scrape is not a house failure');

// ── 1. Zero lots DURING an AI outage → non-event ──
const before = getHealth('ai_house');
const out = updateHealth('ai_house', { ...ZERO, aiUnavailable: true });
const after = getHealth('ai_house');
assert(out.skipped === 'ai_unavailable', 'outage zero reports skipped=ai_unavailable');
assert(after.consecutiveFailures === before.consecutiveFailures, 'outage zero does NOT increment consecutiveFailures');
assert(after.health === before.health, 'outage zero leaves health untouched');
assert(after.circuitBreaker === 'closed', 'outage zero leaves the circuit closed');

// ── 2. Repeated outage zeros never trip the breaker (the treadmill case) ──
for (let i = 0; i < 10; i++) updateHealth('brittle', { ...ZERO, aiUnavailable: true });
const brittle = getHealth('brittle');
assert(brittle.circuitBreaker === 'closed', '10 consecutive outage zeros still do not open the circuit');
assert(brittle.consecutiveFailures === 2, 'outage zeros leave the pre-existing failure count alone (2)');

// ── 3. A zero while the AI is UP still indicts the house (no masking) ──
updateHealth('real_break', ZERO);
const broke1 = getHealth('real_break');
assert(broke1.consecutiveFailures === 1, 'zero with AI up DOES increment consecutiveFailures');
updateHealth('real_break', ZERO);
updateHealth('real_break', ZERO);
const broke3 = getHealth('real_break');
assert(broke3.consecutiveFailures === 3, 'repeated real zeros keep accumulating');
assert(broke3.circuitBreaker === 'open', 'real repeated zeros still OPEN the circuit (breakage not masked)');

// ── 4. The gate is scoped to zeros — a successful scrape during an outage is normal ──
const ok = updateHealth('ai_house', { ...someLots(20), aiUnavailable: true });
assert(ok.skipped === undefined, 'a scrape WITH lots is not gated even if aiUnavailable is set');
assert(getHealth('ai_house').consecutiveFailures === 0, 'successful scrape resets/keeps failures at 0');

// ── 5. Absent flag behaves exactly as before (back-compat) ──
const legacy = updateHealth('ai_house', ZERO);
assert(legacy.skipped === undefined, 'no aiUnavailable flag → original behaviour (not gated)');
assert(getHealth('ai_house').consecutiveFailures === 1, 'no flag → zero counts as a failure');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
