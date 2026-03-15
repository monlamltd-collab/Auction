# Phase 3: Deal Stacking & Tier Verification — Research

**Researched:** 2026-03-15
**Status:** Complete

## Executive Summary

The codebase has solid foundations for this phase: a working `calcSDLT()` function (fixed in Phase 1), live `LENDER_DATA` from the Bridgematch API, an existing `isPremium()`/`showPaywall()` gating pattern, and a fully implemented Stripe webhook handler with trial, grace period, and cancellation logic. The main work is (1) replacing the broken `calcDealAnalysis()` with a proper two-scenario deal stacking calculator, (2) converting three "Coming Soon" chips into gated `<details>/<summary>` premium feature sections, and (3) systematically verifying every tier lifecycle path and frontend gating point end-to-end.

## Existing Code Analysis

### calcDealAnalysis() — Current State (index.html:2539)

```js
function calcDealAnalysis(guidePrice, streetAvg, grossYield, monthlyRent, country) {
  const loanAmt = guidePrice * 0.75;           // hardcoded 75% LTV
  const bridgingCost = Math.round(loanAmt * 0.0075 * 12); // 0.75%/mo for 12 months
  const otherCosts = Math.round(guidePrice * 0.04);        // opaque 4% lump
  ...
}
```

**Problems (HARD-06):**
- Hardcodes 75% LTV instead of using the per-lot LTV slider value
- Uses a flat 0.75%/mo bridging rate instead of actual lender data from `LENDER_DATA`
- Lumps legal/survey/arrangement into an opaque "4% other costs" — no itemisation
- Only calculates a single flip scenario (buy, refurb, sell) — no Hold/refinance scenario
- Uses `streetAvg` as GDV instead of letting the user input their own GDV estimate
- No rental income / cashflow modelling

**What needs to change:** This function will be entirely replaced with a new deal stacking calculator that addresses all six DEAL requirements. The function signature will change since it needs the LTV slider value, LENDER_DATA, and user-inputted GDV/works cost/rental income.

### calcSDLT() — Ready for Integration (index.html:2480)

Fixed in Phase 1 with correct 2025/26 investor rates:
- **England:** 5% surcharge (not the old 3%), banded above £250k
- **Scotland:** LBTT bands + 6% ADS on full price
- **Wales:** LTT higher rates for additional dwellings

Takes `(price, country)` and returns an integer (rounded stamp duty in pounds). The companion `detectCountry(address)` at line 2520 auto-detects from address/postcode using regex patterns for Scottish/Welsh postcodes and city names.

**Integration:** Deal stacking calls `calcSDLT(lot.price, detectCountry(lot.address))` to auto-fill the SDLT line item. No changes needed to these functions.

### Finance Check Widget — Integration Point (index.html:2758-2768)

The Finance Check widget occupies the right column of the expanded panel:
- **LTV slider:** `<input type="range" id="ltv-slider-{idx}" min="50" max="80" step="5" value="70">` with `updateLTV(idx, val)` handler (line 2787) — currently only updates the displayed percentage text
- **"Check finance" button:** Triggers `triggerFinanceCheck(idx)` which POSTs to `bridgematch.co.uk/api/filter` with `{loan_amount, market_value, property_type, transaction_type, charge_position, loan_term_months}` and displays eligible lender count + top 3 lender chips
- **LENDER_DATA:** Fetched on page load from `bridgematch.co.uk/api/lenders-lite` (line 1343-1346). Array of lender objects with fields: `name`, `l1` (residential LTV), `ls` (semi-comm LTV), `lc` (commercial LTV), `r` (interest rate string), `pf` (proc fee string), `mm` (min months string), `ld1`/`ud1` (refurb day-1 LTV)
- **Parsing utilities:** `_parseLTV(s)` returns `{pct, net}`, `_parseRate(s)` returns average monthly rate as float, `_parseProcFee(s)` returns proc fee as percentage (default 2)

