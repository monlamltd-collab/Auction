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

// ── Test 8: recordFcMapRequest books 1 credit per /v2/map call ──
console.log('\nTest 8: recordFcMapRequest books 1 credit and attributes by tier');
{
  const b = makeBudget(1000);
  const before = b.getFirecrawlStatus();

  b.recordFcMapRequest('healing');
  b.recordFcMapRequest('healing');

  const after = b.getFirecrawlStatus();
  assert(after.creditsUsed - before.creditsUsed === 2, '2 map calls = +2 credits');
  assert((after.creditsByTier.healing || 0) - (before.creditsByTier.healing || 0) === 2, 'attributed to healing tier');

  b.destroy();
}

// ── Test 9: planRefreshDay env defaults to 0 (legacy UTC-month behaviour) ──
console.log('\nTest 9: planRefreshDay default is 0 (legacy UTC-month cycle key)');
{
  const prev = process.env.FIRECRAWL_PLAN_REFRESH_DAY;
  delete process.env.FIRECRAWL_PLAN_REFRESH_DAY;
  try {
    const b = makeBudget(100);
    assert(b.planRefreshDay === 0, 'planRefreshDay is 0');
    const key = b._planCycleKey();
    assert(/^\d{4}-\d{2}$/.test(key), `cycle key matches YYYY-MM (got ${key})`);
    assert(key === b._utcMonthKey(), 'falls back to UTC month key');
    b.destroy();
  } finally {
    if (prev === undefined) delete process.env.FIRECRAWL_PLAN_REFRESH_DAY;
    else process.env.FIRECRAWL_PLAN_REFRESH_DAY = prev;
  }
}

// ── Test 10: planRefreshDay=14 produces a YYYY-MM-14 anchored cycle key ──
console.log('\nTest 10: planRefreshDay=14 anchors cycle key to YYYY-MM-14');
{
  const prev = process.env.FIRECRAWL_PLAN_REFRESH_DAY;
  process.env.FIRECRAWL_PLAN_REFRESH_DAY = '14';
  try {
    const b = makeBudget(100);
    assert(b.planRefreshDay === 14, 'planRefreshDay is 14');
    const key = b._planCycleKey();
    assert(/^\d{4}-\d{2}-14$/.test(key), `cycle key matches YYYY-MM-14 (got ${key})`);
    b.destroy();
  } finally {
    if (prev === undefined) delete process.env.FIRECRAWL_PLAN_REFRESH_DAY;
    else process.env.FIRECRAWL_PLAN_REFRESH_DAY = prev;
  }
}

// ── Test 11: invalid planRefreshDay values fall back to 0 ──
console.log('\nTest 11: invalid planRefreshDay falls back to 0 (legacy)');
{
  const prev = process.env.FIRECRAWL_PLAN_REFRESH_DAY;
  for (const bad of ['0', '-1', '29', '32', 'abc', '']) {
    process.env.FIRECRAWL_PLAN_REFRESH_DAY = bad;
    const b = makeBudget(100);
    assert(b.planRefreshDay === 0, `"${bad}" → planRefreshDay 0`);
    b.destroy();
  }
  if (prev === undefined) delete process.env.FIRECRAWL_PLAN_REFRESH_DAY;
  else process.env.FIRECRAWL_PLAN_REFRESH_DAY = prev;
}

// ── Test 12: threshold flags clear at plan-cycle boundary, not UTC month ──
console.log('\nTest 12: threshold flags reset on plan-cycle rollover');
{
  const prev = process.env.FIRECRAWL_PLAN_REFRESH_DAY;
  process.env.FIRECRAWL_PLAN_REFRESH_DAY = '14';
  try {
    const fired = [];
    const b = makeBudget(100);
    b.setAlertHook(p => fired.push(p));

    for (let i = 0; i < 80; i++) b.recordFcRequest('full');
    assert(fired.length === 1, 'one 80% alert in cycle A');

    // Force a cycle rollover by faking the prior cycle key.
    b._fc.monthStartedAt = '1970-01-14';
    b._fc.creditsUsed = 0;
    b._fc.creditsUsedToday = 0;

    for (let i = 0; i < 80; i++) b.recordFcRequest('full');
    assert(fired.length === 2, 'second 80% alert fires in cycle B');
    assert(/^\d{4}-\d{2}-14$/.test(b._fc.monthStartedAt), 'monthStartedAt is plan-cycle format');

    b.destroy();
  } finally {
    if (prev === undefined) delete process.env.FIRECRAWL_PLAN_REFRESH_DAY;
    else process.env.FIRECRAWL_PLAN_REFRESH_DAY = prev;
  }
}

