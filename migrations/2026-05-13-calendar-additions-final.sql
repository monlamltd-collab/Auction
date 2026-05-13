-- migrations/2026-05-13-calendar-additions-final.sql
--
-- Follow-up G: final calendar additions for the residual url_mismatch
-- cohort. After PR #34 (Follow-up F's always_on fallback) lifted match
-- rate to 99.5%, the remaining 68 NULL lots are split across:
--
--  - 5 houses (markjenkinson, barnardmarcus, maggsandallen, loveitts,
--    suttonkersh) that have multiple specific-date calendar rows but
--    NO always_on row. Adding an always_on row (HOUSE_ROOTS canonical)
--    triggers Follow-up F's fallback rule on the next backfill pass.
--
--  - sdl bare-btgeddisons URL (4 lots): PR #32 added a calendar row for
--    /properties but not the bare-domain variant. Add it.
--
-- Houses we deliberately skip:
--  - eigplatform (1), brggibson (1): 0 cal rows; 1 lot each from stale
--    sources. Adding canonical rows is overkill for one-off stragglers.
--  - sdl sdlauctions ?auction_date=2026-04-28 variant (2 lots): one-off
--    query-string form, not the canonical scraper output.
--
-- Expected: 99.5% → ~99.95% (only 4 truly-stale lots residual).

-- Houses without an always_on row — give them one at HOUSE_ROOTS canonical.
-- The Follow-up F fallback rule (writer-side) attributes URL-miss lots
-- for these houses to the new always_on going forward; the SQL one-shot
-- below catches existing NULLs.

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'Mark Jenkinson', 'markjenkinson', 'Mark Jenkinson (always-on)',
       'https://www.markjenkinson.co.uk/', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'markjenkinson' AND status = 'always_on'
);

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'Barnard Marcus', 'barnardmarcus', 'Barnard Marcus (always-on)',
       'https://www.barnardmarcusauctions.co.uk/', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'barnardmarcus' AND status = 'always_on'
);

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'Maggs & Allen', 'maggsandallen', 'Maggs & Allen (always-on)',
       'https://www.maggsandallen.co.uk/search-auction/', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'maggsandallen' AND status = 'always_on'
);

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'Loveitts', 'loveitts', 'Loveitts (always-on)',
       'https://www.eigpropertyauctions.co.uk/live-stream/auction/loveitts', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'loveitts' AND status = 'always_on'
);

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'Sutton Kersh', 'suttonkersh', 'Sutton Kersh (always-on)',
       'https://www.suttonkersh.co.uk/properties/gallery/?section=auction&auctionPeriod=current', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'suttonkersh' AND status = 'always_on'
);

-- sdl bare-btgeddisons URL (4 lots): add direct calendar row matching the
-- bare-domain variant the scraper produces for some lots.
INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'SDL Auctions (BTG Eddisons, bare)', 'sdl', 'SDL via BTG Eddisons — bare-domain variant',
       'https://btgeddisonspropertyauctions.com/', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'sdl' AND url = 'https://btgeddisonspropertyauctions.com'
);
