---
phase: 05-measurement
plan: 01
subsystem: analytics
tags: [umami, analytics, funnel-tracking, activity-events, privacy]

requires:
  - phase: 04-foundation
    provides: logActivityEvent function, signup/signin endpoints, client-side gating
provides:
  - Server-side activity events for signup, signin, deal_stacking, csv_export, bridgematch_open
  - POST /api/track/event lightweight tracking endpoint
  - Umami Cloud script tag on public pages
  - Client-side funnel events (lot_expand, finance_click, form_start)
  - Privacy disclosure for analytics
affects: [05-measurement, admin-dashboard]

tech-stack:
  added: [umami-cloud]
  patterns: [fire-and-forget tracking, window.umami guard pattern, server-side activity events]

key-files:
  created: []
  modified: [server.js, index.html, bridgematch-lite.html, privacy.html]

key-decisions:
  - "Umami script uses empty data-website-id placeholder (user sets via dashboard)"
  - "form_start fires once per session via _bmFormStarted flag to avoid double-counting"
  - "Tracking endpoint does not require auth (anonymous tracking allowed)"

patterns-established:
  - "Guard umami.track with if (window.umami) to handle script load timing"
  - "Fire-and-forget fetch to /api/track/event with .catch(function(){}) for client-only actions"
  - "Allowed action whitelist pattern in tracking endpoint"

requirements-completed: [ANAL-01, ANAL-02, ANAL-03]

duration: 3min
completed: 2026-03-22
---

# Phase 05 Plan 01: Analytics Instrumentation Summary

**Server-side activity events for 5 user actions, Umami Cloud script on public pages, and client-side BridgeMatch funnel tracking with lot context metadata**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T17:17:08Z
- **Completed:** 2026-03-22T17:20:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Wired logActivityEvent calls for signup and signin in POST /api/signup
- Created POST /api/track/event endpoint accepting deal_stacking, csv_export, bridgematch_open (rate-limited, whitelist-validated)
- Added Umami Cloud script tag to index.html and bridgematch-lite.html (not admin.html)
- Added 3 client-side umami.track funnel events: lot_expand, finance_click, form_start -- all with lot context metadata
- Added 3 fetch calls to /api/track/event for csv_export, deal_stacking, bridgematch_open
- Updated privacy.html with Umami analytics disclosure

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire server-side activity events and tracking endpoint** - `106f07f` (feat)
2. **Task 2: Add Umami script tag and client-side funnel events** - `228c0a6` (feat)

## Files Created/Modified
- `server.js` - Added logActivityEvent('signin'), logActivityEvent('signup'), POST /api/track/event endpoint
- `index.html` - Umami script tag, umami.track for lot_expand/finance_click/form_start, fetch calls for csv_export/deal_stacking/bridgematch_open
- `bridgematch-lite.html` - Umami Cloud script tag
- `privacy.html` - Analytics disclosure paragraph about Umami

## Decisions Made
- Umami script tag uses empty data-website-id with TODO comment (user fills in after creating Umami Cloud website)
- form_start event fires in debounceDealStack() with _bmFormStarted flag to fire only once per session
- Tracking endpoint does not require auth -- anonymous tracking allowed, consistent with analysis/smart_search patterns
- data-domains="auctions.bridgematch.co.uk" ensures tracker only fires on production

## Deviations from Plan

None - plan executed exactly as written.

## User Setup Required

External services require manual configuration:
- **UMAMI_WEBSITE_ID**: Create Umami Cloud account at https://cloud.umami.is, add website for auctions.bridgematch.co.uk, copy Website ID into index.html and bridgematch-lite.html data-website-id attribute
- **UMAMI_API_KEY**: From Umami Cloud dashboard Settings -> API Key (for future server-side API access)

## Issues Encountered
None

## Next Phase Readiness
- Analytics data collection layer is in place
- Ready for admin dashboard to visualize MAU counts and funnel data
- Umami script tag needs data-website-id populated after user creates Umami Cloud website

---
*Phase: 05-measurement*
*Completed: 2026-03-22*
