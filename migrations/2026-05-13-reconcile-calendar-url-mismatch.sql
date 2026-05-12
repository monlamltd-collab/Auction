-- migrations/2026-05-13-reconcile-calendar-url-mismatch.sql
--
-- Follow-up B of Move 2: reconcile the url_mismatch cohort that the initial
-- backfill couldn't resolve. The post-Move-2 audit (66 pipeline_alerts rows,
-- 5,853 lots still at auction_id=NULL) showed that for 8 houses, the
-- `auction_calendar.url` had drifted from the live `lots.catalogue_url`.
-- The canonical URL per house is in `lib/houses.js`'s HOUSE_ROOTS map; the
-- live scrape output matches HOUSE_ROOTS (after normalisation); the stale
-- calendar URL is the divergent one.
--
-- This migration updates `auction_calendar.url` for those 8 houses so the
-- (house_slug, url) join resolves. The trigger from
-- migrations/2026-05-12-normalise-calendar-url.sql normalises each new
-- value (lowercase, strip trailing slash, strip leading www., force https).
--
-- Expected post-migration:
--   - ~5,114 of the 5,853 NULL lots backfill cleanly on the next run
--     of the same backfill SQL used for Move 2.
--   - Remaining ~739 lots are sdl (umbrella house, multi-site issue),
--     hollismorgan (query-string filter mismatch), and a handful of
--     archived-URL lots — out of scope for this migration.
--
-- Safe to re-run: idempotent (UPDATE only touches rows whose url is the
-- listed stale value; nothing breaks if the value's already canonical).

-- 1. paulfosh: /future-auctions → /search
UPDATE auction_calendar
SET url = 'https://paulfosh.eigonlineauctions.com/search'
WHERE house_slug = 'paulfosh'
  AND url = 'https://paulfosh.eigonlineauctions.com/future-auctions';

-- 2. firstforauctions: /search → /search?view=grid
UPDATE auction_calendar
SET url = 'https://online.firstforauctions.co.uk/search?view=Grid'
WHERE house_slug = 'firstforauctions'
  AND url = 'https://online.firstforauctions.co.uk/search';

-- 3. purplebricksgoto: /search → /search?pagesize=48
UPDATE auction_calendar
SET url = 'https://purplebricks.gotoproperties.co.uk/search?pagesize=48'
WHERE house_slug = 'purplebricksgoto'
  AND url = 'https://purplebricks.gotoproperties.co.uk/search';

-- 4. harmanhealy: /future-auctions → /search (touches both always_on and upcoming rows)
UPDATE auction_calendar
SET url = 'https://www.harman-healy.co.uk/search'
WHERE house_slug = 'harmanhealy'
  AND url = 'https://harman-healy.co.uk/future-auctions';

-- 5. pattinson: /auction → /auction/property-search
UPDATE auction_calendar
SET url = 'https://www.pattinson.co.uk/auction/property-search'
WHERE house_slug = 'pattinson'
  AND url = 'https://pattinson.co.uk/auction';

-- 6. ahlondon: ahlondon was upserted under the wrong canonical URL
-- (auctionhouselondon.co.uk/current-auction). Live scrape uses
-- ahlondon.eigonlineauctions.com/search — match HOUSE_ROOTS.
UPDATE auction_calendar
SET url = 'https://ahlondon.eigonlineauctions.com/search'
WHERE house_slug = 'ahlondon'
  AND url = 'https://auctionhouselondon.co.uk/current-auction';

-- 7. futureauctions: stale specific-auction URL → canonical search page
UPDATE auction_calendar
SET url = 'https://www.futurepropertyauctions.co.uk/catalogue_viewall.asp'
WHERE house_slug = 'futureauctions'
  AND url = 'https://futurepropertyauctions.co.uk/catalogue_viewall_auction.asp?id=10675&sortparameter=lotnumber&sortorder=asc';

-- 8. countrywide: full search query → bare domain (matches HOUSE_ROOTS)
UPDATE auction_calendar
SET url = 'https://www.propertyauctionsouthwest.co.uk/'
WHERE house_slug = 'countrywide'
  AND url = 'https://propertyauctionsouthwest.co.uk/properties/listview/?section=auction&auctionperiod=current';
