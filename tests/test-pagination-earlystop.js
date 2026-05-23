/**
 * Pure-function tests for catalogueEndReached in lib/pipeline/firecrawl-extract.js.
 *
 * Locks the early-stop pagination cutoff: a run of EMPTY_PAGE_RUN (3)
 * consecutive empty pages signals end-of-catalogue. An error page is
 * inconclusive and must NOT trigger an early stop — otherwise a transient
 * Firecrawl failure could silently truncate the catalogue.
 *
 * Run: node tests/test-pagination-earlystop.js
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { catalogueEndReached, EMPTY_PAGE_RUN } = await import('../lib/pipeline/firecrawl-extract.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Page-result shape shorthand.
const empty = () => ({ url: 'x', lots: [], markdown: '' });
const withLots = () => ({ url: 'x', lots: [{ lot: 1, address: 'a' }], markdown: '' });
const errored = (err = 'boom') => ({ url: 'x', lots: [], markdown: '', error: err });

console.log(`Test setup: EMPTY_PAGE_RUN = ${EMPTY_PAGE_RUN}`);
assert(EMPTY_PAGE_RUN === 3, 'EMPTY_PAGE_RUN is 3 (the documented threshold)');

console.log('\nTest 1: fewer than EMPTY_PAGE_RUN pages → never stop');
{
  assert(!catalogueEndReached([]), 'empty array → false');
  assert(!catalogueEndReached([empty()]), '1 empty page → false');
  assert(!catalogueEndReached([empty(), empty()]), '2 empty pages → false');
}

console.log('\nTest 2: 3 consecutive empty pages → stop');
{
  assert(catalogueEndReached([empty(), empty(), empty()]), '3 empties → true');
}

console.log('\nTest 3: any of the last 3 has lots → do not stop');
{
  assert(!catalogueEndReached([empty(), empty(), withLots()]), 'last page has lots → false');
  assert(!catalogueEndReached([empty(), withLots(), empty()]), 'middle of last 3 has lots → false');
  assert(!catalogueEndReached([withLots(), empty(), empty()]), 'first of last 3 has lots → false');
}

console.log('\nTest 4: error pages are inconclusive — they do NOT count as empty');
{
  assert(!catalogueEndReached([empty(), errored(), empty()]), 'error breaks an otherwise-empty run');
  assert(!catalogueEndReached([errored(), errored(), errored()]), '3 errors → false (not real empties)');
}

console.log('\nTest 5: longer catalogues — only the trailing window matters');
{
  // Content, then a clear tail of 3 empties.
  const ending = [withLots(), withLots(), withLots(), empty(), empty(), empty()];
  assert(catalogueEndReached(ending), 'content then 3-empty tail → true');

  // All lots — no stop.
  assert(!catalogueEndReached([withLots(), withLots(), withLots(), withLots()]), 'all lots → false');

  // Empties earlier, content later — last 3 have lots → no stop.
  const recovered = [empty(), empty(), empty(), withLots(), withLots(), withLots()];
  assert(!catalogueEndReached(recovered), 'empties followed by content → false');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
