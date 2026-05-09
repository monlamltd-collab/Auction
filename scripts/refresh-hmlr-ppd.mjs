// scripts/refresh-hmlr-ppd.mjs
//
// Bulk loader for HM Land Registry Price Paid Data (PPD).
// Replaces the live SPARQL endpoint that lib/enrichment.js used to query.
//
// Two flavours of source file:
//   • pp-monthly-update-new-version.csv — only the most recent month's rows
//     (the additions; ~50-100k rows). Default for recurring refresh.
//   • pp-complete.csv                   — entire dataset since 1995 (~30M
//     rows, ~5GB CSV). Use --full for first load.
//
// Usage:
//   node scripts/refresh-hmlr-ppd.mjs                           # monthly delta, postcodes-only
//   node scripts/refresh-hmlr-ppd.mjs --full --postcodes-only   # full backfill, lot postcodes only
//   node scripts/refresh-hmlr-ppd.mjs --since=2021-01           # filter by date
//   node scripts/refresh-hmlr-ppd.mjs --dry-run --sample=3      # parse + print 3 rows
//
// Idempotent — re-running upserts on `transaction_id`.
// Env: SUPABASE_URL + SUPABASE_SERVICE_KEY.

import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const dryRun = !!argv['dry-run'];
const useFullFile = !!argv['full'];
const sinceDate = typeof argv['since'] === 'string' ? argv['since'] : null;
const sampleLimit = argv['sample'] ? parseInt(argv['sample'], 10) : null;
const postcodesOnly = !!argv['postcodes-only'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!dryRun && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}
const supabase = (!dryRun && SUPABASE_URL)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

const URL_BASE = 'http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com';
const FULL_URL = `${URL_BASE}/pp-complete.csv`;
const MONTHLY_URL = `${URL_BASE}/pp-monthly-update-new-version.csv`;

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
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v) {
  if (!v) return null;
  // PPD format: "YYYY-MM-DD HH:MM" or just "YYYY-MM-DD".
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function loadAllowedPostcodes() {
  if (!postcodesOnly || !supabase) return null;
  console.log('Loading allowed postcodes from lots table...');
  const allowed = new Set();
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('lots')
      .select('postcode')
      .not('postcode', 'is', null)
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (error) throw new Error(`postcode load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.postcode) allowed.add(r.postcode.toUpperCase().trim());
    }
    if (data.length < 1000) break;
    page++;
  }
  console.log(`  ${allowed.size} unique postcodes`);
  return allowed;
}

async function flushBatch(batch) {
  if (dryRun || batch.length === 0) return;
  const { error } = await supabase
    .from('hmlr_ppd')
    .upsert(batch, { onConflict: 'transaction_id' });
  if (error) throw new Error(`upsert failed: ${error.message}`);
}

// PPD CSV is header-less. Column order (1-indexed in spec, 0-indexed here):
//   0 transaction_id   1 price   2 date   3 postcode   4 property_type
//   5 is_new (Y/N)     6 duration (F/L)   7 paon   8 saon   9 street
//  10 locality   11 town   12 district   13 county
//  14 ppd_category   15 record_status

async function main() {
  const url = useFullFile ? FULL_URL : MONTHLY_URL;
  console.log(`Streaming ${url}${dryRun ? ' (dry run)' : ''}`);
  const sinceFilter = sinceDate ? `${sinceDate}-01` : null;

  const allowedPostcodes = await loadAllowedPostcodes();

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const nodeStream = (await import('node:stream')).Readable.fromWeb(resp.body);
  const rl = readline.createInterface({ input: nodeStream, crlfDelay: Infinity });

  const BATCH_SIZE = 1000;
  let batch = [];
  let parsed = 0, kept = 0, skipped = 0;

  for await (const rawLine of rl) {
    if (!rawLine) continue;
    const cells = parseCsvLine(rawLine);
    if (cells.length < 16) { skipped++; continue; }

    parsed++;
    const transferDate = toDateOrNull(cells[2]);
    const postcode = cells[3]?.trim().toUpperCase() || null;
    if (!transferDate) { skipped++; continue; }
    if (sinceFilter && transferDate < sinceFilter) { skipped++; continue; }
    if (allowedPostcodes && (!postcode || !allowedPostcodes.has(postcode))) { skipped++; continue; }

    const row = {
      transaction_id:  cells[0]?.replace(/[{}]/g, '').trim(),
      price:           toIntOrNull(cells[1]),
      transfer_date:   transferDate,
      postcode,
      property_type:   cells[4]?.trim() || null,
      is_new:          cells[5] === 'Y' ? true : (cells[5] === 'N' ? false : null),
      duration:        cells[6]?.trim() || null,
      paon:            cells[7]?.trim() || null,
      saon:            cells[8]?.trim() || null,
      street:          cells[9]?.trim() || null,
      locality:        cells[10]?.trim() || null,
      town:            cells[11]?.trim() || null,
      district:        cells[12]?.trim() || null,
      county:          cells[13]?.trim() || null,
      ppd_category:    cells[14]?.trim() || null,
      record_status:   cells[15]?.trim() || null,
    };
    if (!row.transaction_id || !row.price) { skipped++; continue; }
    batch.push(row);
    kept++;
    if (sampleLimit && kept <= 3) console.log('sample row:', JSON.stringify(row));
    if (sampleLimit && kept >= sampleLimit) break;
    if (batch.length >= BATCH_SIZE) {
      await flushBatch(batch);
      batch = [];
      if (kept % 50000 === 0) console.log(`  upserted ${kept} rows...`);
    }
  }
  await flushBatch(batch);

  console.log(`Done. parsed=${parsed} kept=${kept} skipped=${skipped} dryRun=${dryRun} postcodesOnly=${postcodesOnly} full=${useFullFile}`);
}

main().catch(err => {
  console.error('Loader failed:', err);
  process.exit(1);
});
