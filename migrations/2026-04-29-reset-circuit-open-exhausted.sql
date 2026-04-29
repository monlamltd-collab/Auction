-- 2026-04-29: Resurrect retry-queue rows burned by the pre-fix circuit_open bug.
--
-- Background: before commits 1416361 (defer in drain) and a4d07a0 (defer in
-- enqueue), every retry attempt taken while the OS Places circuit breaker
-- was tripped counted as a failed attempt. Rows hit attempts=5 (MAX_ATTEMPTS)
-- in seconds without ever contacting OS Places, then sat sidelined by the
-- `attempts < 5` index that gates the drain. The coverage baseline captured
-- 196 such rows on 2026-04-27; further bursts pushed it to ~411 by 2026-04-28.
--
-- Both code paths are now fixed (drain + enqueue use 'defer' for circuit_open),
-- so this migration is a one-shot data fix to bring the legacy exhausted rows
-- back into the active queue. Idempotent: re-running it does nothing once the
-- target rows have been reset (the WHERE clause finds none).
--
-- Strategy: reset attempts to 0 (so the next drain treats it like a fresh
-- queue entry), push next_retry_at to now() + 60s (lets the breaker settle
-- before the drain picks them up), and stamp last_error so we can audit which
-- rows came back this way.

UPDATE enrichment_retry_queue
SET
  attempts = 0,
  next_retry_at = now() + interval '1 minute',
  last_error = COALESCE('reset_2026_04_29 (was: ' || last_error || ')',
                        'reset_2026_04_29 (no prior error)')
WHERE
  reason = 'circuit_open'
  AND attempts >= 5
  AND last_error NOT LIKE 'reset_2026_04_29%';  -- idempotency guard

-- Diagnostic: how many rows are still exhausted by some OTHER reason after
-- the reset. These are genuine failures (api_error, timeout, no_match) that
-- legitimately burned through their five attempts and are NOT touched by
-- this migration. Surfaced as a NOTICE so applying the migration via the
-- Supabase dashboard prints the count.
DO $$
DECLARE
  remaining_exhausted INT;
BEGIN
  SELECT COUNT(*) INTO remaining_exhausted
  FROM enrichment_retry_queue
  WHERE attempts >= 5;
  RAISE NOTICE 'reset_2026_04_29: % retry-queue rows still exhausted after reset (legitimate failures, not circuit_open)', remaining_exhausted;
END $$;
