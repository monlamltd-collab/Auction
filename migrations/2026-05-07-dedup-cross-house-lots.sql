-- migrations/2026-05-07-dedup-cross-house-lots.sql
--
-- Cross-house dedup. Same physical lot URL was being inserted multiple times
-- because the upsert keyed on (house, url) and the underlying UNIQUE
-- constraint matched. Two AH UK regional branches list the same
-- /southwest/auction/lot/148039 → two rows, one with house='auctionhousedevon',
-- one with house='auctionhousesouthwest'. Same pattern across Bamboo
-- whitelabels (Hunters / Rendells / Stags etc.).
--
-- This migration:
--   1. Collapses duplicate-URL rows down to one row per URL (keeps the row
--      with the most recent last_seen_at — the latest scrape wins; the
--      dropped row is identical apart from the house field).
--   2. Drops the UNIQUE(house, url) constraint.
--   3. Adds UNIQUE(url) constraint.
--
-- Idempotent: re-running is safe. Step 1 deletes nothing on the second pass
-- because there are no remaining duplicates. Steps 2 and 3 use IF EXISTS /
-- IF NOT EXISTS guards.
--
-- Reversible? Partially. Restoring the (house, url) constraint is trivial,
-- but the deleted rows are gone. Acceptable because every deleted row was
-- a duplicate of the surviving one — no data loss.
--
-- The forward-fix (persist-lots.js: onConflict 'url') ships in the same
-- commit as this migration.
--
-- Apply via Supabase MCP apply_migration. Don't run via psql directly.

BEGIN;

-- 1. Collapse duplicates by URL — keep most-recent last_seen_at per URL
WITH ranked AS (
  SELECT id,
         url,
         ROW_NUMBER() OVER (
           PARTITION BY url
           ORDER BY last_seen_at DESC NULLS LAST, first_seen_at DESC NULLS LAST, id ASC
         ) AS rn
  FROM lots
  WHERE url IS NOT NULL
)
DELETE FROM lots
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Drop the old (house, url) unique constraint if present
ALTER TABLE lots DROP CONSTRAINT IF EXISTS lots_house_url_unique;

-- 3. Add UNIQUE(url) — partial index where url IS NOT NULL so rows with no
--    detail-page URL (rare but exist) are still allowed to coexist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'lots' AND c.conname = 'lots_url_unique'
  ) THEN
    -- Unique index on url where it's set; null urls allowed (postgres treats
    -- NULL as distinct from NULL in unique constraints, so this is automatic
    -- — but using a unique index makes the partial nature explicit).
    CREATE UNIQUE INDEX IF NOT EXISTS lots_url_unique ON lots (url) WHERE url IS NOT NULL;
  END IF;
END$$;

COMMIT;
