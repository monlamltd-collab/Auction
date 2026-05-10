-- migrations/2026-05-10-curator-picks.sql
--
-- Daily Deal Curator (Monetization Sprint Phase 1).
--
-- Adds the `curator_picks` table — every nightly cycle selects up to 8 lots,
-- generates investor-facing prose via Gemini Pro, and writes a row per pick
-- with status='pending'. An admin reviews at /admin/curator and approves;
-- only `approved` picks render publicly (homepage widget + daily digest +
-- LinkedIn share artefact). Manual gate exists for the first 14 days; flip
-- env var CURATOR_AUTO_APPROVE=true to skip once trusted.
--
-- Also bolts a daily-digest opt-in onto email_signups, parallel to the
-- existing weekly digest_optin column from 2026-05-10-weekly-digest.sql.
-- A subscriber can be in either, both, or neither.
--
-- Idempotent. Apply via Supabase MCP `apply_migration` after `confirm_cost`.

CREATE TABLE IF NOT EXISTS curator_picks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date       DATE NOT NULL,
  lot_id          UUID NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  rank            SMALLINT NOT NULL,
  headline        TEXT NOT NULL,
  prose           TEXT NOT NULL,
  hook            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  rejected_reason TEXT,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT curator_picks_unique_pick UNIQUE (pick_date, lot_id),
  CONSTRAINT curator_picks_status_check CHECK (status IN ('pending','approved','rejected'))
);

-- Homepage widget + daily digest both query
--   WHERE pick_date = today AND status = 'approved' ORDER BY rank
-- Admin review queries
--   WHERE pick_date = today AND status = 'pending'  ORDER BY rank
-- Single composite index covers both.
CREATE INDEX IF NOT EXISTS curator_picks_date_status_rank_idx
  ON curator_picks (pick_date DESC, status, rank);

-- Dedup-rotation lookup: "was this lot picked in the last 14 days?"
-- uses (lot_id, pick_date DESC) for a tight tail scan.
CREATE INDEX IF NOT EXISTS curator_picks_lot_date_idx
  ON curator_picks (lot_id, pick_date DESC);

-- ── Daily digest opt-in (parallel to existing weekly digest_optin) ──
ALTER TABLE email_signups
  ADD COLUMN IF NOT EXISTS daily_digest_optin       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_daily_digest_sent_at TIMESTAMPTZ;

-- Partial index — same shape as the weekly one. The daily cron filters to
--   WHERE daily_digest_optin = TRUE
--     AND (last_daily_digest_sent_at IS NULL OR last_daily_digest_sent_at < now() - interval '20 hours')
-- so a partial index keeps it tiny regardless of total signups.
CREATE INDEX IF NOT EXISTS email_signups_daily_digest_idx
  ON email_signups (last_daily_digest_sent_at NULLS FIRST)
  WHERE daily_digest_optin = TRUE;
