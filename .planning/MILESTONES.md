# Milestones

## v1.2 Free-First Growth (Shipped: 2026-04-03)

**Phases completed:** 4 phases (Foundation, Measurement, AI & Scraping Hardening, Landing Page) + extensive unplanned work

**Timeline:** 14 days (2026-03-20 → 2026-04-03)
**Git range:** ~40 commits
**Lines changed:** +24,034 / -3,185 across 73 files

**Key accomplishments:**
1. Stripe hibernation + free-first gating — all AI features free after sign-in, no payment flows
2. 8 frontend bug fixes (search, sort, empty states, debounce, pagination, mobile, overflow)
3. Analytics infrastructure — server-side activity events, Umami Cloud, BridgeMatch funnel tracking
4. AI provider abstraction layer with cost logging and daily budget tracking
5. Universal extraction harness + quality gate — batch-level validation, field-level scoring, regression detection
6. Adaptive resilience harness — 9-module self-healing pipeline with circuit breakers
7. AI-driven manager with wave-based concurrent pipeline orchestration
8. Universal multi-image carousel for all auction houses
9. Bedroom count coverage dramatically improved across all lots
10. 6+ new auction houses (Property Solvers, Pugh, Allsop, Symonds, Stags/GTH, Robin Jessop)
11. Tier 2 + Tier 3 UX overhaul (20+ items: unsold view, onboarding, score tooltip, alerts, saved searches, budget calculator)
12. Trust-destroying bug fixes (yield warnings, EPC MEES flags, AI search enrichment)
13. Location radius search + batch geocoding via Postcodes.io
14. Admin consolidation (4 tabs → 2: Operations + Growth)
15. Unified email templates via Resend + Landing page style
16. Nightly audit auto-fix with self-healing discovery

---

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

