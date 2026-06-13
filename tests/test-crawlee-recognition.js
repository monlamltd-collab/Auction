/**
 * Tests the Phase 3 turndown→recogniser bridge in renderAndExtractWithCrawlee:
 * lots the Gemini extractor misses are recovered from the turndown markdown of
 * Crawlee-rendered HTML, merged, and reflected in recall.
 *
 * Run: node tests/test-crawlee-recognition.js
 */

import { renderAndExtractWithCrawlee } from '../lib/pipeline/crawlee-extract.js';
import { htmlToRecognitionMarkdown } from '../lib/scraper/html-to-markdown.js';
import { recognisePattinsonLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const SENTINEL = /\/lot\/(\d+)/g;

// Rendered page advertises lots 1,2,3 via detail links; Gemini only gets 1 & 2.
const fakeRender = async () => ([{
  page: 1,
  html: '<div><a href="/lot/1">One</a><a href="/lot/2">Two</a><a href="/lot/3">Three</a></div>',
}]);
const fakeExtract = async () => ([
  { lot: 1, address: '1 First Street, Townsville, AB1 2CD', url: 'https://x.test/lot/1', price: 100000 },
  { lot: 2, address: '2 Second Street, Townsville, AB1 2CD', url: 'https://x.test/lot/2', price: 200000 },
]);
// Recogniser recovers lot 3 from the markdown (keyed by sentinel id).
const recogniser = (md) => {
  const m = new Map();
  if (/\/lot\/3/.test(md)) m.set("3", { lot_number: 3, address: '3 Third Street, Townsville, AB1 2CD', url: 'https://x.test/lot/3', price: 300000 });
  return m;
};

console.log('Test 1: recogniser recovers the lot Gemini missed');
{
  const r = await renderAndExtractWithCrawlee('https://x.test/cat', 'johnpye', {
    recallSentinelPattern: SENTINEL,
    recogniseFromMarkdown: recogniser,
  }, { scrapeAllPagesWithCrawlee: fakeRender, extractLotsWithAI: fakeExtract });

  assert(r.lots.length === 3, `merged to 3 lots (got ${r.lots.length})`);
  assert(r.recognised === 1, `recognised 1 recovered lot (got ${r.recognised})`);
  assert(r.lots.some(l => l.lot === 3), 'recovered lot 3 present');
  assert(r.sentinelLots === 3, `sentinel saw 3 advertised lots (got ${r.sentinelLots})`);
  assert(r.recall === 1, `recall 100% after recovery (got ${r.recall})`);
}

console.log('\nTest 2: no recogniser → no recovery (Gemini-only)');
{
  const r = await renderAndExtractWithCrawlee('https://x.test/cat', 'astleys', {
    recallSentinelPattern: SENTINEL,
  }, { scrapeAllPagesWithCrawlee: fakeRender, extractLotsWithAI: fakeExtract });
  assert(r.lots.length === 2, 'only the 2 Gemini lots');
  assert(r.recognised === 0, 'nothing recognised');
  assert(Math.abs(r.recall - 2 / 3) < 1e-9, 'recall 2/3 (HTML sentinel denominator)');
}

console.log('\nTest 3: recogniser does not duplicate a lot Gemini already found');
{
  const dupRecogniser = (md) => {
    const m = new Map();
    if (/\/lot\/3/.test(md)) m.set("3", { lot_number: 3, address: '3 Third Street, Townsville, AB1 2CD', url: 'https://x.test/lot/3', price: 300000 });
    // Also (wrongly) offers lot 1 which Gemini already has — must be deduped.
    m.set("1", { lot_number: 1, address: '1 First Street, Townsville, AB1 2CD', url: 'https://x.test/lot/1', price: 100000 });
    return m;
  };
  const r = await renderAndExtractWithCrawlee('https://x.test/cat', 'johnpye', {
    recallSentinelPattern: SENTINEL,
    recogniseFromMarkdown: dupRecogniser,
  }, { scrapeAllPagesWithCrawlee: fakeRender, extractLotsWithAI: fakeExtract });
  assert(r.lots.length === 3, `still 3 lots, no duplicate (got ${r.lots.length})`);
  assert(r.recognised === 1, 'only the genuinely-missing lot recovered');
}

// ── The decisive test: the REAL Pattinson recogniser over turndown output ──
// Phase 3's central claim is that recogniser houses keep recall on Crawlee via
// the turndown bridge. That only holds if turndown reproduces the two Firecrawl
// idioms the recogniser depends on: `\\`+newline hard breaks, and absolute
// hrefs. This test renders Pattinson-shaped HTML → turndown → the real
// recogniser, and asserts a lot is recovered (the bug the review caught: with
// turndown's default two-space breaks + relative hrefs, this returned 0).
console.log('\nTest 4: real Pattinson recogniser recovers from turndown markdown');
{
  // A Pattinson lot card as a <br>-separated flow (image, price, "Guide Price",
  // type/beds, address, then the `parking` detail link with a RELATIVE href).
  // This is the bug the review caught end-to-end: with turndown's default
  // two-space hard breaks the recogniser split matched nothing, and with
  // relative hrefs the absolute-URL detail link never formed. Both are fixed
  // by the br rule + absolutise in html-to-markdown.js.
  // (Caveat: cards that render the <img> as a separate block glue it to the
  // price line via a paragraph break; such houses must be A/B-validated — the
  // parity gate holds promotion until recall is proven, so this fails safe.)
  const html = '<div class="lot"><img src="/media/photo99.jpg"><br>£175,000<br>Guide Price<br>3 bed semi-detached<br>14 Hillside Avenue, Sunderland, SR4 7QP<br><a href="/property/99012">parking</a></div>';
  const md = htmlToRecognitionMarkdown(html, 'https://www.pattinson.co.uk/auction');
  const recovered = recognisePattinsonLotsFromMarkdown(md);

  assert(recovered.size >= 1, `real recogniser found a lot (got ${recovered.size})`);
  const lot = recovered.get('99012');
  assert(!!lot, 'lot keyed by detail-page id 99012');
  assert(lot && /Hillside Avenue/.test(lot.address || ''), `address parsed (got "${lot?.address}")`);
  assert(lot && /pattinson\.co\.uk\/property\/99012/.test(lot.detail_url || ''), 'absolute detail_url preserved');
}

console.log('\nTest 5: turndown reproduces the Firecrawl idioms');
{
  const md = htmlToRecognitionMarkdown('<p>a<br>b</p><a href="/lot/5">x</a>', 'https://h.test/cat');
  assert(/\\\\\s*\n/.test(md), 'hard break emitted as backslash+newline (Firecrawl idiom)');
  assert(/\(https:\/\/h\.test\/lot\/5\)/.test(md), 'relative href absolutised');
}

// ── The fleet image-coverage fix (2026-06-12) ──
// stripHtml (the old fallback for non-recogniser Crawlee houses) DELETES every
// <img>, so Gemini never saw an image → fleet coverage fell to ~54% after the
// Firecrawl→Crawlee switch. Fix: build markdown for EVERY Crawlee page so images
// (![](src)) reach the extractor, matching what Firecrawl fed Gemini.
console.log('\nTest 6: non-recogniser house — per-lot images survive into the Gemini input');
{
  let capturedPages = null;
  const renderWithImg = async () => ([{
    page: 1,
    html: '<div class="lot-search-result"><img src="https://cdn.test/lot/77.jpg" alt="photo"><p class="grid-address">7 Elm Road, Bristol, BS1 4AA</p><div class="grid-view-guide">£120,000</div><a href="/lot/77">view</a></div>',
  }]);
  const captureExtract = async (pages) => { capturedPages = pages; return []; };
  await renderAndExtractWithCrawlee('https://x.test/cat', 'auctionhouselondon', {
    recallSentinelPattern: SENTINEL,
  }, { scrapeAllPagesWithCrawlee: renderWithImg, extractLotsWithAI: captureExtract });

  assert(capturedPages && capturedPages[0].markdown,
    'a non-recogniser house now gets markdown built (was undefined → stripHtml dropped <img>)');
  assert(/!\[[^\]]*\]\(https:\/\/cdn\.test\/lot\/77\.jpg\)/.test(capturedPages[0].markdown || ''),
    'the per-lot image URL is present in the markdown the extractor receives');
}

