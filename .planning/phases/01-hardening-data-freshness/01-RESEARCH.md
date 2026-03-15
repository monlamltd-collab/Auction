# Phase 1: Hardening & Data Freshness -- Research

**Researched:** 2026-03-15
**Status:** Complete

## Executive Summary

The codebase has a working auction scraping pipeline with ~21 houses, Stripe billing, and an admin dashboard, but several bugs need fixing: the SDLT calculator uses the correct 5% surcharge structure but only handles England (no Scotland LBTT or Wales LTT), the `trial_used` flag is set on user creation but never checked before granting a new trial, Stripe webhooks lack event.id deduplication, and subscription deletion triggers immediate downgrade without honouring `current_period_end`. The Firecrawl format defaults to `['rawHtml']` instead of `['markdown', 'rawHtml']`. The frontend has a "Previous" checkbox for past auctions but it defaults to checked (showing past), and there is no server-side future-only filtering. No alerting system exists -- pipeline failures are only logged to console. The admin dashboard exists but has no alerts feed or per-house freshness metrics.

## Current State Analysis

### SDLT Calculator

**Location:** `index.html` lines 2460-2468 (main calculator), lines 2470-2484 (`calcDealAnalysis` which calls it), and `bridgematch-lite.html` line 464 (inline in `matchLenders()`).

**What exists:** The `calcSDLT()` function in `index.html` calculates SDLT with the 5% surcharge for additional dwellings. The bands are:
- 0-250k: 5% (this is the surcharge-only band -- 0% base + 5% surcharge)
- 250k-925k: 10% (5% base + 5% surcharge)
- 925k-1.5M: 15% (10% base + 5% surcharge)
- 1.5M+: 17% (12% base + 5% surcharge)

**What's wrong:**
1. **England rates appear correct for 2025/26 investor rates.** The comment says "5% surcharge" and the bands match the current HMRC rates for additional dwellings (the surcharge was raised from 3% to 5% in October 2024). The code correctly implements this.
2. **No Scotland (LBTT + ADS) support.** Scotland has its own Land and Buildings Transaction Tax with different bands and a 6% Additional Dwelling Supplement (ADS). No code exists for this.
3. **No Wales (LTT) support.** Wales has Land Transaction Tax with different bands and a 4% higher rate for additional properties. No code exists for this.
4. **Duplicate code.** `bridgematch-lite.html` has its own inline SDLT formula at line 464 with identical logic. Both need updating together.
5. **No country/region input.** There is no UI element to select England/Scotland/Wales -- both `calcSDLT()` and `calcDealAnalysis()` assume England.

**What needs to change:**
- Add LBTT + ADS calculation for Scotland, LTT calculation for Wales
- Add a country selector to the deal analysis UI (or auto-detect from lot address/postcode)
- Keep both `index.html` and `bridgematch-lite.html` in sync
- Consider extracting the calculator into a shared module (though current architecture is single-file)

### Stripe Subscription & Trial Management

**Location:** `server.js` lines 1610-1686 (`validateUserFromReq`), lines 1245-1287 (checkout), lines 1289-1408 (webhooks).

**What exists:** When a new user logs in via Supabase JWT and no existing user record is found:
1. A new user row is inserted with `tier: 'premium'`, `trial_used: true`, `trial_expires_at` set to 14 days out (line 1651-1664)
2. The `trial_used` flag IS set to `true` on creation

**What's wrong (HARD-03 -- trial abuse):**
- The `trial_used` flag is **set** but **never checked** before creating a new user. Lines 1651-1664 show the auto-create logic: it inserts a new user with a trial, but there is no prior check for an existing user with the same email who already has `trial_used: true`.
- The email lookup at lines 1633-1648 does check by email and links the existing user, so re-registration with the same email through Supabase Auth would find the existing user. However, if a user deletes their Supabase Auth account and re-registers with the same email, the `byAuthId` lookup would fail, but the `byEmail` lookup would still find them.
- The real vulnerability: if a user signs up with email A (trial used), then signs up with email B (new Supabase Auth account), they get a fresh trial. There is no cross-email deduplication, but this is a different, lower-priority issue.
- A simpler exploit: if the `users` row is somehow deleted or the email doesn't match (case sensitivity edge case), the user gets a fresh trial.

