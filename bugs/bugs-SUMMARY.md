# BridgeMatch Bug Summary Report
Generated: 2026-03-14T23:59:00Z

---

## Overview

| Source Agent | Total Bugs | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| Listings (bugs-listings.md) | 50 | 0 | 4 | 18 | 28 |
| Detail Pages (bugs-detail.md) | 59 | 0 | 3 | 20 | 36 |
| Auth & Stripe (bugs-auth-stripe.md) | 40 | 1 | 6 | 15 | 18 |
| Forms & Data (bugs-forms-data.md) | 80 | 0 | 4 | 18 | 58 |
| Resilience/Security/Mobile (bugs-resilience.md) | 54 | 3 | 12 | 20 | 19 |

**Note:** Auth & Stripe agent reports 13 bugs as FIXED. Numbers above reflect total reported including fixed.

---

## FIXED Bugs (13 — from Auth & Stripe agent)

The following bugs were confirmed fixed by code changes detected during sweeps:

| Bug | Area | Fix Summary |
|---|---|---|
| Auth BUG 1 | `/api/all-lots` data gating | Now calls `stripAIFields()` for non-premium users |
| Auth BUG 6 | Admin secret in query string | Admin endpoints now use `x-admin-secret` header only |
| Auth BUG 7 | `/api/analyse-all` ungated | Now requires `x-admin-secret` header |
| Auth BUG 10 | CSRF `startsWith` bypass | Now uses exact match (`origin === a`) |
| Auth BUG 15 | Stripe redirect URL injection | Mitigated by CSRF fix |
| Auth BUG 17 | Webhook always returns 200 | Now returns HTTP 500 on error |
| Auth BUG 23 | Listing URLs exposed to free users | `url` field now stripped by `stripAIFields()` |
| Auth BUG 24 | Double subscription possible | Checkout now checks existing `stripe_subscription_id` |
| Auth BUG 25 | CORS/CSRF origin list mismatch | Both now share same `ALLOWED_ORIGINS` variable |
| Auth BUG 26 | Webhook silent failure on missing userId | Now logs warning when metadata missing |
| Auth BUG 29 | CORS/CSRF dual-list drift | Fixed — same as BUG 25 |
| Auth BUG 30 | Smart search leaks full data | Now calls `stripAIFields()` for non-premium users |
| Auth BUG 36 | Subscription recovery broken | `stripe_subscription_id` preserved on `past_due` |

---

## Critical Bugs (Fix Immediately)

### CRIT-1: Admin Secret Exposed via Query String
- **Source:** Resilience BUG 1
- **File:** server.js lines 2844, 2871, 2906
- **Description:** Admin endpoints accept `ADMIN_SECRET` via `req.query.token`. Query parameters are logged in server access logs, browser history, and HTTP proxy logs — exposing the secret.
- **Note:** Auth BUG 6 reports this as FIXED for the endpoints it checked. **Verify all admin endpoints are migrated to header-only auth.**
- **Suggested fix:** Remove `req.query.token` support from ALL admin endpoints. Accept only via `x-admin-secret` header.

### CRIT-2: Premium Features Gated Only by Client-Side Flag
- **Source:** Resilience BUG 2 | Auth-Stripe BUG 9
- **File:** index.html line 1049
- **Description:** `const PREMIUM_ENABLED=true;` hardcoded in client-side JS. All users get premium features (affordability filters, title split filters). Anyone can verify via DevTools. No server-side gating.
- **Elevated:** Reported by 2 agents.
- **Suggested fix:** Remove client-side flag. Gate premium features server-side via `validateUserFromReq()`.

### CRIT-3: SSE Stream Read Has No Error Handling
- **Source:** Resilience BUG 4
- **File:** index.html lines 1891-1943
- **Description:** The `reader.read()` loop in `runAnalysis()` has no error handling around stream reads. If connection drops mid-stream, `await reader.read()` throws an unhandled error.
- **Suggested fix:** Wrap `reader.read()` in try-catch, show "Connection lost — please retry" message.

---

## High Severity

