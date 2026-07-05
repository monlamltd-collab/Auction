/**
 * AH future-auction-dates resolver tests
 * ======================================
 * Covers:
 *  - parseAhFutureDates: pure markdown → Map<slug, catalogueUrl>
 *  - AH_PLATFORM_SLUGS membership (all auctionhouse.co.uk slugs included)
 *  - fetchAhFutureDates: success, empty markdown, throw → null
 *  - auditHouseHomepage AH short-circuit: map hit, map miss, resolver null
 *
 * Run: node tests/test-ah-resolver.js
 */

import {
  AH_PLATFORM_SLUGS,
  AH_FUTURE_DATES_URL,
  parseAhFutureDates,
  fetchAhFutureDates,
} from '../lib/pipeline/ah-resolver.js';
import { auditHouseHomepage, VERDICTS } from '../lib/pipeline/homepage-watch.js';
import { HOUSE_ROOTS } from '../lib/houses.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── Test 1: AH_PLATFORM_SLUGS contains every auctionhouse.co.uk slug ──
console.log('Test 1: AH_PLATFORM_SLUGS membership matches HOUSE_ROOTS');
{
  const expected = Object.entries(HOUSE_ROOTS)
    .filter(([, url]) => {
      try { return new URL(url).hostname.replace(/^www\./, '') === 'auctionhouse.co.uk'; }
      catch { return false; }
    })
    .map(([slug]) => slug);
  assert(expected.length > 30, `>30 AH slugs expected, got ${expected.length}`);
  for (const slug of expected) {
    assert(AH_PLATFORM_SLUGS.has(slug), `${slug} present in AH_PLATFORM_SLUGS`);
  }
  // Spot-check a few critical ones
  // (westmidlands — the original "Simon's alert" case — retired 2026-07-05; its
  // successor branch /midlands/ carries the spot-check now)
  assert(AH_PLATFORM_SLUGS.has('auctionhousemidlands'), 'midlands in set (westmidlands successor)');
  assert(AH_PLATFORM_SLUGS.has('auctionhouse'), '/online slug in set');
  assert(AH_PLATFORM_SLUGS.has('auctionhousenational'), '/national slug in set');
  assert(AH_PLATFORM_SLUGS.has('austingray'), 'austingray (sussexandhampshire) in set');
  assert(!AH_PLATFORM_SLUGS.has('auctionhouselondon'), 'auctionhouselondon NOT in set (different domain)');
  assert(!AH_PLATFORM_SLUGS.has('savills'), 'unrelated slug excluded');
}

// ── Test 2: parseAhFutureDates handles lots/<id> form ──
console.log('\nTest 2: parseAhFutureDates — /<region>/auction/lots/<id> form');
{
  const md = `
| Branch | Date | View |
| Auction House Birmingham | 10/06/2026 | [View Lots](/birmingham/auction/lots/9328) |
| Auction House South West | 17/06/2026 | [View Lots](/southwest/auction/lots/9064) |
| Auction House Midlands | 18/06/2026 | [View Lots](/midlands/auction/lots/1234) |
`;
  const out = parseAhFutureDates(md);
  assert(out.get('auctionhousebirmingham') === 'https://www.auctionhouse.co.uk/birmingham/auction/lots/9328', 'birmingham mapped');
  assert(out.get('auctionhousesouthwest') === 'https://www.auctionhouse.co.uk/southwest/auction/lots/9064', 'southwest mapped');
  assert(out.get('auctionhousemidlands') === 'https://www.auctionhouse.co.uk/midlands/auction/lots/1234', 'midlands mapped (westmidlands successor)');
}

// ── Test 3: parseAhFutureDates handles date form /<region>/auction/yyyy/mm/dd ──
console.log('\nTest 3: parseAhFutureDates — /<region>/auction/<yyyy>/<mm>/<dd> form');
{
  const md = '[View](/wales/auction/2026/6/24) and [View](/southwales/auction/2026/12/3)';
  const out = parseAhFutureDates(md);
  assert(out.get('auctionhousewales') === 'https://www.auctionhouse.co.uk/wales/auction/2026/6/24', 'wales date form mapped');
}

