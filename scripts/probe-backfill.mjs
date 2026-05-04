#!/usr/bin/env node
// End-to-end verification of extractCatalogueWithBackfill (Path A).
// Tests the unified function against:
//   • Pattinson (3 pages) — exercises batch + detail-page backfill
//   • John Pye (1 page)   — exercises single-page + slug-based backfill
// Run: FIRECRAWL_API_KEY=fc-... node scripts/probe-backfill.mjs

import { ResourceBudget } from '../lib/resource-budget.js';
import { initState } from '../lib/scraper/state.js';
import { extractCatalogueWithBackfill } from '../lib/pipeline/firecrawl-extract.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY not set');
  process.exit(1);
}

const budget = new ResourceBudget({ firecrawlApiKey: FIRECRAWL_API_KEY });
initState({ budget });

const TESTS = [
  {
    label: 'Pattinson (3 pages)',
    url: 'https://www.pattinson.co.uk/auction/property-search',
    house: 'pattinson',
    options: {
      maxPages: 3,
      paginateAs: 'pattinson_p',
      detailUrlPattern: /\/property\/(\d+)/g,
      buildDetailUrl: (id) => `https://www.pattinson.co.uk/property/${id}`,
      maxConcurrency: 5,
      changeTracking: false,    // Pattinson drops the socket with changeTracking on
    },
    expectMin: 50,    // 3 pages × ~20 lots = 60 max; 50 is a comfortable floor
  },
  {
    label: 'John Pye (1 page)',
    url: 'https://www.johnpye.co.uk/properties/',
    house: 'johnpye',
    options: {
      maxPages: 1,
      detailUrlPattern: /\/auctions\/([\w-]{10,})/g,
      buildDetailUrl: (slug) => `https://www.johnpye.co.uk/auctions/${slug}/`,
      forceExtract: true,
    },
    expectMin: 24,    // markdown showed 24 IDs; aim to recover all
  },
];

async function probe(test) {
  const start = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${test.label}`);
  console.log(`URL: ${test.url}`);
  console.log(`Target: ≥${test.expectMin} lots`);
  console.log('='.repeat(60));

  try {
    const result = await extractCatalogueWithBackfill(test.url, test.house, test.options);
    const elapsed = Date.now() - start;

    if (result.skipped) {
      console.log(`SKIPPED (${result.reason})`);
      return { test, fail: false, skipped: true };
    }

    const verdict = result.lots.length >= test.expectMin ? 'PASS' : 'FAIL';
    console.log(`Elapsed:        ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`Total lots:     ${result.lots.length}`);
    console.log(`Backfilled:     ${result.backfillCount || 0}`);
    console.log(`Page errors:    ${result.pageErrors || 0}`);
    console.log(`Verdict:        ${verdict} (target ≥${test.expectMin}, got ${result.lots.length})`);

    if (result.lots.length > 0) {
      const cov = (field) => {
        const n = result.lots.filter(l => l[field] !== undefined && l[field] !== null && l[field] !== '').length;
        return `${n}/${result.lots.length} (${((n / result.lots.length) * 100).toFixed(0)}%)`;
      };
      console.log('Field coverage:');
      console.log(`  address:    ${cov('address')}`);
      console.log(`  priceStr:   ${cov('priceStr')}`);
      console.log(`  url:        ${cov('url')}`);
      console.log(`  imageUrl:   ${cov('imageUrl')}`);

      const sources = {};
      for (const l of result.lots) {
        sources[l._extractionSource] = (sources[l._extractionSource] || 0) + 1;
      }
      console.log('Sources:');
      for (const [src, n] of Object.entries(sources)) console.log(`  ${src}: ${n}`);

      console.log('Sample lot 1:');
      const sampleLot = result.lots[0];
      console.log(`  ${sampleLot.address} — ${sampleLot.priceStr} — ${sampleLot.url}`);
      if (result.lots.length > 1) {
        const sampleLot2 = result.lots[result.lots.length - 1];
        console.log('Sample last lot:');
        console.log(`  ${sampleLot2.address} — ${sampleLot2.priceStr} — ${sampleLot2.url}`);
      }
    }

    return { test, fail: verdict === 'FAIL', count: result.lots.length, backfilled: result.backfillCount || 0, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`FAILED: ${err.message}`);
    console.log(err.stack);
    return { test, fail: true, err: err.message, elapsed };
  }
}

console.log('Verification: extractCatalogueWithBackfill (Path A)');
console.log(`API key: ${FIRECRAWL_API_KEY.slice(0, 8)}...${FIRECRAWL_API_KEY.slice(-4)}`);

const results = [];
for (const test of TESTS) {
  results.push(await probe(test));
  await new Promise(r => setTimeout(r, 2000));
}

console.log(`\n${'='.repeat(60)}`);
console.log('SUMMARY');
console.log('='.repeat(60));
for (const r of results) {
  if (r.skipped) {
    console.log(`${r.test.label.padEnd(25)} SKIPPED`);
  } else if (r.fail) {
    console.log(`${r.test.label.padEnd(25)} FAIL — ${r.err || `${r.count}/${r.test.expectMin} lots`}`);
  } else {
    console.log(`${r.test.label.padEnd(25)} PASS — ${r.count} lots (${r.backfilled} backfilled, ${(r.elapsed / 1000).toFixed(1)}s)`);
  }
}

console.log(`\nFirecrawl credits used: ${budget._fc.creditsUsed}`);

const passes = results.filter(r => !r.fail).length;
process.exit(passes === results.length ? 0 : 1);
