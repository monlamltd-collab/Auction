---
phase: 3
slug: deal-stacking-tier-verification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual E2E + browser console verification (per context decision — no automated integration tests) |
| **Config file** | none |
| **Quick run command** | `node -e "require('./server'); console.log('server loads')"` |
| **Full suite command** | Manual checklist walkthrough (see below) |
| **Estimated runtime** | ~15 minutes (manual) |

---

## Sampling Rate

- **After every task commit:** Verify affected calculation in browser console
- **After every plan wave:** Run through relevant checklist section
- **Before `/gsd:verify-work`:** Full checklist must be green
- **Max feedback latency:** Instant (browser refresh)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Verification Method | Status |
|---------|------|------|-------------|-----------|---------------------|--------|
| TBD | 01 | 1 | HARD-06 | manual | Calculate SDLT for 3 test lots, compare to known values | ⬜ pending |
| TBD | 01 | 1 | DEAL-01 | manual | Input GDV/works/rental on expanded lot, verify inputs saved | ⬜ pending |
| TBD | 01 | 1 | DEAL-02 | manual | Verify SDLT auto-fills from lot price for England/Scotland/Wales | ⬜ pending |
| TBD | 01 | 1 | DEAL-03 | manual | Verify bridging costs from LENDER_DATA + fallback when unavailable | ⬜ pending |
| TBD | 01 | 1 | DEAL-04 | manual | Verify full stack output: cost in, profit, ROI, CoC | ⬜ pending |
| TBD | 01 | 1 | DEAL-06 | manual | Verify Flip vs Hold side-by-side, Hold requires rental input | ⬜ pending |
| TBD | 02 | 1 | DEAL-05 | manual | Free user sees blurred preview + upgrade CTA, premium sees calculator | ⬜ pending |
| TBD | 02 | 1 | TIER-04 | manual | Verify Coming Soon → details/summary with gating for all 3 features | ⬜ pending |
| TBD | 03 | 2 | TIER-01 | manual | Expire trial via Supabase, verify downgrade | ⬜ pending |
| TBD | 03 | 2 | TIER-02 | manual | Cancel + resubscribe, verify restoration | ⬜ pending |
| TBD | 03 | 2 | TIER-03 | manual | Stripe CLI past_due event, verify 3-day grace | ⬜ pending |
| TBD | 03 | 2 | TIER-05 | manual | Expired trial user subscribes via Stripe, verify premium | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no new test framework needed.*

*Verification is manual per context decision (Stripe test mode + browser verification).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deal stacking calculation accuracy | DEAL-01-04, DEAL-06 | Client-side JS, no server component to unit test | Prepare 3 test lots with known prices, manually calculate expected values, compare in browser |
| SDLT auto-calculation | DEAL-02 | Uses existing calcSDLT() — already verified in Phase 1 | Verify auto-fill for England (£250k), Scotland (£300k), Wales (£200k) lots |
| Bridging cost from LENDER_DATA | DEAL-03 | Depends on live API data | Check with LENDER_DATA present and with empty array (fallback) |
| Premium gating | DEAL-05, TIER-04 | Frontend-only check | Toggle `window._userTier` between 'free' and 'premium', verify gate behavior |
| Trial expiry → free | TIER-01 | Requires Supabase manipulation | Set `tier_expires_at` to past date, refresh, verify downgrade |
| Resubscription | TIER-02 | Requires Stripe test mode | Cancel subscription, create new checkout session, verify tier restored |
| Payment failure grace | TIER-03 | Requires Stripe CLI | `stripe trigger customer.subscription.updated` with past_due, wait 3 days (or manipulate dates) |
| Expired trial + subscribe | TIER-05 | Requires both Supabase + Stripe | Expire trial, then complete Stripe checkout, verify premium |
| Cross-tab sync | TIER-04 | Requires multi-tab testing | Upgrade in tab A, verify tab B reflects change |

---

## Validation Sign-Off

- [ ] All tasks have manual verification steps defined
- [ ] Sampling continuity: each task commit gets browser verification
- [ ] Manual checklist covers all 12 requirement IDs
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (browser refresh)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
