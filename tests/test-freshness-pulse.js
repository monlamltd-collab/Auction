/**
 * Tests for the freshness pulse (lib/pipeline/freshness-pulse.js) — Phase 2
 * of the freshness workstream: hourly catalogue-change detection via
 * autoAnalyseOne's page-1 hash gate, with targeted full extract on change.
 *
 * The module takes all I/O as injected deps, so these tests run with fakes —
 * no DB, no network, no analysis.js import.
 *
 * Run: node tests/test-freshness-pulse.js
 */

import {
  selectPulseCandidates,
  runFreshnessPulse,
  pulseSkipSlugs,
  flapDampMs,
} from '../lib/pipeline/freshness-pulse.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse('2026-07-02T12:00:00Z');

const freshState = () => ({ running: false, lastPulsedAt: new Map(), lastChangedAt: new Map() });
const slugFromUrl = (url) => new URL(url).hostname.split('.')[0];

function baseSelectArgs(overrides = {}) {
  return {
    auctions: [],
    skillBySlug: new Map(),
    retiredSlugs: new Set(),
    skipSlugs: new Set(),
    detectHouse: slugFromUrl,
    isCircuitOpen: () => false,
    isPdfUrl: (u) => u.endsWith('.pdf'),
    state: freshState(),
    nowMs: NOW,
    ...overrides,
  };
}

console.log('Test 1: selectPulseCandidates — dedupe + basic filters');
{
  const { candidates, skips } = selectPulseCandidates(baseSelectArgs({
    auctions: [
      { url: 'https://alpha.example/cat', date: '2026-07-20' },
      { url: 'https://alpha.example/cat2', date: '2026-07-10' }, // soonest wins
      { url: 'https://retired.example/cat', date: '2026-07-10' },
      { url: 'https://dormant.example/cat', date: '2026-07-10' },
      { url: 'https://open.example/cat', date: '2026-07-10' },
      { url: 'https://pdfhouse.example/catalogue.pdf', date: '2026-07-10' },
    ],
    skillBySlug: new Map([['dormant', { dormant: true }]]),
    retiredSlugs: new Set(['retired']),
    isCircuitOpen: (slug) => slug === 'open',
  }));
  const slugs = candidates.map(c => c.slug);
  assert(slugs.length === 1 && slugs[0] === 'alpha', 'only the healthy house survives');
  assert(candidates[0].url === 'https://alpha.example/cat2', 'soonest auction date wins the dedupe');
  assert(skips.retired === 1 && skips.dormant === 1 && skips.circuit_open === 1 && skips.pdf === 1,
    `each exclusion counted (got ${JSON.stringify(skips)})`);
}

console.log('\nTest 2: selectPulseCandidates — engine filter');
{
  const { candidates, skips } = selectPulseCandidates(baseSelectArgs({
    auctions: [
      { url: 'https://fclocked.example/cat', date: '2026-07-10' },
      { url: 'https://fcpref.example/cat', date: '2026-07-10' },
      { url: 'https://crlockedfcpref.example/cat', date: '2026-07-10' },
      { url: 'https://plaincrawlee.example/cat', date: '2026-07-10' },
    ],
    skillBySlug: new Map([
      ['fclocked', { engine_locked: 'firecrawl' }],
      ['fcpref', { preferred_engine: 'firecrawl' }],
      ['crlockedfcpref', { engine_locked: 'crawlee', preferred_engine: 'firecrawl' }],
      ['plaincrawlee', { preferred_engine: 'crawlee' }],
    ]),
  }));
  const slugs = candidates.map(c => c.slug).sort();
  assert(JSON.stringify(slugs) === JSON.stringify(['crlockedfcpref', 'plaincrawlee']),
    `firecrawl-locked and firecrawl-preferring skipped; crawlee-locked overrides preference (got ${JSON.stringify(slugs)})`);
  assert(skips.engine_firecrawl === 2, 'both firecrawl exclusions counted');
  assert(candidates.find(c => c.slug === 'plaincrawlee').engineSkill?.preferred_engine === 'crawlee',
    'engineSkill row carried on the candidate');
}

console.log('\nTest 3: selectPulseCandidates — min interval + flap damp');
{
  const state = freshState();
  state.lastPulsedAt.set('recent', NOW - 10 * 60 * 1000);      // 10 min ago
  state.lastPulsedAt.set('due', NOW - 55 * 60 * 1000);         // 55 min ago
  state.lastChangedAt.set('flappy', NOW - 1 * HOUR_MS);        // extracted 1h ago
  const { candidates, skips } = selectPulseCandidates(baseSelectArgs({
    auctions: [
      { url: 'https://recent.example/cat', date: '2026-07-10' },
      { url: 'https://due.example/cat', date: '2026-07-10' },
      { url: 'https://flappy.example/cat', date: '2026-07-10' },
    ],
    state,
  }));
  const slugs = candidates.map(c => c.slug);
  assert(JSON.stringify(slugs) === JSON.stringify(['due']), 'recently-pulsed and flap-damped skipped; due house kept');
  assert(skips.recently_pulsed === 1 && skips.flap_damped === 1, 'skip reasons counted');
}

