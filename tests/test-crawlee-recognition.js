/**
 * Tests the Phase 3 turndown→recogniser bridge in renderAndExtractWithCrawlee:
 * lots the Gemini extractor misses are recovered from the turndown markdown of
 * Crawlee-rendered HTML, merged, and reflected in recall.
 *
 * Run: node tests/test-crawlee-recognition.js
 */

import { renderAndExtractWithCrawlee } from '../lib/pipeline/crawlee-extract.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const SENTINEL = /\/lot\/(\d+)/g;

// Rendered page advertises lots 1,2,3 via detail links; Gemini only gets 1 & 2.
const fakeRender = async () => ([{
  page: 1,
  html: '<div><a href="/lot/1">One</a><a href="/lot/2">Two</a><a href="/lot/3">Three</a></div>',
}]);
const fakeExtract = async () => ([
  { lot: 1, address: '1 First Street, Townsville, AB1 2CD', url: 'https://x.test/lot/1', price: 100000 },
  { lot: 2, address: '2 Second Street, Townsville, AB1 2CD', url: 'https://x.test/lot/2', price: 200000 },
]);
// Recogniser recovers lot 3 from the markdown (keyed by sentinel id).
const recogniser = (md) => {
  const m = new Map();
  if (/\/lot\/3/.test(md)) m.set("3", { lot_number: 3, address: '3 Third Street, Townsville, AB1 2CD', url: 'https://x.test/lot/3', price: 300000 });
  return m;
};

console.log('Test 1: recogniser recovers the lot Gemini missed');
{
  const r = await renderAndExtractWithCrawlee('https://x.test/cat', 'johnpye', {
    recallSentinelPattern: SENTINEL,
    recogniseFromMarkdown: recogniser,
  }, { scrapeAllPagesWithCrawlee: fakeRender, extractLotsWithAI: fakeExtract });

  assert(r.lots.length === 3, `merged to 3 lots (got ${r.lots.length})`);
  assert(r.recognised === 1, `recognised 1 recovered lot (got ${r.recognised})`);
  assert(r.lots.some(l => l.lot === 3), 'recovered lot 3 present');
  assert(r.sentinelLots === 3, `sentinel saw 3 advertised lots (got ${r.sentinelLots})`);
  assert(r.recall === 1, `recall 100% after recovery (got ${r.recall})`);
}

console.log('\nTest 2: no recogniser → no recovery (Gemini-only)');
{
  const r = await renderAndExtractWithCrawlee('https://x.test/cat', 'astleys', {
    recallSentinelPattern: SENTINEL,
  }, { scrapeAllPagesWithCrawlee: fakeRender, extractLotsWithAI: fakeExtract });
  assert(r.lots.length === 2, 'only the 2 Gemini lots');
  assert(r.recognised === 0, 'nothing recognised');
  assert(Math.abs(r.recall - 2 / 3) < 1e-9, 'recall 2/3 (HTML sentinel denominator)');
}

console.log('\nTest 3: recogniser does not duplicate a lot Gemini already found');
{
  const dupRecogniser = (md) => {
    const m = new Map();
    if (/\/lot\/3/.test(md)) m.set("3", { lot_number: 3, address: '3 Third Street, Townsville, AB1 2CD', url: 'https://x.test/lot/3', price: 300000 });
    // Also (wrongly) offers lot 1 which Gemini already has — must be deduped.
    m.set("1", { lot_number: 1, address: '1 First Street, Townsville, AB1 2CD', url: 'https://x.test/lot/1', price: 100000 });
    return m;
  };
  const r = await renderAndExtractWithCrawlee('https://x.test/cat', 'johnpye', {
    recallSentinelPattern: SENTINEL,
    recogniseFromMarkdown: dupRecogniser,
  }, { scrapeAllPagesWithCrawlee: fakeRender, extractLotsWithAI: fakeExtract });
  assert(r.lots.length === 3, `still 3 lots, no duplicate (got ${r.lots.length})`);
  assert(r.recognised === 1, 'only the genuinely-missing lot recovered');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Crawlee recognition tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
