---
phase: quick
plan: 260404-ovd
type: execute
wave: 1
depends_on: []
files_modified:
  - server.js
  - index.html
autonomous: true
requirements: []
must_haves:
  truths:
    - "Back-navigation does not trigger a full image reload or API re-fetch when lots are still fresh"
    - "Scroll position is restored after pressing browser back or clicking the Back button"
    - "The lot grid is not rebuilt unnecessarily when navigating back from an expanded card"
    - "bfcache is not blocked by unload listeners or missing Cache-Control headers"
  artifacts:
    - path: server.js
      provides: "Cache-Control: no-cache header on catch-all route"
    - path: index.html
      provides: "sessionStorage lot cache, renderKey persistence, scroll restoration, grid DOM preservation"
  key_links:
    - from: index.html
      to: sessionStorage
      via: "ab_lots_cache / ab_lots_ts / ab_render_key / ab_scroll_y keys"
      pattern: "sessionStorage\\.setItem.*ab_"
    - from: backToAuctions()
      to: lotsGrid
      via: "grid content check before renderLots()"
      pattern: "lotsGrid.*children|innerHTML.*length"
---

<objective>
Fix image reloading and loss of scroll position on back-navigation.

Purpose: When a user navigates away from the lot grid and comes back (browser back or in-app back button), the page currently re-fetches all lots and re-renders the grid from scratch, causing images to flash/reload and scroll position to be lost. Five targeted fixes address this: bfcache enablement, lot data caching in sessionStorage, renderKey persistence, scroll restoration, and skipping unnecessary DOM rebuilds in backToAuctions().

Output: server.js with no-cache header on catch-all route; index.html with sessionStorage lot cache (10-min TTL), renderKey persistence, scroll save/restore on pageshow, and a DOM-presence check in backToAuctions().
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: bfcache — Add Cache-Control header to catch-all route and audit unload listeners</name>
  <files>server.js, index.html</files>
  <action>
**server.js** — At the catch-all route (app.get('*', ...) around line 14960), add `res.set('Cache-Control', 'no-cache')` immediately before the `res.type('html').send(html)` call. This prevents downstream proxies/CDNs from caching the injected HTML while still allowing bfcache to work in browsers.

**index.html** — Search the entire file for `window.addEventListener('unload'` or `addEventListener("unload"`. If any are found, replace them with `pagehide` equivalents: `window.addEventListener('pagehide', ...)`. The `unload` event disables bfcache in all browsers; `pagehide` fires for both navigation-away AND bfcache restores and is the correct replacement.

Note: if no `unload` listeners exist in index.html, no change is needed for that half of the fix — just confirm the audit result in the summary.
  </action>
  <verify>
    <automated>grep -n "Cache-Control" server.js | grep -i "no-cache" && echo "PASS: no-cache header present" || echo "FAIL: missing no-cache header"</automated>
  </verify>
  <done>catch-all route sends `Cache-Control: no-cache`; no `unload` listeners remain in index.html</done>
</task>

<task type="auto">
  <name>Task 2: sessionStorage — Cache lots, persist renderKey, restore scroll on pageshow</name>
  <files>index.html</files>
  <action>
Make four targeted edits to the JavaScript section of index.html:

**2a — Persist lots after API fetch.**
Locate the section around line 1883 where `ALL_LOTS=d.lots||[]` is assigned (the successful response handler for the `/api/auctions` fetch). After that assignment (and after LOTS is set to ALL_LOTS), add:

```javascript
// Persist lots to sessionStorage for bfcache / back-navigation
try {
  sessionStorage.setItem('ab_lots_cache', JSON.stringify(ALL_LOTS));
  sessionStorage.setItem('ab_lots_ts', Date.now().toString());
} catch(e) { /* quota exceeded — skip */ }
```

**2b — Restore lots from sessionStorage on page init (skip API fetch if fresh).**
Locate the IIFE or init block that triggers the `/api/auctions` fetch on page load (around line 1853). Before the fetch call, add a check:

```javascript
// Restore from sessionStorage cache if less than 10 minutes old
const _cachedTs = parseInt(sessionStorage.getItem('ab_lots_ts') || '0');
const _cachedLots = sessionStorage.getItem('ab_lots_cache');
if (_cachedLots && (Date.now() - _cachedTs) < 600000) {
  try {
    ALL_LOTS = JSON.parse(_cachedLots);
    LOTS = ALL_LOTS;
    $('resultsTitle').textContent = ALL_LOTS.length.toLocaleString() + ' auction lots';
    buildLotFilters();
    renderLots();
    $('cardsView').style.display = 'block';
    $('resultsPanel').style.display = 'block';
    // skip the fetch — fall through past the fetch block
  } catch(e) {
    sessionStorage.removeItem('ab_lots_cache');
  }
}
```

Structure this so the fetch only runs if the sessionStorage branch did NOT succeed (use an `else` or an early-return flag).

