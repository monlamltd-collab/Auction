#!/usr/bin/env node
/**
 * scripts/backfill-auction-id.mjs
 *
 * Move 2 backfill: populate `lots.auction_id` (the new FK to
 * `auction_calendar.id`) for existing rows by matching on
 * `(house_slug, url)`. URL is normalised on both sides since PR #24, so the
 * match is a direct lookup.
 *
 * On match: `UPDATE lots SET auction_id = ? WHERE id IN (...)`.
 * On miss: emit one `pipeline_alerts` row of type `auction_id_backfill_unmatched`
 * per distinct (house, catalogue_url) — deduplicated so re-runs don't spam.
 *
 * Expected outcome (per scripts/output/auction-id-gap-report.md):
 *   ~57% match rate on first pass. ~43% remain NULL (url_mismatch cohort:
 *   paulfosh, firstforauctions, purplebricksgoto, harmanhealy + archival).
 *   These are handled transparently by the dual-read helper at
 *   lib/pipeline/lot-lookup.js and reconciled in a follow-up move.
 *
 * Run: node scripts/backfill-auction-id.mjs
 * Safe to re-run: idempotent — only updates rows still NULL, only inserts
 * alert rows that don't already exist for the same (house, catalogue_url).
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.
 */

import { createClient } from '@supabase/supabase-js';
import { matchLotToCalendar, buildCalendarIndex } from '../lib/pipeline/backfill-auction-id-logic.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const BATCH_SIZE = 1000;
const ALERT_TYPE = 'auction_id_backfill_unmatched';

async function main() {
  // 1. Load the calendar index once. Only ~268 rows; load all then index in JS.
  console.log('Loading auction_calendar…');
  const { data: calRows, error: calErr } = await supabase
    .from('auction_calendar')
    .select('id, house_slug, url, date')
    .order('date', { ascending: false }); // DESC so first .set() is most-recent

  if (calErr) {
    console.error('Calendar load failed:', calErr.message);
    process.exit(1);
  }
  const calIndex = buildCalendarIndex(calRows || []);
  console.log(`Indexed ${calRows?.length || 0} calendar rows into ${calIndex.size} (house_slug, url) keys.`);

  // 2. Page through lots WHERE auction_id IS NULL.
  let totalScanned = 0;
  let totalMatched = 0;
  const updatesByAuctionId = new Map(); // auction_id → [lot_id, ...]
  const missesByPair = new Map();       // `${house}|${catalogue_url}` → { house, catalogue_url, count }

  let offset = 0;
  while (true) {
    const { data: lots, error: lotsErr } = await supabase
      .from('lots')
      .select('id, house, catalogue_url')
      .is('auction_id', null)
      .range(offset, offset + BATCH_SIZE - 1)
      .order('id', { ascending: true });

    if (lotsErr) {
      console.error('Lots fetch failed:', lotsErr.message);
      process.exit(1);
    }
    if (!lots || lots.length === 0) break;

    for (const lot of lots) {
      const match = matchLotToCalendar(lot, calIndex);
      if (match) {
        if (!updatesByAuctionId.has(match.id)) updatesByAuctionId.set(match.id, []);
        updatesByAuctionId.get(match.id).push(lot.id);
        totalMatched++;
      } else {
        const k = `${lot.house}|${lot.catalogue_url}`;
        const existing = missesByPair.get(k);
        if (existing) existing.count++;
        else missesByPair.set(k, { house: lot.house, catalogue_url: lot.catalogue_url, count: 1 });
      }
    }

    totalScanned += lots.length;
    console.log(`  scanned ${totalScanned} so far (matched ${totalMatched}, misses ${missesByPair.size} distinct pairs)…`);

    if (lots.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log(`\nDone scanning. ${totalScanned} lots had auction_id=NULL.`);
  console.log(`  matched:  ${totalMatched}`);
  console.log(`  unmatched: ${totalScanned - totalMatched} lots across ${missesByPair.size} (house, catalogue_url) pairs`);

  // 3. Apply updates in grouped batches. Each group = one auction_id, many lot_ids.
  console.log('\nApplying updates…');
  let updatedTotal = 0;
  let updateErrors = 0;
  for (const [auctionId, lotIds] of updatesByAuctionId.entries()) {
    // Chunk on .in() size — Supabase rejects huge IN lists. 500 is well under any limit.
    const CHUNK = 500;
    for (let i = 0; i < lotIds.length; i += CHUNK) {
      const chunk = lotIds.slice(i, i + CHUNK);
      const { error: updErr } = await supabase
        .from('lots')
        .update({ auction_id: auctionId })
        .in('id', chunk);
      if (updErr) {
        console.error(`  UPDATE failed (auction_id=${auctionId}, n=${chunk.length}): ${updErr.message}`);
        updateErrors++;
      } else {
        updatedTotal += chunk.length;
      }
    }
  }
  console.log(`Updated ${updatedTotal} rows across ${updatesByAuctionId.size} auctions (errors: ${updateErrors}).`);

  // 4. Emit pipeline_alerts for unmatched pairs, deduped against existing rows.
  if (missesByPair.size > 0) {
    console.log(`\nWriting unmatched-pair alerts (deduped against existing)…`);
    // Pre-fetch existing alerts of this type. Only the (house, catalogue_url) tuple matters.
    const { data: existingAlerts } = await supabase
      .from('pipeline_alerts')
      .select('house, meta')
      .eq('event_type', ALERT_TYPE);
    const existingKeys = new Set(
      (existingAlerts || []).map(a => `${a.house}|${a.meta?.catalogue_url || ''}`),
    );

    const newAlerts = [];
    for (const { house, catalogue_url, count } of missesByPair.values()) {
      const k = `${house}|${catalogue_url}`;
      if (existingKeys.has(k)) continue;
      newAlerts.push({
        event_type: ALERT_TYPE,
        severity: 'info',
        house,
        message: `${count} lot(s) at catalogue_url did not match any auction_calendar row on (house_slug, url) during Move 2 backfill.`,
        meta: { catalogue_url, lot_count: count },
      });
    }
    if (newAlerts.length === 0) {
      console.log('  All unmatched pairs already have an alert row — nothing to insert.');
    } else {
      const { error: alertErr } = await supabase.from('pipeline_alerts').insert(newAlerts);
      if (alertErr) {
        console.error(`Alert insert failed: ${alertErr.message}`);
      } else {
        console.log(`  Inserted ${newAlerts.length} new alert row(s) (${missesByPair.size - newAlerts.length} pre-existing skipped).`);
      }
    }
  }

  // 5. Final verification — re-query the ratio.
  console.log('\nFinal verification…');
  const { count: totalCount } = await supabase.from('lots').select('id', { count: 'exact', head: true });
  const { count: nullCount } = await supabase.from('lots').select('id', { count: 'exact', head: true }).is('auction_id', null);
  const matchPct = totalCount ? (((totalCount - nullCount) / totalCount) * 100).toFixed(1) : '0.0';
  console.log(`  lots total:                   ${totalCount}`);
  console.log(`  lots with auction_id set:     ${totalCount - nullCount}`);
  console.log(`  lots still NULL:              ${nullCount}`);
  console.log(`  match rate after backfill:    ${matchPct}%`);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
