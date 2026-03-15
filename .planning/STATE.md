---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: in_progress
last_updated: "2026-03-15T21:13:24.823Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 7
  completed_plans: 7
---

---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: in_progress
last_updated: "2026-03-15T21:06:00.000Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
---

# Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-03-15)
**Core value:** Every upcoming UK auction lot, with complete data, scored for investment potential and matched to bridging lenders
**Current focus:** Phase 2 — Enrichment & House Expansion

## Current Phase
Phase: 2 (complete)
Plan: 3 of 3 complete
Status: Complete — moving to Phase 3

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

## Decisions (new)
- ASI bug fix: All DOM extractors were silently broken due to `return\n(IIFE)` ASI — fixed with `.trim()`
- Auction House UK branches: 6 regional branches added via shared extractor (3,098 lots)
- Suttonkersh pagination: uses `start=N` offset (not `page=N`)
- Blocked houses: Symonds & Sampson, GTH, All Wales Auction — all return 403 or ECONNREFUSED

## Blockers
(None)

## Session Log
- 2026-03-15: Project initialized, research complete, roadmap created
- 2026-03-15: Phase 1 context gathered — resume at .planning/phases/01-hardening-data-freshness/01-CONTEXT.md
- 2026-03-15: Plan 01-02 executed — Stripe hardening (trial abuse, webhook idempotency, downgrade logic)
- 2026-03-15: Plan 01-01 executed — SDLT calculator fix for England, Scotland & Wales
- 2026-03-15: Plan 01-04 executed — Admin alerting & data freshness metrics (pipeline_alerts table, diff summaries, admin dashboard)
- 2026-03-15: Plan 01-03 executed — Firecrawl markdown, lot.status pipeline, overlay banners, future-only display
- 2026-03-15: Plan 02-02 executed — Image coverage improvement (IMG_HELPERS, Firecrawl images format, missing-images endpoint + admin UI, test files)
- 2026-03-15: Plan 02-01 executed — EPC & Flood Risk Enrichment Pipeline (fetchEPCByPostcode, matchEPCToLot, fetchFloodZone, enrichment_cache, frontend badges, 39 tests)
- 2026-03-15: Plan 02-03 executed — Auction House Expansion (15 new houses, ASI bug fix, 3,315 lots, 99.6% image coverage)

---
*Last updated: 2026-03-15 after plan 02-03 execution*
