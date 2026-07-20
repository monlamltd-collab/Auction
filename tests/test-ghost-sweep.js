/**
 * Tests for the ghost sweep (lib/pipeline/ghost-sweep.js) — the daily
 * portfolio-freshness job that retires served-but-vanished 'available' lots
 * (ghosts) and long-past-dated lots the status sweeps missed.
 *
 * All I/O is injected, so these run with fakes — no DB.
 *
 * Run: node tests/test-ghost-sweep.js
 */

import { classifyGhosts, runGhostSweep, ghostUnseenDays } from '../lib/pipeline/ghost-sweep.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-04T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * DAY_MS).toISOString();
const row = (id, house, seenDaysAgo, extra = {}) => ({
  id, house, last_seen_at: daysAgo(seenDaysAgo), status: 'available', auction_date: null, ...extra,
});

console.log('Test 1: classifyGhosts — core ghost logic');
{
  const rows = [
    // activehouse: scraped today, one ghost (unseen 5d), one borderline (3d), plenty fresh
    row('a1', 'activehouse', 0), row('a2', 'activehouse', 0), row('a3', 'activehouse', 0),
    row('a4', 'activehouse', 3),   // inside 4d floor — not a ghost
    row('a5', 'activehouse', 5),   // ghost
    // stalledhouse: nothing seen for 10d — NEVER swept (unconfirmed, not gone)
    row('s1', 'stalledhouse', 10), row('s2', 'stalledhouse', 12),
  ];
  const { ghostFlips, held } = classifyGhosts({ rows, nowMs: NOW });
  assert(ghostFlips.length === 1 && ghostFlips[0].id === 'a5', 'only the unseen-5d lot on the active house is a ghost');
  assert(held.length === 0, 'no houses held');
}

console.log('\nTest 2: classifyGhosts — partial-scrape gate holds the house');
{
  const rows = [
    // House scraped today but only 1 fresh row vs 3 ghosts → partial scrape, hold.
    row('p1', 'partial', 0),
    row('p2', 'partial', 5), row('p3', 'partial', 6), row('p4', 'partial', 7),
  ];
  const { ghostFlips, held } = classifyGhosts({ rows, nowMs: NOW });
  assert(ghostFlips.length === 0, 'no flips while held');
  assert(held.length === 1 && held[0].house === 'partial' && held[0].ghosts === 3 && held[0].fresh === 1,
    'house held with counts');
}

console.log('\nTest 3: classifyGhosts — past-dated pass (conservative both axes)');
{
  const rows = [
    // Auction 10d past AND unseen 8d → flip even though the house is stalled.
    row('d1', 'olddates', 8, { auction_date: daysAgo(10).slice(0, 10) }),
    // Auction 10d past but lot SEEN yesterday (mis-stamped date, PR #90 class) → protected.
    row('d2', 'olddates2', 1, { auction_date: daysAgo(10).slice(0, 10) }),
    // Auction only 3d past (within 7d grace) → not flipped.
    row('d3', 'olddates3', 8, { auction_date: daysAgo(3).slice(0, 10) }),
    // 2099 sentinel → never past-dated.
    row('d4', 'sentinel', 8, { auction_date: '2099-12-31' }),
  ];
  const { pastDatedFlips, ghostFlips } = classifyGhosts({ rows, nowMs: NOW });
  const ids = pastDatedFlips.map(r => r.id);
  assert(JSON.stringify(ids) === JSON.stringify(['d1']), `only the long-past + long-unseen lot flips (got ${JSON.stringify(ids)})`);
  assert(ghostFlips.length === 0, 'stalled-house rows are not ghosts');
}

console.log('\nTest 4: ghostUnseenDays env');
{
  const prev = process.env.GHOST_SWEEP_UNSEEN_DAYS;
  delete process.env.GHOST_SWEEP_UNSEEN_DAYS;
  assert(ghostUnseenDays() === 4, 'default 4 days');
  process.env.GHOST_SWEEP_UNSEEN_DAYS = '6';
  assert(ghostUnseenDays() === 6, 'env override 6');
  process.env.GHOST_SWEEP_UNSEEN_DAYS = '0';
  assert(ghostUnseenDays() === 4, 'invalid → default');
  if (prev === undefined) delete process.env.GHOST_SWEEP_UNSEEN_DAYS;
  else process.env.GHOST_SWEEP_UNSEEN_DAYS = prev;
}

// ── Orchestrator ──
function fakeDeps(rows) {
  const state = { flipped: [], patches: [], events: [], alerts: [] };
  return {
    state,
    deps: {
      fetchAvailableRows: async () => rows,
      flipLots: async (ids, patch) => { state.flipped.push(...ids); state.patches.push(patch); return ids.length; },
      emitEvents: async (events) => { state.events.push(...events); },
      buildVanishedEvent: ({ lotId, oldStatus, source }) => ({ kind: 'vanished', lotId, oldStatus, source }),
      buildLotEvent: ({ lotId, eventType, oldValue, newValue, source }) => ({ kind: 'flip', lotId, eventType, oldValue, newValue, source }),
      LOT_EVENT_TYPES: { STATUS_CHANGED: 'lot_status_changed' },
      fireAlert: async (a) => { state.alerts.push(a); },
    },
  };
}

