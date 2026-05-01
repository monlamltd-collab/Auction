/**
 * Detail Extractor Test Suite
 * ===========================
 * Exercises lib/extractors/details/* against synthetic HTML fixtures.
 * Real-world snapshots can be added by saving HTML to
 *   tests/snapshots/{slug}-detail.html
 * and they will be picked up automatically.
 *
 * Run: node tests/test-detail-extractors.js
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractLotDetail } from '../lib/extractors/details/runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

// ─── Synthetic fixture: minimal Maggs-style detail page ───
const syntheticMaggs = `
<!DOCTYPE html><html><head>
  <meta property="og:title" content="34 Two Mile Hill Road, Bristol BS15 1AB">
  <meta property="og:image" content="https://www.maggsandallen.co.uk/uploads/photos/lot1.jpg">
</head><body>
  <h1>34 Two Mile Hill Road</h1>
  <div class="property-photos">
    <img src="/resize/800x600/uploads/photos/lot1.jpg">
    <img src="/resize/800x600/uploads/photos/lot2.jpg">
    <img src="/images/logo.png">
  </div>
  <div class="property-features">
    <ul class="features">
      <li>3 bedroom terraced house</li>
      <li>Freehold</li>
      <li>Vacant possession</li>
      <li>Needs modernisation</li>
    </ul>
  </div>
  <p>Guide Price: £150,000</p>
  <h3>Viewings</h3>
  <p>Wednesday 1st May 2026 at 10am</p>
  <p>Saturday 4th May 2026 at 11am</p>
</body></html>`;

console.log('\n── Maggs & Allen detail extractor ──');
const maggsResult = extractLotDetail(
  syntheticMaggs,
  'maggsandallen',
  'https://www.maggsandallen.co.uk/property-details/12345/-/bristol/test'
);
assert(maggsResult !== null, 'returns a result');
assert(maggsResult?.address && maggsResult.address.includes('Two Mile Hill'), `address contains "Two Mile Hill" (got: "${maggsResult?.address}")`);
assert(Array.isArray(maggsResult?.images) && maggsResult.images.length >= 1, `has at least 1 image (got ${maggsResult?.images?.length || 0})`);
assert(maggsResult?.tenure === 'Freehold', `tenure is Freehold (got: "${maggsResult?.tenure}")`);
assert(maggsResult?.propType === 'house', `propType is house (got: "${maggsResult?.propType}")`);
assert(maggsResult?.beds === 3, `beds is 3 (got: ${maggsResult?.beds})`);
assert(maggsResult?.price === 150000, `price is 150000 (got: ${maggsResult?.price})`);
assert(maggsResult?.vacant === true, `vacant is true (got: ${maggsResult?.vacant})`);
assert(Array.isArray(maggsResult?.bullets) && maggsResult.bullets.length >= 3, `has at least 3 bullets (got ${maggsResult?.bullets?.length || 0})`);
assert(Array.isArray(maggsResult?.viewingDates) && maggsResult.viewingDates.length >= 1, `has at least 1 viewing date (got ${maggsResult?.viewingDates?.length || 0})`);

// Verify junk image was filtered (logo at /images/ root without /resize/ or /uploads/)
const hasLogoJunk = (maggsResult?.images || []).some(i => i.includes('/images/logo.png'));
assert(!hasLogoJunk, 'CMS chrome (logo.png) was filtered from images');

// ─── Hollis Morgan synthetic ───
const syntheticHollis = `
<!DOCTYPE html><html><head>
  <meta property="og:title" content="12 Park Street, Bristol BS1 5HX">
</head><body>
  <h1>12 Park Street, Bristol</h1>
  <div class="gallery">
    <img src="https://www.hollismorgan.co.uk/uploads/lot.jpg">
  </div>
  <ul class="features">
    <li>2 bedroom flat</li>
    <li>Leasehold</li>
  </ul>
  <p>Guide Price: £225,000</p>
</body></html>`;

console.log('\n── Hollis Morgan detail extractor ──');
const hollisResult = extractLotDetail(
  syntheticHollis,
  'hollismorgan',
  'https://www.hollismorgan.co.uk/property-details/9999/...'
);
assert(hollisResult !== null, 'returns a result');
assert(hollisResult?.address && hollisResult.address.includes('Park Street'), `address contains "Park Street" (got: "${hollisResult?.address}")`);
assert(hollisResult?.tenure === 'Leasehold', `tenure is Leasehold (got: "${hollisResult?.tenure}")`);
assert(hollisResult?.propType === 'flat', `propType is flat (got: "${hollisResult?.propType}")`);
assert(hollisResult?.price === 225000, `price is 225000 (got: ${hollisResult?.price})`);

// ─── FSS Property synthetic ───
const syntheticFss = `
<!DOCTYPE html><html><head>
  <meta property="og:title" content="55 Mill Lane, Knaresborough HG5 8AB">
</head><body>
  <h1>55 Mill Lane, Knaresborough</h1>
  <div class="property-photos">
    <img src="https://www.fssproperty.co.uk/uploads/55-mill-lane.jpg">
  </div>
  <ul class="features">
    <li>4 bedroom detached house</li>
    <li>Freehold</li>
  </ul>
  <p>Guide Price: £325,000</p>
</body></html>`;

console.log('\n── FSS Property detail extractor ──');
const fssResult = extractLotDetail(
  syntheticFss,
  'fssproperty',
  'https://www.fssproperty.co.uk/property-details/77/...'
);
assert(fssResult !== null, 'returns a result');
assert(fssResult?.address && fssResult.address.includes('Mill Lane'), `address contains "Mill Lane" (got: "${fssResult?.address}")`);
assert(fssResult?.tenure === 'Freehold', `tenure is Freehold (got: "${fssResult?.tenure}")`);
assert(fssResult?.beds === 4, `beds is 4 (got: ${fssResult?.beds})`);
assert(fssResult?.price === 325000, `price is 325000 (got: ${fssResult?.price})`);

// ─── Edward Mellor synthetic ───
// EM listing cards lose the inward postcode — extractor recovers it from the
// detail page's `.description > p` paragraph. See alert
// `extractor_postcode_regression` 2026-05-01.
const syntheticEm = `
<!DOCTYPE html><html><head>
  <meta property="og:title" content="1 bed Ground Floor Flat For Auction">
</head><body>
  <h1>1 bed Ground Floor Flat For Auction</h1>
  <div class="description">
    <p>TO BE SOLD BY ONLINE AUCTION ON 13TH MAY 2026</p>
    <p>3, Roger Browning House, Maidenburgh Street, Colchester, Essex, CO1 1TT</p>
    <p>An attractive investment opportunity to acquire a one-bedroom...</p>
  </div>
</body></html>`;

console.log('\n── Edward Mellor detail extractor ──');
const emResult = extractLotDetail(
  syntheticEm,
  'edwardmellor',
  'https://edwardmellor.co.uk/property-for-sale/10168218'
);
assert(emResult !== null, 'returns a result');
assert(emResult?.postcode === 'CO1 1TT', `postcode is "CO1 1TT" (got: "${emResult?.postcode}")`);
assert(emResult?.address && emResult.address.includes('Roger Browning House'), `address contains "Roger Browning House" (got: "${emResult?.address}")`);

// Fallback path: no `.description`, but $propertyNameField inline JS has the postcode
const syntheticEmFallback = `
<!DOCTYPE html><html><body>
  <h1>Auction Lot</h1>
  <script>
    $propertyNameField.val('99 Some Road, Sometown, AB1 2CD');
    $propertyUrlField.val('https://edwardmellor.co.uk/property-for-sale/9999/');
  </script>
</body></html>`;
const emFallback = extractLotDetail(syntheticEmFallback, 'edwardmellor', 'https://edwardmellor.co.uk/property-for-sale/9999');
assert(emFallback?.postcode === 'AB1 2CD', `fallback postcode is "AB1 2CD" (got: "${emFallback?.postcode}")`);

// ─── Real-world snapshots (if present) ───
console.log('\n── Real-world snapshots ──');
const snapshotsDir = join(__dirname, 'snapshots');
const POSTCODE_RE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s+\d[A-Z]{2}\b/i;

for (const slug of ['maggsandallen', 'hollismorgan', 'fssproperty']) {
  const path = join(snapshotsDir, `${slug}-detail.html`);
  if (!existsSync(path)) {
    console.log(`  · ${slug}-detail.html not present — skipping`);
    continue;
  }
  const html = readFileSync(path, 'utf8');
  const result = extractLotDetail(html, slug, `https://example.com/`);
  assert(result !== null, `${slug}: extractor returned a result`);
  assert(result?.address && result.address.length >= 5, `${slug}: address (got "${result?.address}")`);
  assert(Array.isArray(result?.images) && result.images.length > 0, `${slug}: at least one image`);
}

// edwardmellor snapshot: assert postcode (not image — EM extractor only handles address+postcode)
{
  const path = join(snapshotsDir, 'edwardmellor-detail.html');
  if (!existsSync(path)) {
    console.log('  · edwardmellor-detail.html not present — skipping');
  } else {
    const html = readFileSync(path, 'utf8');
    const result = extractLotDetail(html, 'edwardmellor', 'https://edwardmellor.co.uk/');
    assert(result !== null, 'edwardmellor: extractor returned a result');
    assert(result?.postcode && POSTCODE_RE.test(result.postcode), `edwardmellor: postcode looks like a UK postcode (got "${result?.postcode}")`);
    assert(result?.address && result.address.length >= 10, `edwardmellor: address present (got "${result?.address}")`);
  }
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Detail extractors: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));

if (failed > 0) process.exit(1);
