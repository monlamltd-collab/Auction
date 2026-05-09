#!/usr/bin/env node
// Debug: compare single-page /v2/scrape vs /v2/batch/scrape for the same Pattinson URL.
// Hallucination check: are batch results actually from the page or made up?

import { ResourceBudget } from '../lib/resource-budget.js';
import { initState } from '../lib/scraper/state.js';
import { extractCatalogue, batchExtractCatalogues, pollBatchJob } from '../lib/scraper/firecrawl.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) { console.error('ERROR: FIRECRAWL_API_KEY not set'); process.exit(1); }

mkdirSync('scripts/.tmp', { recursive: true });

const budget = new ResourceBudget({ firecrawlApiKey: FIRECRAWL_API_KEY });
initState({ budget });

const URL = 'https://www.pattinson.co.uk/auction/property-search?p=2';

// === Test 1: single-page /v2/scrape ===
console.log('\n=== Test 1: single-page /v2/scrape ===');
const single = await extractCatalogue(URL, { changeTracking: true, fcTimeout: 120000 });
console.log(`Lots: ${single.lots.length}, markdown: ${single.markdown.length} bytes`);
console.log('First 3 lots:');
for (const l of single.lots.slice(0, 3)) {
  console.log(`  ${l.address} — ${l.guide_price} — ${l.detail_url}`);
}
writeFileSync('scripts/.tmp/debug-single.json', JSON.stringify(single, null, 2));
console.log('Saved single → scripts/.tmp/debug-single.json');

// === Test 2: batch with single URL ===
console.log('\n=== Test 2: /v2/batch/scrape with same URL ===');
const { jobId } = await batchExtractCatalogues([URL], { changeTracking: true, maxConcurrency: 1 });
console.log(`Batch job: ${jobId}`);

let status;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 5000));
  status = await pollBatchJob(jobId);
  console.log(`  poll ${i + 1}: status=${status.status} ${status.completed}/${status.total}`);
  if (status.status === 'completed') break;
  if (status.status === 'failed' || status.status === 'cancelled') {
    console.log('Batch failed/cancelled');
    process.exit(1);
  }
}
console.log(`Batch results: ${status.results.length}, credits: ${status.creditsUsed}`);
const r = status.results[0];
console.log(`URL returned: ${r.url}`);
console.log(`Lots: ${r.lots.length}, markdown: ${(r.markdown || '').length} bytes`);
console.log('First 3 lots:');
for (const l of r.lots.slice(0, 3)) {
  console.log(`  ${l.address} — ${l.guide_price} — ${l.detail_url}`);
}
writeFileSync('scripts/.tmp/debug-batch.json', JSON.stringify(status, null, 2));
console.log('Saved batch → scripts/.tmp/debug-batch.json');

// === Compare ===
console.log('\n=== Comparison ===');
console.log(`Single-page lots: ${single.lots.length}`);
console.log(`Batch     lots: ${r.lots.length}`);
console.log(`Same address overlap?`);
const singleAddresses = new Set(single.lots.map(l => l.address));
const overlap = r.lots.filter(l => singleAddresses.has(l.address));
console.log(`  ${overlap.length} of batch's ${r.lots.length} match single's addresses`);

const md = r.markdown || '';
const realMdIds = [...md.matchAll(/\/property\/(\d+)/g)].map(m => m[1]);
console.log(`Markdown property IDs in batch result: ${new Set(realMdIds).size}`);
const jsonIds = r.lots.map(l => (l.detail_url || '').match(/\/property\/(\d+)/)?.[1]).filter(Boolean);
console.log(`JSON detail_url IDs from batch: ${new Set(jsonIds).size}`);
const jsonNotInMd = jsonIds.filter(id => !realMdIds.includes(id));
console.log(`JSON IDs NOT in markdown (= hallucinated): ${jsonNotInMd.length}`);
if (jsonNotInMd.length) console.log(`  hallucinated IDs: ${jsonNotInMd.slice(0, 10).join(', ')}`);

console.log(`\nFirecrawl credits used: ${budget._fc.creditsUsed}`);