**Key decision from context:** The LTV slider in Finance Check also controls deal stacking's LTV assumption. `updateLTV()` must be extended to trigger deal stack recalculation alongside Finance Check updates.

### LENDER_DATA Structure

Each lender object from `/api/lenders-lite` has (at minimum):
- `name` — lender name (string)
- `l1` — residential LTV (e.g., "75% gross", "70% net")
- `ls` — semi-commercial LTV
- `lc` — commercial LTV
- `r` — interest rate (e.g., "0.75-0.89%", "from 0.65%")
- `pf` — proc/arrangement fee (e.g., "2%", "1.5-2%", "Negotiable")
- `mm` — minimum months (e.g., "3", "6", "Depends")
- `ld1` / `ud1` — refurb day-1 advance LTV (leveraged/unleveraged)

For deal stacking, the approach is to find the best-matching lender at the user's selected LTV and use their actual rate + arrangement fee, rather than hardcoded assumptions. The existing `_parseRate()` and `_parseProcFee()` helpers already handle the varied string formats.

### Expanded Panel HTML Structure (index.html:2700-2770)

Two-column layout:
- **Left column (`exp-left`):** Image, AI analysis, signals (opps/risks), EPC/flood enrichment badges, then the three "Coming Soon" chips
- **Right column (`exp-right`):** Finance Check widget, bullet points

The "Coming Soon" chips are rendered at lines 2751-2754 as three inline `<div>` elements inside a flex container, each containing the feature name + `comingSoonTag` (which is an amber-background pill span for non-premium users, empty string for premium).

**What changes:**
1. The three chip divs become `<details>/<summary>` sections
2. Each section contains gated premium content (or a blurred preview + upgrade CTA for free users)
3. Deal Stacking moves from here to below the Finance Check widget in the right column (per context decision: "right column — below Finance Check widget as a separate stacked section")

**Note:** The three features in the left column (Yield Analysis, Comparables) stay in the left column as expandable sections. Only Deal Stacking also appears as a full interactive widget in the right column.

### Premium Gating Patterns

**`isPremium()` (line 1060):** Simple check — `return window._userTier === 'premium'`

**`window._userTier` population (line 1798):** Set from `/api/stripe/status` response during `updateAccountUI()`, which runs on auth state change.

**`showPaywall(reason)` (line 1704):** Shows `#paywallModal` with optional reason text. The modal has a "Upgrade to Pro" button that calls `startCheckout('monthly')`.

**Existing gating points to replicate:**
1. **AI search limits:** 3 anon / 10 free / unlimited pro (checked server-side)
2. **Lot card blurring:** After first 6 lots, free-tier users see `.blurred` class on cards — clicking triggers `showPaywall()` (line 2684)
3. **CSV/JSON export:** `dlCSV()` and `dlJSON()` check `window._userTier !== 'premium'` and call `showPaywall()` (lines 2555, 2562)
4. **Affordability filters:** Refurb and Title Split filters are `isPremium()` gated (lines 1409, 1413)

**Pattern for new premium features:** Use `isPremium()` to decide whether to render full content or blurred preview + upgrade CTA. Consistent with the lot-blur approach where enough structure is visible to create FOMO.

### Stripe Webhook & Tier Lifecycle (server.js:1329-1510)

**Event handling (with idempotency via `processed_webhook_events` table):**

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Record payment, set `tier='premium'`, store `stripe_subscription_id`, clear `tier_expires_at` |
| `customer.subscription.deleted` | If `current_period_end` is future, set `tier_expires_at` to that date (keep premium); otherwise immediate downgrade to free |
| `customer.subscription.updated` | Status `active` → premium; `canceled` → keep premium until `current_period_end`; `past_due` → 3-day grace via `tier_expires_at`; `unpaid` → immediate downgrade |
| `invoice.payment_failed` | Log + email notification via Resend API |

