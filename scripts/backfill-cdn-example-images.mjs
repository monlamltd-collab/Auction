#!/usr/bin/env node
/**
 * scripts/backfill-cdn-example-images.mjs
 *
 * One-off backfill: rewrite `cdn.example.com/_next/image?url=…` placeholder
 * image_url values in the lots table to their unwrapped inner URL.
 *
 * Source bug: ingestion stored Next.js image-proxy URLs whose wrapper host
 * wasn't substituted at render time. The forward-fix is `unwrapProxyImageUrl`
 * in lib/scraper/validation.js applied at ingestion sites; this script
 * cleans the rows already in the DB.
 *
 * Run: node scripts/backfill-cdn-example-images.mjs
 * Safe to re-run: only updates rows where image_url LIKE 'https://cdn.example.com/%'.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.
 */

import { createClient } from '@supabase/supabase-js';
import { unwrapProxyImageUrl } from '../lib/scraper/validation.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('Fetching lots with cdn.example.com image_url…');
  const { data: rows, error } = await supabase
    .from('lots')
    .select('id, house, image_url')
    .like('image_url', 'https://cdn.example.com/%');

  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No rows match. Nothing to backfill.');
    return;
  }

  console.log(`Found ${rows.length} rows to backfill.\n`);

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    const newUrl = unwrapProxyImageUrl(row.image_url);
    if (newUrl === row.image_url) {
      // Helper said nothing to do — log and skip rather than rewriting to itself.
      console.log(`[unchanged] id=${row.id} house=${row.house}\n  ${row.image_url}\n`);
      unchanged++;
      continue;
    }
    const { error: updateError } = await supabase
      .from('lots')
      .update({ image_url: newUrl })
      .eq('id', row.id);

    if (updateError) {
      console.error(`[fail] id=${row.id} house=${row.house}: ${updateError.message}`);
      failed++;
      continue;
    }

    console.log(`[ok] id=${row.id} house=${row.house}\n  before: ${row.image_url}\n  after:  ${newUrl}\n`);
    updated++;
  }

  console.log('--- Summary ---');
  console.log(`Updated:   ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Failed:    ${failed}`);

  // Final count
  const { count, error: countError } = await supabase
    .from('lots')
    .select('id', { count: 'exact', head: true })
    .like('image_url', '%cdn.example.com%');

  if (countError) {
    console.error('Final count check failed:', countError.message);
  } else {
    console.log(`Remaining cdn.example.com rows: ${count}`);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
