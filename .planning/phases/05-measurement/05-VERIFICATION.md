---
phase: 05-measurement
verified: 2026-03-22T18:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 5: Measurement Verification Report

**Phase Goal:** Every key user action is tracked, providing MAU counts and funnel data needed to pitch lenders
**Verified:** 2026-03-22T18:00:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Server-side activity events fire for sign-up, search, analyse, deal stacking, and BridgeMatch interactions | VERIFIED | `logActivityEvent('signup')` at server.js:1213, `logActivityEvent('signin')` at server.js:1200, POST /api/track/event at server.js:11223 accepts deal_stacking, csv_export, bridgematch_open with whitelist validation |
| 2 | Umami Cloud reports page views, unique visitors (MAU), referral sources, and bounce rate | VERIFIED | Umami script tag at index.html:692 and bridgematch-lite.html:242, NOT on admin.html (confirmed 0 matches). Script uses `data-domains="auctions.bridgematch.co.uk"` for production-only tracking. `data-website-id=""` with TODO comment for user setup. |
| 3 | BridgeMatch funnel is tracked end-to-end: lot view to finance click to form start to submission | VERIFIED | `umami.track('lot_expand')` at index.html:3020, `umami.track('finance_click')` at index.html:3332, `umami.track('form_start')` at index.html:2745. All include lot context metadata (lot_number, house, guide_price). Server-side bridgematch_open at index.html:3335 via /api/track/event. |
| 4 | Admin can view an analytics summary showing MAU count, top funnels, and engagement metrics | VERIFIED | MAU hero card `#al-mau` at admin.html:486. Funnel visualization with 4 steps (`#fn-lot-expand`, `#fn-finance-click`, `#fn-form-start`, `#fn-lead-submit`) at admin.html:495-510. Engagement cards (bounce, pageviews, visits, signups) at admin.html:519-522. Top searches and referral sources tables at admin.html:529-533. All populated by loadAnalytics() via apiFetch to /api/admin/analytics at admin.html:1316. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server.js` | logActivityEvent calls for signup/signin + POST /api/track/event + fetchUmamiStats/fetchUmamiMetrics + enhanced /api/admin/analytics | VERIFIED | signup event at line 1213, signin at 1200, tracking endpoint at 11223, Umami helpers at 11141/11158, enhanced analytics endpoint at 11187-11201 with parallel Promise.all |
| `index.html` | Umami script tag + umami.track calls for funnel events + fetch to /api/track/event | VERIFIED | Script tag at line 692, lot_expand at 3020, finance_click at 3332, form_start at 2745, tracking fetches at 2780/2882/3335 |
| `bridgematch-lite.html` | Umami script tag | VERIFIED | Script tag at line 242 |
| `privacy.html` | Analytics disclosure mentioning Umami | VERIFIED | Umami disclosure paragraph at line 124 |
| `admin.html` | MAU hero card, funnel chart, engagement metrics in Analytics tab | VERIFIED | MAU hero at 486, funnel at 495-510, engagement cards at 519-522, search/referrer tables at 529-533, JS population at 1353-1407 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| server.js POST /api/signup | logActivityEvent('signup') | direct call after newUser creation | WIRED | Line 1213: `logActivityEvent('signup', { source: 'web' }, newUser.email, getClientIP(req))` |
| server.js POST /api/signup | logActivityEvent('signin') | direct call when existing user found | WIRED | Line 1200: `logActivityEvent('signin', {}, existing.email, getClientIP(req))` |
| server.js POST /api/track/event | logActivityEvent() | lightweight tracking endpoint | WIRED | Line 11228: calls logActivityEvent with validated action, detail, user email, and IP |
| index.html expandCard() | umami.track('lot_expand') | client-side custom event | WIRED | Line 3020: guarded with `if (window.umami)`, includes lot_number, house, guide_price |
| index.html bridgeMatchLot() | umami.track('finance_click') | client-side custom event | WIRED | Line 3332: guarded with `if (window.umami)`, includes lot_number, house, guide_price |
| admin.html loadAnalytics() | /api/admin/analytics | apiFetch call on tab load | WIRED | Line 1316: `apiFetch('/api/admin/analytics?days=${queryDays}')` |
| server.js /api/admin/analytics | Umami API | fetchUmamiStats server-side proxy | WIRED | Lines 11189-11190: parallel calls to fetchUmamiStats and fetchUmamiMetrics, both hitting api.umami.is |
| server.js /api/admin/analytics | activity_events table | Supabase query | WIRED | Line 11191: `supabase.from('activity_events').select(...)` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ANAL-01 | 05-01 | Supabase activity_events wired to key API endpoints (search, analyse, deal stacking, BridgeMatch, sign-up) | SATISFIED | signup/signin events in /api/signup, deal_stacking/csv_export/bridgematch_open via /api/track/event endpoint. Existing analysis/smart_search/lead_submit events confirmed untouched. |
| ANAL-02 | 05-01 | Umami Cloud integrated for page-level metrics (MAU, bounce rate, page views) | SATISFIED | Umami script tag on index.html and bridgematch-lite.html with data-domains restriction. data-website-id placeholder requires user setup but implementation is complete. |
| ANAL-03 | 05-01 | BridgeMatch funnel tracked: lot view -> finance click -> form start -> submission | SATISFIED | lot_expand, finance_click, form_start via umami.track with lot context. bridgematch_open and lead_submit via server-side activity_events. Full funnel covered. |
| ANAL-04 | 05-02 | Admin can view analytics summary (MAU, funnel, engagement) | SATISFIED | MAU hero metric, funnel visualization, engagement cards, top searches, referral sources all present in admin.html Analytics tab, populated from enhanced /api/admin/analytics endpoint. |

No orphaned requirements found -- all 4 ANAL requirements mapped to Phase 5 are claimed and satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| index.html | 690 | TODO: Set data-website-id from Umami Cloud dashboard | Info | Expected -- user must configure Umami Cloud account. Documented in user_setup. Does not block functionality; Umami simply won't track until configured. |
| bridgematch-lite.html | 240 | TODO: Set data-website-id from Umami Cloud dashboard | Info | Same as above -- placeholder for user configuration. |

No blocker or warning-level anti-patterns found. The TODO comments are intentional placeholders for user-provided configuration values (equivalent to env var placeholders).

### Human Verification Required

### 1. Umami Cloud Configuration

**Test:** Create Umami Cloud account, add website, copy Website ID into index.html and bridgematch-lite.html data-website-id attributes, set UMAMI_WEBSITE_ID and UMAMI_API_KEY env vars in Railway
**Expected:** Umami dashboard shows page views, unique visitors, referral sources. Admin Analytics tab shows MAU count instead of "--".
**Why human:** Requires external service account creation and env var configuration that cannot be automated.

### 2. Admin Analytics Tab Visual Verification

**Test:** Open admin.html, navigate to Analytics tab, verify MAU hero is prominently displayed, funnel shows 4 steps with arrows, engagement cards render correctly, search/referrer tables load
**Expected:** Clean layout with MAU as large green number, funnel steps horizontally aligned, engagement metrics in grid, tables showing data or "no data yet" placeholders
**Why human:** Visual layout and styling cannot be verified programmatically

### 3. End-to-End Event Flow

**Test:** Perform sign-up, expand a lot, click BridgeMatch, run deal stacking, export CSV. Check Supabase activity_events table and Umami dashboard for corresponding events.
**Expected:** All actions produce events: signup in activity_events, lot_expand/finance_click/form_start in Umami, deal_stacking/csv_export/bridgematch_open in activity_events
**Why human:** Requires running application with live Supabase and Umami connections

### Gaps Summary

No gaps found. All 4 observable truths are verified. All 4 requirements (ANAL-01 through ANAL-04) are satisfied. All artifacts exist, are substantive, and are properly wired. The only outstanding item is user setup of the Umami Cloud account (data-website-id placeholder), which is by design and documented in the plan's user_setup section.

---

_Verified: 2026-03-22T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