**Tier expiry check (server.js:1733):** In `validateUserFromReq()`, if `tier === 'premium' && tier_expires_at && tier_expires_at < now`, immediately downgrade to free. This is the runtime check that catches expired trials and grace periods.

**Trial flow (server.js:1759-1803):**
- New user auto-creation: checks `trial_used` flag to prevent trial abuse
- If `trial_used` is false: grants 14-day trial (`tier='premium'`, `tier_expires_at` = now+14d, `trial_used=true`)
- If `trial_used` is true: creates as `tier='free'`, no trial

**Edge case (TIER-05):** User with expired trial subscribes via Stripe → `checkout.session.completed` handler sets `tier='premium'` and `stripe_subscription_id`, clears `tier_expires_at`. This should work correctly since the handler doesn't check `trial_used` — it unconditionally upgrades. However, the `validateUserFromReq()` check runs first on every request, so by the time the user hits the webhook, they're already `tier='free'`. The checkout handler then upgrades them back to premium. This flow appears correct but should be verified.

## Technical Approach

### Deal Stacking Calculator

**New function signature:**
```
calcDealStack(purchasePrice, gdv, worksCost, rentalIncome, ltv, lenderData, country, address)
```

**Finding the best lender:**
1. Filter `LENDER_DATA` to lenders whose residential LTV (`l1`) is >= the user's selected LTV
2. Among eligible lenders, pick the one with the lowest parsed rate (`_parseRate(l.r)`)
3. Use that lender's rate and arrangement fee for bridging cost calculations
4. If no lenders match or `LENDER_DATA` is empty, fall back to market averages (0.85%/mo, 2% arrangement)

**Flip scenario calculations:**
- SDLT = `calcSDLT(purchasePrice, detectCountry(address))`
- Loan amount = purchasePrice * LTV%
- Monthly bridging rate from best lender (or 0.85% fallback)
- Bridging interest = loan amount * monthly rate * 12 months
- Arrangement fee = from lender data (`_parseProcFee()`) or 2% default, applied to loan amount
- Itemised costs: solicitor £1,500, survey £500, broker fee 1% of loan
- Total cost in = purchasePrice + SDLT + worksCost + bridging interest + arrangement fee + solicitor + survey + broker fee
- Net profit = GDV - total cost in
- Cash in = (purchasePrice - loan amount) + SDLT + worksCost + solicitor + survey + broker fee (deposit + non-financed costs)
- ROI = net profit / cash in * 100
- Cash-on-cash = net profit / cash in * 100 (same as ROI for flip)

**Hold scenario calculations:**
- All acquisition costs same as Flip
- Refinance amount = GDV * 0.75 (BTL 75% LTV)
- BTL mortgage payment = refinance amount * 0.055 / 12 (5.5% interest-only annual rate)
- Management = rental income * 0.10 (10%)
- Void allowance = rental income / 12 (1 month / 12 = 4-week void)
- Monthly cashflow = rental income - BTL mortgage - management - void
- Annual yield = (rental income * 12) / purchasePrice * 100
- Cash left in deal = total cost in - refinance amount
- Cash-on-cash return = (monthly cashflow * 12) / cash left in * 100

**Data flow:**
1. User opens expanded lot panel → Deal Stacking section rendered (gated for free users)
2. Purchase price auto-filled from `lot.price`, SDLT auto-calculated
3. User inputs GDV, works cost, optional rental income
4. Live recalculation on input (debounced 300ms)
5. LTV slider change in Finance Check also triggers recalculation

### Coming Soon → Premium Features

**Current rendering (lines 2751-2754):** Three `<div>` chips with `comingSoonTag` appended.

**New rendering — each becomes a `<details>/<summary>`:**

```html
<details class="premium-feature">
  <summary>Yield Analysis {lockIcon}</summary>
  {isPremium() ? fullContent : blurredPreview + upgradeCTA}
</details>
```

