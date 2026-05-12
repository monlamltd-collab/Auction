-- migrations/2026-05-13-lots-auction-id.sql
--
-- Move 2 of the architectural realignment: replace (house, catalogue_url) as
-- the lots→catalogue join key with a UUID FK to auction_calendar(id).
--
-- Why: catalogue_url is a string that rotates. paulfosh, firstforauctions,
-- purplebricksgoto, harmanhealy all have ~1,834 live lots split across
-- keyspaces because their lots.catalogue_url no longer matches the live
-- auction_calendar.url. The denominator fix in PR #22 is a tactical patch
-- over the same fragility. The proper fix is a UUID FK — rotation-proof,
-- and gives the prune denominator a clean home.
--
-- This migration is ADDITIVE. The dual-read helper in lib/pipeline/lot-lookup.js
-- prefers auction_id when set, falls back to (house, catalogue_url) when NULL.
-- ON DELETE SET NULL keeps lots alive when an auction_calendar row is
-- deleted (lots become "orphaned" but still queryable via the legacy key).
--
-- NOT NULL is deliberately deferred: the url_mismatch cohort (~5,815 lots,
-- 43% of total) won't backfill cleanly on first pass. A follow-up migration
-- adds NOT NULL once the cohort is reconciled (separate move).

ALTER TABLE lots ADD COLUMN IF NOT EXISTS auction_id UUID
  REFERENCES auction_calendar(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lots_auction_id ON lots(auction_id);