**Fix approach:** Before the auto-create block (line 1651), add an explicit check: query users table for `email = email AND trial_used = true`. If found, create the user with `tier: 'free'` instead of starting a trial.

### Webhook Handling

**Location:** `server.js` lines 1289-1408.

**What exists:** The webhook handler verifies the Stripe signature, then switches on `event.type` to handle `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`, and `invoice.payment_failed`. It returns `{ received: true }` at the end.

**What's wrong (HARD-04 -- idempotency):**
- There is **no deduplication by `event.id`**. If Stripe retries a webhook delivery (which it does on timeouts or 5xx responses), the same event will be processed again.
- For `checkout.session.completed`, this means duplicate payment records in the `payments` table and redundant user tier updates.
- For `customer.subscription.deleted`, a duplicate could attempt to downgrade an already-free user (harmless but wasteful).
- For `invoice.payment_failed`, duplicate emails could be sent.

**Fix approach:**
- Option A: Create a `processed_webhook_events` table in Supabase with `event_id text PRIMARY KEY` and `processed_at timestamptz`. Check before processing, insert after.
- Option B: Use an in-memory Set with a TTL (simpler but lost on restart -- acceptable if combined with idempotent operations).
- Option A is more robust. The check-then-insert should happen immediately after signature verification (line 1302).

### Subscription Downgrade Logic

**Location:** `server.js` lines 1345-1362 (`customer.subscription.deleted` handler), lines 1364-1378 (`customer.subscription.updated` handler).

**What exists:**
- `customer.subscription.deleted`: Immediately sets `tier: 'free'`, `stripe_subscription_id: null`, `tier_expires_at: null` (line 1354-1358).
- `customer.subscription.updated` with `past_due`/`canceled`/`unpaid`: Immediately sets `tier: 'free'`, `tier_expires_at: null` (line 1375).

**What's wrong (HARD-05):**
- Neither handler checks `sub.current_period_end`. When a user cancels their subscription, Stripe fires `customer.subscription.updated` with `cancel_at_period_end: true` while the subscription is still active. Then when the period actually ends, Stripe fires `customer.subscription.deleted`.
- The `customer.subscription.deleted` handler immediately downgrades, but the user has **already paid** for the current billing period. They should retain access until `current_period_end`.
- The `customer.subscription.updated` handler with `canceled` status also immediately downgrades without checking if the period has ended.

**Fix approach:**
- In `customer.subscription.deleted`: Instead of immediate downgrade, set `tier_expires_at` to `new Date(sub.current_period_end * 1000).toISOString()` and keep `tier: 'premium'`. The existing trial expiry logic in `validateUserFromReq` (line 1625) already checks `tier_expires_at` and auto-downgrades expired users on login.
- In `customer.subscription.updated`: When status is `canceled` (but period not yet ended), set `tier_expires_at` to `current_period_end` rather than immediate downgrade. Only downgrade immediately for `unpaid`/`past_due` if desired.

### Firecrawl Scraping

**Location:** `server.js` line 279 (`scrapeWithFirecrawl` function).

**What exists:** The default format is `['rawHtml']` (line 279: `const formats = options.formats || ['rawHtml']`). One specific call at line 671-674 uses `['rawHtml', 'images']` for image backfill.

**What's wrong (HARD-07):**
- The default format is `['rawHtml']` only. Adding `'markdown'` to the default would give Gemini better structured text for extraction at zero additional Firecrawl credit cost (Firecrawl charges per scrape, not per format).
- The `markdown` output is particularly useful for Gemini because it preserves document structure (headings, lists, links) in a format Gemini understands natively.

**Fix approach:**
- Change line 279 from `['rawHtml']` to `['markdown', 'rawHtml']`
- The `markdown` content will be available as `result.data.markdown` in the Firecrawl response
- Update the AI extraction pipeline to prefer markdown when available, falling back to rawHtml
- The image backfill call at line 674 can stay as `['rawHtml', 'images']` or be updated to `['markdown', 'rawHtml', 'images']`

