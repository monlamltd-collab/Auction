#!/usr/bin/env node
// scripts/backtest-value-estimator.mjs
//
// Compares the rule-based value estimator's output against the actual
// `sold_price` for resolved lots. Reports MAE, P50, P90 error
// distribution by confidence band — drives tuning of the condition haircut
// table + EPC capex multiplier in lib/pipeline/value-estimator.js.
//
// Targets (from the plan):
//   - high   confidence: MAE < 15%
//   - medium confidence: MAE < 25%
//   - low    confidence: best-effort, no hard target
//
// Usage:
//   node scripts/backtest-value-estimator.mjs              # all resolved lots
//   node scripts/backtest-value-estimator.mjs --csv=out.csv # also write per-lot CSV
//   node scripts/backtest-value-estimator.mjs --since=2026-01-01

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { LOTS_SELECT, dbRowToFrontendLot } from '../lib/pipeline/lot-mappers.js';
import { estimateValue } from '../lib/pipeline/value-estimator.js';
import { initHpi, queryHPI } from '../lib/land-registry-hpi.js';

function parseArgs(argv) {
  const out = { csv: null, since: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--csv=')) out.csv = a.slice(6);
    else if (a.startsWith('--since=')) out.since = a.slice(8);
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

const _hpiCache = new Map();
async function getHpiRow(areaName) {
  if (!areaName) return null;
  if (_hpiCache.has(areaName)) return _hpiCache.get(areaName);
  const r = await queryHPI({ areaName });
  const row = (r.status === 'ok' && r.latest) ? r.latest : null;
  _hpiCache.set(areaName, row);
  return row;
}

console.log(`Backtest: csv=${opts.csv || 'none'} since=${opts.since || 'all'}`);

let q = supabase.from('lots')
  .select('id, sold_price, ' + LOTS_SELECT)
  .not('sold_price', 'is', null)
  .gt('sold_price', 0);
if (opts.since) q = q.gte('last_seen_at', opts.since);

const { data: rows, error } = await q.limit(5000);
if (error) { console.error('Fetch failed:', error.message); process.exit(1); }
if (!rows || rows.length === 0) {
  console.log('No resolved lots with sold_price found.');
  process.exit(0);
}

console.log(`Backtesting ${rows.length} resolved lots...`);

const results = [];
for (const row of rows) {
  const lot = dbRowToFrontendLot(row);
  let hpiRow = null;
  if (lot.postcode) {
    const area = await lookupAreaName(lot.postcode);
    if (area) hpiRow = await getHpiRow(area);
  }
  const ve = estimateValue(lot, hpiRow ? { hpiRow } : {});
  if (!ve) continue;
  const sold = Number(row.sold_price);
  const errPct = ((ve.estimate - sold) / sold) * 100;
  results.push({
    id: row.id,
    address: lot.address,
    postcode: lot.postcode,
    sold_price: sold,
    estimate: ve.estimate,
    low: ve.low,
    high: ve.high,
    err_pct: Math.round(errPct * 10) / 10,
    abs_err_pct: Math.abs(errPct),
    confidence: ve.confidence,
    anchor_source: ve.breakdown.anchor_source,
    comp_count: ve.breakdown.comp_count,
    in_band: sold >= ve.low && sold <= ve.high,
    condition_signals: (ve.breakdown.condition_signals || []).join('|'),
  });
}

if (results.length === 0) {
  console.log('No estimates produced for resolved lots.');
  process.exit(0);
}

function summary(rows, label) {
  if (rows.length === 0) return null;
  const errs = rows.map(r => r.abs_err_pct).sort((a, b) => a - b);
  const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
  const p50 = errs[Math.floor(errs.length / 2)];
  const p90 = errs[Math.floor(errs.length * 0.9)];
  const inBand = rows.filter(r => r.in_band).length;
  return { label, n: rows.length, mae: mae.toFixed(2), p50: p50.toFixed(2), p90: p90.toFixed(2), in_band_pct: ((inBand / rows.length) * 100).toFixed(1) };
}

const overall = summary(results, 'OVERALL');
const high = summary(results.filter(r => r.confidence === 'high'), 'high');
const medium = summary(results.filter(r => r.confidence === 'medium'), 'medium');
const low = summary(results.filter(r => r.confidence === 'low'), 'low');

console.log('\n──────────────────────────────────────────');
console.log('Backtest results (% absolute error vs sold_price)');
console.log('──────────────────────────────────────────');
console.log('label    | n     | MAE   | P50   | P90   | in-band %');
console.log('---------|-------|-------|-------|-------|----------');
for (const s of [overall, high, medium, low]) {
  if (!s) continue;
  console.log(`${s.label.padEnd(8)} | ${String(s.n).padStart(5)} | ${s.mae.padStart(5)} | ${s.p50.padStart(5)} | ${s.p90.padStart(5)} | ${s.in_band_pct.padStart(6)}%`);
}
console.log('──────────────────────────────────────────');

// Pass/fail vs plan targets
let allPass = true;
if (high && parseFloat(high.mae) > 15) { console.log(`✗ HIGH confidence MAE ${high.mae}% > 15% target`); allPass = false; }
if (medium && parseFloat(medium.mae) > 25) { console.log(`✗ MEDIUM confidence MAE ${medium.mae}% > 25% target`); allPass = false; }
if (allPass) console.log('✓ All MAE targets met');

if (opts.csv) {
  const headers = Object.keys(results[0]).join(',');
  const lines = results.map(r => Object.values(r).map(v => {
    if (v == null) return '';
    if (typeof v === 'string' && v.includes(',')) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }).join(','));
  writeFileSync(opts.csv, headers + '\n' + lines.join('\n'));
  console.log(`Wrote ${results.length} rows to ${opts.csv}`);
}
