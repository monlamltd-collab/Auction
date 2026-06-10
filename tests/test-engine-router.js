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

  v = chooseEngine({ isApi: true });
  assert(v.engine === ENGINES.API && v.reason === 'structured-api', 'isApi → api');

  v = chooseEngine({ isPdf: true });
  assert(v.engine === ENGINES.PDF_GEMINI && v.reason === 'pdf-catalogue', 'isPdf → pdf-gemini');

  // Phase 3: markdown-recogniser flag no longer pins to firecrawl (the Crawlee
  // path is recogniser-aware) — the house follows normal policy.
  v = chooseEngine({ hasMarkdownRecogniser: true, preferredEngine: ENGINES.CRAWLEE, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'learned-policy',
    'markdown-recogniser flag no longer pins to firecrawl');

  v = chooseEngine({ botProtected: true, preferredEngine: ENGINES.CRAWLEE, crawleeAvailable: true });
  assert(v.engine === ENGINES.FIRECRAWL && v.reason === 'bot-protected',
    'bot-protected pins to firecrawl even when policy says crawlee');
}

console.log('\nTest 2: chooseEngine — learned policy and default');
{
  let v = chooseEngine({ preferredEngine: ENGINES.CRAWLEE, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'learned-policy', 'preferred crawlee honoured when available');

  v = chooseEngine({ preferredEngine: ENGINES.FIRECRAWL, firecrawlAvailable: true });
  assert(v.engine === ENGINES.FIRECRAWL && v.reason === 'learned-policy', 'preferred firecrawl honoured');

  v = chooseEngine({});
  assert(v.engine === ENGINES.FIRECRAWL && v.reason === 'default', 'no policy → firecrawl default');

  // a junk/unknown preferred_engine is ignored, falls through to default
  v = chooseEngine({ preferredEngine: 'bogus' });
  assert(v.engine === ENGINES.FIRECRAWL && v.reason === 'default', 'unknown preferred engine ignored → default');
}

console.log('\nTest 3: chooseEngine — availability degradation never silently no-ops');
{
  // policy says crawlee but it isn't installed → degrade to firecrawl, reason annotated
  let v = chooseEngine({ preferredEngine: ENGINES.CRAWLEE, crawleeAvailable: false, firecrawlAvailable: true });
  assert(v.engine === ENGINES.FIRECRAWL && /crawlee-unavailable/.test(v.reason), 'crawlee down → firecrawl, reason notes it');

  // default firecrawl but budget exhausted, crawlee available → use crawlee
  v = chooseEngine({ firecrawlAvailable: false, crawleeAvailable: true });
  assert(v.engine === ENGINES.CRAWLEE && /firecrawl-exhausted/.test(v.reason), 'firecrawl exhausted → crawlee');

  // Phase 3 zero-credit failover: house NOT allowlisted (crawleeAvailable=false)
  // but crawlee installed + firecrawl exhausted → still fail over to crawlee.
  v = chooseEngine({ firecrawlAvailable: false, crawleeAvailable: false, crawleeInstalled: true });
  assert(v.engine === ENGINES.CRAWLEE && /firecrawl-exhausted/.test(v.reason),
    'firecrawl exhausted + crawlee installed (not allowlisted) → crawlee failover');

  // both down AND crawlee not installed → puppeteer last resort
  v = chooseEngine({ firecrawlAvailable: false, crawleeAvailable: false, crawleeInstalled: false });
  assert(v.engine === 'puppeteer' && /unavailable/.test(v.reason), 'no firecrawl, no crawlee → puppeteer fallback');
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

  assert(escalationTarget(ENGINES.CRAWLEE) === ENGINES.FIRECRAWL, 'crawlee escalates to firecrawl');
  assert(escalationTarget(ENGINES.FIRECRAWL) === null, 'firecrawl is top of ladder');
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
