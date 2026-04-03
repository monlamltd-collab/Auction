---
phase: 08-field-extraction-validation
plan: "03"
subsystem: frontend
tags: [ux, lot-cards, data-quality, gap-chips, VAL-01]
dependency_graph:
  requires: []
  provides: [silent-omit-for-supplementary-fields]
  affects: [index.html card() function]
tech_stack:
  added: []
  patterns: [silent-omit pattern for supplementary fields]
key_files:
  modified:
    - index.html
decisions:
  - "Silent omission for missing beds/tenure: removed else branches that pushed '?' gap chips — no chip is better than a '?' chip"
metrics:
  duration: "3 minutes"
  completed: "2026-04-03T20:15:59Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 8 Plan 03: Remove Gap Chips for Beds, Tenure, and PropType Summary

Silent omission implemented for missing beds and tenure fields — removed 2 else branches pushing "Beds: ?" and "Tenure: ?" chips; lots with no beds/tenure now display cleanly without broken-looking "?" indicators.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove gap chips for beds, tenure, and propType in card() and expanded panel | 2ac7435 | index.html |

## What Was Built

Removed the `else` branches in the `card()` function in `index.html` that pushed "?" gap chips to `detailPills` when supplementary fields were absent:

1. **Beds gap chip removed** (line 3464): The `else detailPills.push({text: 'Beds: ?', ...gap: true})` branch was deleted entirely. When `l.beds` is null, no chip appears.

2. **Tenure gap chip removed** (lines 3475-3477): The `else { detailPills.push({text: 'Tenure: ?', ...gap: true}) }` block was deleted entirely. When `l.tenure` is falsy, no chip appears.

3. **PropType**: Already had no gap chip — the existing code was `if (l.propType) detailPills.push(...)` with no else branch. No change needed.

4. **Expanded panel**: Checked lines 4220-4280 — no "Beds: ?" or "Tenure: ?" patterns existed there. No changes needed.

5. **`gap: tenureWarn` preserved**: The legitimate lease warning chip (shown when lease < 80 years) uses `gap: tenureWarn` where `tenureWarn` is a boolean. This is not a "?" chip — it's a data-present warning. Left untouched.

## Verification Results

```
grep -c "Beds: ?" index.html   → 0  (PASS)
grep -c "Tenure: ?" index.html → 0  (PASS)
grep -c "gap: true" index.html → 0  (PASS)
grep -c "l\.beds != null" index.html → 1  (positive case preserved, PASS)
grep -c "l\.tenure" index.html → 7  (positive case preserved, PASS)
```

## Deviations from Plan

None — plan executed exactly as written. PropType had no gap chip to remove; expanded panel had no matching patterns. Changes were purely removal of 3 lines from the `card()` function.

## Known Stubs

None — this plan removes display logic only. No data wiring or stubs involved.

## Self-Check: PASSED

- File modified: index.html — confirmed exists
- Commit 2ac7435 — confirmed in git log
- All acceptance criteria met (0 gap chips, positive cases preserved)
