# Requirements: Bridgematch Auction Tool

**Defined:** 2026-04-03
**Core Value:** Every upcoming UK auction lot, with complete data, scored for investment potential and matched to bridging lenders — so investors can find and fund deals in one place.

## v1.3 Requirements

Requirements for Data Quality Hardening milestone. Each maps to roadmap phases.

### Field Coverage

- [ ] **FIELD-01**: Bedroom count is extracted for >80% of lots across all auction houses (priority field)
- [ ] **FIELD-02**: Tenure (freehold/leasehold) is extracted for >80% of lots
- [ ] **FIELD-03**: Property type is normalised to canonical values (house/flat/land/commercial/mixed) across all houses
- [ ] **FIELD-04**: Guide price is extracted for >95% of lots, with price ranges handled consistently

### Image Quality

- [ ] **IMG-01**: Image URLs are validated via HTTP HEAD check at scrape time — broken/unreachable URLs rejected before caching
- [ ] **IMG-02**: Broken CDN image badge bug (HIGH-8) is fixed — no phantom badges on failed images
- [ ] **IMG-03**: Per-house image coverage % is tracked and visible in admin dashboard, with houses below 70% flagged
- [ ] **IMG-04**: Image loading is fast — optimised proxying, correct sizing, lazy loading, and CDN caching so listings feel instant

### Validation & UX

- [ ] **VAL-01**: Quality gate batch threshold is raised above 0.3 and per-lot minimum enforced before frontend display
- [ ] **VAL-02**: Missing data displays gracefully — clean gaps with contextual messaging, not raw "?" or empty fields
- [ ] **VAL-03**: Admin dashboard shows per-house field coverage breakdown (beds, tenure, price, images, propType)

### Geocoding

- [ ] **GEO-01**: Lot lat/lng is persisted to Supabase (not temporary _lat/_lng) for future map view
- [ ] **GEO-02**: Postcode extraction from addresses is improved via better regex and Gemini prompt tuning for higher geocode rate

### Coverage Expansion

- [ ] **COV-01**: New auction houses are onboarded to expand coverage toward competitor parity (~250 auctioneers)
- [ ] **COV-02**: Onboarding process is streamlined — platform family detection, shared extractors, and validation gates reduce per-house effort

## Future Requirements

### Map View
- **MAP-01**: Interactive map showing lot locations with clustering
- **MAP-02**: Map filters synchronised with list view filters

### Transaction Data
- **TXN-01**: Sold prices tracked per lot after auction
- **TXN-02**: Transaction history per auction house

### Growth & SEO
- **SEO-01**: Individual lot pages with SEO-friendly URLs
- **SEO-02**: Blog/content section for organic SEO traffic

### Engagement
- **ENG-01**: Email alerts when new catalogues drop for followed auction houses
- **ENG-02**: Portfolio tracking for saved lots

### Integration
- **INT-01**: Full Bridgematch integration (auto-finance per lot)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Map view UI | Needs geocoding persistence first (GEO-01) — separate milestone |
| Sold prices / transaction history | Competitor feature but requires different data sources |
| Scoring engine changes | Scoring depends on clean data — fix data first |
| Branding split (AuctionBrain vs Bridgematch) | Future consideration |
| Mobile app | Web-first, mobile later |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIELD-01 | TBD | Pending |
| FIELD-02 | TBD | Pending |
| FIELD-03 | TBD | Pending |
| FIELD-04 | TBD | Pending |
| IMG-01 | TBD | Pending |
| IMG-02 | TBD | Pending |
| IMG-03 | TBD | Pending |
| IMG-04 | TBD | Pending |
| VAL-01 | TBD | Pending |
| VAL-02 | TBD | Pending |
| VAL-03 | TBD | Pending |
| GEO-01 | TBD | Pending |
| GEO-02 | TBD | Pending |
| COV-01 | TBD | Pending |
| COV-02 | TBD | Pending |

**Coverage:**
- v1.3 requirements: 15 total
- Mapped to phases: 0
- Unmapped: 15

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-03 after initial definition*
