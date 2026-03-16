# Bridgematch Auction Tool

## What This Is

A UK property auction directory and AI-powered catalogue analyser, live at auctions.bridgematch.co.uk. Scrapes upcoming auction catalogues from ~36 UK auction houses, uses Google Gemini AI to extract structured lot data, enriches with EPC ratings and flood risk data, scores each lot for investment potential, and presents results in a filterable frontend with deal stacking analysis. Includes Bridgematch Lite — an investor-facing bridging finance matching tool that shows how many lenders would fund each deal.

**Owner:** Simon Deeming
**Stack:** Node.js (Express monolith), Firecrawl + Puppeteer scraping, Gemini AI extraction, Supabase (auth + DB), Stripe payments, Railway hosting

## Core Value

Every upcoming UK auction lot, with complete data (images, links, metadata), scored for investment potential and matched to bridging lenders — so investors can find and fund deals in one place.

## Requirements

### Validated

<!-- Shipped and confirmed working -->

- ✓ Three-tier scraping pipeline (Firecrawl → Puppeteer → HTTP) — existing
- ✓ AI lot extraction with Gemini (DOM extractors + Gemini fallback + merge) — existing
- ✓ Investment scoring engine (20+ signals, 0-10 scale) — existing
- ✓ Filterable lot directory (free for all users, unblurred) — existing
- ✓ Smart search with AI (natural language lot queries) — existing
- ✓ Admin dashboard (calendar management, backfill, diagnostics) — existing
- ✓ Supabase auth with magic links — existing
- ✓ Stripe subscription payments (£9.99/mo premium) — existing
- ✓ Tiered gating (anon: 3 AI searches, free: 10/day, premium: unlimited) — existing
- ✓ 14-day Pro trial on signup — existing
- ✓ AI field blurring for non-premium users (scores, opps, risks, URLs truncated after 6 lots) — existing
- ✓ Bridgematch Lite lender matching (always-masked lender names) — existing
- ✓ Land Registry enrichment (street averages, yield estimates, comps) — existing
- ✓ Auto-analyse pipeline (6-hour cycle, hash dedup, regression guard) — existing
- ✓ Nightly audit via GitHub Actions with auto-fix — existing
- ✓ Tenure extraction from catalogues — existing
- ✓ Multi-country SDLT calculator (England 5% surcharge, Scotland LBTT+ADS, Wales LTT) — v1.1
- ✓ Stripe hardening: trial abuse prevention, webhook idempotency, graceful downgrade — v1.1
- ✓ Future-only auction display with server-side filtering and 7-day grace — v1.1
- ✓ Standardised lot.status field (available/sold/stc/withdrawn) with overlay banners — v1.1
- ✓ Firecrawl markdown-first extraction format — v1.1
- ✓ Pipeline alerting (4 event types) with admin freshness dashboard — v1.1
- ✓ EPC rating enrichment via MHCLG open data API (free, 30-day cache) — v1.1
- ✓ Flood risk enrichment via Environment Agency API (free, 30-day cache) — v1.1
- ✓ IMG_HELPERS module for DOM extractors with lazy-load fallback chain — v1.1
- ✓ Missing-image admin dashboard with coverage metrics — v1.1
- ✓ ~36 auction houses with DOM extractors (15 new in v1.1) — v1.1
- ✓ Deal stacking calculator (lender-matched bridging, flip/hold scenarios) — v1.1
- ✓ Premium features wired: Yield Analysis, Comparables, Deal Stacking — v1.1
- ✓ Tier lifecycle verified: trial expiry, resubscription, payment grace, cross-tab sync — v1.1

### Active

<!-- Next milestone scope — to be defined via /gsd:new-milestone -->

- [ ] Email alerts when new catalogues drop for followed auction houses
- [ ] Blog/content section for organic SEO traffic
- [ ] Frontend redesign
- [ ] Individual lot pages with SEO-friendly URLs

### Out of Scope

