#!/usr/bin/env node
/**
 * Coverage Report
 * ===============
 * Snapshots image / price / postcode / UPRN coverage across the lots table.
 * Run before and after deploying COVERAGE_FIX_PLAN.md changes to verify the
 * fixes actually moved the numbers.
 *
 * Usage:
 *   node scripts/coverage-report.mjs                # all lots, all houses
 *   node scripts/coverage-report.mjs --house allsop # single house
 *   node scripts/coverage-report.mjs --json         # machine-readable
 *   node scripts/coverage-report.mjs --recent       # only lots seen in last 7d
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in env.
 */

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const houseFilter = (() => {
  const i = args.indexOf('--house');
  return i >= 0 ? args[i + 1] : null;
})();
const jsonOut = args.includes('--json');
const recentOnly = args.includes('--recent');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } },
);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────
async function countWhere(label, filterFn) {
  let q = supabase.from('lots').select('*', { count: 'exact', head: true });
  q = filterFn(q);
  if (houseFilter) q = q.eq('house', houseFilter.toLowerCase());
  if (recentOnly) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte('last_seen_at', cutoff);
  }
  const { count, error } = await q;
  if (error) throw new Error(`${label}: ${error.message}`);
  return count || 0;
}

const pct = (num, denom) => denom === 0 ? 0 : Math.round((num / denom) * 1000) / 10;

// ── Per-field coverage (denominator: total lots in scope) ──────────────
async function fieldCoverage() {
  const total = await countWhere('total', q => q);
  if (total === 0) return { total: 0, fields: {} };

  const have = {
    image_url: total - await countWhere('no_image', q => q.is('image_url', null)),
    price: total - await countWhere('no_price', q => q.is('price', null)),
    postcode: total - await countWhere('no_postcode', q => q.is('postcode', null)),
    uprn: total - await countWhere('no_uprn', q => q.is('uprn', null)),
    epc_rating: total - await countWhere('no_epc', q => q.is('epc_rating', null)),
    flood_risk: total - await countWhere('no_flood', q => q.is('flood_risk', null)),
    enriched_at: total - await countWhere('no_enriched', q => q.is('enriched_at', null)),
  };

  const fields = {};
  for (const [field, n] of Object.entries(have)) {
    fields[field] = { have: n, missing: total - n, coverage: pct(n, total) };
  }
  return { total, fields };
}

// ── Retry queue health ────────────────────────────────────────────────
async function retryQueueStatus() {
  const { count: open } = await supabase.from('enrichment_retry_queue')
    .select('*', { count: 'exact', head: true })
    .lt('attempts', 5);
  const { count: exhausted } = await supabase.from('enrichment_retry_queue')
    .select('*', { count: 'exact', head: true })
    .gte('attempts', 5);
  return { open: open || 0, exhausted: exhausted || 0 };
}

// ── OS Places cache health (positive vs negative ratio) ────────────────
async function osPlacesCacheStatus() {
  const { count: positive } = await supabase.from('os_places_cache')
    .select('*', { count: 'exact', head: true })
    .not('uprn', 'is', null);
  const { count: negative } = await supabase.from('os_places_cache')
    .select('*', { count: 'exact', head: true })
    .is('uprn', null);
  return { positive: positive || 0, negative: negative || 0 };
}

// ── field_sources density — what fraction of populated fields have provenance? ──
async function fieldSourcesDensity() {
  // Simple proxy: how many lots have a non-empty field_sources map?
  const { count: total } = await supabase.from('lots')
    .select('*', { count: 'exact', head: true });
  const { count: stamped } = await supabase.from('lots')
    .select('*', { count: 'exact', head: true })
    .not('field_sources', 'eq', '{}');
  return { total: total || 0, stamped: stamped || 0, percentage: pct(stamped || 0, total || 0) };
}

// ── Main ──────────────────────────────────────────────────────────────
const report = {
  timestamp: new Date().toISOString(),
  scope: { house: houseFilter || 'all', recentOnly },
  fields: await fieldCoverage(),
  retry_queue: await retryQueueStatus(),
  os_places_cache: await osPlacesCacheStatus(),
  field_sources_density: await fieldSourcesDensity(),
};

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// Pretty print
const scope = `${report.scope.house}${report.scope.recentOnly ? ' (last 7d)' : ''}`;
console.log(`\n═══ Coverage Report — ${scope} ═══`);
console.log(`Total lots in scope: ${report.fields.total}`);
console.log('\n── Field coverage ──');
for (const [name, stats] of Object.entries(report.fields.fields)) {
  const bar = '█'.repeat(Math.floor(stats.coverage / 5)) + '░'.repeat(20 - Math.floor(stats.coverage / 5));
  console.log(`  ${name.padEnd(13)} ${bar} ${stats.coverage.toString().padStart(5)}%   ${stats.have}/${report.fields.total}`);
}

console.log('\n── Retry queue ──');
console.log(`  Open (attempts < 5):  ${report.retry_queue.open}`);
console.log(`  Exhausted (attempts ≥ 5): ${report.retry_queue.exhausted}`);

console.log('\n── OS Places cache ──');
console.log(`  Positive entries: ${report.os_places_cache.positive}`);
console.log(`  Negative entries: ${report.os_places_cache.negative}  (saves API calls on unmatched lots)`);

console.log('\n── Provenance density ──');
console.log(`  Lots with non-empty field_sources: ${report.field_sources_density.stamped}/${report.field_sources_density.total} (${report.field_sources_density.percentage}%)`);

console.log('\nUse --json for machine-readable output, --recent to scope to last 7d, --house <slug> to filter.\n');