### Frontend Auction Display

**Location:** `index.html` lines 835-840 (filter bar), lines 2289-2294 (filtering logic), line 1135 (API call).

**What exists:**
- A "Previous" checkbox (`fIncludePrevious`) at line 840, **checked by default**
- When unchecked, lots with `_auctionDate` before today are filtered out (line 2291-2293)
- The filtering is **client-side only** -- `/api/all-lots` returns all lots regardless
- The API call at line 1135 fetches `/api/all-lots` with no date parameters

**What's wrong (FRSH-01):**
- The checkbox defaults to **checked**, meaning past auctions are shown by default -- the opposite of the desired behavior
- Filtering is client-side only, meaning all data is transferred even when past auctions aren't wanted
- No `?includePast=true` URL param support for bookmarking
- No 7-day grace period (the context decision says past auctions should stay visible for 7 days to see sold prices)

**Fix approach (per context decisions):**
1. **Server-side:** Add `?includePast=true` query param to `/api/all-lots`. Default behavior filters out lots where `_auctionDate < today - 7 days`.
2. **Frontend:** Change checkbox to "Show past auctions" (unchecked by default). Read/write `?showPast=true` URL param. When checked, pass `?includePast=true` to the API.
3. **7-day grace:** Lots from auctions within the past 7 days remain in the default view (recent enough to check sold prices).

### Sold/Unsold Status (FRSH-02, FRSH-03)

**Location:** DOM extractors in `server.js` (lines ~5469, ~5747 show status detection in two extractors).

**What exists:**
- Two DOM extractors check for sold/withdrawn status and push `'SOLD/STC'` as a bullet string
- The AI search endpoint (line 3311) uses regex on bullets to filter by sold status: `/\bSOLD\b|\bSTC\b|\bSALE.?AGREED\b|\bWITHDRAWN\b/i`
- Frontend has a "Sold" filter dropdown (line 835): `<option value="all">All lots</option><option value="available">Available only</option><option value="sold">Sold only</option>`

**What's wrong:**
- Status is stored as a bullet string rather than a structured `lot.status` field
- Detection is inconsistent -- only 2 of ~21 DOM extractors check for status
- No standardized values: the regex searches for multiple patterns across free-text bullets
- The overlay display (estate agent style) requires a proper `lot.status` field, not regex matching on bullets

**Fix approach:**
- Add `lot.status` field to the extraction pipeline output schema: `'available' | 'sold' | 'stc' | 'withdrawn'`
- Default to `'available'` when no status detected
- Update DOM extractors to set `lot.status` directly
- Update Gemini extraction prompts to include `status` in the JSON schema
- Add overlay rendering in the frontend card builder (`lotCard()` function at ~line 2400)

### Data Freshness & Monitoring (FRSH-04, FRSH-05)

**Location:** `server.js` lines 9786-9851 (`saveDailySnapshot`), lines 9854-9880 (`/api/admin/analytics`), lines 4020-4035 (`/api/admin/skills`). `admin.html` is the admin dashboard.

**What exists:**
- `saveDailySnapshot()` captures total lots, image coverage %, lots by house, engine breakdown, healthy/degraded/broken house counts
- `house_skills` table tracks per-house status (`healthy`/`degraded`/`broken`), last verified time, lot count, image coverage
- `analytics_snapshots` table has daily time-series data
- Admin dashboard (`admin.html`) has stat cards, tables, and charts, but **no alerts feed** and **no per-house freshness table with diff summaries**
- Pipeline failures are logged to console only (`console.error`) -- no structured alerting

**What's missing (FRSH-04 -- alerting):**
- No alert event storage (no `pipeline_alerts` table)
- No alert generation on `autoAnalyseOne` failure (line 9249 just logs to console)
- No alert generation on `discoverAndUpdateCalendar` failure (line 9123 just logs)
- No alert UI in `admin.html`
- No image coverage drop detection
- No DOM extractor regression detection

