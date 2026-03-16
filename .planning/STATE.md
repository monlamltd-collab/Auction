---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: completed
last_updated: "2026-03-16T00:27:18.848Z"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 10
  completed_plans: 10
---

---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: complete
last_updated: "2026-03-16T00:22:41Z"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 10
  completed_plans: 10
  percent: 100
---

# Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-03-15)
**Core value:** Every upcoming UK auction lot, with complete data, scored for investment potential and matched to bridging lenders
**Current focus:** Phase 3 — Deal Stacking & Tier Verification

## Current Phase
Phase: 3 (complete)
Plan: 3 of 3 complete
Status: Plan 03-03 complete — tier verification, cross-tab sync, verification checklist

## Decisions
- Sold/unsold: diagonal overlay banner (estate agent style), status filter dropdown
- Future-only: server-side filtering, 7-day grace period, URL param persistence
- Alerting: admin dashboard log only, auto-resolve, 4 event types
- Admin metrics: per-house health table with diff summaries per scrape run
- Webhook dedup: 7-day TTL, cleanup every 100th webhook
- Payment grace: 3-day grace period for past_due before downgrade
- Subscription cancellation: honour current_period_end via tier_expires_at
- Image helpers: shared IMG_HELPERS injected into all DOM extractor contexts (lazy-load, background-image, thumbnail upgrade)
- Missing images: admin endpoint + dashboard UI for tracking lots without images
- ASI bug fix: All DOM extractors were silently broken due to `return\n(IIFE)` ASI — fixed with `.trim()`
- Auction House UK branches: 6 regional branches added via shared extractor (3,098 lots)
- Suttonkersh pagination: uses `start=N` offset (not `page=N`)
- Blocked houses: Symonds & Sampson, GTH, All Wales Auction — all return 403 or ECONNREFUSED
- Deal stacking lender matching: filter LENDER_DATA by LTV, pick lowest rate; fallback 0.85%/mo + 2% arrangement
- Hold scenario: 75% BTL refinance at 5.5% interest-only, 10% management, 1-month void
- Deal stacking widget gated behind isPremium(); free-tier CTA deferred to Plan 02
- Premium feature gating pattern: details/summary + blur + upgrade CTA for free users
- Net yield = grossYield * 0.867 (10% management + 4-week void)
- Yield rating bands: Good >= 7%, Fair 5-7%, Poor < 5%
- Cross-tab tier sync: refreshTierUI() is UI-only, no API call to prevent infinite loop
- External link gating handled via lot blurring (url=null), not a separate gate

## Blockers
(None)

## Session Log
- 2026-03-15: Project initialized, research complete, roadmap created
- 2026-03-15: Phase 1 context gathered
- 2026-03-15: Plan 01-02 executed — Stripe hardening (trial abuse, webhook idempotency, downgrade logic)
- 2026-03-15: Plan 01-01 executed — SDLT calculator fix for England, Scotland & Wales
- 2026-03-15: Plan 01-04 executed — Admin alerting & data freshness metrics
- 2026-03-15: Plan 01-03 executed — Firecrawl markdown, lot.status pipeline, overlay banners, future-only display
- 2026-03-15: Plan 02-02 executed — Image coverage improvement
- 2026-03-15: Plan 02-01 executed — EPC & Flood Risk Enrichment Pipeline
- 2026-03-15: Plan 02-03 executed — Auction House Expansion (15 new houses, 3,315 lots)
- 2026-03-15: Phase 3 context gathered
- 2026-03-16: Plan 03-01 executed — Deal Stacking Calculator Core (calcDealStack, widget, live recalc, LTV wiring, edge cases)
- 2026-03-16: Plan 03-02 executed — Premium Feature Wiring (Yield Analysis, Comparables, Deal Stacking teaser, right-column gating)
- 2026-03-16: Plan 03-03 executed — Tier Verification & Edge Cases (cross-tab sync, gating audit, lifecycle verification, checklist)

---
*Last updated: 2026-03-16 after plan 03-03 execution*
