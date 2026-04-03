# Bridgematch Auction Tool

## What This Is

A UK property auction directory and AI-powered catalogue analyser, live at auctions.bridgematch.co.uk. Scrapes upcoming auction catalogues from ~36 UK auction houses, uses Google Gemini AI to extract structured lot data, enriches with EPC ratings and flood risk data, scores each lot for investment potential, and presents results in a filterable frontend with deal stacking analysis. Includes Bridgematch Lite — an investor-facing bridging finance matching tool that shows how many lenders would fund each deal.

**Owner:** Simon Deeming
**Stack:** Node.js (Express monolith), Firecrawl + Puppeteer scraping, Gemini AI extraction, Supabase (auth + DB), Stripe payments (hibernated v1.2), Railway hosting

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

<!-- v1.3 — Data Quality Hardening -->

(Defined during v1.3 requirements phase)

### Out of Scope

- Full Bridgematch integration (auto-finance per lot) — future milestone
- Branding split (AuctionBrain vs Bridgematch) — future consideration
- Automated calendar scraping via cron — partially exists via discovery, full automation deferred
- Mobile app — web-first, mobile later
- Zoopla/Rightmove scraping — ToS violation, use free public APIs instead
- Email alerts when new catalogues drop — deferred to v1.3
- Blog/content section for SEO — deferred to v1.3
- Frontend full redesign — deferred to v1.3 (landing page is in scope for v1.2)
- Individual lot pages with SEO-friendly URLs — deferred to v1.3

## Current Milestone: v1.3 Data Quality Hardening

**Goal:** Close the data quality gap with competitors — every listing should feel complete, consistent, and trustworthy. Harden the extraction and validation pipeline so missing fields, broken images, and inconsistent data don't reach users.

**Target features:**
- Improve field coverage (beds ~51%, tenure ~67% → both above 80%)
- Image validation at scrape time (HTTP HEAD check, reject broken URLs before caching)
- Tighten quality gate thresholds (0.3 may be too lenient)
- Graceful frontend display for missing data (smooth, not broken-looking)
- Persist geocoding to DB for future map view
- Standardise field extraction across auction houses
- Better Gemini prompt tuning for low-coverage fields

## Context

- **Shipped v1.2** with +24,034 / -3,185 lines across 73 files. Major platform maturity leap.
- **Strategic pivot complete:** Free-first model live, Stripe hibernated, all AI features free after sign-in.
- **Budget:** £950 seed funding, ~£150/month burn (Claude Max £80 + Firecrawl £70). ~6 months runway.
- **~42 auction houses** with DOM extractors. Universal extraction harness + quality gate in place.
- **Resilience harness:** 9-module self-healing pipeline with circuit breakers, regression detection, auto-recovery.
- **AI-driven manager:** Wave-based concurrent pipeline orchestration with cost logging and budget tracking.
- **Enrichment pipeline live** — EPC (MHCLG) + flood risk (EA) + geocoding (Postcodes.io) with caching.
- **Field coverage gaps:** Beds ~51%, tenure ~67% — need improvement for competitor parity.
- **Image pipeline:** Multi-image carousel, junk detection, onerror fallbacks — but no scrape-time HTTP validation.
- **Geocoding:** Batch geocoding works but uses temporary `_lat`/`_lng` — not persisted to DB.
- **Competitor:** PropertyAuctions.io — 250+ auctioneers, clean consistent data, sold prices. Ahead on data quality.
- **Tier gating strategy v2:** Tool fully free, sign-in gates AI features for data capture.
- **Future lead model:** Broker pool/marketplace for regulated leads.
- **server.js is ~14,000+ lines** — monolith with lib/harness/ modules extracted in v1.2.

## Constraints

- **Budget:** £950 seed, ~£150/month burn — ~6 months runway. AI API costs must be minimized.
- **Budget:** Firecrawl monthly credit budget (default 15,000) — hash-based skip saves 50-70%
- **Hosting:** Railway with limited RAM — may need upgrade for free-tier traffic volume
- **Architecture:** Single server.js monolith — changes must not break existing functionality
- **Scraping:** Auction houses change their sites without notice — DOM extractors break regularly
- **Legal:** No scraping of data behind login walls; respect robots.txt on property portals
- **Stripe:** All Stripe code must be preserved (hibernated, not deleted) for future reactivation

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
| Pivot to free-first model | Maximize signups for lead gen, Stripe hibernated not deleted | — Pending — v1.2 |
| AI cost optimisation | £950 runway, need cheapest viable model for free access | — Pending — v1.2 |
| Analytics for lender pitch | Need MAU/funnel data to approach lenders at 500-1000 MAU | — Pending — v1.2 |

---
*Last updated: 2026-04-03 after v1.3 milestone start*