### HIGH-1: `/api/analyse` Returns Full Unblurred Data to All Users
- **Source:** Auth-Stripe BUG 2 (STILL OPEN)
- **File:** server.js lines 1648, 1708-1714, 2140-2147
- **Description:** Both cached and fresh analysis paths return `blurred: false` with full lot data (scores, opps, risks, addresses, URLs) regardless of user tier. `stripAIFields()` is not called. `FREE_SCAN_LIMIT` limits how many analyses can run, but each returns complete unblurred data.
- **Suggested fix:** Call `stripAIFields()` for free/anon users before returning analysis results.

### HIGH-2: XSS in Email Notifications (Lead + Welcome)
- **Source:** Forms BUG 1 | Forms BUG 76
- **File:** server.js lines 747-765, 797-838
- **Description:** Lead notification and welcome email HTML templates interpolate user-supplied values (name, email, auctionUrl) directly into HTML without escaping. `auctionUrl` inserted into `<a href="">` — `javascript:` protocol URLs could be dangerous. Welcome email interpolates `firstName` unescaped.
- **Elevated:** Two separate code paths with same vulnerability class.
- **Suggested fix:** HTML-escape all user-supplied values. Validate `auctionUrl` starts with `http://` or `https://`.

### HIGH-3: `esc()` Function Doesn't Escape Quotes in Attribute Context
- **Source:** Detail BUG 54, Detail BUG 55
- **File:** index.html line 1041, used at 2104, 2135, 2417, 2541, 2544, 2583
- **Description:** `esc()` uses `textContent` -> `innerHTML` which only escapes `<`, `>`, `&` — NOT `"`. Used extensively inside double-quoted HTML attributes. Lot data containing `"` breaks out of attributes, enabling attribute injection.
- **Suggested fix:** Create `escAttr()` that also escapes `"` and `'`. Use it in all attribute contexts.

### HIGH-4: XSS via API Error Message in Smart Search
- **Source:** Listings BUG 26
- **File:** index.html line 2082-2083
- **Description:** Error catch block injects `e.message` (from API response fields) directly into innerHTML without escaping. If server returns HTML in error fields, it executes as HTML.
- **Suggested fix:** Use `esc(e.message)` instead of raw `e.message`.

### HIGH-5: Score Sort Doesn't Sort Within Tiers
- **Source:** Listings BUG 33
- **File:** index.html lines 2272, 2337-2345
- **Description:** Default "Score (high -> low)" groups lots into tier sections but does NOT sort by score within each tier. A lot with score 3.1 can appear before score 9.0 within "Top Picks". No `sort()` call fires when `sortVal === 'score'`.
- **Suggested fix:** Add `lots.sort((a,b)=>(b.score||0)-(a.score||0))` before tier grouping.

### HIGH-6: CSV/JSON Export Bypasses Data Gating
- **Source:** Auth-Stripe BUG 5 | Listings BUG 28 | Forms BUG 49
- **File:** index.html lines 2456-2462
- **Description:** `dlCSV()` and `dlJSON()` export the full `LOTS` array with no tier check and no filter application. All users can export full unblurred data. Exports also don't respect currently active filters.
- **Elevated:** Reported by 3 agents.
- **Suggested fix:** Check user tier before export. Apply current filters. Strip AI fields for free users.

### HIGH-7: No Rate Limiting on Critical Endpoints
- **Source:** Forms BUG 2 | Resilience BUG 10 | Auth-Stripe BUG 16/19/49
- **Files:** `/api/leads`, `/api/signup`, `/api/all-lots`
- **Description:** Multiple endpoints have no rate limiting. `/api/leads` can be spammed with fake leads. `/api/signup` allows mass account creation. `/api/all-lots` allows unrestricted scraping.
- **Elevated:** Reported by 3 agents across 5 separate bug entries.
- **Suggested fix:** Add IP-based rate limiting (e.g., express-rate-limit) to all public endpoints.

### HIGH-8: Card Image Error Handler Destroys Badge Overlays
- **Source:** Listings BUG 1
- **File:** index.html lines 2542-2543
- **Description:** When a lot card image fails to load, `onerror` replaces `this.parentElement.innerHTML`, destroying ALL badge overlays (score, house name, vacant, urgency). Placeholder function doesn't re-render badges.
- **Suggested fix:** Replace only the `<img>` element, not the entire parent innerHTML.

