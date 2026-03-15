---
phase: 01-hardening-data-freshness
plan: 02
subsystem: payments
tags: [stripe, webhooks, idempotency, trial, billing]

# Dependency graph
requires:
  - phase: none
    provides: none
provides:
  - Trial abuse prevention via trial_used flag check
  - Webhook idempotency via processed_webhook_events table
  - Graceful subscription downgrade honouring current_period_end
  - Grace period on payment failure instead of immediate downgrade
affects: [phase-3-deal-stacking-tier-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook idempotency via event ID dedup table with periodic cleanup"
    - "Grace period pattern for payment failures (3-day window before downgrade)"
    - "Subscription cancellation honours paid period via tier_expires_at"

key-files:
  created:
    - ".planning/phases/01-hardening-data-freshness/01-02-SUMMARY.md"
  modified:
    - "server.js"
    - "schema.sql"

key-decisions:
  - "7-day TTL for processed webhook events with cleanup every 100th webhook"
  - "3-day grace period for past_due subscriptions before downgrade"
  - "Subscription deletion preserves premium until current_period_end via existing tier_expires_at mechanism"

requirements-completed: [HARD-03, HARD-04, HARD-05]

# Metrics
duration: 3 min
completed: 2026-03-15
---

# Plan 01-02: Stripe Hardening — Trial Abuse, Webhook Idempotency & Downgrade Logic Summary

**Trial abuse prevention via trial_used check, webhook idempotency via event dedup table, and graceful subscription downgrade honouring current_period_end with 3-day grace on payment failure**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-15T19:33:03Z
- **Completed:** 2026-03-15T19:36:11Z
- **Tasks:** 6 (5 code tasks + 1 verification)
- **Files modified:** 2

## Accomplishments
- Users with existing `trial_used: true` email are now created with `tier: 'free'` on re-registration, preventing trial abuse
- Duplicate webhook events are detected and skipped via `processed_webhook_events` table with upsert for race condition safety
- Subscription deletion honours `current_period_end` instead of immediate downgrade
- `customer.subscription.updated` now handles `canceled`, `past_due`, and `unpaid` statuses with appropriate grace periods
- Verified that `validateUserFromReq` already handles `tier_expires_at` correctly for both trial and subscription expiry

## Task Commits

Each task was committed atomically:

1. **Task 01-02-01: Add trial_used check before auto-creating user with trial** - `8eb1b68` (fix)
2. **Task 01-02-02: Create processed_webhook_events table** - `701c77d` (feat)
3. **Task 01-02-03: Add webhook event deduplication** - `cf1a505` (fix)
4. **Task 01-02-04: Fix subscription.deleted to honour current_period_end** - `4ea2930` (fix)
5. **Task 01-02-05: Fix subscription.updated to not downgrade during active period** - `1ac6561` (fix)
6. **Task 01-02-06: Verify validateUserFromReq handles tier_expires_at correctly** - no commit (verification only, existing code already correct)

## Files Created/Modified
- `server.js` - Trial abuse check, webhook deduplication, subscription lifecycle fixes
- `schema.sql` - Added `processed_webhook_events` table with RLS policy

## Decisions Made
- 7-day TTL for webhook event dedup records, cleaned up every 100th webhook (Stripe retries max 72 hours so 7 days is generous)
- 3-day grace period for `past_due` subscriptions before auto-downgrade, balancing user experience with revenue protection
- Subscription deletion preserves premium via `tier_expires_at` which is already checked by `validateUserFromReq` on every request

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. The `processed_webhook_events` table SQL needs to be run in Supabase SQL Editor (it's documented in schema.sql).

## Next Phase Readiness
- Stripe hardening complete, ready for remaining Phase 1 plans (01-03, 01-04)
- Requirements HARD-03, HARD-04, HARD-05 fulfilled

---
*Phase: 01-hardening-data-freshness*
*Completed: 2026-03-15*
