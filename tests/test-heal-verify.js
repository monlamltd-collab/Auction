// tests/test-heal-verify.js — self-healer catalogue-verification guard.
//
// The healer replaces a house's catalogue URL when it returns 0 lots. Its only gate
// used to be "the new page returns >500 chars", so when the AI extractor went
// quota-dead fleet-wide and every house briefly returned 0 lots, the healer replaced
// DOZENS of correct catalogue URLs with junk (a news article, a buyer's guide, a
// Channel-4 blog post, the bare homepage, a single-lot page) — and those houses then
// stayed dark forever. This is the biggest single cause of the dark-house backlog.
//
// healCandidateVerdict is the fix: a candidate is a valid catalogue ONLY if it is
// alive, is not itself a single lot page, and actually advertises lots.

// Fake env BEFORE the dynamic import so lib/supabase.js can build its singleton
// (no real API call is ever made). Static imports hoist above statements, so this
// module imports healing.js dynamically.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://test.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { healCandidateVerdict, countAdvertisedLots } = await import('../lib/pipeline/healing.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// A real catalogue listing: many distinct lot-detail links.
const catalogueHtml = '<html><body>' +
  Array.from({ length: 30 }, (_, i) =>
    `<a href="https://www.suttonkersh.co.uk/properties/lot/${14000 + i}/some-address-${i}/">Lot ${i}</a>`
  ).join('') + '</body></html>';

// A news article on the same domain: prose, zero lot links.
const newsHtml = '<html><body><h1>Auction Estates unveils Trent Bridge Cricket Ground as new venue</h1>' +
  '<p>' + 'Lorem ipsum dolor sit amet. '.repeat(60) + '</p>' +
  '<a href="/news/another-story">Related news</a><a href="/about">About us</a></body></html>';

// A single lot-detail page: the URL is a lot page and the sidebar shows a few
// "related lots" — the exact shape that corrupted suttonkersh.
const singleLotUrl = 'https://www.suttonkersh.co.uk/properties/lot/14585/Plots-24-And-25/';
const singleLotHtml = '<html><body><h1>Plots 24 And 25</h1>' + 'Details. '.repeat(80) +
  '<h3>Related lots</h3>' +
  Array.from({ length: 7 }, (_, i) => `<a href="/properties/lot/${15000 + i}/other/">Other ${i}</a>`).join('') +
  '</body></html>';

console.log('Heal candidate verification — reject junk, accept real catalogues');

// ── Accept a real catalogue ──
const good = healCandidateVerdict('https://www.suttonkersh.co.uk/properties/gallery/?section=auction', catalogueHtml, 'suttonkersh');
assert(good.ok === true, `real catalogue accepted (${good.reason})`);
assert(good.lots >= 20, `real catalogue lot count high (${good.lots})`);

// ── Reject the fleet-corrupting shapes ──
assert(healCandidateVerdict('https://www.auctionestates.co.uk/news/trent-bridge', newsHtml, 'auctionestates').ok === false,
  'news article rejected (0 lot links)');
assert(healCandidateVerdict(singleLotUrl, singleLotHtml, 'suttonkersh').reason === 'single-lot-url',
  'single lot-detail page rejected by URL shape (even with 7 related-lot links)');
assert(healCandidateVerdict('https://x.co.uk/', '<html><body>' + 'hi '.repeat(300) + '</body></html>', 'suttonkersh').ok === false,
  'bare homepage (no lot links) rejected');

// ── Thin content ──
assert(healCandidateVerdict('https://x.co.uk/', '<html></html>', 'suttonkersh').reason === 'thin-content', 'thin page rejected');

// ── countAdvertisedLots basics ──
assert(countAdvertisedLots(catalogueHtml, 'suttonkersh') >= 20, 'counts catalogue lot links');
assert(countAdvertisedLots(newsHtml, 'auctionestates') === 0, 'news article has 0 lot links');
assert(countAdvertisedLots('', 'x') === 0, 'empty html → 0');

// ── The generic fallback catches houses whose sentinel is imprecise ──
const aspHtml = Array.from({ length: 10 }, (_, i) => `<a href="/property_details.asp?id=${1000 + i}">L</a>`).join('');
assert(countAdvertisedLots(aspHtml, 'futureauctions') >= 8, 'generic ?id= lot links counted');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
