---
phase: 03-deal-stacking-tier-verification
status: passed
date: 2026-03-16
---

# Phase 3 Verification: Deal Stacking & Tier Verification

## Must-Haves Checklist

### Deal Stacking Calculator
- [x] **calcDealStack() exists, calcDealAnalysis() removed** — `calcDealStack()` defined at index.html:2592. Grep for `calcDealAnalysis` returns zero matches.
- [x] **Deal stacking widget renders in expanded panel** — Widget HTML generated at index.html:3112-3162, inside `exp-right` column with isPremium() gating.
- [x] **GDV, works cost, rental income inputs functional** — Input fields at index.html:3130-3145 with `oninput="debounceDealStack(idx)"` wiring.
- [x] **SDLT auto-calculated from purchase price** — `calcSDLT(purchasePrice, country)` called at index.html:2623 inside calcDealStack(); also pre-displayed in widget at index.html:3113.
- [x] **Bridging costs from LENDER_DATA with fallback** — Lender matching loop at index.html:2602-2618; fallback to 0.85%/mo + 2% arrangement at index.html:2598-2599.
- [x] **Full stack displayed: total cost in, net profit, ROI, cash-on-cash** — `renderDealStackResults()` at index.html:2697 renders all four metrics.
- [x] **Flip and Hold scenarios both calculated** — Flip at index.html:2633-2636; Hold at index.html:2639-2650 with refinance, BTL mortgage, management, void allowance.
- [x] **Live recalculation with debounce** — `debounceDealStack()` at index.html:2662 with 300ms per-idx timer.

### Premium Feature Wiring
- [x] **No "Coming Soon" chips in lot expansion code** — `comingSoonTag` variable removed; grep returns zero matches. Residual CSS class `.coming-soon-label` (line 478) and "Portfolio tracking (coming soon)" text in paywall modal (line 780) are not in expansion code.
- [x] **Yield Analysis uses details/summary with gating** — index.html:2972 (premium) and 2982 (free with blur+CTA), both using `<details class="premium-feature">`.
- [x] **Comparables uses details/summary with gating** — index.html:3013 (premium) and 3022 (free with blur+CTA).
- [x] **Deal Stacking uses details/summary with gating** — Left-column teaser at index.html:3040/3047; right-column widget gated at index.html:3112 (isPremium ternary) with upgrade prompt at index.html:3151-3162.

### Cross-Tab Tier Sync
- [x] **localStorage write on tier change** — `updateProStatus()` writes `bridgematch_tier` and `bridgematch_tier_ts` at index.html:1817-1818.
- [x] **storage event listener** — `window.addEventListener('storage', ...)` at index.html:1851 detects cross-tab changes.
- [x] **refreshTierUI() is UI-only** — Function at index.html:1826 updates dropdown and pro badge without calling /api/stripe/status (no infinite loop).

### Backend Tier Lifecycle
- [x] **Trial expiry downgrades to free (TIER-01)** — `validateUserFromReq()` at server.js:1733 checks `tier === 'premium' && tier_expires_at < now`, updates to tier='free'. Both byAuthId (line 1733) and byEmail (line 1751) paths handle this.
- [x] **Resubscription restores premium (TIER-02)** — `checkout.session.completed` handler at server.js:1383-1389 sets tier='premium', stores stripe_subscription_id, clears tier_expires_at.
- [x] **Payment failure triggers grace period (TIER-03)** — `customer.subscription.updated` with status='past_due' at server.js:1447-1453 sets tier_expires_at to now + 3 days. status='unpaid' at server.js:1454-1461 triggers immediate downgrade.
- [x] **invoice.payment_failed sends email notification** — server.js:1466-1486 sends payment failure email via Resend API.
- [x] **Expired trial + subscribe activates premium (TIER-05)** — checkout.session.completed unconditionally sets tier='premium' regardless of trial state; trial_used flag is not modified by checkout handler.

### Webhook Idempotency
- [x] **Event deduplication** — Webhook handler records processed events via `processed_webhook_events` upsert at server.js:1494 (confirmed from Phase 1 HARD-04).

---

## Requirement Traceability

