---
phase: quick
plan: 260404-ovd
subsystem: frontend
tags: [performance, ux, bfcache, sessionStorage, navigation]
dependency_graph:
  requires: []
  provides: [bfcache-enabled-catch-all, sessionStorage-lot-cache, scroll-restoration]
  affects: [index.html, server.js]
tech_stack:
  added: []
  patterns: [sessionStorage-cache, bfcache-friendly-headers, pageshow-listener]
key_files:
  created: []
  modified:
    - server.js
    - index.html
decisions:
  - loadAllLots() returns early from sessionStorage branch — no skeleton cards shown on cache hit (intentional: instant restore is better UX than showing skeletons)
  - renderKey is restored from sessionStorage before renderLots() is called in cache-restore path, so the dedup guard fires correctly on same-key renders
  - pageshow listener is added inside the tour/boot IIFE to keep it scoped alongside other lifecycle handlers
metrics:
  duration: 162s
  completed_date: "2026-04-04T17:00:55Z"
  tasks_completed: 3
  files_modified: 2
---

# Quick Task 260404-ovd: Fix Image Reloading on Back Navigation Summary

**One-liner:** Five-point bfcache fix — Cache-Control header, 10-min sessionStorage lot cache with renderKey dedup, scroll save on card open, and DOM-presence guard in backToAuctions() to prevent image flicker on back-navigation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | bfcache: Cache-Control header + unload audit | 6c25cca | server.js |
| 2 | sessionStorage: lot cache, renderKey persist, scroll restore | 3a42ee7 | index.html |
| 3 | backToAuctions(): skip renderLots if grid has content | fa26702 | index.html |

## What Was Built

### Task 1 — Cache-Control header (server.js)

Added `res.set('Cache-Control', 'no-cache')` to the catch-all route before `res.type('html').send(html)`. This prevents CDN/proxy caching of the server-injected HTML (which contains Supabase config) while preserving browser bfcache eligibility.

Audited index.html for `unload` event listeners — none found. No change needed for that half of the fix.

### Task 2 — sessionStorage lot cache (index.html)

Four targeted edits:

- **2a:** After `ALL_LOTS=d.lots||[]` in the successful API response handler, persist lots to `ab_lots_cache` + `ab_lots_ts` (ISO epoch) in sessionStorage with quota-exceeded guard.
- **2b:** At the top of `loadAllLots()`, check sessionStorage before issuing the fetch. If cache exists and is less than 10 minutes old, restore `ALL_LOTS`/`LOTS`, restore `_lastRenderKey` from `ab_render_key`, render the grid, and return early (skipping the API call entirely).
- **2c:** After `window._lastRenderKey=_renderKey` in `renderLots()`, persist the key to `ab_render_key` in sessionStorage so the DOM dedup guard fires correctly on bfcache restores.
- **2d:** Save `window.scrollY` to `ab_scroll_y` when an expanded card is opened (`expandedLotId = lot._idx`). Added `pageshow` listener that reads `ab_scroll_y` and uses `requestAnimationFrame(() => scrollTo(...))` to defer until render is complete.

### Task 3 — backToAuctions() DOM guard (index.html)

Replaced unconditional `buildLotFilters(); renderLots();` in `backToAuctions()` with a guard:

```javascript
const _grid = document.getElementById('lotsGrid');
const _gridHasContent = _grid && _grid.children.length > 1;
if (!_gridHasContent) {
  buildLotFilters();
  renderLots();
}
```

Replaced the unconditional `window.scrollTo({top:0})` with scroll restore from `ab_scroll_y` (consumed and removed after use), falling back to scroll-to-top if no saved position.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All sessionStorage keys are wired to real data sources and read/write correctly.

## Self-Check: PASSED

- server.js modified: confirmed (`grep -n "Cache-Control" server.js | grep no-cache` returns line 14971)
- index.html modified: confirmed (9 sessionStorage key references across all 4 keys)
- Commits exist: 6c25cca, 3a42ee7, fa26702 — all verified in git log
