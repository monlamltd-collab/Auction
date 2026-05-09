-- migrations/2026-05-05-mark-placeholder-addresses.sql
--
-- Phase 3 cleanup of issue #2 (within-house "duplications" = address
-- extraction failures). Marks rows whose `address` is placeholder/banner
-- text (not a real postal address) as status='extraction_failure' so they
-- stop showing in the frontend.
--
-- Previewed 2026-05-05: 702 rows affected across 13 houses, dominated by
-- harmanhealy (497) where the listing card never exposes the address.
--
-- The forward-fix in commit f55acb2 (lib/scraper/lot-schema.js +
-- lib/pipeline/firecrawl-extract.js) prevents new placeholder-address rows
-- from being created. This migration cleans up the rows already in the DB.
--
-- Idempotent: only touches rows currently marked 'available'. Re-running is
-- a no-op once they've been flipped to 'extraction_failure'.
--
-- Reversible: a future migration can flip status back to 'available' if a
-- WHERE-clause regression is detected (none expected — see preview sample).
--
-- Apply via Supabase MCP execute_sql. Don't run via psql directly.

UPDATE lots
SET status = 'extraction_failure',
    last_seen_at = now()
WHERE status = 'available'
  AND property_key IS NOT NULL
  -- property_key shape is "lower(postcode)|lower(addr-line-1)" — empty postcode
  -- means "|something" which doesn't match this prefix pattern.
  AND property_key NOT SIMILAR TO '[a-z]{1,2}[0-9][a-z0-9]?%'
  AND (
    -- "A three bedroom semi-detached house" / "Three bedroom mid-terrace house"
    address ~* '^(a\s+)?(one|two|three|four|five|six)\s+bed(room)?'
    -- "3 Bedroom House" / "2 bed flat"
    OR address ~* '^[0-9]\s*bed(room)?\s+(house|flat|apartment|maisonette|bungalow|terrace)'
    -- Banner / button / status text
    OR address ~* 'virtual\s+viewing'
    OR address ~* 'sold\s+prior\s+to\s+auction'
    OR address ~* 'national\s+online\s+auction'
    OR address ~* 'click\s+to\s+view'
    OR address ~* '^(lot|property)\s+[0-9]+\s*$'
    OR address ~* '^view\s+(property|details|lot)'
    OR address ~* '^bidding\s+(now\s+)?open'
  );