**What's missing (FRSH-05 -- admin freshness metrics):**
- No per-house health table with last scrape time, lot count, image coverage %, status
- No diff summary per scrape run (lots added/removed/changed)
- No sortable columns for quick scan
- The data exists in `house_skills` and `cached_analyses` tables but isn't surfaced in the admin UI with the requested detail level

**Fix approach:**
1. Create a `pipeline_alerts` Supabase table: `id, event_type, severity, house, message, resolved, created_at, resolved_at`
2. Add alert generation hooks in `autoAnalyseOne` (on failure), `discoverAndUpdateCalendar` (on failure), and in the image coverage calculation
3. Add an API endpoint: `GET /api/admin/alerts`
4. Add an "Alerts" feed section to `admin.html`
5. Extend `house_skills` or create a new table to store per-scrape diff data
6. Add a per-house freshness table to `admin.html` with sortable columns

## Validation Architecture

| Requirement | Test Approach |
|---|---|
| HARD-01 (SDLT 5% surcharge) | Unit test: `calcSDLT(200000)` should return 10000 (200k * 5%). `calcSDLT(300000)` should return 17500 (250k*5% + 50k*10%). Compare against HMRC online calculator. |
| HARD-02 (Scotland LBTT, Wales LTT) | Unit test: `calcLBTT(200000)` against Revenue Scotland calculator. `calcLTT(200000)` against Welsh Revenue Authority calculator. |
| HARD-03 (trial_used check) | Manual test: create user with email A, verify trial. Delete Supabase Auth account. Re-register with email A -- should get `tier: 'free'`, not another trial. |
| HARD-04 (webhook idempotency) | Send the same webhook event.id twice -- verify only one payment record created, no duplicate side effects. |
| HARD-05 (downgrade honours period end) | Simulate subscription cancellation -- verify `tier_expires_at` is set to `current_period_end`, not immediate. User should retain premium until that date. |
| HARD-07 (Firecrawl format) | Verify `scrapeWithFirecrawl` sends `['markdown', 'rawHtml']` in the request body. Check that extraction still works with both formats. |
| FRSH-01 (future-only default) | Load page fresh -- verify past auctions (> 7 days old) are hidden. Check "Show past auctions" checkbox -- verify they appear. Verify `?showPast=true` URL param. |
| FRSH-02 (sold/unsold display) | Find a lot with "SOLD" in its data -- verify diagonal overlay banner appears on the card. |
| FRSH-03 (lot.status field) | Check API response for `lot.status` field presence. Verify values are one of: available, sold, stc, withdrawn. |
| FRSH-04 (alerting) | Simulate an autoAnalyse failure -- verify alert appears in admin dashboard within 15 minutes. |
| FRSH-05 (admin freshness metrics) | Load admin dashboard -- verify per-house health table shows last scrape time, lot count, image coverage %, status. |

## Key Files Map

| File | Role in Phase 1 | Lines |
|---|---|---|
| `server.js` | Stripe webhooks, trial logic, Firecrawl config, autoAnalyse pipeline, admin APIs, alerting hooks | ~9900 lines total |
| `index.html` | SDLT calculator (`calcSDLT`), deal analysis, lot card rendering, filter bar, sold/unsold display | ~2500 lines |
| `bridgematch-lite.html` | Duplicate SDLT formula in `matchLenders()` | line 464 |
| `admin.html` | Admin dashboard -- needs alerts feed, freshness table | ~500+ lines |
| `schema.sql` | Supabase schema -- needs `pipeline_alerts` table, possible `users` table migration | 106 lines |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| SDLT rates change mid-implementation | Low | Low | Rates for 2025/26 are set. Use configurable rate tables, not hardcoded values. |
| Stripe webhook idempotency race condition | Medium | Medium | Use Supabase `INSERT ... ON CONFLICT DO NOTHING` for atomic check-and-insert of event IDs. |
| Firecrawl `markdown` format breaks extraction | Medium | Low | Keep `rawHtml` as fallback. Add `markdown` as supplementary, not replacement. Test with 2-3 houses before full rollout. |
| Server-side date filtering breaks lots without `_auctionDate` | High | Medium | The `_auctionDate` is derived from `FALLBACK_CALENDAR` URL-date map (line 3506-3515). Lots without a matching calendar entry get `_auctionDate: null`. Must treat `null` date as "include by default" to avoid hiding valid lots. |
| Admin dashboard changes break existing functionality | Low | Low | Admin dashboard is read-only. Additive changes (new sections) don't affect existing features. |
| `lot.status` field breaks existing frontend filtering | Medium | Medium | The existing sold filter uses regex on bullets. Migrate gradually: add `lot.status` field while keeping bullet-based detection as fallback. Update frontend to prefer `lot.status` when present. |
| Duplicate SDLT code in two files diverges | Medium | High | Both `index.html` and `bridgematch-lite.html` have independent SDLT formulas. Must update both simultaneously. Consider extracting to shared JS file loaded by both. |

