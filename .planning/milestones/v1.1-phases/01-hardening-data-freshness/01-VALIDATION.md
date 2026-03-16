---
phase: 1
slug: hardening-data-freshness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual + inline unit tests (no test framework in project) |
| **Config file** | none — Wave 0 installs if needed |
| **Quick run command** | `node -e "require('./test-sdlt.js')"` (after Wave 0) |
| **Full suite command** | Manual verification per requirement |
| **Estimated runtime** | ~30 seconds (automated), ~5 min (manual checks) |

---

## Sampling Rate

- **After every task commit:** Run quick SDLT unit tests + verify server starts
- **After every plan wave:** Full manual verification of all changed requirements
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | HARD-07 | manual | Verify Firecrawl request body | N/A | ⬜ pending |
| TBD | 01 | 1 | HARD-01 | unit | `calcSDLT(250000)` vs HMRC | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | HARD-02 | unit | `calcLBTT(250000)`, `calcLTT(250000)` vs gov calcs | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | HARD-03 | manual | Re-register with same email, verify tier=free | N/A | ⬜ pending |
| TBD | 02 | 1 | HARD-04 | manual | Send duplicate webhook event.id | N/A | ⬜ pending |
| TBD | 02 | 1 | HARD-05 | manual | Cancel sub, verify tier_expires_at set | N/A | ⬜ pending |
| TBD | 03 | 2 | FRSH-01 | manual | Load page, verify past auctions hidden | N/A | ⬜ pending |
| TBD | 03 | 2 | FRSH-02 | manual | Find sold lot, verify overlay banner | N/A | ⬜ pending |
| TBD | 03 | 2 | FRSH-03 | manual | Check API response for lot.status field | N/A | ⬜ pending |
| TBD | 04 | 2 | FRSH-04 | manual | Simulate autoAnalyse failure, check admin alerts | N/A | ⬜ pending |
| TBD | 04 | 2 | FRSH-05 | manual | Load admin dashboard, verify freshness table | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] SDLT unit test stubs for England, Scotland, Wales calculations
- [ ] Existing infrastructure covers Stripe/webhook testing (manual via Stripe CLI)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Trial abuse prevention | HARD-03 | Requires Supabase Auth account lifecycle | 1. Create user with email A 2. Verify trial granted 3. Delete Supabase Auth account 4. Re-register with email A 5. Verify tier=free |
| Webhook idempotency | HARD-04 | Requires Stripe webhook replay | 1. Use Stripe CLI to send test event 2. Replay same event.id 3. Verify no duplicate processing |
| Downgrade honours period | HARD-05 | Requires Stripe subscription lifecycle | 1. Create subscription 2. Cancel via Stripe 3. Verify tier_expires_at = current_period_end 4. Verify premium access until expiry |
| Future-only default | FRSH-01 | UI behaviour check | 1. Load /auctions fresh 2. Verify no past auctions visible 3. Toggle "Show past auctions" 4. Verify past auctions appear |
| Sold overlay display | FRSH-02 | Visual UI check | 1. Find lot with sold status 2. Verify diagonal "SOLD" banner overlay |
| Alert generation | FRSH-04 | Requires pipeline failure simulation | 1. Trigger autoAnalyse with broken house 2. Check admin dashboard for alert within 15 min |
| Admin freshness metrics | FRSH-05 | Visual UI check | 1. Load admin dashboard 2. Verify per-house table with last scrape, lot count, image %, status |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
