/**
 * Regression test for the scraper-state dependency injection
 * (lib/scraper/state.js ← server.js wiring).
 *
 * Production incident 2026-06-11: server.js called initScraper({ budget })
 * WITHOUT callAI, so state._callAI stayed null and every AI-extraction batch
 * threw `getCallAI(...) is not a function` — 0 lots from every house once the
 * AI extractor became the primary path. This test pins the contract:
 * initState must forward callAI (and extractPostcode), and server.js must
 * pass them.
 *
 * Run: node tests/test-scraper-state-wiring.js
 */

import { readFileSync } from 'fs';
import { initState, getCallAI, getExtractPostcode } from '../lib/scraper/state.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: initState forwards callAI and extractPostcode');
{
  const fakeAI = async () => 'ok';
  const fakePc = (a) => 'AB1 2CD';
  initState({ callAI: fakeAI, extractPostcode: fakePc });
  assert(getCallAI() === fakeAI, 'getCallAI() returns the injected function');
  assert(typeof getCallAI() === 'function', 'getCallAI() is callable');
  assert(getExtractPostcode() === fakePc, 'getExtractPostcode() returns the injected function');
}

console.log('\nTest 2: server.js wiring passes callAI into initScraper (source-level pin)');
{
  // A unit test can't boot server.js (needs env + DB), so pin the wiring at
  // source level: the initScraper call must include callAI. This is what
  // regressed — `initScraper({ budget })` — and what this test guards.
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const call = src.match(/initScraper\(\{[^}]*\}\)/s)?.[0] || '';
  assert(/\bcallAI\b/.test(call), `server.js initScraper call includes callAI (got: ${call || 'NO MATCH'})`);
  assert(/\bextractPostcode\b/.test(call), 'server.js initScraper call includes extractPostcode');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Scraper-state wiring tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
