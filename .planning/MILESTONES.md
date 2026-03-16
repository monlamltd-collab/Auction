# Milestones

## v1.1 Hardening, Enrichment & Deal Stacking (Shipped: 2026-03-16)

**Phases completed:** 3 phases, 10 plans, 17 tasks

**Timeline:** 2 days (2026-03-15 → 2026-03-16)
**Git range:** feat(01-01) → feat(03-03) (~109 commits)
**Lines changed:** +2,400 / -226 across 8 files

**Key accomplishments:**
1. Multi-country SDLT calculator — England (5% surcharge), Scotland (LBTT + 6% ADS), Wales (LTT higher rates)
2. Stripe hardening — trial abuse prevention, webhook idempotency, graceful downgrade with 3-day grace period
3. Firecrawl markdown-first extraction, standardised lot.status field, future-only auction filtering
4. Pipeline alerting system (4 event types) with admin freshness dashboard
5. EPC rating + flood risk enrichment pipeline with 30-day Supabase caching (free for all users)
6. Image coverage improvement — IMG_HELPERS module, missing-image admin tooling, 99.6% coverage on new houses
7. 15 new auction houses added (~3,315 lots) + critical ASI bug fix affecting all ~50 DOM extractors
8. Deal stacking calculator with lender-matched bridging costs, flip/hold scenario comparison
9. Premium feature wiring — Yield Analysis, Comparables, Deal Stacking replace Coming Soon chips
10. Cross-tab tier sync, systematic gating audit, full tier lifecycle verification

---

