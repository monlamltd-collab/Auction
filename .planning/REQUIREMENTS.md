# Requirements: Bridgematch Auction Tool

**Defined:** 2026-04-03
**Core Value:** Every upcoming UK auction lot, with complete data, scored for investment potential and matched to bridging lenders -- so investors can find and fund deals in one place.

## v1.3 Requirements

Requirements for Data Quality Hardening milestone. Each maps to roadmap phases.

### Field Coverage

- [x] **FIELD-01**: Bedroom count is extracted for >80% of lots across all auction houses (priority field)
- [x] **FIELD-02**: Tenure (freehold/leasehold) is extracted for >80% of lots
- [x] **FIELD-03**: Property type is normalised to canonical values (house/flat/land/commercial/mixed) across all houses
- [x] **FIELD-04**: Guide price is extracted for >95% of lots, with price ranges handled consistently

### Image Quality

- [ ] **IMG-01**: Image URLs are validated via HTTP HEAD check at scrape time -- broken/unreachable URLs rejected before caching
- [ ] **IMG-02**: Broken CDN image badge bug (HIGH-8) is fixed -- no phantom badges on failed images
- [ ] **IMG-03**: Per-house image coverage % is tracked and visible in admin dashboard, with houses below 70% flagged
- [ ] **IMG-04**: Image loading is fast -- optimised proxying, correct sizing, lazy loading, and CDN caching so listings feel instant

### Validation & UX

- [x] **VAL-01**: Quality gate flags low-quality lots for graceful frontend handling (missing fields omitted from display, not shown as blanks) -- every lot remains visible in the directory regardless of data quality score
- [ ] **VAL-02**: Missing data displays gracefully -- fields with no data are simply absent from the listing card, not shown as "?" or empty gaps
- [x] **VAL-03**: Admin dashboard shows per-house field coverage breakdown (beds, tenure, price, images, propType)

### Coverage Expansion

- [ ] **COV-01**: New auction houses are onboarded to expand coverage toward competitor parity (~250 auctioneers)
- [ ] **COV-02**: Onboarding process is streamlined -- platform family detection, shared extractors, and validation gates reduce per-house effort

## Future Requirements

### Geocoding
- **GEO-01**: Lot lat/lng is persisted to Supabase (not temporary _lat/_lng) for future map view
- **GEO-02**: Postcode extraction from addresses is improved via better regex and Gemini prompt tuning for higher geocode rate

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
| Map view UI | Needs geocoding persistence first (GEO-01) -- separate milestone |
| Geocoding persistence | Deferred from v1.3 -- not needed until map view milestone |
| Sold prices / transaction history | Competitor feature but requires different data sources |
| Scoring engine changes | Scoring depends on clean data -- fix data first |
| Branding split (AuctionBrain vs Bridgematch) | Future consideration |
| Mobile app | Web-first, mobile later |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIELD-01 | Phase 8 | Complete |
| FIELD-02 | Phase 8 | Complete |
| FIELD-03 | Phase 8 | Complete |
| FIELD-04 | Phase 8 | Complete |
| IMG-01 | Phase 9 | Pending |
| IMG-02 | Phase 9 | Pending |
| IMG-03 | Phase 9 | Pending |
| IMG-04 | Phase 9 | Pending |
| VAL-01 | Phase 8 | Complete |
| VAL-02 | Phase 9 | Pending |
| VAL-03 | Phase 8 | Complete |
| COV-01 | Phase 10 | Pending |
| COV-02 | Phase 10 | Pending |

**Coverage:**
- v1.3 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-03 after roadmap revision (GEO-01/GEO-02 moved to Future, VAL-01 reworded)*
