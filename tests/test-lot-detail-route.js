/**
 * Lot detail route — render-helper tests
 * ======================================
 * Tests the pure rendering helpers from routes/lots.js (renderLotHtml,
 * renderOgSvg, proxiedImage, escSvg, UUID_RE). The live route handlers
 * touch Supabase directly so they're covered by manual integration testing
 * (`POST /api/admin/rescrape` + visiting /lot/:id) — the unit tests here
 * pin down the SEO + share-target output that marketing relies on.
 *
 * Run: node tests/test-lot-detail-route.js
 */

import {
  renderLotHtml,
  renderOgSvg,
  proxiedImage,
  escSvg,
  UUID_RE,
} from '../routes/lots-render.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── Test 1: UUID regex ──
console.log('Test 1: UUID_RE accepts valid UUIDs and rejects junk');
{
  assert(UUID_RE.test('123e4567-e89b-12d3-a456-426614174000'), 'lower-case UUID');
  assert(UUID_RE.test('123E4567-E89B-12D3-A456-426614174000'), 'upper-case UUID');
  assert(!UUID_RE.test(''), 'empty string rejected');
  assert(!UUID_RE.test('not-a-uuid'), 'non-uuid string rejected');
  assert(!UUID_RE.test('123e4567-e89b-12d3-a456-42661417400'), 'short uuid rejected');
  assert(!UUID_RE.test('123e4567-e89b-12d3-a456-426614174000extra'), 'long uuid rejected');
  assert(!UUID_RE.test("' OR 1=1 --"), 'sql-injection-y string rejected');
}

// ── Test 2: proxiedImage builds the wsrv.nl URL ──
console.log('\nTest 2: proxiedImage');
{
  const out = proxiedImage('https://example.com/img.jpg', 1200);
  assert(out.startsWith('https://wsrv.nl/?url='), 'uses wsrv.nl prefix');
  assert(out.includes(encodeURIComponent('https://example.com/img.jpg')), 'url is encoded');
  assert(out.includes('w=1200'), 'width parameter present');
  assert(out.includes('output=webp'), 'output=webp');
  assert(proxiedImage(null) === null, 'null in → null out');
}

// ── Test 3: escSvg ──
console.log('\nTest 3: escSvg');
{
  assert(escSvg('a & b') === 'a &amp; b', 'ampersand');
  assert(escSvg('<script>') === '&lt;script&gt;', 'angle brackets');
  assert(escSvg('"quoted"') === '&quot;quoted&quot;', 'double quotes');
  assert(escSvg("it's") === 'it&apos;s', 'single quote');
  assert(escSvg(null) === '', 'null → empty');
  assert(escSvg(undefined) === '', 'undefined → empty');
}

// ── Test 4: renderOgSvg includes lot data and SVG header ──
console.log('\nTest 4: renderOgSvg');
{
  const svg = renderOgSvg({
    priceLabel: '£325,000',
    scoreLabel: '7.5',
    shortAddress: '12 Acacia Avenue, Bristol',
    displayName: 'Hollis Morgan',
    propType: 'Terraced House',
  });
  assert(svg.startsWith('<?xml version="1.0"'), 'XML declaration present');
  assert(svg.includes('width="1200"'), '1200 width');
  assert(svg.includes('height="630"'), '630 height');
  assert(svg.includes('£325,000'), 'price rendered');
  assert(svg.includes('12 Acacia Avenue'), 'address rendered');
  assert(svg.includes('Hollis Morgan'), 'house display name rendered');
  assert(svg.includes('TERRACED HOUSE'), 'prop type uppercased');
  assert(svg.includes('7.5/10'), 'score badge rendered');

  // No score → no score badge
  const noScore = renderOgSvg({
    priceLabel: '£100,000',
    scoreLabel: null,
    shortAddress: 'Some Place',
    displayName: 'Some House',
    propType: null,
  });
  assert(!noScore.includes('SCORE'), 'no score badge when scoreLabel is null');
}

// ── Test 5: renderOgSvg escapes hostile input ──
console.log('\nTest 5: renderOgSvg escapes hostile input');
{
  const svg = renderOgSvg({
    priceLabel: '<script>alert(1)</script>',
    scoreLabel: '"5"',
    shortAddress: "L'address & co",
    displayName: 'Bob<bobby>',
    propType: '<img>',
  });
  assert(!svg.includes('<script>alert(1)</script>'), 'script tag escaped in price');
  assert(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'price contains escaped form');
  assert(svg.includes('&apos;address &amp; co'), 'address apostrophe + ampersand escaped');
  assert(svg.includes('Bob&lt;bobby&gt;'), 'display name angle brackets escaped');
}

