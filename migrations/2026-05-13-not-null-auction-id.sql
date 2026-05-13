-- migrations/2026-05-13-not-null-auction-id.sql
--
-- Follow-up H — the final step of the Move 2 realignment: add NOT NULL on
-- lots.auction_id so it becomes a type-system guarantee rather than a
-- "98.7% in practice" property.
--
-- This migration does three things in one transaction:
--
--   1. INSERT a sentinel calendar row (house_slug='__unattributed__') for
--      any future or residual lots that genuinely can't be attributed.
--      The URL uses a urn: scheme so it can never collide with a real
--      catalogue URL. status='always_on' + date='2099-12-31' so it
--      doesn't conflict with any UI/date filtering.
--
--   2. UPDATE remaining NULL lots to point at the sentinel (~4 stale rows
--      as of 2026-05-13 — sdl ?auction_date=2026-04-28 variant ×2,
--      brggibson, eigplatform).
--
--   3. ALTER TABLE lots ALTER COLUMN auction_id SET NOT NULL.
--
-- FK behaviour stays ON DELETE SET NULL. Combined with NOT NULL, this
-- means any DELETE on auction_calendar fails loudly if its row has
-- attached lots — a structural safety guard that's safer than the prior
-- silent-nullify. The daily-cleanup line in lib/analysis.js that did
-- `.delete().lt('date', today)` is removed in the same PR; past-date
-- calendar rows accumulate harmlessly (table is tiny).

-- 1. Sentinel calendar row — idempotent
INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'Unattributed', '__unattributed__', 'Sentinel for residual url_mismatch lots',
       'urn:bridgematch:unattributed-lots', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar WHERE house_slug = '__unattributed__'
);

-- 2. Backfill remaining NULL lots to the sentinel
UPDATE lots SET auction_id = (
  SELECT id FROM auction_calendar WHERE house_slug = '__unattributed__' LIMIT 1
)
WHERE auction_id IS NULL;

-- 3. NOT NULL constraint
ALTER TABLE lots ALTER COLUMN auction_id SET NOT NULL;
