/**
 * ResourceBudget threshold-alert tests
 * ====================================
 * Verifies the 80% / 95% / 100% Firecrawl monthly budget alerts fire exactly
 * once per calendar month and clear at month rollover.
 *
 * Run: node tests/test-budget-thresholds.js
 */

import { ResourceBudget } from '../lib/resource-budget.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

function makeBudget(monthlyBudget) {
  // Pass FIRECRAWL_API_KEY explicitly so canUseFirecrawl() is well-defined,
  // though we don't actually make any HTTP calls in these tests.
  return new ResourceBudget({ firecrawlApiKey: 'test', monthlyBudget });
}

// ── Test 1: 80% threshold fires once at exactly the right credit count ──
console.log('Test 1: 80% threshold fires at floor(0.8 * cap)');
{
  const fired = [];
  const b = makeBudget(100);
  b.setAlertHook(p => fired.push(p));

  // Fire 79 requests — no alert.
  for (let i = 0; i < 79; i++) b.recordFcRequest('full');
  assert(fired.length === 0, '79 requests: no alert yet');

  // Fire the 80th — 80% threshold trips.
  b.recordFcRequest('full');
  assert(fired.length === 1, '80th request: one alert fired');
  assert(fired[0].type === 'firecrawl_budget_threshold', 'alert type matches');
  assert(fired[0].severity === 'warning', 'severity warning at 80%');
  assert(fired[0].meta.threshold === 80, 'threshold meta is 80');
  assert(fired[0].meta.creditsUsed === 80, 'creditsUsed meta is 80');
  assert(fired[0].meta.monthlyBudget === 100, 'monthlyBudget meta is 100');

  // Fire more — threshold doesn't fire twice.
  for (let i = 0; i < 10; i++) b.recordFcRequest('full');
  assert(fired.length === 1, 'still one alert after 90 requests');

  b.destroy();
}

// ── Test 2: 95% threshold fires after 80% ──
console.log('\nTest 2: 95% threshold fires once');
{
  const fired = [];
  const b = makeBudget(100);
  b.setAlertHook(p => fired.push(p));

  // Walk to 95 — both 80% and 95% should have fired.
  for (let i = 0; i < 95; i++) b.recordFcRequest('full');
  assert(fired.length === 2, 'two alerts after 95 requests');
  assert(fired[0].meta.threshold === 80, 'first alert is 80%');
  assert(fired[1].meta.threshold === 95, 'second alert is 95%');
  assert(fired[1].severity === 'error', '95% severity is error');

  // Walk to 99 — no new alert yet.
  for (let i = 0; i < 4; i++) b.recordFcRequest('full');
  assert(fired.length === 2, 'still two alerts after 99 requests');

  b.destroy();
}

// ── Test 3: 100% (hard cap) fires its own alert ──
console.log('\nTest 3: 100% hard cap alert');
{
  const fired = [];
  const b = makeBudget(100);
  b.setAlertHook(p => fired.push(p));

  for (let i = 0; i < 100; i++) b.recordFcRequest('full');
  assert(fired.length === 3, 'three alerts after 100 requests (80, 95, 100)');
  const capAlert = fired[2];
  assert(capAlert.meta.threshold === 100, 'third alert threshold is 100');
  assert(capAlert.severity === 'error', '100% severity is error');
  assert(/cap hit/i.test(capAlert.message), 'message says cap hit');

  // Fire more — hard cap alert should not repeat.
  for (let i = 0; i < 50; i++) b.recordFcRequest('full');
  assert(fired.length === 3, 'still three alerts after 150 requests');

  b.destroy();
}

// ── Test 4: alert hook absent — no throws, no fires ──
console.log('\nTest 4: missing alert hook is safe');
{
  const b = makeBudget(10);
  // No setAlertHook call.
  for (let i = 0; i < 15; i++) b.recordFcRequest('full');
  // Should not throw. The internal flags should still be set so a later
  // hook registration doesn't double-fire historical thresholds.
  assert(b._fc.thresholdAlert80Hit === true, '80% flag set even without hook');
  assert(b._fc.thresholdAlert95Hit === true, '95% flag set even without hook');
  assert(b._fc.monthlyCapHit === true, 'monthlyCapHit set even without hook');

  b.destroy();
}

// ── Test 5: hook that throws does not break the budget ──
console.log('\nTest 5: throwing alert hook is contained');
{
  const b = makeBudget(10);
  b.setAlertHook(() => { throw new Error('boom'); });
  // Should not propagate the throw.
  let threw = false;
  try { for (let i = 0; i < 12; i++) b.recordFcRequest('full'); }
  catch (e) { threw = true; }
  assert(!threw, 'recordFcRequest does not propagate hook errors');
  assert(b.getFcCreditsUsed() === 12, 'requests still counted despite hook errors');

  b.destroy();
}

// ── Test 6: month rollover lets alerts fire again ──
// The rollover clears the threshold flags. Whether they re-trip immediately
// depends on whether creditsUsed is still above the threshold — that's a
// real-world signal worth surfacing again. The opposite case (rollover +
// fresh creditsUsed) is the more common scenario and the one we test here.
console.log('\nTest 6: month rollover lets fresh thresholds fire again');
{
  const fired = [];
  const b = makeBudget(100);
  b.setAlertHook(p => fired.push(p));

  for (let i = 0; i < 80; i++) b.recordFcRequest('full');
  assert(fired.length === 1, 'one alert in month A');

  // Simulate end-of-month: provider has zeroed our spend; locally we
  // mirror that by resetting creditsUsed and forcing a month rollover.
  b._fc.monthStartedAt = '1970-01';
  b._fc.creditsUsed = 0;
  b._fc.creditsUsedToday = 0;

  // Walk back up to 80% in month B — alert must fire again (one per month).
  for (let i = 0; i < 80; i++) b.recordFcRequest('full');
  assert(fired.length === 2, 'second 80% alert fires in month B');
  assert(fired[1].meta.threshold === 80, 'second alert is 80%');

  b.destroy();
}

// ── Test 7: budget=0 disables threshold alerts entirely ──
console.log('\nTest 7: monthlyBudget=0 disables threshold alerts');
{
  const fired = [];
  const b = makeBudget(0);
  b.setAlertHook(p => fired.push(p));

  for (let i = 0; i < 1000; i++) b.recordFcRequest('full');
  assert(fired.length === 0, 'no alerts fired when budget is 0');

  b.destroy();
}

// ── Test 8: recordFcSearchRequest books 1 credit per call ──
console.log('\nTest 8: recordFcSearchRequest credits ~1 per /v1/search query');
{
  const b = makeBudget(1000);
  const beforeUsed = b.getFcCreditsUsed();
  const beforeStatus = b.getFirecrawlStatus();
  const beforeHealing = beforeStatus.creditsByTier?.healing || 0;

  b.recordFcSearchRequest('healing');
  b.recordFcSearchRequest('healing');
  b.recordFcSearchRequest('healing');

  const afterUsed = b.getFcCreditsUsed();
  const afterStatus = b.getFirecrawlStatus();
  const afterHealing = afterStatus.creditsByTier?.healing || 0;

  assert(afterUsed - beforeUsed === 3, '3 search requests = +3 credits total');
  assert(afterHealing - beforeHealing === 3, '3 search requests attributed to healing tier');

  b.destroy();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
