/**
 * Tests for the Crawlee multi-page renderer (lib/scraper/crawlee-render.js):
 * per-house pagination scheme (the Pattinson ?p=N bug), stop-on-identical-page
 * (mis-pagination guard), the MAX_PUPPETEER_PAGES memory cap, prefetched page 1
 * reuse, and the render deadline. (PR #67 review F1/F2/F10)
 *
 * Run: node tests/test-crawlee-render.js
 */

import { scrapeAllPagesWithCrawlee } from '../lib/scraper/crawlee-render.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// A fake renderer that records the URLs it was asked to render and returns
// distinct, paginated HTML so detectTotalPages sees "page N of 5".
function makeFake({ totalPages = 5, identicalAfter = Infinity } = {}) {
  const calls = [];
  const scrapeWithCrawlee = async (u) => {
    calls.push(u);
    // page index from ?p= / ?page= / default 1
    const m = u.match(/[?&](?:p|page)=(\d+)/);
    const idx = m ? parseInt(m[1]) : 1;
    // A mis-paginated URL (wrong scheme) silently returns PAGE 1 again — model
    // that by serving page 1's exact body for any page beyond identicalAfter.
    const effective = idx > identicalAfter ? 1 : idx;
    const body = `<div>lot for page ${effective}</div> page ${effective} of ${totalPages}`.padEnd(800, 'x');
    return { html: body, sourceURL: u };
  };
  return { scrapeWithCrawlee, calls };
}

console.log('Test 1: Pattinson uses ?p=N (paginateAs=pattinson_p), NOT ?page=N');
{
  const fake = makeFake({ totalPages: 3 });
  const pages = await scrapeAllPagesWithCrawlee('https://www.pattinson.co.uk/auction', 'pattinson',
    { maxPages: 3, paginateAs: 'pattinson_p' }, fake);
  assert(pages.length === 3, `rendered 3 pages (got ${pages.length})`);
  assert(fake.calls.some(u => u.includes('?p=2')), 'page 2 built as ?p=2');
  assert(!fake.calls.some(u => u.includes('page=2')), 'never built the wrong ?page=2');
}

console.log('\nTest 2: stop-on-identical — a mis-paginated URL returning page 1 repeatedly halts');
{
  // identicalAfter:1 → every page >1 returns the same content
  const fake = makeFake({ totalPages: 5, identicalAfter: 1 });
  const pages = await scrapeAllPagesWithCrawlee('https://h.test/cat', 'someplatform',
    { maxPages: 5, paginateAs: 'query_page' }, fake);
  assert(pages.length === 1, `stopped after the first identical repeat (got ${pages.length} pages)`);
}

console.log('\nTest 3: MAX_PUPPETEER_PAGES (15) caps even when registry maxPages=84');
{
  const fake = makeFake({ totalPages: 84 });
  const pages = await scrapeAllPagesWithCrawlee('https://www.pattinson.co.uk/auction', 'pattinson',
    { maxPages: 84, paginateAs: 'pattinson_p' }, fake);
  assert(pages.length <= 15, `capped at 15 pages (got ${pages.length})`);
}

console.log('\nTest 4: prefetched page 1 is reused (no re-render of page 1)');
{
  const fake = makeFake({ totalPages: 2 });
  const prefetched = { html: '<div>prefetched page 1</div> page 1 of 2'.padEnd(800, 'x'), sourceURL: 'https://h.test/cat' };
  const pages = await scrapeAllPagesWithCrawlee('https://h.test/cat', 'someplatform',
    { maxPages: 2, paginateAs: 'query_page', prefetchedPage1: prefetched }, fake);
  assert(/prefetched page 1/.test(pages[0].html), 'page 1 is the prefetched HTML');
  assert(!fake.calls.includes('https://h.test/cat'), 'page-1 URL was never re-rendered');
}

console.log('\nTest 5: render deadline stops adding pages');
{
  const fake = makeFake({ totalPages: 10 });
  // deadline already passed → only page 1 (prefetched-free first render) survives
  const pages = await scrapeAllPagesWithCrawlee('https://h.test/cat', 'someplatform',
    { maxPages: 10, paginateAs: 'query_page', deadlineAt: Date.now() - 1 }, fake);
  assert(pages.length === 1, `deadline halted pagination at page 1 (got ${pages.length})`);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Crawlee render tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
