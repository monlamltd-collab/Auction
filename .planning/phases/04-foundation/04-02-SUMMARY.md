---
phase: 04-foundation
plan: 02
subsystem: payments
tags: [stripe, feature-flag, tier-resolution, rate-limiting]

# Dependency graph
requires: []
provides:
  - STRIPE_ENABLED feature flag for Stripe hibernation
  - resolveEffectiveTier() centralised tier resolution function
  - Updated getAISearchLimit() with 50/day for Stripe-disabled mode
  - Stripe endpoint guards (503 when hibernated)
  - stripeEnabled exposed to client via /api/auth/me
affects: [04-foundation, frontend-gating, client-stripe-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [feature-flag-env-var, centralised-tier-resolution]

key-files:
  created:
    - tests/test-gating.js
  modified:
    - server.js

key-decisions:
  - "STRIPE_ENABLED defaults to true for backwards compatibility"
  - "resolveEffectiveTier maps all signed-in users to premium when Stripe disabled"
  - "Webhook stays alive for subscription.deleted only when hibernated"
  - "/api/stripe/status returns JSON (not 503) when disabled for graceful client handling"
  - "New users created as free tier when Stripe disabled (no trial burn)"
  - "RATE_LIMIT for /api/analyse set to 50/day when Stripe disabled"

patterns-established:
  - "Feature flag pattern: const FLAG = process.env.FLAG !== 'false' (opt-out, backwards compatible)"
  - "Centralised tier resolution: resolveEffectiveTier(user) replaces inline tier checks"

requirements-completed: [GATE-01, GATE-02, GATE-05]

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 4 Plan 2: Server-Side Stripe Hibernation Summary

**STRIPE_ENABLED feature flag with centralised resolveEffectiveTier(), 50/day rate limits, and full endpoint guarding**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T02:12:58Z
- **Completed:** 2026-03-21T02:16:35Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- STRIPE_ENABLED env var controls all Stripe functionality (defaults true, backwards compatible)
- resolveEffectiveTier() centralises tier logic -- no more scattered inline checks
- All Stripe endpoints guarded: checkout, portal, diag return 503; status returns graceful JSON; webhook processes only subscription deletions
- Rate limits: 50/day for signed-in users when Stripe disabled, existing limits preserved when enabled
- CSP dynamically removes checkout.stripe.com when Stripe disabled
- stripeEnabled exposed to client via /api/auth/me response
- New users created as 'free' tier when Stripe disabled (preserving trial for when Stripe re-enables)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Create gating test scaffold** - `0b96c47` (test)
2. **Task 1 (GREEN): STRIPE_ENABLED flag + resolveEffectiveTier + getAISearchLimit** - `9d004c6` (feat)
3. **Task 2: Guard Stripe endpoints and update CSP** - `1855560` (feat)

_TDD task had separate RED and GREEN commits._

## Files Created/Modified
- `tests/test-gating.js` - 15 tests covering resolveEffectiveTier and getAISearchLimit for all tier/flag combos
- `server.js` - STRIPE_ENABLED flag, resolveEffectiveTier(), updated getAISearchLimit(), endpoint guards, CSP, auth/me response

## Decisions Made
- STRIPE_ENABLED defaults to true (backwards compatible) -- only disabled when explicitly set to 'false'
- resolveEffectiveTier returns 'premium' for all signed-in users when Stripe disabled (simplifies gating)
- /api/stripe/status returns JSON `{ active: false, stripeEnabled: false }` instead of 503, since clients may poll this endpoint
- New user auto-creation sets tier to 'free' when Stripe disabled, preserving trial_used=false for future re-enablement
- RATE_LIMIT uses literal 50 instead of SIGNED_IN_DAILY_LIMIT constant to avoid forward reference in const declaration

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed RATE_LIMIT forward reference**
- **Found during:** Task 2 (RATE_LIMIT update)
- **Issue:** RATE_LIMIT (line 207) referenced SIGNED_IN_DAILY_LIMIT (line 1871) -- const is not hoisted, would cause runtime error
- **Fix:** Used literal `50` instead of SIGNED_IN_DAILY_LIMIT in RATE_LIMIT declaration
- **Files modified:** server.js
- **Verification:** Tests pass, no runtime errors
- **Committed in:** 1855560 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial fix to avoid const hoisting error. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. STRIPE_ENABLED defaults to true (backwards compatible). Set STRIPE_ENABLED=false in Railway env vars when ready to hibernate.

## Next Phase Readiness
- Server-side gating complete, ready for client-side UI updates (plan 04-03)
- stripeEnabled flag available in /api/auth/me for frontend to conditionally hide payment UI
- All existing functionality unchanged when STRIPE_ENABLED is not set

---
*Phase: 04-foundation*
*Completed: 2026-03-21*
