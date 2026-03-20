---
phase: 4
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Custom vanilla assertions with JSDOM (no test library) |
| **Config file** | None — tests run via `node tests/test-extractors.js` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test` + manual verification of gating behavior
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | GATE-01 | unit | `node tests/test-gating.js` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | GATE-02 | unit | `node tests/test-gating.js` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | GATE-03 | manual | Visual inspection | N/A | ⬜ pending |
| 04-01-04 | 01 | 1 | GATE-04 | integration | curl without auth, verify 401 | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | GATE-05 | unit | `node tests/test-gating.js` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | FIX-01 | manual | Click heavy refurb, verify search runs | N/A | ⬜ pending |
| 04-02-02 | 02 | 1 | FIX-02 | manual | Sort by score, verify ordering | N/A | ⬜ pending |
| 04-02-03 | 02 | 1 | FIX-03 | manual | Filter to 0 results, verify message | N/A | ⬜ pending |
| 04-02-04 | 02 | 1 | FIX-04 | manual | Type with spaces, verify trim | N/A | ⬜ pending |
| 04-02-05 | 02 | 1 | FIX-05 | unit | `node tests/test-gating.js` | ❌ W0 | ⬜ pending |
| 04-02-06 | 02 | 1 | FIX-06 | manual | Resize to 375px, verify reflow | N/A | ⬜ pending |
| 04-02-07 | 02 | 1 | FIX-07 | manual | View at 320px, verify no overflow | N/A | ⬜ pending |
| 04-02-08 | 02 | 1 | FIX-08 | manual | As anon, verify export blocked | N/A | ⬜ pending |
| 04-03-01 | 03 | 0 | INFR-01 | manual | Check Supabase dashboard | N/A | ⬜ pending |
| 04-03-02 | 03 | 0 | INFR-02 | manual | Check Stripe dashboard | N/A | ⬜ pending |
| 04-03-03 | 03 | 0 | INFR-03 | manual | Check Railway metrics | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test-gating.js` — test resolveEffectiveTier() and getAISearchLimit() with STRIPE_ENABLED flag
- [ ] `tests/test-feature-flags.js` — verify Stripe endpoint guards return 503 when disabled

*Existing `npm test` infrastructure covers extractor tests as smoke tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| No paywall/upgrade text visible | GATE-03 | UI text inspection | Open app signed-in, search for "upgrade"/"paywall" text |
| Heavy refurb executes search | FIX-01 | Button click → search flow | Click heavy refurb filter, verify search executes |
| Score sort within tiers | FIX-02 | Visual sort order | Sort by score, verify order within same tier |
| Empty state shows message | FIX-03 | Visual content check | Filter to 0 results, verify helpful message |
| Search trimmed/debounced | FIX-04 | Input behavior | Type spaces, type fast, verify single request |
| Deal stacking reflows mobile | FIX-06 | Responsive layout | Resize to 375px, verify single column |
| Sign-in text fits container | FIX-07 | CSS overflow | View at 320px, verify no text overflow |
| CSV export checks tier | FIX-08 | Server-side guard | As anon, attempt export, verify blocked |
| Supabase plan verified | INFR-01 | External dashboard | Check Supabase dashboard for plan tier |
| Stripe subscriptions cancelled | INFR-02 | External dashboard | Check Stripe dashboard |
| Railway capacity verified | INFR-03 | External dashboard | Check Railway metrics |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
