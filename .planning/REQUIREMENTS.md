# Requirements: Bridgematch Auction Tool v1.1

**Defined:** 2026-03-15
**Core Value:** Every upcoming UK auction lot, with complete data, scored for investment potential and matched to bridging lenders

## v1.1 Requirements

### Hardening

- [x] **HARD-01**: SDLT calculator uses correct 2025/26 investor rates (5% surcharge, not 3%)
- [x] **HARD-02**: SDLT calculator handles Scotland (LBTT + ADS) and Wales (LTT) correctly
- [x] **HARD-03**: Stripe `trial_used` flag is checked on signup to prevent trial abuse via re-registration
- [x] **HARD-04**: Stripe webhooks deduplicate events by `event.id` (idempotency)
- [x] **HARD-05**: Subscription downgrade honours `current_period_end` instead of immediate cutoff
- [x] **HARD-06**: Broken `calcDealAnalysis()` replaced with correct deal stacking logic
- [x] **HARD-07**: Firecrawl requests use `['markdown', 'rawHtml']` format for better Gemini extraction

### Data Freshness

- [x] **FRSH-01**: Frontend defaults to future-only auctions (past catalogues hidden unless user opts in)
- [x] **FRSH-02**: Lot-level sold/unsold status reliably detected and displayed across all auction houses
- [x] **FRSH-03**: Standardised `lot.status` field in extraction pipeline (available/sold/STC/withdrawn)
- [x] **FRSH-04**: Alerting fires when auto-analyse fails or discovery misses catalogues (email + webhook)
- [x] **FRSH-05**: Admin dashboard shows data freshness metrics (last scrape time, image coverage %, lot count trends)

### Image Quality

- [ ] **IMG-01**: Image coverage rate improves from current baseline to >80% across all houses
- [ ] **IMG-02**: Firecrawl structured output leveraged for better image extraction
- [ ] **IMG-03**: Missing-image lots flagged in admin dashboard for manual review

### Enrichment

- [ ] **ENRH-01**: EPC ratings fetched via MHCLG open data API and displayed per lot
- [ ] **ENRH-02**: Flood risk data fetched via Environment Agency API and displayed per lot
- [ ] **ENRH-03**: Enrichment runs async (post-extraction), batched by postcode, with 30-day cache
- [ ] **ENRH-04**: Enrichment data available to all users (not gated behind premium)

### Auction House Expansion

- [ ] **EXPN-01**: Add as many new UK auction houses as feasible (no fixed target — maximise coverage)
- [ ] **EXPN-02**: Each new house has a working DOM extractor with >0 lots on live test
- [ ] **EXPN-03**: Each new house captures images where available
- [ ] **EXPN-04**: Pagination handled correctly for multi-page catalogues

### Deal Stacking

- [x] **DEAL-01**: User can input GDV, works cost, legal costs, and expected rental income per lot
- [x] **DEAL-02**: Tool auto-calculates SDLT from purchase price using correct 2025/26 rates
- [x] **DEAL-03**: Tool auto-calculates bridging finance costs from Bridgematch lender data
- [x] **DEAL-04**: Full investment stack displayed: total cost in, net profit, ROI, cash-on-cash return
- [ ] **DEAL-05**: Deal stacking available as premium-only feature (replaces "Coming Soon" chip)
- [x] **DEAL-06**: Flip (sell) and Hold (refinance + rent) scenarios both calculated

### Tier Verification

- [ ] **TIER-01**: Trial expiry correctly downgrades user to free tier
- [ ] **TIER-02**: Resubscription after cancellation restores premium access
- [ ] **TIER-03**: Payment failure triggers grace period before downgrade (not immediate)
- [ ] **TIER-04**: All gating points verified end-to-end (AI search limits, blurring, external links, deal stacking)
- [ ] **TIER-05**: Edge case: user with expired trial subscribes via Stripe → premium activated correctly

## v2 Requirements (Deferred)

### Notifications
- **NOTF-01**: Email alerts when new catalogues drop for followed auction houses
- **NOTF-02**: Price drop alerts for watched lots

### Content & SEO
- **SEO-01**: Blog/content section for organic traffic
- **SEO-02**: Individual lot pages with SEO-friendly URLs

### Advanced Enrichment
- **ENRH-05**: Council tax band via VOA API
- **ENRH-06**: Planning applications nearby
- **ENRH-07**: Unsold lot tracking and scoring across auction cycles

### Integration
- **INTG-01**: Full Bridgematch integration (auto-finance per lot from directory view)
- **INTG-02**: EPC rating lookups

## Out of Scope

| Feature | Reason |
|---------|--------|
| Zoopla/Rightmove scraping | ToS violation, actively blocked — use free public APIs instead |
| Frontend redesign | Separate milestone |
| Branding split (AuctionBrain) | Future consideration |
| Portfolio management | Lendlord owns this space |
| Bidding platform features | BidX1 owns this space |
| Gated directory data | EIG's paywall model is criticised; free access drives traffic |
| Mobile app | Web-first, mobile later |
| Full lender comparison tool | Brickflow owns this; Bridgematch Lite serves investor needs |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HARD-01 | Phase 1 | Complete |
| HARD-02 | Phase 1 | Complete |
| HARD-03 | Phase 1 | Complete |
| HARD-04 | Phase 1 | Complete |
| HARD-05 | Phase 1 | Complete |
| HARD-06 | Phase 3 | Complete |
| HARD-07 | Phase 1 | Complete |
| FRSH-01 | Phase 1 | Complete |
| FRSH-02 | Phase 1 | Complete |
| FRSH-03 | Phase 1 | Complete |
| FRSH-04 | Phase 1 | Complete |
| FRSH-05 | Phase 1 | Complete |
| IMG-01 | Phase 2 | Pending |
| IMG-02 | Phase 2 | Pending |
| IMG-03 | Phase 2 | Pending |
| ENRH-01 | Phase 2 | Pending |
| ENRH-02 | Phase 2 | Pending |
| ENRH-03 | Phase 2 | Pending |
| ENRH-04 | Phase 2 | Pending |
| EXPN-01 | Phase 2 | Pending |
| EXPN-02 | Phase 2 | Pending |
| EXPN-03 | Phase 2 | Pending |
| EXPN-04 | Phase 2 | Pending |
| DEAL-01 | Phase 3 | Complete |
| DEAL-02 | Phase 3 | Complete |
| DEAL-03 | Phase 3 | Complete |
| DEAL-04 | Phase 3 | Complete |
| DEAL-05 | Phase 3 | Pending |
| DEAL-06 | Phase 3 | Complete |
| TIER-01 | Phase 3 | Pending |
| TIER-02 | Phase 3 | Pending |
| TIER-03 | Phase 3 | Pending |
| TIER-04 | Phase 3 | Pending |
| TIER-05 | Phase 3 | Pending |

**Coverage:**
- v1.1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-15*
*Last updated: 2026-03-15 after plan 01-03 completion*
