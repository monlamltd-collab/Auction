---
plan: "06-03"
phase: "06-ai-scraping-hardening"
status: checkpoint
started: 2026-03-23
completed: 2026-03-23
---

# Plan 06-03: Admin System Health Tab — Summary

## What was built

Added a new "System Health" tab to admin.html with 4 sections providing at-a-glance operational status:

1. **Broken Extractors** — Red alert cards for disabled extractors with diagnostic hints and "Re-enable" buttons. Green "All extractors healthy" when none broken.
2. **AI Costs** — Daily spend display with budget progress bar (green → yellow at 75% → red at 100%), per-model breakdown table, over-budget warning banner.
3. **Coverage Grid** — House-by-house cards showing lot count, image coverage %, and status. Stale/inactive houses collapsed into `<details>/<summary>` expandable summary.
4. **Pipeline Health** — Status cards for Firecrawl (credit usage), Gemini/AI Provider, Puppeteer availability, and Auto-Analyse state showing "Idle" or "Running" (fixes perpetual "analysing" bug).

Added consolidated `GET /api/admin/system-health` endpoint that gathers data from BROKEN_EXTRACTORS set, getAICostSummary(), Supabase cached_analyses, and in-memory pipeline flags.

## Key files

### Created
- (none — modifications only)

### Modified
- `admin.html` — System Health tab button, pane with 4 sections, loadSystemHealth() function, CSS styles
- `server.js` — GET /api/admin/system-health consolidated endpoint

## Decisions
- Used native `<details>/<summary>` for stale house collapse (per project convention)
- Lazy-load health data on tab switch (not page load)
- Auto-analyse shows actual state from API, not CSS-driven animation

## Checkpoint
**Status:** Awaiting human verification of admin dashboard UI

## Self-Check: PASSED
- [x] tab-health button and pane exist in admin.html
- [x] /api/admin/system-health endpoint exists in server.js
- [x] All 4 sections rendered (Broken Extractors, AI Costs, Coverage, Pipeline Health)
- [x] loadSystemHealth() lazy-loads on tab switch
