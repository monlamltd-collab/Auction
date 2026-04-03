# Roadmap: Bridgematch Auction Tool

## Milestones

- :white_check_mark: **v1.1 Hardening, Enrichment & Deal Stacking** - Phases 1-3 (shipped 2026-03-16)
- :white_check_mark: **v1.2 Free-First Growth** - Phases 4-7 (shipped 2026-04-03)
- :construction: **v1.3 Data Quality Hardening** - Phases 8-10 (in progress)

## Phases

<details>
<summary>v1.1 Hardening, Enrichment & Deal Stacking (Phases 1-3) - SHIPPED 2026-03-16</summary>

- [x] Phase 1: Hardening & Data Freshness (4/4 plans) - completed 2026-03-15
- [x] Phase 2: Enrichment & House Expansion (3/3 plans) - completed 2026-03-15
- [x] Phase 3: Deal Stacking & Tier Verification (3/3 plans) - completed 2026-03-16

</details>

<details>
<summary>v1.2 Free-First Growth (Phases 4-7) - SHIPPED 2026-04-03</summary>

- [x] Phase 4: Foundation (4/4 plans) - completed
- [x] Phase 5: Measurement (3/3 plans) - completed
- [x] Phase 6: AI & Scraping Hardening (3/3 plans) - completed
- [x] Phase 7: Landing Page (1/1 plans) - completed

</details>

### v1.3 Data Quality Hardening (Phases 8-10)

**Milestone Goal:** Close the data quality gap with competitors -- every listing should feel complete, consistent, and trustworthy. Harden extraction, validation, and image pipelines so lots always appear but missing data is handled gracefully rather than displayed as gaps.

- [ ] **Phase 8: Field Extraction & Validation** - Improve extraction coverage for beds, tenure, propType, and price; tighten quality gate to flag (not reject) low-quality data; add admin field coverage dashboard
- [ ] **Phase 9: Image Pipeline & Frontend Polish** - Validate images at scrape time, fix badge bug, optimise loading speed, handle missing data gracefully
- [ ] **Phase 10: Coverage Expansion** - Onboard new auction houses with streamlined process using hardened quality infrastructure

## Phase Details

### Phase 8: Field Extraction & Validation
**Goal**: Users see complete, consistent lot data -- bedroom counts, tenure, property type, and guide price are reliably present across all auction houses, with admin visibility into per-house quality
**Depends on**: Nothing (first phase of v1.3)
**Requirements**: FIELD-01, FIELD-02, FIELD-03, FIELD-04, VAL-01, VAL-03
**Success Criteria** (what must be TRUE):
  1. Bedroom count is present on more than 80% of lots across all auction houses (up from ~51%)
  2. Tenure (freehold/leasehold) is present on more than 80% of lots (up from ~67%)
  3. Property type is normalised to one of five canonical values (house/flat/land/commercial/mixed) with no raw free-text values leaking through
  4. Guide price is present on more than 95% of lots, with price ranges (e.g. "50,000-60,000") parsed into a usable numeric value
  5. Quality gate flags low-quality lots so the frontend can omit missing fields gracefully -- but every lot remains visible in the directory (no lots are rejected or hidden)
  6. Admin dashboard shows per-house field coverage breakdown (beds, tenure, price, images, propType) so data quality gaps are immediately visible
**Plans**: 3 plans

Plans:
- [ ] 08-01-PLAN.md — Remove enrichment caps, fix price k-suffix, fix bungalow propType, raise quality gate thresholds, add propType to validateBatch coverage
- [ ] 08-02-PLAN.md — Extend /api/quality-report with fieldCoverage; add Field Coverage Per House table to admin Operations tab
- [x] 08-03-PLAN.md — Remove "?" gap chips for beds, tenure, propType from lot card and expanded panel in index.html

### Phase 9: Image Pipeline & Frontend Polish
**Goal**: Listings look polished and load fast -- no broken images, no phantom badges, and missing data fields are simply absent rather than showing gaps
**Depends on**: Phase 8
**Requirements**: IMG-01, IMG-02, IMG-03, IMG-04, VAL-02
**Success Criteria** (what must be TRUE):
  1. Broken image URLs are caught at scrape time via HTTP HEAD check and rejected before caching -- users never see a broken image placeholder
  2. The CDN image badge bug (HIGH-8) is fixed -- no phantom badges appear on lots with failed images
  3. Image loading feels instant -- lazy loading, correct sizing, and CDN caching eliminate visible loading jank
  4. Missing data fields are simply absent from the listing display -- no "?" characters, no empty labelled gaps, no "Beds not listed" placeholders; if the data isn't there, the field isn't shown
  5. Admin dashboard shows per-house image coverage percentage, with houses below 70% flagged for attention
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD

### Phase 10: Coverage Expansion
**Goal**: More auction houses are onboarded efficiently, expanding coverage toward competitor parity
**Depends on**: Phase 8, Phase 9 (quality infrastructure must be solid before scaling)
**Requirements**: COV-01, COV-02
**Success Criteria** (what must be TRUE):
  1. New auction houses are added and producing lots that pass through the quality gate with graceful handling of any missing fields
  2. Onboarding a new house uses platform family detection and shared extractors -- per-house effort is measurably reduced compared to v1.1/v1.2 onboarding
  3. New houses achieve the same field coverage thresholds (80%+ beds/tenure, 95%+ price, 70%+ images) as existing houses
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 8 -> 9 -> 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Hardening & Data Freshness | v1.1 | 4/4 | Complete | 2026-03-15 |
| 2. Enrichment & House Expansion | v1.1 | 3/3 | Complete | 2026-03-15 |
| 3. Deal Stacking & Tier Verification | v1.1 | 3/3 | Complete | 2026-03-16 |
| 4. Foundation | v1.2 | 4/4 | Complete | 2026-04-03 |
| 5. Measurement | v1.2 | 3/3 | Complete | 2026-04-03 |
| 6. AI & Scraping Hardening | v1.2 | 3/3 | Complete | 2026-04-03 |
| 7. Landing Page | v1.2 | 1/1 | Complete | 2026-04-03 |
| 8. Field Extraction & Validation | v1.3 | 1/3 | In Progress|  |
| 9. Image Pipeline & Frontend Polish | v1.3 | 0/? | Not started | - |
| 10. Coverage Expansion | v1.3 | 0/? | Not started | - |

---
*Full v1.1 details: .planning/milestones/v1.1-ROADMAP.md*
*Roadmap created: 2026-03-15*
*v1.2 phases added: 2026-03-20*
*v1.2 shipped: 2026-04-03*
*v1.3 phases added: 2026-04-03*
*v1.3 revised: 2026-04-03 (removed geocoding phase, reworded quality gate, moved VAL-03 to Phase 8)*
*Phase 8 planned: 2026-04-03 (3 plans)*
