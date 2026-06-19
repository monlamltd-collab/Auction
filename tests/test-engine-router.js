/**
 * Pure-function tests for the best-engine-first router
 * (lib/scraper/engine-router.js). The router is pure — every signal is
 * injected — so this file fully exercises the decision logic, the strict
 * recall-parity demotion gate, escalation, and the stats reducers.
 *
 * Run: node tests/test-engine-router.js
 */

import {
  ENGINES,
  chooseEngine,
  recallRatio,
  shouldDemote,
  shouldEscalate,
  escalationTarget,
  recordEngineOutcome,
  engineScore,
} from '../lib/scraper/engine-router.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── chooseEngine: deterministic overrides ──────────────────────────────────
console.log('Test 1: chooseEngine — deterministic overrides win in priority order');
{
  // manual lock beats everything, even structure
  let v = chooseEngine({ manualEngine: ENGINES.CRAWLEE, isApi: true, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'manual-lock', 'engine_locked wins over isApi');

  // A lock is ABSOLUTE: a firecrawl-locked house must NOT fail over to crawlee
  // on exhaustion (the operator locked it off crawlee on purpose) — degrade to
  // puppeteer instead.
  v = chooseEngine({ manualEngine: ENGINES.FIRECRAWL, firecrawlAvailable: false, crawleeInstalled: true });
  assert(v.engine === 'puppeteer' && /manual-lock/.test(v.reason),
    'firecrawl lock does NOT fail over to crawlee on exhaustion → puppeteer');

  v = chooseEngine({ isApi: true });
  assert(v.engine === ENGINES.API && v.reason === 'structured-api', 'isApi → api');

  v = chooseEngine({ isPdf: true });
  assert(v.engine === ENGINES.PDF_GEMINI && v.reason === 'pdf-catalogue', 'isPdf → pdf-gemini');

  // Phase 3: markdown-recogniser flag no longer pins to firecrawl (the Crawlee
  // path is recogniser-aware) — the house follows normal policy.
  v = chooseEngine({ hasMarkdownRecogniser: true, preferredEngine: ENGINES.CRAWLEE, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'learned-policy',
    'markdown-recogniser flag no longer pins to firecrawl');

  v = chooseEngine({ botProtected: true, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'bot-protected',
    'bot-protected routes to crawlee (firecrawl is CF-bypass-only, off the router)');
}

console.log('\nTest 2: chooseEngine — learned policy and default (crawlee-only)');
{
  let v = chooseEngine({ preferredEngine: ENGINES.CRAWLEE, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'learned-policy', 'preferred crawlee honoured when available');

  // Firecrawl is no longer a selectable engine — a firecrawl policy is ignored
  // and the house falls through to the crawlee default.
  v = chooseEngine({ preferredEngine: ENGINES.FIRECRAWL, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'default', 'firecrawl policy ignored → crawlee default');

  v = chooseEngine({ crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'default', 'no policy → crawlee default');

  // Nothing installed at all → local puppeteer tier is the last resort.
  v = chooseEngine({});
  assert(v.engine === 'puppeteer', 'no policy + crawlee not installed → puppeteer last resort');

  // CRAWLEE_DEFAULT keeps its explicit reason string…
  v = chooseEngine({ crawleeIsDefault: true, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'config-default', 'crawleeIsDefault → crawlee (config-default)');
  // …but never overrides structural/locked policy.
  v = chooseEngine({ crawleeIsDefault: true, crawleeAvailable: true, isApi: true });
  assert(v.engine === ENGINES.API, 'config-default does not override api');
  v = chooseEngine({ crawleeIsDefault: true, crawleeAvailable: true, botProtected: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'bot-protected', 'bot-protected resolves before config-default (to crawlee)');
  v = chooseEngine({ crawleeIsDefault: true, crawleeAvailable: true, manualEngine: ENGINES.FIRECRAWL, firecrawlAvailable: true });
  assert(v.engine === ENGINES.FIRECRAWL && v.reason === 'manual-lock', 'config-default does not override engine_locked (operator escape hatch)');

  // a junk/unknown preferred_engine is ignored, falls through to crawlee default
  v = chooseEngine({ preferredEngine: 'bogus', crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'default', 'unknown preferred engine ignored → crawlee default');
}

console.log('\nTest 3: chooseEngine — availability degradation never silently no-ops');
{
  // policy says crawlee but it isn't installed at all → local puppeteer tier
  let v = chooseEngine({ preferredEngine: ENGINES.CRAWLEE, crawleeAvailable: false, crawleeInstalled: false });
  assert(v.engine === 'puppeteer' && /crawlee-unavailable/.test(v.reason), 'crawlee desired, not installed → puppeteer');

  // crawlee installed but the house isn't allowlisted → still crawlee (it's the
  // only managed scraping engine now — no firecrawl fallback).
  v = chooseEngine({ preferredEngine: ENGINES.CRAWLEE, crawleeAvailable: false, crawleeInstalled: true });
  assert(v.engine === ENGINES.CRAWLEE && /not-allowlisted/.test(v.reason), 'crawlee installed but not allowlisted → still crawlee');

  // default routes to crawlee whenever it's available
  v = chooseEngine({ crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE, 'default → crawlee when available');

  // nothing available AND crawlee not installed → puppeteer last resort
  v = chooseEngine({ crawleeAvailable: false, crawleeInstalled: false });
  assert(v.engine === 'puppeteer' && /unavailable/.test(v.reason), 'no crawlee installed → puppeteer fallback');
}

// ── recallRatio ────────────────────────────────────────────────────────────
console.log('\nTest 4: recallRatio');
{
  assert(recallRatio({ extractedLots: 38, sentinelLots: 38 }) === 1, 'full recall = 1');
  assert(recallRatio({ extractedLots: 19, sentinelLots: 38 }) === 0.5, 'half recall = 0.5');
  assert(recallRatio({ extractedLots: 5, sentinelLots: 0 }) === null, 'no sentinel → null');
  assert(recallRatio({ extractedLots: 50, sentinelLots: 38 }) === 1, 'over-extraction clamps to 1');
}

// ── shouldDemote: STRICT recall parity ─────────────────────────────────────
console.log('\nTest 5: shouldDemote — strict recall parity (the operator-chosen policy)');
{
  // identical recall + lots → demote to the cheaper challenger
  let v = shouldDemote({ incumbentRecall: 0.95, challengerRecall: 0.95, incumbentLots: 40, challengerLots: 40 });
  assert(v.demote === true && /recall-parity/.test(v.reason), 'equal recall → demote');

  // challenger strictly better → demote
  v = shouldDemote({ incumbentRecall: 0.9, challengerRecall: 0.97, incumbentLots: 40, challengerLots: 41 });
  assert(v.demote === true, 'better recall → demote');

  // challenger even slightly worse → DO NOT demote (strict, tolerance 0)
  v = shouldDemote({ incumbentRecall: 0.95, challengerRecall: 0.94, incumbentLots: 40, challengerLots: 40 });
  assert(v.demote === false && /recall-shortfall/.test(v.reason), '1% worse recall → keep incumbent');

  // equal recall but fewer lots → do not demote
  v = shouldDemote({ incumbentRecall: 1, challengerRecall: 1, incumbentLots: 40, challengerLots: 39 });
  assert(v.demote === false && /fewer-lots/.test(v.reason), 'equal recall but fewer lots → keep incumbent');

  // too little signal → do not demote
  v = shouldDemote({ incumbentRecall: 1, challengerRecall: 1, incumbentLots: 3, challengerLots: 3 });
  assert(v.demote === false && /too-few-lots/.test(v.reason), 'below minLots → keep incumbent');

  // missing recall signal → do not demote
  v = shouldDemote({ incumbentRecall: null, challengerRecall: 1, incumbentLots: 40, challengerLots: 40 });
  assert(v.demote === false && /insufficient-recall-signal/.test(v.reason), 'null recall → keep incumbent');
}

// ── escalation ──────────────────────────────────────────────────────────────
console.log('\nTest 6: shouldEscalate + escalationTarget');
{
  let v = shouldEscalate({ recall: 0.6, floor: 0.85 });
  assert(v.escalate === true && /below-floor/.test(v.reason), 'recall below floor → escalate');

  v = shouldEscalate({ recall: 0.9, floor: 0.85 });
  assert(v.escalate === false, 'recall above floor → stay');

  v = shouldEscalate({ recall: null });
  assert(v.escalate === false && /no-recall-signal/.test(v.reason), 'no signal → do not escalate');

  assert(escalationTarget(ENGINES.CRAWLEE) === null, 'crawlee has no escalation target (firecrawl is off the router)');
}

// ── stats reducers ──────────────────────────────────────────────────────────
console.log('\nTest 7: recordEngineOutcome + engineScore (pure, no mutation)');
{
  const s0 = {};
  const s1 = recordEngineOutcome(s0, ENGINES.CRAWLEE, { success: true, recall: 1.0, credits: 0 });
  assert(Object.keys(s0).length === 0, 'input stats not mutated');
  assert(s1.crawlee.runs === 1 && s1.crawlee.successes === 1, 'first run recorded');

  const s2 = recordEngineOutcome(s1, ENGINES.CRAWLEE, { success: false, recall: 0.5, credits: 0 });
  assert(s2.crawlee.runs === 2 && s2.crawlee.successes === 1, 'second run folds in');

  const sc = engineScore(s2.crawlee);
  assert(sc.successRate === 0.5, 'success rate 1/2');
  assert(Math.abs(sc.avgRecall - 0.75) < 1e-9, 'avg recall (1.0+0.5)/2 = 0.75');

  // recall=null runs do not pollute the recall average
  const s3 = recordEngineOutcome(s2, ENGINES.CRAWLEE, { success: true, recall: null });
  assert(s3.crawlee.recallRuns === 2, 'null-recall run not counted in recallRuns');
  assert(Math.abs(engineScore(s3.crawlee).avgRecall - 0.75) < 1e-9, 'avg recall unchanged by null run');

  assert(engineScore({}).runs === 0 && engineScore({}).successRate === null, 'empty stats → null scorecard');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Engine router tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
