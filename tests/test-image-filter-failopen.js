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

const { filterImages, filterMainImage } = await import('../lib/pipeline/image-quality-filter.js');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
