/**
 * Tests that a SYSTEMIC AI-extraction failure (every batch throws, zero lots)
 * surfaces as an `ai_extraction_failure` pipeline alert instead of vanishing
 * into console noise.
 *
 * Production incident 2026-06-11: callAI was never injected into scraper state,
 * so getCallAI()(…) threw a TypeError on EVERY batch fleet-wide. The only DB
 * evidence was 209 misleading "extractor_regression" alerts — nothing recorded
 * WHY extraction produced 0 lots. This test pins the alert.
 *
 * Run: node tests/test-extraction-failure-alert.js
 */

import { initState } from '../lib/scraper/state.js';
import { extractLotsWithAI } from '../lib/scraper/extraction.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Content must clear MIN_EXTRACTION_CONTENT_CHARS (the hallucination-guard
// floor, default 600) or the batch is skipped before the provider is ever
// called — which is correct behaviour, but this test needs the provider to be
// REACHED so it can throw. Space-padding doesn't survive stripHtml; use text.
const FILLER = ' Viewing strictly by appointment with the auctioneer. Buyer administration fees apply, see the legal pack for full conditions of sale.'.repeat(6);
const PAGES = [
  { page: 1, html: `<div>Lot 1 — 1 High Street, Testtown TT1 1AA — Guide £100,000.${FILLER}</div>` },
];

console.log('Test 1: un-wired callAI (the production bug) → [] + ai_extraction_failure alert');
{
  // state.js default: _callAI = null → getCallAI()(…) throws TypeError per batch.
  const alerts = [];
  const lots = await extractLotsWithAI(PAGES, 'testhouse', null, 'https://h.test/cat', {
    fireAlert: async (a) => { alerts.push(a); return { fired: true }; },
  });
  assert(Array.isArray(lots) && lots.length === 0, 'returns [] (no crash)');
  assert(alerts.length === 1, `exactly one alert fired (got ${alerts.length})`);
  assert(alerts[0]?.type === 'ai_extraction_failure', `alert type ai_extraction_failure (got ${alerts[0]?.type})`);
  assert(alerts[0]?.severity === 'error', 'severity error (systemic, not content-shaped)');
  assert(alerts[0]?.house === 'testhouse', 'alert carries the house');
  assert(/not a function|getCallAI/i.test(alerts[0]?.meta?.lastError || ''), `meta.lastError carries the TypeError (${alerts[0]?.meta?.lastError})`);
}

console.log('\nTest 2: provider throwing on every batch → [] + alert with the provider error');
{
  initState({ callAI: async () => { throw new Error('OpenRouter API error (google/gemini-2.5-flash-lite): 402 insufficient credits'); } });
  const alerts = [];
  const lots = await extractLotsWithAI(PAGES, 'testhouse2', null, 'https://h.test/cat', {
    fireAlert: async (a) => { alerts.push(a); },
  });
  assert(lots.length === 0, 'returns []');
  assert(alerts.length === 1 && /402/.test(alerts[0].meta.lastError), 'alert carries the provider error');
  assert(alerts[0].meta.batches === 1, `meta.batches counts the failed batches (got ${alerts[0].meta.batches})`);
}

console.log('\nTest 3: healthy extraction → lots out, NO failure alert');
{
  initState({
    callAI: async () => JSON.stringify([
      { lot: 1, address: '1 High Street, Testtown TT1 1AA', price: 100000, url: '/lot/1', status: 'available', bullets: [] },
    ]),
  });
  const alerts = [];
  const lots = await extractLotsWithAI(PAGES, 'testhouse3', null, 'https://h.test/cat', {
    fireAlert: async (a) => { alerts.push(a); },
  });
  assert(lots.length === 1, `extracted 1 lot (got ${lots.length})`);
  assert(lots[0].url === 'https://h.test/lot/1', 'relative lot URL resolved against catalogue');
  assert(alerts.length === 0, 'no failure alert on success');
}

console.log('\nTest 4: AI succeeds but page has no lots → [] and NO failure alert (content-shaped, not systemic)');
{
  initState({ callAI: async () => '[]' });
  const alerts = [];
  const lots = await extractLotsWithAI(PAGES, 'testhouse4', null, 'https://h.test/cat', {
    fireAlert: async (a) => { alerts.push(a); },
  });
  assert(lots.length === 0, 'returns []');
  assert(alerts.length === 0, 'no alert — zero lots from a HEALTHY call is the regression path, not this one');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Extraction failure-alert tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
