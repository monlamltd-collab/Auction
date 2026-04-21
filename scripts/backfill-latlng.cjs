#!/usr/bin/env node
/**
 * Backfill lat/lng for existing lots in the lots table.
 *
 * Strategy:
 *   1. Pull coords from enrichment_cache (already geocoded) — free, instant
 *   2. For remaining postcodes, bulk-geocode via postcodes.io (100/req, free)
 *
 * Run: node scripts/backfill-latlng.cjs
 * Safe to re-run: only updates rows where lat IS NULL.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function backfill() {
  // 1. Fetch all lots missing lat/lng that have a postcode
  console.log('Fetching lots with missing lat/lng...');
  const { data: lots, error } = await supabase
    .from('lots')
    .select('id, postcode')
    .is('lat', null)
    .not('postcode', 'is', null);

  if (error) {
    console.error('Failed to fetch lots:', error.message);
    process.exit(1);
  }

  if (!lots || lots.length === 0) {
    console.log('No lots need backfilling.');
    return;
  }

  console.log(`Found ${lots.length} lots needing lat/lng`);

  // Collect unique postcodes
  const postcodeToLotIds = new Map();
  for (const lot of lots) {
    const pc = (lot.postcode || '').trim().toUpperCase();
    if (!pc) continue;
    if (!postcodeToLotIds.has(pc)) postcodeToLotIds.set(pc, []);
    postcodeToLotIds.get(pc).push(lot.id);
  }

  const uniquePostcodes = [...postcodeToLotIds.keys()];
  console.log(`Unique postcodes: ${uniquePostcodes.length}`);

  // 2. Try enrichment_cache first
  const resolved = new Map(); // postcode → { lat, lng }
  console.log('Checking enrichment_cache...');

  const CACHE_BATCH = 200;
  for (let i = 0; i < uniquePostcodes.length; i += CACHE_BATCH) {
    const batch = uniquePostcodes.slice(i, i + CACHE_BATCH);
    const { data: cached } = await supabase
      .from('enrichment_cache')
      .select('postcode, lat, lon')
      .in('postcode', batch);

    if (cached) {
      for (const row of cached) {
        if (row.lat != null && row.lon != null) {
          resolved.set(row.postcode.toUpperCase(), {
            lat: parseFloat(row.lat),
            lng: parseFloat(row.lon),
          });
        }
      }
    }
  }

  console.log(`  From cache: ${resolved.size} postcodes`);

  // 3. Bulk geocode remaining via postcodes.io
  const remaining = uniquePostcodes.filter(pc => !resolved.has(pc));
  console.log(`  Need geocoding: ${remaining.length} postcodes`);

  const API_BATCH = 100; // postcodes.io limit
  for (let i = 0; i < remaining.length; i += API_BATCH) {
    const batch = remaining.slice(i, i + API_BATCH);
    try {
      const resp = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
      });

      if (!resp.ok) {
        console.warn(`  postcodes.io returned ${resp.status} for batch ${i}`);
        continue;
      }

      const json = await resp.json();
      if (json.result) {
        for (const item of json.result) {
          if (item.result && item.result.latitude != null) {
            resolved.set(item.query.toUpperCase(), {
              lat: item.result.latitude,
              lng: item.result.longitude,
            });
          }
        }
      }

      // Be polite — small delay between batches
      if (i + API_BATCH < remaining.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      console.warn(`  Geocode batch error: ${err.message}`);
    }

    if ((i / API_BATCH) % 10 === 9) {
      console.log(`  Geocoded ${Math.min(i + API_BATCH, remaining.length)}/${remaining.length}`);
    }
  }

  console.log(`Total resolved: ${resolved.size}/${uniquePostcodes.length} postcodes`);

  // 4. Update lots table
  let updated = 0;
  let failed = 0;
  const UPDATE_BATCH = 50;

  // Build flat update list
  const updates = [];
  for (const [pc, coords] of resolved) {
    const lotIds = postcodeToLotIds.get(pc);
    if (!lotIds) continue;
    for (const id of lotIds) {
      updates.push({ id, lat: coords.lat, lng: coords.lng });
    }
  }

  console.log(`Updating ${updates.length} lot rows...`);

  for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
    const batch = updates.slice(i, i + UPDATE_BATCH);

    // Supabase doesn't support bulk update by different IDs easily,
    // so update each individually (still fast for a one-time backfill)
    for (const upd of batch) {
      const { error: updErr } = await supabase
        .from('lots')
        .update({ lat: upd.lat, lng: upd.lng })
        .eq('id', upd.id);

      if (updErr) {
        failed++;
      } else {
        updated++;
      }
    }

    if ((i / UPDATE_BATCH) % 20 === 19) {
      console.log(`  Progress: ${Math.min(i + UPDATE_BATCH, updates.length)}/${updates.length}`);
    }
  }

  // 5. Verify
  const { count } = await supabase
    .from('lots')
    .select('*', { count: 'exact', head: true })
    .not('lat', 'is', null);

  console.log('\n=== BACKFILL COMPLETE ===');
  console.log(`Lots updated: ${updated}`);
  console.log(`Lots failed: ${failed}`);
  console.log(`Lots with lat/lng in DB: ${count}`);
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
