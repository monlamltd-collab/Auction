# BridgeMatch Bug Log — Listings Agent
Started: Sat Mar 14 03:13:46 GMTST 2026

## BUG 1
**File:** index.html:2542-2543 (getCardImageHtml function)
**Area:** Property Type Rendering / Image Fallback
**Severity:** High
**Description:** When a lot card image fails to load (`onerror`) or loads as a very small image (width < 120 or height < 90), the handler replaces `this.parentElement.innerHTML` with `getPlaceholderHtml(...)`. This destroys ALL badge overlays (auction house name, score badge, vacant badge, urgency/ended badge) because they are sibling elements inside the same `.card-image-wrapper` parent. The placeholder function does not re-render badges. Compare with the no-image path (line 2534-2537) which correctly includes badges alongside the placeholder.
**Reproduction steps:**
1. Load listings page with lots that have broken image URLs or very small thumbnails (< 120x90px)
2. Observe that the card shows the placeholder icon but no score badge, no house badge, no vacant badge, and no urgency badge
3. Compare with lots that have no `imageUrl` at all — those correctly show badges
**Suggested fix:** Change the `onerror` and small-image `onload` handlers to preserve badges. Either: (a) replace only the `<img>` and shimmer elements instead of the entire parent innerHTML, or (b) append `getCardImageBadges(lot)` after the placeholder in the handler. Option (a) is cleaner — e.g., `this.style.display='none';this.previousElementSibling.innerHTML=getPlaceholderHtml(...)` with the shimmer div acting as the placeholder container.
---

## BUG 2
**File:** index.html:2541 (getCardImageHtml function)
**Area:** Property Type Rendering / Accessibility
**Severity:** Low
**Description:** The `<img>` alt text uses `lot.house` but the correct property name is `lot._house` (with underscore prefix). Since `lot.house` is always undefined, the alt text always falls back to "auction lot" instead of showing the actual auction house name. E.g., alt text is "123 Main Street — auction lot" instead of "123 Main Street — Allsop".
**Reproduction steps:**
1. Inspect any lot card's `<img>` element in DevTools
2. Check the `alt` attribute — it will always end with "— auction lot" regardless of which auction house the lot belongs to
**Suggested fix:** Change `lot.house` to `lot._house` on line 2541.
---