- Full Bridgematch integration (auto-finance per lot) — future milestone
- Branding split (AuctionBrain vs Bridgematch) — future consideration
- Automated calendar scraping via cron — partially exists via discovery, full automation deferred
- Mobile app — web-first, mobile later
- Zoopla/Rightmove scraping — ToS violation, use free public APIs instead

## Context

- **Shipped v1.1** with ~2,400 new lines across 8 files. ~15,755 LOC total (JS/HTML).
- **~36 auction houses** with DOM extractors (up from ~21). ASI bug fix in v1.1 resolved silent failures across all extractors.
- **Firecrawl now used for markdown+rawHtml** — better Gemini extraction at zero additional credit cost.
- **Image coverage significantly improved** — IMG_HELPERS module, 99.6% coverage on new houses, admin tooling for missing images.
- **Enrichment pipeline live** — EPC (MHCLG) + flood risk (EA) with 30-day Supabase cache. Free for all users.
- **Deal stacking is the premium upgrade driver** — free users see blurred preview + upgrade CTA.
- **Tier gating strategy:** Directory data always free, only AI features gated (per memory: `project_tier_strategy.md`).
- **Future lead model:** Broker pool/marketplace for regulated leads (per memory: `project_broker_marketplace.md`).
- **server.js is ~11,000 lines** — monolith containing all backend logic. No immediate plans to split.
- **Gemini free tier limits:** 15 RPM, 1500 RPD — rate limiter built in. Monitor as house count grows.
- **Firecrawl credit management:** Monthly budget cap, auto-exhaustion detection, hash-based skip saves ~50-70%.
- **New env vars added in v1.1:** `EPC_API_EMAIL`, `EPC_API_KEY`
- **Manual Supabase tables needed:** `processed_webhook_events`, `pipeline_alerts`, `enrichment_cache`, `last_diff` column on `house_skills`

## Constraints

- **Budget:** Gemini free tier (15 RPM, 1500 RPD) — cannot exceed without paid plan
- **Budget:** Firecrawl monthly credit budget (default 15,000) — enrichment via Zoopla/Rightmove will consume credits
- **Hosting:** Railway with limited RAM — Puppeteer memory usage matters
- **Architecture:** Single server.js monolith — changes must not break existing functionality
- **Scraping:** Auction houses change their sites without notice — DOM extractors break regularly
- **Legal:** No scraping of data behind login walls; respect robots.txt on property portals

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Firecrawl as primary scraper | Managed service handles JS rendering, anti-bot, proxies | ✓ Good |
| Gemini free tier | Sufficient for current volume, avoids cost | ✓ Good — monitor as 36 houses expand |
| Directory data always free | Drives traffic and trust, gates only AI features | ✓ Good — v1.1 confirmed |
| Lender names always masked | Generates broker leads, not direct lender access | ✓ Good |
| Enrichment free for all users | Lifts overall product quality, upgrade case via deal stacking | ✓ Good — EPC + flood live v1.1 |
| Deal stacking: SDLT + finance auto-calculated | Deterministic from purchase price and lender data | ✓ Good — lender-matched rates v1.1 |
| Deal stacking: GDV, works, legal, rental = user input | These are assumptions the investor must provide | ✓ Good — v1.1 |
| Firecrawl markdown+rawHtml format | Better Gemini extraction at zero cost | ✓ Good — v1.1 |
| IMG_HELPERS shared module | Consistent image extraction across all DOM extractors | ✓ Good — v1.1 |
| Webhook dedup with 7-day TTL | Prevents duplicate Stripe event processing | ✓ Good — v1.1 |
| 3-day grace period on payment failure | Avoids premature downgrade for transient payment issues | ✓ Good — v1.1 |
| Premium gating via details/summary+blur | Native HTML, reliable across browsers per CLAUDE.md | ✓ Good — v1.1 |
| Net yield = grossYield × 0.867 | Accounts for 10% management + 4-week void | ✓ Good — v1.1 |
| Cross-tab tier sync is UI-only | No API call prevents infinite loop | ✓ Good — v1.1 |

---
*Last updated: 2026-03-16 after v1.1 milestone*
