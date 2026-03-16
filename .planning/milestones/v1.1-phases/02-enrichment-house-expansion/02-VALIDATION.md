---
phase: 2
slug: enrichment-house-expansion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js test runner (`node tests/test-extractors.js`) + custom validation scripts |
| **Config file** | `package.json` scripts section |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && node tests/test-enrichment.js` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && node tests/test-enrichment.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | ENRH-01 | integration | `node tests/test-enrichment.js --epc` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | ENRH-02 | integration | `node tests/test-enrichment.js --flood` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | ENRH-03 | integration | `node tests/test-enrichment.js --cache` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | ENRH-04 | e2e | `node tests/test-enrichment.js --ungated` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | IMG-01 | metric | `node tests/test-image-coverage.js` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | IMG-02 | unit | `npm test` | ✅ | ⬜ pending |
| 02-02-03 | 02 | 1 | IMG-03 | integration | `node tests/test-missing-images-endpoint.js` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | EXPN-01 | live | `npm test` | ✅ | ⬜ pending |
| 02-03-02 | 03 | 2 | EXPN-02 | live | `npm test` (extractor tests) | ✅ | ⬜ pending |
| 02-03-03 | 03 | 2 | EXPN-03 | live | `npm test` (image field check) | ✅ | ⬜ pending |
| 02-03-04 | 03 | 2 | EXPN-04 | live | `npm test` (pagination check) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test-enrichment.js` — stubs for ENRH-01, ENRH-02, ENRH-03, ENRH-04 (EPC API response validation, flood zone response validation, cache TTL check, ungated display check)
- [ ] `tests/test-image-coverage.js` — stub for IMG-01 (coverage metric calculation)
- [ ] `tests/test-missing-images-endpoint.js` — stub for IMG-03 (admin endpoint returns correct shape)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EPC + flood visible on lot detail card | ENRH-01, ENRH-02 | Visual layout check | Load lot detail for a lot with valid postcode, verify EPC badge and flood zone indicator render correctly |
| Missing images admin filter UX | IMG-03 | UI interaction | Open admin dashboard, filter by missing images, verify house/lot/URL columns display |
| New house catalogues render correctly | EXPN-01 | Visual + data quality | Browse each new house's lots, verify addresses/prices/images look correct |
| Enrichment visible to free users | ENRH-04 | Auth state check | Load site without login, verify EPC/flood data not blurred or hidden |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
