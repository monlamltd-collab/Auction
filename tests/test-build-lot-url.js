// tests/test-build-lot-url.js — the page-as-a-lot guard leak (2026-07-22).
//
// buildLotUrl(lot, house, sourceUrl) used to end with `return lot.url || sourceUrl`,
// stamping the CATALOGUE URL onto any lot the extractor couldn't attach a URL to
// (degraded runs — chiefly the AI extractor path, which never reaches the
// isNonLotUrl guard in normaliseScrapedLot). Because lots.url is UNIQUE, a whole
// degraded batch collapsed onto one page-identity row that was then served as a
// fake `available` lot. The fix: return '' for a urlless lot, so persist mints a
// stable synthetic key and matches the lot to its real-URL twin by property key.
//
// This pins the contract of buildLotUrl itself: a real lot URL passes through, a
// relative one is resolved, but a MISSING one NEVER becomes the catalogue URL.
//
// Run: node tests/test-build-lot-url.js

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

import { buildLotUrl } from '../lib/enrichment.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const CAT = 'https://www.house.co.uk/auctions/28-july-2026';

console.log('Test 1: a urlless lot NEVER inherits the catalogue URL');
{
  for (const [label, lot] of [
    ['empty string', { url: '', address: '1 High St' }],
    ['null', { url: null, address: '1 High St' }],
    ['undefined', { address: '1 High St' }],
  ]) {
    const out = buildLotUrl(lot, 'somehouse', CAT);
    assert(out === '', `${label} → '' (got ${JSON.stringify(out)})`);
    assert(out !== CAT, `${label} is not the catalogue URL`);
  }
}

console.log('\nTest 2: a real absolute lot URL passes through unchanged');
{
  const url = 'https://www.house.co.uk/auctions/28-july-2026/707836/';
  assert(buildLotUrl({ url, address: 'x' }, 'somehouse', CAT) === url,
    'absolute lot URL returned verbatim');
}

console.log('\nTest 3: the sourceUrl argument no longer leaks in as a fallback');
{
  // Even when sourceUrl is a perfectly good page, a lot with no URL of its own
  // must not adopt it — that was the whole bug.
  assert(buildLotUrl({ address: 'x' }, 'somehouse', CAT) !== CAT,
    'no-url lot does not adopt sourceUrl');
  assert(buildLotUrl({ address: 'x' }, 'somehouse', '') === '',
    'no-url lot with no sourceUrl is empty (unchanged)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
