---
phase: 01-hardening-data-freshness
plan: 04
subsystem: pipeline, admin
tags: [alerting, metrics, supabase, admin-dashboard]

requires:
  - phase: 01-hardening-data-freshness
    provides: house_skills table, autoAnalyseOne, discoverAndUpdateCalendar
provides:
  - pipeline_alerts table and alert generation on failures/regressions
  - per-scrape diff summaries stored in house_skills.last_diff
  - /api/admin/alerts and /api/admin/freshness endpoints
  - admin dashboard alerts feed and house health table
affects: [admin-dashboard, pipeline-monitoring]

tech-stack:
  added: []
  patterns: [pipeline-alerting, auto-resolve-on-success, scrape-diff-tracking]

key-files:
  created: []
  modified:
    - schema.sql
    - server.js
    - admin.html

key-decisions:
  - "Alert auto-resolution: successful scrape clears all unresolved alerts for that house"
  - "Consecutive miss tracking uses function-scoped counter (in-memory, resets on restart)"
  - "Image coverage drop threshold: alert when coverage drops below 50% from above 50%, only for houses with >5 lots"

requirements-completed: [FRSH-04, FRSH-05]

duration: 7min
completed: 2026-03-15
---

# Plan 01-04: Admin Alerting & Data Freshness Metrics Summary

**Pipeline alerting system with 4 event types, auto-resolve on success, per-scrape diff summaries, and admin dashboard alerts feed with sortable house health table**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-15T19:34:33Z
- **Completed:** 2026-03-15T19:42:12Z
- **Tasks:** 11
- **Files modified:** 3

## Accomplishments
- Pipeline alerts table with 4 event types (auto_analyse_failure, extractor_regression, discovery_miss, image_coverage_drop)
- Alert generation hooks in autoAnalyseOne (failure + regression + auto-resolve) and discoverAndUpdateCalendar (errors + consecutive misses)
- Per-scrape diff computation comparing old vs new lots (added/removed/changed, images gained/lost)
- Two new admin API endpoints (/api/admin/alerts, /api/admin/freshness) with x-admin-secret auth
- Admin dashboard alerts feed with severity indicators and sortable house health table

## Task Commits

Each task was committed atomically:

1. **Task 01: Create pipeline_alerts table** - `ac9ca3f` (feat)
2. **Task 02: Add last_diff column to house_skills** - `04a81f3` (feat)
3. **Task 03: Alert hooks in autoAnalyseOne** - `8300458` (feat)
4. **Task 04: Alert hooks in discoverAndUpdateCalendar** - `013fc8f` (feat)
5. **Task 05: Image coverage drop detection** - `117ea65` (feat)
6. **Task 06: Per-scrape diff summaries** - `3e15903` (feat)
7. **Tasks 07+08: Admin alerts and freshness endpoints** - `ceb4526` (feat)
8. **Tasks 09+10+11: Admin dashboard UI** - `7dca45e` (feat)

## Files Created/Modified
- `schema.sql` - Added pipeline_alerts table, last_diff column, RLS policies
- `server.js` - Alert generation hooks, computeScrapeDiff(), /api/admin/alerts, /api/admin/freshness endpoints
- `admin.html` - Alerts feed section, house health table, CSS, JS functions wired into refreshAll

## Decisions Made
- Alert auto-resolution: successful scrape clears all unresolved alerts for that house
- Consecutive discovery miss tracking uses function-scoped counter (in-memory, resets on restart) -- lightweight and sufficient since discovery runs are infrequent
- Image coverage drop threshold: 50% boundary with >5 lot minimum to avoid false positives on small catalogues
- Combined tasks 07+08 and 09+10+11 into single commits due to tight coupling (coarse granularity per config)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added alert count badge to alerts section header**
- **Found during:** Task 09 (Alerts feed UI)
- **Issue:** Plan didn't specify an active alert count indicator
- **Fix:** Added a badge showing "N active" (red) or "All clear" (green) in the section header
- **Files modified:** admin.html
- **Verification:** Badge renders correctly in alert section
- **Committed in:** `7dca45e`

**2. [Rule 3 - Blocking] Wrapped autoAnalyseOne in try/catch for failure alerts**
- **Found during:** Task 03 (Alert generation hooks)
- **Issue:** Function body wasn't in a try/catch, needed to catch unhandled errors to generate auto_analyse_failure alerts
- **Fix:** Added try block after house detection, catch block at end to generate alert on any unhandled error
- **Files modified:** server.js
- **Committed in:** `8300458`

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both essential for the alerting system to function correctly. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. The pipeline_alerts table needs to be created in Supabase (run the SQL from schema.sql), and the last_diff column needs to be added to house_skills (ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS last_diff JSONB).

## Next Phase Readiness
- Phase 1 complete: all 4 plans executed
- Pipeline alerting, data freshness metrics, and admin dashboard enhancements are all in place
- Ready for phase transition

---
*Phase: 01-hardening-data-freshness*
*Completed: 2026-03-15*