### HIGH-9: Supabase Queries Lack Error Handling (Widespread)
- **Source:** Resilience BUG 8/44 | Auth-Stripe BUG 43
- **Files:** server.js — 20+ locations
- **Description:** Many Supabase queries destructure only `{ data }` without checking `error`. When Supabase is down: rate limiting breaks, cache returns empty, webhook events fail silently, signup creates duplicates.
- **Elevated:** Reported by 2 agents covering 20+ code locations.
- **Suggested fix:** Check `if (error)` on all Supabase query results. Return appropriate HTTP error codes.

### HIGH-10: `callGemini()` Has Zero Error Handling
- **Source:** Resilience BUG 7
- **File:** server.js lines 226-244
- **Description:** If Gemini API returns error or undefined response, `result.response.text()` crashes. All error handling deferred to callers, but not all callers handle errors consistently.
- **Suggested fix:** Add try-catch inside `callGemini()` with meaningful error wrapping.

### HIGH-11: `loadAllLots()` / `analyseAll()` Don't Check `r.ok` Before `r.json()`
- **Source:** Resilience BUG 5/6 | Resilience BUG 39/40/41
- **Files:** index.html lines 1122, 1502, 1488, 1673, 1695
- **Description:** Multiple frontend fetch calls parse `r.json()` before checking `r.ok`. Server 500/502 responses cause JSON parse errors instead of meaningful error messages.
- **Suggested fix:** Check `if (!r.ok)` before `r.json()` in all fetch handlers.

### HIGH-12: `.env.example` Missing 13+ Environment Variables
- **Source:** Resilience BUG 3
- **File:** .env.example
- **Description:** Only documents `GEMINI_API_KEY`. Missing: `STRIPE_SECRET_KEY`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `ADMIN_SECRET`, `RESEND_API_KEY`, `SENTRY_DSN`, `ALLOWED_ORIGINS`, `NODE_ENV`.
- **Suggested fix:** Add all referenced env vars with placeholder values and descriptions.

### HIGH-13: Supabase Client Initialized with Empty Strings When Env Vars Missing
- **Source:** Resilience BUG 45
- **File:** server.js lines 106-107, 113-115
- **Description:** `SUPABASE_URL || ''` creates a client that exists but silently fails on every query. Server starts with no warning that auth/database is non-functional. `SUPABASE_JWT_SECRET` defaulting to `''` could potentially allow JWT verification to pass with empty secret.
- **Suggested fix:** Validate required env vars at startup. Refuse to start if critical ones missing.

### HIGH-14: Mobile Touch Targets Below 44px WCAG Minimum
- **Source:** Resilience BUG 17/18
- **File:** index.html lines 104, 131, 310, 466, 522, 96-101, 538-546
- **Description:** Multiple interactive elements have touch targets below 44x44px: filter chips (3px 8px padding), buttons (4px 10px), checkboxes (14x14px), filter labels at 10.9px font.
- **Suggested fix:** Increase padding on all interactive elements to ensure 44px minimum on mobile.

### HIGH-15: `/api/signup` Account Takeover via Email
- **Source:** Auth-Stripe BUG 28
- **File:** server.js `/api/signup` endpoint
- **Description:** `/api/signup` overwrites `session_token` for returning users — enables account takeover via email.
- **Suggested fix:** Do not overwrite session tokens for existing users without proper verification.

### HIGH-16: Puppeteer `browser.newPage()` Failure Not Caught
- **Source:** Resilience BUG 12
- **File:** server.js lines 1780-1781
- **Description:** If `getBrowser()` succeeds but `browser.newPage()` fails (OOM), error occurs before inner try-catch. `page` is undefined, subsequent calls crash.
- **Suggested fix:** Wrap `getBrowser()` and `newPage()` in their own try-catch.

