/**
 * Tests for the shared render-concurrency ceiling (lib/config.js
 * renderConcurrency) — Phase 3 of the freshness workstream. One env knob
 * (CRAWLEE_MAX_CONCURRENCY) drives BOTH the Crawlee fleet's maxConcurrency
 * and the puppeteer.js fallback's page gate; Crawlee's memory-aware
 * AutoscaledPool governs actual concurrency beneath the ceiling.
 *
 * Run: node tests/test-render-concurrency.js
 */

import { renderConcurrency } from '../lib/config.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const prev = process.env.CRAWLEE_MAX_CONCURRENCY;

console.log('Test: renderConcurrency resolution');
{
  delete process.env.CRAWLEE_MAX_CONCURRENCY;
  assert(renderConcurrency() === 5, 'default → 5 (the Phase-3 ceiling)');

  process.env.CRAWLEE_MAX_CONCURRENCY = '3';
  assert(renderConcurrency() === 3, 'env 3 → 3 (the documented rollback)');

  process.env.CRAWLEE_MAX_CONCURRENCY = '6';
  assert(renderConcurrency() === 6, 'env 6 → 6');

  process.env.CRAWLEE_MAX_CONCURRENCY = '50';
  assert(renderConcurrency() === 8, 'env 50 → clamped to 8');

  process.env.CRAWLEE_MAX_CONCURRENCY = '1';
  assert(renderConcurrency() === 1, 'env 1 → 1 (minimum honoured)');

  process.env.CRAWLEE_MAX_CONCURRENCY = '0';
  assert(renderConcurrency() === 5, 'env 0 (invalid) → default 5');

  process.env.CRAWLEE_MAX_CONCURRENCY = '-2';
  assert(renderConcurrency() === 5, 'negative → default 5');

  process.env.CRAWLEE_MAX_CONCURRENCY = 'lots';
  assert(renderConcurrency() === 5, 'non-numeric → default 5');
}

if (prev === undefined) delete process.env.CRAWLEE_MAX_CONCURRENCY;
else process.env.CRAWLEE_MAX_CONCURRENCY = prev;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
