# Phase 3 Verification Checklist

## Deal Stacking Calculator

- [ ] HARD-06: calcDealAnalysis() removed, calcDealStack() in place
- [ ] DEAL-01: GDV, works cost, rental income inputs functional
- [ ] DEAL-02: SDLT auto-calculated for England (£250k test), Scotland (£300k test), Wales (£200k test)
- [ ] DEAL-03: Bridging costs from LENDER_DATA; fallback with "market averages" note when unavailable
- [ ] DEAL-04: Full stack displayed — total cost in, net profit, ROI, cash-on-cash
- [ ] DEAL-06: Flip and Hold side-by-side; Hold shows cashflow, annual yield, cash left in, CoC

## Premium Feature Wiring

- [ ] DEAL-05: No "Coming Soon" chips remain
- [ ] DEAL-05: Yield Analysis — premium sees full data, free sees blurred + CTA
- [ ] DEAL-05: Comparables — premium sees full data, free sees blurred + CTA
- [ ] DEAL-05: Deal Stacking — premium sees calculator, free sees upgrade prompt

## Backend Tier Lifecycle

- [ ] TIER-01: Trial expiry → free (set tier_expires_at to past, verify downgrade)
  - validateUserFromReq() checks `tier === 'premium' && tier_expires_at < now`
  - Updates user to tier='free', clears tier_expires_at and stripe_subscription_id
  - Both byAuthId and byEmail lookup paths handle expiry
- [ ] TIER-02: Resubscription → premium (Stripe test checkout, verify upgrade)
  - checkout.session.completed sets tier='premium', stores stripe_subscription_id, clears tier_expires_at
  - Works regardless of previous tier/trial state
- [ ] TIER-03: Payment failure → 3-day grace (Stripe past_due, verify grace period)
  - customer.subscription.updated with status='past_due' sets tier_expires_at to now + 3 days
  - Tier remains 'premium' during grace period
  - validateUserFromReq() downgrades after grace expiry
  - status='unpaid' triggers immediate downgrade (all retries exhausted)
- [ ] TIER-05: Expired trial + subscribe → premium (verify no trial reuse)
  - checkout.session.completed unconditionally sets tier='premium', tier_expires_at=null
  - trial_used remains true (not modified by checkout handler)

## Frontend Gating Points

- [ ] TIER-04: AI search — 3 anon / 10 free / unlimited pro
  - Server-side: ANON_AI_SEARCH_LIMIT=3, FREE_AI_SEARCH_LIMIT=10, premium=Infinity
  - getAISearchLimit() also grants unlimited during active trial
- [ ] TIER-04: Lot blur — cards 7+ blurred for free, all visible for premium
  - Server-side: FREE_PREVIEW_LOTS=6 (0-indexed, so first 6 shown)
  - stripAIFields() nulls score, opps, risks, url, truncates address, sets blurred=true
  - Frontend: .blurred class applied, clicking shows paywall
- [ ] TIER-04: CSV export — paywall for free, download for premium
  - dlCSV() checks window._userTier !== 'premium'
- [ ] TIER-04: JSON export — paywall for free, download for premium
  - dlJSON() checks window._userTier !== 'premium'
- [ ] TIER-04: Affordability filters — hidden for free, visible for premium
  - Refurb filter: isPremium() gated
  - Title Split filter: isPremium() gated
- [ ] TIER-04: Yield Analysis — gated correctly
  - isPremium() branch: full gross/net yield, monthly rent, rating + verdict
  - Free branch: blurred preview + upgrade CTA
- [ ] TIER-04: Comparables — gated correctly
  - isPremium() branch: street average, guide price, vs market analysis
  - Free branch: blurred preview + upgrade CTA
- [ ] TIER-04: Deal Stacking — gated correctly
  - Left column teaser: isPremium() → pointer to right column; free → blurred + CTA
  - Right column widget: isPremium() → full calculator with inputs; free → upgrade prompt
- [ ] TIER-04: External links — handled via lot blurring (url set to null for blurred lots, not a separate gate)

## Cross-Tab Sync

- [ ] TIER-04: Upgrade in tab A → tier updates in tab B via localStorage
  - updateProStatus() writes bridgematch_tier and bridgematch_tier_ts to localStorage
  - storage event listener detects change from other tab
  - refreshTierUI() updates account dropdown and pro badge without API call
- [ ] TIER-04: No infinite loop on storage event
  - storage events only fire across tabs (not in the tab that wrote)
  - refreshTierUI() does not write to localStorage (no circular trigger)

## Edge Cases

- [ ] Deal stacking with £0 price lot → informative message shown ("Purchase price is required")
- [ ] Deal stacking with no LENDER_DATA → fallback rates used (0.85%/mo + 2% arrangement fee), "market averages" note displayed
- [ ] Hold scenario without rental income → "Enter rental income" prompt shown
- [ ] Hold scenario with cashLeftIn <= 0 → "All capital recycled" message, CoC shows N/A
- [ ] Session token expiry → no accidental downgrade (Supabase TOKEN_REFRESHED event triggers onSignIn → updateProStatus re-fetches tier)

---
*Phase: 03-deal-stacking-tier-verification*
*Created: 2026-03-16*