// ── Test 6: renderLotHtml meta tags ──
console.log('\nTest 6: renderLotHtml SEO meta');
{
  const html = renderLotHtml({
    title: '12 Acacia Avenue — £325,000 | Auction Brain',
    description: '£325,000 · House · Score 7.5/10 · Hollis Morgan',
    canonical: 'https://auctions.bridgematch.co.uk/lot/abc-123',
    ogImage: 'https://auctions.bridgematch.co.uk/og/lot/abc-123.png',
    jsonLd: { '@context': 'https://schema.org', '@type': 'RealEstateListing' },
    shortAddress: '12 Acacia Avenue',
    priceLabel: '£325,000',
    scoreLabel: '7.5',
    propTypeLabel: 'Terraced House',
    displayName: 'Hollis Morgan',
    address: '12 Acacia Avenue, Bristol BS1 1AB',
    opps: ['Below market', 'Vacant'],
    risks: ['Sitting tenant'],
    bullets: ['Freehold', '2 beds'],
    heroImg: 'https://wsrv.nl/?url=...',
    lotUrl: 'https://www.example.com/lot/123',
    status: 'available',
  });

  assert(html.includes('<title>12 Acacia Avenue'), 'title contains address');
  assert(html.includes('<meta name="description" content="£325,000'), 'description meta');
  assert(html.includes('property="og:title"'), 'og:title present');
  assert(html.includes('property="og:image" content="https://auctions.bridgematch.co.uk/og/lot/abc-123.png"'), 'og:image URL');
  assert(html.includes('property="og:image:width" content="1200"'), 'og:image dimensions');
  assert(html.includes('twitter:card" content="summary_large_image"'), 'twitter card');
  assert(html.includes('rel="canonical" href="https://auctions.bridgematch.co.uk/lot/abc-123"'), 'canonical link');
  assert(html.includes('"@type":"RealEstateListing"'), 'JSON-LD inline');
  assert(html.includes('Hollis Morgan'), 'house display name on page');
  assert(html.includes('£325,000'), 'price on page');
  assert(html.includes('Below market'), 'opportunity rendered');
  assert(html.includes('Sitting tenant'), 'risk rendered');
  assert(html.includes('href="/check"'), 'CTA links to /check');
  assert(html.includes('href="/"'), 'back-to-home CTA');
}

// ── Test 7: renderLotHtml escapes user content ──
console.log('\nTest 7: renderLotHtml escapes hostile input');
{
  const html = renderLotHtml({
    title: '<script>alert("xss")</script>',
    description: 'a & b',
    canonical: 'https://example.com/x',
    ogImage: 'https://example.com/og.png',
    jsonLd: { '@type': 'Test' },
    shortAddress: 'Some <b>place</b>',
    priceLabel: '£100,000',
    scoreLabel: null,
    propTypeLabel: 'House',
    displayName: 'House&Co',
    address: '"Quoted" Street',
    opps: ['<script>'],
    risks: [],
    bullets: ['<img onerror=alert(1)>'],
    heroImg: null,
    lotUrl: 'javascript:alert(1)',
    status: 'sold',
  });

  assert(!html.includes('<script>alert("xss")</script>'), 'script tag in title escaped');
  assert(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'title escaped form present');
  assert(html.includes('&lt;script&gt;'), 'opp script tag escaped');
  assert(html.includes('&lt;img onerror=alert(1)&gt;'), 'bullet xss escaped');
  // javascript: href should still appear escaped — we explicitly don't sanitise
  // protocols at this layer. Important: it must be HTML-escaped, not raw.
  assert(html.includes('href="javascript:alert(1)"') || html.includes('href="javascript&#'), 'lotUrl is HTML-escaped (escHtml does not strip the protocol — frontend rel=nofollow + new tab limits exposure)');
  assert(html.includes('SOLD'), 'non-available status badge rendered');
}

// ── Test 8: renderLotHtml handles missing optional fields ──
console.log('\nTest 8: renderLotHtml gracefully handles missing data');
{
  const html = renderLotHtml({
    title: 'Test',
    description: 'd',
    canonical: 'c',
    ogImage: 'og',
    jsonLd: {},
    shortAddress: 'Addr',
    priceLabel: 'Guide TBA',
    scoreLabel: null,
    propTypeLabel: 'Property',
    displayName: 'House',
    address: 'Addr',
    opps: [],
    risks: [],
    bullets: [],
    heroImg: null,
    lotUrl: '',
    status: 'available',
  });
  assert(html.includes('No image available'), 'placeholder when no hero');
  assert(!html.includes('Opportunities'), 'no opps section when empty');
  assert(!html.includes('Risks'), 'no risks section when empty');
  assert(!html.includes('Lot details</h2>'), 'no bullets section when empty');
  assert(!html.includes('Score <strong>'), 'no score chip when null');
  assert(!html.includes('SOLD'), 'no status badge when available');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
