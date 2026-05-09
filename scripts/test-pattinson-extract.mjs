#!/usr/bin/env node
// Pattinson lot scraper — Firecrawl JSON-schema extraction with pagination.
// Run: FIRECRAWL_API_KEY=fc-... node scripts/test-pattinson-extract.mjs [pages]
//   pages: optional integer (default 3). Pass `all` to scrape all 84 pages.
// Output: prints summary; writes aggregated lots JSON to scripts/.tmp/

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY not set');
  process.exit(1);
}

const BASE_URL = 'https://www.pattinson.co.uk/auction/property-search';
const FIRECRAWL_TIMEOUT_MS = 120000;
const PAGE_GAP_MS = 1500;
const TOTAL_PAGES = 84;
const arg = process.argv[2];
const PAGES_TO_SCRAPE = arg === 'all' ? TOTAL_PAGES : (parseInt(arg, 10) || 3);

const CATALOGUE_SCHEMA = {
  type: 'object',
  properties: {
    lots: {
      type: 'array',
      description: 'Every property card visible on the page — return ALL of them, typically 20 per page.',
      items: {
        type: 'object',
        properties: {
          lot_number: { type: 'number', description: 'Auction lot number if shown' },
          address: { type: 'string', description: 'Full property address including postcode' },
          guide_price: { type: 'string', description: 'Guide price or price range as shown' },
          property_type: { type: 'string', description: 'house, flat, land, commercial, apartment, etc.' },
          bedrooms: { type: 'number', description: 'Number of bedrooms if stated' },
          tenure: { type: 'string', description: 'Freehold or Leasehold' },
          image_url: { type: 'string', description: 'Main property image URL (full URL)' },
          detail_url: { type: 'string', description: 'Link to full lot details page (full URL)' },
          description: { type: 'string', description: 'Brief property description' },
          lot_status: { type: 'string', description: 'available, sold, withdrawn, postponed' },
          auction_date: { type: 'string', description: 'Auction date if shown on this page' }
        },
        required: ['address', 'detail_url']
      }
    },
    auction_date: { type: 'string', description: 'Overall auction date for this catalogue' },
    total_lots: { type: 'number', description: 'Total number of lots if stated (e.g. "1673 results")' }
  },
  required: ['lots']
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tmpDir = resolve(__dirname, '.tmp');
mkdirSync(tmpDir, { recursive: true });

async function withRetry(fn, label, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const isRetryable = /UND_ERR_SOCKET|fetch failed|timeout|abort|5\d\d/i.test(e.message + (e.cause?.code || ''));
      if (i === attempts - 1 || !isRetryable) throw e;
      const backoff = 2000 * (i + 1);
      console.log(`  ${label}: retry ${i + 1}/${attempts - 1} after ${backoff}ms (${e.cause?.code || e.message})`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

function extractPropIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\/property\/(\d+)/g)) ids.add(m[1]);
  return ids;
}

