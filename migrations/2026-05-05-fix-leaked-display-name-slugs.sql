-- Fix 412 lots persisted under display name instead of canonical slug.
-- Root cause patched 2026-05-05 in lib/pipeline/persist-lots.js (canonicaliseHouseSlug).
--
-- Pre-flight (verified 2026-05-05): all 411 of the 412 stranded lots are duplicates
-- of an existing canonical-slug row with the same URL. The canonical-slug row is
-- the one the active pipeline writes to and is the freshest copy. Strategy:
--   1. DELETE the 411 duplicate display-name-slugged rows.
--   2. UPDATE the 1 remaining unique row (scargill mann → scargillmann).
--
-- Run inside one transaction so a failure rolls everything back.

BEGIN;

-- ── 1. DELETE the 411 duplicate rows ──
-- Each display-name-slugged row is paired with a canonical-slug row of the same URL;
-- delete only when the canonical-slug twin exists, so we never lose the only copy.
WITH leaks(bad, good) AS (VALUES
  ('future property auctions',    'futureauctions'),
  ('butters john bee',            'buttersjohnbee'),
  ('Venmore Auctions',            'venmore'),
  ('maggs & allen',                'maggsandallen'),
  ('knight frank',                 'knightfrank'),
  ('john francis',                 'johnfrancis'),
  ('SDL Auctions',                 'sdl'),
  ('greenslade taylor hunt',       'gth'),
  ('Auction House West Midlands',  'auctionhousewestmidlands'),
  ('Auction House East Midlands',  'auctionhouseeastmidlands'),
  ('scargill mann',                'scargillmann')
)
DELETE FROM lots l_bad
USING leaks lk, lots l_good
WHERE l_bad.house  = lk.bad
  AND l_good.house = lk.good
  AND l_good.url   = l_bad.url;

-- ── 2. UPDATE the 1 truly stranded row ──
-- Anything left under a leaked house name has no canonical twin — relabel it.
UPDATE lots SET house = 'futureauctions'              WHERE house = 'future property auctions';
UPDATE lots SET house = 'buttersjohnbee'              WHERE house = 'butters john bee';
UPDATE lots SET house = 'venmore'                     WHERE house = 'Venmore Auctions';
UPDATE lots SET house = 'maggsandallen'               WHERE house = 'maggs & allen';
UPDATE lots SET house = 'knightfrank'                 WHERE house = 'knight frank';
UPDATE lots SET house = 'johnfrancis'                 WHERE house = 'john francis';
UPDATE lots SET house = 'sdl'                         WHERE house = 'SDL Auctions';
UPDATE lots SET house = 'gth'                         WHERE house = 'greenslade taylor hunt';
UPDATE lots SET house = 'auctionhousewestmidlands'    WHERE house = 'Auction House West Midlands';
UPDATE lots SET house = 'auctionhouseeastmidlands'    WHERE house = 'Auction House East Midlands';
UPDATE lots SET house = 'scargillmann'                WHERE house = 'scargill mann';

COMMIT;