// ── Test 4: parseAhFutureDates handles absolute URLs in markdown ──
console.log('\nTest 4: parseAhFutureDates — absolute URLs');
{
  const md = '<a href="https://www.auctionhouse.co.uk/kent/auction/lots/777">Kent</a>';
  const out = parseAhFutureDates(md);
  assert(out.get('auctionhousekent') === 'https://www.auctionhouse.co.uk/kent/auction/lots/777', 'kent mapped from href');
}

// ── Test 5: parseAhFutureDates ignores unknown regions ──
console.log('\nTest 5: parseAhFutureDates — unknown regions ignored');
{
  const md = '[Mars](/mars/auction/lots/1) [Birmingham](/birmingham/auction/lots/9328)';
  const out = parseAhFutureDates(md);
  assert(!out.has('mars'), 'mars region ignored (no matching slug)');
  assert(out.get('auctionhousebirmingham'), 'birmingham still mapped');
  assert(out.size === 1, 'only known region included');
}

// ── Test 6: parseAhFutureDates — empty/null markdown returns empty map ──
console.log('\nTest 6: parseAhFutureDates — empty input');
{
  assert(parseAhFutureDates('').size === 0, 'empty string → empty map');
  assert(parseAhFutureDates(null).size === 0, 'null → empty map');
  assert(parseAhFutureDates(undefined).size === 0, 'undefined → empty map');
}

// ── Test 7: parseAhFutureDates — first match per slug wins ──
console.log('\nTest 7: parseAhFutureDates — first match wins per slug');
{
  const md = '[First](/birmingham/auction/lots/100) [Second](/birmingham/auction/lots/200)';
  const out = parseAhFutureDates(md);
  assert(out.get('auctionhousebirmingham').endsWith('/lots/100'), 'first occurrence retained');
}

// ── Test 8: fetchAhFutureDates — success returns parsed map ──
console.log('\nTest 8: fetchAhFutureDates — success');
{
  const fakeFetchMarkdown = async () => '[Birmingham](/birmingham/auction/lots/9328)';
  const out = await fetchAhFutureDates({ fetchMarkdown: fakeFetchMarkdown });
  assert(out instanceof Map, 'returns Map on success');
  assert(out.get('auctionhousebirmingham').endsWith('/lots/9328'), 'parsed correctly');
}

// ── Test 9: fetchAhFutureDates — empty markdown → null ──
console.log('\nTest 9: fetchAhFutureDates — empty markdown');
{
  const fakeFetchMarkdown = async () => '';
  const out = await fetchAhFutureDates({ fetchMarkdown: fakeFetchMarkdown });
  assert(out === null, 'returns null when markdown empty');
}

// ── Test 10: fetchAhFutureDates — no parseable links → null ──
console.log('\nTest 10: fetchAhFutureDates — no parseable links');
{
  const fakeFetchMarkdown = async () => 'no auction links here';
  const out = await fetchAhFutureDates({ fetchMarkdown: fakeFetchMarkdown });
  assert(out === null, 'returns null when nothing parses');
}

// ── Test 11: fetchAhFutureDates — fetch throws → null ──
console.log('\nTest 11: fetchAhFutureDates — fetch throws');
{
  const fakeFetchMarkdown = async () => { throw new Error('fetch down'); };
  const out = await fetchAhFutureDates({ fetchMarkdown: fakeFetchMarkdown });
  assert(out === null, 'returns null when fetch throws');
}

