-- migrations/2026-05-13-reconcile-residual-mop-up.sql
--
-- Follow-up D of Move 2: residual mop-up. After PR #27 (8 houses) and PR #29
-- (7 houses), there are still ~1,225 unmatched lots. This migration handles
-- 4 distinct cohort types that together cover ~841 of them, pushing match
-- rate 91.0% → ~97.1%.
--
-- The remaining ~384 are scraper-side issues (lots.catalogue_url is being
-- produced by a transformation the calendar can't follow): landwood,
-- mccartneys, buttersjohnbee, agentsproperty, fssproperty, strettons,
-- maggsandallen, markjenkinson, barnardmarcus, etc. Those need code-side
-- fixes in lib/houses.js rewriteUrl or scraper rendering — out of scope here.
--
-- The normalisation trigger from PR #24 canonicalises each new value.

-- ─────────────────────────────────────────────────────────────
-- Cohort A: simple URL drift (calendar stale, lots match HOUSE_ROOTS).
-- 12 UPDATEs, ~200 lots.
-- Each new URL is from lib/houses.js HOUSE_ROOTS verified against the live
-- lots.catalogue_url for that house.
-- ─────────────────────────────────────────────────────────────

UPDATE auction_calendar SET url = 'https://www.webbers.co.uk/online-auctions/'
WHERE house_slug = 'webbers' AND url = 'https://webbers.co.uk/auctions';

UPDATE auction_calendar SET url = 'https://www.johnpye.co.uk/properties/'
WHERE house_slug = 'johnpye' AND url = 'https://johnpye.co.uk/upcoming-auctions';

UPDATE auction_calendar SET url = 'https://propertyauctions.lsh.co.uk/'
WHERE house_slug = 'lsh' AND url = 'https://propertyauctions.lsh.co.uk/future-auctions';

UPDATE auction_calendar SET url = 'https://www.wilsonsauctions.com/auctions/land-property-auctions'
WHERE house_slug = 'wilsons' AND url = 'https://wilsonsauctions.com/auctions/land-property-england-wales-3653';

UPDATE auction_calendar SET url = 'https://www.hallsgb.com/property-search/?search_type=auction'
WHERE house_slug = 'halls' AND url = 'https://hallsgb.com/auctions';

UPDATE auction_calendar SET url = 'https://www.johnfrancis.co.uk/properties/sales/tag-auction'
WHERE house_slug = 'johnfrancis' AND url = 'https://johnfrancis.co.uk/pages/current_future_auctions';

UPDATE auction_calendar SET url = 'https://onlinesales.walkersingleton.co.uk/'
WHERE house_slug = 'walkersingleton' AND url = 'https://onlinesales.walkersingleton.co.uk/auctions';

UPDATE auction_calendar SET url = 'https://connectukgroup.co.uk/for-sale/'
WHERE house_slug = 'connectuk' AND url = 'https://connectukgroup.co.uk/auctions/real-time/#!/auctions/cb6d24e0-15f6-4a08-be19-7d25dcee682f?ic=48';

UPDATE auction_calendar SET url = 'https://astleys.eigonlineauctions.com/search'
WHERE house_slug = 'astleys' AND url = 'https://astleys.eigonlineauctions.com/search?view=grid#';

UPDATE auction_calendar SET url = 'https://www.bradleys-estate-agents.co.uk/properties/sales/tag-auction'
WHERE house_slug = 'bradleysdevon' AND url = 'https://bradleys-estate-agents.co.uk/pages/auctions';

UPDATE auction_calendar SET url = 'https://www.hobbsparker.co.uk/auctioneers/'
WHERE house_slug = 'hobbsparker' AND url = 'https://hobbsparker.co.uk/auctioneers/auction-dates/?companyid=2';

UPDATE auction_calendar SET url = 'https://www.cheffins.co.uk/property-auctions/'
WHERE house_slug = 'cheffins' AND url = 'https://cheffins.co.uk/property-auctions/catalogue-view,march-2026_576.htm';

-- ─────────────────────────────────────────────────────────────
-- Cohort B: missing calendar entries entirely (2 INSERTs, ~36 lots).
-- These houses have lots but no calendar row at all — auto-discovery missed
-- them. Adding always_on rows so the join works going forward.
-- ─────────────────────────────────────────────────────────────

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'BRG Gibson Dublin', 'brggibsondublin', 'BRG Gibson Dublin (always-on)',
       'https://brggibsondublinauctions.eigonlineauctions.com/search', '2099-12-31', 'always_on'
WHERE NOT EXISTS (SELECT 1 FROM auction_calendar WHERE house_slug = 'brggibsondublin');

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'Ground Rent Auctions', 'groundrentauctions', 'Ground Rent Auctions (always-on)',
       'https://groundrentauctions.eigonlineauctions.com/search', '2099-12-31', 'always_on'
WHERE NOT EXISTS (SELECT 1 FROM auction_calendar WHERE house_slug = 'groundrentauctions');

-- ─────────────────────────────────────────────────────────────
-- Cohort C: sdl umbrella — lots come from 3 different sub-sites all tagged
-- house_slug='sdl'. Calendar today only has sdlauctions.co.uk URLs.
-- 2 INSERTs add the charlesdarrow + btgeddisons URLs as always_on calendar
-- rows still tagged sdl. ~297 lots reconciled (176 + 121).
--
-- Background: the canonicaliser at lib/houses.js detects multiple domains
-- and maps them all to 'sdl'. The scraper produces lots tagged sdl with
-- catalogue_url = the actual source URL. For the (house_slug, url) join to
-- succeed, the calendar needs a row for each source URL.
-- ─────────────────────────────────────────────────────────────

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'SDL Auctions (Charles Darrow)', 'sdl', 'SDL via Charles Darrow (always-on)',
       'https://charlesdarrow.co.uk/auctions', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'sdl' AND url = 'https://charlesdarrow.co.uk/auctions'
);

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'SDL Auctions (BTG Eddisons)', 'sdl', 'SDL via BTG Eddisons (always-on)',
       'https://btgeddisonspropertyauctions.com/properties', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'sdl' AND url = 'https://btgeddisonspropertyauctions.com/properties'
);

-- ─────────────────────────────────────────────────────────────
-- Cohort D: hollismorgan filter strip + bare URL variant.
-- - 1 UPDATE: strip the `&extra_2!=501,502` category filter from the existing
--   row. The scraper isn't applying that filter, so 168 lots have a URL
--   without it. Stripping aligns the calendar to the scraper's live form.
-- - 1 INSERT: add a bare `/search-auction` row so the 70 lots that came in
--   with the simpler URL also resolve. Both rows are always_on for the
--   same conceptual auction; either will be picked up by the writer cache.
-- Total: ~238 lots.
-- ─────────────────────────────────────────────────────────────

UPDATE auction_calendar
SET url = 'https://hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc'
WHERE house_slug = 'hollismorgan'
  AND url = 'https://hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc&extra_2!=501,502';

INSERT INTO auction_calendar (house, house_slug, title, url, date, status)
SELECT 'Hollis Morgan', 'hollismorgan', 'Hollis Morgan (bare search-auction URL)',
       'https://www.hollismorgan.co.uk/search-auction/', '2099-12-31', 'always_on'
WHERE NOT EXISTS (
  SELECT 1 FROM auction_calendar
  WHERE house_slug = 'hollismorgan' AND url = 'https://hollismorgan.co.uk/search-auction'
);
