# Requirements: Bridgematch Auction Tool v1.2

**Defined:** 2026-03-20
**Core Value:** Every upcoming UK auction lot, with complete data, scored for investment potential and matched to bridging lenders -- so investors can find and fund deals in one place.

## v1.2 Requirements

### Gating & Monetization

- [x] **GATE-01**: System hibernates Stripe behind `STRIPE_ENABLED` env var -- all payment code preserved but unreachable when disabled
- [x] **GATE-02**: `resolveEffectiveTier()` returns premium for all signed-in users when Stripe disabled
- [x] **GATE-03**: Paywall modals and upgrade CTAs hidden when Stripe disabled
- [x] **GATE-04**: AI features (smart search, analyser, scores, deal stacking, CSV export) require sign-in but are free
- [x] **GATE-05**: Signed-in users have daily AI rate limit (e.g. 50 searches/day) as cost safety valve

### Bug Fixes

- [ ] **FIX-01**: Heavy refurb button triggers search execution, not just input population
- [ ] **FIX-02**: Score sort orders lots within tiers (not just groups into tiers)
- [ ] **FIX-03**: Empty state messaging when filters or AI search return 0 results
- [ ] **FIX-04**: Search input trimmed and debounced
- [ ] **FIX-05**: Negative page numbers guarded
- [ ] **FIX-06**: Deal stacking widget reflows to single column on mobile
- [ ] **FIX-07**: Sign-in page text no longer overflows container
- [x] **FIX-08**: CSV export has server-side tier check

### Landing Page

- [ ] **LAND-01**: Welcome page updated with "50% aren't on Rightmove" USP hero message
- [ ] **LAND-02**: Features/benefits section and free sign-up CTA on welcome page

### Analytics

- [ ] **ANAL-01**: Supabase `activity_events` wired to key API endpoints (search, analyse, deal stacking, BridgeMatch, sign-up)
- [ ] **ANAL-02**: Umami Cloud integrated for page-level metrics (MAU, bounce rate, page views)
- [ ] **ANAL-03**: BridgeMatch funnel tracked: lot view -> finance click -> form start -> submission
- [ ] **ANAL-04**: Admin can view analytics summary (MAU, funnel, engagement)

### Scraping & Coverage

- [ ] **SCRP-01**: All existing DOM extractors audited and broken ones fixed
- [ ] **SCRP-02**: Image coverage verified across all houses (target >90%)
- [ ] **SCRP-03**: New auction houses recruited to increase coverage
- [ ] **SCRP-04**: Admin dashboard cleaned up -- surface actionable data, hide noise

### AI Abstraction

- [ ] **AI-01**: `callGemini()` extracted to `lib/ai-provider.js` with provider abstraction
- [ ] **AI-02**: Token usage and cost logging per API call
- [ ] **AI-03**: Model selection via env var (ready for future provider swap)

### Infrastructure

- [x] **INFR-01**: Confirm Supabase is on paid plan (not free tier) before scaling
- [x] **INFR-02**: Cancel any active Stripe subscriptions before hibernating
- [x] **INFR-03**: Verify Railway memory/CPU baseline can handle free-tier traffic volume

## Future Requirements (v1.3+)

### Growth & SEO
- **SEO-01**: Individual lot pages with SEO-friendly URLs
- **SEO-02**: Blog/content section for organic SEO traffic
- **SEO-03**: Full marketing landing page with UI animations and modern tooling

### Engagement
- **ENG-01**: Email alerts when new catalogues drop for followed auction houses
- **ENG-02**: Portfolio tracking for saved lots

### Integration
- **INT-01**: Full Bridgematch integration (auto-finance per lot)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full landing page rebuild with animation tooling | Deferred -- needs research into UI framework, build as separate milestone |
| Branding split (AuctionBrain vs Bridgematch) | Future consideration |
| Mobile app | Web-first, mobile later |
| Zoopla/Rightmove scraping | ToS violation |
| Full Bridgematch auto-finance per lot | Future milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GATE-01 | Phase 4 | Complete |
| GATE-02 | Phase 4 | Complete |
| GATE-03 | Phase 4 | Complete |
| GATE-04 | Phase 4 | Complete |
| GATE-05 | Phase 4 | Complete |
| FIX-01 | Phase 4 | Pending |
| FIX-02 | Phase 4 | Pending |
| FIX-03 | Phase 4 | Pending |
| FIX-04 | Phase 4 | Pending |
| FIX-05 | Phase 4 | Pending |
| FIX-06 | Phase 4 | Pending |
| FIX-07 | Phase 4 | Pending |
| FIX-08 | Phase 4 | Complete |
| LAND-01 | Phase 7 | Pending |
| LAND-02 | Phase 7 | Pending |
| ANAL-01 | Phase 5 | Pending |
| ANAL-02 | Phase 5 | Pending |
| ANAL-03 | Phase 5 | Pending |
| ANAL-04 | Phase 5 | Pending |
| SCRP-01 | Phase 6 | Pending |
| SCRP-02 | Phase 6 | Pending |
| SCRP-03 | Phase 6 | Pending |
| SCRP-04 | Phase 6 | Pending |
| AI-01 | Phase 6 | Pending |
| AI-02 | Phase 6 | Pending |
| AI-03 | Phase 6 | Pending |
| INFR-01 | Phase 4 | Complete |
| INFR-02 | Phase 4 | Complete |
| INFR-03 | Phase 4 | Complete |

**Coverage:**
- v1.2 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after roadmap creation*
