-- migrations/2026-05-13-reconcile-long-tail-url-drift.sql
--
-- Follow-up C of Move 2: long-tail url-drift batch. After PR #27 took the
-- 4 top url_mismatch houses (paulfosh + 7 more), the residual cohort had
-- a clear long-tail pattern: 10 more houses with stale auction_calendar.url
-- values. Of those, 7 have lots.catalogue_url that already matches the
-- canonical HOUSE_ROOTS form in lib/houses.js — these are mechanical fixes.
-- The remaining 3 (landwood, mccartneys, buttersjohnbee) have lots URLs
-- that DON'T match HOUSE_ROOTS — those need scraper-level investigation
-- and are out of scope here.
--
-- Each new URL below is the HOUSE_ROOTS canonical (which the live scraper
-- already produces, so lots.catalogue_url matches). The normalisation
-- trigger from PR #24 canonicalises each new value on write.
--
-- Expected post-migration: ~311 of the 1,536 remaining NULL lots become
-- joinable. Match rate should lift 88.8% → ~91.1%.

-- 1. robinsonhall: /auctions/upcoming-auctions → /auctions/available-lots
UPDATE auction_calendar
SET url = 'https://robinsonandhallauctions.co.uk/auctions/available-lots/'
WHERE house_slug = 'robinsonhall'
  AND url = 'https://robinsonandhallauctions.co.uk/auctions/upcoming-auctions';

-- 2. pearsons: /auctions → /properties/auctions
UPDATE auction_calendar
SET url = 'https://www.pearsons.com/properties/auctions'
WHERE house_slug = 'pearsons'
  AND url = 'https://pearsons.com/auctions';

-- 3. sharpesauctions: /current-modern-auction.php → /current-traditional-auction.php
UPDATE auction_calendar
SET url = 'https://www.sharpesauctions.co.uk/current-traditional-auction.php'
WHERE house_slug = 'sharpesauctions'
  AND url = 'https://sharpesauctions.co.uk/current-modern-auction.php';

-- 4. kivells: /properties-for-auction → /residential-property/properties-for-auction
UPDATE auction_calendar
SET url = 'https://www.kivells.com/residential-property/properties-for-auction'
WHERE house_slug = 'kivells'
  AND url = 'https://kivells.com/properties-for-auction';

-- 5. auctionhouseteesvalley: bare branch URL → search-results path
UPDATE auction_calendar
SET url = 'https://www.auctionhouse.co.uk/teesvalley/auction/search-results'
WHERE house_slug = 'auctionhouseteesvalley'
  AND url = 'https://auctionhouse.co.uk/teesvalley';

-- 6. higginsdrysdale: strip stale query-string filter
UPDATE auction_calendar
SET url = 'https://higginsdrysdale.eigonlineauctions.com/search'
WHERE house_slug = 'higginsdrysdale'
  AND url = 'https://higginsdrysdale.eigonlineauctions.com/search?order=endingsoonest&page=1&view=grid';

-- 7. auctionhammermidlands: specific-date auction URL → root /auction
UPDATE auction_calendar
SET url = 'https://auctionhammermidlands.co.uk/auction/'
WHERE house_slug = 'auctionhammermidlands'
  AND url = 'https://auctionhammermidlands.co.uk/auction/auction-04-06-2026-1830';
