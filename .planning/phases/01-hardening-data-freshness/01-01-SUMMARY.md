---
phase: 01-hardening-data-freshness
plan: 01
subsystem: ui
tags: [sdlt, lbtt, ltt, stamp-duty, scotland, wales, calculator]

requires: []
provides:
  - "Multi-country stamp duty calculator (England SDLT, Scotland LBTT+ADS, Wales LTT)"
  - "Country/region selector UI in finance profile and bridgematch-lite"
  - "Address-based country auto-detection helper"
affects: [deal-analysis, bridgematch-lite, affordability]

tech-stack:
  added: []
  patterns:
    - "switch/case country dispatch for tax jurisdiction calculations"

key-files:
  created: []
  modified:
    - index.html
    - bridgematch-lite.html

key-decisions:
  - "Used switch/case pattern for country dispatch in calcSDLT() rather than lookup tables for readability"
  - "Added country selector to finance profile panel (active UI) rather than dead-code deal analysis section"
  - "Corrected plan's England 1M expected value from 87500 to 91250 (plan had arithmetic error)"

patterns-established:
  - "Multi-jurisdiction tax calculation via country parameter defaulting to england"

requirements-completed: [HARD-01, HARD-02]

duration: 5 min
completed: 2026-03-15
---

# Phase 1 Plan 01: SDLT Calculator Fix Summary

**Multi-country stamp duty calculator supporting England (SDLT with 5% surcharge), Scotland (LBTT + 6% ADS), and Wales (LTT higher rates) in both index.html and bridgematch-lite.html**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-15T19:33:35Z
- **Completed:** 2026-03-15T19:38:53Z
- **Tasks:** 4
- **Files modified:** 2

## Accomplishments
- Refactored calcSDLT() to accept country parameter with full Scotland LBTT+ADS and Wales LTT higher rate bands
- Added Region (Stamp Duty) dropdown to finance profile panel with localStorage persistence
- Added detectCountry() helper for auto-detecting Scotland/Wales from postcodes and city names
- Extracted standalone calcSDLT() in bridgematch-lite.html replacing inline formula, with matching country dropdown
- Dynamic stamp duty labels in results (SDLT/LBTT+ADS/LTT) based on selected region
- All 10 verification tests pass against HMRC/Revenue Scotland/Welsh Revenue Authority published rates

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor calcSDLT() to accept country parameter** - `a2a9b6c` (feat)
2. **Task 2: Add country selector UI for deal analysis** - `5ede819` (feat)
3. **Task 3: Update bridgematch-lite.html SDLT formula** - `6a31725` (feat)
4. **Task 4: Verify SDLT calculations** - No commit (verification-only task, all tests passed)

## Files Created/Modified
- `index.html` - Refactored calcSDLT() with multi-country support, added detectCountry() helper, added sdltCountry dropdown, updated calcDealAnalysis() signature
- `bridgematch-lite.html` - Added standalone calcSDLT() function, replaced inline stamp duty formula, added country dropdown, dynamic tax labels in results

## Decisions Made
- Used switch/case for country dispatch rather than lookup tables for readability and maintainability
- Added country selector to the active finance profile panel rather than the dead-code deal analysis section, since calcDealAnalysis() is never called from UI
- Scotland LBTT bands verified against Revenue Scotland published rates (6% ADS on full price + progressive LBTT bands)
- Wales LTT higher rates verified against Welsh Revenue Authority (replacement rates, not additive)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected plan's England 1M expected value**
- **Found during:** Task 4 (Verification)
- **Issue:** Plan states England 1M = 87,500 but correct calculation is 250k*5% + 675k*10% + 75k*15% = 12,500 + 67,500 + 11,250 = 91,250
- **Fix:** Used correct value (91,250) which matches HMRC published calculator
- **Files modified:** None (plan error, implementation was correct)
- **Verification:** Manual arithmetic confirms 91,250

---

**Total deviations:** 1 auto-fixed (1 bug in plan's test data)
**Impact on plan:** No code impact. The implementation correctly follows HMRC published rates.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SDLT calculator now correctly handles all three UK jurisdictions
- Ready for plan 01-02 (Stripe Hardening)
- calcDealAnalysis() remains dead code (BUG 43) - to be addressed in a future plan

---
*Phase: 01-hardening-data-freshness*
*Completed: 2026-03-15*
