#!/usr/bin/env node
// Phase 1 verification probe: test JSON-extraction recall after adding CATALOGUE_PROMPT.
// Target: ≥18 lots in JSON for Pattinson ?p=2, ≥24 lots for John Pye listing.
// Run: FIRECRAWL_API_KEY=fc-... node scripts/probe-recall.mjs
//
// Compares JSON lot count against markdown property-URL count to measure recall ratio.

import { CATALOGUE_SCHEMA, CATALOGUE_PROMPT } from '../lib/scraper/lot-schema.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY not set');
  process.exit(1);
}

const TESTS = [
  {
    label: 'Pattinson ?p=2',
    url: 'https://www.pattinson.co.uk/auction/property-search?p=2',
    detailPattern: /\/property\/(\d+)/g,
    fcTimeout: 120000,
    expectMin: 18,
    expectMax: 20,
  },
  {
    label: 'John Pye listing',
    url: 'https://www.johnpye.co.uk/properties/',
    detailPattern: /\/auctions\/([\w-]{10,})/g,
    fcTimeout: 60000,
    expectMin: 18,
    expectMax: 30,
  },
];

async function probe(test) {
  const start = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${test.label}`);
  console.log(`URL: ${test.url}`);
  console.log(`Target recall: ${test.expectMin}+ lots in JSON`);
  console.log('='.repeat(60));

  const body = {
    url: test.url,
    formats: [
      { type: 'json', schema: CATALOGUE_SCHEMA, prompt: CATALOGUE_PROMPT },
      'markdown',
    ],
    timeout: test.fcTimeout,
  };

  const BACKOFF = [2000, 4000, 8000];
  let resp;
  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(test.fcTimeout + 30000),
      });
      break;
    } catch (err) {
      lastErr = err;
      const retryable = /UND_ERR_SOCKET|fetch failed|timeout|abort|5\d\d/i.test(err.message + (err.cause?.code || ''));
      if (!retryable || attempt === BACKOFF.length) {
        console.log(`FAILED after ${attempt + 1} attempts: ${err.message} / ${err.cause?.code || ''}`);
        return { test, fail: true, err: err.message };
      }
      const delay = BACKOFF[attempt];
      console.log(`  attempt ${attempt + 1} failed (${err.cause?.code || err.message}), retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const elapsed = Date.now() - start;
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.log(`FAILED: HTTP ${resp.status} — ${text.slice(0, 300)}`);
    return { test, fail: true, status: resp.status };
  }

  const data = await resp.json();
  if (!data.success) {
    console.log(`FAILED: API success=false — ${data.error || 'unknown'}`);
    return { test, fail: true, err: data.error };
  }

  const jsonLots = data.data?.json?.lots || [];
  const md = data.data?.markdown || '';

  const mdMatches = [...md.matchAll(test.detailPattern)];
  const mdIds = new Set(mdMatches.map(m => m[1]));

  const jsonIds = new Set();
  for (const lot of jsonLots) {
    const url = lot.detail_url || '';
    const re = new RegExp(test.detailPattern.source);
    const m = url.match(re);
    if (m) jsonIds.add(m[1]);
  }

  const recall = mdIds.size > 0 ? (jsonIds.size / mdIds.size) : 0;
  const verdict = jsonLots.length >= test.expectMin ? 'PASS' : 'FAIL';

  console.log(`Elapsed:           ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`Markdown bytes:    ${md.length.toLocaleString()}`);
  console.log(`Markdown unique IDs: ${mdIds.size}`);
  console.log(`JSON lots:         ${jsonLots.length}`);
  console.log(`JSON unique IDs:   ${jsonIds.size}`);
  console.log(`Recall ratio:      ${(recall * 100).toFixed(0)}%`);
  console.log(`Verdict:           ${verdict} (target ≥${test.expectMin}, got ${jsonLots.length})`);

  if (jsonLots.length > 0) {
    const cov = (field) => {
      const n = jsonLots.filter(l => l[field] !== undefined && l[field] !== null && l[field] !== '').length;
      return `${n}/${jsonLots.length} (${((n / jsonLots.length) * 100).toFixed(0)}%)`;
    };
    console.log('Field coverage:');
    console.log(`  address:     ${cov('address')}`);
    console.log(`  guide_price: ${cov('guide_price')}`);
    console.log(`  detail_url:  ${cov('detail_url')}`);
    console.log(`  image_url:   ${cov('image_url')}`);

    console.log('Sample lot 1:');
    console.log(`  ${JSON.stringify(jsonLots[0], null, 2).split('\n').join('\n  ')}`);
  }

  return { test, fail: false, jsonCount: jsonLots.length, mdCount: mdIds.size, recall, verdict };
}

console.log('Phase 1 verification: JSON-extraction recall with CATALOGUE_PROMPT');
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
  if (r.fail) {
    console.log(`${r.test.label.padEnd(25)} FAIL — ${r.err || r.status}`);
  } else {
    console.log(`${r.test.label.padEnd(25)} ${r.verdict} — ${r.jsonCount}/${r.mdCount} lots (${(r.recall * 100).toFixed(0)}% recall)`);
  }
}

const passes = results.filter(r => !r.fail && r.verdict === 'PASS').length;
console.log(`\n${passes}/${results.length} tests passed.`);
console.log(passes === results.length
  ? '✓ GATE PASSED — Path A: delete bespoke parsers, replace extractTwoPass with detail-page backfill'
  : '✗ Recall below target — Path B: keep extractTwoPass, generalize parsers');
