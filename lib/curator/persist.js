// ═══════════════════════════════════════════════════════════════
// CURATOR — Supabase persistence layer
// ═══════════════════════════════════════════════════════════════
// All curator_picks reads + writes go through this module so the cycle
// runner, admin endpoints, homepage feed, and digest sender all share
// one definition of "what's a pick" and "how do we approve / reject one".

import { supabase } from '../supabase.js';
import { log } from '../logging.js';

const RECENT_DEDUP_DAYS = 14;

/**
 * Insert a batch of generated picks for `pick_date` with status='pending'.
 * Idempotent — duplicate (pick_date, lot_id) is silently ignored thanks to
 * the unique constraint, so re-running the cycle the same day is safe.
 *
 * @param {string} pickDate - YYYY-MM-DD
 * @param {Array<{lotId, rank, headline, prose, hook}>} picks
 * @returns {Promise<{ inserted: number, skipped: number }>}
 */
export async function insertPicks(pickDate, picks) {
  if (!picks || picks.length === 0) return { inserted: 0, skipped: 0 };

  const rows = picks.map(p => ({
    pick_date: pickDate,
    lot_id: p.lotId,
    rank: p.rank,
    headline: p.headline,
    prose: p.prose,
    hook: p.hook,
    status: 'pending',
  }));

  // Use upsert so a re-run replaces the prose for the same (date, lot).
  // onConflict skips rows already approved/rejected — we don't want to
  // wipe an admin's verdict if someone re-triggers the cycle.
  const { data, error } = await supabase
    .from('curator_picks')
    .insert(rows)
    .select('id, lot_id');

  if (error) {
    // 23505 = unique violation; benign if a previous run already wrote the row
    if (error.code === '23505') {
      log.info('curator.insertPicks: some picks already existed (re-run)', { pickDate, count: picks.length });
      return { inserted: 0, skipped: picks.length };
    }
    log.error('curator.insertPicks failed', { pickDate, err: error.message });
    throw new Error(error.message);
  }

  const inserted = (data || []).length;
  return { inserted, skipped: picks.length - inserted };
}

/**
 * Pull every curator_picks row from the last RECENT_DEDUP_DAYS days, used
 * by the selector to skip lots that have been featured recently.
 */
export async function getRecentPickedLotIds(now = new Date()) {
  const since = new Date(now.getTime() - RECENT_DEDUP_DAYS * 86400000)
    .toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('curator_picks')
    .select('lot_id, pick_date')
    .gte('pick_date', since);
  if (error) {
    log.warn('curator.getRecentPickedLotIds failed (non-fatal — duplicates may slip through)', { err: error.message });
    return [];
  }
  return data || [];
}

/**
 * Fetch today's APPROVED picks joined with the underlying lot rows so the
 * homepage widget + daily digest can render them in one query.
 *
 * Returns an array shaped:
 *   [{ pick: {id, headline, prose, hook, rank}, lot: <lots row> }, ...]
 * sorted by rank ASC.
 */
export async function getApprovedPicksWithLots(pickDate, opts = {}) {
  const lotsSelect = opts.lotsSelect ||
    'id, house, lot_number, url, address, postcode, price, price_text, prop_type, beds, status, image_url, score, deal_type, last_seen_at';

  const { data, error } = await supabase
    .from('curator_picks')
    .select(`id, rank, headline, prose, hook, pick_date, status, lots:lot_id ( ${lotsSelect} )`)
    .eq('pick_date', pickDate)
    .eq('status', 'approved')
    .order('rank', { ascending: true });

  if (error) {
    log.warn('curator.getApprovedPicksWithLots failed', { pickDate, err: error.message });
    return [];
  }

  return (data || [])
    .filter(row => row.lots) // discard if the underlying lot was deleted
    .map(row => ({
      pick: { id: row.id, rank: row.rank, headline: row.headline, prose: row.prose, hook: row.hook, pickDate: row.pick_date },
      lot: row.lots,
    }));
}

/**
 * Fetch all PENDING picks for admin review (any date, but defaults to today).
 */
export async function getPendingPicksWithLots(pickDate, opts = {}) {
  const lotsSelect = opts.lotsSelect ||
    'id, house, lot_number, url, address, postcode, price, price_text, prop_type, beds, status, image_url, score, deal_type, last_seen_at, opps, risks';

  const { data, error } = await supabase
    .from('curator_picks')
    .select(`id, rank, headline, prose, hook, pick_date, status, generated_at, lots:lot_id ( ${lotsSelect} )`)
    .eq('pick_date', pickDate)
    .eq('status', 'pending')
    .order('rank', { ascending: true });

  if (error) {
    log.warn('curator.getPendingPicksWithLots failed', { pickDate, err: error.message });
    return [];
  }

  return (data || [])
    .filter(row => row.lots)
    .map(row => ({
      pick: { id: row.id, rank: row.rank, headline: row.headline, prose: row.prose, hook: row.hook, pickDate: row.pick_date, generatedAt: row.generated_at },
      lot: row.lots,
    }));
}

/**
 * Mark a single pick as approved (or rejected). The `approver` string is
 * persisted for audit; admin endpoints derive it from x-admin-secret usage
 * (single-operator for now → constant 'admin').
 */
export async function setPickStatus(pickId, status, approver = 'admin', reason = null) {
  if (!['approved', 'rejected'].includes(status)) {
    throw new Error(`setPickStatus: invalid status '${status}'`);
  }
  const update = { status };
  if (status === 'approved') {
    update.approved_by = approver;
    update.approved_at = new Date().toISOString();
  } else {
    update.rejected_at = new Date().toISOString();
    update.rejected_reason = reason;
  }
  const { data, error } = await supabase
    .from('curator_picks')
    .update(update)
    .eq('id', pickId)
    .select('id, status')
    .maybeSingle();

  if (error) {
    log.error('curator.setPickStatus failed', { pickId, status, err: error.message });
    throw new Error(error.message);
  }
  if (!data) {
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, status: data.status };
}

/**
 * Bulk-approve a whole pick_date — used when admin reviews 8 picks and clicks
 * "Approve all". One round-trip beats N individual calls.
 */
export async function approveAllForDate(pickDate, approver = 'admin') {
  const { data, error } = await supabase
    .from('curator_picks')
    .update({ status: 'approved', approved_by: approver, approved_at: new Date().toISOString() })
    .eq('pick_date', pickDate)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    log.error('curator.approveAllForDate failed', { pickDate, err: error.message });
    throw new Error(error.message);
  }
  return { approved: (data || []).length };
}
