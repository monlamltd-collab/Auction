# Roadmap: Bridgematch Auction Tool v1.1

**Created:** 2026-03-15
**Milestone:** v1.1 — Hardening, Enrichment & Deal Stacking
**Phases:** 3
**Requirements:** 35

## Phase 1: Hardening & Data Freshness [4/4 Plans Complete - 2026-03-15]

**Goal:** Fix broken code (SDLT rates using pre-Oct 2024 3% surcharge instead of 5%, Stripe trial abuse via unchecked `trial_used` flag, webhook idempotency, immediate downgrade instead of honouring `current_period_end`), improve data freshness (future-only defaults, sold/unsold tracking, alerting on pipeline failures), and switch Firecrawl to `['markdown', 'rawHtml']` format for better Gemini extraction at zero additional credit cost.
**Requirements:** HARD-01, HARD-02, HARD-03, HARD-04, HARD-05, HARD-07, FRSH-01, FRSH-02, FRSH-03, FRSH-04, FRSH-05
**Dependencies:** None — this is the foundation

### Success Criteria
1. SDLT calculator returns correct 2025/26 figures for England (5% surcharge), Scotland (LBTT + ADS), and Wales (LTT) — verifiable by entering a £250k investment property and comparing output to HMRC published rates
2. A user who has previously used a 14-day trial cannot obtain another trial by re-registering with the same email — Stripe `trial_used` flag is checked at signup
3. Frontend loads with future-only auctions by default — past catalogues are hidden unless the user explicitly toggles a "Show past auctions" control
4. When auto-analyse fails or discovery misses a catalogue, an alert fires within 15 minutes via email and webhook — verifiable in admin dashboard alert log
5. Admin dashboard displays data freshness metrics including last scrape time per house, image coverage percentage, and lot count trends over time

---

## Phase 2: Enrichment & House Expansion

**Goal:** Add EPC rating and flood risk enrichment via free public APIs (MHCLG open data for EPC, Environment Agency for flood risk), improve lot image coverage above 80%, and add as many new UK auction houses as possible with working DOM extractors.
**Requirements:** IMG-01, IMG-02, IMG-03, ENRH-01, ENRH-02, ENRH-03, ENRH-04, EXPN-01, EXPN-02, EXPN-03, EXPN-04
**Dependencies:** Phase 1 — Firecrawl markdown format switch (HARD-07) improves extraction quality for new houses; sold/unsold tracking (FRSH-02/03) needed before enrichment pipeline runs

### Success Criteria
1. Any lot with a valid postcode displays its EPC rating and flood risk zone on the lot detail card — data sourced from MHCLG and Environment Agency APIs, cached for 30 days
2. Image coverage across all auction houses exceeds 80% — measurable via admin dashboard metric (FRSH-05 from Phase 1)
3. Lots missing images are flagged in the admin dashboard for manual review, with a filterable list showing house name, lot number, and catalogue URL
4. At least 5 new auction houses are added with working DOM extractors that return >0 lots on live test, capture images where available, and handle pagination correctly
5. Enrichment data (EPC + flood risk) is visible to all users regardless of subscription tier — not gated behind premium

---

## Phase 3: Deal Stacking & Tier Verification

**Goal:** Build the deal stacking calculator MVP as a frontend-only feature (client-side JS using existing `calcSDLT()` and lender data from `bridgematch.co.uk/api/lenders-lite`), wire up premium features that currently show "Coming Soon", and verify all subscription tier flows end-to-end including edge cases.
**Requirements:** HARD-06, DEAL-01, DEAL-02, DEAL-03, DEAL-04, DEAL-05, DEAL-06, TIER-01, TIER-02, TIER-03, TIER-04, TIER-05
**Dependencies:** Phase 1 — SDLT calculator must be fixed (HARD-01/02) before deal stacking can auto-calculate stamp duty; Stripe hardening (HARD-03/04/05) must be in place before tier verification

### Success Criteria
1. A user can open deal stacking on any lot, input GDV, works cost, legal costs, and expected rental income, and see a full investment stack: total cost in, net profit, ROI, and cash-on-cash return — for both Flip (sell) and Hold (refinance + rent) scenarios
2. SDLT is auto-calculated from the lot's guide price using the corrected 2025/26 investor rates, and bridging finance costs are auto-populated from live Bridgematch lender data
3. Deal stacking is gated behind premium — free-tier users see an upgrade prompt instead of the calculator, and the "Coming Soon" chip is replaced with a functional feature
4. Trial expiry correctly downgrades to free tier, resubscription restores premium, and payment failure triggers a grace period before downgrade — all verified end-to-end
5. A user with an expired trial who subscribes via Stripe is correctly activated as premium without requiring manual intervention

---
*Roadmap created: 2026-03-15*
