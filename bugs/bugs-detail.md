# BridgeMatch Bug Log — Detail Pages Agent
Started: Sat Mar 14 03:13:46 GMTST 2026

## BUG 1
**File:** index.html:2565-2579
**Area:** Expanded Panel / State Management
**Severity:** Low
**Description:** When user expands card A, then clicks card B, the `.expanded` CSS class is never removed from card A. Line 2568 removes the panel DOM element, but only line 2575 removes the `expanded` class — and that branch only fires when the *same* card is clicked again (toggle-off). So switching from A→B leaves card A with a stale `expanded` class. Currently no CSS rule targets `.lot-card.expanded`, so this has no visual effect, but it's a latent bug: if any CSS or JS ever uses that class, it will produce incorrect behaviour (multiple cards appearing "expanded").
**Reproduction steps:** Click lot card A (it expands). Click lot card B. Inspect card A in DevTools — it still has class `expanded`.
**Suggested fix:** Before `expandedLotId = lot._idx` on line 2578, add: `document.querySelectorAll('.lot-card.expanded').forEach(el => el.classList.remove('expanded'));`
---

## BUG 2
**File:** index.html:2583
**Area:** Image Gallery / Expanded Panel
**Severity:** Medium
**Description:** The expanded panel image (`exp-large-img`) has no `onerror` or `onload` fallback handler. If the `imageUrl` is set but points to a broken/404 URL, the expanded panel will show a broken image icon. By contrast, the card-level image (line 2542-2543) has proper `onerror` and `onload` handlers that replace broken images with the property-type placeholder. This inconsistency means a lot whose card correctly shows a placeholder could show a broken image when expanded.
**Reproduction steps:** Find a lot with a broken `imageUrl` (or temporarily set one in dev tools). Click to expand — the expanded panel shows the browser's broken image icon instead of the placeholder.
**Suggested fix:** Add `onerror="this.outerHTML=getPlaceholderHtml('${lot.propType}')"` to the `exp-large-img` element, matching the card image behaviour. Also consider an `onload` check for tiny images like the card does.
---

## BUG 3
**File:** index.html:2515-2517
**Area:** Score Badge / Null Handling
**Severity:** Medium
**Description:** If `lot.score` is `null` or `undefined`, the score badge will display `undefined` or `null` as text. Line 2515 compares `lot.score >= 3` which is `false` for null/undefined (falling through to `'low'`), and line 2516 checks `lot.score > 0` which is also `false`, resulting in no sign prefix — but line 2517 concatenates `lot.score` directly into the HTML string, producing `<div class="card-badge badge-score low">undefined</div>`. This can actually happen in production: the `stripAIFields()` function (server.js:951) sets `score: null` for blurred lots beyond the free preview limit.
**Reproduction steps:** Load the page as a non-logged-in user. Scroll past the free preview lots — lots with `score: null` (blurred) will show "null" in the score badge.
**Suggested fix:** Default to 0: `const rawScore = lot.score ?? 0;` and use `rawScore` throughout the function.
---

## BUG 4
**File:** index.html:2637
**Area:** Finance Widget / parseInt Edge Case
**Severity:** Low
**Description:** `parseInt(document.getElementById('ltv-slider-' + idx)?.value || 70)` has operator precedence issue. If the slider element exists but has a falsy value (e.g., "0"), the `||` operator will skip it and use 70. More critically, if `?.value` returns `undefined`, the expression evaluates `parseInt(undefined || 70)` → `parseInt(70)` which works, but relies on parseInt accepting a number. Additionally, the `parseInt` call lacks a radix parameter.
**Reproduction steps:** Edge case — unlikely to trigger with current slider config (min=50), but the pattern is fragile.
**Suggested fix:** Use `Number(...)` or add radix: `parseInt(..., 10)`, and use `?? 70` instead of `|| 70` for correct nullish coalescing.
---