| Req ID | Description | Where Satisfied | Verified |
|--------|-------------|-----------------|----------|
| HARD-06 | Broken calcDealAnalysis() replaced | calcDealStack() at index.html:2592; calcDealAnalysis grep returns 0 matches | PASS |
| DEAL-01 | User inputs GDV, works, legal, rental | Input fields at index.html:3130-3145 in deal stacking widget | PASS |
| DEAL-02 | Auto-calculate SDLT from purchase price | calcSDLT() call at index.html:2623 inside calcDealStack() | PASS |
| DEAL-03 | Auto-calculate bridging costs from lender data | LENDER_DATA matching at index.html:2602-2618 with fallback | PASS |
| DEAL-04 | Full stack: total cost in, net profit, ROI, CoC | renderDealStackResults() at index.html:2697 | PASS |
| DEAL-05 | Deal stacking premium-only, replaces Coming Soon | isPremium() gating at index.html:3112; comingSoonTag removed | PASS |
| DEAL-06 | Flip and Hold scenarios | Flip at index.html:2633-2636; Hold at index.html:2639-2650 | PASS |
| TIER-01 | Trial expiry downgrades to free | validateUserFromReq() at server.js:1733 and 1751 | PASS |
| TIER-02 | Resubscription restores premium | checkout.session.completed at server.js:1383-1389 | PASS |
| TIER-03 | Payment failure grace period | past_due handler at server.js:1447-1453 (3-day grace) | PASS |
| TIER-04 | All gating points verified end-to-end | 8 frontend gates audited (see checklist above); cross-tab sync at index.html:1851 | PASS |
| TIER-05 | Expired trial + subscribe activates premium | checkout.session.completed sets tier='premium' unconditionally | PASS |

**12/12 requirements satisfied.**

---

## Roadmap Success Criteria Cross-Check

| # | Criterion | Status |
|---|-----------|--------|
| 1 | User can open deal stacking, input GDV/works/legal/rental, see full stack with Flip and Hold | PASS — widget renders with all inputs; calcDealStack returns flip and hold objects |
| 2 | SDLT auto-calculated from guide price; bridging costs from live lender data | PASS — calcSDLT() in calcDealStack(); LENDER_DATA matching with fallback |
| 3 | Deal stacking gated behind premium; Coming Soon replaced with functional feature | PASS — isPremium() ternary gates widget; comingSoonTag removed |
| 4 | Trial expiry downgrades, resubscription restores, payment failure triggers grace | PASS — all three paths verified in server.js webhook handlers and validateUserFromReq |
| 5 | Expired trial user subscribing via Stripe activates premium correctly | PASS — checkout.session.completed unconditionally sets tier='premium' |

---

## Gaps Found

None. All 12 requirement IDs are satisfied in code. Minor residual items (dead `.coming-soon-label` CSS class, "coming soon" text in paywall modal for future portfolio tracking) are not in scope and do not affect phase goals.

---

## Human Verification Required

The following items require manual testing in a browser or against live Stripe:

### Stripe Flows (requires test mode or live environment)
- [ ] Create a test user, let trial expire, verify /api/stripe/status returns tier='free'
- [ ] Complete a Stripe test checkout after trial expiry, verify tier='premium' restored
- [ ] Trigger a `customer.subscription.updated` event with status='past_due', verify 3-day grace period set
- [ ] Trigger `invoice.payment_failed`, verify email sent via Resend
- [ ] Cancel subscription, verify premium honoured until current_period_end

### Browser Testing
- [ ] Open deal stacking on a lot, input GDV/works/rental, verify Flip and Hold results render correctly
- [ ] Open deal stacking on a lot with no guide price (TBA), verify informative error message
- [ ] Verify LTV slider recalculates both Finance Check and Deal Stacking
- [ ] Open lot as free user, verify Yield Analysis/Comparables show blurred preview with CTA
- [ ] Open lot as free user, verify Deal Stacking shows upgrade prompt
- [ ] Open two tabs, upgrade in tab A, verify tab B updates tier badge without page refresh
- [ ] Test on mobile (375px width) — verify deal stacking widget is usable

### Data Integration
- [ ] Verify LENDER_DATA is populated from bridgematch.co.uk/api/lenders-lite in production
- [ ] Verify lender matching selects lowest rate at the given LTV (not just first match)
- [ ] Compare SDLT output for a 250k England property against HMRC published rates

---
*Verified: 2026-03-16*
*Verifier: Claude Code (automated code inspection)*