## BUG 3
**File:** index.html:2233 (renderLots filter pass)
**Area:** Search
**Severity:** Medium
**Description:** The text search filter (`fSearch`) only searches across `lot.address` and `lot.bullets`. It does not search: `lot.opps` (opportunities like "Needs modernisation", "Development potential"), `lot.risks` (e.g., "Knotweed", "Flood risk"), `lot.dealType` (e.g., "Title Split", "Refurb"), `lot.propType` (e.g., "house", "flat"), `lot._house` (auction house name), or `lot.tenure`. This means a user typing "knotweed" or "title split" or "freehold" in the text filter won't find matching lots unless those exact terms happen to appear in the address or AI analysis bullets.
**Reproduction steps:**
1. Load listings with lots that have "Knotweed" in their risks array
2. Type "knotweed" in the text search filter
3. Observe that the lot does NOT appear in filtered results (unless "knotweed" also appears in the lot's address or bullets)
4. Same issue with searching for "title split", "freehold", auction house names, etc.
**Suggested fix:** Extend the filter on line 2233 to also search `lot.opps`, `lot.risks`, `lot.dealType`, `lot.propType`, `lot._house`, and `lot.tenure`. E.g.: `(l.opps||[]).join(' ').toLowerCase().includes(fs)||(l.risks||[]).join(' ').toLowerCase().includes(fs)||(l.dealType||'').toLowerCase().includes(fs)||(l._house||'').toLowerCase().includes(fs)`
---

## BUG 4
**File:** index.html:2216-2217 (renderLots price filter)
**Area:** Filters / Price Range
**Severity:** Medium
**Description:** The min/max price filters explicitly pass through lots with no price (`!l.price`). This means POA (Price On Application) lots always appear in price-filtered results. If a user filters for "Max £100k", they still see all POA lots mixed in with the results. The user would have to additionally select "Excl. POA" from a separate dropdown to remove them. This is counterintuitive — when filtering by price range, users expect only priced lots in that range.
**Reproduction steps:**
1. Load listings with a mix of priced and POA lots
2. Set Max Price to £100,000
3. Observe that POA lots still appear alongside lots under £100k
**Suggested fix:** Either (a) automatically exclude POA lots when a price range filter is active, or (b) add a note in the UI near the price filter indicating POA lots are included unless explicitly excluded. Option (a) is better UX.
---

## BUG 5
**File:** index.html:2222-2225 (renderLots condition filter)
**Area:** Filters / Condition
**Severity:** Medium
**Description:** The "Good" condition filter is implemented as `l.condition !== 'needs work'`, which means lots with `condition = null`, `undefined`, `''` (empty string), or any unexpected value all pass through as "good". Lots with missing condition data (not extracted by AI) are falsely categorised as "good condition" when they are actually "unknown condition". This inflates the count of good-condition properties and may mislead users.
**Reproduction steps:**
1. Load listings where some lots have no condition data (condition is null/undefined)
2. Select "Good" from the Condition filter
3. Observe that lots with unknown/null condition appear as if they are good condition
**Suggested fix:** Change the "good" filter to explicitly match: `l.condition === 'good'`. Alternatively, add an "Unknown" option to the condition dropdown for lots with no data, and make the "Good" filter only match confirmed good condition.
---

## BUG 6
**File:** index.html:2314 (renderLots active filter highlighting)
**Area:** Filters / UI
**Severity:** Low
**Description:** The active-filter highlight logic excludes the value `'available'` from triggering the highlight: `sel.value!==''&&sel.value!=='all'&&sel.value!=='available'&&sel.value!=='score'`. This means when a user selects "Available only" from the sold/status filter (`fSoldTop`), the dropdown does NOT get the `active-filter` visual indicator (typically a coloured border or background). The filter IS applied functionally, but there's no visual feedback that it's active, which could confuse users who've forgotten they set it.
**Reproduction steps:**
1. Load listings page
2. Select "Available only" from the lot status dropdown
3. Observe that the dropdown does not get the `active-filter` CSS class, unlike other active filters
4. Select "Sold only" — this DOES get highlighted as active (since 'sold' is not in the exclusion list)
**Suggested fix:** Remove `'available'` from the exclusion list on line 2314. The line should be: `sel.classList.toggle('active-filter',sel.value!==''&&sel.value!=='all'&&sel.value!=='score');`
---

## BUG 7
**File:** index.html:2699-2711 (syncFiltersToURL / restoreFiltersFromURL)
**Area:** Filters / URL Sharing
**Severity:** Low
**Description:** The shareable filter URL feature (`FILTER_PARAMS` array) does not include `fLookahead`, `fIncludePrevious` (checkbox), or the house multi-select (`_selectedHouses`). When a user shares a filtered URL, these three filter states are lost. The recipient will see different results than the sender intended, particularly if the sender had filtered to specific houses or limited the auction lookahead.
**Reproduction steps:**
1. Load listings, select 2-3 specific auction houses, set lookahead to "Next auction", uncheck "Previous"
2. Copy the URL from the browser
3. Open it in a new tab — the house selection, lookahead, and "Previous" checkbox are all reset to defaults
**Suggested fix:** Add `fLookahead` to `FILTER_PARAMS`. For `fIncludePrevious` (checkbox), add special handling since it's a checkbox not a select. For house selection, serialize `_selectedHouses` as a comma-separated URL param.
---

## BUG 8
**File:** index.html:2218 (renderLots beds filter)
**Area:** Filters / Bedrooms
**Severity:** Low
**Description:** The bedrooms filter uses `!l.beds||l.beds>=minBeds`, which passes through lots with no bedroom data (beds is null/undefined/0). If a user filters for "3+ beds", they'll also see all lots where bedroom count wasn't extracted. This follows the same pattern as the price filter (BUG 4) — unknown data passes through filters, potentially showing irrelevant results.
**Reproduction steps:**
1. Load listings with some lots that have no bedroom data
2. Set Beds filter to "3+"
3. Observe that lots with unknown/null beds count still appear
**Suggested fix:** Either exclude lots with no beds data when a beds filter is active, or add a visual indicator (e.g., "? beds" pill) so users can see which lots have missing data.
---

## BUG 9
**File:** index.html:2214
**Area:** Filters / Postcode
**Severity:** High
**Description:** The postcode filter line `const fpc=$('fPostcode')?.value.trim().toUpperCase()||'';` has a null-safety gap. The optional chaining `?.` correctly guards against `$('fPostcode')` being null (returning `undefined`), but `.trim()` is then called on `undefined`, which will throw `TypeError: Cannot read properties of undefined (reading 'trim')`. The optional chaining only protects the `.value` access, not the subsequent method chain. If the `fPostcode` element is ever removed from the DOM (e.g., during a layout change or if the element hasn't rendered yet), this crashes the entire `renderLots()` function and no lots are displayed.
**Reproduction steps:**
1. Remove or rename the `fPostcode` element from the DOM (simulate element not found)
2. Trigger `renderLots()` (e.g., change any filter)
3. Observe `TypeError: Cannot read properties of undefined (reading 'trim')` in console
4. No lots render — the page appears broken
**Suggested fix:** Change to `const fpc=($('fPostcode')?.value||'').trim().toUpperCase();` — this ensures `.trim()` is always called on a string.
---

## BUG 10
**File:** index.html:2515-2517 (getCardImageBadges function)
**Area:** Property Type Rendering / Score Badge
**Severity:** Medium
**Description:** If `lot.score` is `undefined` or `null` (e.g., a lot that wasn't scored), the score badge displays the literal text "undefined" or "null". The ternary comparisons (`lot.score >= 3`) silently evaluate to `false` for undefined (defaulting to 'low' class), and `lot.score > 0` is also `false` (so `sign` = ''), but the badge innerHTML becomes `'' + undefined` = `"undefined"`. Every lot card unconditionally renders a score badge — there's no guard to skip it when score is missing.
**Reproduction steps:**
1. Inject or find a lot with `score: undefined` or `score: null`
2. Observe the card renders a badge showing "undefined" with the 'low' CSS class
**Suggested fix:** Guard the badge rendering: `if (lot.score != null) { ... }` or default score to 0: `const s = lot.score ?? 0;`
---

## BUG 11
**File:** index.html:2228-2230 (renderLots affordability filter)
**Area:** Filters / Affordability
**Severity:** Medium
**Description:** All three affordability filters (`affordable`, `in_budget`, `full_finance`) are gated by `fp.cash` being truthy. If the user enters £0 as their cash amount, `fp.cash` evaluates to `0` (falsy), and none of the affordability filters apply. The user selects an affordability tier from the dropdown, sees no filtering effect, and gets no indication that the filter is silently disabled. This also affects users who haven't entered any finance profile — the affordability dropdown is visible and selectable but does nothing.
**Reproduction steps:**
1. Open the finance profile and set cash to £0 (or leave it empty)
2. Select "Affordable" from the affordability filter dropdown
3. Observe that all lots still appear — the filter has no effect
4. No error or warning is shown to the user
**Suggested fix:** Either (a) use `fp.cash != null` or `fp.cash >= 0` instead of `fp.cash` as the guard, or (b) disable/hide the affordability dropdown when no finance profile cash value is set, with a tooltip explaining why.
---

## BUG 12
**File:** index.html:2337-2340 (renderLots title split categorisation)
**Area:** Sorting / Title Splits
**Severity:** Medium
**Description:** When `showTSGroup` is `false` (i.e., during a smart search that isn't about title splits), title split lots with score ≥ 2 are NOT excluded from the `topL`, `midL`, and `rest` arrays because the exclusion condition `!(showTSGroup && l.titleSplit && l.score >= 2)` always evaluates to `true` when `showTSGroup` is `false`. This is correct — they appear in normal categories. However, the `tsL` array is still populated with these lots (`lots.filter(l=>l.titleSplit&&l.score>=2)`), and on line 2343 it's only rendered `if(tsL.length && showTSGroup)`. So the `tsL` array is computed unnecessarily. More critically, when `showTSGroup` later becomes `true` (user clears the smart search), lots that were in both `tsL` AND `topL` (title split + score ≥ 3) appear in BOTH the "Title Splits" section and the "Top Picks" section — they are duplicated in the rendered output.
**Reproduction steps:**
1. Load catalogue analysis with lots that have `titleSplit: true` and `score >= 3`
2. Sort by score (default)
3. Observe the lot appears in BOTH "Title Splits" AND "Top Picks" sections
**Suggested fix:** The `topL` filter should always exclude title-split lots with score ≥ 2 when score sorting is active, regardless of `showTSGroup`. Change `topL` filter to: `lots.filter(l=>l.score>=3&&!(l.titleSplit&&l.score>=2))`. Same for `midL` and `rest`. Then only render the `tsL` section when `showTSGroup` is true — the lots simply won't appear anywhere when the group is hidden, which may or may not be desired. Alternatively, only populate `tsL` when `showTSGroup` is true.
---

## BUG 13
**File:** index.html:2360-2368 (renderLots pagination)
**Area:** Pagination / Section Dividers
**Severity:** Low
**Description:** When paginating, section dividers are carried forward via `lastDivider` and inserted before the first lot of their section on the current page. However, if a section's last lot falls on the boundary of a page and the next section's divider was encountered but no lots from that section fit on the current page, the divider is silently dropped. This means the next page starts with lots from the new section but without the section header divider. The `lastDivider` variable resets to `null` at the top of each `renderLots()` call (re-initialized on line 2359), so the carried-over divider from the previous page's iteration is lost.
**Reproduction steps:**
1. Load a dataset where score-sorted sections ("Top Picks", "Worth a Look") have lots that span page boundaries
2. Navigate to page 2
3. Observe that if the first lot on page 2 belongs to a new section, the section divider header may be missing
**Suggested fix:** Track the last-seen divider before `pageStart` so it can be prepended to the page even if it was encountered before the page boundary. E.g., scan all items before `pageStart` to find the most recent divider.
---

## BUG 14
**File:** index.html:1257-1272 (applyPreset function)
**Area:** Filters / Reset
**Severity:** Medium
**Description:** The `applyPreset('reset')` function does not clear `_selectedHouses` or rebuild the house dropdown checklist. When a user clicks "Reset filters", all standard filters (price, type, condition, etc.) reset to defaults, but house-specific selection persists. The house dropdown button continues showing "3 houses" even after reset. Compare with `resetSearchState()` (line 1065) which correctly calls `_selectedHouses.clear()`.
**Reproduction steps:**
1. Open the house dropdown and select only 2-3 specific auction houses
2. Observe the house button shows "3 houses" and results are filtered
3. Click the "Reset filters" preset button
4. The house dropdown still shows "3 houses" and results remain filtered by those houses
**Suggested fix:** Add `_selectedHouses.clear(); buildHouseChecklist();` to the `applyPreset()` function after the filter resets on line 1260.
---

## BUG 15
**File:** index.html:1259 (applyPreset resets object)
**Area:** Filters / Reset
**Severity:** Low
**Description:** `applyPreset('reset')` does not reset `fLookahead` (auction lookahead dropdown) or `fIncludePrevious` (include past auctions checkbox) to defaults. A user who changed lookahead to "Next auction" or unchecked "Include previous" and then clicks "Reset filters" will still have those filters active. This is distinct from BUG 7 (URL sharing) — even within the same session, the reset button fails to fully reset. Compare with `resetSearchState()` at line 1064 which does reset `fIncludePrevious`.
**Reproduction steps:**
1. Set lookahead dropdown to "Next auction"
2. Uncheck "Include previous auctions"
3. Click "Reset filters"
4. Lookahead is still "Next auction" and previous auctions are still excluded — lot count does not fully restore
**Suggested fix:** Add to `applyPreset()`: `if($('fLookahead')) $('fLookahead').value='all'; if($('fIncludePrevious')) $('fIncludePrevious').checked=true;`
---

## BUG 16
**File:** index.html:1259 (applyPreset resets object)
**Area:** Filters / Reset
**Severity:** Low
**Description:** `applyPreset('reset')` does not reset `fAfford` (affordability filter dropdown). The resets object includes `fExcludePOA:''` but not `fAfford`. Compare with `resetSearchState()` at line 1062 which includes `fAfford:'all'`. If a user sets an affordability filter via the finance profile then clicks "Reset filters", the affordability filter persists silently.
**Reproduction steps:**
1. Open finance profile, enter a cash amount
2. Select "In budget" from affordability dropdown
3. Click "Reset filters"
4. Affordability filter remains at "In budget" — lots are still filtered
**Suggested fix:** Add `fAfford:'all'` to the resets object in `applyPreset()`.
---

## BUG 17
**File:** index.html:2258-2260 (renderLots lookahead filter)
**Area:** Filters / Lookahead
**Severity:** Low
**Description:** Lots missing `_auctionDate` or `_house` metadata bypass the lookahead filter entirely (`return true` on line 2259). When a user selects "Next auction" to see only the nearest auction per house, any lots without proper auction metadata will always appear regardless. This could surface stale or orphaned lots that should have been excluded.
**Reproduction steps:**
1. Set lookahead to "Next auction"
2. If any lots in the dataset lack `_auctionDate` or `_house` fields, they appear unconditionally
**Suggested fix:** Change `return true` to `return false` on line 2259 to exclude undated/unhoused lots when a lookahead filter is active.
---

## BUG 18
**File:** index.html:2273-2275 (renderLots sort)
**Area:** Sorting / Stability
**Severity:** Low
**Description:** No secondary sort key is applied after primary sort. Lots with identical prices or yields appear in an unstable order that may shuffle between renders (JavaScript's `Array.sort` is not guaranteed stable in all environments, though modern engines are stable). Additionally, POA lots sort inconsistently: `price_asc` uses `||Infinity` (POA at end), `price_desc` uses `||0` (POA at end mixed with cheapest). While both place POA lots at the bottom, the `price_desc` fallback of `0` means POA lots sort alongside £0 lots rather than being clearly separated.
**Reproduction steps:**
1. Sort by "Price (low to high)" — POA lots appear at the end (correct)
2. Sort by "Price (high to low)" — POA lots appear at the bottom alongside cheapest lots
3. Multiple lots at the same price appear in arbitrary order that may change on re-render
**Suggested fix:** Add secondary sort by `l.lot` or `l._idx`. For `price_desc`, use `-Infinity` fallback to push POA lots to the very end: `(b.price||-Infinity)-(a.price||-Infinity)`.
---

## BUG 19
**File:** index.html:2279-2283 (renderLots stats)
**Area:** Stats / Display Inconsistency
**Severity:** Low
**Description:** The stats row mixes filtered and unfiltered data sources. "Total lots" (line 2279) uses `LOTS.length` (all lots), and "Priced" (line 2283) uses `LOTS.filter(l=>l.price).length` (all lots). But "Showing", "Score 3+", and "Vacant" use the filtered `lots` variable. This means "Priced" always shows the global priced count regardless of active filters. A user with restrictive filters might see "Showing: 50" but "Priced: 1,800" — the Priced stat doesn't reflect their current view.
**Reproduction steps:**
1. Load all listings (e.g. 2,000 lots with 1,800 priced)
2. Apply a filter narrowing to 50 lots
3. Stats show "Total lots: 2,000", "Showing: 50", "Priced: 1,800" — Priced doesn't match the filtered set
**Suggested fix:** Change line 2283 to use filtered `lots`: `lots.filter(l=>l.price).length` instead of `LOTS.filter(l=>l.price).length`.
---

## BUG 20
**File:** index.html:2351, 2370 (renderLots pagination)
**Area:** Pagination / UX
**Severity:** Low
**Description:** When `_currentPage` is clamped to `totalPages` (line 2351) after a filter reduces the result set, the page renders correctly but the viewport scroll position is not reset. If the user was scrolled to the bottom of page 3 and applies a filter that reduces to 1 page, they remain scrolled to the bottom of the viewport and may see blank space below the (now shorter) results, not realising the results have rendered above.
**Reproduction steps:**
1. Load listings with enough lots for 3+ pages
2. Navigate to page 3, scroll down
3. Apply a restrictive filter that reduces results to 1 page
4. Results render correctly but the viewport remains scrolled down — user may not see the results
**Suggested fix:** Add `window.scrollTo({top: document.querySelector('.lots-grid')?.offsetTop || 0, behavior: 'smooth'})` when `_currentPage` is clamped.
---

## BUG 21
**File:** index.html:2318-2370 (renderLots, lotsGrid output)
**Area:** Empty State / UX
**Severity:** Medium
**Description:** When all filters combined return 0 lots, the grid renders completely empty with no user feedback. The stats row shows "Showing: 0" but there is no "No results found" message, no suggestion to broaden filters, and no CTA to reset. The pagination also disappears (correct), but a user who scrolled past the filter bar may see a blank page and think the app is broken. Compare with the skeleton loading state (12 placeholder cards shown during API fetch) — the empty filtered state has no equivalent UX treatment.
**Reproduction steps:**
1. Load listings with lots available
2. Apply a combination of restrictive filters (e.g., Max £10k + 5+ beds + land + scotland)
3. Observe an empty grid with no messaging — just whitespace below the filter bar
4. Stats row says "Showing: 0" but no actionable guidance
**Suggested fix:** After line 2370, check if `lots.length === 0` and render an empty state card: `if(!lots.length) out.innerHTML='<div style="text-align:center;padding:48px 16px;color:var(--text3)"><p style="font-size:1.1rem">No lots match your filters</p><p style="font-size:.9rem;margin-top:8px">Try broadening your search or <a href="#" onclick="applyPreset(\'reset\');return false">reset all filters</a></p></div>';`
---

## BUG 22
**File:** index.html:1194-1196 (matchesRegion town matching)
**Area:** Filters / Location
**Severity:** Medium
**Description:** The region filter's town name fallback uses `addrLower.includes(town)` which is a substring match, not a word-boundary match. Several town names in the `REGION_TOWNS` lists are substrings of towns in other regions, causing false positive matches. Key examples: (1) "chester" is in the north west list, but "Rochester" (south east), "Colchester" (east), "Winchester" (south east), "Chichester" (south east), "Dorchester" (south west) all contain "chester" as a substring; (2) "bath" in south west matches "Batham" or any address mentioning "bathroom"; (3) "bury" as part of town names (e.g., a standalone "Bury" in various regions) could match "Canterbury", "Shrewsbury", etc. A user filtering for "North West" would see properties from Rochester, Winchester, etc. because those addresses contain "chester".
**Reproduction steps:**
1. Load listings that include properties in Rochester, Kent
2. Select "North West" from the location filter
3. The Rochester property appears because "rochester" contains "chester" (a north west town)
4. Similarly, filter for "South West" — properties with "bathroom" in their description bullets that appear in the address field would match "bath"
**Suggested fix:** Use word-boundary matching instead of `includes()`. Replace line 1195 with: `const re=new RegExp('\\b'+town.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i'); if(re.test(addr)) return true;` — this ensures "chester" only matches the standalone word "Chester", not "Rochester" or "Manchester" (wait — "Manchester" contains "chester" at a word boundary too, so `\bchester\b` would still match). Better approach: match only at the START of a word or as a standalone town: use `new RegExp('(^|,|\\s)'+escapedTown+'(\\s|,|$)','i')`. Or simply remove short ambiguous town names and rely on postcode matching for accuracy.
---

## BUG 23
**File:** index.html:2416-2417 (card function, endedClass date comparison)
**Area:** Property Type Rendering / Date Handling
**Severity:** Low
**Description:** The `endedClass` check on line 2416 uses string comparison (`l._auctionDate < new Date().toISOString().slice(0,10)`) to determine if an auction has ended. This works correctly for ISO date strings (YYYY-MM-DD) and is not a bug per se, but it creates a timezone inconsistency: `new Date().toISOString()` returns UTC time, while the user may be in BST (UTC+1). At 11:30 PM BST on auction day, `toISOString()` returns the NEXT day's date (it's past midnight UTC), so the lot gets the "ended" class one hour early. The same issue affects line 2267 (historical filter) and line 2521 (urgency badge days calculation). All three compute "today" differently: lines 2416 and 2267 use `new Date().toISOString().slice(0,10)` (UTC), while line 2521 uses `new Date()` (local time) for the days calculation.
**Reproduction steps:**
1. At 11:30 PM BST (10:30 PM GMT during winter, or after midnight UTC during BST), check a lot with today's auction date
2. The card shows "Auction ended" and has the `card-ended` class, even though it's still before midnight local time
3. Meanwhile, the urgency badge calculates days using local time, so it could show "Today" or "1 day left" while the card is greyed out as ended
**Suggested fix:** Standardise on local time for all date comparisons: `const todayStr=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);` or use a shared `getLocalDateStr()` helper.
---

## BUG 24
**File:** index.html:1105 (goPage function)
**Area:** Pagination
**Severity:** Low
**Description:** The `goPage(p)` function does not validate the page number parameter. While the Prev/Next buttons are disabled at boundaries (line 2379/2387), the `disabled` attribute only prevents click in some browsers — in others, a rapid double-click on "Next" before re-render can queue two `goPage` calls, the second one potentially going past `totalPages`. More critically, the function is global and accessible from the console or could be invoked by browser extensions. Invalid page numbers (0, negative, NaN from parsing) set `_currentPage` to an invalid value. The `_currentPage > totalPages` clamp on line 2351 handles overflow, but there is no clamp for `_currentPage < 1`, which would result in `pageStart` being negative and an empty page rendering with no error message.
**Reproduction steps:**
1. Open browser console, type `goPage(0)` — renders empty page
2. Type `goPage(-5)` — same empty page, no error
3. Rapid-click "Next →" button — in rare cases, page overshoots before re-render disables the button
**Suggested fix:** Add validation at the top of `goPage`: `function goPage(p){p=Math.max(1,Math.min(p,totalPages||1));...}` — but since `totalPages` is computed inside `renderLots`, a simpler fix is to clamp in renderLots: add `if(_currentPage<1) _currentPage=1;` after line 2351.
---

## BUG 25
**File:** index.html:2707 (syncFiltersToURL)
**Area:** Filters / URL Sharing
**Severity:** Low
**Description:** The `syncFiltersToURL()` function determines whether a filter value is "non-default" by comparing `el.value` with `el.querySelector('option')?.value` — i.e., the value of the first `<option>` in the select. This assumes the first option is always the default/empty value. However, if a `<select>` element has its options dynamically populated (e.g., `fDeal` is built by `buildLotFilters()`) and the first option's value doesn't match the expected default, the URL could include spurious filter parameters or omit intentional ones. Specifically, `fDeal` is populated with options like `<option value="">All</option>` followed by dynamic values — the first option IS empty string, so this works. But if the order ever changes or a filter is pre-populated, the comparison breaks silently.
**Reproduction steps:**
1. This is a latent bug — currently the first option of every filter is the default empty/all value, so it works
2. However, if `buildLotFilters()` is modified to pre-select a non-first option, `syncFiltersToURL` would fail to serialize it (because it compares against the first option, not the actual default)
**Suggested fix:** Use explicit default values map instead of first-option comparison: `const FILTER_DEFAULTS={fSearch:'',fSort:'score',fMinPrice:'',fMaxPrice:'',...}; if(el.value !== FILTER_DEFAULTS[id]) p.set(id, el.value);`
---

## BUG 26
**File:** index.html:2082-2083 (runSmartSearch error handler)
**Area:** Search / Security (XSS)
**Severity:** High
**Description:** The error catch block injects `e.message` directly into innerHTML without escaping: `` `<div class="scan-title">✗ ${e.message || 'Analysis failed'}</div>` ``. The error message originates from API response fields (`data.detail`, `data.error`, `data.message`) on lines 2035-2037. If the server returns HTML/script tags in these fields (due to a bug, upstream proxy error page, or man-in-the-middle), the content is rendered as executable HTML. This is a stored-XSS-via-API-response vulnerability.
**Reproduction steps:**
1. Modify the server (or intercept the response) to return `{"error": "<img src=x onerror=alert('XSS')>"}` from `/api/smart-search`
2. Trigger a smart search
3. The injected HTML executes in the user's browser
**Suggested fix:** Use `esc(e.message)` instead of `e.message` on line 2083: `` `<div class="scan-title">✗ ${esc(e.message || 'Analysis failed')}</div>` ``
---

## BUG 27
**File:** index.html:2565-2579 (expandCard function)
**Area:** Property Type Rendering / Expand/Collapse
**Severity:** Low
**Description:** When clicking a different lot card while one is already expanded, the old card's `.expanded` CSS class is never removed. The flow: (1) `existing` panel is found and removed, (2) `expandedLotId` doesn't match new card, so the early return at line 2573 is skipped, (3) `expandedLotId` is updated to the new card, (4) the new card gets `classList.add('expanded')`, but the old card retains its `expanded` class. Currently no CSS rule targets `.lot-card.expanded`, so there's no visual impact, but this is incorrect state that will cause bugs if styling for expanded cards is ever added (e.g., a highlighted border).
**Reproduction steps:**
1. Click lot card A — it expands (gets `expanded` class + panel)
2. Click lot card B — card A's panel is removed but card A still has the `expanded` class
3. Inspect card A in DevTools — `class="lot-card expanded"` persists
**Suggested fix:** Before adding `expanded` to the new card, remove it from the old one. After line 2568 (`existing.remove()`), add: `const oldCard=document.getElementById('lot-'+expandedLotId);if(oldCard)oldCard.classList.remove('expanded');`
---

## BUG 28
**File:** index.html:2456-2462 (dlCSV, dlJSON functions)
**Area:** Filters / Export
**Severity:** Medium
**Description:** The CSV and JSON export functions iterate over the global `LOTS` array, which contains all results from the current search/browse session. They do not apply the currently active filters. If a user has filtered down from 2,000 lots to 50 using price, location, or property type filters, clicking "Export CSV" still exports all 2,000 lots. The user expects to export only what they're currently viewing.
**Reproduction steps:**
1. Load all lots (e.g., 2,000)
2. Apply filters (e.g., "London" + "Under £100k") showing 50 lots
3. Click "Export CSV"
4. The CSV contains all 2,000 lots, not the 50 filtered ones
**Suggested fix:** Either (a) cache the filtered `lots` array from `renderLots()` in a module-level variable (e.g., `_filteredLots`) and use it in `dlCSV`/`dlJSON`, or (b) re-run the filter logic in the export functions. Option (a) is simpler — add `let _filteredLots=[];` at module scope, set `_filteredLots=lots;` after all filtering in `renderLots()`, and use `_filteredLots` in the export functions.
---

## BUG 29
**File:** index.html:2403 (card function, detail pills)
**Area:** Property Type Rendering / Bedroom Display
**Severity:** Low
**Description:** The bedroom pill renders for any lot where `l.beds != null`, including `beds: 0`. This produces a "0 bed" pill on lots like land plots, garages, commercial units, or lots where bedroom count wasn't properly extracted but defaulted to 0. "0 bed" is misleading — it implies a studio/bedsit, not "not applicable". Land and garage lots should not show a bedroom count at all.
**Reproduction steps:**
1. Load listings that include land or garage lots with `beds: 0`
2. Observe the detail pill area shows "0 bed" alongside the property type
**Suggested fix:** Change line 2403 to: `if (l.beds) detailPills.push(l.beds + ' bed');` — this excludes `0`, `null`, and `undefined`. Or more explicitly: `if (l.beds != null && l.beds > 0) detailPills.push(l.beds + ' bed');`
---

## BUG 30
**File:** index.html:843, 1264 (highyield preset)
**Area:** Filters / Preset Mislabelling
**Severity:** Medium
**Description:** The "Yield 8%+" quick filter button (line 843) calls `applyPreset('highyield')`, which only sets `fSort` to `'yield'` (line 1264). It does NOT apply any yield threshold filter — it simply sorts all lots by yield descending. The button label "Yield 8%+" implies the user will see only lots with 8%+ gross yield, but they actually see ALL lots sorted by yield. A lot with 2% yield still appears, just further down the list. This is misleading since every other preset button applies a filter (e.g., "Under £100k" actually filters by price, "Vacant" filters by vacancy).
**Reproduction steps:**
1. Click the "Yield 8%+" quick filter button
2. Observe that all lots are shown, not just those with yield >= 8%
3. Scroll down — lots with low or zero yields appear at the bottom
4. Compare with "Under £100k" which genuinely filters out lots over £100k
**Suggested fix:** Add an actual yield filter: in `applyPreset`, add a yield filter condition. Either add `lots=lots.filter(l=>(l.estGrossYield||0)>=8)` in `renderLots()` triggered by a new filter dropdown value, or extend the preset to set a minimum yield parameter. Alternatively, rename the button to "Sort by yield" to match its actual behaviour.
---

## BUG 31
**File:** index.html:849 (setQ buttons — Heavy refurb, Top picks, Probate)
**Area:** Search / UX
**Severity:** Medium
**Description:** The AI shortcut buttons ("Heavy refurb", "Top picks", "Probate") call `setQ(query)` which only sets the `#smartQuery` input value but does NOT execute the search. The user must then manually click the "Search" button to trigger the AI search. This is inconsistent with the preset filter buttons in the same row (e.g., "Under £100k", "Vacant") which immediately apply and show results. The AI shortcut buttons look identical (same `.ex-btn` class) but behave fundamentally differently — one group is instant, the other requires an extra click. Users clicking "Heavy refurb" expect to see results, not just see the search bar populated.
**Reproduction steps:**
1. Click "Heavy refurb" button
2. Observe the smart query input is populated with "Properties needing heavy refurbishment" but NO search is executed
3. Results remain unchanged until the user manually clicks "Search"
4. Compare with clicking "Vacant" — results update immediately
**Suggested fix:** Change `setQ()` calls to also trigger the search: `onclick="setQ('Properties needing heavy refurbishment');handleSearch()"`. Or create a wrapper: `function aiPreset(q){setQ(q);handleSearch()}` and use `onclick="aiPreset('...')"`. The sparkle emoji (✨) prefix does visually distinguish them, but the interaction difference is still surprising.
---

## BUG 32
**File:** index.html:2066-2071 (runSmartSearch stats overwrite)
**Area:** Search / Stats Display
**Severity:** Low
**Description:** After a smart search completes, `renderLots()` is called on line 2064 which sets `$('statsRow').innerHTML` on line 2291 with the standard stats format. Then lines 2066-2071 immediately overwrite `$('statsRow').innerHTML` with the smart-search-specific stats format (showing "Lots searched", "Matches", "Catalogues"). This double-write is wasted work. More importantly, when the user subsequently changes any filter (which calls `renderLots()` again), the stats revert to the standard format — losing the "Lots searched" and "Catalogues" context that is specific to smart search. The user loses context about their search scope.
**Reproduction steps:**
1. Run a smart search (e.g., "Heavy refurb")
2. Observe stats show "Lots searched: 2000", "Matches: 45", "Catalogues: 21"
3. Change any filter (e.g., set Max Price to £200k)
4. Stats now show "Total lots: 45", "Showing: 30", "Priced: 40" — the search context is lost
**Suggested fix:** Have `renderLots()` check if `SMART_RESULTS` is set and use the smart-search stats format when it is. This preserves search context across filter changes. Move the smart search stats logic into `renderLots()` where it can be consistently applied.
---

## BUG 33
**File:** index.html:2336-2345 (renderLots score grouping)
**Area:** Sorting / Score
**Severity:** High
**Description:** When the default "Score (high → low)" sort is active, lots are grouped into tier sections (Top Picks ≥3, Worth a Look 1.5-3, Other <1.5) but are NOT sorted by score within each tier. A lot with score 8.5 can appear after a lot with score 3.0 within "Top Picks". The `lots` array is never `sort()`-ed when `sortVal === 'score'` — at line 2272, no sort branch fires for the 'score' value. The tier grouping at lines 2337-2345 then partitions the unsorted array, preserving the arbitrary order from the backend/LOTS array. This means the "Score (high → low)" sort label is misleading — it groups by tier, not sorts by score.
**Reproduction steps:**
1. Load listings with default sort "Score (high → low)"
2. Look at the "Top Picks" section — lots are NOT ordered from highest to lowest score
3. A lot with score 3.1 may appear before a lot with score 9.0
**Suggested fix:** Add `lots.sort((a,b)=>(b.score||0)-(a.score||0));` before the tier grouping at line 2334. This ensures lots within each tier are ordered by score descending.
---

## BUG 34
**File:** index.html:1105 (goPage function)
**Area:** Pagination / Bounds
**Severity:** Low
**Description:** `goPage(p)` does not clamp `_currentPage` to a minimum of 1. Line 2351 clamps `_currentPage` when it exceeds `totalPages`, but there's no equivalent guard for `_currentPage < 1`. If `goPage(0)` or `goPage(-1)` is called (e.g., via console, browser extension, or a rare rapid double-click on "Prev" before re-render), `_currentPage` goes to 0 or negative, producing a negative `pageStart` value at line 2355. This renders an empty page with no error message and no way for the user to recover without refreshing (pagination controls won't appear since `totalPages > 1` check passes but page buttons reference invalid pages).
**Reproduction steps:**
1. Open browser console, type `goPage(0)` — empty page renders, no pagination controls
2. Type `goPage(-5)` — same result
3. User has no way to navigate back without refreshing
**Suggested fix:** Add `if(_currentPage<1) _currentPage=1;` after line 2351 in `renderLots()`.
---

## BUG 35
**File:** index.html:2233 (renderLots search filter)
**Area:** Search / Whitespace
**Severity:** Low
**Description:** The text search filter does not `trim()` the input value. If a user types " house " (with leading/trailing spaces), the `.includes()` check works for the padded string, but the search term won't match lot addresses that start or end with the word (since the space is part of the match). More notably, a search of only spaces (e.g., "   ") passes the `if(fs)` truthy check (non-empty string) and runs the filter — but since every address contains spaces, it returns all lots anyway. Not functionally broken, but a minor UX inconsistency — the search appears "active" (non-empty) but shows everything.
**Reproduction steps:**
1. Type "   " (three spaces) in the text search field
2. All lots still appear — the search "matched" everything since addresses contain spaces
3. The active-filter highlight may not trigger (depends on how `fSearch.value` is evaluated)
**Suggested fix:** Add `.trim()` to line 2211: `const fs=$('fSearch').value.trim().toLowerCase();`
---

## BUG 36
**File:** index.html:1155, 1158 (REGION_POSTCODES)
**Area:** Filters / Location
**Severity:** Medium
**Description:** The postcode prefix 'DN' (Doncaster) appears in both `east midlands` and `yorkshire` REGION_POSTCODES arrays. Similarly, 'HG' (Harrogate) appears in both `north east` and `yorkshire`. Since `matchesRegion()` checks one region at a time and returns on first match, a DN-postcode lot correctly matches both regions when either is selected. However, this means the location filter is inaccurate — Doncaster is geographically in Yorkshire (South Yorkshire), not the East Midlands. 'HG' (Harrogate) is in Yorkshire, not the North East. The duplicate entries mean these postcodes match multiple regions, inflating counts for the wrong region and potentially confusing users who filter by location expecting geographically accurate results.
**Reproduction steps:**
1. Load listings with a property in Doncaster (DN postcode)
2. Select "East Midlands" from the location filter — Doncaster property appears
3. Select "Yorkshire" — Doncaster property also appears
4. Same issue with Harrogate (HG postcode) appearing in both "North East" and "Yorkshire"
**Suggested fix:** Remove 'DN' from east midlands (keep in yorkshire only). Remove 'HG' from north east (keep in yorkshire only). Doncaster is in South Yorkshire and Harrogate is in North Yorkshire — both belong exclusively in the yorkshire region.
---

## BUG 37
**File:** index.html:2075 (runSmartSearch, search counter insertion)
**Area:** Search / UI Leak
**Severity:** Medium
**Description:** The AI search counter element (`<div class="search-counter">`) is inserted via `insertAdjacentHTML('afterend')` on the `statsRow` element after each smart search (line 2075). However, it is never removed when the user navigates back to the main auction listing (`backToAuctions()`), applies a preset, or performs a new search. Each subsequent smart search inserts ANOTHER counter element, causing multiple "N AI searches left today" messages to stack up in the DOM. After 5 searches, there are 5 counter messages visible.
**Reproduction steps:**
1. Run a smart search — observe "9 AI searches left today" counter
2. Click "Back to auctions"
3. Run another smart search — observe TWO counter messages now stacked
4. Repeat — each search adds another counter div
**Suggested fix:** Before inserting the counter, remove any existing one: `document.querySelectorAll('.search-counter').forEach(el=>el.remove());` before line 2075. Alternatively, give it an ID and use `$('searchCounter')` with innerHTML replacement.
---

## BUG 38
**File:** index.html:2354 (renderLots pagination)
**Area:** Pagination / Unused Variables
**Severity:** Low
**Description:** Lines 2354 declare `itemCount`, `startIdx`, and `endIdx` variables that are never used in the pagination logic. `itemCount` is initialized to 0 but never incremented. `startIdx` is initialized to 0 but never read. `endIdx` is set to `allItems.length` but never referenced. These are dead code from a previous pagination implementation and create minor confusion when reading the code.
**Reproduction steps:**
1. Read lines 2354 — `let itemCount=0, startIdx=0, endIdx=allItems.length;`
2. Search for usage of these variables in the function — none found
**Suggested fix:** Remove the unused variables: change line 2354 to remove `itemCount`, `startIdx`, `endIdx`.
---

## BUG 39
**File:** index.html:2403 (card function, beds display pluralisation)
**Area:** Property Type Rendering
**Severity:** Low
**Description:** The bedroom pill always shows "N bed" without proper pluralisation. A lot with 1 bedroom shows "1 bed" (correct), but lots with multiple bedrooms also show "2 bed", "3 bed" etc., rather than "2 beds", "3 beds". While "2 bed" is acceptable informal shorthand in UK property listings, it's inconsistent with the effort put into other formatting (e.g., price with `toLocaleString()`).
**Reproduction steps:**
1. Load any lot with 2+ bedrooms
2. Detail pill shows "3 bed" instead of "3 beds"
**Suggested fix:** This is minor and arguably acceptable — UK property listings commonly use "3 bed". Not a priority fix, but for consistency: `l.beds + ' bed' + (l.beds !== 1 ? 's' : '')`.
---

## Sweep completed at 2026-03-14T21:00:00Z

---

# Sweep 2 — 2026-03-14T22:30:00Z

## NOTE on BUG 37
**Status:** Likely false positive
**Reason:** The described reproduction steps are incorrect. `backToAuctions()` calls `resetSearchState()` (line 1283), which removes `.search-counter` via `document.querySelector('.search-counter').remove()` (line 1071). Similarly, every new `runSmartSearch()` call starts with `resetSearchState()` (line 1964), which removes any existing counter before the new one is added at line 2075. In the normal flow, there is no code path where multiple counters accumulate. The counter is always cleaned up before a new one is inserted.
---

## BUG 40
**File:** index.html:1269-1271 (applyPreset function)
**Area:** Filters / View State
**Severity:** Medium
**Description:** When a user is viewing smart search results (with the report/cards view toggle visible and the AI report panel populated) and clicks a preset filter button (e.g., "Under £100k"), `applyPreset()` resets `LOTS=ALL_LOTS` and `SMART_RESULTS=null` but does NOT hide `$('viewToggle')` or clear `$('reportView')`. The view toggle remains visible, and the user can click "Report" to see a stale AI report from the previous search that doesn't correspond to the current lot data. Compare with `backToAuctions()` (lines 1292-1294) which correctly hides `viewToggle`, hides `reportView`, and shows `cardsView`.
**Reproduction steps:**
1. Run an AI smart search (e.g., "Heavy refurb") — observe report/cards toggle appears
2. Click a preset filter button like "Under £100k" or "Vacant"
3. LOTS reset to all lots, cards show unfiltered results — correct
4. But the report/cards view toggle is still visible
5. Click "Report" toggle — the stale AI report from the previous search is displayed
**Suggested fix:** Add view cleanup to `applyPreset()` after line 1271: `$('viewToggle').style.display='none'; $('reportView').style.display='none'; $('cardsView').style.display='block';`
---

## BUG 41
**File:** index.html:2515-2517 (getCardImageBadges) and 2521 (urgency badge)
**Area:** Property Type Rendering / Timezone Inconsistency
**Severity:** Medium
**Description:** The card-level "ended" class (line 2416) and the historical filter (line 2267) compute today's date using UTC (`new Date().toISOString().slice(0,10)`), while the urgency badge (line 2521) uses local time (`new Date()`) for its days-remaining calculation. During BST (UTC+1), between 11 PM and midnight local time, these two systems disagree: the card shows "Auction ended" (because it's past midnight UTC) while the urgency badge simultaneously shows "Today" or "1 day left" (because it's before midnight local). This creates a contradictory state where the same card displays both "ended" styling and an active countdown badge. Note: this is an expansion of the timezone aspect mentioned in BUG 23, but the specific contradictory rendering between ended-class and urgency-badge was not previously described.
**Reproduction steps:**
1. Set system clock to 11:30 PM BST (UTC+1) on an auction day
2. Load a lot with that day's auction date
3. Card has `card-ended` class (greyed out) because UTC date is tomorrow
4. But the urgency badge shows "Today" because local time is still auction day
5. User sees a greyed-out "ended" card with an active "Today" badge — contradictory
**Suggested fix:** Standardise all date comparisons on the same timezone. Create a shared helper: `function todayLocal(){return new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)}` and use it on lines 2267, 2416, and 2521.
---

## Sweep 2 completed at 2026-03-14T22:30:00Z

---

# Sweep 3 — 2026-03-14T23:00:00Z

## BUG 42
**File:** index.html:2631-2671 (triggerFinanceCheck, _financeDebounce)
**Area:** Property Type Rendering / Finance Widget
**Severity:** Medium
**Description:** The `_financeDebounce` variable is a single global timer. When a user triggers a finance check on lot A (via "BridgeMatch It" button or card expansion), the results div for lot A shows "Checking lenders..." with a loading spinner. If the user then quickly triggers a finance check on lot B (within the 400ms debounce window), `clearTimeout(_financeDebounce)` on line 2633 cancels lot A's pending API call. Lot A's results div is stuck permanently showing "Checking lenders..." with an animated spinner — the response never arrives because the timeout was cancelled. The spinner remains until the user re-renders lots (via filter/pagination change) which rebuilds the DOM.
**Reproduction steps:**
1. Expand lot card A and click "Check finance →"
2. Immediately (within 400ms) expand lot card B and click its "Check finance →"
3. Lot A's finance widget is stuck showing "Checking lenders..." forever
4. Lot B's finance check completes normally
**Suggested fix:** Before starting a new debounce, check if there's an existing loading state from a previous lot and either reset it to the empty state or keep per-lot debounce timers instead of a single global one. E.g., `const prevIdx=_financeDebounceIdx; if(prevIdx!=null){const el=document.getElementById('fw-results-'+prevIdx); if(el)el.innerHTML='<div class="fw-empty">Adjust LTV and tap Check</div>'}`.
---

## BUG 43
**File:** index.html:2649 (triggerFinanceCheck fetch URL)
**Area:** Finance Widget / Configuration
**Severity:** Medium
**Description:** The finance widget's lender check API call uses a hardcoded absolute URL: `fetch('https://www.bridgematch.co.uk/api/filter', ...)`. This means: (1) local development and staging environments always hit the production BridgeMatch API, which could pollute prod analytics; (2) if the domain changes, this URL silently breaks; (3) CORS errors will occur if the API doesn't allow requests from localhost or staging origins. All other API calls in the codebase use relative URLs (e.g., `/api/smart-search`, `/api/all-lots`), making this the only hardcoded external URL for a core feature.
**Reproduction steps:**
1. Run the site locally on `localhost:3000`
2. Expand a lot card and click "Check finance →"
3. Browser makes a cross-origin request to `https://www.bridgematch.co.uk/api/filter`
4. If CORS is not configured to allow localhost, the request fails silently
**Suggested fix:** Use a relative URL `/api/filter` if the BridgeMatch API is co-hosted, or use a configurable base URL variable: `const BM_API_BASE = window.__BM_API_BASE__ || '';` and then `fetch(BM_API_BASE + '/api/filter', ...)`.
---

## BUG 44
**File:** index.html:2645 (triggerFinanceCheck property type mapping)
**Area:** Finance Widget / Property Type
**Severity:** Low
**Description:** The property type mapping for the finance API uses naive `includes()` matching: `propType.includes('flat') ? 'flat' : propType.includes('commercial') ? 'commercial' : propType.includes('land') ? 'land' : 'house'`. This maps "garage" and "bungalow" to "house", and "other" to "house". Garages should arguably map to "commercial" for finance purposes (lenders treat garages differently from residential houses). Additionally, if a future property type contains "flat" as a substring (e.g., "flatted maisonette" or "platform"), it would incorrectly match.
**Reproduction steps:**
1. Find a lot with `propType: 'garage'`
2. Click "BridgeMatch It" and check finance
3. The API request sends `property_type: 'house'` — incorrect for a garage
4. Lender results may be wrong (showing residential lenders for a garage)
**Suggested fix:** Use an explicit mapping object instead of `includes()`: `const typeMap = {house:'house', flat:'flat', bungalow:'house', commercial:'commercial', land:'land', garage:'commercial', other:'house'};` then `const apiType = typeMap[propType] || 'house';`
---

## BUG 45
**File:** index.html:778 (fSearch input)
**Area:** Accessibility
**Severity:** Low
**Description:** The text search input `#fSearch` lacks an `aria-label` attribute. It has `placeholder="Search lots..."` but placeholders disappear on focus and are not reliably announced by screen readers as labels. The adjacent AI search input `#smartQuery` (line 781) correctly has `aria-label="AI-powered search query"`. This inconsistency means the primary search input is unlabelled for assistive technology users.
**Reproduction steps:**
1. Navigate to the filter bar using a screen reader
2. Tab to the text search input — no label is announced, only the placeholder text (if supported)
3. Compare with the AI search input which correctly announces its label
**Suggested fix:** Add `aria-label="Search auction lots by text"` to the `#fSearch` input on line 778.
---

## BUG 46
**File:** index.html:2058 (runSmartSearch report rendering)
**Area:** Search / XSS
**Severity:** Medium
**Description:** The smart search report text is rendered using `esc(data.report).replace(/\n/g, '</p><p>')`. While `esc()` properly escapes HTML entities, the subsequent `.replace()` injects raw `</p><p>` HTML tags into the escaped string. This means if the API response `report` field contains a literal `\n` newline, the escaped text is split into paragraph tags — which is the intended behaviour. However, if `data.report` contains something like `text\n<script>alert(1)</script>`, `esc()` would escape it to `text\n&lt;script&gt;...`, and the `\n` replacement produces `text</p><p>&lt;script&gt;...` — safe. BUT: if the report contains `</p>` literally, `esc()` escapes it to `&lt;/p&gt;`, which is safe. This is actually NOT a bug — the escaping is correct. Retracted.

**Status: FALSE POSITIVE — Escaping is correctly applied before tag insertion.**
---

## BUG 47
**File:** index.html:2006 (runSmartSearch authHeaders call)
**Area:** Search / API
**Severity:** Low
**Description:** The smart search API call uses `authHeaders()` (line 2006: `headers: authHeaders()`) while the `loadAllLots` call uses `getAuthHeaders()` (line 1122: `headers: getAuthHeaders()`). If these are two different functions with different implementations, one may silently fail to send auth tokens. If they are aliases, this is just inconsistent naming.
**Reproduction steps:**
1. Search codebase for both `authHeaders` and `getAuthHeaders` function definitions
2. Verify they return the same headers
3. If they differ, smart search and lot loading use different auth mechanisms
**Suggested fix:** Verify both functions exist and behave identically. If so, standardise on one name. If not, ensure both correctly send required auth headers.
---

## BUG 48
**File:** index.html:2337-2340 (renderLots score grouping — lot appearing in multiple tiers)
**Area:** Sorting / Score Grouping
**Severity:** Medium
**Description:** When `sortVal === 'score'` and `showTSGroup` is `true`, a title-split lot with `score >= 3` appears in BOTH the `tsL` array (line 2337: `lots.filter(l=>l.titleSplit&&l.score>=2)`) AND the `topL` array (line 2338: `lots.filter(l=>l.score>=3&&!(showTSGroup&&l.titleSplit&&l.score>=2))`). Wait — the exclusion `!(showTSGroup&&l.titleSplit&&l.score>=2)` should correctly exclude these from `topL` when `showTSGroup` is true. Let me re-examine... For a lot with `titleSplit=true, score=4`: `showTSGroup && l.titleSplit && l.score>=2` = `true && true && true` = `true`, so `!(true)` = `false`, so the lot is EXCLUDED from topL. This is correct. **Retracted — the exclusion logic is correct when showTSGroup is true.**

**Status: FALSE POSITIVE — Exclusion logic correctly handles overlap.**
---

## BUG 49
**File:** index.html:2350 (renderLots pagination total calculation)
**Area:** Pagination / Section Dividers
**Severity:** Low
**Description:** The section divider count displayed in each divider (e.g., "Top Picks (15)") is calculated from the full unfiltered-by-pagination lot set, but the divider may span multiple pages. If "Top Picks" has 60 lots and the page size is 50, page 1 shows "Top Picks (60)" with only 50 lots visible, and page 2 shows "Top Picks (60)" again with the remaining 10 lots. The count "(60)" on each page is misleading — the user sees 50 lots under a header claiming 60. This is compounded by the section divider being carried forward to page 2 via `lastDivider` (line 2359-2363), so the same "Top Picks (60)" header appears on both pages.
**Reproduction steps:**
1. Load a dataset with 60+ lots scoring >= 3 (Top Picks)
2. Set page size to 50
3. Page 1: "Top Picks (60)" header with 50 lots visible
4. Page 2: "Top Picks (60)" header again with 10 lots visible
5. User may be confused by the mismatch
**Suggested fix:** Either (a) adjust the divider count to show only the items on the current page: "Top Picks (50 of 60)", or (b) don't repeat the section divider on subsequent pages (remove the `lastDivider` carry-forward) — but option (b) means page 2 has lots without a section header, which is also confusing. Option (a) is better UX.
---

## BUG 50
**File:** index.html:2416-2417 (card function, onclick handler)
**Area:** Property Type Rendering / Event Handling
**Severity:** Medium
**Description:** The card's onclick handler uses `onclick="expandCard(LOTS[' + l._idx + '])"` which directly indexes into the global `LOTS` array. But `bridgeMatchLot()` (line 2676) uses `LOTS.find(l => l._idx === idx)` to locate the same lot. If `LOTS` is reassigned between when the card was rendered and when the user clicks (e.g., a background `loadAllLots()` refresh, or LOTS being reassigned by a concurrent smart search), `LOTS[l._idx]` may reference a completely different lot or `undefined`. The `_idx` values are assigned at render time (line 2202) and baked into the onclick handlers, but if `LOTS` changes, the indices are stale. This is a race condition during any LOTS reassignment.
**Reproduction steps:**
1. Load lots (LOTS is assigned, cards render with `_idx` from 0 to N)
2. While cards are visible, trigger a smart search that sets `LOTS = data.results` (a different, smaller array)
3. Click on a card from the original render — `LOTS[old_idx]` either references wrong lot or is undefined
4. expandCard receives undefined, and `document.getElementById('lot-' + undefined)` returns null — function exits silently
**Suggested fix:** Store the full lot reference in a Map keyed by a stable ID rather than relying on array indexing. Or re-render all cards whenever LOTS is reassigned (which currently happens via `renderLots()`). The practical risk is low since `renderLots()` is always called after LOTS reassignment, but there's a brief window between LOTS assignment and DOM update.
---

## BUG 51
**File:** index.html:2467-2468 (dlCSV function)
**Area:** Search / Security (CSV Injection)
**Severity:** Medium
**Description:** The CSV export wraps cells in double quotes and escapes internal `"` characters, but does NOT sanitize cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r`. These are CSV formula injection vectors. If AI-extracted lot data (e.g., `l.address`, `l.dealType`, `l.opps`) contains a value like `=CMD|'/C calc'!A0` or `+cmd|'/C calc'!A0`, opening the exported CSV in Excel or LibreOffice Calc could execute arbitrary commands. Since lot data comes from Gemini AI extraction of arbitrary auction house websites, an attacker could craft an auction listing with a malicious address field that gets extracted verbatim.
**Reproduction steps:**
1. Imagine a lot with address `=HYPERLINK("https://evil.com","Click here")`
2. Export CSV via the Export button
3. Open the CSV in Excel — the cell is treated as a formula, not text
4. In a more severe case, `=CMD|'/C calc'!A0` could execute system commands (depends on Excel version and security settings)
**Suggested fix:** Prefix any cell value starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`) or tab character before wrapping in double quotes. E.g.: `const sanitize = v => { const s = String(v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };` and apply it in the `.map(c => ...)` chain.
---

## BUG 52
**File:** index.html:2471 (dl function — Blob URL memory leak)
**Area:** Search / Memory Leak
**Severity:** Low
**Description:** The `dl()` download helper creates a Blob URL via `URL.createObjectURL(b)` but never calls `URL.revokeObjectURL()` to free the memory. Each CSV or JSON export leaks the Blob URL until page reload. Compare with line 2933 which correctly calls `URL.revokeObjectURL(url)` for the screenshot export. While the impact is small for occasional exports, repeated exports during a session could accumulate leaked Blob URLs.
**Reproduction steps:**
1. Export CSV multiple times during a session
2. Each export creates a Blob URL that is never revoked
3. In DevTools > Memory, Blob URLs accumulate
**Suggested fix:** Add `setTimeout(() => URL.revokeObjectURL(a.href), 1000);` after `a.click()` in the `dl()` function (line 2471). The timeout ensures the download starts before the URL is revoked.
---

## BUG 53
**File:** index.html:2552-2553 (getCardImageHtml — onerror/onload badge destruction)
**Area:** Property Type Rendering / Image Fallback (Expanded detail from BUG 1)
**Severity:** Medium
**Description:** When a card image triggers the `onerror` or small-image `onload` handler, `this.outerHTML=getPlaceholderHtml(...)` replaces ONLY the `<img>` element with the placeholder `<div>`. However, the badges (rendered by `getCardImageBadges()` on line 2555) are sibling elements AFTER the `<img>` inside `.card-image-wrapper`. The `outerHTML` replacement does NOT destroy these badges — it only replaces the `<img>` itself. But it DOES destroy the shimmer `<div>` (line 2550) because that's `this.previousElementSibling` which is hidden via `.style.display='none'` on successful load. **On re-examination, `this.outerHTML` only replaces the `<img>` element, NOT the parent's innerHTML.** The badges survive because they are siblings, not replaced. However, the shimmer div (`.card-image-shimmer`) remains visible in the DOM when `onerror` fires, because only the successful `onload` path hides it (`this.previousElementSibling.style.display='none'`). On error, the shimmer animation continues behind the placeholder, wasting GPU cycles and creating a visual artefact if the placeholder has any transparency.
**Reproduction steps:**
1. Load a lot card whose image URL returns a 404
2. The `onerror` fires, replacing the `<img>` with the placeholder via `outerHTML`
3. The `.card-image-shimmer` div is still in the DOM with its animation running
4. Inspect in DevTools — shimmer element is present and animating behind the placeholder
**Suggested fix:** In the `onerror` handler, also hide the shimmer: change to `onerror="this.previousElementSibling.style.display='none';this.outerHTML=getPlaceholderHtml(this.dataset.proptype)"`.
---

## BUG 54
**File:** index.html:2205 (_idx assignment mutates original LOTS array)
**Area:** Filters / Data Integrity
**Severity:** Medium
**Description:** Line 2205 `lots.forEach((l,i) => { l._idx = i; })` assigns `_idx` based on the FILTERED and SORTED lot's position. Since `lots = LOTS.slice()` creates a shallow copy, mutating `l._idx` on each element also mutates the corresponding object in the original `LOTS` array (because objects are passed by reference). This means: (1) If a user applies filters that remove lots 0-9, lot at position 0 in the filtered view gets `_idx = 0`, overwriting its previous `_idx` from the full list. (2) If the user then clears filters, `renderLots()` runs again and reassigns all `_idx` values — but during the brief window between LOTS reassignment and re-render, the `_idx` values are stale from the filtered view. (3) The BridgeMatch button uses `l._idx` in the onclick (`bridgeMatchLot(l._idx, event)`) which then does `LOTS.find(l => l._idx === idx)`. After filtering changes `_idx`, multiple lots could have the same `_idx` value if different filter passes assigned the same index to different lots.
**Reproduction steps:**
1. Load 100 lots (LOTS has 100 elements, _idx 0-99)
2. Apply a filter that narrows to 20 lots — _idx is reassigned 0-19 on these 20 lots
3. Now LOTS[50]._idx might be 5 (from filtered assignment), while LOTS[5]._idx is also 5 (from filtered assignment)
4. `LOTS.find(l => l._idx === 5)` returns the FIRST match, which could be the wrong lot
5. Clicking "BridgeMatch It" on a lot may open the finance check for a different lot
**Suggested fix:** Either (a) use a separate property like `_renderIdx` that doesn't conflict, or (b) use a stable ID (e.g., `lot._house + '-' + lot.lot`) instead of array position for card IDs and onclick references, or (c) don't mutate the original objects — assign `_idx` to a separate map.
---

## BUG 55
**File:** index.html:2425 (card function — expandCard onclick passes object reference)
**Area:** Property Type Rendering / Event Handling
**Severity:** Low
**Description:** The card onclick handler is `onclick="expandCard(LOTS[' + l._idx + '])"`. This evaluates `LOTS[l._idx]` at CLICK TIME, not render time. Combined with BUG 54 (where `_idx` mutates), this creates an issue: `LOTS[0]` after filter A may be a different lot than `LOTS[0]` when the user clicked the card. However, since `renderLots()` always re-renders the entire DOM, old cards with stale onclick handlers are replaced. The actual risk is extremely low — the only scenario is if a user could somehow click a card between `LOTS` reassignment and DOM update, which is a single synchronous JS execution frame (essentially impossible). Including for completeness as it documents the design trade-off.
**Reproduction steps:** Theoretical only — requires clicking during the synchronous gap between `LOTS=data.results` and `renderLots()` DOM update.
**Suggested fix:** No action needed — documenting for awareness. If a future change makes LOTS reassignment and rendering asynchronous, revisit this.
---

## BUG 56
**File:** index.html:2438-2443 (calcSDLT function)
**Area:** Filters / Deal Analysis
**Severity:** Medium
**Description:** The SDLT calculator uses hardcoded 2025/26 investor rates including the 5% surcharge but does NOT include the 2% additional surcharge for non-UK residents (7% total surcharge since April 2021). While most users may be UK residents, the calculator makes no mention that non-UK resident rates differ, potentially understating SDLT for overseas investors. Additionally, the thresholds may change in future budgets — the function has no date guard or version note indicating when rates were last verified.
**Reproduction steps:**
1. A non-UK resident user sees a deal analysis showing SDLT of £12,500 on a £250,000 property
2. Their actual SDLT liability is £17,500 (additional 2% surcharge = £5,000)
3. Deal profitability is overstated
**Suggested fix:** Add a comment noting "UK resident investor rates only — non-UK residents pay additional 2%". Optionally, add a toggle or note in the deal analysis panel indicating "Assumes UK resident. Non-UK residents pay an additional 2% surcharge."
---

## BUG 57
**File:** index.html:2060 (runSmartSearch — resultsTitle uses textContent, safe)
**Area:** Search / Empty Results UX
**Severity:** Low
**Description:** When a smart search returns 0 results (`LOTS.length === 0`), the results title shows `"query" — 0 matches` and the stats row shows `Total lots: [total], Showing: 0`. But there is no explicit empty state message or suggestion (e.g., "Try broadening your search" or "No lots matched your query"). The user sees an empty grid with pagination showing "Page 1 of 1 · 0 lots" which is functional but not helpful. Compare with the filter empty state which also shows no message.
**Reproduction steps:**
1. Enter a very specific/unusual AI search query (e.g., "castle with moat under £50k")
2. Get 0 results
3. The page shows stats and an empty grid with no guidance
**Suggested fix:** Add an empty state check in `renderLots()` after filtering: if `lots.length === 0`, show a message like "No lots match your current filters. Try adjusting or resetting." in the `lotsGrid` container.
---

## BUG 58
**File:** index.html:2593-2594 (expandCard function)
**Area:** Property Type Rendering / Expanded Card Image Fallback
**Severity:** High
**Description:** The expanded card image's `onerror` handler inlines SVG markup from `getPropertyTypeIcon()` directly into an HTML attribute. The SVG strings contain unescaped double quotes (e.g., `viewBox="0 0 24 24"`, `width="48"`, `d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"`) which prematurely terminate the `onerror="..."` attribute. This means the onerror handler is syntactically broken for ALL property types. When an expanded card's image fails to load, the browser shows a broken image icon instead of the property type placeholder SVG.

The generated HTML looks like:
```html
<img ... onerror="this.outerHTML='<div class=exp-large-img-placeholder><svg viewBox="0 0 24 24" ...">
```
The `"` in `viewBox="` closes the onerror attribute. The remaining SVG content becomes garbage attributes on the img tag.

**Reproduction steps:**
1. Load listings and click on any lot card to expand it
2. If the lot has an image URL that returns 404 or is broken
3. The expanded panel shows a broken image icon instead of the house/flat/land/commercial SVG placeholder
4. Inspect the `<img>` element in DevTools — the `onerror` attribute is truncated at the first SVG double quote

**Suggested fix:** Don't inline SVG into the HTML attribute. Instead, use a function call in the onerror handler, similar to how the card-level image does it: `onerror="this.outerHTML=getPlaceholderHtml(this.dataset.proptype)"` with `data-proptype` set on the img element. Or use `this.style.display='none';this.insertAdjacentHTML('afterend','<div class=exp-large-img-placeholder>'+getPropertyTypeIcon(this.dataset.proptype)+'</div>')`. But the simplest fix is: `onerror="this.outerHTML=document.createElement('div').outerHTML"` and set the class, then call a function to populate it.
---

## BUG 59
**File:** index.html:2089-2091 (runSmartSearch catch block)
**Area:** Search / Security (XSS)
**Severity:** Medium
**Description:** In the `runSmartSearch` error handler, `e.message` is interpolated directly into `innerHTML` without escaping: `$('progressPanel').innerHTML=\`...<div class="scan-title">✗ ${e.message || 'Analysis failed'}</div>...\``. The error message originates from server response fields `data.detail`, `data.error`, or `data.message` (lines 2042-2044), which are thrown as `new Error(serverValue)`. If the server response contains HTML (e.g., from a compromised API or MITM), it is injected into the DOM as live HTML. This is a reflected XSS vector. Compare with `runAnalysis` (line 1958) which correctly uses a hardcoded error string.

**Reproduction steps:**
1. Trigger a smart search that fails
2. If the server returns `{"error": "<img src=x onerror=alert('XSS')>"}`, this HTML is injected into the progress panel DOM
3. In practice, requires compromised server or MITM, but the pattern violates defence-in-depth

**Suggested fix:** Escape the error message before injecting into innerHTML: `esc(e.message || 'Analysis failed')`. Or use the same hardcoded message pattern as `runAnalysis`: `'✗ Search failed — please try again'`.
---

## BUG 60
**File:** index.html:2575-2590 (expandCard function)
**Area:** Property Type Rendering / Card State
**Severity:** Low
**Description:** When expanding card B after card A was already expanded, `expandCard` removes the old `.expanded-panel` element (line 2579) but does NOT remove the `.expanded` CSS class from card A. Only the `expandedLotId` is updated to B's ID. Card A retains the stale `.expanded` class indefinitely. Currently no CSS rule targets `.lot-card.expanded`, so there is no visible effect. However, this is a latent bug — if any styling is added for `.expanded` cards (e.g., a border highlight), all previously-expanded cards would retain that styling.

**Reproduction steps:**
1. Load listings and click on lot card A — it expands
2. Click on lot card B — card A's panel closes and B's opens
3. Inspect card A in DevTools — it still has the `.expanded` class
4. Repeat with cards C, D, E — all accumulate the `.expanded` class

**Suggested fix:** Before setting `expandedLotId` to the new card, remove the `.expanded` class from the previously expanded card. Add before line 2589: `if(expandedLotId !== null){const prev=document.getElementById('lot-'+expandedLotId);if(prev)prev.classList.remove('expanded')}`
---

## BUG 61
**File:** index.html:2286 (renderLots stats row)
**Area:** Listing Index Page / Stats Display
**Severity:** Low
**Description:** The "Total lots" stat in the stats row always shows `LOTS.length` (line 2286), which is the unfiltered source array, not `ALL_LOTS.length`. After a smart search, `LOTS` is replaced with search results (e.g., 15 matches). The stats row then shows "Total lots: 15, Showing: 8" after filtering. The "Total lots" label is misleading — it should either show the total across all catalogues (`ALL_LOTS.length`) or be labelled "Search results" instead of "Total lots". Compare with the smart search stats (line 2073) which correctly shows "Lots searched" from the search metadata.

**Reproduction steps:**
1. Load the page — observe "Total lots: 2364" (correct, shows ALL_LOTS)
2. Run an AI smart search that returns 20 matches
3. The smart search panel shows its own stats (correct)
4. Apply a filter (e.g., condition: "needs work") — this triggers `renderLots()` which overwrites the smart search stats
5. Stats now show "Total lots: 20" — which is just the smart search results count, not the total catalogue

**Suggested fix:** In the stats row within `renderLots()`, show `ALL_LOTS.length` for total lots instead of `LOTS.length`, or change the label to "Source lots" when `SMART_RESULTS` is set. E.g.: `const totalLabel = SMART_RESULTS ? 'Search results' : 'Total lots';`
---

## BUG 62
**File:** index.html:2073-2078 + 2298 (renderLots / runSmartSearch stats)
**Area:** Search / Stats Display Race
**Severity:** Low
**Description:** After a smart search, `runSmartSearch` calls `renderLots()` (line 2071) which writes stats to `$('statsRow')` (line 2298), then immediately overwrites `$('statsRow').innerHTML` with custom smart search stats (line 2073). This works on initial display. However, if the user then changes any filter (e.g., sort order, price range), the filter change triggers `renderLots()` again, which overwrites the smart search stats with the generic stats. The smart search stats ("Lots searched", "Catalogues") are permanently lost after the first filter interaction.

**Reproduction steps:**
1. Run an AI smart search — observe the custom stats: "Lots searched: 2364, Matches: 20, Score 3+: 5, Vacant: 3, Catalogues: 21"
2. Change the sort order to "Price: Low to High"
3. Stats are overwritten with generic stats: "Total lots: 20, Showing: 15, Score 3+: 5, Vacant: 3, Priced: 18"
4. The "Lots searched" and "Catalogues" stats are gone

**Suggested fix:** Either (a) have `renderLots()` check if `SMART_RESULTS` is set and render smart-search-specific stats, or (b) store the custom stats HTML and re-apply it in `renderLots()` when in smart search mode.
---

## BUG 63
**File:** index.html:1086 (updatePriceBtn fmt function)
**Area:** Filters / Price Display
**Severity:** Low
**Description:** The price format function `fmt` in `updatePriceBtn` divides by 1000 without rounding, producing ugly fractional labels for certain price values. For example, a max price of £999,999 would display as "£999.999k" instead of "£1m" or "£1,000k". Similarly, £1,500,000 displays as "£1.5m" (correct), but £1,100,000 displays as "£1.1m" which could also show floating point artifacts.

**Reproduction steps:**
1. This is mainly theoretical since the price dropdowns likely use round values
2. If custom price inputs are added in future, or if values are restored from URL params with arbitrary values, the display would be ugly

**Suggested fix:** Add rounding: `return '£'+Math.round(n/1000)+'k'` or `return '£'+(n/1000).toFixed(0)+'k'`. For values near 1M, consider formatting as "£1m" if >= 950k.
---

## BUG 64
**File:** index.html:1097 (restoreLookahead function)
**Area:** Filters / Lookahead Persistence
**Severity:** Medium
**Description:** `restoreLookahead()` contains a special case that deliberately discards the "Next auction" preference (value `'1'`): `if(v==='1'){localStorage.removeItem('bm_lookahead');return}`. When a user sets the lookahead to "Next auction" and reloads the page, the preference is silently deleted from localStorage and the dropdown reverts to the default "All upcoming". This defeats the persistence mechanism for the most restrictive (and arguably most useful) lookahead setting. The `saveLookahead()` function correctly saves `'1'`, but `restoreLookahead()` immediately removes it. The `'2'` and `'all'` values are restored correctly.
**Reproduction steps:**
1. Set the auction lookahead dropdown to "Next auction"
2. Reload the page
3. Observe the dropdown reverts to "All upcoming" instead of persisting as "Next auction"
4. Repeat with "Next 2 auctions" — this correctly persists
**Suggested fix:** Remove the special-case early return: delete `if(v==='1'){localStorage.removeItem('bm_lookahead');return}`. If the intent was to prevent this from being the default on first visit, use a different mechanism (e.g., a `bm_lookahead_set` flag).
---

## BUG 65
**File:** index.html:778 (fSearch oninput handler)
**Area:** Search / Performance
**Severity:** Medium
**Description:** The text search input `#fSearch` triggers `renderLots()` on every keystroke via `oninput="renderLots()"` with no debounce. Each invocation runs the full render pipeline: computing affordability tags for all lots, applying all filters across 2000+ lots, building HTML for 50+ lot cards, writing innerHTML, building pagination controls, and syncing filters to the URL via `history.replaceState`. For a 6-character search term, this runs 6 full render cycles. On lower-end mobile devices with 2000+ lots, this can cause visible UI jank and input lag. Compare with the AI search input which only fires on button click, not on every keystroke.
**Reproduction steps:**
1. Load the listings page with 2000+ lots
2. Type a search term quickly in the "Search lots..." text input
3. On a lower-end device or with CPU throttling enabled in DevTools, observe input lag and jank as each keystroke triggers a full re-render
**Suggested fix:** Add a debounce wrapper: `oninput="clearTimeout(_searchDebounce);_searchDebounce=setTimeout(renderLots,200)"`. 200ms debounce allows responsive feedback without excessive re-rendering. Define `let _searchDebounce=null;` alongside the other state variables.
---

## BUG 66
**File:** index.html:1249-1254 (handleSearch function)
**Area:** Search / State Management
**Severity:** High
**Description:** When the user clears the AI search input and clicks the button (which shows "Browse" when the query is empty), `handleSearch()` calls `renderLots()` without resetting `LOTS` to `ALL_LOTS`. If the user previously ran a smart search (which sets `LOTS` to the search results array), clicking "Browse" with an empty query renders only the previous smart search results, not all lots. The user sees 15 search results instead of the full 2000+ lot catalogue. Only `backToAuctions()` and `applyPreset()` correctly reset `LOTS = ALL_LOTS`. The button label "Browse" implies showing all lots, but the function doesn't deliver this.
**Reproduction steps:**
1. Run an AI search (e.g., "Properties with development potential") — returns ~15 results
2. Clear the AI search input (button changes to "Browse")
3. Click "Browse"
4. Observe only the 15 previous search results are shown, not all lots
5. Compare with clicking "Reset filters" preset button, which correctly restores all lots
**Suggested fix:** In the `if(!q)` branch of `handleSearch()`, add: `LOTS=ALL_LOTS;SMART_RESULTS=null;$('resultsTitle').textContent=ALL_LOTS.length.toLocaleString()+' auction lots';$('viewToggle').style.display='none';$('reportView').style.display='none';buildLotFilters();` before calling `renderLots()`.
---

## BUG 67
**File:** index.html:1376, 2240 (getAffordabilityTag + renderLots filter)
**Area:** Filters / Affordability
**Severity:** Medium
**Description:** POA (Price On Application) lots pass the "In budget only" affordability filter because `getAffordabilityTag()` returns `'unknown'` for lots without a price (line 1376: `if(!lot.price||!aff||!aff.maxStd)return 'unknown'`), and the "in_budget" filter on line 2240 explicitly includes `'unknown'`: `lots=lots.filter(l=>l._affTag==='in_budget'||l._affTag==='unknown')`. A user filtering for "In budget only" expects to see only lots they can afford, but all POA lots are included because they can't be priced. This is misleading — unpriceable lots should be excluded from a budget filter, not assumed to be affordable.
**Reproduction steps:**
1. Enter cash available (e.g., £50,000) in the finance profile
2. Select "In budget only" from the affordability dropdown
3. Observe that POA lots still appear in the results alongside genuinely affordable lots
4. Compare with "Affordable" filter which also includes unknown — same issue
**Suggested fix:** Change the "in_budget" filter to exclude 'unknown': `lots=lots.filter(l=>l._affTag==='in_budget')`. If preserving POA lots is desired, add an explicit "Include POA" toggle or rename the filter to make the behavior clear. The "affordable" filter could keep 'unknown' with a note explaining POA lots may be included.
---

## BUG 68
**File:** index.html:2319-2321 (renderLots filter count)
**Area:** Listing Index Page / Filter Count Display
**Severity:** Low
**Description:** The filter count text on line 2321 (`filterCountEl.textContent='Showing '+lots.length+' of '+LOTS.length+' lots'`) is dead code — it is always overwritten by line 2385 (`filterCountEl.textContent='Page '+_currentPage+' of '+totalPages+' · '+totalLots+' lots'`). Both lines execute sequentially in every `renderLots()` call. The earlier "Showing X of Y" format was more informative for understanding filter impact (e.g., "Showing 50 of 2,000 lots" tells the user how many lots are filtered out). The replacement "Page 1 of 5 · 50 lots" only shows the filtered count with no reference to the total. Users lose context about how restrictive their filters are.
**Reproduction steps:**
1. Load the listings page with 2000+ lots
2. Apply a restrictive filter (e.g., max price £50k)
3. Observe the filter count shows "Page 1 of 2 · 80 lots" — no indication that 1920 lots were filtered out
4. Without knowing the original total, users can't gauge whether their filters are too restrictive
**Suggested fix:** Remove the dead code at line 2321. Modify line 2385 to include the total: `'Page '+_currentPage+' of '+totalPages+' · '+totalLots+' of '+LOTS.length+' lots'`. Or keep the "Showing X of Y" format and append page info: `'Showing '+totalLots+' of '+LOTS.length+' · Page '+_currentPage+'/'+totalPages`.
---

## BUG 69
**File:** index.html:2715 (FILTER_PARAMS array)
**Area:** Filters / URL Sharing
**Severity:** Low
**Description:** `FILTER_PARAMS` does not include `fPerPage` (lots per page setting). When a user shares a filtered URL, the per-page preference is lost. The recipient sees the default 50 lots per page regardless of what the sender configured. This extends the coverage gap identified in BUG 7 (which identified `fLookahead`, `fIncludePrevious`, and house selection as missing from URL params). `fPerPage` has its own localStorage persistence (`savePerPage`/`restorePerPage`), but that only helps the same user on the same browser — URL sharing doesn't carry it.
**Reproduction steps:**
1. Set per-page to 100
2. Apply some filters
3. Copy the URL from the address bar and share it
4. Open the URL in a different browser/incognito window
5. Observe the per-page setting defaults to 50, not 100
**Suggested fix:** Add `'fPerPage'` to the `FILTER_PARAMS` array. Update `restoreFiltersFromURL` to handle it (it already generically sets element values by ID, so adding the string is sufficient).
---

## BUG 70
**File:** index.html:2227 (price filter) and 2229 (beds filter)
**Area:** Filters / Data Consistency
**Severity:** Medium
**Description:** The min price filter includes lots with no price: `if(minP) lots=lots.filter(l=>!l.price||l.price>=minP)`. The `!l.price` clause passes through POA/unpriced lots. Combined with the "Excl. POA" dropdown being a separate control (line 835), a user must set two controls to exclude unpriced lots from price-filtered results. However, the max price filter has the same issue: `if(maxP) lots=lots.filter(l=>!l.price||l.price<=maxP)`. When BOTH min and max are set (e.g., £100k-£200k range), POA lots still appear because they pass both filters via `!l.price`. This is already partially covered by BUG 4, but the specific scenario of BOTH min AND max being set — where POA lots are clearly not in any specific range — makes the issue more severe. A user setting a specific £100k-£200k range clearly doesn't want POA lots.
**Reproduction steps:**
1. Set min price to £100k AND max price to £200k
2. Observe POA lots still appear in results
3. The user must also set "Excl. POA" separately to remove them
**Suggested fix:** When both min and max price are set, automatically exclude unpriced lots: `if(minP&&maxP) lots=lots.filter(l=>l.price&&l.price>=minP&&l.price<=maxP)`. Keep the current pass-through behavior when only one bound is set (user might want POA lots when just setting a maximum).
---

## BUG 71
**File:** index.html:2429 (card onclick handler)
**Area:** Property Type Rendering / Event Handling
**Severity:** Medium
**Description:** The card's onclick handler passes the lot object by reference via array index: `onclick="expandCard(LOTS[${l._idx}])"`. The `_idx` property is assigned at the start of `renderLots()` (line 2213) based on the position in the `LOTS.slice()` copy BEFORE filtering. However, since `lots.forEach((l,i) => { l._idx = i })` mutates the original lot objects (shallow copy), this works correctly within a single render cycle. The problem arises when `LOTS` is reassigned between renders: if a user is on the page with cards rendered from ALL_LOTS (where lot X has `_idx=500`) and a background process or concurrent tab reassigns LOTS (e.g., via `loadAllLots()` completion after initial render), clicking the card executes `LOTS[500]` on the NEW LOTS array, which may be a different lot or undefined. The `loadAllLots()` function at line 1125 does `ALL_LOTS=d.lots||[]` followed by `LOTS=ALL_LOTS` and `renderLots()` — but if the user clicks a card during the fetch-to-render gap, the onclick targets the wrong array.
**Reproduction steps:**
1. Load the page (cards render with initial ALL_LOTS)
2. Trigger a scenario where LOTS is reassigned (e.g., slow network where loadAllLots takes several seconds)
3. Click a card during the brief window between LOTS reassignment and DOM re-render
4. The expanded panel may show data for a different lot than the one clicked
**Suggested fix:** Instead of array index access, store the lot ID and look it up: `onclick="expandCard(LOTS.find(l=>l._uid==='${lot._uid}'))"` where `_uid` is a stable unique identifier (e.g., `house+lot` composite key). This prevents stale index issues regardless of LOTS reassignment timing.
---

## BUG 72
**File:** index.html:2565-2567 (getSignalChips function)
**Area:** Property Type Rendering / Signal Chips
**Severity:** Medium
**Description:** The `getSignalChips` function unconditionally prepends a "Title Split" chip when `lot.titleSplit` is true (line 2567: `chips.unshift({text: '+ Title Split', type: 'pos'})`). However, the backend scoring engine (server.js:6465) already pushes "Title split (N units)" into the lot's `opps` array. Since the function also iterates over `lot.opps` (line 2565), title split lots display TWO title-split-related chips: "+ Title Split" (from the unshift) AND "+ Title split (2 units)" (from the opps array). This wastes one of the 3 visible chip slots with redundant information.
**Reproduction steps:**
1. Load listings page with lots that have `titleSplit: true`
2. Inspect the signal chips on those lot cards
3. Observe two chips: "+ Title Split" and "+ Title split (N units)" — both green, both conveying the same information
4. With max 3 chips displayed, this duplicate pushes other signals (e.g., "Needs modernisation", "Vacant") into the "+N more" overflow
**Suggested fix:** Either (a) remove the `unshift` on line 2567 since the opps array already carries the detailed title-split signal, or (b) filter out "Title split" entries from `lot.opps` before iterating, keeping only the manually added chip. Option (a) is simpler and preserves the unit count detail.
---

## BUG 73
**File:** index.html:2382 (renderLots function)
**Area:** Pagination / Dead Code
**Severity:** Low
**Description:** Line 2382 declares `const renderedCount=pageItems.filter(i=>!i.isDivider).length;` which computes the number of non-divider items on the current page. This variable is never used anywhere in the function — it's dead code from a previous implementation that likely used it to show "Showing X items on this page" or similar.
**Reproduction steps:**
1. Search for `renderedCount` in index.html — it is assigned on line 2382 but never referenced afterward
**Suggested fix:** Remove line 2382 entirely.
---

## BUG 74
**File:** index.html:2723 (syncFiltersToURL function)
**Area:** Filters / URL Sync
**Severity:** Low
**Description:** `syncFiltersToURL` compares each filter element's current value against its first `<option>` value to determine the "default" state: `el.value !== el.querySelector('option')?.value`. For `<input>` elements in FILTER_PARAMS (specifically `fSearch` and `fPostcode`), `el.querySelector('option')` returns null, so `?.value` evaluates to `undefined`. The comparison `el.value !== undefined` is always `true`, but the earlier `el.value &&` check catches empty strings (falsy). This works by accident — if an input had a value of `"0"` or `"false"` (truthy strings), the logic would be correct. But the approach is fragile: it relies on the coincidence that empty string is falsy, rather than explicitly checking input types. Not a runtime bug today, but a maintenance hazard if new filter inputs are added with non-empty default values.
**Reproduction steps:**
1. Read the code at line 2723 — the logic works correctly for current filters but the intent is unclear
2. Adding a new input filter with a non-empty default value (e.g., a text input defaulting to "all") would be synced to URL incorrectly
**Suggested fix:** Add explicit handling for input elements: `if(el.tagName==='INPUT'){if(el.value.trim())p.set(id,el.value)} else {if(el.value!==el.options?.[0]?.value)p.set(id,el.value)}`.
---

## BUG 75
**File:** index.html:2715, 2716-2720 (FILTER_PARAMS and restoreFiltersFromURL)
**Area:** Filters / URL Sharing
**Severity:** Low
**Description:** The `FILTER_PARAMS` array used for URL sync does not include `fLookahead`, `fAfford`, `fPerPage`, or `fIncludePrevious`. This means that when a user shares a filtered URL (e.g., `?fType=house&fCondition=needs+work`), the recipient does not receive the lookahead setting, affordability filter, per-page count, or historical-auctions toggle. While `fLookahead` and `fPerPage` are persisted to localStorage (so they work for the same user across sessions), they are lost when the URL is shared with a different user. This is particularly confusing for `fIncludePrevious` — if User A unchecks "Previous" to hide ended auctions and shares the URL, User B sees ended auctions included (checkbox defaults to checked).
**Reproduction steps:**
1. Set lookahead to "Next auction", uncheck "Previous", set per page to 20
2. Copy the URL
3. Open in incognito — lookahead, previous, and per-page settings are all at defaults, not matching the shared state
**Suggested fix:** Add `fLookahead` and `fPerPage` to `FILTER_PARAMS`. For the checkbox `fIncludePrevious`, add custom handling: `if(!$('fIncludePrevious').checked) p.set('fIncludePrevious','false')` and restore with `if(p.get('fIncludePrevious')==='false') $('fIncludePrevious').checked=false`.
---

## Sweep 7 completed at 2026-03-15T03:00:00Z

---

# Sweep 8 — 2026-03-14T

## NOTE on BUG 47
**Status:** False positive
**Reason:** `authHeaders()` (line 1557) is simply an alias for `getAuthHeaders()`: `function authHeaders() { return getAuthHeaders(); }`. Both functions are identical. No auth divergence.
---

## NOTE on BUG 54
**Status:** Partially false positive in current code
**Reason:** The premise that `_idx` is assigned on the "filtered and sorted" array is incorrect for the current code. Line 2213 assigns `_idx` BEFORE any filtering or sorting (filtering starts at line 2219). `lots = LOTS.slice()` preserves the same order as `LOTS`, so `LOTS[l._idx] === l` is always true within a render cycle. The mutation-of-shared-objects concern remains valid in theory (objects are shared between the slice copy and the original array), but since every `renderLots()` call reassigns `_idx` consistently with LOTS ordering, the described reproduction scenario (multiple lots sharing the same `_idx`) cannot occur in normal use.
---

## BUG 76
**File:** index.html:2324 (renderLots active filter highlighting)
**Area:** Filters / UI — Active Filter Indicators
**Severity:** High
**Description:** The active filter highlight logic queries `document.querySelectorAll('.unified-bar .tb-select')`, but no HTML element in the document has the class `unified-bar`. The filter row uses class `sp-filter-row` (line 789). The `.unified-bar` class is defined in CSS (lines 108-111) as "Legacy compat" but was never applied to the new search panel markup. As a result, the querySelectorAll returns an empty NodeList, and the `.forEach` body never executes. **No dropdown filter in the entire UI ever receives the `active-filter` CSS class** (green border + green text, defined at line 518). Users get zero visual feedback about which filters are active. The price dropdown button (`.price-dd-btn.active-filter`, line 114) and house dropdown button (`.house-dropdown-btn.active-filter`, line 523) have separate highlighting logic and are NOT affected. Only the `<select>` elements (sort, beds, type, location, deal, condition, tenure, sold status, exclude POA, lookahead) are broken.
**Reproduction steps:**
1. Load listings page and select any filter (e.g., Type: "House", Condition: "Needs work")
2. Observe the `<select>` elements — none have a green border or green text colour
3. Inspect any `.tb-select` element in DevTools — the `active-filter` class is never applied
4. Compare with the house dropdown button or price dropdown button, which correctly show active states
**Suggested fix:** Change the selector on line 2324 from `.unified-bar .tb-select` to `.sp-filter-row .tb-select`: `document.querySelectorAll('.sp-filter-row .tb-select').forEach(sel=>{...})`. Also remove the dead `.unified-bar` CSS rules (lines 108-111, 540-541, 566) or keep them only if another view still uses them.
---

## BUG 77
**File:** index.html:1264-1278 (applyPreset function)
**Area:** Filters / Preset Reset — Stale Dropdowns
**Severity:** Medium
**Description:** `applyPreset()` sets `LOTS=ALL_LOTS` (line 1276) but does NOT call `buildLotFilters()`. The `buildLotFilters()` function (line 2113) rebuilds the deal type dropdown (`fDeal`) from the current `LOTS` array and calls `buildHouseChecklist()` to rebuild the house multi-select. After a smart search (which sets `LOTS` to a subset of search results), the deal type dropdown and house checklist are built from those results. When the user then clicks a preset button (e.g., "Under £100k" or "Reset filters"), `LOTS` is correctly reset to `ALL_LOTS`, but the deal type dropdown still only shows deal types from the search results, and the house checklist still shows only houses from the search results. Users cannot filter by deal types or houses that weren't in the previous search results.
**Reproduction steps:**
1. Load listings — deal dropdown shows all deal types (e.g., Standard, Title Split, Refurb, Development, etc.)
2. Run an AI search (e.g., "Probate") — returns ~10 results, all with dealType "Standard"
3. Deal dropdown now only shows "All deals" and "Standard" (built from search results)
4. Click "Reset filters" preset button
5. LOTS is restored to all 2000+ lots, but the deal dropdown still only shows "Standard"
6. User cannot filter by "Title Split" or "Development" without manually rebuilding via a page action that calls `buildLotFilters()`
**Suggested fix:** Add `buildLotFilters();` to `applyPreset()` after line 1276 (`LOTS=ALL_LOTS;SMART_RESULTS=null;`). This ensures dropdowns are rebuilt from the full lot set whenever a preset is applied.
---

## BUG 78
**File:** index.html:298-307, 426, 2039 (CSS and JS)
**Area:** Listing Index Page / Styling — Undefined CSS Variable
**Severity:** Medium
**Description:** The CSS variable `--accent` is referenced in 6+ places (paywall card hover border, paywall card `.popular` border, feature list checkmarks, `.pro-badge` background, `.blurred` card overlay text, signup modal error text) but is never defined in the `:root` declaration (lines 30-41). The `:root` variables define `--green:#2e7d32` and `--green2:#0b7a52` but no `--accent`. When a CSS variable is undefined and no fallback is specified, the property inherits or uses its initial value. Effects: (1) `.paywall-card:hover` border-color falls through to the browser default (likely no visible border change); (2) `.paywall-card.popular` border is invisible/default instead of green; (3) `.paywall-features li::before` checkmarks lose their green colour; (4) `.pro-badge` background is transparent instead of green — the white text becomes invisible on a white background; (5) `.blurred` card overlay text has no visible colour.
**Reproduction steps:**
1. Open the paywall modal (trigger by clicking "Export CSV" as a free user, or click BridgeMatch It on a blurred card)
2. Observe: the "Popular" pricing card has no green border, the checkmark icons are not green, the "PRO" badge has no visible background
3. Inspect in DevTools — `getComputedStyle(el).borderColor` shows the initial value, not `#2e7d32`
**Suggested fix:** Add `--accent:#2e7d32;` to the `:root` block (line 41, after `--radius-sm:8px;`). Alternatively, replace all `var(--accent)` references with `var(--green)` to use the existing variable.
---

## BUG 79
**File:** index.html:2389-2399 (renderLots pagination)
**Area:** Pagination / Accessibility
**Severity:** Low
**Description:** Pagination buttons (`.btn-page`) have no `:focus-visible` CSS rule. Line 137 defines `focus-visible` styles for `.tb-select`, `.ex-btn`, `.adv-toggle`, `.btn-main`, `.nav-cta`, `.card-bm-btn`, `.cta-primary`, and `.lot-card` — but `.btn-page` is missing from this list. Keyboard users tabbing through pagination buttons see no visible focus indicator, violating WCAG 2.1 SC 2.4.7 (Focus Visible). The buttons also lack `aria-label` attributes — they only contain the page number text, which is sufficient for screen readers but could be improved with context (e.g., "Go to page 3").
**Reproduction steps:**
1. Load listings with enough lots for 3+ pages
2. Use Tab key to navigate through the pagination buttons
3. No visible focus ring or outline appears on the currently focused button
4. Compare with filter dropdowns (`.tb-select`) which correctly show a green focus ring
**Suggested fix:** Add `.btn-page:focus-visible` to the existing rule on line 137: `.btn-page:focus-visible{outline:2px solid var(--green);outline-offset:2px;box-shadow:0 0 0 4px rgba(46,125,50,.15)}`
---

## BUG 80
**File:** index.html:1178 (REGION_TOWNS, north east)
**Area:** Filters / Location — Geographic Inaccuracy
**Severity:** Low
**Description:** The `north east` region's town list includes several towns that are geographically in Yorkshire, not the North East: `scarborough` (YO postcode, North Yorkshire), `whitby` (YO postcode, North Yorkshire), `northallerton` (DL postcode, county town of North Yorkshire), `thirsk` (YO postcode, North Yorkshire), and `ripon` (HG postcode, North Yorkshire). While the `yorkshire` region (line 1179) doesn't include these towns, the `north east` region claims them. A user filtering for "North East" would see properties in Scarborough, Whitby, etc. — solidly Yorkshire locations. This compounds with BUG 22's substring matching issue: "ripon" as a substring could match addresses containing that string in other contexts.
**Reproduction steps:**
1. Load listings with a property in Scarborough (YO postcode)
2. Filter by "North East" — the property appears (via town name fallback matching "scarborough")
3. Filter by "Yorkshire" — the same property does NOT appear (Scarborough is not in the yorkshire town list)
4. Geographically, Scarborough is in North Yorkshire, not the North East
**Suggested fix:** Move `scarborough`, `whitby`, `northallerton`, `thirsk`, and `ripon` from the `north east` town list to the `yorkshire` town list. Keep DL and HG postcodes in the `north east` REGION_POSTCODES for postcode-based matching (these are debatable boundary cases), but the town names should be in Yorkshire.
---

## BUG 81
**File:** index.html:2395-2397 (renderLots pagination ellipsis)
**Area:** Pagination / UX
**Severity:** Low
**Description:** When `startP === 2`, the pagination renders `1 … 2 3 4 5 6 7 8` — an ellipsis between consecutive page numbers 1 and 2. This is visually misleading because ellipsis conventionally indicates skipped pages. The same issue occurs at the end: if `endP === totalPages - 1`, it renders `… [totalPages]` with only one page skipped. The condition on line 2395 is `if(startP>1)` which triggers whenever the window doesn't start at page 1, even when only page 1 is excluded. Similarly, line 2397 `if(endP<totalPages)` triggers when only the last page is outside the window.
**Reproduction steps:**
1. Load enough lots for 8+ pages with per-page set to 20
2. Navigate to page 5 (middle of the range)
3. Pagination shows: `1 … 2 3 4 5 6 7 8` — the `…` between 1 and 2 suggests skipped pages when there are none
4. Same at the end: if the window ends at page 7 of 8, it shows `… 8` after 7
**Suggested fix:** Change the conditions to only show ellipsis when more than one page is skipped: `if(startP>2)` instead of `if(startP>1)`, and `if(endP<totalPages-1)` instead of `if(endP<totalPages)`. For the edge case where only page 1 is outside the window (`startP===2`), show the page 1 button directly without ellipsis.
---

## Sweep 8 completed at 2026-03-14T
