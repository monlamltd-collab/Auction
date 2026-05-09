-- 2026-05-04: Homepage watch table for proactive URL-drift self-healing.
--
-- Background: existing healBrokenHouse() in lib/pipeline/healing.js fires
-- only on 0-lot regressions (had lots → now zero). It misses two cases:
--   1. Houses that have been at 0 lots for a long time (no baseline to regress)
--   2. Houses where the catalogue URL has drifted but old URL still returns
--      a stale page (e.g., archive view) so no regression triggers
--
-- This table backs a daily homepage watcher that uses Firecrawl's
-- changeTracking format to detect changes on each configured house's
-- homepage. When the homepage's content (or its extracted "current
-- catalogue URL" field) changes, we trigger healBrokenHouse to verify
-- and update the catalogue URL.
--
-- One row per house slug. Updated on every watcher run.

CREATE TABLE IF NOT EXISTS house_homepage_watch (
  slug TEXT PRIMARY KEY,
  homepage_url TEXT NOT NULL,
  -- Firecrawl-side change tracking state
  last_checked_at TIMESTAMPTZ,
  last_change_status TEXT,           -- new | unchanged | changed | removed
  last_previous_scrape_at TIMESTAMPTZ,
  -- What the homepage said the current catalogue URL is (extracted via JSON schema)
  last_extracted_catalogue_url TEXT,
  last_next_auction_date TEXT,       -- "19 May 2026" etc — free-text from extraction
  last_site_status TEXT,             -- active | no_current_auction | domain_parked | not_an_auction_house
  -- Diagnostic and debouncing
  last_diff_excerpt TEXT,            -- first 500 chars of git-diff for debugging
  consecutive_unchanged INT DEFAULT 0,
  -- Healing trigger tracking
  last_heal_attempted_at TIMESTAMPTZ,
  last_heal_committed_url TEXT,
  -- Lifecycle
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS house_homepage_watch_check_due ON house_homepage_watch(last_checked_at);
CREATE INDEX IF NOT EXISTS house_homepage_watch_change_status ON house_homepage_watch(last_change_status);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION house_homepage_watch_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS house_homepage_watch_touch_trg ON house_homepage_watch;
CREATE TRIGGER house_homepage_watch_touch_trg
BEFORE UPDATE ON house_homepage_watch
FOR EACH ROW EXECUTE FUNCTION house_homepage_watch_touch();
