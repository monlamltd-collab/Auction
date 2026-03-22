---
phase: 06-ai-scraping-hardening
plan: 02
subsystem: scraping, api
tags: [audit, jsdom, extractors, gemini-fallback, eig-platform, auctionhouse-uk]

# Dependency graph
requires:
  - phase: 04-foundation
    provides: DOM extractors, HOUSE_ROOTS, autoAnalyseOne pipeline
provides:
  - Lot-count cross-validation in audit.mjs
  - Per-house image coverage reporting with 90% target
  - BROKEN_EXTRACTORS runtime set with Supabase persistence
  - Admin API for enabling/disabling broken extractors
  - 7 new auction houses using shared extractor templates
affects: [scraping-pipeline, admin-dashboard, house-recruitment]

# Tech tracking
tech-stack:
  added: []
  patterns: [broken-extractor-auto-disable, lot-count-cross-validation, image-coverage-audit]

key-files:
  created: []
  modified:
    - scripts/audit.mjs
    - server.js

key-decisions:
  - "Used house_skills.status='broken' in Supabase to persist broken extractors across restarts"
  - "30% tolerance for lot-count mismatch (WARNING), 100% for BROKEN severity"
  - "Added 5 AH UK branches + 2 EIG houses (7 total) using shared extractors only"
  - "BROKEN_EXTRACTORS check in extractWithJSDOM returns null to trigger Gemini AI fallback"

patterns-established:
  - "Broken extractor pattern: BROKEN_EXTRACTORS Set checked before DOM extraction, admin API to manage"
  - "Audit validation pattern: lot-count cross-validation + image coverage as separate audit phases"

requirements-completed: [SCRP-01, SCRP-02, SCRP-03]

# Metrics
duration: 13min
completed: 2026-03-22
---

# Phase 06 Plan 02: AI & Scraping Hardening Summary

**Lot-count cross-validation, image coverage audit with 90% target, BROKEN_EXTRACTORS auto-disable with Gemini fallback, and 7 new auction houses via shared templates**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-22T23:44:46Z
- **Completed:** 2026-03-22T23:57:24Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Audit script now cross-validates scraped lot counts against house-advertised counts with 30%/100% tolerance thresholds
- Image coverage measured per-house from production API data with 90% target; below-target houses flagged
- BROKEN_EXTRACTORS mechanism auto-disables extractors (skips DOM, falls through to Gemini AI), persisted via Supabase house_skills table
- Admin API endpoints (GET/POST /api/admin/broken-extractors) for manual enable/disable with pipeline alerts
- 7 new auction houses added: AH Devon & Cornwall, AH East Midlands, AH West Midlands, AH Essex, AH Manchester, Roman Way (EIG), Hammer Price (EIG)
- Total house count: 69 (up from 62)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend audit.mjs with lot-count cross-validation and image coverage** - `96ae080` (feat)
2. **Task 2: Add auto-disable mechanism and recruit new houses** - `146dcfa` (feat)

**Note:** Some server.js changes from Task 2 were captured in a concurrent 06-01 commit (`6d779d0`) due to parallel execution. All changes are present in the final state.

## Files Created/Modified
- `scripts/audit.mjs` - Added lot-count cross-validation (Phase 6), image coverage analysis (Phase 7), --validate and --auto-disable flags, autoDisableBrokenHouses function, JSON output includes lotCountValidation and imageCoverage
- `server.js` - Added BROKEN_EXTRACTORS Set with Supabase startup loading, GET/POST /api/admin/broken-extractors endpoints, extractWithJSDOM skip check, 7 new houses in HOUSE_ROOTS/HOUSE_DISPLAY_NAMES/HOUSE_EXTRACTION_HINTS/DOM_EXTRACTORS wiring/detectAuctionHouse/rewriteUrl/CACHE_TIERS

## Decisions Made
- Used existing house_skills table status='broken' for persistence rather than creating a new table
- 30% tolerance for lot-count WARNING, 100% for BROKEN (accounts for pagination/timing differences)
- Only added houses using existing shared extractors (EIG platform, AH UK template) to avoid untested custom extractors
- BROKEN_EXTRACTORS check returns null from extractWithJSDOM, which triggers Gemini fallback via existing < 3 lots threshold

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Concurrent execution with 06-01 plan caused some server.js changes to be captured in the wrong commit. All changes are present in the final repository state.
- Windows /dev/stdin not available for piped JSON verification -- used temp file approach instead.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Audit script ready for routine lot-count validation via --validate flag
- Auto-disable mechanism ready for production use
- New houses will be automatically scraped on next autoAnalyseAll cycle
- Consider running `node scripts/audit.mjs --auto-disable` after deployment to auto-disable any currently broken extractors

---
*Phase: 06-ai-scraping-hardening*
*Completed: 2026-03-22*
