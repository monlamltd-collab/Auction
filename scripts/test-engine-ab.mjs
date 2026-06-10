#!/usr/bin/env node
// scripts/test-engine-ab.mjs — A/B one house across both engines.
//
// Renders+extracts a catalogue with BOTH the Firecrawl incumbent and the
// Crawlee+Gemini challenger, then runs the product-integrity parity gate and
// prints the verdict. Use it to pre-qualify a house before adding it to
// CRAWLEE_HOUSES.
//
// Run: FIRECRAWL_API_KEY=fc-... GEMINI_API_KEY=... \
//        node scripts/test-engine-ab.mjs <slug> <catalogue-url> [paginateAs]
//
// Requires `npm install crawlee` + system Chromium for the Crawlee side.

import { ResourceBudget } from '../lib/resource-budget.js';
import { initState } from '../lib/scraper/state.js';
import { callAI, initAI } from '../lib/ai-provider.js';
import { extractCatalogueListing } from '../lib/pipeline/firecrawl-extract.js';
import { renderAndExtractWithCrawlee } from '../lib/pipeline/crawlee-extract.js';
import { hasCrawlee, teardownCrawlee } from '../lib/scraper/crawlee.js';
import { evaluateParity } from '../lib/pipeline/parity-gate.js';

const [slug, url, paginateAs] = process.argv.slice(2);
if (!slug || !url) {
  console.error('Usage: node scripts/test-engine-ab.mjs <slug> <catalogue-url> [paginateAs]');
  process.exit(1);
}
if (!process.env.FIRECRAWL_API_KEY) { console.error('ERROR: FIRECRAWL_API_KEY not set'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('ERROR: GEMINI_API_KEY not set'); process.exit(1); }
if (!hasCrawlee()) { console.error('ERROR: crawlee not installed — run `npm install crawlee`'); process.exit(1); }

const budget = new ResourceBudget({ firecrawlApiKey: process.env.FIRECRAWL_API_KEY });
initAI?.();
initState({ budget, callAI });

// EIG / AH UK / Bamboo sentinel, mirroring detectPlatformSentinel in analysis.js.
function sentinelFor(u) {
  if (/eigonlineauctions\.com|eigpropertyauctions\.co\.uk|auctionhouse\.co\.uk/.test(u)) return /\/lot\/(?:details|redirect)\/(\d+)/g;
  if (/bambooauctions\.com/.test(u)) return /\/property\/([a-z0-9_-]{6,})/gi;
  return null;
}
const recallSentinelPattern = sentinelFor(url);

function pct(r) { return r == null ? 'n/a' : `${(r * 100).toFixed(0)}%`; }

async function main() {
  console.log(`\nA/B engine test — ${slug}\n${url}\n${'='.repeat(60)}`);

  console.log('\n[1/2] Firecrawl incumbent…');
  const fc = await extractCatalogueListing(url, slug, {
    paginateAs: paginateAs || 'query_page',
    maxPages: paginateAs ? 25 : 1,
    changeTracking: false,
    forceExtract: true,
    recallSentinelPattern,
  });
  console.log(`  Firecrawl: ${fc.lots.length} lots, recall ${pct(fc.recall)}`);

  console.log('\n[2/2] Crawlee + Gemini challenger…');
  const cr = await renderAndExtractWithCrawlee(url, slug, {
    maxPages: paginateAs ? 25 : 1,
    recallSentinelPattern,
  });
  console.log(`  Crawlee+Gemini: ${cr.lots.length} lots, recall ${pct(cr.recall)}`);

  const verdict = evaluateParity({
    incumbent: { lots: fc.lots, recall: fc.recall },
    challenger: { lots: cr.lots, recall: cr.recall },
    house: slug,
  });

  console.log(`\n${'='.repeat(60)}\nPARITY VERDICT`);
  console.log(`  promote:        ${verdict.promote ? 'YES → safe to migrate' : 'NO — keep Firecrawl'}`);
  console.log(`  reason:         ${verdict.reason}`);
  console.log(`  recall:         fc ${pct(verdict.incRecall)} vs cr ${pct(verdict.chRecall)} (${verdict.recallVerdict.reason})`);
  console.log(`  batchQuality:   fc ${verdict.incBatchQuality} vs cr ${verdict.chBatchQuality} (qualityOk=${verdict.qualityOk})`);
  console.log(`  field regress.: ${verdict.regressions.length ? verdict.regressions.map(r => `${r.label} -${r.drop_pct}pp`).join(', ') : 'none'}`);
  console.log(`  lots:           fc ${verdict.incLots} vs cr ${verdict.chLots}`);

  await teardownCrawlee();
  process.exit(0);
}

main().catch(async (err) => { console.error('ERROR:', err.message); try { await teardownCrawlee(); } catch {} process.exit(1); });
