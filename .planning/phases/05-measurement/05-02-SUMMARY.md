---
phase: 05-measurement
plan: 02
subsystem: api, ui
tags: [umami, analytics, admin-dashboard, funnel, mau]

# Dependency graph
requires:
  - phase: 05-measurement-01
    provides: "Activity event tracking (activity_events table, /api/track/event endpoint, Umami script tag)"
provides:
  - "Enhanced /api/admin/analytics returning Umami stats, referrers, and activity events"
  - "MAU hero metric on admin Analytics tab"
  - "BridgeMatch funnel visualization (lot views -> finance clicks -> form starts -> submissions)"
  - "Top search queries and referral sources tables"
  - "Engagement metrics cards (bounce rate, page views, visits, signups)"
affects: [admin-dashboard, analytics]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Umami Cloud API proxy (server-side, API key never exposed to client)", "Parallel API fetching with graceful degradation"]

key-files:
  created: []
  modified: [server.js, admin.html]

key-decisions:
  - "Umami API proxied server-side to keep API key secret"
  - "Client-side funnel steps (lot views, finance clicks) reference Umami dashboard rather than duplicating API calls"
  - "detail field parsed defensively (may be string or object depending on Supabase storage)"

patterns-established:
  - "fetchUmamiStats/fetchUmamiMetrics: reusable Umami API helpers returning null/[] on failure"
  - "Parallel Promise.all for analytics queries with graceful degradation per data source"

requirements-completed: [ANAL-04]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 5 Plan 2: Admin Analytics Dashboard Summary

**Admin analytics dashboard with MAU hero metric, BridgeMatch funnel, engagement cards, search queries, and referral sources -- all from Umami API and Supabase activity_events**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T17:23:16Z
- **Completed:** 2026-03-22T17:25:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Enhanced /api/admin/analytics to return Umami stats, referral sources, and activity events alongside existing snapshots
- Added MAU as hero metric (big number, front-and-centre) on admin Analytics tab
- Built BridgeMatch funnel visualization with 4 steps showing conversion flow
- Added engagement metrics (bounce rate, page views, visits, signups) and data tables (top searches, referral sources)

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhance admin analytics API endpoint** - `4c9e767` (feat)
2. **Task 2: Build admin analytics dashboard UI** - `f2f37eb` (feat)

## Files Created/Modified
- `server.js` - Added fetchUmamiStats/fetchUmamiMetrics helpers, enhanced /api/admin/analytics to return { snapshots, umami, referrers, events }
- `admin.html` - Added MAU hero, BridgeMatch funnel, engagement cards, top searches table, referral sources table, and JS to populate all from API response

## Decisions Made
- Umami API proxied server-side (API key stays in env vars, never exposed to frontend)
- Client-side funnel steps (lot_expand, finance_click) show "See Umami dashboard" since those are Umami custom events not stored in activity_events
- detail field parsed defensively with try/catch JSON.parse fallback since Supabase may store as string or JSONB

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Defensive Umami stats value access**
- **Found during:** Task 2
- **Issue:** Umami API may return `{ visitors: {value: N} }` or `{ visitors: N }` depending on version
- **Fix:** Used `umami.visitors.value || umami.visitors` pattern with nullish coalescing
- **Files modified:** admin.html
- **Committed in:** f2f37eb

**2. [Rule 1 - Bug] Defensive detail field parsing**
- **Found during:** Task 2
- **Issue:** activity_events detail field may be stored as JSON string or object depending on Supabase column type
- **Fix:** Added try/catch JSON.parse wrapper when detail is a string
- **Files modified:** admin.html
- **Committed in:** f2f37eb

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for runtime correctness with varying API responses. No scope creep.

## Issues Encountered
None

## User Setup Required
None - Umami env vars (UMAMI_WEBSITE_ID, UMAMI_API_KEY) are optional. Dashboard degrades gracefully when not configured.

## Next Phase Readiness
- Analytics dashboard complete with MAU hero and funnel metrics
- Phase 05 (Measurement) fully complete
- Ready for next milestone phase

---
*Phase: 05-measurement*
*Completed: 2026-03-22*
