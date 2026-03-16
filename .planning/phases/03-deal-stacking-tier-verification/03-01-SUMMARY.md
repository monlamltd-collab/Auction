---
phase: 03-deal-stacking-tier-verification
plan: 01
subsystem: ui, finance
tags: [deal-stacking, calculator, bridging-finance, lender-matching, flip, hold, roi]

requires:
  - phase: 01-hardening-data-freshness
    provides: calcSDLT() function and detectCountry() for SDLT calculations
provides:
  - calcDealStack() function for full deal stacking analysis
  - Deal stacking widget in expanded panel (premium only)
  - Live recalculation with debounce on all inputs and LTV slider
  - Flip and Hold scenario side-by-side comparison
affects: [03-deal-stacking-tier-verification]

tech-stack:
  added: []
  patterns: [deal-stacking-calculator, lender-fallback, debounced-recalculation]

key-files:
  created: []
  modified: [index.html]

key-decisions:
  - "Lender matching filters LENDER_DATA by LTV then picks lowest rate; falls back to 0.85%/mo and 2% arrangement fee"
  - "Hold scenario uses 75% BTL refinance at 5.5% interest-only with 10% management and 1-month void"
  - "Deal stacking widget only rendered for isPremium() users; free-tier CTA deferred to Plan 02"

patterns-established:
  - "debounceDealStack pattern: per-idx timer with 300ms delay for live recalculation"
  - "renderDealStackResults: currency formatting with green/red colour coding via CSS variables"

requirements-completed: [HARD-06, DEAL-01, DEAL-02, DEAL-03, DEAL-04, DEAL-06]

duration: 4min
completed: 2026-03-16
---

# Phase 3 Plan 01: Deal Stacking Calculator Core Summary

**Full deal stacking calculator with lender-matched bridging costs, flip/hold scenario comparison, and live recalculation via LTV slider and input fields**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-16T00:10:13Z
- **Completed:** 2026-03-16T00:14:17Z
- **Tasks:** 5
- **Files modified:** 1

## Accomplishments
- Replaced broken `calcDealAnalysis()` with comprehensive `calcDealStack()` that uses LENDER_DATA for bridging rates with market-average fallback
- Built deal stacking widget in expanded panel with auto-filled purchase price and SDLT, plus GDV/works/rental input fields
- Implemented live results rendering with collapsible cost breakdown and side-by-side Flip vs Hold scenarios
- Wired LTV slider to trigger both Finance Check and Deal Stacking recalculation

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement calcDealStack() function** - `b49d278` (feat)
2. **Task 2: Build deal stacking widget HTML** - `7824ac4` (feat)
3. **Task 3: Live recalculation with debounce and results rendering** - `b004c2a` (feat)
4. **Task 4: Wire LTV slider to deal stacking** - `0c4c6c3` (feat)
5. **Task 5: Handle edge cases** - `320cdeb` (fix)

## Files Created/Modified
- `index.html` - Replaced calcDealAnalysis with calcDealStack, added deal stacking widget HTML, debounce/render functions, LTV wiring, edge case guards

## Decisions Made
- Lender matching: filter by LTV eligibility, select lowest rate; fallback to 0.85%/mo + 2% arrangement when LENDER_DATA unavailable
- Hold scenario: 75% BTL refinance at 5.5% interest-only, 10% management fee, 1-month void allowance
- Widget gated behind isPremium() — upgrade CTA for free users deferred to Plan 02
- "All capital recycled" green message when refinance covers total cost in (infinite CoC return shown as N/A)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Deal stacking calculator core is complete and functional for premium users
- Ready for Plan 02: tier verification and free-user upgrade CTA integration

---
*Phase: 03-deal-stacking-tier-verification*
*Completed: 2026-03-16*
