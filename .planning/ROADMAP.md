# Roadmap: Bridgematch Auction Tool

## Milestones

- :white_check_mark: **v1.1 Hardening, Enrichment & Deal Stacking** - Phases 1-3 (shipped 2026-03-16)
- :construction: **v1.2 Free-First Growth** - Phases 4-7 (in progress)

## Phases

<details>
<summary>v1.1 Hardening, Enrichment & Deal Stacking (Phases 1-3) - SHIPPED 2026-03-16</summary>

- [x] Phase 1: Hardening & Data Freshness (4/4 plans) - completed 2026-03-15
- [x] Phase 2: Enrichment & House Expansion (3/3 plans) - completed 2026-03-15
- [x] Phase 3: Deal Stacking & Tier Verification (3/3 plans) - completed 2026-03-16

</details>

### v1.2 Free-First Growth (Phases 4-7)

**Milestone Goal:** Pivot to free tool, maximize user signups, monetize via bridging finance leads. Target 500-1,000 MAU to approach lenders for sponsorship.

**Phase Numbering:**
- Integer phases (4, 5, 6, 7): Planned milestone work
- Decimal phases (4.1, 5.1): Urgent insertions (marked with INSERTED)

- [ ] **Phase 4: Foundation** - Infra checks, Stripe hibernation, free-first gating, and all bug fixes
- [ ] **Phase 5: Measurement** - Analytics infrastructure for MAU tracking and funnel data
- [ ] **Phase 6: AI & Scraping Hardening** - AI provider abstraction, cost monitoring, scraping audit and expansion
- [ ] **Phase 7: Landing Page** - Acquisition page with USP hero and sign-up funnel

## Phase Details

### Phase 4: Foundation
**Goal**: Users access all AI features for free after sign-in, with no Stripe payment flows, on a stable bug-free platform
**Depends on**: Nothing (first phase of v1.2)
**Requirements**: INFR-01, INFR-02, INFR-03, GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, FIX-01, FIX-02, FIX-03, FIX-04, FIX-05, FIX-06, FIX-07, FIX-08
**Success Criteria** (what must be TRUE):
  1. Signed-in user can use smart search, analyser, scores, deal stacking, and CSV export without any payment prompt
  2. No Stripe checkout, upgrade CTA, or paywall modal appears anywhere in the application
  3. Anonymous user sees blurred AI fields and a "Sign in free" prompt (not "Upgrade")
  4. All 8 known bugs are resolved: heavy refurb executes search, score sort works within tiers, empty states show helpful messages, search is trimmed/debounced, negative pages are guarded, deal stacking reflows on mobile, sign-in page text fits container, CSV export checks tier server-side
  5. Supabase plan, Railway capacity, and Stripe subscriber state have been verified/resolved before any code changes
**Plans**: 4 plans

Plans:
- [x] 04-01-PLAN.md — Infrastructure verification checkpoint (Supabase, Stripe, Railway)
- [x] 04-02-PLAN.md — Server-side Stripe hibernation, tier resolution, and rate limits
- [x] 04-03-PLAN.md — Client-side gating pivot (payment UI to sign-in prompts) and CSV guard
- [ ] 04-04-PLAN.md — All 7 frontend bug fixes (search, sort, empty states, debounce, pagination, mobile, overflow)

### Phase 5: Measurement
**Goal**: Every key user action is tracked, providing MAU counts and funnel data needed to pitch lenders
**Depends on**: Phase 4
**Requirements**: ANAL-01, ANAL-02, ANAL-03, ANAL-04
**Success Criteria** (what must be TRUE):
  1. Server-side activity events fire for sign-up, search, analyse, deal stacking, and BridgeMatch interactions
  2. Umami Cloud reports page views, unique visitors (MAU), referral sources, and bounce rate
  3. BridgeMatch funnel is tracked end-to-end: lot view to finance click to form start to submission
  4. Admin can view an analytics summary showing MAU count, top funnels, and engagement metrics
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Analytics instrumentation (server-side events, Umami script, client-side funnel tracking)
- [ ] 05-02-PLAN.md — Admin analytics dashboard (MAU hero, funnel visualization, engagement metrics)

### Phase 6: AI & Scraping Hardening
**Goal**: AI costs are visible and controllable via provider abstraction, and scraping coverage is audited and expanded
**Depends on**: Phase 5 (analytics needed for cost logging)
**Requirements**: AI-01, AI-02, AI-03, SCRP-01, SCRP-02, SCRP-03, SCRP-04
**Success Criteria** (what must be TRUE):
  1. AI calls route through a provider abstraction layer with model selection via env var
  2. Token usage and estimated cost are logged per AI call and visible in admin dashboard
  3. All existing DOM extractors have been audited -- broken ones fixed, image coverage verified above 90%
  4. Admin dashboard surfaces actionable scraping data (broken extractors, coverage gaps, lot counts) without noise
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Landing Page
**Goal**: New visitors land on a compelling page that converts them to signed-in users
**Depends on**: Phase 4 (correct CTAs), Phase 5 (analytics measure from day one)
**Requirements**: LAND-01, LAND-02
**Success Criteria** (what must be TRUE):
  1. Root URL (/) serves a landing page with "50% of auction houses aren't on Rightmove" hero message
  2. Landing page includes features/benefits section, live lot count as social proof, and a prominent free sign-up CTA
  3. Umami and server-side analytics track landing page visits and sign-up conversions from day one
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 4 -> 4.1 -> 5 -> 5.1 -> 6 -> 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Hardening & Data Freshness | v1.1 | 4/4 | Complete | 2026-03-15 |
| 2. Enrichment & House Expansion | v1.1 | 3/3 | Complete | 2026-03-15 |
| 3. Deal Stacking & Tier Verification | v1.1 | 3/3 | Complete | 2026-03-16 |
| 4. Foundation | 3/4 | In Progress|  | - |
| 5. Measurement | v1.2 | 1/2 | In Progress | - |
| 6. AI & Scraping Hardening | v1.2 | 0/2 | Not started | - |
| 7. Landing Page | v1.2 | 0/1 | Not started | - |

---
*Full v1.1 details: .planning/milestones/v1.1-ROADMAP.md*
*Roadmap created: 2026-03-15*
*v1.2 phases added: 2026-03-20*
