---
status: diagnosed
trigger: "GET /api/admin/analytics returns HTML instead of JSON due to catch-all route ordering"
created: 2026-03-22T00:00:00Z
updated: 2026-03-22T00:00:00Z
---

## Current Focus

hypothesis: catch-all app.get('*') on line 4623 intercepts all GET routes registered after it
test: grep for route registrations after line 4623
expecting: affected routes return HTML instead of JSON
next_action: report diagnosis

## Symptoms

expected: GET /api/admin/analytics returns JSON analytics data
actual: Returns index.html (HTML) because catch-all matches first
errors: Frontend likely sees JSON parse error on HTML response
reproduction: Any GET request to /api/admin/analytics
started: Since analytics endpoint was added (after catch-all was already in place)

## Eliminated

(none needed - root cause confirmed on first check)

## Evidence

- timestamp: 2026-03-22
  checked: server.js line 4623
  found: app.get('*') catch-all serves index.html with injected Supabase config
  implication: Any GET route registered after this line is unreachable

- timestamp: 2026-03-22
  checked: server.js line 11176
  found: app.get('/api/admin/analytics') registered 6553 lines after catch-all
  implication: Express never reaches this handler; catch-all matches first

- timestamp: 2026-03-22
  checked: All route registrations after line 4623
  found: 5 GET routes and 2 POST routes registered after catch-all
  implication: All 5 GET routes are broken; POST routes are unaffected (catch-all is GET only)

## Resolution

root_cause: Express matches routes in registration order. The catch-all `app.get('*')` on line 4623 matches every GET request, so the 5 GET endpoints registered after it (lines 11094-11223) never execute. They all return index.html instead of JSON.

fix: Move the catch-all `app.get('*')` to be the LAST route registered in server.js (after line 11223).

verification: (pending fix)
files_changed: []
