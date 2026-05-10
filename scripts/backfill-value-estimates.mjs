#!/usr/bin/env node
// scripts/backfill-value-estimates.mjs
//
// Recomputes lots.value_estimate for every active lot from already-persisted
// fields (street_avg, hpi_*, opps[], risks[], epc_floor_area_sqft, etc.).
// Pure rule-based — zero AI cost. Idempotent — safe to re-run any time.
//
// Usage:
//   node scripts/backfill-value-estimates.mjs                # all active lots
//   node scripts/backfill-value-estimates.mjs --limit=100    # first batch only (testing)
//   node scripts/backfill-value-estimates.mjs --force        # overwrite even if already set
//   node scripts/backfill-value-estimates.mjs --dry-run      # report counts, no DB writes
//
// Strategy:
//   - Page through `lots` in batches of 500
//   - Map each row → frontend-shape lot via dbRowToFrontendLot
//   - Fetch HPI lazily per unique postcodes-io area name (cached in-process)
//   - Call estimateValue() (pure)
//   - Bulk-update value_estimate column (one batch per page)
//
// HPI lookup: lots.value_estimate column already had street_avg + comps
// from prior enrichment, but NOT the in-memory hpiAvgPrice fields the
// estimator's anchor-2 fallback uses. We resolve area_name from postcodes.io
// (free, cached) and look up HPI per area (also cached).

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { LOTS_SELECT, dbRowToFrontendLot } from '../lib/pipeline/lot-mappers.js';
import { estimateValue } from '../lib/pipeline/value-estimator.js';
import { initHpi, queryHPI } from '../lib/land-registry-hpi.js';

function parseArgs(argv) {
  const out = { limit: null, force: false, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--force') out.force = true;
    else if (a === '--dry-run' || a === '--dryRun') out.dryRun = true;
    else if (a.startsWith('--limit=')) out.limit = parseInt(a.slice(8), 10);
  }
  return out;
}

const opts = parseArgs(process.argv);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
initHpi({ supabase });

// Postcode → area name (admin district from postcodes.io). In-process cache.
const _areaCache = new Map();
async function lookupAreaName(postcode) {
  if (!postcode) return null;
  const outward = postcode.trim().toUpperCase().split(/\s+/)[0];
  if (_areaCache.has(outward)) return _areaCache.get(outward);
  try {
    const res = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outward)}`);
    if (!res.ok) { _areaCache.set(outward, null); return null; }
    const data = await res.json();
    const area = data?.result?.admin_district?.[0] || null;
    _areaCache.set(outward, area);
    return area;
  } catch {
    _areaCache.set(outward, null);
    return null;
  }
}

// Area name → HPI row. Wraps queryHPI with a hit-cache.
const _hpiCache = new Map();
async function getHpiRow(areaName) {
  if (!areaName) return null;
  if (_hpiCache.has(areaName)) return _hpiCache.get(areaName);
  const r = await queryHPI({ areaName });
  const row = (r.status === 'ok' && r.latest) ? r.latest : null;
  _hpiCache.set(areaName, row);
  return row;
}

const PAGE = 500;
const stats = { scanned: 0, updated: 0, skipped_existing: 0, no_anchor: 0, errors: 0 };

let from = 0;
let totalLimit = opts.limit ?? Infinity;

console.log(`Backfill value estimates: limit=${opts.limit ?? 'all'} force=${opts.force} dryRun=${opts.dryRun}`);

while (true) {
  if (from >= totalLimit) break;
  const fetchSize = Math.min(PAGE, totalLimit - from);

  // Fetch active-ish lots first; skip extraction failures and very old lots.
  const { data: rows, error } = await supabase
    .from('lots')
    .select('id, value_estimate, ' + LOTS_SELECT)
    .neq('status', 'extraction_failure')
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .range(from, from + fetchSize - 1);

  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) break;

  const updates = [];
  for (const row of rows) {
    stats.scanned++;
    if (!opts.force && row.value_estimate) { stats.skipped_existing++; continue; }

    const lot = dbRowToFrontendLot(row);
    let hpiRow = null;
    if (lot.postcode) {
      const area = await lookupAreaName(lot.postcode);
      if (area) hpiRow = await getHpiRow(area);
    }
    let ve = null;
    try {
      ve = estimateValue(lot, hpiRow ? { hpiRow } : {});
    } catch (e) {
      stats.errors++;
      continue;
    }
    if (!ve) { stats.no_anchor++; continue; }

    updates.push({ id: row.id, value_estimate: ve });
  }

  if (!opts.dryRun && updates.length > 0) {
    // Supabase JS client doesn't support batched per-row updates in one call.
    // Run per-row updates in parallel chunks of 25 to keep things fast.
    const CHUNK = 25;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      await Promise.all(chunk.map(u =>
        supabase.from('lots').update({ value_estimate: u.value_estimate }).eq('id', u.id)
          .then(({ error: uErr }) => { if (uErr) { stats.errors++; console.warn('Update failed for', u.id, uErr.message); } })
      ));
    }
    stats.updated += updates.length;
  } else if (opts.dryRun) {
    stats.updated += updates.length; // count what we WOULD update
  }

  console.log(`  page from=${from} fetched=${rows.length} updated=${updates.length} (running scanned=${stats.scanned})`);

  if (rows.length < fetchSize) break;
  from += rows.length;
}

console.log('\n──────────────────────────────────────────');
console.log(`Backfill complete: ${JSON.stringify(stats, null, 2)}`);
console.log('──────────────────────────────────────────');
