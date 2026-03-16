---
phase: 01-hardening-data-freshness
plan: 03
subsystem: api, ui, extraction
tags: [firecrawl, gemini, markdown, lot-status, server-filtering]

requires:
  - phase: none
    provides: n/a
provides:
  - Firecrawl markdown format for better AI extraction
  - Standardised lot.status field across all extraction pipelines
  - Sold/STC/withdrawn overlay banners on lot cards
  - Server-side future-only filtering with 7-day grace period
  - Shareable URL param for past auction visibility
affects: [01-04, frontend, extraction-pipeline, api-endpoints]

tech-stack:
  added: []
  patterns:
    - "normaliseLotStatuses() centralises status detection from bullets and AI output"
    - "Server-side date filtering with grace period instead of client-side"
    - "Markdown-first AI extraction with HTML fallback"

key-files:
  created: []
  modified:
    - server.js
    - index.html

key-decisions:
  - "Prefer markdown over stripped HTML for Gemini (>200 chars threshold for fallback)"
  - "Status normalisation applied at API response time, not at extraction time, to handle legacy cached data"
  - "7-day grace period for past auctions to avoid hiding recently-ended lots"
  - "Lots with null _auctionDate always included in default view"

patterns-established:
  - "normaliseLotStatuses(): centralised status normalisation from bullets and AI output"
  - "Server-side filtering with client-side re-fetch pattern for show/hide toggles"

requirements-completed: [HARD-07, FRSH-01, FRSH-02, FRSH-03]

duration: 11min
completed: 2026-03-15
---

# Phase 1 Plan 03: Firecrawl Format, Lot Status Pipeline & Future-Only Display Summary

**Markdown-first Gemini extraction, standardised lot.status field with overlay banners, and server-side future-only auction filtering with 7-day grace period**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-15T19:32:52Z
- **Completed:** 2026-03-15T19:43:28Z
- **Tasks:** 7
- **Files modified:** 2 (server.js, index.html)

## Accomplishments
- Firecrawl now returns markdown alongside rawHtml; AI extraction prefers markdown when available for better Gemini results
- Every lot has a normalised `status` field (available/sold/stc/withdrawn) derived from AI extraction or legacy bullet text
- Sold/STC/withdrawn lots display diagonal overlay banners on card images (red/orange/grey)
- Frontend defaults to future-only auctions; past auctions hidden server-side with 7-day grace period
- URL parameter `?showPast=true` is bookmarkable and shareable

## Task Commits

Each task was committed atomically:

1. **Task 01-03-01: Switch Firecrawl default format** - `9ed0f4c` (feat)
2. **Task 01-03-02: Prefer markdown for AI extraction** - `b29e7c9` (feat)
3. **Task 01-03-03: Add lot.status field to pipeline** - `8695d7d` (feat)
4. **Task 01-03-04: Add overlay banners to lot cards** - `5a02c1c` (feat)
5. **Task 01-03-05: Update status filter dropdown** - `16fd0bb` (feat)
6. **Task 01-03-06: Server-side future-only filtering** - `71b989a` (feat)
7. **Task 01-03-07: Frontend future-only with URL params** - `d7f67b9` (feat)

## Files Created/Modified
- `server.js` - Firecrawl markdown format, markdown pass-through, lot.status in AI prompts, normaliseLotStatuses(), server-side date filtering
- `index.html` - Status overlay CSS/HTML, status filter dropdown, fShowPast checkbox, URL param support, removed client-side date filter

## Decisions Made
- Markdown preference threshold set at 200 chars to avoid using empty/minimal markdown
- Status normalisation applied at API response time (not extraction time) so legacy cached data without status fields gets normalised on-the-fly
- DOM extractors left unchanged - they still push 'SOLD/STC' bullets which normaliseLotStatuses() converts to structured status values

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] PDF extraction prompt missing status field**
- **Found during:** Task 3 (lot.status pipeline)
- **Issue:** Plan only mentioned HTML extraction prompt, but PDF extraction has its own prompt template
- **Fix:** Added status field to PDF extraction prompt and lot push
- **Files modified:** server.js
- **Verification:** grep confirms status field in both HTML and PDF prompts
- **Committed in:** 8695d7d

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for completeness - PDF-extracted lots would have lacked status field.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 01-03 complete. Plan 01-04 (admin dashboard, alerting) already has a SUMMARY.
- Phase 1 appears complete with all 4 plans done.

---
*Phase: 01-hardening-data-freshness*
*Completed: 2026-03-15*