// ── Status/image corroboration (2026-06-13 incident) ──
// The AI extractor INFERS lot status and, on overlay-heavy pages, smears
// SOLD/STC onto available lots (Maggs: page showed 31 available / 6 sold,
// extractor persisted 0 available → get_active_lots hid the whole house).
// For ids the recogniser also parsed, its deterministic status/image win.
console.log('\nTest 7: recogniser corroboration corrects fabricated statuses + fills images');
{
  const extractWithFabricatedStatus = async () => ([
    { lot: 1, address: '1 First Street, Townsville, AB1 2CD', url: 'https://x.test/lot/1', price: 100000, status: 'stc' },
    { lot: 2, address: '2 Second Street, Townsville, AB1 2CD', url: 'https://x.test/lot/2', price: 200000, status: 'sold', imageUrl: 'https://cdn.test/gemini2.jpg' },
  ]);
  const corroboratingRecogniser = () => new Map([
    // Page shows lot 1 with no SOLD badge → available; hero image parsed.
    ['1', { lot_number: 1, address: '1 First Street, Townsville, AB1 2CD', lot_status: 'available', image_url: 'https://cdn.test/rec1.jpg', detail_url: 'https://x.test/lot/1' }],
    // Lot 2 genuinely shows a SOLD overlay → extractor's status confirmed.
    ['2', { lot_number: 2, address: '2 Second Street, Townsville, AB1 2CD', lot_status: 'sold', image_url: 'https://cdn.test/rec2.jpg', detail_url: 'https://x.test/lot/2' }],
    // Lot 3 missed by the extractor → recovered, as in Test 1.
    ['3', { lot_number: 3, address: '3 Third Street, Townsville, AB1 2CD', lot_status: 'available', detail_url: 'https://x.test/lot/3' }],
  ]);
  const r = await renderAndExtractWithCrawlee('https://x.test/cat', 'maggsandallen', {
    recallSentinelPattern: SENTINEL,
    recogniseFromMarkdown: corroboratingRecogniser,
  }, { scrapeAllPagesWithCrawlee: fakeRender, extractLotsWithAI: extractWithFabricatedStatus });

  const l1 = r.lots.find(l => l.lot === 1);
  const l2 = r.lots.find(l => l.lot === 2);
  assert(l1.status === 'available', `fabricated stc corrected to available (got ${l1.status})`);
  assert(l1.imageUrl === 'https://cdn.test/rec1.jpg', `missing image filled from recogniser (got ${l1.imageUrl})`);
  assert(l2.status === 'sold', `corroborated sold stays sold (got ${l2.status})`);
  assert(l2.imageUrl === 'https://cdn.test/gemini2.jpg', `extractor image NOT overwritten (got ${l2.imageUrl})`);
  assert(r.recognised === 1, `lot 3 still recovered as before (got ${r.recognised})`);
}

console.log('\nTest 8: recogniser entry without lot_status leaves extractor status alone');
{
  const extractStc = async () => ([
    { lot: 1, address: '1 First Street, Townsville, AB1 2CD', url: 'https://x.test/lot/1', price: 100000, status: 'stc' },
  ]);
  const noStatusRecogniser = () => new Map([
    ['1', { lot_number: 1, address: '1 First Street, Townsville, AB1 2CD', detail_url: 'https://x.test/lot/1' }],
  ]);
  const r = await renderAndExtractWithCrawlee('https://x.test/cat', 'johnpye', {
    recallSentinelPattern: SENTINEL,
    recogniseFromMarkdown: noStatusRecogniser,
  }, { scrapeAllPagesWithCrawlee: fakeRender, extractLotsWithAI: extractStc });
  assert(r.lots[0].status === 'stc', `status untouched when recogniser has no lot_status (got ${r.lots[0].status})`);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Crawlee recognition tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);