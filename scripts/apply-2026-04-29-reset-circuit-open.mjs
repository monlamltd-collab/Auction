// scripts/apply-2026-04-29-reset-circuit-open.mjs
//
// One-shot migration runner for migrations/2026-04-29-reset-circuit-open-exhausted.sql.
// Resurrects retry-queue rows that were burned by the pre-fix circuit_open bug
// (see commit 1416361, a4d07a0, 03ead25 for the structural fixes).
//
// Why a Node script instead of just running the .sql file:
//   - Supabase MCP isn't authenticated in the dev session that wrote this.
//   - The Supabase JS client doesn't run raw SQL DO-blocks — but the actual
//     UPDATE in the migration is expressible as a typed query, so we
//     reimplement the logic here using the same idempotency guard.
//
// Usage (from repo root):
//   node scripts/apply-2026-04-29-reset-circuit-open.mjs
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in env (Railway-style names).
// Idempotent: re-running is a no-op once the rows have been reset (the
// last_error guard prevents double-resets).

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Step 1: count what we're about to touch.
const { count: targetCount, error: countErr } = await supabase
  .from('enrichment_retry_queue')
  .select('id', { count: 'exact', head: true })
  .eq('reason', 'circuit_open')
  .gte('attempts', 5)
  .not('last_error', 'ilike', 'reset_2026_04_29%');

if (countErr) {
  console.error('Count query failed:', countErr.message);
  process.exit(1);
}

console.log(`Found ${targetCount ?? 0} rows to reset (reason=circuit_open, attempts>=5, not already reset).`);

if ((targetCount ?? 0) === 0) {
  console.log('Nothing to do — migration already applied or no rows match.');
} else {
  // Step 2: pull the ids + last_error so we can preserve the original error
  // string in the audit-trail prefix.
  const { data: rows, error: selectErr } = await supabase
    .from('enrichment_retry_queue')
    .select('id, last_error')
    .eq('reason', 'circuit_open')
    .gte('attempts', 5)
    .not('last_error', 'ilike', 'reset_2026_04_29%');

  if (selectErr) {
    console.error('Select query failed:', selectErr.message);
    process.exit(1);
  }

  const nextRetryAt = new Date(Date.now() + 60 * 1000).toISOString();
  let updated = 0;
  let failed = 0;

  // Step 3: update in batches of 100 to keep the request size reasonable.
  // Each row gets a per-row last_error string so we can audit which rows
  // came back this way and what they used to say.
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(batch.map(async row => {
      const newErr = row.last_error
        ? `reset_2026_04_29 (was: ${row.last_error})`
        : 'reset_2026_04_29 (no prior error)';
      const { error: updErr } = await supabase
        .from('enrichment_retry_queue')
        .update({
          attempts: 0,
          next_retry_at: nextRetryAt,
          last_error: newErr,
        })
        .eq('id', row.id);
      if (updErr) { failed++; console.warn(`  row ${row.id}: ${updErr.message}`); }
      else updated++;
    }));
    process.stdout.write(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }
  console.log(`\nReset complete: ${updated} rows updated, ${failed} failed.`);
}

// Step 4: how many rows are still exhausted by some OTHER reason. These are
// genuine failures (api_error, timeout, no_match) — the migration leaves
// them alone. Surfaced for ops awareness.
const { count: stillExhausted } = await supabase
  .from('enrichment_retry_queue')
  .select('id', { count: 'exact', head: true })
  .gte('attempts', 5);

console.log(`Diagnostic: ${stillExhausted ?? 0} rows still exhausted (legitimate failures, NOT reset by this migration).`);
console.log('Done.');
