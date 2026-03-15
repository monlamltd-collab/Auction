---
phase: 2
plan: 2
title: "Image Coverage Improvement & Missing Image Admin Tooling"
status: complete
completed_at: "2026-03-15"
---

# Plan 02-02 Summary: Image Coverage Improvement & Missing Image Admin Tooling

## Completed Tasks

### Task 02-02-01: Audit and fix DOM extractor image selectors
- Added `IMG_HELPERS` module with 5 helper functions: `getBestImgSrc()`, `getBackgroundImageUrl()`, `upgradeThumbnailUrl()`, `isJunkImage()`, `extractCardImage()`
- Injected helpers into all DOM extractor execution contexts via `extractWithJSDOM()` and universal extractor
- Updated 10+ extractors (acuitus, auctionhouse, knightfrank, pattinson, bidx1, philliparnold, connectuk, auctionestates, loveitts, strettons) to use `extractCardImage()` with full lazy-load fallback chain
- Fallback chain: `data-src` -> `data-lazy-src` -> `data-original` -> `src` -> `srcset` -> background-image
- Added thumbnail URL upgrading: `/thumb/` -> `/large/`, `_thumb.` -> `.`, `w=100` -> `w=800`
- Added `nav`/`sprite` to junk image filter

### Task 02-02-02: Enhance Firecrawl image extraction with structured output
- Updated Firecrawl formats to `['markdown', 'rawHtml', 'images']`
- Added `[IMG]` logging line after extraction + Firecrawl merge showing per-house coverage
- Capped `backfillImagesFromLotPages()` at 50 lot pages per run with 500ms inter-batch delay
- Added `data-original` attribute to lot page image regex
- Confirmed `backfillImagesFromLotPages()` already runs for ALL houses (not hardcoded subset)
- Confirmed `PUPPETEER_IMAGE_HOUSES` is initialized from all `HOUSE_ROOTS` keys

### Task 02-02-03: Add missing-image lots admin API endpoint
- Added `GET /api/admin/missing-images` endpoint protected by `x-admin-secret` auth
- Query params: `house` (optional filter), `limit` (default 100, max 500), `offset` (pagination)
- Queries `cached_analyses` for non-expired catalogues, iterates JSONB lots array
- Returns: `{ total, houses, houseCounts, offset, limit, results: [{ house, lotNumber, address, catalogueUrl, auctionDate }] }`

### Task 02-02-04: Add missing-image dashboard UI in admin.html
- New "Missing Images" section with:
  - House filter dropdown (auto-populated from data)
  - Table: House, Lot #, Address, Catalogue URL (clickable), Auction Date
  - Badge showing total missing lots (color-coded: green/amber/red)
  - Overall image coverage percentage (weighted by lot count)
  - Summary text: "X lots missing images across Y houses"
  - Refresh button
- Integrated into `refreshAll()` auto-refresh cycle
- Uses existing admin.html dark theme styling patterns

### Task 02-02-05: Create test files
- `tests/test-image-coverage.js`: 7 test cases covering standard 80%, 100%, 0%, empty array, null/undefined imageUrl, weighted multi-house coverage, house_skills format match
- `tests/test-missing-images-endpoint.js`: 4 tests covering response shape validation, house filter logic, auth requirement (live when server running), pagination logic
- Both files use ES module imports (`import assert from 'assert'`)

## Files Modified
- `server.js` — IMG_HELPERS, extractor updates, Firecrawl format, missing-images endpoint, backfill caps
- `admin.html` — Missing Images dashboard section + loadMissingImages() function
- `tests/test-image-coverage.js` — New file
- `tests/test-missing-images-endpoint.js` — New file

## Verification Results
- All 5 automated verify steps passed
- All test files execute successfully (14 total test cases)
