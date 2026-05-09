// scripts/refresh-hmlr-companies.mjs
//
// Monthly bulk loader for HMLR CCOD (UK companies) + OCOD (overseas
// companies) ownership data. Idempotent — re-running a month re-upserts
// the same primary keys (title_number, dataset).
//
// Auth: requires HMLR_DATA_KEY env var (the API key issued by
// use-land-property-data.service.gov.uk after accepting the dataset
// licences).
//
// Usage:
//   node scripts/refresh-hmlr-companies.mjs --dataset=ocod
//   node scripts/refresh-hmlr-companies.mjs --dataset=ccod
//   node scripts/refresh-hmlr-companies.mjs --dataset=ocod --month=2026-04
//   node scripts/refresh-hmlr-companies.mjs --dataset=ocod --dry-run --sample=5
//   node scripts/refresh-hmlr-companies.mjs --dataset=ocod --postcodes-only
//       ↑ only upsert rows whose postcode appears in the lots table
//         (massive storage saver — recommended after first full load)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, HMLR_DATA_KEY.

import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import yauzl from 'yauzl';

const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const dataset = argv['dataset'];
if (!dataset || !['ccod', 'ocod'].includes(dataset)) {
  console.error('Usage: --dataset=ccod|ocod  [--month=YYYY-MM] [--dry-run] [--sample=N] [--postcodes-only]');
  process.exit(1);
}
const dryRun = !!argv['dry-run'];
const forcedMonth = typeof argv['month'] === 'string' ? argv['month'] : null;
const sampleLimit = argv['sample'] ? parseInt(argv['sample'], 10) : null;
const postcodesOnly = !!argv['postcodes-only'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HMLR_KEY = process.env.HMLR_DATA_KEY;
if (!HMLR_KEY) { console.error('Missing HMLR_DATA_KEY'); process.exit(1); }
if (!dryRun && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}
const supabase = (!dryRun && SUPABASE_URL)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

const API_BASE = 'https://use-land-property-data.service.gov.uk/api/v1';

async function getDownloadUrl(filename) {
  const url = `${API_BASE}/datasets/${dataset}/${encodeURIComponent(filename)}`;
  const resp = await fetch(url, { headers: { Authorization: HMLR_KEY, Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`getDownloadUrl ${url} → HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.success) throw new Error(`getDownloadUrl error: ${JSON.stringify(json)}`);
  return json.result.download_url;
}

async function pickFilename() {
  const month = forcedMonth || (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();
  const yyyymm = month.replace('-', '_');
  const filename = `${dataset.toUpperCase()}_FULL_${yyyymm}.zip`;
  // If forced month not present, list resources and pick the latest FULL file.
  const listResp = await fetch(`${API_BASE}/datasets/${dataset}`, {
    headers: { Authorization: HMLR_KEY, Accept: 'application/json' },
  });
  if (!listResp.ok) throw new Error(`list ${dataset} → HTTP ${listResp.status}`);
  const listJson = await listResp.json();
  const resources = listJson?.result?.resources || [];
  const fullFiles = resources
    .map(r => r.file_name)
    .filter(n => n && /^[A-Z]+_FULL_\d{4}_\d{2}\.zip$/.test(n))
    .sort()
    .reverse();
  if (forcedMonth && fullFiles.includes(filename)) return filename;
  if (forcedMonth) throw new Error(`No FULL file for ${dataset} ${forcedMonth}`);
  if (fullFiles.length === 0) throw new Error(`No FULL files for ${dataset}`);
  return fullFiles[0];
}

async function downloadToTemp(url, label) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download ${label} → HTTP ${resp.status}`);
  const tmpPath = join(tmpdir(), `hmlr-${dataset}-${Date.now()}.zip`);
  console.log(`Downloading ${label} → ${tmpPath}`);
  // Stream to disk to avoid loading 1.5GB in memory.
  const arrayBuffer = await resp.arrayBuffer();
  await writeFile(tmpPath, Buffer.from(arrayBuffer));
  console.log(`Downloaded ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
  return tmpPath;
}

function openZipEntry(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.on('error', reject);
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName) || !entry.fileName.toLowerCase().endsWith('.csv')) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (e2, readStream) => {
          if (e2) return reject(e2);
          resolve({ readStream, fileName: entry.fileName, zipfile });
        });
      });
      zipfile.on('end', () => reject(new Error('No CSV entry found in zip')));
    });
  });
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
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[£,]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}
function toIsoDateOrNull(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // CCOD/OCOD use DD-MM-YYYY in some files, DD/MM/YYYY in others.
  const m = v.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function buildProprietors(cells, idx) {
  const props = [];
  for (let n = 1; n <= 4; n++) {
    const name = cells[idx[`prop${n}_name`]]?.trim();
    if (!name) continue;
    props.push({
      name,
      company_no: cells[idx[`prop${n}_company_no`]]?.trim() || null,
      category:   cells[idx[`prop${n}_category`]]?.trim() || null,
      country:    cells[idx[`prop${n}_country`]]?.trim() || null,
      address1:   cells[idx[`prop${n}_addr1`]]?.trim() || null,
      address2:   cells[idx[`prop${n}_addr2`]]?.trim() || null,
      address3:   cells[idx[`prop${n}_addr3`]]?.trim() || null,
    });
  }
  return props;
}

const HEADER_MAP = {
  // Canonical → expected CSV header (matches HMLR tech spec for CCOD/OCOD).
  title_number:                    'Title Number',
  tenure:                          'Tenure',
  property_address:                'Property Address',
  district:                        'District',
  county:                          'County',
  region:                          'Region',
  postcode:                        'Postcode',
  multiple_address_indicator:      'Multiple Address Indicator',
  price_paid:                      'Price Paid',
  date_proprietor_added:           'Date Proprietor Added',
  additional_proprietor_indicator: 'Additional Proprietor Indicator',
  prop1_name:        'Proprietor Name (1)',
  prop1_company_no:  'Company Registration No. (1)',
  prop1_category:    'Proprietorship Category (1)',
  prop1_country:     'Country Incorporated (1)',
  prop1_addr1:       'Proprietor (1) Address (1)',
  prop1_addr2:       'Proprietor (1) Address (2)',
  prop1_addr3:       'Proprietor (1) Address (3)',
  prop2_name:        'Proprietor Name (2)',
  prop2_company_no:  'Company Registration No. (2)',
  prop2_category:    'Proprietorship Category (2)',
  prop2_country:     'Country Incorporated (2)',
  prop2_addr1:       'Proprietor (2) Address (1)',
  prop2_addr2:       'Proprietor (2) Address (2)',
  prop2_addr3:       'Proprietor (2) Address (3)',
  prop3_name:        'Proprietor Name (3)',
  prop3_company_no:  'Company Registration No. (3)',
  prop3_category:    'Proprietorship Category (3)',
  prop3_country:     'Country Incorporated (3)',
  prop3_addr1:       'Proprietor (3) Address (1)',
  prop3_addr2:       'Proprietor (3) Address (2)',
  prop3_addr3:       'Proprietor (3) Address (3)',
  prop4_name:        'Proprietor Name (4)',
  prop4_company_no:  'Company Registration No. (4)',
  prop4_category:    'Proprietorship Category (4)',
  prop4_country:     'Country Incorporated (4)',
  prop4_addr1:       'Proprietor (4) Address (1)',
  prop4_addr2:       'Proprietor (4) Address (2)',
  prop4_addr3:       'Proprietor (4) Address (3)',
};

function buildHeaderIndex(headerCells) {
  const idx = {};
  for (const [canonical, csvHeader] of Object.entries(HEADER_MAP)) {
    const i = headerCells.indexOf(csvHeader);
    if (i === -1) {
      // Some columns are non-fatal if missing — only the basics are required.
      const required = ['title_number', 'postcode', 'prop1_name'];
      if (required.includes(canonical)) {
        throw new Error(`Required column missing in CSV header: "${csvHeader}"`);
      }
    }
    idx[canonical] = i;
  }
  return idx;
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
    .from('hmlr_corporate_owners')
    .upsert(batch, { onConflict: 'title_number,dataset' });
  if (error) throw new Error(`upsert failed: ${error.message}`);
}

async function main() {
  const filename = await pickFilename();
  console.log(`Selected file: ${filename}`);
  const fileMonthMatch = filename.match(/_(\d{4})_(\d{2})\.zip$/);
  const fileMonth = fileMonthMatch ? `${fileMonthMatch[1]}-${fileMonthMatch[2]}-01` : null;
  if (!fileMonth) throw new Error(`Cannot extract file month from ${filename}`);

  const downloadUrl = await getDownloadUrl(filename);
  const allowedPostcodes = await loadAllowedPostcodes();

  const tmpPath = await downloadToTemp(downloadUrl, filename);
  let parsed = 0, kept = 0, skipped = 0;
  try {
    const { readStream } = await openZipEntry(tmpPath);
    const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });
    let idx = null;
    let batch = [];
    const BATCH_SIZE = 1000;

    for await (const rawLine of rl) {
      if (!rawLine) continue;
      if (!idx) {
        idx = buildHeaderIndex(parseCsvLine(rawLine));
        continue;
      }
      const cells = parseCsvLine(rawLine);
      const titleNumber = cells[idx.title_number]?.trim();
      if (!titleNumber) { skipped++; continue; }
      const postcode = cells[idx.postcode]?.trim().toUpperCase() || null;
      parsed++;
      if (allowedPostcodes && (!postcode || !allowedPostcodes.has(postcode))) { skipped++; continue; }

      const row = {
        title_number: titleNumber,
        dataset,
        tenure:                          cells[idx.tenure]?.trim() || null,
        property_address:                cells[idx.property_address]?.trim() || null,
        district:                        cells[idx.district]?.trim() || null,
        county:                          cells[idx.county]?.trim() || null,
        region:                          cells[idx.region]?.trim() || null,
        postcode,
        multiple_address_indicator:      cells[idx.multiple_address_indicator]?.trim() || null,
        price_paid:                      toIntOrNull(cells[idx.price_paid]),
        date_proprietor_added:           toIsoDateOrNull(cells[idx.date_proprietor_added]),
        additional_proprietor_indicator: cells[idx.additional_proprietor_indicator]?.trim() || null,
        proprietors:                     buildProprietors(cells, idx),
        file_month:                      fileMonth,
      };
      batch.push(row);
      kept++;
      if (sampleLimit && kept <= 3) console.log('sample row:', JSON.stringify(row, null, 2));
      if (sampleLimit && kept >= sampleLimit) break;
      if (batch.length >= BATCH_SIZE) {
        await flushBatch(batch);
        batch = [];
        if (kept % 50000 === 0) console.log(`  upserted ${kept} rows...`);
      }
    }
    await flushBatch(batch);
  } finally {
    try { await unlink(tmpPath); } catch {}
  }
  console.log(`Done. dataset=${dataset} parsed=${parsed} kept=${kept} skipped=${skipped} dryRun=${dryRun} postcodesOnly=${postcodesOnly}`);
}

main().catch(err => {
  console.error('Loader failed:', err);
  process.exit(1);
});