**2c — Persist renderKey whenever it is written.**
Locate line ~3413 where `window._lastRenderKey=_renderKey;` is assigned inside `renderLots()`. Immediately after that line add:

```javascript
try { sessionStorage.setItem('ab_render_key', _renderKey); } catch(e) {}
```

Then locate the top of `renderLots()` (or wherever `window._lastRenderKey` is first checked on page load — look for the renderKey deduplication guard around line 3408). Before the first `renderLots()` call is made at startup, restore the key:

```javascript
// Restore renderKey from sessionStorage so the DOM dedup fires on bfcache restore
if (!window._lastRenderKey) {
  window._lastRenderKey = sessionStorage.getItem('ab_render_key') || null;
}
```

Place this restoration just before the `renderLots()` call that follows the sessionStorage lot-restore branch added in 2b.

**2d — Save and restore scroll position.**
Save scroll Y whenever the user opens an expanded card. Locate the function that shows the expanded panel (search for `expandedLotId` assignment or `expandedPanel`). At the point where the expanded card is shown (before/after panel is made visible), add:

```javascript
try { sessionStorage.setItem('ab_scroll_y', window.scrollY.toString()); } catch(e) {}
```

Also add a `pageshow` listener near the bottom of the script (after `DOMContentLoaded` or at document end), to restore scroll after render:

```javascript
window.addEventListener('pageshow', function(e) {
  const savedY = parseInt(sessionStorage.getItem('ab_scroll_y') || '0');
  if (savedY > 0) {
    // Defer slightly so render completes before scroll
    requestAnimationFrame(() => window.scrollTo({ top: savedY, behavior: 'instant' }));
  }
});
```
  </action>
  <verify>
    <automated>grep -n "ab_lots_cache\|ab_lots_ts\|ab_render_key\|ab_scroll_y" index.html | wc -l</automated>
  </verify>
  <done>All four sessionStorage keys (ab_lots_cache, ab_lots_ts, ab_render_key, ab_scroll_y) are written and read in index.html; pageshow listener present for scroll restoration</done>
</task>

<task type="auto">
  <name>Task 3: backToAuctions() — Skip renderLots() if grid already has content</name>
  <files>index.html</files>
  <action>
Locate `backToAuctions()` around line 2109. The current code unconditionally calls `renderLots()` after showing the cards view, which replaces all card HTML and triggers image reloads.

Replace the `renderLots()` call inside `backToAuctions()` with a guard that checks whether the grid already has rendered content:

```javascript
// Only rebuild grid if it is empty (avoids image reload on in-app back)
const _grid = document.getElementById('lotsGrid');
const _gridHasContent = _grid && _grid.children.length > 1;
if (!_gridHasContent) {
  buildLotFilters();
  renderLots();
}
```

The existing `buildLotFilters()` call (line 2122) should stay — move it inside the `if (!_gridHasContent)` block since it only matters before a fresh render.

Also update the scroll call at the end of `backToAuctions()`:

```javascript
// Restore saved scroll or go to top
const _savedY = parseInt(sessionStorage.getItem('ab_scroll_y') || '0');
if (_savedY > 0) {
  requestAnimationFrame(() => window.scrollTo({ top: _savedY, behavior: 'smooth' }));
  sessionStorage.removeItem('ab_scroll_y'); // consumed
} else {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
```

This replaces the existing `window.scrollTo({top:0,behavior:'smooth'})` line.
  </action>
  <verify>
    <automated>grep -n "lotsGrid\|_gridHasContent\|ab_scroll_y" index.html | grep -c "backToAuctions\|_gridHasContent\|ab_scroll_y"</automated>
  </verify>
  <done>backToAuctions() checks grid child count before calling renderLots(); scroll restoration reads ab_scroll_y and clears it after use</done>
</task>

</tasks>

<verification>
Manual smoke test after all three tasks:
1. Load the page fresh — lots load and populate grid normally
2. Open an expanded card (expanded panel shows)
3. Click "Back to auctions" — grid appears without image flash, scroll position near the card you opened
4. Navigate away in the browser and hit Back — bfcache or sessionStorage restores lots without full re-fetch (check Network tab — no `/api/auctions` request on back-navigate if within 10 minutes)
5. Reload the page — sessionStorage cache used if within 10 min, fresh fetch otherwise

Check browser console for any errors from the new sessionStorage code.
</verification>

<success_criteria>
- `Cache-Control: no-cache` present on catch-all route response in server.js
- No `unload` event listeners remain in index.html
- Four sessionStorage keys (ab_lots_cache, ab_lots_ts, ab_render_key, ab_scroll_y) are set and read correctly
- `backToAuctions()` skips `renderLots()` when grid already has content
- scroll position is restored after in-app back navigation
</success_criteria>

<output>
After completion, create `.planning/quick/260404-ovd-fix-image-reloading-on-back-navigation-b/260404-ovd-SUMMARY.md`
</output>