// ── Test 13: event hook fires when eventMeta supplied ──
console.log('\nTest 13: setEventHook + recordFcRequest(_, _, eventMeta) emits event');
{
  const events = [];
  const b = makeBudget(100);
  b.setEventHook(p => events.push(p));

  b.recordFcRequest('full', 1, {
    endpoint: '/v2/scrape',
    caller: 'firecrawl.test',
    outcome: 'success',
    url: 'https://example.com/a',
    elapsedMs: 42,
  });

  assert(events.length === 1, 'one event emitted');
  assert(events[0].eventType === 'firecrawl_call', 'event_type is firecrawl_call');
  assert(events[0].source === 'resource-budget.recordFcRequest', 'source matches producer label');
  assert(events[0].eventData.endpoint === '/v2/scrape', 'endpoint propagated');
  assert(events[0].eventData.caller === 'firecrawl.test', 'caller propagated');
  assert(events[0].eventData.outcome === 'success', 'outcome propagated');
  assert(events[0].eventData.weight === 1, 'weight is booked credit count');
  assert(events[0].eventData.tier === 'full', 'tier propagated');
  assert(events[0].eventData.url === 'https://example.com/a', 'url propagated');
  assert(events[0].eventData.elapsedMs === 42, 'elapsedMs propagated');

  b.destroy();
}

// ── Test 14: no eventMeta = no event (legacy callers stay silent) ──
console.log('\nTest 14: recordFcRequest without eventMeta emits no event');
{
  const events = [];
  const b = makeBudget(100);
  b.setEventHook(p => events.push(p));

  for (let i = 0; i < 5; i++) b.recordFcRequest('full');
  assert(events.length === 0, 'legacy two-arg calls do not emit');
  assert(b.getFcCreditsUsed() === 5, 'credit accounting still ran');

  b.destroy();
}

// ── Test 15: throwing event hook is contained, budget keeps going ──
console.log('\nTest 15: throwing event hook does not break recordFcRequest');
{
  const b = makeBudget(100);
  b.setEventHook(() => { throw new Error('boom'); });

  let threw = false;
  try {
    b.recordFcRequest('full', 1, {
      endpoint: '/v2/scrape', caller: 'firecrawl.test', outcome: 'success', elapsedMs: 1,
    });
  } catch (e) { threw = true; }

  assert(!threw, 'recordFcRequest swallows hook throw');
  assert(b.getFcCreditsUsed() === 1, 'credit still booked after hook throw');

  b.destroy();
}

// ── Test 16: recordFcAgentRequest forwards eventMeta + uses fire1CreditMult ──
console.log('\nTest 16: recordFcAgentRequest forwards eventMeta with FIRE-1 weight');
{
  const events = [];
  const b = makeBudget(1000);
  b.setEventHook(p => events.push(p));

  b.recordFcAgentRequest('full', {
    endpoint: '/v2/extract', caller: 'firecrawl.agentExtract', outcome: 'success',
    url: 'https://example.com/x', elapsedMs: 5000,
  });

  assert(events.length === 1, 'one event emitted');
  assert(events[0].eventData.weight === b.fire1CreditMult, 'weight matches fire1CreditMult');
  assert(events[0].eventData.endpoint === '/v2/extract', 'endpoint propagated');
  assert(events[0].eventData.outcome === 'success', 'outcome propagated');

  b.destroy();
}

// ── Test 17: recordFcMapRequest forwards eventMeta with weight=1 ──
console.log('\nTest 17: recordFcMapRequest forwards eventMeta with map weight');
{
  const events = [];
  const b = makeBudget(1000);
  b.setEventHook(p => events.push(p));

  b.recordFcMapRequest('healing', {
    endpoint: '/v2/map', caller: 'firecrawl.mapSiteUrls', outcome: 'success',
    url: 'https://example.com/', elapsedMs: 100,
  });

  assert(events.length === 1, 'one event emitted');
  assert(events[0].eventData.weight === 1, 'map weight is 1');
  assert(events[0].eventData.endpoint === '/v2/map', 'endpoint propagated');
  assert(events[0].eventData.tier === 'healing', 'tier propagated');

  b.destroy();
}

// ── Test 18: url longer than 256 chars is truncated ──
console.log('\nTest 18: long url is truncated to 256 chars');
{
  const events = [];
  const b = makeBudget(100);
  b.setEventHook(p => events.push(p));

  const longUrl = 'https://example.com/' + 'a'.repeat(500);
  b.recordFcRequest('full', 1, {
    endpoint: '/v2/scrape', caller: 'firecrawl.test', outcome: 'success',
    url: longUrl, elapsedMs: 1,
  });

  assert(events.length === 1, 'one event emitted');
  assert(events[0].eventData.url.length === 256, 'url truncated to 256 chars');
  assert(longUrl.startsWith(events[0].eventData.url), 'truncation preserves prefix');

  b.destroy();
}

// ── Test 19: null url stays null (search-style endpoints) ──
console.log('\nTest 19: null url propagates as null');
{
  const events = [];
  const b = makeBudget(100);
  b.setEventHook(p => events.push(p));

  b.recordFcRequest('full', 1, {
    endpoint: '/v1/search', caller: 'firecrawl.search', outcome: 'success',
    url: null, elapsedMs: 1,
  });

  assert(events.length === 1, 'one event emitted');
  assert(events[0].eventData.url === null, 'null url stays null');

  b.destroy();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
