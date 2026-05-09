/**
 * Alert sweeper tests
 * ===================
 * Verifies sweepStaleAlerts() resolves only alerts that satisfy BOTH age
 * and the per-type "now healthy" predicate. The sweeper must never resolve
 * on age alone — that would silently swallow real signals.
 *
 * Run: node tests/test-alert-sweeper.js
 */

import { sweepStaleAlerts, HEALTH_PREDICATES } from '../lib/pipeline/alert-sweeper.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── Mock Supabase builder ──────────────────────────────────────────
// Captures intent (which table / filters / updates) without hitting a DB.
function makeMockSupabase({ alerts = [], lotsByHouse = {} }) {
  const updates = [];
  return {
    _updates: updates,
    from(table) {
      const ctx = { table, filters: [] };
      const chain = {
        select: () => chain,
        eq: (col, val) => { ctx.filters.push({ col, val, op: 'eq' }); return chain; },
        gte: (col, val) => { ctx.filters.push({ col, val, op: 'gte' }); return chain; },
        lte: (col, val) => { ctx.filters.push({ col, val, op: 'lte' }); return chain; },
        order: () => chain,
        limit: () => chain,
        update: (patch) => { ctx.update = patch; return chain; },
        // Resolve the chain — return the right shape based on the operation.
        async then(resolve) {
          if (table === 'pipeline_alerts' && ctx.update) {
            const id = ctx.filters.find(f => f.col === 'id')?.val;
            if (id) updates.push({ id, ...ctx.update });
            resolve({ error: null });
            return;
          }
          if (table === 'pipeline_alerts') {
            const cutoff = ctx.filters.find(f => f.col === 'created_at' && f.op === 'lte')?.val;
            const filtered = alerts.filter(a => !a.resolved && (!cutoff || a.created_at <= cutoff));
            resolve({ data: filtered, error: null });
            return;
          }
          if (table === 'lots') {
            const house = ctx.filters.find(f => f.col === 'house')?.val;
            const since = ctx.filters.find(f => f.col === 'last_seen_at' && f.op === 'gte')?.val;
            const rows = (lotsByHouse[house] || []).filter(r => !since || r.last_seen_at >= since);
            const isHeadCount = ctx.headCount === true;
            // The .select('id', { count: 'exact', head: true }) shape resolves to { count, error }
            // The .select('image_url') shape resolves to { data, error }
            resolve({ data: rows, count: rows.length, error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      // Override .select to support the head:true count form
      const origSelect = chain.select;
      chain.select = (cols, opts) => {
        if (opts && opts.head === true) ctx.headCount = true;
        return origSelect();
      };
      return chain;
    },
  };
}

const NOW = Date.now();
const day = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

// ── Test 1: alert resolved when age >= 30d AND predicate healthy ──
console.log('Test 1: 31-day-old zero-lots alert + house has fresh lots → resolved');
{
  const sb = makeMockSupabase({
    alerts: [
      { id: 'a1', event_type: 'house_returned_zero_lots', house: 'savills', created_at: day(31), resolved: false, message: 'x', meta: {} },
    ],
    lotsByHouse: { savills: [{ last_seen_at: day(0.1) }] },
  });
  const r = await sweepStaleAlerts(sb);
  assert(r.scanned === 1, '1 scanned');
  assert(r.resolved.length === 1, '1 resolved');
  assert(r.resolved[0].id === 'a1', 'resolved id matches');
  assert(sb._updates.length === 1, 'one update issued');
  assert(sb._updates[0].resolved === true, 'update sets resolved=true');
}

// ── Test 2: alert NOT resolved when predicate says unhealthy ──
console.log('\nTest 2: 31-day-old alert but house still has zero lots → NOT resolved');
{
  const sb = makeMockSupabase({
    alerts: [
      { id: 'a2', event_type: 'house_returned_zero_lots', house: 'broken', created_at: day(31), resolved: false, message: 'x', meta: {} },
    ],
    lotsByHouse: {},
  });
  const r = await sweepStaleAlerts(sb);
  assert(r.scanned === 1, '1 scanned');
  assert(r.resolved.length === 0, '0 resolved');
  assert(r.skippedNotHealthy === 1, '1 skipped (not healthy)');
  assert(sb._updates.length === 0, 'no update issued');
}

// ── Test 3: alert NOT resolved when too young, even if healthy ──
console.log('\nTest 3: 5-day-old alert + healthy → NOT resolved (cutoff guards)');
{
  const sb = makeMockSupabase({
    alerts: [
      { id: 'a3', event_type: 'house_returned_zero_lots', house: 'savills', created_at: day(5), resolved: false, message: 'x', meta: {} },
    ],
    lotsByHouse: { savills: [{ last_seen_at: day(0.1) }] },
  });
  const r = await sweepStaleAlerts(sb);
  // The mock applies the cutoff filter, so the alert never reaches the predicate.
  assert(r.scanned === 0, '0 scanned (filtered out by cutoff)');
  assert(r.resolved.length === 0, '0 resolved');
}

// ── Test 4: alert with no predicate → skipped, never resolved ──
console.log('\nTest 4: unknown event_type with no predicate → skippedNoPredicate');
{
  const sb = makeMockSupabase({
    alerts: [
      { id: 'a4', event_type: 'never_seen_before', house: null, created_at: day(60), resolved: false, message: 'x', meta: {} },
    ],
  });
  const r = await sweepStaleAlerts(sb);
  assert(r.scanned === 1, '1 scanned');
  assert(r.resolved.length === 0, '0 resolved');
  assert(r.skippedNoPredicate === 1, '1 skipped (no predicate)');
}

// ── Test 5: budget-threshold alerts age out at 30d regardless ──
console.log('\nTest 5: firecrawl_budget_threshold age-only predicate');
{
  const old = await HEALTH_PREDICATES.firecrawl_budget_threshold({}, { created_at: day(31) });
  const young = await HEALTH_PREDICATES.firecrawl_budget_threshold({}, { created_at: day(2) });
  assert(old === true, '31-day-old budget alert is resolvable');
  assert(young === false, '2-day-old budget alert is NOT resolvable');
}

// ── Test 6: hmlr_refresh_failed age-only ──
console.log('\nTest 6: hmlr_refresh_failed age-only predicate');
{
  const old = await HEALTH_PREDICATES.hmlr_refresh_failed({}, { created_at: day(45) });
  const young = await HEALTH_PREDICATES.hmlr_refresh_failed({}, { created_at: day(20) });
  assert(old === true, '45-day-old hmlr alert resolvable');
  assert(young === false, '20-day-old hmlr alert NOT resolvable');
}

// ── Test 7: image_coverage_drop predicate needs >=70% coverage ──
console.log('\nTest 7: image_coverage_drop predicate');
{
  const goodCoverage = { savills: Array.from({ length: 100 }, (_, i) => ({ image_url: i < 75 ? 'https://x.png' : null, last_seen_at: day(0.1) })) };
  const badCoverage = { broken: Array.from({ length: 100 }, (_, i) => ({ image_url: i < 30 ? 'https://x.png' : null, last_seen_at: day(0.1) })) };

  const goodSb = makeMockSupabase({ alerts: [], lotsByHouse: goodCoverage });
  const badSb = makeMockSupabase({ alerts: [], lotsByHouse: badCoverage });

  const okAlert = { event_type: 'image_coverage_drop', house: 'savills', created_at: day(31), resolved: false };
  const badAlert = { event_type: 'image_coverage_drop', house: 'broken', created_at: day(31), resolved: false };

  const ok = await HEALTH_PREDICATES.image_coverage_drop(goodSb, okAlert);
  const bad = await HEALTH_PREDICATES.image_coverage_drop(badSb, badAlert);
  assert(ok === true, '75% coverage → healthy');
  assert(bad === false, '30% coverage → unhealthy');
}

// ── Test 8: zero alerts → no errors ──
console.log('\nTest 8: empty input is safe');
{
  const sb = makeMockSupabase({ alerts: [] });
  const r = await sweepStaleAlerts(sb);
  assert(r.scanned === 0, '0 scanned');
  assert(r.resolved.length === 0, '0 resolved');
  assert(sb._updates.length === 0, 'no updates');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
