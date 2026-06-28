/**
 * Circuit-breaker auto-recovery on the cron skip path.
 *
 * Regression test for the 2026-06-13 deadlock: a circuit trips `open`, the cron
 * skips it BEFORE scraping (isCircuitOpen), so updateHealth() — which owns the
 * 24h open→half-open promotion — never runs, and the house is skipped forever
 * (117 houses frozen). isCircuitOpen() now applies the 24h promotion itself.
 *
 * Run: node tests/test-circuit-recovery.js
 */

import { initHouseHealth, isCircuitOpen, getHealth } from '../lib/harness/house-health.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// Minimal Supabase mock: initHouseHealth reads house_skills via .from().select();
// _persistHealth writes via .from().update().eq(). Both just need to resolve.
const persisted = [];
function mockSupabase(rows) {
  return {
    from() {
      return {
        select() { return Promise.resolve({ data: rows, error: null }); },
        update(patch) {
          return { eq(_c, slug) { persisted.push({ slug, patch }); return Promise.resolve({ error: null }); } };
        },
      };
    },
  };
}

const rows = [
  { slug: 'open_stale',  circuit_state: 'open',   circuit_opened_at: ago(25 * HOUR), health_score: 5 },
  { slug: 'open_recent', circuit_state: 'open',   circuit_opened_at: ago(1 * HOUR),  health_score: 5 },
  { slug: 'open_nodate', circuit_state: 'open',   circuit_opened_at: null,           health_score: 5 },
  { slug: 'closed_ok',   circuit_state: 'closed', circuit_opened_at: null,           health_score: 100 },
  { slug: 'half_open',   circuit_state: 'half-open', circuit_opened_at: null,        health_score: 30 },
];

console.log('Test: circuit auto-recovery via isCircuitOpen()');
await initHouseHealth(mockSupabase(rows));

// 1. Open >= 24h → granted a half-open trial (not skipped).
assert(isCircuitOpen('open_stale') === false, 'open >24h → trial granted (not skipped)');
assert(getHealth('open_stale').circuitBreaker === 'half-open', 'open >24h promoted to half-open in memory');
assert(persisted.some(p => p.slug === 'open_stale' && p.patch.circuit_state === 'half-open'),
  'promotion persisted to house_skills');
// clock reset to ~now so a failed trial backs off another 24h
assert(Date.now() - new Date(getHealth('open_stale').circuitOpenedAt).getTime() < 5 * 1000,
  'backoff clock reset to now on trial grant');

// 2. Open < 24h → still skipped (backoff not elapsed).
assert(isCircuitOpen('open_recent') === true, 'open <24h → still skipped');
assert(getHealth('open_recent').circuitBreaker === 'open', 'open <24h stays open');

// 3. Open with no circuit_opened_at (legacy) → granted a trial, not deadlocked.
assert(isCircuitOpen('open_nodate') === false, 'open w/ null opened_at → trial granted (no permanent deadlock)');

// 4. Closed / half-open / unknown are never "open".
assert(isCircuitOpen('closed_ok') === false, 'closed → not skipped');
assert(isCircuitOpen('half_open') === false, 'half-open → not skipped (already in trial state)');
assert(isCircuitOpen('unknown_slug') === false, 'unknown slug → not skipped');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
