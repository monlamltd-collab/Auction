/**
 * Heal strategy ladder tests
 * ==========================
 * Covers the cheap-strategy ladder (A: redirect-follow, B: sitemap, C: nav-link)
 * added to lib/pipeline/healing.js so most heals don't need to burn a FIRE-1
 * credit. The strategies are pure-ish — A and B do HTTP fetches that we mock
 * by swapping global.fetch; C is fully pure.
 *
 * Run: node tests/test-heal-strategies.js
 */

// Harmless env so supabase.js singleton can construct.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://test.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { _internal } = await import('../lib/pipeline/healing.js');
const {
  _strategyFollowRedirect,
  _strategyParseSitemap,
  _strategyNavLink,
  _pickBestCandidate,
  _scoreCatalogueUrl,
} = _internal;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Stash + restore global.fetch around each fetch-using test.
const originalFetch = global.fetch;
function mockFetch(impl) { global.fetch = impl; }
function restoreFetch() { global.fetch = originalFetch; }

const HEADERS = { 'User-Agent': 'test' };

// ═══════════════════════════════════════════════════════════════
// _scoreCatalogueUrl + _pickBestCandidate
// ═══════════════════════════════════════════════════════════════

console.log('Test 1: _scoreCatalogueUrl counts catalogue keywords');
{
  assert(_scoreCatalogueUrl('https://x.co/contact') === 0, 'no keywords → 0');
  assert(_scoreCatalogueUrl('https://x.co/auction') === 1, 'one keyword');
  assert(_scoreCatalogueUrl('https://x.co/auction/catalogue/lots') === 3, 'three keywords');
}

console.log('\nTest 2: _pickBestCandidate prefers higher score then shorter URL');
{
  const urls = [
    'https://x.co/about',
    'https://x.co/news/old-auction-archive',
    'https://x.co/auction-catalogue-lots',
    'https://x.co/current-property-auction',
  ];
  const picked = _pickBestCandidate(urls);
  // /auction-catalogue-lots scores 3, /current-property-auction scores 3 — shorter wins
  assert(picked === 'https://x.co/auction-catalogue-lots' || picked === 'https://x.co/current-property-auction',
    'returned one of the top-scored URLs');
  assert(_pickBestCandidate(['https://x.co/contact', 'https://x.co/about']) === null,
    'returns null when no URL scores');
}

// ═══════════════════════════════════════════════════════════════
// Strategy C: nav-link heuristic (pure)
// ═══════════════════════════════════════════════════════════════

console.log('\nTest 3: _strategyNavLink picks same-domain catalogue link from hrefs');
{
  const hrefs = [
    '/about',
    'https://www.savills.co.uk/auctions/current-catalogue',
    'https://external.com/auctions/lots',  // wrong domain
    '/contact',
  ];
  const r = _strategyNavLink(hrefs, 'https://www.savills.co.uk/');
  assert(r !== null, 'returned a candidate');
  assert(r.newUrl === 'https://www.savills.co.uk/auctions/current-catalogue', 'picked the same-domain catalogue link');
  assert(r.confidence === 'low', 'low confidence (heuristic)');
}

console.log('\nTest 4: _strategyNavLink resolves relative hrefs against rootUrl');
{
  const hrefs = ['/auction-lots', '/news'];
  const r = _strategyNavLink(hrefs, 'https://www.allsop.co.uk/');
  assert(r?.newUrl === 'https://www.allsop.co.uk/auction-lots', 'relative href resolved to absolute');
}

console.log('\nTest 5: _strategyNavLink returns null when no link contains keywords');
{
  const r = _strategyNavLink(['/about', '/contact', '/news'], 'https://x.co/');
  assert(r === null, 'no catalogue keywords → null');
}

console.log('\nTest 6: _strategyNavLink handles empty/missing hrefs gracefully');
{
  assert(_strategyNavLink([], 'https://x.co/') === null, 'empty hrefs → null');
  assert(_strategyNavLink(null, 'https://x.co/') === null, 'null hrefs → null');
  assert(_strategyNavLink(['/auction'], 'not-a-url') === null, 'invalid rootUrl → null');
}

// ═══════════════════════════════════════════════════════════════
// Strategy A: redirect-follow (mocked fetch)
// ═══════════════════════════════════════════════════════════════

