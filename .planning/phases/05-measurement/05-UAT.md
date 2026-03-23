---
status: diagnosed
phase: 05-measurement
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md]
started: 2026-03-22T18:00:00Z
updated: 2026-03-22T18:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Start the application from scratch with `node server.js`. Server boots without errors. Visiting http://localhost:{PORT} loads the homepage.
result: pass

### 2. Tracking Endpoint Accepts Events
expected: POST /api/track/event with JSON body `{"action":"deal_stacking"}` returns a success response (200). Invalid actions are rejected.
result: pass

### 3. Umami Script Tag on Public Pages
expected: View page source of index.html and bridgematch-lite.html. Both contain a `<script>` tag with `src` pointing to Umami Cloud and a `data-website-id` attribute (may be empty placeholder). admin.html does NOT have the Umami script.
result: issue
reported: "Umami script is present on public pages and absent from admin, but blocked by Content Security Policy. CSP script-src doesn't include https://cloud.umami.is"
severity: major

### 4. Client-Side Funnel Events Fire
expected: On the auction lots page, expanding a lot detail triggers a `lot_expand` event. Clicking a finance/BridgeMatch link triggers `finance_click`. Starting to fill the BridgeMatch form triggers `form_start` (once per session only).
result: issue
reported: "User is signed in (shows simon.deeming top-right) but clicking a lot still shows the sign-in modal. Modal also has text overflow on checkbox labels."
severity: blocker

### 5. Privacy Page Updated
expected: Visiting /privacy or privacy.html shows an analytics disclosure paragraph mentioning Umami and explaining what data is collected.
result: pass

### 6. Admin Analytics Endpoint Returns Data
expected: GET /api/admin/analytics (with admin auth) returns JSON containing `snapshots`, `umami`, `referrers`, and `events` keys. When Umami is not configured, those fields degrade gracefully (null/empty) without errors.
result: issue
reported: "Endpoint returns HTML (index.html) instead of JSON. The catch-all app.get('*') on line 4623 is registered before the analytics route on line 11176, intercepting the API call."
severity: blocker

### 7. Admin Analytics Dashboard - MAU Hero
expected: On the admin dashboard Analytics tab, a large MAU (Monthly Active Users) number is displayed prominently as the hero metric. If Umami is not configured, it shows 0 or a fallback gracefully.
result: pass

### 8. Admin Analytics Dashboard - Funnel Visualization
expected: The Analytics tab shows a BridgeMatch funnel with 4 steps: lot views -> finance clicks -> form starts -> submissions. Steps that rely on Umami data show "See Umami dashboard" when not available.
result: skipped
reason: Blocked by analytics endpoint route ordering bug (Test 6)

### 9. Admin Analytics Dashboard - Engagement Metrics
expected: The Analytics tab displays engagement metric cards including bounce rate, page views, visits, and signups.
result: skipped
reason: Blocked by analytics endpoint route ordering bug (Test 6)

### 10. Admin Analytics Dashboard - Data Tables
expected: The Analytics tab shows a top search queries table and a referral sources table populated from API data.
result: skipped
reason: Blocked by analytics endpoint route ordering bug (Test 6)

## Summary

total: 10
passed: 4
issues: 3
pending: 0
skipped: 3

## Gaps

- truth: "Umami script loads and executes on public pages"
  status: failed
  reason: "User reported: Umami script is present on public pages and absent from admin, but blocked by Content Security Policy. CSP script-src doesn't include https://cloud.umami.is"
  severity: major
  test: 3
  root_cause: "CSP header in server.js line 91 missing https://cloud.umami.is in script-src, and line 95 missing https://cloud.umami.is https://api.umami.is in connect-src"
  artifacts:
    - path: "server.js"
      issue: "script-src missing https://cloud.umami.is (line 91)"
    - path: "server.js"
      issue: "connect-src missing https://cloud.umami.is and https://api.umami.is (line 95)"
  missing:
    - "Add https://cloud.umami.is to script-src directive"
    - "Add https://cloud.umami.is and https://api.umami.is to connect-src directive"
  debug_session: ""

- truth: "Signed-in user can expand lot details without sign-in prompt"
  status: failed
  reason: "User reported: User is signed in (shows simon.deeming top-right) but clicking a lot still shows the sign-in modal. Modal also has text overflow on checkbox labels."
  severity: blocker
  test: 4
  root_cause: "Race condition: initAuth() is async but loadAllLots() fires synchronously before auth resolves. Lots fetched without auth token get anonGated:true. onSignIn() updates nav but never re-fetches lots."
  artifacts:
    - path: "index.html"
      issue: "initAuth() at line 1733 is async, loadAllLots() at line 3380 fires before auth resolves"
    - path: "index.html"
      issue: "getAuthHeaders() returns empty when currentSession is null (line 1618)"
    - path: "index.html"
      issue: "onSignIn() at line 1640 updates UI but does not re-fetch lots"
    - path: "server.js"
      issue: "Server stamps anonGated:true when no auth header (line 3985)"
  missing:
    - "In onSignIn(), call loadAllLots() to re-fetch lots with valid auth token"
  debug_session: ".planning/debug/lot-click-auth-gate.md"

- truth: "Admin analytics endpoint returns JSON with snapshots, umami, referrers, events"
  status: failed
  reason: "User reported: Endpoint returns HTML (index.html) instead of JSON. The catch-all app.get('*') on line 4623 is registered before the analytics route on line 11176, intercepting the API call."
  severity: blocker
  test: 6
  root_cause: "Express catch-all app.get('*') at line 4623 registered before 3 GET endpoints: /api/admin/alerts (11094), /api/admin/freshness (11122), /api/admin/analytics (11176). All return HTML instead of JSON."
  artifacts:
    - path: "server.js"
      issue: "Catch-all app.get('*') at line 4623 intercepts all later GET routes"
    - path: "server.js"
      issue: "/api/admin/alerts at line 11094 unreachable"
    - path: "server.js"
      issue: "/api/admin/freshness at line 11122 unreachable"
    - path: "server.js"
      issue: "/api/admin/analytics at line 11176 unreachable"
  missing:
    - "Move catch-all app.get('*') block to after the last route registration (after line 11223)"
  debug_session: ".planning/debug/catchall-route-ordering.md"
