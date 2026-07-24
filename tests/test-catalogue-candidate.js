/**
 * Catalogue candidate scoring + assessment
 * Run: node tests/test-catalogue-candidate.js
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://test.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

import {
  scoreCatalogueUrlPath,
  assessCatalogueCandidate,
  pickBestCatalogueCandidate,
} from '../lib/pipeline/catalogue-candidate.js';

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log('  PASS:', m); passed++; } else { console.error('  FAIL:', m); failed++; } }

console.log('Test 1: reject past / pdf / art / single-lot / junk');
{
  assert(scoreCatalogueUrlPath('https://example.com/past-auctions').reject === true, 'past-auctions reject');
  assert(scoreCatalogueUrlPath('https://example.com/catalogue.pdf').reject === true, 'pdf rejected');
  assert(scoreCatalogueUrlPath('https://example.com/departments/asian-art/aa1').rejectReason === 'non-property', 'asian art');
  assert(scoreCatalogueUrlPath('https://example.com/lots/9065').rejectReason === 'single-lot-url', 'single lot path');
  assert(scoreCatalogueUrlPath('https://facebook.com/auctions').reject === true, 'facebook junk');
  assert(scoreCatalogueUrlPath(null).reject === true, 'null');
  assert(scoreCatalogueUrlPath('null').reject === true, 'string null');
}

console.log('\nTest 2: accept plausible current catalogues');
{
  const a = scoreCatalogueUrlPath('https://www.strakers.co.uk/property-auctions/for-sale/');
  assert(a.reject === false && a.score >= 1, `strakers score ${a.score}`);
  const b = scoreCatalogueUrlPath('https://example.com/current-auction');
  assert(b.reject === false && b.score >= 4, `current-auction score ${b.score}`);
  const c = scoreCatalogueUrlPath('https://online.example.com/search?view=Grid');
  assert(c.reject === false, 'search grid ok');
}

console.log('\nTest 3: assess with html uses lot count when page looks like catalogue');
{
  const html = 'x'.repeat(600) + '/lot/redirect/111 /lot/redirect/222 /lot/redirect/333 /lot/redirect/444 /lot/redirect/555';
  const good = assessCatalogueCandidate('https://example.com/current-auction', html, 'savills');
  assert(good.ok === true, `good ok: ${good.summary}`);
  assert(good.lots >= 4, `lots ${good.lots}`);

  const past = assessCatalogueCandidate('https://example.com/past-auctions', html, 'savills');
  assert(past.ok === false, 'past not ok even with lots');
}

console.log('\nTest 4: pickBest prefers current over homepage');
{
  const best = pickBestCatalogueCandidate([
    'https://example.com/',
    'https://example.com/past-auctions',
    'https://example.com/current-auction/lots',
  ]);
  assert(best && /current-auction/.test(best.u), `best=${best && best.u}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