**Yield Analysis content (premium):**
- Gross yield: `lot.estGrossYield` (already available)
- Net yield: gross yield adjusted for 10% management + 4-week void (gross * 0.867 approximately)
- Area average: `lot.streetAvg` used for context
- Yield rating: Good (>7%), Fair (5-7%), Poor (<5%) — thresholds at Claude's discretion
- Contextual verdict text

**Comparables content (premium):**
- Street average price: `lot.streetAvg`
- Guide price: `lot.price`
- Below market %: `lot.belowMarket`
- Contextual note about uplift potential

**Deal Stacking:** The `<details>/<summary>` in the left column acts as a link/teaser. The actual calculator widget lives in the right column below Finance Check.

**Blurred preview pattern:** For free users, render a container with `filter: blur(4px); pointer-events: none` showing dummy/structure content, overlaid with an upgrade CTA banner: "Unlock [feature] with Pro — £9.99/mo" + "Upgrade Now" button calling `showPaywall()`.

### Tier Verification Strategy

**Backend lifecycle paths to verify (Stripe test mode):**

| # | Scenario | Expected State | Verify |
|---|----------|---------------|--------|
| 1 | New signup | premium, trial_used=true, tier_expires_at=now+14d | Check /api/stripe/status |
| 2 | Trial expires (wait or manually set tier_expires_at to past) | free, tier_expires_at=null | Check /api/stripe/status |
| 3 | Free user subscribes | premium, stripe_subscription_id set, tier_expires_at=null | Stripe test checkout |
| 4 | Pro user cancels | premium until current_period_end | Check tier_expires_at matches period end |
| 5 | Payment fails (past_due) | premium, tier_expires_at=now+3d | Simulate via Stripe CLI |
| 6 | Grace expires | free | Manually set tier_expires_at to past, hit any authed endpoint |
| 7 | Re-register same email | free, trial_used=true, no trial | Create new auth with same email |
| 8 | Expired trial + subscribe | premium activated | TIER-05 edge case |

**Frontend gating points to verify:**

| Gate | Free Behaviour | Premium Behaviour |
|------|---------------|-------------------|
| AI search | 10/day limit, counter shown | Unlimited |
| Anon search | 3 total, then signup required | N/A |
| Lot blur | Cards 7+ blurred, click → paywall | All cards visible |
| CSV export | showPaywall() | Downloads CSV |
| JSON export | showPaywall() | Downloads JSON |
| Affordability filters | Refurb/TitleSplit hidden | Visible and functional |
| Yield Analysis | Blurred preview + upgrade CTA | Full yield data |
| Comparables | Blurred preview + upgrade CTA | Full comparables data |
| Deal Stacking | Blurred preview + upgrade CTA | Full calculator |

**Cross-tab sync:** When a user upgrades in one tab, other tabs need to detect the tier change. Options: `localStorage` event listener (write tier to localStorage on change, listen for `storage` event in other tabs) or periodic polling of `/api/stripe/status`. The localStorage approach is simpler and instant — no polling overhead.

## Validation Architecture

**Manual E2E verification (per context decision — no automated integration tests):**

1. **Stripe test mode setup:** Use Stripe CLI to trigger webhook events (`stripe trigger checkout.session.completed`, etc.) or use Stripe test dashboard
2. **Test cards:** `4242424242424242` (success), `4000000000000341` (payment fails after attach), `4000002500003155` (requires 3DS)
3. **Trial manipulation:** Directly update `tier_expires_at` in Supabase to simulate expiry without waiting 14 days
4. **Grace period test:** Use Stripe CLI to send `customer.subscription.updated` with `status: past_due`, verify 3-day grace, then manually expire

**Calculation verification:**
- Prepare 3-5 test lots with known prices, manually calculate expected SDLT, bridging costs, and deal stack results
- Compare against calculator output
- Test edge cases: £0 price (TBA lots), very high prices (>£1.5M for top SDLT band), Scottish/Welsh lots, no LENDER_DATA available

**Verification checklist:** Create a markdown checklist that can be worked through manually, covering all paths above.

## Dependencies & Risks