console.log('\nTest 5: runGhostSweep — flips, events, alerts');
{
  const rows = [
    row('a1', 'active', 0), row('a2', 'active', 0), row('a3', 'active', 5),
    row('p1', 'partial', 0), row('p2', 'partial', 5), row('p3', 'partial', 6),
    row('d1', 'olddates', 9, { auction_date: daysAgo(10).slice(0, 10) }),
  ];
  const { deps, state } = fakeDeps(rows);
  const r = await runGhostSweep(deps, { nowMs: NOW });
  assert(r.ghosts === 1 && state.flipped.includes('a3'), 'ghost flipped');
  assert(r.pastDated === 1 && state.flipped.includes('d1'), 'past-dated flipped');
  assert(!state.flipped.includes('p2') && !state.flipped.includes('p3'), 'held house not flipped');
  assert(r.held.length === 1 && state.alerts.length === 1 && state.alerts[0].type === 'ghost_sweep_held',
    'held house alerted');
  assert(state.patches.every(p => p.status === 'withdrawn' && p.removed_reason && p.removed_at),
    'flip patch mirrors prune semantics (withdrawn + removed_reason + removed_at)');
  const a3Events = state.events.filter(e => e.lotId === 'a3');
  assert(a3Events.some(e => e.kind === 'vanished') && a3Events.some(e => e.kind === 'flip' && e.newValue.status === 'withdrawn'),
    'vanished + status-flip events emitted per lot');
  assert(state.events.every(e => e.source.writer === 'ghost-sweep.flip'), 'events carry the ghost-sweep writer');
}

console.log('\nTest 6: runGhostSweep — dry run + kill switch');
{
  const rows = [row('a1', 'active', 0), row('a2', 'active', 5)];
  const { deps, state } = fakeDeps(rows);
  const dry = await runGhostSweep(deps, { nowMs: NOW, dryRun: true });
  assert(dry.skipped === 'dry_run' && dry.ghosts === 1 && state.flipped.length === 0, 'dry run counts but writes nothing');

  process.env.GHOST_SWEEP_DISABLED = 'true';
  const off = await runGhostSweep(deps, { nowMs: NOW });
  assert(off.skipped === 'disabled' && state.flipped.length === 0, 'kill switch respected');
  delete process.env.GHOST_SWEEP_DISABLED;
}

console.log('\nTest 7: runGhostSweep — failed flip emits NO events (event integrity)');
{
  const rows = [
    row('a1', 'active', 0), row('a2', 'active', 0), row('a3', 'active', 5),   // ghost a3
    row('d1', 'olddates', 9, { auction_date: daysAgo(10).slice(0, 10) }),      // past-dated d1
  ];
  const { deps, state } = fakeDeps(rows);
  // Fail the ghost batch (contains a3); let the past-dated batch through.
  deps.flipLots = async (ids, patch) => {
    if (ids.includes('a3')) throw new Error('db down');
    state.flipped.push(...ids); state.patches.push(patch); return ids.length;
  };
  const r = await runGhostSweep(deps, { nowMs: NOW });
  assert(r.ghosts === 0 && r.flipFailures === 1, `failed batch counted as flipFailures, not retired (ghosts=${r.ghosts} flipFailures=${r.flipFailures})`);
  assert(state.events.every(e => e.lotId !== 'a3'), 'no lot_events for lots whose flip failed');
  assert(r.pastDated === 1 && state.flipped.includes('d1'), 'later pass still runs after a failed batch');
  assert(state.events.some(e => e.lotId === 'd1'), 'events still emitted for the successful flip');
  assert(state.alerts.some(a => a.type === 'ghost_sweep_flip_failed' && a.severity === 'error' && a.meta.lots === 1),
    'flip failure surfaced via fireAlert');
}

console.log('\nTest 8: runGhostSweep — flipLots returning 0 rows treated as failure');
{
  const rows = [row('a1', 'active', 0), row('a2', 'active', 5)];
  const { deps, state } = fakeDeps(rows);
  deps.flipLots = async () => 0; // legacy swallow contract: error eaten, 0 returned
  const r = await runGhostSweep(deps, { nowMs: NOW });
  assert(r.ghosts === 0 && r.flipFailures === 1, 'zero-row flip counted as failure');
  assert(state.events.length === 0, 'no events when nothing was actually flipped');
  assert(state.alerts.some(a => a.type === 'ghost_sweep_flip_failed'), 'zero-row flip alerted');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