async function scrapePage(pageNum) {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?p=${pageNum}`;
  const t0 = Date.now();
  const resp = await withRetry(() => fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: [{ type: 'json', schema: CATALOGUE_SCHEMA }, 'markdown'],
      timeout: FIRECRAWL_TIMEOUT_MS,
    }),
    signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS + 30000),
  }), `page ${pageNum}`);

  const elapsed = Date.now() - t0;
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  if (!data.success) throw new Error(`API success=false: ${data.error || 'unknown'}`);

  const json = data.data?.json || {};
  const md = data.data?.markdown || '';
  const lotsFromJson = json.lots || [];

  const propIdsInMd = extractPropIds(md);
  const propIdsInJson = new Set(
    lotsFromJson.map(l => (l.detail_url || '').match(/\/property\/(\d+)/)?.[1]).filter(Boolean)
  );
  const missedIds = [...propIdsInMd].filter(id => !propIdsInJson.has(id));

  return {
    pageNum,
    url,
    elapsed,
    totalLotsStated: json.total_lots,
    auctionDate: json.auction_date,
    lots: lotsFromJson,
    propIdsInMarkdown: propIdsInMd.size,
    missedIds,
  };
}

console.log('Pattinson Firecrawl JSON extract');
console.log(`Pages to scrape: ${PAGES_TO_SCRAPE} of ${TOTAL_PAGES}`);
console.log(`Estimated cost: ~${PAGES_TO_SCRAPE * 2} Firecrawl credits`);
console.log('-'.repeat(60));

const allLots = [];
const seenIds = new Set();
const pageReports = [];

for (let p = 1; p <= PAGES_TO_SCRAPE; p++) {
  try {
    const result = await scrapePage(p);
    let added = 0;
    for (const lot of result.lots) {
      const id = (lot.detail_url || '').match(/\/property\/(\d+)/)?.[1];
      const key = id || `${lot.address}|${lot.guide_price}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      allLots.push({ ...lot, source_page: p });
      added++;
    }
    pageReports.push({
      page: p,
      elapsed_ms: result.elapsed,
      lots_in_json: result.lots.length,
      ids_in_markdown: result.propIdsInMarkdown,
      missed_ids_count: result.missedIds.length,
      added_to_total: added,
    });
    console.log(`  page ${p}: ${result.lots.length} lots from JSON / ${result.propIdsInMarkdown} ids in markdown / +${added} new (${(result.elapsed/1000).toFixed(1)}s)`);
    if (result.missedIds.length > 0) {
      console.log(`    LLM missed ${result.missedIds.length} ids: ${result.missedIds.slice(0,5).join(',')}${result.missedIds.length > 5 ? '...' : ''}`);
    }
  } catch (e) {
    console.log(`  page ${p}: FAILED — ${e.message}`);
    pageReports.push({ page: p, error: e.message });
  }
  if (p < PAGES_TO_SCRAPE) await new Promise(r => setTimeout(r, PAGE_GAP_MS));
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = resolve(tmpDir, `pattinson-aggregate-${ts}.json`);
writeFileSync(outFile, JSON.stringify({
  scraped_at: new Date().toISOString(),
  pages_scraped: PAGES_TO_SCRAPE,
  total_pages_available: TOTAL_PAGES,
  total_unique_lots: allLots.length,
  page_reports: pageReports,
  lots: allLots,
}, null, 2));

console.log('-'.repeat(60));
console.log(`Aggregate file: ${outFile}`);
console.log(`Total unique lots: ${allLots.length}`);
console.log('');

if (allLots.length > 0) {
  const cov = (field) => {
    const n = allLots.filter(l => l[field] !== undefined && l[field] !== null && l[field] !== '').length;
    return `${n}/${allLots.length} (${((n / allLots.length) * 100).toFixed(0)}%)`;
  };
  console.log('Field coverage across all aggregated lots:');
  console.log(`  lot_number:    ${cov('lot_number')}`);
  console.log(`  address:       ${cov('address')}`);
  console.log(`  guide_price:   ${cov('guide_price')}`);
  console.log(`  property_type: ${cov('property_type')}`);
  console.log(`  bedrooms:      ${cov('bedrooms')}`);
  console.log(`  image_url:     ${cov('image_url')}`);
  console.log(`  detail_url:    ${cov('detail_url')}`);
  console.log(`  lot_status:    ${cov('lot_status')}`);

  console.log('');
  console.log('First 3 lots:');
  for (const lot of allLots.slice(0, 3)) {
    console.log(`  ${lot.lot_number ?? '?'}. ${lot.address} — ${lot.guide_price} — ${lot.detail_url}`);
  }
  console.log('Last 3 lots:');
  for (const lot of allLots.slice(-3)) {
    console.log(`  ${lot.lot_number ?? '?'}. ${lot.address} — ${lot.guide_price} — ${lot.detail_url}`);
  }
}
