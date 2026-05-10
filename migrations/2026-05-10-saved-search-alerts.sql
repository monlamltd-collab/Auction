-- migrations/2026-05-10-saved-search-alerts.sql
--
-- Adds two columns to saved_searches to support the Pro-tier email-alerts
-- feature. When a Pro user toggles on the bell for a saved search, the
-- daily cron at 08:00 UK queries lots matching that filter set since
-- last_notified_at and emails the user a digest. last_notified_at advances
-- only on a successful send (not on a no-match day) so a quiet stretch
-- doesn't become a flood when one match finally appears.
--
--   notify_email      -- Pro user has explicitly enabled email alerts
--                        for this saved search. UI bell toggle. Cron
--                        skips searches where this is false.
--
--   last_notified_at  -- Timestamp of the most recent email sent for
--                        this saved search. Used as the "since" filter
--                        on the next cron run so users only see lots
--                        that have appeared since their last alert.
--                        NULL = never notified yet (use created_at as
--                        the floor on first run).
--
-- Idempotent. Apply via Supabase MCP.

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS notify_email     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;

-- Index the alert-eligible subset since the cron only ever queries
-- WHERE notify_email = true. Saves a sequential scan as the table grows.
CREATE INDEX IF NOT EXISTS saved_searches_notify_idx
  ON saved_searches(user_id)
  WHERE notify_email = TRUE;