### HIGH-17: Many `$()` DOM Accesses Lack Null Checks
- **Source:** Resilience BUG 27
- **File:** index.html — multiple locations (1063, 1087-1090, 1255, etc.)
- **Description:** `$()` returns `document.getElementById(id)` which may be null. Many locations access properties without null guards, throwing "Cannot read property of null" if any element ID is missing.
- **Suggested fix:** Add null checks or create a safe wrapper returning no-op proxy on null.

### HIGH-18: Welcome Page Has No Mobile Navigation
- **Source:** Resilience BUG 22 (welcome.html)
- **File:** welcome.html lines 36, 297
- **Description:** Nav links hidden at 768px with `display:none` but no hamburger menu replacement. Mobile/tablet users cannot navigate.
- **Suggested fix:** Add hamburger menu toggle for mobile.

---

## Medium Severity

### Data Gating & Auth

| ID | Source | File | Description |
|---|---|---|---|
| MED-1 | Auth BUG 3, Forms BUG 65 | index.html | "Coming Soon" labels missing on yield, comparables, deal stacking — features exposed without gate |
| MED-2 | Auth BUG 4 | server.js | `invoice.payment_failed` webhook only logs — no user-facing action |
| MED-3 | Auth BUG 13 | server.js | `/api/signup` creates users with no email verification |
| MED-4 | Auth BUG 14 | server.js | Tier expiry depends entirely on webhook — no reconciliation cron |
| MED-5 | Auth BUG 21 | server.js:904-912 | Legacy `session_token` auth path still active |
| MED-6 | Auth BUG 28 | server.js | `/api/signup` overwrites session_token — account takeover |
| MED-7 | Auth BUG 31 | server.js | Smart search cache doesn't account for tier — cached premium results served to free users |
| MED-8 | Auth BUG 32 | index.html | Trial expiry mid-session race — `updateProStatus()` only runs on login |
| MED-9 | Auth BUG 34 | index.html | CSV/JSON export buttons visible/functional for all users despite being Pro feature |
| MED-10 | Auth BUG 38 | server.js:2530 | Dead `tier === 'trial'` check reveals inconsistent tier model |
| MED-11 | Auth BUG 40 | server.js:867-868 | `validateUserFromReq` side-effect clears `stripe_subscription_id` on expiry — could break active subscriptions |

### Security

| ID | Source | File | Description |
|---|---|---|---|
| MED-12 | Resilience BUG 15 | server.js:491 | `/api/auth/me` returns `stripe_subscription_id` to client — unnecessary exposure |
| MED-13 | Resilience BUG 16 | server.js | Admin auth inconsistent — some endpoints use header, some use body |
| MED-14 | Resilience BUG 47 | server.js:66-77 | CSP includes `unsafe-inline` for script-src — weakens XSS protection |
| MED-15 | Resilience BUG 48 | server.js:505, 645 | Stripe endpoints have no rate limiting |
| MED-16 | Resilience BUG 46 | server.js:40 | `ALLOWED_ORIGINS` has hardcoded production fallback |
| MED-17 | Resilience BUG 32 | index.html:2303 | `innerHTML` with unescaped values — fragile XSS pattern |
| MED-18 | Forms BUG 56 | server.js:741 | Activity log exposes PII (email + IP) — GDPR concern |
| MED-19 | Forms BUG 45, Resilience BUG 9 | index.html:2649 | Finance widget XSS via unsanitized `count` from external API |
| MED-20 | Forms BUG 77 | server.js:6527 | Land Registry API called over HTTP, not HTTPS |

### Data Integrity & Display

