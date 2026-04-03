---
status: partial
phase: 08-field-extraction-validation
source: [08-VERIFICATION.md]
started: 2026-04-03T20:45:00.000Z
updated: 2026-04-03T20:45:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live scrape coverage check
expected: After running a scrape, beds/tenure/price each show ≥80% coverage across lots processed
result: [pending]

### 2. Admin field coverage table visible
expected: Operations tab in admin shows a colour-coded "Field Coverage Per House" table with red (<50%), amber (50-69%), and unstyled (≥70%) rows
result: [pending]

### 3. No "?" chips on lot cards
expected: Lot cards with missing beds or tenure show no "?" chip — the chip is simply absent; all structural fields (price, address, link) still display
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
