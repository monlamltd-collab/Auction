/**
 * Tests for the shared engine-decision seam (lib/pipeline/engine-decision.js).
 * Verifies the config gate (dormant → allowlist → default) and that
 * resolveEngineForHouse composes chooseEngine correctly from live signals —
 * crucially that override houses (markdown recogniser, API, PDF) never route
 * to Crawlee.
 *
 * Run: node tests/test-engine-decision.js
 */

import { isCrawleeEnabled, isShadowMode, resolveEngineForHouse } from '../lib/pipeline/engine-decision.js';
import { ENGINES } from '../lib/scraper/engine-router.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Restore env between cases.
const ENV_KEYS = ['CRAWLEE_DEFAULT', 'CRAWLEE_HOUSES', 'CRAWLEE_SHADOW'];
const saved = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
function resetEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

// deps where crawlee is "installed" and firecrawl is up.
const upDeps = { hasCrawlee: () => true, canUseFirecrawl: () => true, isPdfUrl: () => false };

console.log('Test 1: isCrawleeEnabled — allowlist + default switch');
{
  resetEnv();
  assert(isCrawleeEnabled('astleys') === false, 'no config → disabled');
  process.env.CRAWLEE_HOUSES = 'astleys, brownco';
  assert(isCrawleeEnabled('astleys') === true, 'allowlisted house enabled (whitespace tolerant)');
  assert(isCrawleeEnabled('stags') === false, 'non-allowlisted house disabled');
  process.env.CRAWLEE_DEFAULT = 'true';
  assert(isCrawleeEnabled('stags') === true, 'CRAWLEE_DEFAULT=true enables every house');
  resetEnv();
}

console.log('\nTest 2: isShadowMode — default ON, opt out');
{
  resetEnv();
  assert(isShadowMode() === true, 'default shadow mode on');
  process.env.CRAWLEE_SHADOW = 'false';
  assert(isShadowMode() === false, 'CRAWLEE_SHADOW=false opts out');
  resetEnv();
}

console.log('\nTest 3: markdown-recogniser house CAN route to Crawlee (Phase 3)');
{
  resetEnv();
  process.env.CRAWLEE_HOUSES = 'pattinson';
  // The Crawlee path is now recogniser-aware (turndown bridge), so a promoted
  // recogniser house routes to crawlee — no longer pinned to firecrawl.
  const v = resolveEngineForHouse({
    house: 'pattinson',
    rewritten: { paginateAs: 'pattinson_p' },
    engineSkill: { preferred_engine: 'crawlee' },
    hasMarkdownRecogniser: true,
  }, upDeps);
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'learned-policy',
    'recogniser house with crawlee policy routes to crawlee (recogniser-aware path)');
  resetEnv();
}

console.log('\nTest 3b: zero-credit failover — any house → Crawlee when Firecrawl exhausted');
{
  resetEnv();
  // House NOT in CRAWLEE_HOUSES, no policy, but crawlee installed + firecrawl down.
  const v = resolveEngineForHouse({
    house: 'somehouse',
    rewritten: {},
  }, { hasCrawlee: () => true, canUseFirecrawl: () => false, isPdfUrl: () => false });
  assert(v.engine === ENGINES.CRAWLEE && /firecrawl-exhausted/.test(v.reason),
    'firecrawl exhausted → crawlee failover even for non-allowlisted house');
  resetEnv();
}

console.log('\nTest 4: allowlisted platform house with crawlee policy → crawlee');
{
  resetEnv();
  process.env.CRAWLEE_HOUSES = 'astleys';
  const v = resolveEngineForHouse({
    house: 'astleys',
    rewritten: { paginateAs: 'query_page' },
    engineSkill: { preferred_engine: 'crawlee' },
  }, upDeps);
  assert(v.engine === ENGINES.CRAWLEE && v.reason === 'learned-policy', 'promoted+allowlisted → crawlee');
  resetEnv();
}

console.log('\nTest 5: crawlee policy but house NOT allowlisted → degrade to firecrawl');
{
  resetEnv();
  // astleys not in allowlist → isCrawleeEnabled false → crawleeAvailable false
  const v = resolveEngineForHouse({
    house: 'astleys',
    rewritten: {},
    engineSkill: { preferred_engine: 'crawlee' },
  }, upDeps);
  assert(v.engine === ENGINES.FIRECRAWL && /crawlee-unavailable/.test(v.reason),
    'not allowlisted → crawlee unavailable → firecrawl, reason annotated');
  resetEnv();
}

console.log('\nTest 6: structural overrides (API, PDF, lock) win');
{
  resetEnv();
  process.env.CRAWLEE_HOUSES = 'allsop,somepdfhouse,lockedhouse';

  let v = resolveEngineForHouse({ house: 'allsop', rewritten: { paginateAs: 'allsop_api' } }, upDeps);
  assert(v.engine === ENGINES.API, 'allsop_api → api engine');

  v = resolveEngineForHouse({ house: 'somepdfhouse', rewritten: {}, catalogueUrl: 'https://x/cat.pdf' },
    { ...upDeps, isPdfUrl: () => true });
  assert(v.engine === ENGINES.PDF_GEMINI, 'pdf catalogue → pdf-gemini');

  v = resolveEngineForHouse({
    house: 'lockedhouse',
    rewritten: {},
    engineSkill: { engine_locked: 'firecrawl', preferred_engine: 'crawlee' },
  }, upDeps);
  assert(v.engine === ENGINES.FIRECRAWL && v.reason === 'manual-lock', 'engine_locked wins over policy');
  resetEnv();
}

// restore original env
for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }

console.log(`\n${'═'.repeat(50)}`);
console.log(`Engine decision tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