| ID | Source | File | Description |
|---|---|---|---|
| MED-21 | Listings BUG 28, Detail BUG 44 | index.html:2456-2462 | Export doesn't apply current filters — exports all lots, not filtered view |
| MED-22 | Listings BUG 30 | index.html:843, 1264 | "Yield 8%+" preset only sorts, doesn't filter — mislabelled |
| MED-23 | Listings BUG 31 | index.html:849 | AI shortcut buttons populate search but don't execute — inconsistent with preset buttons |
| MED-24 | Listings BUG 36 | index.html:1155, 1158 | DN (Doncaster) in both East Midlands and Yorkshire; HG (Harrogate) in both North East and Yorkshire |
| MED-25 | Listings BUG 37 | index.html:2075 | AI search counter stacks — multiple "N searches left" messages after repeated searches |
| MED-26 | Listings BUG 40 | index.html:1269-1271 | Preset resets LOTS but leaves stale view toggle and AI report visible |
| MED-27 | Listings BUG 41, Detail BUG 47 | index.html:2416, 2521 | Timezone inconsistency — ended class uses UTC, urgency badge uses local time |
| MED-28 | Listings BUG 42 | index.html:2631-2671 | Finance debounce global — rapid check on 2 lots leaves first stuck with spinner |
| MED-29 | Listings BUG 43/53, Detail BUG 53, Forms BUG 44/68 | index.html:2649 | Finance API URL hardcoded to `https://www.bridgematch.co.uk/api/filter` — breaks on staging/localhost |
| MED-30 | Listings BUG 44, Detail BUG 42, Forms BUG 60 | index.html:2644-2645 | Finance property type mapping too naive — "Apartment" maps to "house", "Mixed Use" maps to "house" |
| MED-31 | Listings BUG 50 | index.html:2417 | Card onclick references global LOTS array — race condition if LOTS reassigned |
| MED-32 | Detail BUG 2 | index.html:2583 | Expanded panel image has no onerror fallback — shows broken image icon |
| MED-33 | Detail BUG 36 | index.html:2199, 2202 | `_idx` mutation on shallow copy leaks into `ALL_LOTS` — fragile state management |
| MED-34 | Detail BUG 39 | index.html:2598-2620 | Expanded panel has no close button — mobile users can't close without scrolling back |
| MED-35 | Detail BUG 41 | index.html:2223 | "Good condition" filter includes lots with unknown condition data |
| MED-36 | Detail BUG 45 | index.html:2337-2340 | Title-split lots with null score (blurred) end up in "Other" instead of "Title Splits" |
| MED-37 | Detail BUG 49 | index.html:470 | Expanded panel padding not responsive — cramped on 360px devices |
| MED-38 | Detail BUG 51 | index.html:2582-2584 | Expanded panel shows only 1 image — no gallery despite lots having multiple photos |
| MED-39 | Detail BUG 52 | index.html:2565-2624 | No deep-linkable URL for expanded lots — can't share, back button leaves page |
| MED-40 | Forms BUG 53 | index.html:1264 | Yield filtering: no `fMinYield` filter exists anywhere — preset can only sort |
| MED-41 | Forms BUG 69/79 | server.js:6629-6641 | VOA_RENTS key iteration order fragile — "Barking Road, Newham" matches wrong area |
| MED-42 | Forms BUG 74 | server.js:6906 | "Street average" is actually postcode average — includes all properties, not just same street |
| MED-43 | Forms BUG 75 | index.html:1270 | Preset resets LOTS to ALL_LOTS, discarding smart search results |
| MED-44 | Resilience BUG 11 | server.js:767 | Lead notification email fire-and-forget — silently lost if Resend API down |
| MED-45 | Resilience BUG 13 | server.js:3588-3606 | Malformed Gemini JSON silently drops entire batch — user sees fewer lots with no warning |
| MED-46 | Resilience BUG 14 | server.js:2342-2357 | Smart search doesn't pre-check `creditExhausted` flag — race condition on quota |
| MED-47 | Resilience BUG 19 | index.html:577 | Sticky filter panel `top:56px` not adjusted for mobile nav height (48px) — 8px gap |
| MED-48 | Resilience BUG 20/21 | index.html:2791, 321 | Debug panel and account dropdown overflow on mobile |
| MED-49 | Resilience BUG 29 | index.html | Widespread empty catch blocks — errors completely swallowed with no logging |
| MED-50 | Resilience BUG 30/31 | server.js | `parseInt()` without radix and without NaN check — propagates NaN into scoring |
| MED-51 | Resilience BUG 34 | server.js:2342 | Puppeteer `page.goto()` timeout handling inconsistent across extractors |
| MED-52 | Resilience BUG 36 | index.html | No global error handler (`window.onerror`) — frontend errors invisible to operator |
| MED-53 | Resilience BUG 37 | server.js:545-664 | Stripe webhook handler doesn't null-check `event.data.object` fields |
| MED-54 | Resilience BUG 38 | index.html:97-98, 541 | Mobile filter inputs below 44px touch target |
| MED-55 | Resilience BUG 42 | index.html:1579 | Consent endpoint response not checked for `r.ok` — consent silently lost |
| MED-56 | Resilience BUG 50 | index.html:208 | Affordability filter 3-column grid cramped at 480px |
| MED-57 | Resilience BUG 51/52 | index.html:115, 525 | Price and house popovers overflow viewport on 375px |
| MED-58 | Resilience BUG 53 | privacy.html:76-84 | Tables cause horizontal scroll on mobile |
| MED-59 | Resilience BUG 54 | server.js:2954-2964 | Catch-all route serves raw un-injected HTML on error — auth silently breaks |
| MED-60 | Forms BUG 64 | server.js:732 | Lead `source` field merged into `deal_data` instead of stored in dedicated column |