// ── Test 12: auditHouseHomepage AH short-circuit — map hit, URLs match ──
console.log('\nTest 12: auditHouseHomepage — AH slug, map hit, no drift');
{
  // fixture must be a LIVE AH branch — retired slugs (e.g. westmidlands, retired
  // 2026-07-05) short-circuit to a null audit before the resolver runs
  const ahMap = new Map([
    ['auctionhouseessex', 'https://www.auctionhouse.co.uk/essex/auction/search-results'],
  ]);
  const r = await auditHouseHomepage(
    'auctionhouseessex',
    'https://www.auctionhouse.co.uk/essex/auction/search-results',
    { ahMap, prev: { last_change_status: 'same', consecutive_unchanged: 1 } }
  );
  assert(r.audit.currentCatalogueUrl.includes('/essex/'), 'uses resolver URL');
  assert(r.decision.verdict === VERDICTS.RECORD_ONLY, 'record_only when resolver matches configured');
  assert(r.decision.shouldAlert === false, 'no alert');
  assert(r.homepage === AH_FUTURE_DATES_URL, 'audit attributed to future-auction-dates page');
}

// ── Test 13: auditHouseHomepage AH short-circuit — map hit, real drift ──
console.log('\nTest 13: auditHouseHomepage — AH slug, real drift (new dated URL)');
{
  const ahMap = new Map([
    ['auctionhousebirmingham', 'https://www.auctionhouse.co.uk/birmingham/auction/lots/9999'],
  ]);
  const r = await auditHouseHomepage(
    'auctionhousebirmingham',
    'https://www.auctionhouse.co.uk/birmingham/auction/search-results',
    { ahMap, prev: { last_change_status: 'same' } }
  );
  assert(r.decision.verdict === VERDICTS.URL_DRIFT_SAME_DOMAIN, 'real drift flagged');
  assert(r.decision.shouldHeal === true, 'heal fires');
  assert(r.decision.candidateUrl.endsWith('/lots/9999'), 'dated URL is candidate');
}

// ── Test 14: auditHouseHomepage AH short-circuit — slug not in map ──
console.log('\nTest 14: auditHouseHomepage — AH slug, not in map (no upcoming)');
{
  const ahMap = new Map([
    ['auctionhousebirmingham', 'https://www.auctionhouse.co.uk/birmingham/auction/lots/1'],
  ]);
  const r = await auditHouseHomepage(
    'auctionhousemanchester',
    'https://www.auctionhouse.co.uk/manchester/auction/search-results',
    { ahMap, prev: { last_change_status: 'same' } }
  );
  // Configured URL treated as authoritative when no upcoming → no drift fires
  assert(r.decision.verdict === VERDICTS.RECORD_ONLY, 'no drift when not in map');
  assert(r.audit.notes.includes('no upcoming'), 'notes explain why');
}

// ── Test 15: auditHouseHomepage AH short-circuit — resolver null (failed) ──
console.log('\nTest 15: auditHouseHomepage — AH slug, resolver null (skip cycle)');
{
  const r = await auditHouseHomepage(
    'auctionhousemanchester',
    'https://www.auctionhouse.co.uk/manchester/auction/search-results',
    { ahMap: null, prev: { last_change_status: 'same' } }
  );
  assert(r.decision.verdict === VERDICTS.AH_RESOLVER_UNAVAILABLE, 'AH_RESOLVER_UNAVAILABLE verdict');
  assert(r.decision.shouldAlert === false, 'no alert when resolver unavailable');
  assert(r.decision.shouldHeal === false, 'no heal when resolver unavailable');
  assert(r.audit.notes.includes('resolver unavailable'), 'notes explain skip reason');
}

// ── Test 16: auditHouseHomepage non-AH slug unaffected ──
console.log('\nTest 16: auditHouseHomepage — non-AH slug ignores ahMap');
{
  // Inject a fake extractHomepage via the AH map path would be wrong here;
  // the non-AH branch calls Firecrawl which we can't stub from outside.
  // Instead just verify it doesn't go down the AH short-circuit by checking
  // that ahMap is ignored: the slug isn't in AH_PLATFORM_SLUGS so the
  // function falls through to the Firecrawl call. We don't actually call it
  // (no FIRECRAWL_API_KEY in test env); we just confirm the AH branch is
  // skipped by inspecting AH_PLATFORM_SLUGS directly.
  assert(!AH_PLATFORM_SLUGS.has('savills'), 'savills not in AH set → would not short-circuit');
  assert(!AH_PLATFORM_SLUGS.has('pattinson'), 'pattinson not in AH set');
}

// ═══════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
