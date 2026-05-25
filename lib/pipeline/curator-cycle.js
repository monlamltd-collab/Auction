// ═══════════════════════════════════════════════════════════════
// CURATOR CYCLE — runs nightly to select + generate today's picks
// ═══════════════════════════════════════════════════════════════
// Composition order:
//   1. Query candidate lots from `lots` table (loose pre-filter at the DB)
//   2. Hydrate fundability live for each candidate (cached 1h via lib/fundability.js)
//   3. Run pure selectPicks() to apply quality + diversity rules
//   4. For each chosen pick, call generateProse() (Gemini Pro)
//   5. Insert all picks as status='pending' for admin review
//
// Idempotent: re-running on the same date hits the unique constraint and
// silently no-ops the already-inserted rows.
//
// Kill switch: env var CURATOR_ENABLED=false skips the whole cycle.

import { dbRowToLot } from '../types/lot.js';
import { selectPicks } from '../curator/select-picks.js';
import { generateProse } from '../curator/generate-prose.js';
import { insertPicks, getRecentPickedLotIds } from '../curator/persist.js';
import { getFundabilityBadge } from '../fundability.js';
import { log } from '../logging.js';

// Pre-filter pool size — wider than TOP_N (8) to give the diversity layer
// + fundability check + generation failures room to whittle down.
const CANDIDATE_POOL_SIZE = 60;
const RECENT_DAYS = 14;

const CANDIDATE_LOT_FIELDS = [
  'id', 'house', 'lot_number', 'url', 'address', 'postcode', 'lat', 'lng',
  'price', 'price_text', 'price_status', 'prop_type', 'beds', 'tenure',
  'sqft', 'condition', 'image_url', 'images', 'bullets', 'units',
  'auction_date', 'status', 'epc_rating', 'epc_score',
  'flood_zone', 'flood_risk', 'street_avg', 'street_sales',
  'below_market', 'est_monthly_rent', 'est_annual_rent', 'est_gross_yield',
  'score', 'score_breakdown', 'opps', 'risks', 'deal_type',
  'vacant', 'title_split', 'enrichment_manifest', 'last_seen_at',
].join(', ');

/**
 * Run the curator cycle for `pickDate` (YYYY-MM-DD).
 *
 * @param {object} supabase - Initialised Supabase client
 * @param {object} [opts]
 * @param {string} [opts.pickDate] - YYYY-MM-DD — defaults to today (UK time)
 * @param {Function} [opts.callAI] - Test stub for the AI call
 * @param {Function} [opts.queryHPI] - Test stub for HPI lookup
 * @param {boolean} [opts.dryRun] - If true, skip DB insert
 * @returns {Promise<{ skipped?: boolean, summary: object }>}
 */
export async function runCuratorCycle(supabase, opts = {}) {
  const enabled = (process.env.CURATOR_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    log.info('curator-cycle: CURATOR_ENABLED=false — skipping');
    return { skipped: true, reason: 'disabled' };
  }

  const pickDate = opts.pickDate || todayUk();
  const minLeadIso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  log.info('curator-cycle: starting', { pickDate, minLeadIso });

  // ── 1. Pre-filter at the DB ──────────────────────────────────────
  const { data: lotRows, error: lotsErr } = await supabase
    .from('lots')
    .select(CANDIDATE_LOT_FIELDS)
    .gte('score', 7.0)
    .eq('status', 'available')
    .not('image_url', 'is', null)
    .gte('auction_date', minLeadIso)
    .order('score', { ascending: false, nullsFirst: false })
    .order('last_seen_at', { ascending: false })
    .limit(CANDIDATE_POOL_SIZE);

  if (lotsErr) {
    log.error('curator-cycle: candidate query failed', { err: lotsErr.message });
    return { skipped: false, error: lotsErr.message, summary: { candidates: 0, selected: 0, generated: 0, inserted: 0 } };
  }

  const candidates = (lotRows || []).map(dbRowToLot).map((lot, i) => ({
    ...lot,
    _dbId: (lotRows[i] && lotRows[i].id) || null,
  }));

  if (candidates.length === 0) {
    log.info('curator-cycle: no candidates met DB pre-filter — nothing to do', { pickDate });
    return { skipped: false, summary: { candidates: 0, selected: 0, generated: 0, inserted: 0, reason: 'no-candidates' } };
  }

  // ── 2. Hydrate fundability (cached, cheap) ───────────────────────
  for (const lot of candidates) {
    try {
      lot.fundability = await getFundabilityBadge(lot);
    } catch {
      lot.fundability = null;
    }
  }

  // ── 3. Pull recent picks for dedup, then run pure selector ──────
  const recentPicks = await getRecentPickedLotIds();
  const selected = selectPicks(candidates, recentPicks);

  if (selected.length === 0) {
    log.info('curator-cycle: no picks survived selection (likely all recently featured or low fundability)', { pickDate, candidatePool: candidates.length });
    return { skipped: false, summary: { candidates: candidates.length, selected: 0, generated: 0, inserted: 0, reason: 'no-eligible' } };
  }

  // ── 4. Generate prose (sequential — Gemini rate limiter handles spacing) ──
  const generated = [];
  for (let i = 0; i < selected.length; i++) {
    const lot = selected[i];
    let prose;
    try {
      prose = await generateProse(lot, { callAI: opts.callAI, queryHPI: opts.queryHPI });
    } catch (e) {
      log.warn('curator-cycle: generateProse threw', { lotId: lot._dbId, err: e.message });
      prose = null;
    }
    if (!prose) continue;
    generated.push({
      lotId: lot._dbId,
      rank: i + 1,
      headline: prose.headline,
      prose: prose.prose,
      hook: prose.hook,
    });
  }

  if (generated.length === 0) {
    log.warn('curator-cycle: every prose generation failed — nothing to persist', { pickDate, attempted: selected.length });
    return { skipped: false, summary: { candidates: candidates.length, selected: selected.length, generated: 0, inserted: 0, reason: 'prose-failed' } };
  }

  // Re-rank densely 1..N after generation losses so admin sees consecutive ranks
  generated.forEach((p, idx) => { p.rank = idx + 1; });

  // ── 5. Persist (or dry-run) ─────────────────────────────────────
  if (opts.dryRun) {
    log.info('curator-cycle: dry-run — skipping DB insert', { pickDate, generated: generated.length });
    return { skipped: false, summary: { candidates: candidates.length, selected: selected.length, generated: generated.length, inserted: 0, dryRun: true }, picks: generated };
  }

  const { inserted, skipped: insertSkipped } = await insertPicks(pickDate, generated);

  log.info('curator-cycle: complete', { pickDate, candidates: candidates.length, selected: selected.length, generated: generated.length, inserted, insertSkipped });

  return {
    skipped: false,
    summary: {
      candidates: candidates.length,
      selected: selected.length,
      generated: generated.length,
      inserted,
      insertSkipped,
    },
  };
}

// ── UK-date helper (no Intl-zone surprises) ──────────────────────────
function todayUk() {
  const ukNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const y = ukNow.getFullYear();
  const m = String(ukNow.getMonth() + 1).padStart(2, '0');
  const d = String(ukNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Test-only export
export const _internal = { todayUk, CANDIDATE_LOT_FIELDS, CANDIDATE_POOL_SIZE };
