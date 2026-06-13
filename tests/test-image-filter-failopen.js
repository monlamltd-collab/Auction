// tests/test-image-filter-failopen.js — regression for the 2026-06-13
// incident's final layer: classifyImage returns verdict 'unknown' whenever it
// cannot SEE the image (fetch blocked / timeout / Gemini error), and
// filterImages discarded every 'unknown' despite the in-code comment saying
// failures must not discard. hollismorgan's CDN 403s non-browser fetches from
// Railway, so every catalogue image was wiped on every scrape (0/71 images
// persisted while the page carried 73/73).
//
// Contract: 'unknown' fails OPEN (kept, never preferred as primary); only
// affirmative junk verdicts (logo/banner/stock_photo/...) are discarded.
//
// Offline-safe: an unreachable URL makes classifyImage fail at fetch() before
// any Gemini call, so no API key or network is needed.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { filterImages, filterMainImage, classifyImage, __resetImageFilterBreakerForTest } = await import('../lib/pipeline/image-quality-filter.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const UNFETCHABLE = 'https://localhost.invalid/resize/34641077/0/480.pagespeed.ce.jpg';

console.log('Test 1: unfetchable image is kept, not discarded');
{
  const r = await filterImages([UNFETCHABLE]);
  assert(r.keep.length === 1 && r.keep[0] === UNFETCHABLE, `kept (got keep=${JSON.stringify(r.keep)})`);
  assert(r.discard.length === 0, `not discarded (got discard=${JSON.stringify(r.discard)})`);
  assert(r.primary === UNFETCHABLE, `falls back to first kept as primary (got ${r.primary})`);
}

console.log('\nTest 2: filterMainImage keeps an unfetchable main image');
{
  const kept = await filterMainImage(UNFETCHABLE);
  assert(kept === UNFETCHABLE, `main image survives classification failure (got ${kept})`);
}

console.log('\nTest 3: quota circuit-breaker — one 429 stops the herd');
{
  // A 33-house × hundreds-of-images sweep against a dead free-tier quota fired
  // thousands of doomed Gemini calls, each round-tripping before failing open,
  // stalling persist 15-20 min (AuctionHouse, 2026-06-13). The breaker trips on
  // the first quota error so the rest skip the network entirely.
  __resetImageFilterBreakerForTest();
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; throw new Error('[429 Too Many Requests] You exceeded your current quota'); };
  try {
    const r1 = await classifyImage('https://x.invalid/a.jpg'); // fetch throws 429 → trips breaker, fails open
    const r2 = await classifyImage('https://x.invalid/b.jpg'); // breaker open → skipped, no fetch
    const r3 = await classifyImage('https://x.invalid/c.jpg');
    assert(fetchCalls === 1, `only the first image hit the network; rest skipped (got ${fetchCalls} fetches)`);
    assert(r1.verdict === 'unknown' && r1.is_primary === true, 'first image fails open (kept)');
    assert(r2.reason.includes('cooldown') && r2.is_primary === true, 'subsequent images skip via breaker, still kept');
    assert(r3.reason.includes('cooldown'), 'breaker stays open for the run');
  } finally {
    global.fetch = realFetch;
    __resetImageFilterBreakerForTest();
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
