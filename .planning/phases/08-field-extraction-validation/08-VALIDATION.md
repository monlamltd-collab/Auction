---
phase: 8
slug: field-extraction-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-03
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in assert pattern (custom, no external test runner) |
| **Config file** | none — run directly |
| **Quick run command** | `node tests/test-harness.js` |
| **Full suite command** | `node tests/test-harness.js && node tests/test-gating.js && node tests/test-enrichment.js` |

---

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIELD-01 | beds extracted from lot-page HTML regex | unit | `node tests/test-harness.js` | Yes |
| FIELD-02 | tenure extracted via cross-lot + lot-page | unit | `node tests/test-harness.js` | Yes |
| FIELD-03 | propType normalised — no raw values leak | unit | `node tests/test-harness.js` | Yes |
| FIELD-04 | price range "50k-60k" → 50000 | unit | `node tests/test-harness.js` | Partial — Wave 0 gap |
| VAL-01 | quality gate threshold at 0.45 rejects low batches | unit | `node tests/test-harness.js` | Yes |
| VAL-03 | /api/quality-report returns fieldCoverage | integration-manual | `curl /api/quality-report` | No — Wave 0 gap |

---

## Sampling Rate

- **Per task commit:** `node tests/test-harness.js`
- **Per wave merge:** `node tests/test-harness.js && node tests/test-gating.js && node tests/test-enrichment.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

---

## Wave 0 Gaps (must be written before execution)

- [ ] `tests/test-harness.js` — add test for `normalisePrice("50k-60k") === 50000` (FIELD-04)
- [ ] `tests/test-harness.js` — add test for `normalisePropType("bungalow") === "house"` (FIELD-03)
- [ ] `tests/test-harness.js` — add test for `evaluateGate` with batchQuality=0.44 → reject (VAL-01)
- [ ] `tests/test-harness.js` — add test for `validateBatch` propType coverage field
