#!/usr/bin/env node
// scripts/backfill-uprn-from-cache-2026-05-26.mjs
//
// One-shot: for every lot where lots.uprn IS NULL but its (address, postcode)
// already exists in os_places_cache with a populated uprn, write that uprn
// back to lots.
//
// Why a one-shot script and not a permanent code path: the regular
// enrichment-wave already handles this in steady state. The cache rows
// became unreachable for 25 days under the cache-before-breaker bug
// (audit/2026-05-25-uprn-rca.md); this script catches up the backlog in
// one pass.
//
// What it touches:
//   - lots (UPDATE uprn / lat / lng / enrichment_manifest / field_sources)
//   - os_places_cache (READ only)
//   - pipeline_events (INSERTS via lookupAddress emit path — each cache-hit
//     fires enrich_uprn_ok; no live API calls, no enrich_uprn_fail noise)
//
// What it doesn't touch:
//   - the live OS Places API (we deliberately filter to confirmed cache
//     hits so we never spend an API call here)
//   - lots that already have a uprn (WHERE uprn IS NULL guard)
//   - the breaker / token bucket (cache hits short-circuit before either)
//
// Flags:
//   --dry-run        list what would be updated, don't touch the DB
//   --limit=<n>      cap at N lots (default: no cap)
//   --concurrency=N  parallel lookups (default: 4 — modest, all cache reads)
//
// Run:
//   node scripts/backfill-uprn-from-cache-2026-05-26.mjs --dry-run
//   node scripts/backfill-uprn-from-cache-2026-05-26.mjs --limit=50
//   node scripts/backfill-uprn-from-cache-2026-05-26.mjs

import { supabase } from '../lib/supabase.js';
import { lookupAddress } from '../lib/os-places.js';
import { recordOsPlaces } from '../lib/enrichment-manifest.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const DRY_RUN = !!args['dry-run'];
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const CONCURRENCY = args.concurrency ? parseInt(args.concurrency, 10) : 4;

// ── Same normaliser as lib/os-places.js ────────────────────────────────────
function normaliseAddressKey(address, postcode) {
  const a = (address || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/,+/g, ',');
  const p = (postcode || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return `${a}|${p}`;
}

async function main() {
  const startedAt = Date.now();
  console.log(`[backfill] starting ${DRY_RUN ? 'DRY RUN' : 'live'} — limit=${LIMIT ?? 'none'} concurrency=${CONCURRENCY}`);

  // 1. Pull all positively-cached address keys into memory.
  console.log('[backfill] loading os_places_cache (positive hits)…');
  const cacheKeys = new Set();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('os_places_cache')
      .select('address_key')
      .not('uprn', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`cache load failed at offset ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) cacheKeys.add(row.address_key);
    from += data.length;
    if (data.length < PAGE) break;
  }
  console.log(`[backfill] cache loaded — ${cacheKeys.size} positive entries`);

  // 2. Pull candidate lots (uprn IS NULL, address present), then filter to
  //    only those whose normalised key is in the cache. Saves us 14k+ no-op
  //    lookups that would all fall through to circuit_open.
  console.log('[backfill] loading candidate lots…');
  const candidates = [];
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('lots')
      .select('id, address, postcode, lat, lng, enrichment_manifest, field_sources')
      .is('uprn', null)
      .not('address', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`candidate load failed at offset ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const lot of data) {
      const key = normaliseAddressKey(lot.address, lot.postcode);
      if (cacheKeys.has(key)) candidates.push({ ...lot, _addressKey: key });
    }
    from += data.length;
    if (data.length < PAGE) break;
  }
  const total = LIMIT ? Math.min(candidates.length, LIMIT) : candidates.length;
  console.log(`[backfill] ${candidates.length} cache-hit candidates (processing ${total})`);

  // 3. Process — concurrency-limited; each lookup is a cache read so the
  //    bucket / breaker never fire. Update row in place per-lot for clean
  //    crash-recovery semantics (any failure leaves earlier wins persisted).
  const stats = { processed: 0, ok: 0, no_match_in_cache: 0, update_failed: 0, lookup_unexpected: 0 };
  const queue = candidates.slice(0, total);
  let cursor = 0;

  async function worker(id) {
    while (true) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const lot = queue[idx];
      try {
        const result = await lookupAddress({ id: lot.id, address: lot.address, postcode: lot.postcode });
        if (result?.status !== 'cache_hit' || !result.uprn) {
          stats.lookup_unexpected++;
          console.warn(`[backfill] lot=${lot.id} unexpected status=${result?.status} (expected cache_hit) — skipping`);
          stats.processed++;
          continue;
        }
        if (DRY_RUN) { stats.ok++; stats.processed++; continue; }

        const manifest = (lot.enrichment_manifest && typeof lot.enrichment_manifest === 'object') ? lot.enrichment_manifest : {};
        recordOsPlaces(manifest, {
          status: 'cache_hit',
          uprn: result.uprn,
          matchScore: result.matchScore ?? null,
          httpStatus: null,
        });
        const fieldSources = (lot.field_sources && typeof lot.field_sources === 'object') ? { ...lot.field_sources } : {};
        fieldSources.uprn = 'os-places-backfill-2026-05-26';
        const update = { uprn: result.uprn, enrichment_manifest: manifest, field_sources: fieldSources };
        if (result.lat != null && lot.lat == null) { update.lat = result.lat; fieldSources.lat = 'os-places-backfill-2026-05-26'; }
        if (result.lng != null && lot.lng == null) { update.lng = result.lng; fieldSources.lng = 'os-places-backfill-2026-05-26'; }

        // Guard: WHERE uprn IS NULL — never clobber a value another writer just landed.
        const { error, count } = await supabase
          .from('lots')
          .update(update, { count: 'exact' })
          .eq('id', lot.id)
          .is('uprn', null);
        if (error) {
          stats.update_failed++;
          console.warn(`[backfill] lot=${lot.id} UPDATE failed: ${error.message}`);
        } else if ((count ?? 0) === 0) {
          stats.no_match_in_cache++; // race: another writer beat us — fine, treat as no-op
        } else {
          stats.ok++;
        }
      } catch (err) {
        stats.update_failed++;
        console.warn(`[backfill] lot=${lot.id} threw: ${err.message}`);
      }
      stats.processed++;
      if (stats.processed % 100 === 0) {
        console.log(`[backfill] progress ${stats.processed}/${total} — ok=${stats.ok} raced=${stats.no_match_in_cache} failed=${stats.update_failed}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`[backfill] DONE in ${elapsed}s  (mode=${DRY_RUN ? 'DRY RUN' : 'live'})`);
  console.log(`[backfill]   candidates total: ${candidates.length}`);
  console.log(`[backfill]   processed:        ${stats.processed}`);
  console.log(`[backfill]   ok (uprn set):    ${stats.ok}`);
  console.log(`[backfill]   raced (skipped):  ${stats.no_match_in_cache}`);
  console.log(`[backfill]   lookup unexpected: ${stats.lookup_unexpected}`);
  console.log(`[backfill]   update failed:    ${stats.update_failed}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