### Dependencies
1. **Phase 1 completion (satisfied):** SDLT calculator fixed (HARD-01/02), Stripe hardening in place (HARD-03/04/05)
2. **Bridgematch API availability:** `LENDER_DATA` fetched from `bridgematch.co.uk/api/lenders-lite` — if this API is down, deal stacking must gracefully fall back to market averages
3. **Supabase availability:** All tier checks go through Supabase — if Supabase is down, `validateUserFromReq()` fails and users see auth errors

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LENDER_DATA format changes | Low | Medium | Defensive parsing already exists (`_parseLTV`, `_parseRate` etc.) — add null checks in deal stacking |
| LTV slider value out of sync | Medium | Low | Read slider value at calculation time, not cached — single source of truth |
| Premium feature sections increase expanded panel height significantly | Medium | Low | Use `<details>/<summary>` (collapsed by default) — user opens what they want |
| Cross-tab tier sync race condition | Low | Low | localStorage event is reliable; worst case user refreshes the tab |
| `calcDealAnalysis()` called elsewhere | Low | High | Search shows no callers other than its definition — it's defined but never invoked in the current code. Safe to replace. |
| Debounced recalculation causes stale UI on rapid input | Low | Low | Standard debounce pattern with 300ms — cancel previous timer on each keystroke |
| Hold scenario with no rental income input | Medium | Low | Show Hold column as "Enter rental income to see Hold scenario" — don't show zeros |

### Pitfall: calcDealAnalysis() is unused
The existing `calcDealAnalysis()` function is **defined but never called** in the current codebase. The "Coming Soon" chip means the deal stacking feature was never wired up. This means HARD-06 is less about "replacing broken code" and more about "building new code and removing the dead function." There are no callers to update.

### Pitfall: tier_expires_at dual-purpose
The `tier_expires_at` column serves double duty: it tracks trial expiry AND subscription grace periods. The `validateUserFromReq()` function treats any expired `tier_expires_at` as grounds for downgrade. This is correct but means the planner must ensure that when a user subscribes (checkout.session.completed), `tier_expires_at` is set to `null` — which the current webhook handler already does for monthly subscriptions. No changes needed, but this is worth flagging for verification.

### Pitfall: No server-side gating for deal stacking
Deal stacking runs entirely client-side — the `isPremium()` check is a frontend-only gate. A technically savvy user could bypass it via browser dev tools. This is acceptable for MVP (same pattern as CSV export gating), but worth noting. The data (lot prices, LENDER_DATA) is already publicly accessible, so there's no data leakage risk — just a feature-access bypass.

## Key Decisions for Planning

1. **Task ordering:** Should deal stacking calculator be built first (HARD-06, DEAL-01-06), then premium feature wiring (DEAL-05, Coming Soon conversion), then tier verification (TIER-01-05)? Or should premium gating be done first to establish the pattern, then build features into it?

2. **Deal stacking widget placement:** The context says "right column, below Finance Check." The right column currently has Finance Check + bullets. Should bullets be moved, or does deal stacking go between Finance Check and bullets?

3. **Verification scope:** The context mentions "Stripe test mode + manual E2E verification." Should the verification checklist be a separate markdown file, or embedded in the plan as acceptance criteria per task?

4. **Cross-tab sync mechanism:** localStorage event vs. polling — localStorage is recommended (simpler, instant, no server load), but the planner should confirm.

5. **Hold scenario BTL rate:** The context specifies 5.5% interest-only. Should this be hardcoded or user-configurable? Context says "simple BTL assumptions" suggesting hardcoded for MVP.

6. **Lender matching logic:** The deal stacking needs to find the "best-match" lender. Should this be the lowest-rate lender eligible at the user's LTV, or the lender with the best overall terms (rate + fees combined)? Lowest rate is simpler; effective cost (rate * term + fees) is more accurate.

---
*Research for Phase 03-deal-stacking-tier-verification*
*Researched: 2026-03-15*
