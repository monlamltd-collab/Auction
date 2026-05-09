// scripts/refresh-hmlr-hpi.mjs
//
// Monthly bulk loader for the HM Land Registry UK House Price Index.
// Idempotent — re-running the same month is a no-op via PK conflict.
//
// Source: https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/UK-HPI-full-file-{YYYY-MM}.csv
//
// Usage:
//   node scripts/refresh-hmlr-hpi.mjs                  # auto-detect latest month
//   node scripts/refresh-hmlr-hpi.mjs --month=2026-04  # force a specific month
//   node scripts/refresh-hmlr-hpi.mjs --dry-run        # download + parse, don't write
//   node scripts/refresh-hmlr-hpi.mjs --since=2020-01  # only upsert rows on/after this date
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_KEY.
//
// Note: the HPI full file includes data back to 1968 (derived). Default
// behaviour upserts the entire file; use --since to keep volume down on
// recurring runs (only the latest 1-2 months ever change in practice).

import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const dryRun = !!argv['dry-run'];
const forcedMonth = typeof argv['month'] === 'string' ? argv['month'] : null;
const sinceDate = typeof argv['since'] === 'string' ? argv['since'] : null;
const sampleLimit = argv['sample'] ? parseInt(argv['sample'], 10) : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!dryRun && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}

const supabase = (!dryRun && SUPABASE_URL)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

const URL_BASE = 'https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data';

// Columns we keep (case-sensitive match against HPI header).
const COL_MAP = {
  Date:               'month',
  AreaCode:           'area_code',
  RegionName:         'area_name',
  AveragePrice:       'average_price',
  Index:              'index_value',
  '1m%Change':        'change_1m',
  '12m%Change':       'change_12m',
  SalesVolume:        'sales_volume',
  DetachedPrice:      'detached_price',
  SemiDetachedPrice:  'semi_price',
  TerracedPrice:      'terraced_price',
  FlatPrice:          'flat_price',
};

function deriveAreaType(code) {
  if (!code) return null;
  if (/^(E92|W92|S92|N92|K0[234])/.test(code)) return 'country';
  if (/^E12/.test(code)) return 'region';
  if (/^(E06|E07|E08|E09|W06|S12|N09)/.test(code)) return 'lad';
  return 'other';
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function toIntOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function toNumOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function toIsoDateOrNull(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // HPI source format is DD/MM/YYYY.
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function tryFetch(month) {
  const url = `${URL_BASE}/UK-HPI-full-file-${month}.csv`;
  const resp = await fetch(url);
  if (resp.ok) return { url, body: resp.body };
  if (resp.status === 404) return null;
  throw new Error(`HPI fetch ${url} → HTTP ${resp.status}`);
}

async function findLatestFile() {
  if (forcedMonth) {
    const found = await tryFetch(forcedMonth);
    if (!found) throw new Error(`No HPI file for forced month ${forcedMonth}`);
    return found;
  }
  // Walk back from current month up to 6 months. Publication runs ~6 weeks behind.
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const found = await tryFetch(m);
    if (found) return { ...found, month: m };
    console.log(`No HPI file for ${m}, trying earlier`);
  }
  throw new Error('No HPI file found in last 6 months');
}

async function* iterateRows(body) {
  // Convert web ReadableStream to Node Readable line iterator
  const nodeStream = (await import('node:stream')).Readable.fromWeb(body);
  const rl = readline.createInterface({ input: nodeStream, crlfDelay: Infinity });
  let header = null;
  let headerIndex = null;
  for await (const rawLine of rl) {
    if (!rawLine) continue;
    if (!header) {
      header = parseCsvLine(rawLine);
      headerIndex = {};
      for (const [csvCol, dbCol] of Object.entries(COL_MAP)) {
        const idx = header.indexOf(csvCol);
        if (idx === -1) {
          throw new Error(`HPI CSV missing expected column "${csvCol}"`);
        }
        headerIndex[dbCol] = idx;
      }
      continue;
    }
    const cells = parseCsvLine(rawLine);
    yield {
      month:           toIsoDateOrNull(cells[headerIndex.month]),
      area_code:       cells[headerIndex.area_code]?.trim() || null,
      area_name:       cells[headerIndex.area_name]?.trim() || null,
      area_type:       deriveAreaType(cells[headerIndex.area_code]),
      average_price:   toIntOrNull(cells[headerIndex.average_price]),
      index_value:     toNumOrNull(cells[headerIndex.index_value]),
      change_1m:       toNumOrNull(cells[headerIndex.change_1m]),
      change_12m:      toNumOrNull(cells[headerIndex.change_12m]),
      sales_volume:    toIntOrNull(cells[headerIndex.sales_volume]),
      detached_price:  toIntOrNull(cells[headerIndex.detached_price]),
      semi_price:      toIntOrNull(cells[headerIndex.semi_price]),
      terraced_price:  toIntOrNull(cells[headerIndex.terraced_price]),
      flat_price:      toIntOrNull(cells[headerIndex.flat_price]),
    };
  }
}

async function flushBatch(batch) {
  if (dryRun || batch.length === 0) return;
  const { error } = await supabase
    .from('hmlr_hpi')
    .upsert(batch, { onConflict: 'month,area_code' });
  if (error) throw new Error(`upsert failed: ${error.message}`);
}

async function main() {
  const { url, body, month: detectedMonth } = await findLatestFile();
  console.log(`Loading ${url}${dryRun ? ' (dry run)' : ''}`);

  const BATCH_SIZE = 1000;
  let batch = [];
  let parsed = 0;
  let kept = 0;
  let skipped = 0;
  const sinceFilter = sinceDate ? toIsoDateOrNull(sinceDate) : null;

  for await (const row of iterateRows(body)) {
    parsed++;
    if (!row.month || !row.area_code) { skipped++; continue; }
    if (sinceFilter && row.month < sinceFilter) { skipped++; continue; }
    batch.push(row);
    kept++;
    if (sampleLimit && kept <= 3) console.log('sample row:', row);
    if (sampleLimit && kept >= sampleLimit) break;
    if (batch.length >= BATCH_SIZE) {
      await flushBatch(batch);
      batch = [];
      if (kept % 10000 === 0) console.log(`  upserted ${kept} rows...`);
    }
  }
  await flushBatch(batch);

  console.log(`Done. parsed=${parsed} kept=${kept} skipped=${skipped} dryRun=${dryRun}`);
  if (detectedMonth) console.log(`Auto-detected month: ${detectedMonth}`);
}

main().catch(err => {
  console.error('Loader failed:', err);
  process.exit(1);
});