console.log('\nTest 7: _strategyFollowRedirect detects server-side redirect');
{
  mockFetch(async () => ({ ok: true, url: 'https://www.savills.co.uk/auctions/may-2026' }));
  try {
    const r = await _strategyFollowRedirect('https://www.savills.co.uk/auctions/april-2026', { HEADERS });
    assert(r?.newUrl === 'https://www.savills.co.uk/auctions/may-2026', 'returned redirected URL');
    assert(r?.confidence === 'high', 'high confidence on server redirect');
  } finally { restoreFetch(); }
}

console.log('\nTest 8: _strategyFollowRedirect returns null when no redirect happened');
{
  mockFetch(async () => ({ ok: true, url: 'https://www.savills.co.uk/auctions/april-2026' }));
  try {
    const r = await _strategyFollowRedirect('https://www.savills.co.uk/auctions/april-2026', { HEADERS });
    assert(r === null, 'no redirect → null');
  } finally { restoreFetch(); }
}

console.log('\nTest 9: _strategyFollowRedirect returns null on non-2xx');
{
  mockFetch(async () => ({ ok: false, status: 404, url: 'https://x.co/somewhere' }));
  try {
    const r = await _strategyFollowRedirect('https://x.co/old', { HEADERS });
    assert(r === null, '404 → null');
  } finally { restoreFetch(); }
}

console.log('\nTest 10: _strategyFollowRedirect returns null on fetch error');
{
  mockFetch(async () => { throw new Error('network'); });
  try {
    const r = await _strategyFollowRedirect('https://x.co/old', { HEADERS });
    assert(r === null, 'network error → null');
  } finally { restoreFetch(); }
}

console.log('\nTest 11: _strategyFollowRedirect treats trailing-slash variants as same URL');
{
  mockFetch(async () => ({ ok: true, url: 'https://www.savills.co.uk/auctions/' }));
  try {
    const r = await _strategyFollowRedirect('https://www.savills.co.uk/auctions', { HEADERS });
    assert(r === null, 'normalised match → null (no real change)');
  } finally { restoreFetch(); }
}

// ═══════════════════════════════════════════════════════════════
// Strategy B: sitemap parse (mocked fetch)
// ═══════════════════════════════════════════════════════════════

console.log('\nTest 12: _strategyParseSitemap picks best catalogue URL from urlset');
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://x.co/about</loc></url>
  <url><loc>https://x.co/contact</loc></url>
  <url><loc>https://x.co/auction/current-catalogue/lots</loc></url>
  <url><loc>https://x.co/blog</loc></url>
</urlset>`;
  mockFetch(async () => ({ ok: true, text: async () => xml }));
  try {
    const r = await _strategyParseSitemap('https://x.co/', { HEADERS });
    assert(r?.newUrl === 'https://x.co/auction/current-catalogue/lots', 'picked highest-scoring URL');
    assert(r?.confidence === 'medium', 'medium confidence');
  } finally { restoreFetch(); }
}

console.log('\nTest 13: _strategyParseSitemap follows sitemapindex into nested sitemaps');
{
  let calls = 0;
  mockFetch(async (url) => {
    calls++;
    if (url === 'https://x.co/sitemap.xml') {
      return { ok: true, text: async () => '<sitemapindex><sitemap><loc>https://x.co/sub.xml</loc></sitemap></sitemapindex>' };
    }
    if (url === 'https://x.co/sub.xml') {
      return { ok: true, text: async () => '<urlset><url><loc>https://x.co/auctions/lots</loc></url></urlset>' };
    }
    return { ok: false };
  });
  try {
    const r = await _strategyParseSitemap('https://x.co/', { HEADERS });
    assert(r?.newUrl === 'https://x.co/auctions/lots', 'recovered URL from nested sitemap');
    assert(calls === 2, 'fetched both root + nested sitemap');
  } finally { restoreFetch(); }
}

console.log('\nTest 14: _strategyParseSitemap filters out off-hostname URLs');
{
  const xml = `<urlset>
    <url><loc>https://external.com/auctions/catalogue</loc></url>
    <url><loc>https://x.co/about</loc></url>
  </urlset>`;
  mockFetch(async () => ({ ok: true, text: async () => xml }));
  try {
    const r = await _strategyParseSitemap('https://x.co/', { HEADERS });
    assert(r === null, 'off-hostname URL excluded → null (no on-hostname catalogue link)');
  } finally { restoreFetch(); }
}

console.log('\nTest 15: _strategyParseSitemap returns null on missing sitemap (404)');
{
  mockFetch(async () => ({ ok: false, status: 404 }));
  try {
    const r = await _strategyParseSitemap('https://x.co/', { HEADERS });
    assert(r === null, '404 sitemap → null');
  } finally { restoreFetch(); }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
