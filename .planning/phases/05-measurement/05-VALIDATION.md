---
phase: 5
slug: measurement
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in (no test framework — existing tests use plain `node` scripts) |
| **Config file** | none — tests run via `node tests/test-extractors.js` |
| **Quick run command** | `node tests/test-extractors.js` |
| **Full suite command** | `node tests/test-extractors.js && node tests/test-gating.js` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node tests/test-extractors.js`
- **After every plan wave:** Run `node tests/test-extractors.js && node tests/test-gating.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | ANAL-01 | manual | Trigger signup/signin, check Supabase activity_events | N/A | ⬜ pending |
| 05-01-02 | 01 | 1 | ANAL-01 | manual | Trigger deal_stacking/csv_export/bridgematch_open, check activity_events | N/A | ⬜ pending |
| 05-02-01 | 02 | 1 | ANAL-02 | smoke | `grep -c "umami" index.html bridgematch-lite.html admin.html` | Wave 0 | ⬜ pending |
| 05-02-02 | 02 | 1 | ANAL-02 | manual | Load page, verify Umami dashboard receives page views | N/A | ⬜ pending |
| 05-03-01 | 03 | 1 | ANAL-03 | manual | Expand lot card, click finance, start form — check Umami + Supabase | N/A | ⬜ pending |
| 05-04-01 | 04 | 2 | ANAL-04 | manual | Load admin Analytics tab, verify MAU hero + funnel chart render | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Umami Cloud account created and website ID generated (manual prerequisite)
- [ ] `UMAMI_WEBSITE_ID` and `UMAMI_API_KEY` env vars set in Railway
- [ ] Smoke test script for Umami script tag presence on correct pages

*Existing infrastructure covers server-side testing (Supabase client, logActivityEvent pattern).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| logActivityEvent fires for 5 new events | ANAL-01 | Requires live Supabase instance + user action triggers | Trigger each action in browser, query `activity_events` table |
| Umami receives page views and custom events | ANAL-02, ANAL-03 | Requires live Umami Cloud dashboard | Load public pages, check Umami dashboard for pageview + custom event data |
| BridgeMatch funnel end-to-end | ANAL-03 | Multi-step user flow across client + server | Walk through lot_expand → finance_click → form_start → lead_submit, verify data in both Umami and Supabase |
| Admin analytics summary renders | ANAL-04 | Requires live data from both Umami API and Supabase | Load admin Analytics tab, verify MAU hero number, funnel chart, engagement metrics |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
