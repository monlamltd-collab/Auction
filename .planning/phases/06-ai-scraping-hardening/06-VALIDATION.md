---
phase: 06
slug: ai-scraping-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Custom vanilla assertions with JSDOM (no test library) |
| **Config file** | `tests/test-extractors.js` (existing) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && node scripts/audit.mjs --fast`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | AI-01 | unit | `node tests/test-ai-provider.js` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | AI-02 | integration | Manual -- requires Supabase | manual-only | ⬜ pending |
| 06-01-03 | 01 | 1 | AI-03 | unit | `node tests/test-ai-provider.js` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | SCRP-01 | unit | `npm test` | ✅ | ⬜ pending |
| 06-02-02 | 02 | 2 | SCRP-02 | integration | `node scripts/audit.mjs --fast` | ✅ | ⬜ pending |
| 06-02-03 | 02 | 2 | SCRP-03 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 06-02-04 | 02 | 2 | SCRP-04 | manual-only | Visual check of admin.html | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test-ai-provider.js` — unit tests for provider abstraction (AI-01, AI-03)
- [ ] `lib/` directory creation — doesn't exist yet, needed for `lib/ai-provider.js`

*Existing `tests/test-extractors.js` and `scripts/audit.mjs` cover SCRP-01, SCRP-02.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Token usage logged to ai_usage table | AI-02 | Requires live Supabase + API call | 1. Trigger smart search, 2. Check ai_usage table in Supabase |
| Admin System Health tab renders | SCRP-04 | Visual UI verification | 1. Open /admin, 2. Click System Health tab, 3. Verify 4 sections render |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
