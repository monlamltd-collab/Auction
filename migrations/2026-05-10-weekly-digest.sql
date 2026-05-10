-- migrations/2026-05-10-weekly-digest.sql
--
-- Adds three columns to email_signups to support the email-only weekly
-- digest flow (Milestone 6). Existing rows default to opted-out so the
-- migration is non-destructive — only fresh signups via the digest form
-- on the home page footer are flagged in.
--
--   digest_optin          -- The user explicitly opted in via the
--                            /api/digest/subscribe endpoint. The Monday
--                            cron only sends to rows where this is TRUE.
--
--   unsubscribe_token     -- Random UUID used in the one-click footer
--                            link "Unsubscribe" of every digest email.
--                            Hitting GET /api/digest/unsubscribe?token=…
--                            flips digest_optin to FALSE. We rotate the
--                            token on unsub to invalidate any leaked
--                            link, but generate fresh on re-subscribe.
--
--   last_digest_sent_at   -- Timestamp of the most recent successful
--                            digest delivery. The cron uses this to skip
--                            users who already received a digest in the
--                            last 5 days, so the same recipient can't be
--                            spammed if the cron fires twice for any
--                            reason (e.g. a manual re-trigger).
--
-- Idempotent. Apply via Supabase MCP `apply_migration` after `confirm_cost`.

ALTER TABLE email_signups
  ADD COLUMN IF NOT EXISTS digest_optin        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS unsubscribe_token   UUID        NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMPTZ;

-- Partial index — the Monday cron's only query is
--   WHERE digest_optin = TRUE
--     AND (last_digest_sent_at IS NULL OR last_digest_sent_at < now() - interval '5 days')
-- so a partial index keeps the index tiny and fast even as the table
-- grows with non-digest signups.
CREATE INDEX IF NOT EXISTS email_signups_digest_optin_idx
  ON email_signups(last_digest_sent_at NULLS FIRST)
  WHERE digest_optin = TRUE;

-- Lookup index for the unsubscribe link. Token is high-entropy enough that
-- a btree on the column with a uniqueness expectation is fine without an
-- explicit unique constraint (the default gen_random_uuid() collision
-- probability is negligible for any realistic table size).
CREATE INDEX IF NOT EXISTS email_signups_unsubscribe_token_idx
  ON email_signups(unsubscribe_token);
