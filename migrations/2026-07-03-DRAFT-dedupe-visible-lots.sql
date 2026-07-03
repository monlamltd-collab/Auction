-- migrations/2026-07-03-DRAFT-dedupe-visible-lots.sql
--
-- ⚠ DRAFT — DESTRUCTIVE. DO NOT APPLY without review (Simon signs off).
--
-- One-off cleanup of the duplicate rows already in the lots table, companion
-- to the 2026-07-03 duplicate-lots fixes (canonicaliseLotUrl, the venmore
-- property-key merge guard, the robinsonhall event-URL guard). The code
-- changes stop NEW duplicates; this removes the existing ones. ~578 excess
-- rows sat among the ~4,650 user-visible lots when measured on 2026-07-03.
--
-- Before applying:
--   * Confirm lot_events has no FK to lots(id) that blocks deletes (event
--     history for deleted rows is intentionally retained).
--   * Run each numbered block's SELECT first; the counts should match the
--     comment before you run its DELETE/UPDATE.

-- ── 1) robinsonhall: auction VENUE extracted as a lot, once per event URL ──
-- Expected ~8 rows (Delta Marriott Hotel, /auction/<date>/ URLs).
-- select count(*) from lots where house_slug = 'robinsonhall' and url ~ '/auctions?/\d{1,2}-\d{1,2}-\d{2,4}/?$';
delete from lots
where house_slug = 'robinsonhall'
  and url ~ '/auctions?/\d{1,2}-\d{1,2}-\d{2,4}/?$';

-- ── 2) hollismorgan: querystring variants of the same detail path ──
-- 2a. Drop variants whose canonical (query-less) row already exists.
delete from lots a
where a.house_slug = 'hollismorgan'
  and position('?' in a.url) > 0
  and exists (select 1 from lots b where b.url = split_part(a.url, '?', 1));

-- 2b. Of the remaining variants, keep one per path (most recently seen)…
with ranked as (
  select id,
         row_number() over (partition by split_part(url, '?', 1)
                            order by last_seen_at desc nulls last) rn
  from lots
  where house_slug = 'hollismorgan' and position('?' in url) > 0
)
delete from lots where id in (select id from ranked where rn > 1);

-- 2c. …and rewrite the survivor to the canonical query-less URL, matching
--     what canonicaliseLotUrl now persists.
update lots
set url = split_part(url, '?', 1)
where house_slug = 'hollismorgan' and position('?' in url) > 0;

-- ── 3) venmore: unstable ?property_reference= minted up to 6 rows/property ──
-- Keep the most recently seen row per property identity (the generated
-- property_key column: postcode|first-address-segment).
-- select property_key, count(*) from lots where house_slug='venmore' group by 1 having count(*) > 1;
with ranked as (
  select id,
         row_number() over (partition by property_key
                            order by last_seen_at desc nulls last) rn
  from lots
  where house_slug = 'venmore'
)
delete from lots where id in (select id from ranked where rn > 1);

-- ── NOT cleaned here ──
-- * AH-platform stale re-lists (same address, successive lot ids): distinct
--   real rows from distinct auctions — history worth keeping. Their board
--   visibility is fixed by 2026-07-03-get-active-lots-unsold-sentinel-guard.sql
--   (sentinel-dated unsold rows now retire when the scraper stops seeing them).
-- * cliveemson "Town - County" address collisions: distinct lots, address
--   quality — fixed forward by the lot-detail town-only address upgrade; no
--   rows to delete.
