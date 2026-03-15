# Phase 3: Deal Stacking & Tier Verification - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the deal stacking calculator MVP as a frontend-only feature (client-side JS using existing `calcSDLT()` and lender data from `bridgematch.co.uk/api/lenders-lite`), wire up premium features that currently show "Coming Soon" (Yield Analysis, Comparables, Deal Stacking), and verify all subscription tier flows end-to-end including edge cases. Requirements: HARD-06, DEAL-01 through DEAL-06, TIER-01 through TIER-05.

</domain>

<decisions>
## Implementation Decisions

### Deal stacking UI & layout
- Lives in the existing expanded lot panel, right column — below the Finance Check widget as a separate stacked section
- Finance Check and Deal Stacking remain separate widgets (not merged), stacked vertically in the right column
- Minimal inputs: GDV and works cost as user inputs; purchase price and SDLT auto-filled from lot data; rental income optional (only needed for Hold scenario)
- Legal/other costs use itemised defaults: solicitor £1,500, survey £500, broker fee 1% of loan, arrangement fee from lender data or 2% default — each line item visible
- Flip vs Hold results shown side-by-side in two columns: Flip shows total cost in, net profit, ROI, cash-on-cash return; Hold shows cashflow/mo, annual yield, cash-on-cash, cash left in deal
- Results recalculate live as user types (debounced 300ms), no "Calculate" button needed
- LTV slider in Finance Check also controls the deal stacking LTV assumption — one slider, both widgets update

### Calculation logic & scenarios
- Bridging finance costs sourced from best-match lender in existing LENDER_DATA array (already fetched for Finance Check widget) — lowest-rate eligible lender's actual rate + arrangement fee
- Default bridge term: 12 months (fixed, not user-configurable for MVP)
- Hold scenario: simple BTL assumptions — refinance at 75% LTV of GDV, 5.5% interest-only rate, management 10%, 4-week void allowance; cashflow = rental - mortgage - management; cash left in = total cost in - refinance amount
- Fallback when lender data unavailable: use market-average assumptions (0.85%/mo rate, 2% arrangement fee) with subtle note "Based on market averages — lender data unavailable"
- Replace existing broken `calcDealAnalysis()` with the new deal stacking logic (HARD-06)

### Premium feature wiring
- "Coming Soon" chips replaced with expandable `<details>/<summary>` sections (native HTML accordion per CLAUDE.md guidance)
- **Yield Analysis** (premium): expandable section showing gross yield, net yield (after 10% management + 4-week void), area average comparison, yield rating (good/fair/poor), contextual verdict text — uses existing lot fields (estGrossYield, estMonthlyRent, streetAvg)
- **Comparables** (premium): expandable section showing street average price, guide price, below-market %, contextual note about uplift potential — uses existing Land Registry enrichment data (streetAvg, belowMarket)
- **Deal Stacking** (premium): the full deal stacking calculator described above
- Free-tier users see a blurred/greyed-out preview of each feature with an inline upgrade banner: "Unlock [feature] with Pro — £9.99/mo" + "Upgrade Now" button. Consistent with existing AI field blurring pattern.

### Tier verification scope
- Stripe test mode + manual E2E verification — no automated integration tests for now
- Full verification checklist covering both backend lifecycle AND all frontend gating points:
  - Backend: new signup → 14-day trial, trial expires → free, free subscribes → pro, pro cancels → access til period end, payment fails → 3-day grace, grace expires → free, re-register same email → no new trial, expired trial + subscribe → pro activated
  - Frontend gates: AI search limits (3 anon / 10 free / unlimited pro), field blur after 6 lots, CSV/JSON export blocked for free, deal stacking gated, yield analysis gated, comparables gated, external links truncated
- Additional edge cases to verify:
  - Multi-browser/device session sync — tier state must update across tabs (user upgrades in one tab, other tabs reflect change)
  - Supabase auth token expiry — session refresh must not accidentally downgrade the user to free tier

### Claude's Discretion
- Exact CSS for blurred premium feature previews
- Details/summary styling and animation
- Yield rating thresholds (what % = good/fair/poor)
- Debounce implementation for live calculation
- Cost breakdown layout within the deal stacking widget
- How to trigger tier state refresh across tabs (localStorage event, polling, etc.)
- Verification checklist format (markdown doc, test script, or both)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `calcSDLT(price, country)` at index.html:2480 — correct 2025/26 investor SDLT calculator for England, Scotland, Wales
- `detectCountry(address)` at index.html:2520 — auto-detects country from address/postcode for SDLT calculation
- `calcDealAnalysis()` at index.html:2539 — BROKEN, to be replaced (hardcodes 75% LTV, 0.75%/mo, 4% other costs)
- `LENDER_DATA` array — fetched from `bridgematch.co.uk/api/lenders-lite` on page load, used by Finance Check widget
- `isPremium()` at index.html:1060 — tier check function (`window._userTier === 'premium'`)
- `showPaywall(reason)` at index.html:1704 — existing upgrade modal
- `triggerFinanceCheck(idx)` at index.html:2793 — existing finance check triggering pattern
- Existing LTV slider per lot (`ltv-slider-{idx}`, range 50-80, default 70)

### Established Patterns
- Expanded panel: left column (image, analysis, enrichment, premium features) + right column (finance widget, bullets)
- "Coming Soon" chips rendered inline with `comingSoonTag` variable at index.html:2720
- Lot data fields: `price`, `estGrossYield`, `estMonthlyRent`, `streetAvg`, `belowMarket`, `address`, `propType`
- Stripe webhook handler at server.js:1329 with event dedup, grace period, `tier_expires_at` logic (Phase 1)
- CSP allows `connect-src` to `bridgematch.co.uk` (server.js:91)

### Integration Points
- Expanded panel HTML construction at index.html:2722 — add deal stacking section + convert chips to `<details>/<summary>`
- `updateLTV(idx, val)` at index.html:2787 — extend to trigger deal stack recalculation
- `window._userTier` — checked for all gating decisions
- Stripe webhook POST handler at server.js:1329 — verify all lifecycle paths
- Supabase `users` table: `tier`, `tier_expires_at`, `trial_used`, `stripe_subscription_id` columns

</code_context>

<specifics>
## Specific Ideas

- Deal stacking should feel like a quick "back of the envelope" calculation — not a full financial model. Investors want to rapidly assess: "Is this deal worth pursuing?" before doing deeper analysis.
- The blurred preview for free users should clearly show what they're missing — enough structure visible to create FOMO without giving away the data.
- Side-by-side Flip vs Hold lets investors quickly compare exit strategies at a glance.
- Itemised cost breakdown builds trust — users can see exactly how the numbers are derived, unlike the current `calcDealAnalysis()` which uses opaque percentages.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-deal-stacking-tier-verification*
*Context gathered: 2026-03-15*