---

## Low Severity / Code Quality

Key items (not exhaustive — see individual agent logs for full lists):

| Source | File | Description |
|---|---|---|
| Listings BUG 2 | index.html:2541 | Card image missing `alt` text for accessibility |
| Listings BUG 29 | index.html:2403 | "0 bed" pill shown for land/garage lots |
| Listings BUG 34 | index.html:1105 | `goPage()` doesn't clamp to minimum 1 — negative page renders empty |
| Listings BUG 35 | index.html:2233 | Search doesn't `trim()` input — spaces pass truthy check |
| Detail BUG 1 | index.html:2565-2579 | Stale `expanded` class not removed when switching cards |
| Detail BUG 35 | index.html:2565-2576 | Double-click flicker on lot card expansion |
| Detail BUG 48 | index.html:2584 | Expanded panel placeholder missing "No photo" label |
| Detail BUG 56 | index.html:2265 | "Previous" checkbox defaults to checked — clutters with ended auctions |
| Detail BUG 59 | index.html:2122 | `houseFreshness()` shows "NaNd ago" on invalid date |
| Auth BUG 8 | server.js | Trial and paid premium share `tier: 'premium'` — no distinction |
| Auth BUG 11 | index.html | No `?payment=cancelled` handler |
| Auth BUG 33 | index.html | Payment success toast may fire before webhook processes upgrade |
| Auth BUG 35 | index.html | "Upgrade" link shown to already-premium users |
| Auth BUG 37 | server.js | Checkout session missing `subscription_data.metadata` |
| Forms BUG 55 | bridgematch-lite.html:465 | Legal/survey costs fixed at 4% of price — wildly inaccurate at extremes |
| Forms BUG 57 | index.html:2416 | Auction ended badge uses client timezone — wrong for non-UK users |
| Forms BUG 62 | server.js:6629 | Negative bed count produces NaN rent/yield |
| Forms BUG 71 | index.html:2398 | Price formatting uses browser locale, not `en-GB` |
| Forms BUG 80 | server.js:6950 | Yield score thresholds don't match CLAUDE.md documentation |
| Resilience BUG 23 | index.html:78, 92 | Multiple font sizes below 12px on mobile |
| Resilience BUG 24 | index.html | No 375px media query breakpoint despite CLAUDE.md requiring it |
| Resilience BUG 28 | index.html:1528 | `getSession()` has no `.catch()` — unhandled rejection |
| Resilience BUG 33 | server.js:427, 898 | `sendWelcomeEmail()` with `.catch(() => {})` — silent error swallowing |

---

## Duplicate / Overlapping Findings

These bugs were reported by multiple agents — higher confidence:

