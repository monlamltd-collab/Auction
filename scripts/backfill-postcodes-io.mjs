// scripts/backfill-postcodes-io.mjs
//
// One-shot backfill: for every lot that has a postcode but no lat/lng, ask
// postcodes.io for the postcode-centroid lat/lng and write them back to
// the lots row (with 'postcodes-io' provenance in field_sources).
//
// Coverage baseline pre-run: 3,619 lots match (`postcode IS NOT NULL AND
// uprn IS NULL AND (lat IS NULL OR lng IS NULL)`). The 4,299 has-postcode
// lots that already have lat/lng got them from OS Places cache hits — those
// are untouched.
//
// COVERAGE_FIX_PLAN.md fix #5 (Phase 1 — postcodes.io fallback).
//
// Usage:
//   node scripts/backfill-postcodes-io.mjs
//   node scripts/backfill-postcodes-io.mjs --dry-run     # preview only
//   node scripts/backfill-postcodes-io.mjs --limit 500   # cap rows touched
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_KEY (Railway-style names).
// Idempotent — re-running picks up only rows that still lack lat/lng.

import { createClient } from '@supabase/supabase-js';
import { bulkLookupPostcodes } from '../lib/postcodes-io.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const supabase = createClient(url, key, { auth: { persistSession: false } });

// ── Step 1: pull candidate lots ──
let query = supabase
  .from('lots')
  .select('id, postcode, lat, lng, field_sources')
  .not('postcode', 'is', null)
  .or('lat.is.null,lng.is.null');
if (limit) query = query.limit(limit);
const { data: candidates, error } = await query;
if (error) {
  console.error('Candidate query failed:', error.message);
  process.exit(1);
}
console.log(`Candidates with postcode but no full lat/lng: ${candidates?.length ?? 0}`);
if (!candidates || candidates.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

// ── Step 2: dedupe postcodes — many lots share the same postcode ──
// Bulk endpoint accepts 100 per call; deduping cuts bulk calls dramatically.
const uniquePostcodes = [...new Set(candidates.map(c => c.postcode).filter(Boolean))];
console.log(`Unique postcodes to look up: ${uniquePostcodes.length}`);

if (dryRun) {
  console.log('Dry run — not calling postcodes.io, not updating DB.');
  process.exit(0);
}

// ── Step 3: bulk lookup in chunks of 100 ──
console.log('Fetching from postcodes.io …');
const lookupStart = Date.now();
const lookupMap = await bulkLookupPostcodes(uniquePostcodes);
console.log(`Bulk lookup done in ${Math.round((Date.now() - lookupStart) / 1000)}s.`);

// Tally lookup statuses for the report.
const statusCounts = {};
for (const v of lookupMap.values()) statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;
console.log('Postcode lookup status breakdown:', statusCounts);

// ── Step 4: update lots in batches ──
let updated = 0;
let skipped = 0;
let failed = 0;
const BATCH = 50;

for (let i = 0; i < candidates.length; i += BATCH) {
  const batch = candidates.slice(i, i + BATCH);
  await Promise.all(batch.map(async lot => {
    const lookup = lookupMap.get(lot.postcode);
    if (!lookup || lookup.status !== 'ok') { skipped++; return; }
    if (lookup.lat == null || lookup.lng == null) { skipped++; return; }

    // Only fill the field that's actually null — never overwrite an existing
    // value (some lots may have lat OR lng but not both).
    const update = {};
    const fs = (lot.field_sources && typeof lot.field_sources === 'object')
      ? { ...lot.field_sources } : {};
    if (lot.lat == null) { update.lat = lookup.lat; fs.lat = 'postcodes-io'; }
    if (lot.lng == null) { update.lng = lookup.lng; fs.lng = 'postcodes-io'; }
    if (Object.keys(update).length === 0) { skipped++; return; }
    update.field_sources = fs;

    const { error: updErr } = await supabase
      .from('lots')
      .update(update)
      .eq('id', lot.id);
    if (updErr) { failed++; console.warn(`  ${lot.id}: ${updErr.message}`); }
    else updated++;
  }));
  process.stdout.write(`  ${Math.min(i + BATCH, candidates.length)}/${candidates.length}\r`);
}

console.log(`\nUpdate complete: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
console.log('Done.');