## BUG 5
**File:** index.html:2631-2671
**Area:** Finance Widget / Race Condition
**Severity:** Medium
**Description:** The `_financeDebounce` is a single global variable shared across all lots. If user clicks "Check finance" on lot A, then quickly expands lot B and clicks "Check finance" on lot B, the `clearTimeout` on line 2633 correctly cancels lot A's pending request. However, line 2641 has *already* set lot A's results element to the "Checking lenders" loading state, and that loading spinner will remain forever (the timeout that would have updated it was cancelled, and the new timeout writes to lot B's results element). The loading state on lot A's panel is orphaned.
**Reproduction steps:** Expand lot A, click "Check finance". Within 400ms, expand lot B and click "Check finance". Lot A's finance results area (if panel is re-opened) would show a perpetual loading spinner.
**Suggested fix:** Move the loading indicator update inside the `setTimeout` callback, or clear the previous lot's loading state when cancelling.
---

## ~~BUG 6~~ FALSE POSITIVE — RETRACTED
**Note:** Previous sweep reported that `/check` route doesn't exist. It DOES exist at server.js:2839, serving `bridgematch-lite.html`. However, see new BUG 11 below for a related issue with query parameter handling.
---

## BUG 7
**File:** index.html:2598-2620
**Area:** Expanded Panel / Missing Key Information
**Severity:** Medium
**Description:** The expanded detail panel does not display several important lot fields that are available in the data: auction date, auction house name, lot number, address, tenure, beds, sqft, condition, estimated yield, estimated rent, street average price, or the direct listing URL. The panel only shows: image, AI analysis text, opportunity/risk signals, finance widget, and bullet points. Key property details that are shown on the card (lot number, address, price, property type, beds, tenure) are not repeated in the expanded view — the user must look at the card above to see them. The listing URL is particularly problematic as it's only available on the card footer, which may be visually separated from the expanded panel.
**Reproduction steps:** Expand any lot card. Note that the expanded panel has no address, lot number, auction date, yield data, or link to the actual listing.
**Suggested fix:** Add a header section to the expanded panel with key lot details (address, lot number, auction house, date) and include the listing URL as a prominent link.
---

## BUG 8
**File:** index.html:2583
**Area:** Expanded Panel Image / Accessibility
**Severity:** Low
**Description:** The expanded panel image uses `esc(lot.address)` for the alt attribute. If `lot.address` is null/undefined, `esc(null)` returns empty string `''`, resulting in `alt=""` — an empty alt attribute. Screen readers will announce the image with no description. The card image (line 2541) handles this with a fallback: `lot.address || 'Auction property'`.
**Reproduction steps:** Find or create a lot with null address. Expand it. The expanded image has `alt=""` instead of a meaningful fallback.
**Suggested fix:** Use the same fallback pattern: `esc(lot.address || 'Auction property')`.
---

## BUG 9
**File:** index.html:2649
**Area:** Finance Widget / Mixed Content & CORS
**Severity:** Medium
**Description:** The finance check makes a `fetch` call to `https://www.bridgematch.co.uk/api/filter`. If the auction site is served from a different domain or subdomain (e.g., `auctions.bridgematch.co.uk`), this will be a cross-origin request that requires CORS headers on the BridgeMatch API. If CORS is not configured, the finance check will silently fail and show "Unable to check finance — try again later". The error message gives no indication that it's a CORS issue.
**Reproduction steps:** Access the auction tool from any domain other than `www.bridgematch.co.uk`. Try the finance check — it may fail due to CORS.
**Suggested fix:** Ensure the BridgeMatch API at `/api/filter` has appropriate CORS headers, or proxy the finance check through the auction server's own API to avoid cross-origin issues.
---

## BUG 10
**File:** index.html:2663
**Area:** Finance Widget / Lender Display
**Severity:** Low
**Description:** When displaying lender names after a finance check, the code uses `esc(l.name || l.lender || l)`. If a lender object has neither `name` nor `lender` properties, it falls through to `l` — the entire object. `esc()` will call `String(l)` on the object, producing `[object Object]` displayed as a lender chip.
**Reproduction steps:** If the BridgeMatch API returns lender objects with an unexpected shape (e.g., `{company: "ABC Lender"}`), the chip will show "[object Object]".
**Suggested fix:** Add a more robust fallback: `esc(l.name || l.lender || l.company || 'Unknown lender')`.
---

## BUG 11
**File:** index.html:2666, bridgematch-lite.html
**Area:** Finance Widget / Deep Link Query Params
**Severity:** Medium
**Description:** After a successful finance check, the CTA link points to `/check?loan=...&value=...&type=...`. The `/check` route (server.js:2839) correctly serves `bridgematch-lite.html`, BUT `bridgematch-lite.html` likely does not parse `loan`, `value`, or `type` query parameters to pre-fill the deal form. The user clicks "See all X matches on BridgeMatch →", lands on the BridgeMatch Lite page, and has to manually re-enter all the deal parameters that were already known.
**Reproduction steps:** Expand a lot, run finance check, click the "See all X matches" link. The BridgeMatch Lite page opens with empty/default fields, not pre-filled with the lot's price and property type.
**Suggested fix:** Add URL query param parsing to `bridgematch-lite.html` so it reads `loan`, `value`, and `type` params and pre-fills the form on page load.
---

## BUG 12
**File:** index.html:2542-2543
**Area:** Image Error Handler / Badge Destruction
**Severity:** Medium
**Description:** The card image `onerror` handler replaces the ENTIRE `parentElement.innerHTML` with a placeholder. The parent is `.card-image-wrapper` which also contains the badges (house name, score, vacant, urgency) added by `getCardImageBadges()`. When `onerror` fires, `this.parentElement.innerHTML = getPlaceholderHtml(...)` destroys ALL badges — the house name badge, score badge, vacant badge, and urgency countdown are all wiped out. The same issue occurs on the `onload` handler when it detects a tiny image (< 120x90). Only the "No photo available" placeholder is shown, losing all overlay information.
**Reproduction steps:** Load the page with a lot that has a broken `imageUrl`. The card will show "No photo available" but will be missing the house name, score badge, vacant/urgency badges that are normally overlaid on the image.
**Suggested fix:** Instead of replacing `parentElement.innerHTML`, only replace the `<img>` element itself (and its shimmer sibling) while preserving the badge elements. Or, re-append the badges after setting the placeholder.
---

## BUG 13
**File:** index.html:2317, 2202
**Area:** Expanded Panel / Re-render Destruction
**Severity:** High
**Description:** Any action that triggers `renderLots()` — changing a filter, changing sort order, changing page, changing per-page count — calls line 2317 `expandedLotId = null` and line 2318 `out.innerHTML = ''` which destroys the expanded panel without animation or warning. If a user has an expanded panel open (reading details, about to click finance check), and any filter dropdown changes (even accidentally), the panel is instantly destroyed and all state is lost. The `_idx` values are also reassigned on every render (line 2202: `l._idx = i`), so even if the panel survived, the lot IDs would be stale.
**Reproduction steps:** Expand any lot card. While the panel is open, change a filter or sort value. The panel vanishes instantly.
**Suggested fix:** Either preserve the expanded state across re-renders by storing the lot's unique identifier (e.g., `lot.lot + lot._house`) instead of the transient `_idx`, or scroll the user back to the re-expanded card after re-render.
---

## ~~BUG 14~~ FALSE POSITIVE — RETRACTED
**Note:** `_idx` is assigned at line 2202 on `LOTS.slice()` BEFORE filtering occurs. Since `slice()` is a shallow copy, `_idx` values correctly correspond to indices in the original `LOTS` array. After filtering, each surviving lot retains its correct `_idx`. The `onclick="expandCard(LOTS[${l._idx}])"` pattern is correct.
---

## BUG 15
**File:** index.html:2586, 2593, 2603
**Area:** Expanded Panel / Empty State
**Severity:** Low
**Description:** When a lot has no `bullets` array (or it's empty), the AI Analysis section shows "No detailed analysis available." which is good. But the `analysisText` is computed as `(lot.bullets || []).join('. ')` — joining bullet points with ". " as a separator. If bullets are short phrases like ["SOLD", "Ground floor flat"], the joined text reads "SOLD. Ground floor flat" which is functional but loses any structured readability. If there's only one bullet, there's no separator issue but the "AI Analysis" header is misleading for simple status labels like "SOLD".
**Reproduction steps:** Expand a lot with a single bullet point like "SOLD". The "AI Analysis" section shows "SOLD" under the "AI Analysis" header.
**Suggested fix:** Consider hiding the AI Analysis section entirely if bullets only contain status labels (SOLD/STC/WITHDRAWN), or rename the header contextually.
---

## BUG 16
**File:** index.html:2611
**Area:** Finance Widget / Price Display
**Severity:** Low
**Description:** The finance widget displays price using `lot.price.toLocaleString()`. If `lot.price` is `0` (a falsy value), the ternary `lot.price ? ... : 'TBA'` will show "TBA" even though the price is technically set to £0. While rare, some lots (e.g., land or garages) could have very low guide prices. More importantly, the finance "Check finance" button (line 2617) is conditionally rendered: `lot.price ? '<button...>' : ''`. So a £0 guide price lot gets no finance check button, which is correct behaviour, but inconsistent with showing "TBA" (implies price is unknown, not zero).
**Reproduction steps:** Find or create a lot with `price: 0`. The finance widget shows "TBA" and no check button.
**Suggested fix:** Use `lot.price != null && lot.price > 0` for the check, or display "£0" if price is explicitly zero.
---

## BUG 17
**File:** index.html:2611
**Area:** Finance Widget / toLocaleString Crash
**Severity:** Medium
**Description:** If `lot.price` is a string (e.g., "150000" instead of 150000), `lot.price.toLocaleString()` will still work (strings have toLocaleString), but will NOT format with commas — it will show "150000" instead of "150,000". More critically, the loan calculation on line 2643 does `lot.price * ltv / 100` — if `lot.price` is a string, JavaScript coerces it to a number for multiplication, which works, but `Math.round` on the result may produce unexpected results with floating point strings. The real issue: some DOM extractors may return price as a string from HTML parsing. The server's `analyseLot()` doesn't explicitly coerce price to a number.
**Reproduction steps:** If any DOM extractor returns a lot with `price` as a string, the finance widget will display an unformatted number and may calculate incorrect loan amounts.
**Suggested fix:** Coerce price to number in `analyseLot()`: `L.price = Number(raw.price) || null`.
---

## BUG 18
**File:** index.html:2565-2624
**Area:** Expanded Panel / No Keyboard Dismiss
**Severity:** Low
**Description:** The expanded panel can only be closed by clicking the same lot card again. There is no Escape key handler or close button on the panel itself. The lot cards have `onkeydown` handlers for Enter (to expand), but there's no corresponding keyboard shortcut to collapse. Users navigating by keyboard or using screen readers have no obvious way to close the expanded panel without finding and re-activating the original card.
**Reproduction steps:** Tab to a lot card, press Enter to expand. Try pressing Escape — nothing happens. The user must Tab back to the card and press Enter again.
**Suggested fix:** Add a close button to the expanded panel and an Escape key handler: `document.addEventListener('keydown', e => { if (e.key === 'Escape' && expandedLotId !== null) { ... } })`.
---

## BUG 19
**File:** index.html:2541
**Area:** Image Alt Text / Wrong Property Name
**Severity:** Low
**Description:** The card image alt text references `lot.house` but the actual data field is `lot._house` (with underscore prefix, as used correctly on line 2514). The fallback `lot.house || 'auction lot'` will always evaluate to the fallback `'auction lot'` since `lot.house` is undefined — the house name is stored in `lot._house`. This means every card image alt text says "... — auction lot" instead of the actual auction house name, which hurts accessibility and SEO.
**Reproduction steps:** Inspect any lot card image in the DOM — the alt attribute will say e.g., "123 High Street — auction lot" instead of "123 High Street — Savills".
**Suggested fix:** Change `lot.house` to `lot._house` on line 2541.
---

## BUG 20
**File:** index.html:1119-1145
**Area:** Data Fetching / Error State
**Severity:** High
**Description:** If `loadAllLots()` fails (network error, API down, server 500), the catch block at line 1143-1144 only logs to console. The 12 skeleton cards shown by `showSkeletonCards(12)` at line 1120 remain visible indefinitely — the user sees an animated loading state forever with no error message or retry option. There is no timeout, no error banner, and no way for the user to know something went wrong. Additionally, if the fetch succeeds but returns 0 lots (`ALL_LOTS = d.lots || []` where `d.lots` is empty), line 1132 checks `if(ALL_LOTS.length)` and silently does nothing — skeletons remain on screen.
**Reproduction steps:** Open the site with the API server down or with network disconnected. The page shows 12 pulsing skeleton cards indefinitely with no error indication.
**Suggested fix:** In the catch block, clear skeleton cards and show a user-facing error banner with a "Retry" button. Also handle the 0-lots case with a "No lots currently available" message.
---

## BUG 21
**File:** index.html:471
**Area:** Expanded Panel / Animation Overflow Clipping
**Severity:** Low
**Description:** The `slideDown` keyframe animation at line 471 goes from `max-height:0` to `max-height:1000px`. During the 0.25s animation, the panel's `max-height` starts at 0, which clips content. The `.expanded-panel` has no `overflow` property set (defaults to `visible`), so `max-height:0` with `overflow:visible` actually doesn't clip content visually — HOWEVER, the `max-height` animation combined with opacity creates a visual effect where the full-height content flashes visible at frame 1 (since overflow is visible) while fading in. This causes a brief "content appears at full height then shrinks" flash before the animation settles. The `max-height` animation technique requires `overflow:hidden` to work correctly, but adding it would clip absolutely-positioned children. In practice this is a subtle visual glitch.
**Reproduction steps:** Slow down CSS animations in DevTools (set animation speed to 0.1x). Click to expand a card — observe the content is immediately visible at full size rather than sliding down.
**Suggested fix:** Remove `max-height` from the animation and use a simpler opacity-only fade or a `transform: translateY` slide instead.
---

## BUG 22
**File:** index.html:2565-2624
**Area:** Expanded Panel / No Auto-Scroll
**Severity:** Medium
**Description:** When a user clicks a lot card near the bottom of the viewport, the expanded panel is inserted after the card (`cardEl.after(panel)` at line 2623) but is never scrolled into view. The panel can appear entirely below the fold, and the user may not realize it opened. The `bridgeMatchLot()` function at line 2682-2684 does call `scrollIntoView` for the finance widget, but the plain `expandCard()` function (the default card click handler) does no scrolling at all.
**Reproduction steps:** Scroll down so a lot card is near the bottom of the viewport. Click to expand it. The panel appears below the card, potentially off-screen. The user must manually scroll down to see the expanded content.
**Suggested fix:** Add `panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` after line 2623.
---

## BUG 23
**File:** index.html:2417
**Area:** Card Rendering / XSS via lot number
**Severity:** Low
**Description:** The `aria-label` attribute on line 2417 uses `esc(l.lot || '')` which is safe. However, the `onclick` handler uses `expandCard(LOTS[' + l._idx + '])` which is safe because `_idx` is a numeric index. And `catLabel` on line 2410 uses `esc()`. So XSS is properly handled throughout. **FALSE POSITIVE — NO BUG HERE.** (Leaving note for audit trail.)
---

## BUG 24
**File:** index.html:2417 (card function), index.html:423-426 (CSS)
**Area:** Blurred Lots / CSS Class Never Applied
**Severity:** High
**Description:** The server's `stripAIFields()` (server.js:946-956) sets `blurred: true` on lots beyond the free preview limit, and CSS rules at lines 423-426 define `.lot-card.blurred` styling (blur filter, hidden view link, upgrade overlay). However, the `card()` function at line 2417 never checks `l.blurred` and never adds the `blurred` class to the card div. The only classes conditionally added are `card-ended` (for past auctions). This means blurred lots render identically to normal lots — their truncated address, null score ("null" text per BUG 3), null dealType (shows "Standard"), empty opps/risks, and null URL all display as-is without the intended blur overlay and "Upgrade" message. The paywall CSS is completely dead code in the card rendering path.
**Reproduction steps:** Load `/auctions` without being logged in. All lots render normally — none show the blur overlay or "Upgrade for full address" message even though lots beyond `FREE_PREVIEW_LOTS` have `blurred: true`.
**Suggested fix:** In the `card()` function, add `l.blurred ? ' blurred' : ''` to the class string on line 2417, alongside `endedClass`.
---

## BUG 25
**File:** index.html:2565-2624
**Area:** Expanded Panel / Blurred Lot Bypass
**Severity:** High
**Description:** Even if BUG 24 is fixed and the `blurred` CSS class is applied to cards, clicking a blurred card still fires `expandCard(LOTS[l._idx])`. The `expandCard()` function has no check for `lot.blurred` and will render the full expanded panel including the image, AI analysis bullets, opportunity/risk signals, and finance widget. While the server strips most AI fields for blurred lots (score=null, opps=[], risks=[], bullets=[], dealType=null, url=null), the expanded panel still reveals the image URL and address (truncated but visible in the panel), and crucially allows the finance check to proceed since `lot.price` is NOT stripped. Users can circumvent the paywall by expanding blurred cards to access the finance widget.
**Reproduction steps:** Load as non-logged-in user. Click any blurred lot card. The expanded panel renders with whatever data is available, including the finance check button (if price exists).
**Suggested fix:** Add `if (lot.blurred) return;` at the top of `expandCard()`, or show a paywall prompt instead of the panel.
---

## BUG 26
**File:** index.html:2410
**Area:** Card Rendering / Blurred Lots Show "Standard" Deal Type
**Severity:** Medium
**Description:** `stripAIFields()` sets `dealType: null` for blurred lots. The `card()` function at line 2410 uses `esc(l.dealType || 'Standard')`, which displays "Standard" as the deal type for all blurred lots. This leaks false information — a blurred lot that is actually a "Refurb" or "Development" deal displays as "Standard", misleading users about the nature of the deal even behind the paywall.
**Reproduction steps:** Load as non-logged-in user. Observe that all lots beyond the free preview show "Lot X · Standard" regardless of their actual deal type.
**Suggested fix:** For blurred lots, show a generic label like "—" or "Hidden" instead of "Standard". E.g., `esc(l.blurred ? '—' : (l.dealType || 'Standard'))`.
---

## BUG 27
**File:** index.html:2521
**Area:** Urgency Badge / Timezone-Dependent Day Calculation
**Severity:** Low
**Description:** The urgency badge computes days remaining as `Math.ceil((new Date(lot._auctionDate) - new Date()) / 86400000)`. `lot._auctionDate` is a date string like "2026-03-15". `new Date("2026-03-15")` in JavaScript parses this as UTC midnight, while `new Date()` returns the local time. For a UK user at 11pm GMT, `new Date()` is 23:00 UTC, so the difference to midnight UTC of the auction date is only 1 hour — `Math.ceil(1h / 24h) = 1`, showing "Tomorrow". But the auction IS tomorrow, so it's arguably correct. However, at 00:01 UTC on auction day, the difference is ~24 hours, showing "1 day left" instead of "Today". The `Math.ceil` causes an off-by-one: on auction day itself, it shows "Tomorrow" for most of the day because `new Date("2026-03-15")` is midnight and `new Date()` at e.g. 09:00 gives ceil(15h/24h)=1, meaning "Tomorrow" when it should say "Today".
**Reproduction steps:** On auction day at any time after midnight, check the urgency badge. It will likely show "Tomorrow" instead of "Today" because `Math.ceil` rounds up the fractional day.
**Suggested fix:** Compare date strings directly: `const aDate = lot._auctionDate; const today = new Date().toISOString().slice(0,10); const days = Math.round((new Date(aDate) - new Date(today)) / 86400000);`
---

## BUG 28
**File:** index.html:2634
**Area:** Finance Check / LOTS.find vs Direct Index
**Severity:** Low
**Description:** `triggerFinanceCheck(idx)` uses `LOTS.find(l => l._idx === idx)` at line 2634. However, `_idx` is reassigned on every `renderLots()` call (line 2202: `l._idx = i`). If the user changes a filter or sort while a finance check is debounced (400ms timeout), the `_idx` values get reassigned, and the `LOTS.find()` inside the timeout callback at line 2647 will find the WRONG lot (the lot now at that index position, not the original one). The `lot` variable captured at line 2634 is correct, but `resultsEl` at line 2638 uses `'fw-results-' + idx` — the panel ID also uses the old `_idx`. After re-render, the panel with that ID no longer exists, so `resultsEl` is null and the function returns early. This means the finance check silently fails if a re-render happens during the 400ms debounce window.
**Reproduction steps:** Click "Check finance" on a lot. Within 400ms, change a filter. The finance check silently fails — no result, no error shown.
**Suggested fix:** Capture `resultsEl` reference before the timeout, or use a stable lot identifier instead of `_idx`.
---

## Sweep completed at 2026-03-14T05:00:00Z — 27 bugs logged (BUGs 6, 14, 23 retracted as false positives, net 24 valid bugs; new bugs 24-28 added this sweep)

## BUG 29
**File:** index.html:1282-1300 (backToAuctions), index.html:1055-1070 (resetSearchState)
**Area:** Navigation / Filter State Loss
**Severity:** Medium
**Description:** `backToAuctions()` calls `resetSearchState()` which resets ALL filter values to defaults (line 1062-1066: deal type, property type, condition, tenure, location, affordability, sold status, search text, sort, beds, postcode, min/max price all reset). If a user had carefully configured filters (e.g., "houses only, under £150k, Yorkshire, score sort"), navigated into a smart search, and then clicked "Back to auctions", all those filters are wiped out. The URL query parameters are also lost because `renderLots()` calls `syncFiltersToURL()` which writes the now-blank filter state to the URL. The user has to re-apply all filters from scratch.
**Reproduction steps:** Set several filters (region, price range, property type). Run a smart search. Click "Back to auctions". All filters are reset to defaults.
**Suggested fix:** Save the pre-search filter state before running a smart search (e.g., `const _savedFilters = {...}`), and restore it in `backToAuctions()` instead of calling `resetSearchState()` indiscriminately. Or split `resetSearchState` into two: one for search abort/cleanup and one for filter reset.
---

## BUG 30
**File:** index.html:1122-1123
**Area:** Data Fetching / No HTTP Status Check
**Severity:** Medium
**Description:** `loadAllLots()` calls `fetch('/api/all-lots')` and immediately calls `r.json()` without checking `r.ok` first. If the server returns a non-200 response with a non-JSON body (e.g., 502 Bad Gateway from Railway's proxy with an HTML error page), `r.json()` will throw a SyntaxError. This does hit the catch block (BUG 20 already covers the catch block issue), but the error message "Failed to load lots: SyntaxError: Unexpected token < in JSON" is misleading. If the server returns a JSON error body (e.g., `{"error": "Internal server error"}` with status 500), `r.json()` succeeds silently, `d.lots` is undefined, and `ALL_LOTS` becomes `[]` — the user sees perpetual skeleton cards with no error indication. This is a distinct issue from BUG 20 (which covers the catch block) because this path doesn't even reach the catch.
**Reproduction steps:** Simulate a 500 response from `/api/all-lots` that returns `{"error": "rate limited"}`. The page loads silently with no lots and no error message.
**Suggested fix:** Add `if (!r.ok) throw new Error('Server error: ' + r.status);` after the fetch.
---

## BUG 31
**File:** index.html:2542
**Area:** Image onload / Self-Destroying Handler Leaves Orphaned Shimmer
**Severity:** Low
**Description:** The `onload` handler at line 2542 first hides the shimmer (`this.previousElementSibling.style.display='none'`), then checks if the image is too small. If the image IS too small, it replaces `parentElement.innerHTML` with the placeholder — but the shimmer was already hidden via direct DOM style, not removed. Since `innerHTML` replacement destroys the entire parent content including the shimmer, this is harmless. HOWEVER, there's a subtle issue: if a cached image fires `onload` synchronously before the browser has computed `naturalWidth`/`naturalHeight`, the dimensions may read as 0. This would trigger the small-image check (`0 < 120`), replacing a valid image with a placeholder. This can happen when an image is served from the browser cache and the load event fires before layout.
**Reproduction steps:** Load the page, scroll through lots to load images, then navigate back and forth (triggering cache hits). Some images that were previously fine may briefly show as placeholders on subsequent visits if their dimensions aren't computed before the onload handler runs.
**Suggested fix:** Use `img.decode().then(...)` or check dimensions in a `requestAnimationFrame` callback to ensure layout has completed before checking `naturalWidth`/`naturalHeight`.
---

## BUG 32
**File:** index.html:2565-2623
**Area:** Expanded Panel / Grid Layout Disruption
**Severity:** Low
**Description:** The expanded panel is inserted as a sibling AFTER the clicked card inside the `.lots-grid` container (line 2623: `cardEl.after(panel)`). The grid uses CSS `grid-template-columns` which auto-places children into grid cells. The panel has `grid-column:1/-1` (line 470) to span the full width, but the panel insertion shifts all subsequent card positions in the grid. If the clicked card was in the middle of a row, the next row starts after the panel, but cards that were in the same row as the clicked card may visually jump positions. This is most noticeable when cards have varying heights — the grid re-flows around the inserted panel.
**Reproduction steps:** Click a card that is not the last card in its grid row (e.g., the 2nd card in a 3-card row). The panel appears below, and the 3rd card may shift to a new row, causing a visual "jump" in the grid layout.
**Suggested fix:** Insert the panel after the last card in the current grid row, or use a dedicated container outside the grid for the panel.
---

## BUG 33
**File:** index.html:2397-2398
**Area:** Card Rendering / priceText Overrides Guide Price
**Severity:** Low
**Description:** The `card()` function at line 2397 checks `l.priceText` before `l.price`. If a DOM extractor sets both `priceText` (e.g., "Guide Price £50,000+*") and `price` (50000), the `priceText` value is displayed as-is without any sanitisation beyond `esc()`. The `priceText` is passed through `esc()` in the card body (line 2420), but some extractors may set `priceText` to long strings like "Guide Price: £50,000 - £60,000 plus fees" which won't fit the card price area and may overflow or wrap awkwardly. More importantly, if `priceText` is set but `price` is NOT, the finance widget (line 2611) shows "TBA" even though the card shows a price range — the user sees a price on the card but "TBA" in the expanded panel's finance section.
**Reproduction steps:** Find a lot where the DOM extractor sets `priceText` to a price range string but doesn't parse out a numeric `price`. The card shows the range but the expanded panel shows "TBA" with no finance check button.
**Suggested fix:** If `priceText` exists but `price` is null, try to parse a numeric price from `priceText` for the finance widget. Or display `priceText` in the expanded panel instead of only using the numeric `price`.
---

## Sweep completed at 2026-03-14T06:00:00Z — 5 new bugs (29-33) added this sweep, cumulative total 29 valid bugs

## BUG 34
**File:** index.html:2271-2276
**Area:** Expanded Panel / Score Sort Does Not Sort Within Sections
**Severity:** Medium
**Description:** When `sortVal === 'score'` (the default), the code groups lots into sections (Top Picks, Title Splits, Worth a Look, Other) based on score thresholds, but never actually sorts lots by score. Lines 2271-2276 only handle `price_asc`, `price_desc`, and `yield` sorts — there is no `else if(sortVal==='score')` branch. Lots within each section retain their original order from the API response (which is arbitrary per-house insertion order). This means within "Top Picks" (score >= 3), a lot scoring 3.0 could appear before a lot scoring 9.5. Users expect the default "best" sort to show the highest-scoring lots first.
**Reproduction steps:** Load the page with default sort (score). Look at the "Top Picks" section. Lots are NOT ordered by score descending — a 3.0 lot may appear before an 8.0 lot.
**Suggested fix:** Add a score sort before sectioning: `if(sortVal==='score') lots.sort((a,b) => (b.score||0) - (a.score||0));` after line 2276, or move it before the section grouping at line 2277.
---

## BUG 35
**File:** index.html:2565-2576
**Area:** Expanded Panel / Double-Click Flicker
**Severity:** Low
**Description:** When a user double-clicks a lot card, `expandCard()` fires twice in rapid succession. First call: removes any existing panel (line 2567-2568), creates new panel, sets `expandedLotId = lot._idx`. Second call: removes the just-created panel (line 2567-2568), then hits `expandedLotId === lot._idx` (line 2573), sets `expandedLotId = null` and returns. Net effect: the panel appears for a few milliseconds then vanishes. The user sees a flicker and the panel is gone. This is worse with touch devices where "tap" can sometimes fire the click handler twice.
**Reproduction steps:** Double-click any lot card. The expanded panel briefly appears then disappears. The card's `expanded` class is removed (line 2575) but was never actually cleared from the first call (per BUG 1).
**Suggested fix:** Add a debounce/guard to `expandCard()`, e.g. `if (Date.now() - _lastExpandTime < 300) return; _lastExpandTime = Date.now();` at the top of the function.
---

## BUG 36
**File:** index.html:2202, 2199
**Area:** Data Integrity / _idx Mutation Leaks Into ALL_LOTS
**Severity:** Medium
**Description:** Line 2199 does `let lots = LOTS.slice()` — a shallow copy. Line 2202 then does `lots.forEach((l,i) => { l._idx = i })`. Because slice is shallow, `l` is a reference to the same object in the original `LOTS` array (and in `ALL_LOTS`, since line 1133 does `LOTS = ALL_LOTS`). This means `_idx` is mutated directly on the objects in `ALL_LOTS`. When the user runs a smart search (which sets `LOTS = smartResults` — a different array), then clicks "Back to auctions" (which resets `LOTS = ALL_LOTS`), the `_idx` values on ALL_LOTS objects are stale from the last renderLots call. Since `expandCard(LOTS[l._idx])` uses these indices, cards could reference the wrong lot if the array order changed between renders. In the current code path where `LOTS = ALL_LOTS` is always the same array, the mutation is benign. But if any code path reorders or splices LOTS without re-rendering, the stale `_idx` values would cause wrong-lot expansion.
**Reproduction steps:** Edge case — currently benign due to renderLots always being called after LOTS assignment, but the mutation pattern is fragile and would break if LOTS is ever reassigned without a re-render.
**Suggested fix:** Use a WeakMap or local variable to track indices instead of mutating the lot objects: `const idxMap = new Map(); lots.forEach((l,i) => idxMap.set(l, i));`
---

## BUG 37
**File:** index.html:2417
**Area:** Card Rendering / onclick References Global LOTS Array
**Severity:** Medium
**Description:** The card's onclick handler is `expandCard(LOTS[${l._idx}])`. This references the global `LOTS` array at render time. If a smart search replaces `LOTS` with a different array (smart search results), the card onclick handlers from a previous render (if any cards survive DOM-wise, e.g. in a cached view) would reference the NEW `LOTS` array, not the array that was active when the card was rendered. While renderLots always rebuilds the entire DOM (line 2318 `out.innerHTML = ''`), there's a timing window: if a smart search response arrives and sets `LOTS = smartResults` WHILE the user is interacting with an already-rendered card, the onclick handler resolves `LOTS[l._idx]` against the new array, potentially returning a completely different lot.
**Reproduction steps:** Start a smart search (which may take several seconds). While waiting, click a card from the current render. If the LOTS array is reassigned mid-interaction, the wrong lot data could be passed to expandCard.
**Suggested fix:** Capture the lot reference at render time instead of looking it up dynamically: store lot objects in a render-scoped map and reference by stable ID.
---

## BUG 38
**File:** index.html:2216-2218
**Area:** Filtering / Price & Beds Filters Silently Pass Null Values
**Severity:** Low
**Description:** The min price filter at line 2216 uses `!l.price` to let POA lots through: `lots=lots.filter(l=>!l.price||l.price>=minP)`. Similarly, max price (line 2217) and beds filter (line 2218) use `!l.price` and `!l.beds` to pass lots with null values. This means setting a min price of £100k still shows all POA lots, and setting minimum 3 beds still shows lots with unknown bedroom count. While arguably intentional (don't hide lots just because data is missing), it's inconsistent with user expectations — a user filtering for "3+ beds" doesn't expect to see lots with no bedroom data. The separate "Exclude POA" filter (line 2240) exists for price, but there's no equivalent for beds/other fields.
**Reproduction steps:** Set minimum beds to 3. Lots with `beds: null` or `beds: undefined` still appear in results because `!l.beds` is true.
**Suggested fix:** Either document this behaviour (tooltip on filter explaining "includes unknown") or add a stricter filter mode. At minimum, add visual indication on cards when a filtered field's data is unknown.
---

## BUG 39
**File:** index.html:2583, 2598-2620
**Area:** Expanded Panel / No Close Button or Click-Outside-to-Close
**Severity:** Medium
**Description:** The expanded panel has no visible close button (X) and no click-outside-to-dismiss behaviour. The only way to close it is to click the original lot card again (which toggles it off via line 2573). On mobile (where the panel goes full-width and pushes the card off-screen due to scrolling), the user may not be able to see the original card to click it again. BUG 18 covers the keyboard (Escape) aspect, but this bug specifically addresses the absence of a close button in the panel's UI — a fundamental UX issue especially on mobile where the triggering card scrolls out of view.
**Reproduction steps:** On a mobile device (or narrow viewport), click a lot card. The expanded panel opens and may push the card above the viewport. The user has no visible UI element to close the panel — they must scroll up to find and re-click the original card.
**Suggested fix:** Add a close button to the top-right of the expanded panel: `<button class="exp-close" onclick="expandCard({_idx:${lot._idx}})">✕</button>` with appropriate styling.
---

## BUG 40
**File:** index.html:2598-2620
**Area:** Expanded Panel / innerHTML with Unsanitised Signal HTML
**Severity:** Low
**Description:** The `signalsHtml` variable (lines 2587-2591) is built using `esc(o)` and `esc(r)` for opportunity and risk text — this is correctly sanitised. However, it's then injected into `panel.innerHTML` at line 2598 alongside `imgHtml` which uses `esc(lot.imageUrl)` and `esc(lot.address)`. The `imgHtml` for the image is constructed as raw HTML: `'<img class="exp-large-img" src="' + esc(lot.imageUrl) + '"...'`. While `esc()` handles HTML entity encoding, it does NOT handle URL-context injection. If `lot.imageUrl` contains a `"` character that gets entity-encoded to `&quot;`, the browser's HTML parser will decode it back to `"` when processing the attribute, potentially allowing attribute injection. However, `esc()` does encode `"` to `&quot;` and the browser DOES keep it as `&quot;` within the attribute value (not breaking out). So this is actually safe — **FALSE POSITIVE on the XSS angle**. However, the `src` attribute IS set to a potentially arbitrary URL without the `safeHref()` check that the card uses (line 2413). A malicious imageUrl like `javascript:alert(1)` would be blocked by modern browsers (img src doesn't execute JS), but it's inconsistent with the card's safety approach.
**Reproduction steps:** Theoretical — requires a malicious imageUrl in lot data from the server.
**Suggested fix:** Apply `safeHref()` to the expanded panel image src for consistency, even though browsers block JS execution on img src.
---

## Sweep completed at 2026-03-14T07:30:00Z — 7 new bugs (34-40, with 40 partially retracted as false positive on XSS but valid on inconsistent URL sanitisation), cumulative total 36 valid bugs

## BUG 41
**File:** index.html:2223
**Area:** Filtering / Condition "Good" Includes Unknown
**Severity:** Medium
**Description:** The condition filter's "good" option uses `l.condition !== 'needs work'` (line 2223). Since `null !== 'needs work'` and `undefined !== 'needs work'` are both `true`, lots with no condition data pass through the "good condition" filter. A user filtering for "good condition" properties sees lots where condition is simply unknown/unextracted, mixed in with genuinely good-condition lots. There's no way to distinguish them — both show no condition pill on the card. This inflates the "good condition" count and gives a false sense of selection quality.
**Reproduction steps:** Apply the "Good condition" filter. Observe that lots with no condition data (many lots have `condition: null`) appear alongside genuinely good-condition lots.
**Suggested fix:** Use `l.condition && l.condition !== 'needs work'` to require an explicit condition value, or add a separate "Unknown" filter option.
---

## BUG 42
**File:** index.html:2644-2645
**Area:** Finance Widget / Property Type Mapping Too Broad
**Severity:** Medium
**Description:** The finance check maps `lot.propType` to the BridgeMatch API type using string `.includes()` checks: flat, commercial, land, and everything else defaults to 'house'. Non-standard property types like "Garage", "Car Park", "Storage Unit", "Mixed Use", "Development Site", or "HMO" all silently map to 'house'. This sends incorrect property type to the BridgeMatch `/api/filter` endpoint, which may return lender matches that don't actually accept those property types. For example, a garage lot would be matched against house-lending criteria, showing lenders that only do residential — misleading the user.
**Reproduction steps:** Find a lot with `propType` of "Garage", "Mixed Use", or any non-standard type. Run the finance check. The API receives `property_type: 'house'`, returning potentially inaccurate lender matches.
**Suggested fix:** Expand the mapping to handle more types: `if (propType.includes('garage') || propType.includes('car park') || propType.includes('storage')) apiType = 'commercial';` etc. Or pass the raw `propType` string and let the BridgeMatch API handle mapping.
---

## BUG 43
**File:** index.html:2413-2414, 2425
**Area:** Card Rendering / Empty Card Footer
**Severity:** Low
**Description:** When a lot has no listing URL (`url: null`) and no price (`price: null/0`), `viewLink` becomes `<span></span>` (an empty span) and `bmBtn` becomes `''` (empty string). The card footer renders as `<div class="card-footer"><span></span></div>` — a div with `border-top: 1px solid #f0f2f5` and `padding: 10px 16px` containing only an empty span. This creates a visible empty bar at the bottom of the card with wasted vertical space and a divider line above nothing. For blurred lots (which have `url: null`), those with no price show this empty footer.
**Reproduction steps:** Find a POA lot (no numeric price) that also has no listing URL, or view a blurred lot without price. The card footer is an empty bar with just a top border.
**Suggested fix:** Conditionally hide the footer when both viewLink and bmBtn are empty: `const hasFooter = l.url || l.price; ... (hasFooter ? '<div class="card-footer">...' : '')`.
---

## BUG 44
**File:** index.html:2456-2460
**Area:** CSV/JSON Export / Exports Filtered Subset After Smart Search
**Severity:** Medium
**Description:** `dlCSV()` and `dlJSON()` iterate over the global `LOTS` array (line 2458). In browse mode, `LOTS = ALL_LOTS` so the full dataset is exported. But after a smart search, `LOTS` is reassigned to `smartResults` (a filtered subset). The user clicking "Download CSV" after a smart search exports only the AI-filtered results, not all lots. There's no indication in the UI that the export scope has changed — the download button label and filename (`auction_analysis.csv`) are the same regardless. A user who runs a smart search for "3-bed houses in Leeds" and then downloads CSV may not realize they're only getting those results, not their full lot data.
**Reproduction steps:** Load the page (all lots visible). Run a smart search. Click "Download CSV". The CSV contains only the smart search results, not all lots. No warning is shown.
**Suggested fix:** Either always export `ALL_LOTS`, or show the export scope in the button label (e.g., "Download 47 results as CSV" vs "Download all 2,364 lots as CSV"), or offer both options.
---

## BUG 45
**File:** index.html:2337-2340
**Area:** Score Sections / Title Split Lots with Null Score Misclassified
**Severity:** Medium
**Description:** The section grouping logic at line 2337 puts title-split lots into the "Title Splits" section only if `l.score >= 2`. For blurred lots (beyond `FREE_PREVIEW_LOTS`), `stripAIFields()` sets `score: null` but does NOT strip `titleSplit`. So a blurred lot with `titleSplit: true` and `score: null` fails the `l.score >= 2` check (since `null >= 2` coerces to `0 >= 2` = false). It also fails `score >= 3` (topL), `score >= 1.5 && score < 3` (midL), but passes `score < 1.5` (since `0 < 1.5` = true after null-to-0 coercion). These title-split lots end up in the "Other" section instead of "Title Splits", hiding a potentially valuable signal from the user even though the `titleSplit` field survived the strip.
**Reproduction steps:** Load as non-logged-in user. Look at the "Other" section — title-split lots with null scores are there instead of the "Title Splits" section.
**Suggested fix:** Change line 2337 to: `const tsL = lots.filter(l => l.titleSplit && (l.score === null || l.score >= 2));` or group by `titleSplit` boolean regardless of score.
---

## BUG 46
**File:** index.html:2279-2283
**Area:** Stats Row / Uses LOTS.length Instead of lots.length for Base Count
**Severity:** Low
**Description:** The stats row at line 2279 shows `LOTS.length` as "Total lots" and `lots.length` as "Showing". But `LOTS` is the global array (either ALL_LOTS in browse mode or smartResults after smart search). The "Priced" stat at line 2283 also uses `LOTS.filter(l=>l.price).length` — counting priced lots in the unfiltered global set, not the currently visible filtered set. This means the "Priced" count doesn't change when the user applies filters, which is inconsistent — "Showing" changes but "Priced" doesn't. If the user filters to "houses only" and sees "Showing 500", they might expect the "Priced" stat to reflect how many of those 500 are priced, not how many of the total 2000+ are priced.
**Reproduction steps:** Apply a filter (e.g., property type = "Flat"). The "Showing" stat updates to the filtered count, but "Total lots" and "Priced" still show values based on the unfiltered LOTS array.
**Suggested fix:** Either label "Priced" more clearly as "Total priced" or compute it from the filtered `lots` array: `lots.filter(l=>l.price).length`.
---

## BUG 47
**File:** index.html:2521-2527, 2416
**Area:** Urgency Badge / Auction Date Comparison Uses Different Methods
**Severity:** Low
**Description:** The `endedClass` on line 2416 compares `l._auctionDate < new Date().toISOString().slice(0,10)` — a string comparison of ISO date strings (e.g., "2026-03-13" < "2026-03-14"). This is correct for ISO dates. But `getCardImageBadges` at line 2521 uses `Math.ceil((new Date(lot._auctionDate) - new Date()) / 86400000)` — a numeric comparison via Date objects. These two approaches can disagree around midnight due to timezone differences. A lot could have `endedClass = ''` (not ended per string comparison) but `days < 0` (ended per Date math) simultaneously, showing both a non-ended card AND an "Auction ended" badge. For example, at 23:30 UTC on 2026-03-14: string comparison says "2026-03-14" is NOT less than "2026-03-14" (equal, not ended), but `new Date("2026-03-14")` is midnight UTC which is BEFORE 23:30 UTC on 2026-03-14, so `days = Math.ceil(-23.5h / 24h) = Math.ceil(-0.979) = 0`, showing "Today" badge. So they agree here. But at 00:30 UTC on 2026-03-15: string says "2026-03-14" < "2026-03-15" → ended. Date math: `Math.ceil((midnight 03-14 - 00:30 03-15) / 86400000) = Math.ceil(-0.5h/24h) = Math.ceil(-0.02) = 0` → "Today" badge. So the card gets `card-ended` class AND a "Today" badge — the card appears faded with "AUCTION ENDED" ribbon AND a "Today" urgency badge simultaneously.
**Reproduction steps:** View the page shortly after midnight (UTC) on the day after an auction. Lots from that auction show the "AUCTION ENDED" diagonal ribbon AND a "Today" urgency badge at the same time.
**Suggested fix:** Use the same comparison method in both places. Recommended: use string comparison everywhere since `_auctionDate` is already an ISO date string.
---

## Sweep completed at 2026-03-14T09:00:00Z — 7 new bugs (41-47), cumulative total 43 valid bugs

## BUG 48
**File:** index.html:2584
**Area:** Expanded Panel / Placeholder Inconsistency
**Severity:** Low
**Description:** When a lot has no image, the expanded panel placeholder (line 2584) calls `getPropertyTypeIcon(lot.propType)` directly, producing just an SVG icon inside an `exp-large-img-placeholder` div. In contrast, the card placeholder uses `getPlaceholderHtml()` (line 2535) which wraps the icon in a `card-image-placeholder` div AND adds a `<span class="ph-label">No photo available</span>` label. The expanded panel — the view where users expect MORE detail — actually provides LESS feedback about the missing image than the card thumbnail. There's no text indication that the image is absent; just a bare icon floating in a grey box.
**Reproduction steps:** Find a lot with no `imageUrl`. Click to expand. The expanded panel shows a bare property-type icon with no "No photo available" label, while the card below it shows the same icon with the label.
**Suggested fix:** Use `getPlaceholderHtml(lot.propType)` instead of raw `getPropertyTypeIcon(lot.propType)` on line 2584, and add appropriate CSS for `.exp-large-img-placeholder .ph-label`.
---

## BUG 49
**File:** index.html:470, 575-611
**Area:** Expanded Panel / Mobile Padding Overflow
**Severity:** Medium
**Description:** The expanded panel has `padding: 20px 24px` (line 470) with no responsive override at any breakpoint below 768px. At the 480px breakpoint (line 575-611), the page wrapper reduces to `padding: 0 14px`, the card image wrapper shrinks to `height: 160px`, and most other UI elements get compact padding — but the expanded panel keeps its full `24px` horizontal padding. On a 360px screen, the panel's 24px left + 24px right padding means only 312px of content width remains. Combined with the finance widget's own `padding: 18px` (line 486), the effective content area inside the finance widget is just 276px, which can cause the LTV slider label/value row to wrap, the "Check finance" button text to truncate, and the lender chip names to overflow. The `.fw-header` uses `display:flex;justify-content:space-between` which forces "Finance Check" and "Powered by BridgeMatch" onto a single line that may overflow at narrow widths.
**Reproduction steps:** Open the site on a 360px-wide phone. Expand a lot card. The expanded panel's finance widget has cramped content with possible text overflow.
**Suggested fix:** Add responsive padding reduction for `.expanded-panel` and `.finance-widget` at the 480px and 360px breakpoints, e.g.: `@media(max-width:480px){ .expanded-panel{padding:14px 12px} .finance-widget{padding:12px} }`.
---

## BUG 50
**File:** index.html:2647-2671
**Area:** Finance Widget / No Response Shape Validation
**Severity:** Low
**Description:** The finance check response parsing at line 2656 uses a fallback chain: `data.summary?.eligible || data.eligible?.length || 0`. This assumes the API returns either `{summary: {eligible: N}}` or `{eligible: [...]}`. If the BridgeMatch API changes its response format (e.g., renaming `eligible` to `matches` or wrapping in a `data` key), the count silently becomes 0 and the lenders array becomes empty. The UI then confidently shows "0 lenders match at 70% LTV" — a false negative that tells the user no lenders will fund their deal, when the real issue is a broken API integration. There's no distinction between "0 lenders matched" and "response format unrecognised".
**Reproduction steps:** If the BridgeMatch `/api/filter` response format changes, the finance widget shows "0 lenders match" with no error indication.
**Suggested fix:** Add a basic response shape check: `if (!data.summary && !data.eligible) throw new Error('Unexpected response format');` to trigger the error handler instead of showing misleading zero results.
---

## BUG 51
**File:** index.html:2582-2584
**Area:** Expanded Panel / Single Image Only
**Severity:** Medium
**Description:** The expanded panel displays only a single image from `lot.imageUrl`. Many auction lots have multiple photos (exterior, interior rooms, floor plans, EPC charts). The lot data from DOM extractors and Gemini extraction may include an `images` array (plural), but the expanded panel only references the singular `imageUrl` field. Even if a lot has 10 photos available in its listing, the expanded detail view shows only the first one with no way to browse the others. The user must click "View listing" and go to the external auction house site to see additional photos. For a detail view that's meant to provide comprehensive lot information, showing a single image is a significant gap.
**Reproduction steps:** Expand any lot that has multiple photos on its actual auction house listing page. The expanded panel shows only one image with no gallery navigation, carousel dots, or thumbnail strip.
**Suggested fix:** If lot data includes an `images` array, render a simple image carousel with prev/next navigation in the expanded panel. Even a basic thumbnail strip below the main image would improve the experience.
---

## BUG 52
**File:** index.html:2565-2624
**Area:** Expanded Panel / No Deep-Linkable URL
**Severity:** Medium
**Description:** When a user expands a lot card, the browser URL does not change. There is no hash fragment (e.g., `#lot-42`) or query parameter that identifies the expanded lot. This means: (1) Users cannot share a link to a specific expanded lot — sharing the page URL shows the default view with no lot expanded. (2) Browser back/forward navigation doesn't work with panel expansion — pressing Back after expanding a lot navigates away from the page entirely rather than closing the panel. (3) If a user refreshes the page while viewing an expanded lot, the expansion state is lost. The filter state IS preserved via URL params (lines 2699-2712 `syncFiltersToURL`), but the expanded lot state is not.
**Reproduction steps:** Expand a lot card. Copy the URL and paste it in a new tab. The page loads with no lot expanded. Or press the browser's Back button — it leaves the page entirely instead of closing the panel.
**Suggested fix:** Update the URL hash when expanding: `history.pushState(null, '', '#lot-' + lot._idx)`. Listen for `popstate` events to handle Back button closing the panel. On page load, check for a `#lot-N` hash and auto-expand.
---

## BUG 53
**File:** index.html:2649-2652
**Area:** Finance Widget / Hardcoded API URL
**Severity:** Low
**Description:** The finance check fetches from the hardcoded URL `https://www.bridgematch.co.uk/api/filter` (line 2649). This means: (1) In development/staging environments, the finance check always hits production — no way to test against a local or staging BridgeMatch API. (2) If the domain changes (the CLAUDE.md mentions potential branding changes and domain restructuring), this hardcoded URL must be manually found and updated. (3) The auction tool's own API endpoints use relative paths (e.g., `/api/all-lots`), making this the only absolute external URL in the frontend fetch logic — an inconsistency.
**Reproduction steps:** Run the auction tool locally on localhost:3000. Click "Check finance". The request goes to production `bridgematch.co.uk` instead of a local/staging API.
**Suggested fix:** Use a configurable base URL, either from a `<meta>` tag, a global JS variable set by the server, or a relative URL if the BridgeMatch API is proxied through the auction server.
---

## Sweep completed at 2026-03-14T12:30:00Z — 6 new bugs (48-53), cumulative total 49 valid bugs

## BUG 54
**File:** index.html:1041 (esc function), used at lines 2104, 2135, 2417, 2541, 2544, 2583
**Area:** Data Rendering / XSS via Unescaped Quotes in Attribute Context
**Severity:** High
**Description:** The `esc()` function uses `document.createElement('div'); d.textContent = s; return d.innerHTML`. Per the HTML spec, `textContent` → `innerHTML` only escapes `<`, `>`, and `&` — it does NOT escape double quotes (`"`). However, `esc()` is used extensively inside double-quoted HTML attributes: `value="${esc(d)}"` (line 2104), `data-house="'+esc(h)+'"` (line 2135), `aria-label="Lot '+esc(l.lot)+'"` (line 2417), `alt="'+esc(lot.address)+'"` (lines 2541, 2583), `src="'+esc(lot.imageUrl)+'"` (lines 2541, 2583), `data-proptype="'+esc(lot.propType)+'"` (line 2544). If any lot data contains a `"` character (e.g., address `123 "The Gables" High Street` or an image URL with encoded quotes), the quote breaks out of the attribute. In the `aria-label` and `alt` contexts this is a low-risk DOM corruption issue. In the `src` and `value` contexts it could allow attribute injection. The `safeHref()` function (line 1042) also passes through `esc()`, inheriting the same issue.
**Reproduction steps:** If a lot has an address containing `"` (e.g., `Flat 1, "The Willows"`), the card's `aria-label` attribute breaks at the quote, creating malformed HTML. In the expanded panel, the `alt` attribute similarly breaks.
**Suggested fix:** Create a separate `escAttr()` function that also escapes `"` and `'`: `function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }`. Use `escAttr()` wherever `esc()` is used inside HTML attribute values.
---

## BUG 55
**File:** index.html:2104
**Area:** Filter Dropdown / XSS via Deal Type Value
**Severity:** Medium
**Description:** `buildLotFilters()` builds `<option>` elements with `value="${esc(d)}"`. Since `esc()` doesn't escape quotes (see BUG 54), a `dealType` string containing `"` would break out of the `value` attribute and allow arbitrary attribute injection on the `<option>` tag. While `dealType` values come from server-side extraction (unlikely to contain quotes in normal operation), the Gemini AI extraction could return arbitrary strings. Similarly, line 2135 in `buildHouseChecklist()` uses `value="'+esc(h)+'"` for house names — same vulnerability. This is exploitable if the Gemini API returns a crafted deal type like `Standard" onfocus="alert(1)`.
**Reproduction steps:** Would require a lot with a dealType containing `"`. Unlikely in practice but possible if Gemini extraction returns unusual strings.
**Suggested fix:** Same as BUG 54 — use an attribute-safe escaping function.
---

## BUG 56
**File:** index.html:2265-2268
**Area:** Filtering / "Previous" Checkbox Default State Contradiction
**Severity:** Low
**Description:** The "Previous" checkbox (`fIncludePrevious`) has `checked` as its default in the HTML (line 837), meaning past auctions are shown by default. The filter logic at line 2265-2268 only hides past-auction lots when the checkbox is unchecked. However, `resetSearchState()` at line 1064 sets `$('fIncludePrevious').checked = true`, restoring the "show previous" default. This means users always see past auctions by default, which clutters results with ended lots. More importantly, the `card-ended` CSS at line 448 applies `overflow:hidden` to past-auction cards, and the CLAUDE.md explicitly warns "Avoid `overflow:hidden` on parent containers that need click events". While the expanded panel is inserted as a sibling (not a child), the `overflow:hidden` on `.card-ended` clips the `::after` pseudo-element ribbon — but if any future enhancement adds child elements that extend beyond the card boundary (tooltips, popovers), they'll be clipped.
**Reproduction steps:** Load the page with default settings. Past-auction lots with the "AUCTION ENDED" ribbon are visible. The `.card-ended` class applies `overflow:hidden` to these cards.
**Suggested fix:** Consider defaulting `fIncludePrevious` to unchecked so past auctions are hidden by default, reducing clutter. If keeping the current default, remove `overflow:hidden` from `.card-ended` and use `clip-path` or a positioned container for the ribbon instead.
---

## BUG 57
**File:** index.html:2104, 2129-2136
**Area:** Filter Dropdowns / innerHTML Overwrites Event State
**Severity:** Low
**Description:** `buildLotFilters()` rebuilds the deal-type `<select>` dropdown via `innerHTML` (line 2104), which destroys and recreates all `<option>` elements. If the user had a deal type selected (e.g., "Refurb"), and `buildLotFilters()` is called again (it's called on page load, smart search return, back-to-auctions — lines 1138, 1295, 1847, 2063), the selected value is lost. The dropdown resets to "All deals". Similarly, `buildHouseChecklist()` rebuilds the entire house checklist via `innerHTML` (line 2132), resetting all checkbox states. While `_selectedHouses` is preserved in the Set, the visual checkbox states are rebuilt from the Set, so house selection survives. But the deal-type filter does NOT have such backup — it's simply wiped.
**Reproduction steps:** Select "Refurb" in the deal type filter. Run a smart search (or trigger `buildLotFilters()` via another code path). Click "Back to auctions". The deal type filter resets to "All deals".
**Suggested fix:** Save the current `$('fDeal').value` before rebuilding and restore it after, if the value still exists in the new options.
---

## BUG 58
**File:** index.html:2202, 2417
**Area:** Card Rendering / _idx Used as DOM ID Can Collide
**Severity:** Low
**Description:** Each lot card gets `id="lot-' + l._idx + '"` (line 2417). `_idx` is assigned as the array index within LOTS (line 2202). When `renderLots()` sets `out.innerHTML = ''` (line 2318) and rebuilds all cards, the old DOM elements are destroyed and new ones with the same IDs are created — this is fine. However, if `renderLots()` is called while an expanded panel exists (line 2317 sets `expandedLotId = null`, line 2318 clears innerHTML), there's a brief window where `document.getElementById('lot-X')` could return stale results if any other code queries the DOM between the `expandedLotId = null` assignment and the `innerHTML = ''` clear. This is a theoretical race condition in single-threaded JS — effectively harmless, but the pattern of using numeric array indices as DOM IDs is fragile. More practically: if two lots from different auction houses have the same lot number, they get different `_idx` values (correct), but if a developer confuses `lot.lot` (the lot number from the auction house) with `lot._idx` (the array index), bugs result.
**Reproduction steps:** Theoretical — no practical impact in current code, but the naming collision between lot.lot (auction lot number) and lot._idx (array index used as DOM ID) is a maintainability concern.
**Suggested fix:** Use a more descriptive ID prefix like `id="lot-card-' + l._idx + '"` or use a composite key like `lot._house + '-' + lot.lot` for truly unique identification.
---

## BUG 59
**File:** index.html:2122-2125
**Area:** Data Display / houseFreshness Time Calculation
**Severity:** Low
**Description:** `houseFreshness()` at line 2122 calculates hours since last update using `Math.round((Date.now() - new Date(src.updatedAt).getTime()) / 3600000)`. If `src.updatedAt` is an invalid date string, `new Date(src.updatedAt).getTime()` returns `NaN`, and `Date.now() - NaN` = `NaN`. `Math.round(NaN / 3600000)` = `NaN`. The `NaN < 1` check (line 2123) is `false`, `NaN < 24` (line 2124) is `false`, so it falls through to line 2125 which does `Math.round(NaN / 24)` = `NaN`, displaying `"NaNd ago"` in the house checklist. This is visible to the user as a garbled freshness indicator next to the auction house name.
**Reproduction steps:** If any source has an invalid `updatedAt` value (e.g., empty string, malformed date), the house checklist shows "NaNd ago" next to that house name.
**Suggested fix:** Add a NaN guard: `if (isNaN(hrs)) return '';` after line 2122.
---

## Sweep completed at 2026-03-14T14:00:00Z — 6 new bugs (54-59), cumulative total 55 valid bugs

## BUG 60
**File:** index.html:2590
**Area:** Expanded Panel Image / Broken onerror Handler (HTML Parsing)
**Severity:** High
**Description:** The expanded panel image `onerror` handler embeds raw SVG from `getPropertyTypeIcon()` directly into an HTML attribute. The SVG contains double-quoted attributes (e.g., `viewBox="0 0 24 24" width="48" height="48"`). Since the `onerror` attribute is itself delimited by double quotes, the SVG's `"` characters prematurely terminate the attribute. The resulting HTML is malformed: `onerror="this.outerHTML='<div class=exp-large-img-placeholder><svg viewBox="` — the parser sees the `onerror` attribute ending at `viewBox="`, and the remaining SVG/HTML becomes garbage attribute names. This means the fallback **never works** for broken images in the expanded panel — the browser either ignores the malformed handler entirely or throws a parse error. By contrast, the card-level image (line 2548-2549) uses `getPlaceholderHtml()` called as a function reference in onerror, which works because it's evaluated at runtime, not embedded as a string literal.
**Reproduction steps:** Expand any lot with a broken imageUrl. The expanded panel shows a broken image icon. Inspect the `<img>` element's `onerror` attribute — it's malformed/truncated.
**Suggested fix:** Use the same pattern as the card image: store the property type in a `data-proptype` attribute and call `getPlaceholderHtml(this.dataset.proptype)` in the onerror handler, rather than inlining the SVG.
---

## BUG 61
**File:** index.html:2219-2220
**Area:** Filtering / POA Lots Pass Through Price Filters
**Severity:** Medium
**Description:** The min/max price filters use `!l.price` as a pass-through: `lots=lots.filter(l=>!l.price||l.price>=minP)`. This means POA lots (where `l.price` is `null`/`undefined`) always pass through price filters. A user who sets min price to £100k and max price to £200k will still see all POA lots in their results, even though these lots have no stated price and may be far outside the desired range. This is confusing UX — users expect price filters to exclude lots without prices.
**Reproduction steps:** Set min price to £100,000. Observe that POA lots (with no guide price) still appear in results alongside priced lots.
**Suggested fix:** When price filters are active, exclude lots where `!l.price` (i.e., treat POA as filtered out). Or add explicit UX: a checkbox "Include POA lots when filtering by price".
---

## BUG 62
**File:** index.html:2276-2277
**Area:** Sorting / POA Lots Sorted Inconsistently
**Severity:** Low
**Description:** When sorting by price ascending, lots without a price use `Infinity` as fallback (`a.price||Infinity`), pushing them to the end. When sorting by price descending, they use `0` as fallback (`b.price||0`), also pushing them to the end. This means POA lots always appear at the bottom regardless of sort direction. While arguably correct, it's inconsistent: ascending treats POA as "infinitely expensive" and descending treats POA as "free". If a user sorts descending expecting to see highest-priced lots first, POA lots (which might be the most expensive) are hidden at the bottom.
**Reproduction steps:** Sort by "Price: High → Low". POA lots appear at the very end, below even £1 lots.
**Suggested fix:** Group POA lots separately (after priced lots) with a section divider, or use `Infinity` for both directions to keep them consistently at the end.
---

## BUG 63
**File:** index.html:2571-2630
**Area:** Expanded Panel / No Scroll Into View
**Severity:** Medium
**Description:** When `expandCard(lot)` opens the expanded panel (line 2630: `cardEl.after(panel)`), the panel is inserted into the DOM below the clicked card but no scroll occurs. If the card is near the bottom of the viewport, the expanded panel renders below the fold and the user sees nothing happen — they must manually scroll down to see the detail panel. The `bridgeMatchLot()` function (line 2691) correctly calls `widget.scrollIntoView()` but this only applies when the BridgeMatch button is clicked, not when the card itself is clicked. Users clicking a card and seeing no visible change will think the click didn't register.
**Reproduction steps:** Scroll to a lot card that is near the bottom of the viewport. Click it. The expanded panel opens below the fold — nothing visible changes on screen.
**Suggested fix:** After `cardEl.after(panel)` on line 2630, add `panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` to ensure the panel is visible.
---

## BUG 64
**File:** index.html:2589-2590
**Area:** Expanded Panel / Image Not Lazy-Loaded
**Severity:** Low
**Description:** The card-level images use `loading="lazy"` (line 2547), but the expanded panel image (line 2590) does not. Since the expanded panel is dynamically inserted into the DOM (not present on page load), `loading="lazy"` wouldn't provide the same benefit, but the absence means the expanded panel image begins loading immediately when the panel is inserted — even if the panel is off-screen (see BUG 63). On slow connections or with large images, this could cause a noticeable layout shift or delay. More importantly, if a user rapidly clicks through multiple lot cards, each one triggers an image download that's never cancelled, potentially queueing up many concurrent HTTP requests.
**Reproduction steps:** Open DevTools Network tab. Rapidly click 5 different lot cards in succession. Observe that all 5 expanded panel images start downloading, even though only the last panel is visible.
**Suggested fix:** While lazy loading isn't critical here, cancel in-flight image loads when a panel is replaced. The simplest approach: set `existing.querySelector('.exp-large-img')?.src = ''` before removing the old panel on line 2575.
---

## BUG 65
**File:** index.html:2204-2205
**Area:** Data Integrity / _idx Mutation on Original LOTS Array
**Severity:** Medium
**Description:** `renderLots()` does `let lots=LOTS.slice()` (shallow copy) then `lots.forEach((l,i) => { l._idx = i })`. Since `slice()` is shallow, `l` is still a reference to the original object in `LOTS`. This mutates `_idx` on the original `LOTS` array elements. If `LOTS` has 1000 items but the filtered `lots` array has 50, only the first 50 items in `LOTS` get their `_idx` updated (to 0-49). The remaining 950 items retain their `_idx` from a previous render call. This means `LOTS[500]._idx` might be `500` from the initial render but after filtering, `LOTS[0]._idx` gets overwritten to `0`. If the card's `onclick="expandCard(LOTS[${l._idx}])"` references `LOTS[l._idx]`, it works correctly for items on the current page. However, the mutation is a side effect that could cause subtle bugs if `_idx` is used elsewhere or if filtering changes between renders.
**Reproduction steps:** Load 1000 lots. Apply a filter that reduces to 50 lots. The first 50 objects in LOTS now have `_idx` values 0-49 (correct for the filtered set), but objects 51-1000 still have their old `_idx` values from a previous render.
**Suggested fix:** Assign `_idx` on the original `LOTS` array once (not on the filtered copy), or use a non-mutating approach: store the index in a local variable instead of modifying the lot object.
---

## BUG 66
**File:** index.html:2527
**Area:** Urgency Badge / Timezone-Dependent Day Calculation
**Severity:** Low
**Description:** The urgency badge calculates days remaining as `Math.ceil((new Date(lot._auctionDate) - new Date()) / 86400000)`. `new Date(lot._auctionDate)` where `_auctionDate` is a date string like "2026-03-15" is parsed as midnight UTC. `new Date()` returns the current local time. For UK users in BST (UTC+1), at 11pm local time (10pm UTC), the difference between midnight UTC tomorrow and 11pm BST today could be ~1 hour = 0.04 days, which `Math.ceil` rounds to 1 day ("Tomorrow"). But at midnight BST (11pm UTC previous day), the calculation could flip to 2 days. This means the urgency badge can show different values depending on the user's timezone and time of day, and may show "Today" for an auction that's actually tomorrow in the user's local time.
**Reproduction steps:** Set system clock to 11:30pm BST. View a lot with an auction date of tomorrow. The badge may show "Today" instead of "Tomorrow".
**Suggested fix:** Parse both dates to midnight local time before calculating the difference, or use `toLocaleDateString()` comparison.
---

## Sweep completed at 2026-03-14T16:45:00Z — 7 new bugs (60-66), cumulative total 62 valid bugs

## ═══════════════════════════════════════════════════
## SWEEP 2026-03-14T19:00:00Z — Verification & New Bugs
## ═══════════════════════════════════════════════════

### PREVIOUSLY REPORTED BUGS NOW FIXED (code has been updated):
- **BUG 3** (score badge null) — FIXED: line 2523 now uses `lot.score ?? 0` with clamping
- **BUG 4** (parseInt radix) — FIXED: line 2649 now uses `?? '70'` and `, 10` radix
- **BUG 8** (expanded image empty alt) — FIXED: line 2594 now uses `lot.address || 'Auction property'`
- **BUG 12** (badge destruction on image error) — FIXED: onerror/onload now use `this.outerHTML` instead of `parentElement.innerHTML`, preserving sibling badge elements
- **BUG 19** (lot.house vs lot._house) — FIXED: line 2551 now uses `lot._house`
- **BUG 20** (loadAllLots no error state) — FIXED: catch block now shows error message with retry link; empty lots shows "No auction lots currently available"
- **BUG 22/63** (no scroll into view) — FIXED: line 2635 now has `panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })`
- **BUG 24** (blurred class not applied) — FIXED: line 2424 adds `blurredClass` to card div
- **BUG 25** (expandCard no blurred check) — FIXED: line 2576 checks `lot.blurred` and shows paywall
- **BUG 30** (no HTTP status check) — FIXED: line 1123 checks `r.ok`

### STILL VALID BUGS (confirmed present in current code):
- **BUG 1** — Expanded class not removed from previous card (line 2578-2590)
- **BUG 5** — Finance debounce race condition with orphaned loading state
- **BUG 7** — Expanded panel missing key lot info (address, date, URL, yield, beds, tenure)
- **BUG 11** — Finance CTA deep link to /check doesn't pre-fill form params
- **BUG 13** — Filter/sort change destroys expanded panel without warning
- **BUG 17** — Price as string from DOM extractors not coerced to number
- **BUG 18** — No Escape key handler to dismiss expanded panel
- **BUG 26** — Blurred lots show "Standard" deal type instead of masked label
- **BUG 27** — Urgency badge timezone-dependent day calculation
- **BUG 33** — priceText overrides guide price but finance widget uses numeric price
- **BUG 34** — Score sort does not sort lots within sections (no `else` branch for score)
- **BUG 35** — Double-click flicker on card expand
- **BUG 39** — No close button on expanded panel (critical on mobile)
- **BUG 42** — Property type mapping too broad for finance check
- **BUG 47** — endedClass vs urgency badge use different date comparison methods
- **BUG 48** — Expanded panel placeholder lacks "No photo available" label
- **BUG 49** — Mobile padding overflow on expanded panel at narrow widths
- **BUG 54** — `esc()` doesn't escape double quotes, unsafe in attribute contexts
- **BUG 55** — Filter dropdown values vulnerable to quote injection via esc()
- **BUG 60** — Expanded panel image onerror handler is malformed (SVG double quotes break attribute)

---

## BUG 67
**File:** index.html:2550 (getCardImageHtml), line 2593-2594 (expandCard)
**Area:** Image Loading / Hanging Connection — No Timeout Fallback
**Severity:** Medium
**Description:** The card image shimmer loading animation (line 2550) plays until `onload` or `onerror` fires. If an image URL points to a server that accepts the connection but never responds (TCP connection hangs), neither `onload` nor `onerror` fires. The shimmer animation runs indefinitely — the user sees a perpetually pulsing placeholder with no indication that loading has stalled. The same applies to the expanded panel image (line 2593-2594), which has no loading indicator at all for slow-loading images — it just shows nothing until the image renders. There is no `setTimeout` fallback to replace hung images with the placeholder after a reasonable period (e.g., 10 seconds).
**Reproduction steps:** Set a lot's imageUrl to a URL that hangs (e.g., a server that accepts TCP but never sends data). Load the page. The card shows an infinite shimmer animation. Expand the card — the expanded panel shows nothing in the image area while the request hangs.
**Suggested fix:** Add a timeout to card image loading: after the `<img>` is rendered, set a `setTimeout` that checks if the image has loaded (`img.complete && img.naturalWidth > 0`) and replaces it with a placeholder if not. E.g., add `data-loadtimer` and a MutationObserver or post-render sweep.
---

## BUG 68
**File:** index.html:2626
**Area:** Finance Widget / LTV Slider Max Misleading for Non-Residential
**Severity:** Low
**Description:** The LTV slider has a fixed range of 50-80% (line 2626: `min="50" max="80"`). This range is appropriate for standard residential purchases, but for land, development sites, and commercial properties, most bridging lenders cap LTV at 60-70%. Showing 80% LTV as available for a land lot misleads the user — they may set 80% and get "0 lenders match" without understanding why. The slider max should be property-type-aware: e.g., 75% for residential, 65% for commercial, 60% for land.
**Reproduction steps:** Expand a lot with `propType: 'land'`. Move the LTV slider to 80%. Run finance check. Likely 0 lenders match at 80% LTV for land, but the slider implies it's a valid option.
**Suggested fix:** Set slider max dynamically based on `lot.propType`: `const maxLtv = /land/i.test(lot.propType) ? 65 : /commercial/i.test(lot.propType) ? 70 : 80;`
---

## BUG 69
**File:** index.html:2597, 2604
**Area:** Expanded Panel / Duplicate Bullet Content
**Severity:** Low
**Description:** The expanded panel displays lot bullets in TWO places: (1) the "AI Analysis" section (line 2597: `analysisText = (lot.bullets || []).join('. ')`) shows all bullets concatenated with ". " separator, and (2) the bullet list (line 2604: `bulletsHtml = (lot.bullets || []).slice(0, 6).map(...)`) shows bullets as a `<ul>` list on the right side. The user sees the same information twice — once as a prose paragraph under "AI Analysis" and again as a bulleted list under the finance widget. This is redundant and wastes vertical space, especially on mobile where the panel is single-column.
**Reproduction steps:** Expand any lot that has bullets data. The same bullet points appear in the "AI Analysis" text block AND in the bullet list below the finance widget.
**Suggested fix:** Remove one of the two representations. The structured `<ul>` list is clearer — consider removing the concatenated `analysisText` paragraph, or move the analysis text to a separate "description" field distinct from bullets.
---

## BUG 70
**File:** index.html:2625-2626
**Area:** Finance Widget / LTV Slider Accessible Name Missing
**Severity:** Low
**Description:** The LTV range slider (`<input type="range">` at line 2626) has no `aria-label`, `aria-labelledby`, or associated `<label>` element. The only visible label is the text "Loan to Value" in a `<span class="fw-slider-label">` but this is not programmatically associated with the slider. Screen reader users hear an unlabelled slider with no context about what it controls or its purpose. The slider value display (`<span class="fw-slider-value">70%</span>`) is also not linked via `aria-valuenow` or `aria-valuetext`.
**Reproduction steps:** Navigate to an expanded lot panel using a screen reader (e.g., NVDA, VoiceOver). Tab to the LTV slider. It announces as an unlabelled slider.
**Suggested fix:** Add `aria-label="Loan to Value percentage"` to the range input, and set `aria-valuenow` and `aria-valuetext` via the `updateLTV()` function.
---

## BUG 71
**File:** index.html:2622
**Area:** Finance Widget / Price Displayed Without "Guide" Qualifier
**Severity:** Low
**Description:** The finance widget displays the purchase price as just `£150,000` (line 2622). However, the card displays it as `Guide £150,000` (line 2405). The finance widget omits the "Guide" qualifier, which could mislead users into thinking this is a confirmed/actual price rather than a guide price. Auction guide prices are indicative and the final sale price can be significantly higher. Users who run a finance check based on the guide price may get lender matches that become irrelevant if the lot sells above guide.
**Reproduction steps:** Compare the price shown on a lot card ("Guide £150,000") vs the price in the expanded finance widget ("£150,000"). The finance widget presents the guide price as if it's a confirmed purchase price.
**Suggested fix:** Display as "Guide £150,000" in the finance widget, and consider adding a note: "Based on guide price — actual sale price may differ".
---

## Sweep completed at 2026-03-14T19:00:00Z — 5 new bugs (67-71), 10 previously reported bugs confirmed fixed, 20 still-valid bugs verified, cumulative total 52 net valid bugs

## ═══════════════════════════════════════════════════
## SWEEP 2026-03-14T21:00:00Z — Independent Verification Pass
## ═══════════════════════════════════════════════════

### Summary
Independent full re-read of `expandCard()` (lines 2579-2640), `card()` (lines 2405-2439), `triggerFinanceCheck()` (lines 2648-2688), `bridgeMatchLot()` (lines 2690-2708), `getCardImageHtml()` (lines 2546-2561), CSS rules (lines 420-510, 534-558), and `loadAllLots()` (lines 1119-1153).

### CONFIRMED STILL-VALID HIGH/CRITICAL BUGS:
- **BUG 60** — Expanded panel `onerror` handler is malformed. SVG double quotes from `getPropertyTypeIcon()` break the HTML attribute delimiter. Verified at line 2598: the inlined SVG `viewBox="0 0 24 24"` terminates the `onerror="..."` attribute prematurely. Fallback never works for broken images in the expanded panel.
- **BUG 54** — `esc()` function (line 1041) uses `textContent → innerHTML` which only escapes `<`, `>`, `&` — NOT `"`. Used in attribute contexts throughout (src, alt, aria-label, data-proptype). Any lot data containing `"` would break out of attributes.

### CONFIRMED STILL-VALID MEDIUM BUGS:
- **BUG 7** — Expanded panel still missing key info (address, auction date, yield, beds, tenure, listing URL)
- **BUG 39** — No close button on expanded panel; on mobile the triggering card scrolls off-screen
- **BUG 34** — Lots within score sections not sorted by score (no score sort branch)
- **BUG 49** — Expanded panel keeps 24px padding at all breakpoints; cramped on 360px screens
- **BUG 69** — Bullets displayed twice (as prose in AI Analysis + as list under finance widget)

### NO NEW BUGS FOUND
All independently identified issues matched existing documented bugs. The existing bug log is comprehensive for the detail page area.

## Sweep completed at 2026-03-14T21:00:00Z — verification-only sweep, 0 new bugs, 7 key bugs re-confirmed as still present

## ═══════════════════════════════════════════════════
## SWEEP 2026-03-14T23:00:00Z — Independent Verification Pass (Agent Restart)
## ═══════════════════════════════════════════════════

### Summary
Full independent re-read of `expandCard()` (lines 2579-2640), `card()` (lines 2405-2439), `triggerFinanceCheck()` (lines 2648-2688), `bridgeMatchLot()` (lines 2690-2708), `getCardImageHtml()` (lines 2546-2561), `renderLots()` (lines 2205-2401), `loadAllLots()` (lines 1119-1153), `esc()` (line 1041), and `getPropertyTypeIcon()` (lines 2510-2518).

### Areas Verified
1. **Core Rendering** — `expandCard()` builds panel correctly for standard lots. Null/missing field handling present for `address`, `price`, `propType`, `bullets`, `opps`, `risks`.
2. **Data Fetching** — `loadAllLots()` has proper error handling (line 1148-1152) with user-visible error message and reload link. Empty-lot case also handled (line 1133-1136).
3. **Image Gallery** — Single image, not carousel. Card images have robust `onerror`/`onload` handlers. Expanded panel `onerror` is broken (BUG 60 confirmed).
4. **Navigation** — No back button or close button on expanded panel (BUG 39 confirmed). Panel destroyed on `renderLots()` re-run (BUG 13 confirmed).
5. **`_idx` Stability** — Verified that `_idx` is assigned from `LOTS.slice()` indices before filtering/sorting, so `LOTS[l._idx]` references remain valid within a single render cycle. Cross-render instability (BUG 28) still valid.
6. **Paywall/Blurred Lots** — `expandCard()` correctly guards blurred lots (line 2580). Card-level blur CSS exists (line 423-426). BUG 25 (paywall bypass via `bridgeMatchLot`) previously documented — `bridgeMatchLot()` calls `expandCard()` which checks `lot.blurred`, so this may be a false positive if `blurred` is set on the lot object.
7. **XSS via `esc()`** — BUG 54 confirmed: `esc()` uses `textContent→innerHTML` which doesn't escape `"`, allowing attribute breakout when used in `src="..."`, `alt="..."`, `aria-label="..."` contexts.

### CONFIRMED STILL-VALID CRITICAL/HIGH BUGS:
- **BUG 60** — Expanded panel `onerror` SVG double-quote breakout. Verified at line 2598.
- **BUG 54** — `esc()` doesn't escape `"`. Used in attribute contexts throughout.

### CONFIRMED STILL-VALID MEDIUM BUGS:
- **BUG 7** — Expanded panel missing key info (address, lot number, auction date, yield, beds, tenure, listing URL)
- **BUG 13** — Expanded panel destroyed on any filter/sort change
- **BUG 28** — `_idx` changes across render cycles, breaking in-flight finance checks
- **BUG 39** — No close button on expanded panel
- **BUG 49** — Expanded panel padding not responsive at small breakpoints
- **BUG 69** — Bullets displayed twice (prose + list)

### NO NEW BUGS FOUND
All independently identified issues matched existing documented bugs. The bug log is comprehensive for the detail page area.

## Sweep completed at 2026-03-14T23:00:00Z — verification-only sweep, 0 new bugs, 8 key bugs re-confirmed as still present (2 critical, 6 medium)

## ═══════════════════════════════════════════════════
## SWEEP 2026-03-14T23:30:00Z — Independent Verification Pass (Agent Restart)
## ═══════════════════════════════════════════════════

### Summary
Full independent re-read of all detail-page related code: `expandCard()` (lines 2579-2640), `card()` (lines 2405-2439), `triggerFinanceCheck()` (lines 2648-2688), `bridgeMatchLot()` (lines 2690-2708), `getCardImageHtml()` (lines 2546-2561), `getCardImageBadges()` (lines 2524-2544), `renderLots()` (lines 2205-2401), `loadAllLots()` (lines 1119-1153), `esc()` (line 1041), `getPropertyTypeIcon()` (lines 2510-2518), `buildHouseChecklist()` (lines 2138-2149), responsive CSS (lines 534-570).

## BUG 72
**File:** index.html:2146
**Area:** House Checklist / XSS via esc() in Attribute (data-house)
**Severity:** Medium
**Description:** `buildHouseChecklist()` at line 2146 uses `data-house="'+esc(h)+'"` and `value="'+esc(h)+'"` for house names. Per BUG 54, `esc()` does not escape double quotes. If an auction house name contains a `"` character (e.g., `Smith "The Auctioneer" & Co`), the double quote breaks out of the `data-house` and `value` attributes, causing malformed HTML. While auction house names are typically controlled server-side (from a curated list), any house name coming from Gemini extraction for "unknown" houses could contain quotes. The `filterHouseList()` function at line 2160 uses `lbl.dataset.house` which would contain only the truncated portion before the breakout, causing house filtering to malfunction.
**Reproduction steps:** If any auction house name contains a `"` character, the house checklist renders malformed HTML. The house filter breaks — selecting/deselecting that house has no effect because the `value` attribute is truncated.
**Suggested fix:** Apply the same `escAttr()` fix recommended in BUG 54 — escape `"` to `&quot;` in attribute contexts. Or use DOM APIs (`el.setAttribute('data-house', h)`) instead of innerHTML string building.
---

## BUG 73
**File:** index.html:2143
**Area:** House Checklist / "All houses" Checkbox Count Incorrect After Filter
**Severity:** Low
**Description:** The "All houses" label at line 2143 displays `LOTS.length` as the count. But `LOTS` may be `smartResults` (after a smart search), not `ALL_LOTS`. If a smart search returns 50 results, the "All houses" count shows "50" — but after clicking "Back to auctions", `buildLotFilters()` is called with `LOTS = ALL_LOTS` (2000+ lots), so the count updates correctly. However, during a smart search result view, the "All houses (50)" label is misleading because those 50 lots may span only 5 houses, yet it implies there are 50 houses. The per-house counts are correct (they're computed from `LOTS.forEach`), but the aggregate count on the "All" checkbox represents total lots, not total houses — a labelling inconsistency.
**Reproduction steps:** Run a smart search that returns 50 lots across 5 auction houses. The house checklist shows "All houses 50" — the number 50 represents lots, not houses, which is confusing in the context of a house filter.
**Suggested fix:** Change to show house count: `'All houses <span class="house-count">'+houses.length+'</span>'` or `'All ('+houses.length+' houses, '+LOTS.length+' lots)'`.
---

## BUG 74
**File:** index.html:2425, 2690-2708
**Area:** BridgeMatch Button / Click Doesn't Stop Card Expand
**Severity:** Low
**Description:** The "BridgeMatch It" button uses `onclick="bridgeMatchLot('+l._idx+',event)"` which calls `event.stopPropagation()` at line 2691. This correctly prevents the card's `onclick="expandCard(...)"` from firing. However, if the lot is blurred, `bridgeMatchLot()` calls `expandCard(lot)` at line 2697, which checks `lot.blurred` and shows the paywall (line 2580). But there's an edge case: the `bmBtn` is only rendered when `l.price` exists (line 2425). For blurred lots, `stripAIFields()` does NOT strip `price`. So blurred lots WITH a price show the "BridgeMatch It" button, which when clicked, shows the paywall via `expandCard()`. But the button itself is still visible and clickable on the blurred card — it's not hidden by the `.lot-card.blurred .card-footer .card-view-link{display:none}` CSS because that only targets `.card-view-link`, not `.card-bm-btn`. The "BridgeMatch It" button remains fully visible and styled on blurred cards, inviting clicks that just show a paywall.
**Reproduction steps:** Load as non-logged-in user. Find a blurred lot with a price. The "BridgeMatch It" button is visible and clickable, but clicking it just shows a paywall modal.
**Suggested fix:** Add CSS rule: `.lot-card.blurred .card-bm-btn{display:none}` or `pointer-events:none;opacity:0.4`.
---

## BUG 75
**File:** index.html:2593, 2328
**Area:** Expanded Panel / expandedLotId Not Cleared When Switching Pages
**Severity:** Low
**Description:** When the user navigates to a different page via pagination (`goPage()`), `renderLots()` is called which sets `expandedLotId = null` (line 2328) and rebuilds the DOM. This correctly clears the expanded state. However, the `expanded` CSS class on the card element is never removed (it's destroyed with `innerHTML = ''`), and `expandedLotId` is set to null — so if the user navigates back to the original page, the card that was previously expanded is recreated without the `expanded` class (correct) and without an expanded panel (correct). No bug here for pagination. BUT: if the user changes the "per page" count (`fPerPage`) to a larger value that includes both the previously-expanded card and new cards, `renderLots()` rebuilds everything fresh. The `expandedLotId = null` at line 2328 means the panel is gone, but the lot's `_idx` may have changed (see BUG 65). This is a duplicate of BUG 13 — no new bug here.
**Reproduction steps:** N/A — false positive, subsumed by BUG 13.
---

## BUG 76
**File:** index.html:2639
**Area:** Expanded Panel / scrollIntoView Race With CSS Animation
**Severity:** Low
**Description:** After inserting the expanded panel, line 2639 calls `panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })`. However, the panel has a CSS animation `slideDown .25s ease` (line 471) that transitions from `max-height:0` to `max-height:1000px`. At the moment `scrollIntoView` is called, the panel's computed height is 0 (or near 0, depending on browser paint timing). The browser calculates the scroll target based on the panel's current (near-zero) height, potentially scrolling to the wrong position. By the time the animation completes 250ms later, the panel is at full height and may extend below the viewport. This is especially noticeable on slower devices where the browser hasn't yet computed the final layout.
**Reproduction steps:** On a slower device/throttled CPU, click a lot card near the middle of the viewport. The page scrolls to where the panel starts (correct), but the panel's full content extends below the fold because `scrollIntoView` calculated the target before the animation completed.
**Suggested fix:** Delay `scrollIntoView` until after the animation: `setTimeout(() => panel.scrollIntoView({behavior:'smooth',block:'nearest'}), 260);` or use `requestAnimationFrame` after the animation ends.
---

### CONFIRMED STILL-VALID CRITICAL/HIGH BUGS:
- **BUG 60** — Expanded panel `onerror` SVG double-quote breakout. Verified at line 2598.
- **BUG 54** — `esc()` doesn't escape `"`. Used in attribute contexts throughout.

### CONFIRMED STILL-VALID MEDIUM BUGS:
- **BUG 7** — Expanded panel missing key info (address, lot number, auction date, yield, beds, tenure, listing URL)
- **BUG 13** — Expanded panel destroyed on any filter/sort change
- **BUG 28** — `_idx` changes across render cycles, breaking in-flight finance checks
- **BUG 34** — Score sort does not sort within sections
- **BUG 39** — No close button on expanded panel (critical on mobile)
- **BUG 42** — Property type mapping too broad for finance check
- **BUG 49** — Expanded panel padding not responsive at small breakpoints
- **BUG 69** — Bullets displayed twice (prose + list)

## Sweep completed at 2026-03-14T23:30:00Z — 4 new bugs (72-73, 74, 76; BUG 75 retracted as false positive), 10 key bugs re-confirmed as still present (2 critical, 8 medium)

## ═══════════════════════════════════════════════════
## SWEEP 2026-03-14T24:00:00Z — Independent Verification Pass (Agent Restart)
## ═══════════════════════════════════════════════════

### Summary
Full independent re-read of `expandCard()` (lines 2579-2640), `card()` (lines 2405-2439), `triggerFinanceCheck()` (lines 2648-2688), `bridgeMatchLot()` (lines 2690-2708), `getCardImageHtml()` (lines 2546-2561), `getCardImageBadges()` (lines 2524-2544), `getSignalChips()` (lines 2563-2577), `getPropertyTypeIcon()` (lines 2510-2518), `getPlaceholderHtml()` (lines 2520-2522), `loadAllLots()` (lines 1119-1153), `renderLots()` (line 2205+), `esc()` (line 1041), `safeHref()` (line 1042), `updateLTV()` (lines 2642-2645), CSS (lines 448-558), `bridgematch-lite.html` pre-fill logic (lines 1005-1032).

### Areas Verified
1. **Core Rendering** — `expandCard()` builds panel correctly for standard lots. Null/missing field handling present for `address`, `price`, `propType`, `bullets`, `opps`, `risks` via `|| []`, `|| ''`, ternaries.
2. **Data Fetching** — `loadAllLots()` has error handling (lines 1148-1152) with user-visible error message and reload link. Empty-lot case handled (lines 1133-1136).
3. **Image Gallery** — Single image only (no carousel/gallery). Card images have `onerror`/`onload` handlers that degrade gracefully. Expanded panel `onerror` is broken due to inlined SVG double quotes (BUG 60 confirmed).
4. **Navigation** — No close button or back button on expanded panel (BUG 39 confirmed). Panel destroyed on `renderLots()` re-run (BUG 13 confirmed). No `/lot/:id` URL routing — detail views are ephemeral inline panels.
5. **Null/Edge Cases** — `lot.price === 0` treated as falsy (shows "POA" on card, "TBA" in widget, hides finance button) — acceptable since 0 isn't a valid auction price. `lot.score` now uses `?? 0` with clamping (BUG 3 fixed). `lot.address` defaults to "Address not available". `lot.propType` defaults to "house" for icons, "Residential" for widget.
6. **Finance Widget Deep Link** — `/check?loan=X&value=Y&type=Z` sends params that don't match `bridgematch-lite.html` expectations (`price` not `value`, `loan` not read). BUG 11 confirmed.
7. **`_idx` Stability** — `_idx` is reassigned in `renderLots()` line 2213 based on filtered array position. Card onclick uses `LOTS[l._idx]` which indexes into the unfiltered `LOTS` array. After filtering, `_idx` values don't correspond to positions in `LOTS`. BUG 28 confirmed — this can cause the wrong lot to expand when filters are active.

### CONFIRMED STILL-VALID CRITICAL/HIGH BUGS:
- **BUG 60** — Expanded panel `onerror` inlines SVG with double quotes from `getPropertyTypeIcon()`, breaking the HTML attribute. Fallback never works for broken images in expanded panel. Line 2598.
- **BUG 54** — `esc()` uses `textContent→innerHTML` which only escapes `<`, `>`, `&` — NOT `"`. Used in `src`, `alt`, `aria-label`, `data-proptype` attribute contexts throughout. Line 1041.

### CONFIRMED STILL-VALID MEDIUM BUGS:
- **BUG 7** — Expanded panel missing address, lot number, auction date, yield, beds, tenure, listing URL
- **BUG 11** — Finance CTA `/check` link sends `loan`+`value` params but `bridgematch-lite.html` expects `price`
- **BUG 13** — Expanded panel destroyed on any filter/sort change without warning
- **BUG 28** — `_idx` reassigned on each `renderLots()`, causing card onclick to reference wrong lot in filtered views
- **BUG 34** — Score sort does not sort within sections
- **BUG 39** — No close button on expanded panel (critical on mobile where card scrolls off-screen)
- **BUG 42** — Property type mapping too broad for finance check
- **BUG 49** — Expanded panel 24px padding not responsive at narrow breakpoints
- **BUG 69** — Bullets displayed twice (as prose in AI Analysis + as list under finance widget)

### NO NEW BUGS FOUND
All independently identified issues matched existing documented bugs. The bug log is comprehensive for the detail page area.

## Sweep completed at 2026-03-14T24:00:00Z — verification-only sweep, 0 new bugs, 11 key bugs re-confirmed as still present (2 critical, 9 medium)
