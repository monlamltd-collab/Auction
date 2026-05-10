// lib/pipeline/phantom-lot-sweep.js
// ═══════════════════════════════════════════════════════════════
// PHANTOM LOT SWEEPER — daily backstop for placeholder addresses
// ═══════════════════════════════════════════════════════════════
//
// Background: looksLikeRealAddress() (firecrawl-extract.js) catches
// "Add to calendar" / "Virtual Viewing" / "Save search" style phantoms
// at extraction time, but the filter has been added to over time. Lots
// written before a phrase joined the deny-list survive in the DB and
// surface as junk on the user-facing feed (Bond Wolfe phantom 2026-05-10).
//
// This sweeper is the post-write equivalent: it walks the active
// catalogue daily, re-runs the same predicate against the stored
// `address`, and flips failures to `status='extraction_failure'` so
// they drop out of the search feed without being hard-deleted (we keep
// the row for audit / lot_history continuity).
//
// Hard deletes are deliberately out of scope — those need user-driven
// review, partly because deletion cascades through history tables.
// `extraction_failure` is the codebase's existing convention for
// "extracted but invalid".
//
// Cron tier 15 in server.js — daily 02:45 UK.

import { looksLikeRealAddress } from './firecrawl-extract.js';

const SCAN_WINDOW_DAYS = 30;
const SCAN_BATCH_LIMIT = 5000;

// Pure: returns the subset of lots whose address fails validation.
// Exported separately so tests can exercise the predicate path without
// supabase / the orchestration layer.
export function selectPhantomLots(lots) {
  if (!Array.isArray(lots)) return [];
  return lots.filter(row => row && !looksLikeRealAddress(row.address));
}

// Impure orchestration. deps lets the caller inject a logger so the
// module stays testable.
//
//   deps.log                       structured logger
//   deps.alertHook?({ ... })       optional — fires when a phantom is found
//                                  (signal the extractor predicate has a gap)
export async function runPhantomLotSweep(supabase, deps = {}) {
  const enabled = (process.env.PHANTOM_SWEEP_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    deps.log?.info?.('phantom-sweep: PHANTOM_SWEEP_ENABLED=false — skipping');
    return { skipped: true, reason: 'disabled' };
  }

  const since = new Date(Date.now() - SCAN_WINDOW_DAYS * 86400000).toISOString();
  const { data: rows, error } = await supabase
    .from('lots')
    .select('id, house, lot_number, address, status, last_seen_at')
    .neq('status', 'extraction_failure')
    .gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false })
    .limit(SCAN_BATCH_LIMIT);

  if (error) {
    deps.log?.error?.('phantom-sweep: fetch failed', { err: error.message });
    return { skipped: false, error: error.message };
  }

  const phantoms = selectPhantomLots(rows || []);
  if (phantoms.length === 0) {
    deps.log?.info?.('phantom-sweep: clean — no phantoms in window', { scanned: rows?.length || 0 });
    return { skipped: false, summary: { scanned: rows?.length || 0, flagged: 0 } };
  }

  // Update in chunks of 100 IDs at a time to keep query strings reasonable.
  const ids = phantoms.map(p => p.id);
  const CHUNK = 100;
  let updated = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error: updErr, count } = await supabase
      .from('lots')
      .update({ status: 'extraction_failure' }, { count: 'exact' })
      .in('id', chunk);
    if (updErr) {
      deps.log?.warn?.('phantom-sweep: update chunk failed', { chunk: chunk.length, err: updErr.message });
      continue;
    }
    updated += count ?? chunk.length;
  }

  // Sample for logs — first three offending addresses so the operator can
  // eyeball whether the predicate needs another phrase added.
  const sample = phantoms.slice(0, 3).map(p => ({
    house: p.house,
    lot: p.lot_number,
    address: p.address,
  }));

  deps.log?.warn?.('phantom-sweep: flagged phantom lots', {
    scanned: rows?.length || 0,
    flagged: updated,
    sample,
  });

  // Optional alert hook — when phantoms are found, the predicate has a
  // gap somewhere upstream (or pre-filter rows survived). Fire so the
  // operator notices, with the same single-object signature the harness
  // alert router uses.
  if (typeof deps.alertHook === 'function') {
    try {
      deps.alertHook({
        type: 'phantom_lots_swept',
        severity: 'warning',
        house: null,
        message: `phantom-sweep flagged ${updated} placeholder-address lot${updated === 1 ? '' : 's'}`,
        meta: { scanned: rows?.length || 0, flagged: updated, sample },
      });
    } catch (e) {
      deps.log?.warn?.('phantom-sweep: alertHook threw', { err: e.message });
    }
  }

  return { skipped: false, summary: { scanned: rows?.length || 0, flagged: updated, sample } };
}
