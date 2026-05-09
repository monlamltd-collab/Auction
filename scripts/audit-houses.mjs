#!/usr/bin/env node
// scripts/audit-houses.mjs
// One-off CLI audit of every house's homepage. Same per-house logic the
// daily watcher uses (lib/pipeline/homepage-watch.js → auditHouseHomepage)
// — this script just adds CSV output and a console summary so you can
// eyeball drift on demand without waiting for the next cron tick.
//
// Run: FIRECRAWL_API_KEY=fc-... node scripts/audit-houses.mjs
//
// Cost: ~150 Firecrawl scrapes (~150-300 credits). Trivial against the
// monthly budget.

import { writeFileSync } from 'fs';
import { ResourceBudget } from '../lib/resource-budget.js';
import { initState } from '../lib/scraper/state.js';
import { HOUSE_ROOTS } from '../lib/houses.js';
import { auditHouseHomepage, VERDICTS } from '../lib/pipeline/homepage-watch.js';

if (!process.env.FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY env var not set');
  process.exit(1);
}

const budget = new ResourceBudget({ firecrawlApiKey: process.env.FIRECRAWL_API_KEY, monthlyBudget: 500000 });
initState({ budget });

const CONCURRENCY = 5;

function classifyMatch(audit, configured) {
  if (!audit) return 'error';
  if (audit.siteStatus === 'domain_parked') return 'dead';
  if (audit.siteStatus === 'not_an_auction_house') return 'no_longer_auction';
  if (!audit.currentCatalogueUrl) return 'no_catalogue';
  const norm = (u) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  if (norm(audit.currentCatalogueUrl) === norm(configured)) return 'exact_match';
  try {
    const eu = new URL(audit.currentCatalogueUrl);
    const cu = new URL(configured);
    const sameDomain = eu.hostname.replace(/^www\./, '') === cu.hostname.replace(/^www\./, '');
    if (!sameDomain) return 'drift_domain';
    return audit.currentCatalogueUrl.length > configured.length ? 'drift_specific' : 'drift';
  } catch { return 'drift'; }
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++;
      const r = await fn(items[i], i);
      results[i] = r;
      const tag = r.match.padEnd(18);
      console.log(`[${i + 1}/${items.length}] ${tag} ${r.slug} (${r.elapsedMs}ms)`);
    }
  });
  await Promise.all(workers);
  return results;
}

async function auditOne([slug, configuredUrl]) {
  const r = await auditHouseHomepage(slug, configuredUrl);
  const match = r.fetchError ? 'error' : classifyMatch(r.audit, configuredUrl);
  return {
    slug,
    match,
    site_status: r.audit?.siteStatus || (r.fetchError ? 'fetch_failed' : 'unknown'),
    configured_url: configuredUrl,
    extracted_url: r.audit?.currentCatalogueUrl || '',
    next_auction: r.audit?.nextAuctionDate || '',
    has_inventory: r.audit?.hasActiveInventory == null ? '' : r.audit.hasActiveInventory,
    notes: (r.audit?.notes || r.fetchError || '').slice(0, 150),
    elapsedMs: r.elapsedMs,
    verdict: r.decision.verdict,
  };
}

const houses = Object.entries(HOUSE_ROOTS);
console.log(`Auditing ${houses.length} houses (concurrency=${CONCURRENCY})...\n`);

const t0 = Date.now();
const results = await runWithConcurrency(houses, auditOne, CONCURRENCY);
const totalMs = Date.now() - t0;

const stats = {};
for (const r of results) stats[r.match] = (stats[r.match] || 0) + 1;
console.log('\n=== SUMMARY ===');
console.log('Total time:', Math.round(totalMs / 1000) + 's');
console.log('Credits used:', budget.getFcCreditsUsed?.() ?? '?');
console.log('Distribution:');
Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${v}`));

const csvHeader = 'slug,match,site_status,configured_url,extracted_url,next_auction,has_inventory,notes,verdict,ms';
const csvRows = results.map(r => [
  r.slug, r.match, r.site_status, r.configured_url, r.extracted_url,
  r.next_auction, r.has_inventory, (r.notes || '').replace(/[",\n\r]/g, ' '),
  r.verdict, r.elapsedMs,
].map(v => {
  const s = String(v);
  return s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s;
}).join(','));

const outPath = `house-audit-${new Date().toISOString().slice(0, 10)}.csv`;
writeFileSync(outPath, [csvHeader, ...csvRows].join('\n'), 'utf8');
console.log(`\nCSV written to: ${outPath}`);

const drifts = results.filter(r => r.match.startsWith('drift'));
if (drifts.length) {
  console.log(`\n=== ${drifts.length} URL DRIFTS DETECTED ===`);
  for (const r of drifts) {
    console.log(`\n${r.slug} [${r.match}]`);
    console.log(`  configured: ${r.configured_url}`);
    console.log(`  extracted:  ${r.extracted_url}`);
    if (r.notes) console.log(`  notes: ${r.notes}`);
  }
}

process.exit(0);
