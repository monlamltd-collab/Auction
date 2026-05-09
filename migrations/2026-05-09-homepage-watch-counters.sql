-- migrations/2026-05-09-homepage-watch-counters.sql
--
-- Adds three columns to house_homepage_watch (created in 2026-05-04
-- migration) needed by the daily watcher in lib/pipeline/homepage-watch.js:
--
--   consecutive_unreachable    — bumped each cycle Firecrawl can't fetch
--                                the homepage; reset to 0 on success.
--                                Used to gate the
--                                `house_homepage_unreachable` alert
--                                so a single flaky day doesn't wake the
--                                operator.
--
--   consecutive_no_catalogue   — bumped each cycle the homepage renders
--                                fine but has no link to a current
--                                catalogue. Resets when a catalogue URL
--                                is extracted. Gates
--                                `house_no_catalogue_found`.
--
--   last_verdict               — string verdict from the watcher's
--                                decision matrix (record_only / baseline
--                                / content_change / url_drift_same_domain
--                                / url_drift_new_domain / domain_parked
--                                / not_an_auction_house / no_catalogue_found
--                                / unreachable). Useful for ad-hoc
--                                queries against the table.
--
-- Idempotent. Apply via Supabase MCP execute_sql — alongside the
-- 2026-05-04 migration if neither has run yet.

ALTER TABLE house_homepage_watch
  ADD COLUMN IF NOT EXISTS consecutive_unreachable  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_no_catalogue INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_verdict             TEXT;

CREATE INDEX IF NOT EXISTS house_homepage_watch_verdict ON house_homepage_watch(last_verdict);
