---
status: diagnosed
trigger: "Signed-in user clicks lot, sign-in modal appears instead of expanding lot details"
created: 2026-03-22T00:00:00Z
updated: 2026-03-22T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Race condition between initAuth() and loadAllLots() causes lots to be fetched without auth token
test: Traced execution order in index.html
expecting: loadAllLots fires before session is available
next_action: Return diagnosis

## Symptoms

expected: Clicking a lot expands its details when user is signed in
actual: Sign-in modal appears even when user name shows in top-right corner
errors: None
reproduction: Sign in, see name in top-right, click any auction lot
started: Since auth gating was added

## Eliminated

## Evidence

- timestamp: 2026-03-22
  checked: Execution order of initAuth() vs loadAllLots()
  found: initAuth() at line 1733 starts ASYNC getSession(). loadAllLots() at line 3380 fires SYNCHRONOUSLY immediately after. getSession() resolves AFTER loadAllLots() fetch is already sent.
  implication: The fetch to /api/all-lots has no Authorization header because currentSession is still null.

- timestamp: 2026-03-22
  checked: Server-side /api/all-lots handler (server.js line 3801-4016)
  found: Server calls validateUserFromReq(req) which checks Authorization header. No header = user is null = isSignedIn is false = anonGated:true is set on every lot object.
  implication: Lot objects in client memory permanently have anonGated:true baked in.

- timestamp: 2026-03-22
  checked: onSignIn() function (index.html line 1640-1666)
  found: onSignIn updates UI (nav text, session vars) and calls updateProStatus(), but does NOT call loadAllLots() to re-fetch lots with auth token.
  implication: Even after auth completes, stale lot data with anonGated:true remains in ALL_LOTS/LOTS arrays.

- timestamp: 2026-03-22
  checked: expandCard() function (index.html line 3017-3018)
  found: First line checks `if (lot.anonGated) { $('signupModal').classList.add('show'); return; }` - gate fires because lot objects still carry anonGated:true from the unauthenticated fetch.
  implication: This is the direct cause of the modal appearing for signed-in users.

## Resolution

root_cause: Race condition between async auth initialization and synchronous lot loading. initAuth() (line 1733) starts an async Supabase getSession() call, but loadAllLots() (line 3380) fires immediately without waiting for auth to resolve. The /api/all-lots fetch goes out without an Authorization header, so the server marks all lots as anonGated:true. When auth completes moments later, onSignIn() updates the UI (name in nav bar) but never re-fetches /api/all-lots. The lot objects in memory permanently retain anonGated:true, causing expandCard() (line 3018) to show the sign-in modal on every click.
fix:
verification:
files_changed: []