## Implementation Notes

### Patterns to Follow
- **Express route handlers:** Try/catch with structured JSON error responses via `log.error()`
- **Admin auth:** `x-admin-secret` header checked via `safeCompare()`
- **Supabase queries:** Use `.from().select().eq()` pattern; `.maybeSingle()` when row may not exist
- **HTML rendering in admin:** Use `escHtml()` helper for all user-supplied data
- **Logging:** Use the structured `log()` function, not bare `console.log()` for important events

### Dependencies Between Changes
1. **FRSH-03 (lot.status) must come before FRSH-02 (sold display)** -- the overlay rendering depends on a clean status field
2. **HARD-07 (Firecrawl format) should come early** -- it's a one-line change with low risk that benefits all subsequent scraping
3. **HARD-04 (webhook idempotency) should come before HARD-05 (downgrade logic)** -- fixing downgrade logic on a non-idempotent handler could cause issues
4. **FRSH-04 (alerting) depends on FRSH-05 (admin dashboard)** -- alerts need a place to be displayed
5. **HARD-01/HARD-02 (SDLT) are independent** -- can be done in parallel with Stripe fixes

### Gotchas
- The `users` table schema in `schema.sql` does NOT include `trial_used`, `trial_started_at`, `trial_expires_at`, `stripe_customer_id`, `stripe_subscription_id`, `tier`, `tier_expires_at`, or `supabase_auth_id` columns. These were added via migrations (e.g., `smart_search_cache_schema.sql` adds `tier`). The production database has these columns, but the schema file is out of date.
- `server.js` is ~131K / ~9900 lines. All backend logic is in one file. Changes need careful line-number awareness.
- The `fIncludePrevious` checkbox is checked by default AND labeled "Previous" (line 840). Changing the default to unchecked AND relabeling to "Show past auctions" are both needed.
- The `calcDealAnalysis()` function in `index.html` (line 2471) calls `calcSDLT()` -- any SDLT changes propagate automatically to deal analysis for England, but Scotland/Wales need explicit handling.
- Firecrawl `executeJavascript` and `images` formats are used in specific contexts (backfill). The default format change affects the primary scraping path only.
- The `customer.subscription.deleted` handler currently nulls out `stripe_subscription_id`. If we set `tier_expires_at` instead of immediate downgrade, we need to decide whether to also null the subscription ID (breaking potential recovery) or keep it.

### New Supabase Tables/Columns Needed
1. **`pipeline_alerts` table:** `id uuid PK, event_type text, severity text ('warning'|'error'), house text, message text, resolved boolean DEFAULT false, created_at timestamptz, resolved_at timestamptz`
2. **`processed_webhook_events` table:** `event_id text PK, processed_at timestamptz DEFAULT now()`
3. **Extend `cached_analyses`:** Consider adding `last_diff jsonb` column for scrape-over-scrape diff summaries
4. **Extend `analytics_snapshots`:** May need additional columns for per-house diff data if not stored in `cached_analyses`

---

*Phase: 01-hardening-data-freshness*
*Research completed: 2026-03-15*