| Issue | Agents | Bug IDs | Elevated? |
|---|---|---|---|
| Finance API hardcoded to `www.bridgematch.co.uk` | Listings, Detail, Forms | L43/L53, D53, F44/F68 | Yes -> MED-29 |
| Finance property type mapping too naive | Listings, Detail, Forms | L44, D42, F60 | Yes -> MED-30 |
| CSV/JSON export bypasses gating & filters | Auth, Listings, Forms | A5, L28, F49 | Yes -> HIGH-6 |
| No rate limiting on public endpoints | Forms, Resilience, Auth | F2, R10, A16/A19/A49 | Yes -> HIGH-7 |
| Supabase queries lack error handling | Resilience, Auth | R8/R44, A43 | Yes -> HIGH-9 |
| XSS in email templates | Forms (2 code paths) | F1, F76 | Yes -> HIGH-2 |
| Timezone inconsistency in date comparisons | Listings, Forms, Detail | L41/L47, D47, F57 | Yes -> MED-27 |
| `PREMIUM_ENABLED` hardcoded client-side | Resilience, Auth | R2, A9 | Yes -> CRIT-2 |
| VOA_RENTS iteration order fragile | Forms (2 bugs) | F69, F79 | Yes -> MED-41 |
| Preset resets smart search results | Listings, Forms | L40, F75 | Yes -> MED-43 |
| `parseInt()` without radix/NaN check | Resilience, Forms | R30/R31, F51/F61 | Yes -> MED-50 |
| Admin secret in query string | Resilience, Auth | R1, A6 (FIXED) | Verify complete |

---

## Sweep Status

| Agent | Last Sweep Timestamp |
|---|---|
| Listings | 2026-03-14T23:00:00Z (Sweep 3) |
| Detail Pages | 2026-03-14T14:00:00Z (Sweep 3) |
| Auth & Stripe | 2026-03-14T12:00:00Z (Sweep 6) |
| Forms & Data | 2026-03-14T23:55:00Z (Sweep 3) |
| Resilience/Security/Mobile | 2026-03-14T12:00:00Z (Sweep 2) |

---

## Recommended Fix Order

### Priority 1 — Security & Data Leaks (Do This Week)
1. **HIGH-1**: Gate `/api/analyse` — call `stripAIFields()` for non-premium users
2. **HIGH-6**: Gate CSV/JSON export behind auth tier check
3. **CRIT-2**: Remove `PREMIUM_ENABLED` client-side flag, gate server-side
4. **HIGH-2**: HTML-escape all user input in email templates
5. **HIGH-3**: Fix `esc()` to escape quotes for attribute contexts
6. **HIGH-4**: Escape error messages in smart search UI
7. **HIGH-15**: Fix `/api/signup` session_token overwrite (account takeover)
8. **CRIT-1**: Verify ALL admin endpoints migrated to header-only auth

### Priority 2 — Reliability & Error Handling (Do Next)
9. **HIGH-9**: Add error checking to all Supabase queries
10. **HIGH-10**: Add error handling in `callGemini()`
11. **HIGH-11**: Check `r.ok` before `r.json()` in all frontend fetches
12. **CRIT-3**: Add error handling around SSE stream reads
13. **HIGH-13**: Validate required env vars at startup
14. **HIGH-16**: Wrap Puppeteer `newPage()` in try-catch

### Priority 3 — Rate Limiting & Abuse Prevention
15. **HIGH-7**: Add rate limiting to `/api/leads`, `/api/signup`, `/api/all-lots`
16. **MED-15**: Rate limit Stripe endpoints

### Priority 4 — UX & Data Accuracy (Important but Not Urgent)
17. **HIGH-5**: Sort lots by score within tier sections
18. **HIGH-8**: Fix card image error handler to preserve badges
19. **MED-34**: Add close button to expanded panel (mobile critical)
20. **MED-29**: Make finance API URL configurable
21. **MED-30**: Expand finance property type mapping
22. **MED-41/42**: Fix VOA_RENTS key ordering and postcode-vs-street averaging
23. **MED-27**: Standardise timezone handling

### Priority 5 — Mobile Polish
24. **HIGH-14**: Increase touch targets to 44px minimum
25. **MED-47/48/56/57**: Fix sticky panel gap, overflow issues, cramped grids
26. **HIGH-18**: Add mobile navigation to welcome.html

### Priority 6 — Code Quality & Cleanup
27. **MED-49**: Add logging to empty catch blocks
28. **MED-52**: Add global error handler
29. **HIGH-12**: Update `.env.example` with all required vars
30. **MED-50**: Add radix to `parseInt()`, check for NaN

---

## Coordinator sweep completed at 2026-03-14T23:59:00Z
