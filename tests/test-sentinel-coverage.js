/**
 * Sentinel coverage test — enforces the "every house has a recall sentinel"
 * rule (universal-coverage sweep, 2026-06-12). The recall sentinel is the
 * system's structural-change detector: without one, a house that redesigns
 * its lot presentation can silently lose 30-40% of lots and nothing alerts.
 *
 * A new house MUST either resolve to a sentinel (explicit entry, platform
 * auto-detection, or recogniser pattern) or be documented with a reason in
 * KNOWN_SENTINEL_GAPS — this test fails otherwise, so a blind spot can't
 * ship by accident.
 *
 * Run: node tests/test-sentinel-coverage.js
 */

import { HOUSE_ROOTS } from '../lib/houses.js';
import {
  RECALL_SENTINELS,
  detectPlatformSentinel,
  resolveRecallSentinel,
  KNOWN_SENTINEL_GAPS,
} from '../lib/scraper/recall-sentinels.js';
import { HOUSE_RECOGNISERS } from '../lib/scraper/house-recognisers.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: every HOUSE_ROOTS house resolves to a sentinel (or is a documented gap)');
{
  const slugs = Object.keys(HOUSE_ROOTS);
  const uncovered = slugs.filter(slug =>
    !resolveRecallSentinel(slug, HOUSE_RECOGNISERS[slug]?.recallSentinelPattern)
    && !(slug in KNOWN_SENTINEL_GAPS));
  assert(uncovered.length === 0,
    `0 undocumented blind spots across ${slugs.length} houses` +
    (uncovered.length ? ` — UNCOVERED: ${uncovered.join(', ')}` : ''));
}

console.log('\nTest 2: every sentinel regex has a capture group and the g flag');
{
  let badShape = [];
  for (const [slug, re] of Object.entries(RECALL_SENTINELS)) {
    if (!(re instanceof RegExp) || !re.flags.includes('g') || !/\((?!\?[:=!])/.test(re.source)) {
      badShape.push(slug);
    }
  }
  assert(badShape.length === 0, `all ${Object.keys(RECALL_SENTINELS).length} explicit sentinels are global regexes with a capture group${badShape.length ? ` — BAD: ${badShape.join(', ')}` : ''}`);
}

console.log('\nTest 3: resolution ladder order — override > explicit > platform');
{
  const override = /custom\/(\d+)/g;
  assert(resolveRecallSentinel('paulfosh', override) === override, 'override wins over explicit entry');
  assert(resolveRecallSentinel('paulfosh') === RECALL_SENTINELS.paulfosh, 'explicit entry wins over platform detection');
  const astleys = resolveRecallSentinel('astleys');
  assert(astleys && astleys.source.includes('lot'), 'EIG house resolves via platform auto-detection');
  assert(resolveRecallSentinel('no-such-house') === null, 'unknown slug → null');
}

console.log('\nTest 4: platform auto-detection patterns');
{
  const eig = detectPlatformSentinel('astleys');
  assert(!!'https://astleys.eigonlineauctions.com/lot/details/12345'.match(eig), 'EIG /lot/details/{id} matches');
  const hunters = detectPlatformSentinel('hunters');
  assert(hunters && !!'https://hunters.bambooauctions.com/property/some-house-123456'.match(hunters), 'Bamboo /property/{slug} matches');
}

console.log('\nTest 5: derived sentinels match the real production lot URLs they came from');
{
  const samples = [
    ['hawkesford', 'https://hawkesford.co.uk/property/portland-street-leamington-spa/', 'portland-street-leamington-spa'],
    ['howkinsandharrison', 'https://howkinsandharrison.co.uk/auction/8', '8'],
    ['fisherGerman', 'https://fishergerman.bambooauctions.com/property/chester-cottage-wakefield-road-hampole-doncaster-dn6-7ez-6903829', 'chester-cottage-wakefield-road-hampole-doncaster-dn6-7ez-6903829'],
    ['williamhbrownnorwich', 'https://www.barnardmarcusauctions.co.uk/auctions/19-may-2026/688382/', '688382'],
    ['dedmangray', 'https://www.dedmangray.co.uk/current-auction.htm?lid=4421', '4421'],
  ];
  for (const [slug, url, expectId] of samples) {
    const re = resolveRecallSentinel(slug);
    const m = [...url.matchAll(new RegExp(re.source, re.flags))];
    assert(m.length === 1 && m[0][1] === expectId, `${slug} extracts '${expectId}' (got ${m[0]?.[1] ?? 'no match'})`);
  }
}

console.log('\nTest 6: every KNOWN_SENTINEL_GAPS entry documents a reason string');
{
  const undocumented = Object.entries(KNOWN_SENTINEL_GAPS).filter(([, v]) => typeof v !== 'string' || v.length < 5);
  assert(undocumented.length === 0, 'all gaps carry a reason');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Sentinel coverage tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
