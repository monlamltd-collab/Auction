/**
 * Alert sweeper tests
 * ===================
 * Verifies sweepStaleAlerts() resolves only alerts that satisfy BOTH age
 * and the per-type "now healthy" predicate — plus the 2026-07-24 noise
 * sweep (parked / retired / ancient drift / null-candidate mergers).
 *
 * Run: node tests/test-alert-sweeper.js
 */

import { sweepStaleAlerts, HEALTH_PREDICATES, isNoiseAlertSafeToResolve } from '../lib/pipeline/alert-sweeper.js';
import { RETIRED_HOUSES } from '../lib/houses.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Mock Supabase — spreads query intent without a DB.
function makeMockSupabase({ alerts = [], lotsByHouse = {} }) {
  const updates = [];
  return {
    _updates: updates,
    from(table) {
      const ctx = { table, filters: [], inFilters: {} };
      const chain = {
        select: () => chain,
        eq: (col, val) => { ctx.filters.push({ col, val, op: 'eq' }); return chain; },
        gte: (col, val) => { ctx.filters.push({ col, val, op: 'gte' }); return chain; },
        lte: (col, val) => { ctx.filters.push({ col, val, op: 'lte' }); return chain; },
        in: (col, vals) => { ctx.inFilters[col] = vals; return chain; },
        order: () => chain,
        limit: () => chain,
        update: (patch) => { ctx.update = patch; return chain; },
        async then(resolve) {
          if (table === 'pipeline_alerts' && ctx.update) {
            const id = ctx.filters.find(f => f.col === 'id')?.val;
            if (id) updates.push({ id, ...ctx.update });
            resolve({ error: null });
            return;
          }
          if (table === 'pipeline_alerts') {
            const cutoff = ctx.filters.find(f => f.col === 'created_at' && f.op === 'lte')?.val;
            const typeIn = ctx.inFilters.event_type;
            let filtered = alerts.filter(a => !a.resolved);
            if (cutoff) filtered = filtered.filter(a => a.created_at <= cutoff);
            if (typeIn) filtered = filtered.filter(a => typeIn.includes(a.event_type));
            resolve({ data: filtered, error: null });
            return;
          }
          if (table === 'lots') {
            const house = ctx.filters.find(f => f.col === 'house')?.val;
            const since = ctx.filters.find(f => f.col === 'last_seen_at' && f.op === 'gte')?.val;
            const rows = (lotsByHouse[house] || []).filter(r => !since || r.last_seen_at >= since);
            resolve({ data: rows, count: rows.length, error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
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

console.log('Test 1: 31-day-old zero-lots alert + house has fresh lots → resolved');
{
  const sb = makeMockSupabase({
    alerts: [
      { id: 'a1', event_type: 'house_returned_zero_lots', house: 'savills', created_at: day(31), resolved: false, message: 'x', meta: {} },
    ],
    lotsByHouse: { savills: [{ last_seen_at: day(0.1) }] },
  });
  const r = await sweepStaleAlerts(sb);
  assert(r.resolved.length === 1, '1 resolved');
  assert(r.resolved[0].id === 'a1', 'resolved id matches');
  assert(sb._updates.length === 1, 'one update issued');
  assert(sb._updates[0].resolved === true, 'update sets resolved=true');
}

console.log('\nTest 2: 31-day-old alert but house still has zero lots → NOT resolved');
{
  const sb = makeMockSupabase({
    alerts: [
      { id: 'a2', event_type: 'house_returned_zero_lots', house: 'broken', created_at: day(31), resolved: false, message: 'x', meta: {} },
    ],
    lotsByHouse: {},
  });
  const r = await sweepStaleAlerts(sb);
  assert(r.resolved.length === 0, '0 resolved');
  assert(r.skippedNotHealthy === 1, '1 skipped (not healthy)');
  assert(sb._updates.length === 0, 'no update issued');
}

console.log('\nTest 3: 5-day-old zero-lots alert + healthy → NOT resolved (cutoff guards)');
{
  const sb = makeMockSupabase({
    alerts: [
      { id: 'a3', event_type: 'house_returned_zero_lots', house: 'savills', created_at: day(5), resolved: false, message: 'x', meta: {} },
    ],
    lotsByHouse: { savills: [{ last_seen_at: day(0.1) }] },
  });
  const r = await sweepStaleAlerts(sb);
  assert(r.resolved.length === 0, '0 resolved');
}

console.log('\nTest 4: unknown event_type with no predicate → skippedNoPredicate');
{
  const sb = makeMockSupabase({
    alerts: [
      { id: 'a4', event_type: 'never_seen_before', house: null, created_at: day(60), resolved: false, message: 'x', meta: {} },
    ],
  });
  const r = await sweepStaleAlerts(sb);
  assert(r.resolved.length === 0, '0 resolved');
  assert(r.skippedNoPredicate === 1, '1 skipped (no predicate)');
}

console.log('\nTest 5: firecrawl_budget_threshold age-only predicate');
{
  const old = await HEALTH_PREDICATES.firecrawl_budget_threshold({}, { created_at: day(31) });
  const young = await HEALTH_PREDICATES.firecrawl_budget_threshold({}, { created_at: day(2) });
  assert(old === true, '31-day-old budget alert is resolvable');
  assert(young === false, '2-day-old budget alert is NOT resolvable');
}

console.log('\nTest 6: hmlr_refresh_failed age-only');
{
  const old = await HEALTH_PREDICATES.hmlr_refresh_failed({}, { created_at: day(45) });
  const young = await HEALTH_PREDICATES.hmlr_refresh_failed({}, { created_at: day(20) });
  assert(old === true, '45-day-old hmlr alert resolvable');
  assert(young === false, '20-day-old hmlr alert NOT resolvable');
}

console.log('\nTest 7: image_coverage_drop predicate');
{
  const goodCoverage = { savills: Array.from({ length: 100 }, (_, i) => ({ image_url: i < 75 ? 'https://x.png' : null, last_seen_at: day(0.1) })) };
  const badCoverage = { broken: Array.from({ length: 100 }, (_, i) => ({ image_url: i < 30 ? 'https://x.png' : null, last_seen_at: day(0.1) })) };
  const goodSb = makeMockSupabase({ alerts: [], lotsByHouse: goodCoverage });
  const badSb = makeMockSupabase({ alerts: [], lotsByHouse: badCoverage });
  const ok = await HEALTH_PREDICATES.image_coverage_drop(goodSb, { event_type: 'image_coverage_drop', house: 'savills', created_at: day(31), resolved: false });
  const bad = await HEALTH_PREDICATES.image_coverage_drop(badSb, { event_type: 'image_coverage_drop', house: 'broken', created_at: day(31), resolved: false });
  assert(ok === true, '75% coverage → healthy');
  assert(bad === false, '30% coverage → unhealthy');
}

console.log('\nTest 8: empty input is safe');
{
  const sb = makeMockSupabase({ alerts: [] });
  const r = await sweepStaleAlerts(sb);
  assert(r.resolved.length === 0, '0 resolved');
  assert((r.noiseCleared || 0) === 0, '0 noise');
  assert(sb._updates.length === 0, 'no updates');
}

console.log('\nTest 9: noise sweep clears 75d parked + null-URL merger');
{
  const retiredSlug = [...RETIRED_HOUSES][0];
  const sb = makeMockSupabase({
    alerts: [
      { id: 'p1', event_type: 'house_domain_parked', house: 'romanway', created_at: day(75), resolved: false, message: 'parked', meta: {} },
      { id: 'm1', event_type: 'house_merger_suspected', house: 'driversnorris', created_at: day(5), resolved: false, message: 'merger: null', meta: { to: null } },
      { id: 'r1', event_type: 'house_url_drift_detected', house: retiredSlug, created_at: day(2), resolved: false, message: 'x', meta: { to: 'https://example.com/x' } },
      { id: 'keep', event_type: 'house_url_drift_detected', house: 'savills', created_at: day(3), resolved: false, message: 'real', meta: { to: 'https://savills.co.uk/new' } },
    ],
  });
  assert(isNoiseAlertSafeToResolve({ id: 'p1', event_type: 'house_domain_parked', house: 'romanway', created_at: day(75), meta: {} }) === true, '75d parked is noise');
  assert(isNoiseAlertSafeToResolve({ id: 'm1', event_type: 'house_merger_suspected', house: 'x', created_at: day(5), meta: { to: null } }) === true, 'null merger is noise');
  assert(isNoiseAlertSafeToResolve({ id: 'keep', event_type: 'house_url_drift_detected', house: 'savills', created_at: day(3), meta: { to: 'https://savills.co.uk/new' } }) === false, 'fresh real drift kept');

  const r = await sweepStaleAlerts(sb);
  assert(r.noiseCleared >= 3, `noiseCleared>=3 got ${r.noiseCleared}`);
  const ids = r.resolved.map(x => x.id).sort();
  assert(ids.includes('p1') && ids.includes('m1') && ids.includes('r1'), 'parked/null/retired resolved');
  assert(!ids.includes('keep'), 'fresh savills drift not cleared');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
