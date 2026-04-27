// lib/pipeline/retry-queue.js — Per-field enrichment retry tracking
//
// COVERAGE_FIX_PLAN.md fix #2 backing store. When an enrichment lookup hits
// a transient failure (circuit_open, timeout, api_error, no_match) the lot
// gets queued here so a later pass can have another go without depending on
// every cycle re-discovering the gap from a full table scan.
//
// Public surface:
//   • enqueueRetry(supabase, { lotId, field, reason, source, error })
//     — Idempotent upsert. Increments attempts on a (lot_id, field) row that
//       already exists; resets to attempt 1 if the row is fresh.
//   • drainRetryQueue(supabase, { limit, attemptFn })
//     — Pulls due rows (next_retry_at <= now, attempts < 5), invokes
//       attemptFn(row) -> Promise<'ok' | 'retry' | 'give_up' | 'defer'>.
//       'ok'      → row deleted.
//       'retry'   → attempts++, exponential backoff applied.
//       'give_up' → row deleted (terminal failure / no_match resolved).
//       'defer'   → attempts UNCHANGED, next_retry_at pushed by DEFER_BACKOFF_MS
//                   (~15 min). Use when an attempt couldn't even try — e.g. a
//                   circuit breaker is open and lookupAddress would no-op.
//                   Without this branch, the original drain bug burned 5
//                   attempts in seconds while the OS Places breaker was
//                   tripped, sidelining 196 lots that had never actually been
//                   tried. See coverage-baseline.json#follow_ups.
//   • markRetryDone(supabase, lotId, field) — direct delete, for callers that
//     resolved a gap by other means (catalogue re-scrape filled the field).
//
// Backoff: 1h * 2^(attempts-1), capped at 24h.
//   attempt 1 → next at +1h, attempt 2 → +2h, attempt 3 → +4h, attempt 4 → +8h,
//   attempt 5 → +16h. Max attempts is 5; the (attempts < 5) index excludes
//   exhausted rows from drain queries.
//
// Defer backoff: 15 min (covers OS Places' 10-min breaker reset window with a
// 5-min buffer for jitter). Fixed delay, not exponential, because a deferred
// row hasn't actually attempted anything yet.

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 60 * 60 * 1000;       // 1h
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;   // 24h
const DEFER_BACKOFF_MS = 15 * 60 * 1000;      // 15 min

function backoffMs(attempts) {
  const delay = BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(delay, MAX_BACKOFF_MS);
}

function nextRetryAt(attempts) {
  return new Date(Date.now() + backoffMs(attempts)).toISOString();
}

/**
 * Queue a retry for (lot_id, field). Idempotent: hits the unique constraint
 * and updates the existing row (incrementing attempts) when one is present.
 */
export async function enqueueRetry(supabase, { lotId, field, reason, source, error }) {
  if (!supabase || !lotId || !field) return;
  try {
    // Hand-rolled upsert — Postgres `ON CONFLICT DO UPDATE` would be cleaner
    // but the supabase-js client's .upsert() doesn't support per-column SQL
    // expressions (we need attempts = attempts + 1).
    const { data: existing } = await supabase
      .from('enrichment_retry_queue')
      .select('id, attempts')
      .eq('lot_id', lotId)
      .eq('field', field)
      .maybeSingle();

    if (existing) {
      const attempts = Math.min(existing.attempts + 1, MAX_ATTEMPTS);
      await supabase.from('enrichment_retry_queue').update({
        attempts,
        reason,
        source: source || null,
        last_error: error || null,
        last_attempted_at: new Date().toISOString(),
        next_retry_at: nextRetryAt(attempts),
      }).eq('id', existing.id);
    } else {
      await supabase.from('enrichment_retry_queue').insert({
        lot_id: lotId,
        field,
        reason,
        source: source || null,
        attempts: 1,
        last_error: error || null,
        next_retry_at: nextRetryAt(1),
      });
    }
  } catch (err) {
    // Queue inserts are non-fatal — the gap-filler will rediscover the
    // missing field on the next full sweep.
    console.warn(`retry-queue enqueue failed (${field}): ${err.message}`);
  }
}

/**
 * Pull due retry rows and invoke attemptFn for each.
 *
 * @param {object} supabase
 * @param {object} opts
 * @param {number} [opts.limit=50] — max rows to attempt this drain
 * @param {Function} opts.attemptFn — async (row) → 'ok' | 'retry' | 'give_up' | 'defer'
 * @returns {Promise<{ attempted: number, ok: number, retried: number, gaveUp: number, deferred: number }>}
 */
export async function drainRetryQueue(supabase, opts = {}) {
  const { limit = 50, attemptFn } = opts;
  if (!supabase || typeof attemptFn !== 'function') {
    return { attempted: 0, ok: 0, retried: 0, gaveUp: 0, deferred: 0 };
  }

  const { data: due } = await supabase
    .from('enrichment_retry_queue')
    .select('*')
    .lte('next_retry_at', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .order('next_retry_at', { ascending: true })
    .limit(limit);

  if (!due || due.length === 0) {
    return { attempted: 0, ok: 0, retried: 0, gaveUp: 0, deferred: 0 };
  }

  let ok = 0, retried = 0, gaveUp = 0, deferred = 0;

  for (const row of due) {
    let outcome = 'retry';
    try {
      outcome = await attemptFn(row);
    } catch (err) {
      outcome = 'retry';
      row._lastError = err.message;
    }

    if (outcome === 'ok') {
      await supabase.from('enrichment_retry_queue').delete().eq('id', row.id);
      ok++;
    } else if (outcome === 'give_up') {
      await supabase.from('enrichment_retry_queue').delete().eq('id', row.id);
      gaveUp++;
    } else if (outcome === 'defer') {
      // Couldn't even try — push next_retry_at out by a fixed window without
      // touching attempts. Distinct from 'retry' so the drain log surfaces
      // breaker-driven defers separately from genuine failures.
      await supabase.from('enrichment_retry_queue').update({
        last_attempted_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + DEFER_BACKOFF_MS).toISOString(),
      }).eq('id', row.id);
      deferred++;
    } else {
      const attempts = Math.min(row.attempts + 1, MAX_ATTEMPTS);
      await supabase.from('enrichment_retry_queue').update({
        attempts,
        last_attempted_at: new Date().toISOString(),
        next_retry_at: nextRetryAt(attempts),
        last_error: row._lastError || row.last_error || null,
      }).eq('id', row.id);
      retried++;
    }
  }

  return { attempted: due.length, ok, retried, gaveUp, deferred };
}

/**
 * Resolve a queued retry without going through the drain — e.g. when a
 * catalogue re-scrape happens to fill the missing field via a different path.
 */
export async function markRetryDone(supabase, lotId, field) {
  if (!supabase || !lotId || !field) return;
  try {
    await supabase
      .from('enrichment_retry_queue')
      .delete()
      .eq('lot_id', lotId)
      .eq('field', field);
  } catch (err) {
    console.warn(`retry-queue markRetryDone failed: ${err.message}`);
  }
}

// Exported for tests — keeps the constants discoverable without exposing
// runtime mutability.
export const _internals = { MAX_ATTEMPTS, BASE_BACKOFF_MS, MAX_BACKOFF_MS, DEFER_BACKOFF_MS, backoffMs, nextRetryAt };