console.log('\nTest 4: pulseSkipSlugs / flapDampMs env handling');
{
  const prevSkip = process.env.FRESHNESS_PULSE_SKIP;
  const prevFlap = process.env.FRESHNESS_PULSE_FLAP_HOURS;
  delete process.env.FRESHNESS_PULSE_SKIP;
  assert(pulseSkipSlugs().has('symondsandsampson'), 'stealth house skipped by default (credit cost)');
  process.env.FRESHNESS_PULSE_SKIP = 'foo, Bar';
  const s = pulseSkipSlugs();
  assert(s.has('foo') && s.has('bar') && s.has('symondsandsampson'), 'env extends (lowercased), builtin retained');
  delete process.env.FRESHNESS_PULSE_FLAP_HOURS;
  assert(flapDampMs() === 3 * HOUR_MS, 'default flap damp 3h');
  process.env.FRESHNESS_PULSE_FLAP_HOURS = '6';
  assert(flapDampMs() === 6 * HOUR_MS, 'env flap damp 6h');
  if (prevSkip === undefined) delete process.env.FRESHNESS_PULSE_SKIP; else process.env.FRESHNESS_PULSE_SKIP = prevSkip;
  if (prevFlap === undefined) delete process.env.FRESHNESS_PULSE_FLAP_HOURS; else process.env.FRESHNESS_PULSE_FLAP_HOURS = prevFlap;
}

// ── Orchestrator tests ──
function baseDeps(overrides = {}) {
  return {
    getCalendarAuctions: async () => [
      { url: 'https://alpha.example/cat', date: '2026-07-10' },
      { url: 'https://bravo.example/cat', date: '2026-07-11' },
      { url: 'https://charlie.example/cat', date: '2026-07-12' },
    ],
    autoAnalyseOne: async () => [],
    isAutoAnalysisRunning: () => false,
    isCircuitOpen: () => false,
    isPdfUrl: () => false,
    detectHouse: slugFromUrl,
    retiredSlugs: new Set(),
    fetchSkills: async () => [],
    ...overrides,
  };
}

console.log('\nTest 5: runFreshnessPulse — outcomes counted, state stamped');
{
  const state = freshState();
  const calls = [];
  const outcomes = { alpha: 'same', bravo: 'changed', charlie: null };
  const deps = baseDeps({
    autoAnalyseOne: async (url, opts) => {
      const slug = slugFromUrl(url);
      calls.push(slug);
      opts.onOutcome(outcomes[slug]);
      return [];
    },
  });
  const r = await runFreshnessPulse(deps, { state, nowMs: NOW, concurrency: 2, timeoutMs: 5000 });
  assert(r.skipped === null, 'pulse ran');
  assert(r.candidates === 3 && calls.length === 3, 'all three houses pulsed');
  assert(r.same === 1 && r.changed === 1 && r.errors === 1, `outcomes counted (got same=${r.same} changed=${r.changed} errors=${r.errors})`);
  assert(state.lastPulsedAt.get('alpha') === NOW && state.lastPulsedAt.get('charlie') === NOW, 'lastPulsedAt stamped for every attempt');
  assert(state.lastChangedAt.get('bravo') === NOW, 'changed house stamped for flap damping');
  assert(!state.lastChangedAt.has('alpha'), 'unchanged house not flap-stamped');
  assert(state.running === false, 'run lock released');

  // Immediate second run: everything within min interval → 0 candidates.
  const r2 = await runFreshnessPulse(deps, { state, nowMs: NOW + 1000, concurrency: 2, timeoutMs: 5000 });
  assert(r2.candidates === 0 && r2.skips.recently_pulsed === 3, 'immediate re-run skips all (min interval)');
}

console.log('\nTest 6: runFreshnessPulse — guards');
{
  const r1 = await runFreshnessPulse(baseDeps({ isAutoAnalysisRunning: () => true }), { state: freshState() });
  assert(r1.skipped === 'full_pass_running', 'skips while the daily pass runs');

  const busy = freshState();
  busy.running = true;
  const r2 = await runFreshnessPulse(baseDeps(), { state: busy });
  assert(r2.skipped === 'pulse_running', 'skips while a previous pulse runs');

  process.env.FRESHNESS_PULSE_DISABLED = 'true';
  const r3 = await runFreshnessPulse(baseDeps(), { state: freshState() });
  assert(r3.skipped === 'disabled', 'kill switch respected');
  delete process.env.FRESHNESS_PULSE_DISABLED;
}

console.log('\nTest 7: runFreshnessPulse — error and timeout isolation');
{
  const state = freshState();
  const deps = baseDeps({
    getCalendarAuctions: async () => [
      { url: 'https://boom.example/cat', date: '2026-07-10' },
      { url: 'https://hang.example/cat', date: '2026-07-10' },
      { url: 'https://fine.example/cat', date: '2026-07-10' },
    ],
    autoAnalyseOne: async (url, opts) => {
      const slug = slugFromUrl(url);
      if (slug === 'boom') throw new Error('render exploded');
      if (slug === 'hang') return new Promise(() => {}); // never resolves → timeout
      opts.onOutcome('same');
      return [];
    },
  });
  const r = await runFreshnessPulse(deps, { state, nowMs: NOW, concurrency: 3, timeoutMs: 100 });
  assert(r.errors === 2 && r.same === 1, `one throw + one timeout isolated; healthy house still pulsed (got errors=${r.errors} same=${r.same})`);
  assert(state.running === false, 'run lock released after errors');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
