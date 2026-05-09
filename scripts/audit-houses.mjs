// scripts/audit-houses.mjs
// One-off audit: for every configured house, ask Firecrawl to find the current
// auction catalogue URL on the house's homepage. Compare to HOUSE_ROOTS.
// Output CSV so we can eyeball where URLs have drifted.
//
// Run: node scripts/audit-houses.mjs
//
// Cost: ~171 Firecrawl scrape calls with json extraction (~340 credits).
// Trivial against 500k monthly budget.

import { writeFileSync } from 'fs';
import { ResourceBudget } from '../lib/resource-budget.js';
import { initState } from '../lib/scraper/state.js';
import { HOUSE_ROOTS } from '../lib/houses.js';

if (!process.env.FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY env var not set');
  process.exit(1);
}
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

const budget = new ResourceBudget({ firecrawlApiKey: FIRECRAWL_KEY, monthlyBudget: 500000 });
initState({ budget });

const CONCURRENCY = 5;
const HOUSE_AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    current_catalogue_url: {
      type: 'string',
      description: 'Full URL of the current or next upcoming property auction catalogue page on this site. The page that lists individual lots/properties for sale at auction. Return null if no catalogue is linked from this page.',
    },
    next_auction_date: {
      type: 'string',
      description: 'Date of the next auction (e.g. "19 May 2026") if visible, else null',
    },
    has_active_inventory: {
      type: 'boolean',
      description: 'Whether the page indicates there are currently lots/properties listed for an upcoming or active auction',
    },
    site_status: {
      type: 'string',
      description: 'One of: "active" (auction house operating), "no_current_auction" (between auctions), "domain_parked" (site dead), "not_an_auction_house"',
    },
    notes: {
      type: 'string',
      description: 'One short sentence noting anything unusual (e.g. "site requires login", "redirected to different domain", "now part of larger group")',
    },
  },
  required: ['current_catalogue_url'],
};

function getHomepage(url) {
  try {
    const u = new URL(url);
    return u.origin + '/';
  } catch {
    return url;
  }
}

async function auditHouse(slug, configuredUrl) {
  const homepage = getHomepage(configuredUrl);
  const t0 = Date.now();

  try {
    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: homepage,
        formats: [{ type: 'json', schema: HOUSE_AUDIT_SCHEMA }, 'markdown'],
        timeout: 60000,
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return {
        slug, configured_url: configuredUrl, homepage,
        extracted_url: null, next_auction: null, site_status: 'fetch_failed',
        match: 'error', notes: `HTTP ${resp.status}: ${txt.slice(0, 100)}`,
        ms: Date.now() - t0,
      };
    }

    const data = await resp.json();
    if (!data.success) {
      return {
        slug, configured_url: configuredUrl, homepage,
        extracted_url: null, next_auction: null, site_status: 'fetch_failed',
        match: 'error', notes: `Firecrawl error: ${data.error || 'unknown'}`,
        ms: Date.now() - t0,
      };
    }

    const extracted = data.data?.json || {};
    const md = data.data?.markdown || '';
    const is404 = /can.t be found|page not found|http error 404|no webpage|not_found|domain.{0,30}parked/i.test(md);

    const extractedUrl = extracted.current_catalogue_url || null;
    let match = 'unknown';
    if (is404) match = 'dead';
    else if (!extractedUrl) match = 'no_catalogue';
    else if (extractedUrl === configuredUrl) match = 'exact_match';
    else if (extractedUrl.replace(/\/+$/, '') === configuredUrl.replace(/\/+$/, '')) match = 'exact_match';
    else {
      // Check if extracted is a "more specific" version of configured (e.g. configured = root, extracted = specific date)
      try {
        const eu = new URL(extractedUrl);
        const cu = new URL(configuredUrl);
        if (eu.origin === cu.origin) match = extractedUrl.length > configuredUrl.length ? 'drift_specific' : 'drift';
        else match = 'drift_domain';
      } catch {
        match = 'drift';
      }
    }

    return {
      slug, configured_url: configuredUrl, homepage,
      extracted_url: extractedUrl,
      next_auction: extracted.next_auction_date || null,
      site_status: extracted.site_status || (is404 ? 'domain_parked' : 'unknown'),
      has_inventory: extracted.has_active_inventory ?? null,
      match,
      notes: extracted.notes || (is404 ? 'page returned 404' : ''),
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      slug, configured_url: configuredUrl, homepage,
      extracted_url: null, next_auction: null, site_status: 'fetch_failed',
      match: 'error', notes: err.message.slice(0, 150),
      ms: Date.now() - t0,
    };
  }
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++;
      const r = await fn(items[i], i);
      results[i] = r;
      const status = r.match.padEnd(18);
      console.log(`[${i + 1}/${items.length}] ${status} ${r.slug} (${r.ms}ms)`);
    }
  });
  await Promise.all(workers);
  return results;
}

const houses = Object.entries(HOUSE_ROOTS);
console.log(`Auditing ${houses.length} houses with concurrency=${CONCURRENCY}...\n`);

const startTime = Date.now();
const results = await runWithConcurrency(houses, ([slug, url]) => auditHouse(slug, url), CONCURRENCY);
const totalMs = Date.now() - startTime;

// Summary stats
const stats = {};
for (const r of results) stats[r.match] = (stats[r.match] || 0) + 1;
console.log('\n=== SUMMARY ===');
console.log('Total time:', Math.round(totalMs / 1000) + 's');
console.log('Credits used:', budget.getFcCreditsUsed?.() ?? '?');
console.log('Distribution:');
Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${v}`));

// Write CSV
const csvHeader = 'slug,match,site_status,configured_url,extracted_url,next_auction,has_inventory,notes,ms';
const csvRows = results.map(r => [
  r.slug,
  r.match,
  r.site_status || '',
  r.configured_url,
  r.extracted_url || '',
  r.next_auction || '',
  r.has_inventory == null ? '' : r.has_inventory,
  (r.notes || '').replace(/[",\n\r]/g, ' '),
  r.ms,
].map(v => {
  const s = String(v);
  return s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s;
}).join(','));

const csv = [csvHeader, ...csvRows].join('\n');
const outPath = `house-audit-${new Date().toISOString().slice(0, 10)}.csv`;
writeFileSync(outPath, csv, 'utf8');
console.log(`\nCSV written to: ${outPath}`);

// Also dump the high-priority drift list directly to console
const drifts = results.filter(r => r.match.startsWith('drift'));
if (drifts.length) {
  console.log(`\n=== ${drifts.length} URL DRIFTS DETECTED ===`);
  drifts.forEach(r => {
    console.log(`\n${r.slug} [${r.match}]`);
    console.log(`  configured: ${r.configured_url}`);
    console.log(`  extracted:  ${r.extracted_url}`);
    if (r.notes) console.log(`  notes: ${r.notes}`);
  });
}

process.exit(0);
