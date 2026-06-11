/**
 * Tests for the Crawlee promise bridge (lib/scraper/crawlee.js): per-request
 * timeout + pending cleanup, crawler-death recovery (reject in-flight, fresh
 * crawler on next request), failedRequestHandler rejection, and teardown
 * rejecting (not dropping) outstanding promises.
 *
 * Production incident 2026-06-11 (Crawlee-primary trial): the runbook's answer
 * to a dead crawler was "restart the service" — these tests pin the automatic
 * recovery that replaces it.
 *
 * Run: node tests/test-crawlee-bridge.js
 */

import {
  scrapeWithCrawlee,
  teardownCrawlee,
  hasCrawlee,
  __setCrawleeImplForTest,
  __pendingCountForTest,
} from '../lib/scraper/crawlee.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}
const tick = () => new Promise(r => setTimeout(r, 20));

// A fake PuppeteerCrawler. run() stays pending (keepAlive) until the test
// kills it via _die()/_end(). addRequests() queues; the test dispatches each
// request through the real requestHandler/failedRequestHandler options.
class FakeCrawler {
  constructor(opts) {
    this.opts = opts;
    this.queued = [];
    this._runSettle = {};
    this.runPromise = new Promise((res, rej) => { this._runSettle = { res, rej }; });
    FakeCrawler.instances.push(this);
  }
  run() { return this.runPromise; }
  async addRequests(reqs) { this.queued.push(...reqs); }
  async teardown() { this.toreDown = true; }
  _die(err) { this._runSettle.rej(err); }
  _end() { this._runSettle.res(); }
  // Drive one queued request through the real handler with a stub page.
  async dispatch(request, { fail = null } = {}) {
    if (fail) return this.opts.failedRequestHandler({ request }, fail);
    const page = {
      setUserAgent: async () => {},
      setViewport: async () => {},
      goto: async () => {},
      evaluate: async () => {},
      content: async () => '<html><body>rendered ok</body></html>',
      url: () => 'https://final.example/page',
    };
    return this.opts.requestHandler({ page, request });
  }
}
FakeCrawler.instances = [];

const restore = __setCrawleeImplForTest({ crawlerClass: FakeCrawler });

console.log('Test 1: happy path — requestHandler resolves the bridge promise');
{
  assert(hasCrawlee() === true, 'hasCrawlee true with injected impl');
  const p = scrapeWithCrawlee('https://h.test/cat', { timeoutMs: 5000 });
  await tick();
  const crawlerInst = FakeCrawler.instances[0];
  assert(crawlerInst.queued.length === 1, 'request queued on the crawler');
  await crawlerInst.dispatch(crawlerInst.queued[0]);
  const result = await p;
  assert(/rendered ok/.test(result.html), 'resolved with rendered HTML');
  assert(result.sourceURL === 'https://final.example/page', 'resolved with final URL');
  assert(__pendingCountForTest() === 0, 'pending map cleaned after resolve');
}

console.log('\nTest 2: failedRequestHandler rejects the bridge promise');
{
  const p = scrapeWithCrawlee('https://h.test/403', { timeoutMs: 5000 });
  await tick();
  const crawlerInst = FakeCrawler.instances[0];
  await crawlerInst.dispatch(crawlerInst.queued[1], { fail: new Error('HTTP 403') });
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert(err && /403/.test(err.message), `rejected with the failure (${err?.message})`);
  assert(__pendingCountForTest() === 0, 'pending map cleaned after reject');
}

console.log('\nTest 3: bridge timeout — starved request rejects and cleans up');
{
  const p = scrapeWithCrawlee('https://h.test/starved', { timeoutMs: 40 });
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert(err && /timed out/.test(err.message), `timed out (${err?.message})`);
  assert(__pendingCountForTest() === 0, 'pending entry removed on timeout (no leak)');
}

console.log('\nTest 4: late handler after timeout is a harmless no-op');
{
  const p = scrapeWithCrawlee('https://h.test/late', { timeoutMs: 40 });
  await tick();
  const crawlerInst = FakeCrawler.instances[0];
  const req = crawlerInst.queued[crawlerInst.queued.length - 1];
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert(err && /timed out/.test(err.message), 'caller saw the timeout');
  // The crawler finally gets to the request AFTER the caller gave up.
  await crawlerInst.dispatch(req); // must not throw
  assert(true, 'late dispatch did not throw');
}

console.log('\nTest 5: crawler death — in-flight renders reject, next request relaunches');
{
  const before = FakeCrawler.instances.length;
  const p = scrapeWithCrawlee('https://h.test/inflight', { timeoutMs: 5000 });
  await tick();
  FakeCrawler.instances[before - 1]._die(new Error('chromium oom-killed'));
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert(err && /crawler died/i.test(err.message), `in-flight render rejected on death (${err?.message})`);
  assert(__pendingCountForTest() === 0, 'pending map drained on death');

  // Next render must transparently build a FRESH crawler.
  const p2 = scrapeWithCrawlee('https://h.test/after-death', { timeoutMs: 5000 });
  await tick();
  assert(FakeCrawler.instances.length === before + 1, `fresh crawler launched (${FakeCrawler.instances.length} instances)`);
  const fresh = FakeCrawler.instances[FakeCrawler.instances.length - 1];
  await fresh.dispatch(fresh.queued[0]);
  const r2 = await p2;
  assert(/rendered ok/.test(r2.html), 'render works again after auto-restart');
}

console.log('\nTest 6: keepAlive run() RESOLVING (not just rejecting) also triggers recovery');
{
  const before = FakeCrawler.instances.length;
  const p = scrapeWithCrawlee('https://h.test/quiet-end', { timeoutMs: 5000 });
  await tick();
  FakeCrawler.instances[before - 1]._end();
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert(err && /crawler died/i.test(err.message), 'quiet run() end rejects in-flight renders');
}

console.log('\nTest 7: teardown rejects outstanding renders instead of dropping them');
{
  const p = scrapeWithCrawlee('https://h.test/torn', { timeoutMs: 5000 });
  await tick();
  await teardownCrawlee();
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert(err && /torn down/i.test(err.message), `teardown rejected the caller (${err?.message})`);
  assert(__pendingCountForTest() === 0, 'pending map empty after teardown');
}

restore();

console.log(`\n${'═'.repeat(50)}`);
console.log(`Crawlee bridge tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
