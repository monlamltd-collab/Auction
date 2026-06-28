/**
 * Tests for the Crawlee click-to-load routing (lib/scraper/crawlee.js
 * clickToLoadEntryFor): host → entry resolution, and that adding SDL's
 * one-shot "All" page-size toggle did NOT change Bond Wolfe's existing
 * exhaustion-click entry.
 *
 * Run: node tests/test-crawlee-clicktoload.js
 */

import { clickToLoadEntryFor } from '../lib/scraper/crawlee.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: Bond Wolfe — unchanged exhaustion-click button (no text/once → defaults)');
{
  const e = clickToLoadEntryFor('https://www.bondwolfe.com/auctions/properties/');
  assert(e && e.selector === '#tjdPropertyLoadMore', 'bondwolfe selector is #tjdPropertyLoadMore');
  assert(e && e.text === undefined, 'bondwolfe has no text matcher (querySelectorAll[0])');
  assert(e && e.once === undefined, 'bondwolfe is NOT one-shot (clicks to exhaustion)');
  assert(e && e.waitMs === undefined, 'bondwolfe uses the default 900ms wait');
}

console.log('\nTest 2: SDL Auctions — one-shot text-matched "All" page-size toggle');
{
  const e = clickToLoadEntryFor('https://www.sdlauctions.co.uk/search/');
  assert(e && e.selector === 'a.pageLimit', 'sdl selector is a.pageLimit');
  assert(e && e.text === 'All', 'sdl picks the element whose text === "All"');
  assert(e && e.once === true, 'sdl is one-shot (the toggle does not vanish)');
  assert(e && e.waitMs === 9000, 'sdl waits 9s for the ajaxProp re-render');
}

console.log('\nTest 3: host matching is subdomain-tolerant and miss-safe');
{
  assert(clickToLoadEntryFor('https://online.sdlauctions.co.uk/x')?.text === 'All', 'subdomain online.sdlauctions.co.uk still matches');
  assert(clickToLoadEntryFor('https://www.example.com/') === null, 'unknown host → null (no click)');
  assert(clickToLoadEntryFor('not-a-url') === null, 'malformed URL → null, never throws');
  // guard against a substring false-match (e.g. a look-alike domain)
  assert(clickToLoadEntryFor('https://www.notsdlauctions.co.uk.evil.com/') === null, 'look-alike host does not match');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Crawlee click-to-load tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
