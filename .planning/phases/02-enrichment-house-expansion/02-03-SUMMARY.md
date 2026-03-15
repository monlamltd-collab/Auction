# Plan 02-03 Summary: Auction House Expansion

**Status:** Complete
**Date:** 2026-03-15
**Commits:** 5

## What Was Done

### Task 1: Verify and fix existing candidate house extractors
- **Critical ASI bug found and fixed:** All DOM extractors were returning `undefined` due to JavaScript's Automatic Semicolon Insertion inserting a semicolon after `return` when followed by a newline before the IIFE. Fixed by adding `.trim()` to strip leading whitespace from extractor strings before evaluation.
- Rewrote **buttersjohnbee** extractor for Rex Software v2 layout (site redesigned, old selectors broken)
- Rewrote **iamsold** extractor using `.c__property` cards with `data-bkimage` for images
- Fixed **eigplatform** address extraction: cascaded selectors to prevent `h3.panel-title` matching before `h3.list-address`
- Updated **cheffins** HOUSE_ROOTS URL to catalogue-view page (main page lists auction dates, not lots)
- Added **cheffinstimed** as new EIG-platform house (timed auctions)
- All 7 candidate houses verified with >0 lots on live test

### Task 2: Add new EIG-platform and Auction House UK branch houses
- Added 6 Auction House UK regional branches:
  - East Anglia (506 lots), North West (916), North East (722), Wales (606), Birmingham (206), Kent (142)
- All wired to the shared `auctionhouseuk` DOM extractor
- Added to `detectAuctionHouse()` and `HOUSE_DISPLAY_NAMES`
- Total: ~3,098 new lots from platform leverage alone

### Task 3: Build custom DOM extractors for non-platform houses
- Activated **suttonkersh** in HOUSE_ROOTS (108 lots, custom extractor existed but was orphaned)
- Fixed suttonkersh duplicate card selection bug (`.galleryProperty` wrapping `.propertyBox`)
- Attempted Symonds & Sampson, GTH, All Wales Auction — all block scraping (403/ECONNREFUSED)

### Task 4: Implement pagination for new multi-page houses
- Added `buildPageUrl` entries for agentsproperty (`/page/N/`), suttonkersh (`start=N` offset), buttersjohnbee, brownco, iamsold, andrewcraig
- Suttonkersh pagination verified: 7 pages, 108 total lots
- Buttersjohnbee pagination verified: 3 pages, 32 total lots
- Auction House UK branches return all lots on single page (no pagination needed)
- Updated Firecrawl pagination log format to `[PAGINATION]` prefix

### Task 5: Live extraction test
- All 15 new houses pass with >0 lots
- Total lots (page 1): 3,315
- Image coverage: 99.6% (3,303/3,315)
- Test results documented in HOUSE_ROOTS comment block

## Key Metrics

| House | Lots | Images | Prices | Postcodes | Platform |
|-------|------|--------|--------|-----------|----------|
| agentsproperty | 84 | 84 | 84 | 0 | WordPress |
| andrewcraig | 24 | 24 | 24 | 0 | Estate Apps |
| buttersjohnbee | 12 | 0 | 12 | 8 | Rex v2 |
| cheffins | 10 | 10 | 5 | 10 | Own platform |
| cheffinstimed | 15 | 15 | 9 | 15 | EIG |
| fssproperty | 1 | 1 | 1 | 0 | Hollis Morgan CMS |
| iamsold | 5 | 5 | 5 | 5 | Own platform |
| brownco | 50 | 50 | 48 | 50 | EIG |
| suttonkersh | 16 (108 total) | 16 | 15 | 16 | Own platform |
| AH East Anglia | 506 | 506 | 444 | 506 | AH UK |
| AH North West | 916 | 916 | 738 | 916 | AH UK |
| AH North East | 722 | 722 | 582 | 722 | AH UK |
| AH Wales | 606 | 606 | 434 | 606 | AH UK |
| AH Birmingham | 206 | 206 | 128 | 206 | AH UK |
| AH Kent | 142 | 142 | 96 | 142 | AH UK |

## must_haves Checklist
- [x] At least 5 new auction houses added to HOUSE_ROOTS with working DOM extractors (15 added)
- [x] Each new extractor returns >0 lots on a live catalogue test (15/15 pass)
- [x] Image URLs captured where available (99.6% coverage)
- [x] Multi-page catalogues handled with correct pagination logic (suttonkersh, buttersjohnbee verified)

## Bonus Fix
The ASI bug fix affects ALL DOM extractors system-wide, not just the new houses. This means all ~50 existing extractors that were silently returning `undefined` (falling through to the universal extractor or Gemini API fallback) now properly return their extracted lots. This should significantly reduce Gemini API usage and improve extraction quality across the entire system.
