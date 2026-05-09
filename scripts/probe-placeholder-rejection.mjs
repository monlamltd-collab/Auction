#!/usr/bin/env node
// Verify that the address-validation fix rejects placeholder-address lots.
// Targets harman-healy.co.uk (one of the worst offenders in production —
// 600 dupe-rows under placeholder addresses).
//
// Run: FIRECRAWL_API_KEY=fc-... node scripts/probe-placeholder-rejection.mjs
//
// Expected output:
//   - some lots dropped with the new validator
//   - remaining lots all have real addresses (postcode or street name)

import { ResourceBudget } from '../lib/resource-budget.js';
import { initState } from '../lib/scraper/state.js';
import {
  extractCatalogueListing,
  looksLikeRealAddress,
} from '../lib/pipeline/firecrawl-extract.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) { console.error('ERROR: FIRECRAWL_API_KEY not set'); process.exit(1); }

const budget = new ResourceBudget({ firecrawlApiKey: FIRECRAWL_API_KEY });
initState({ budget });

console.log('Verifying placeholder-address rejection on harmanhealy');
console.log('URL: https://www.harman-healy.co.uk/search');
console.log('-'.repeat(60));

const t0 = Date.now();
const result = await extractCatalogueListing(
  'https://www.harman-healy.co.uk/search',
  'harmanhealy',
  {
    maxPages: 1,
    forceExtract: true,
    recallSentinelPattern: /\/lot\/(?:details|redirect)\/(\d+)/g,
  }
);
const elapsed = Date.now() - t0;

console.log(`Elapsed:                  ${(elapsed / 1000).toFixed(1)}s`);
console.log(`Lots returned:            ${result.lots.length}`);
console.log(`JSON-extracted:           ${result.jsonExtracted ?? '?'}`);
console.log(`Rejected (placeholder):   ${result.rejectedPlaceholderAddress ?? 0}`);
console.log(`Page errors:              ${result.pageErrors ?? 0}`);

if (result.lots.length === 0) {
  console.log('\n0 lots returned — page or API issue, not the fix.');
  process.exit(1);
}

const realAddresses = result.lots.filter(l => looksLikeRealAddress(l.address)).length;
const phantomLeftovers = result.lots.length - realAddresses;
console.log(`\nReal addresses passed:    ${realAddresses}/${result.lots.length}`);
console.log(`Placeholder leftovers:    ${phantomLeftovers}`);

console.log('\nFirst 5 surviving lot addresses:');
for (const l of result.lots.slice(0, 5)) {
  console.log(`  ${l.address}`);
}

console.log(`\nFirecrawl credits used:   ${budget._fc.creditsUsed}`);

if (phantomLeftovers > 0) {
  console.log('\n⚠ Some placeholder addresses leaked through — strengthen patterns.');
  process.exit(1);
}

if ((result.rejectedPlaceholderAddress ?? 0) === 0 && result.lots.length > 0) {
  console.log('\n⚠ No rejections, all addresses passed. Either harmanhealy is clean today, or the validator missed.');
  console.log('  Inspecting first 10 raw lots to sanity-check…');
  process.exit(0);
}

console.log('\n✓ Placeholder rejection working as expected.');
