# Bridgematch Auction Tool

## What This Is

A UK property auction directory and AI-powered catalogue analyser, live at auctions.bridgematch.co.uk. Scrapes upcoming auction catalogues from ~21 UK auction houses, uses Google Gemini AI to extract structured lot data, scores each lot for investment potential, and presents results in a filterable frontend. Includes Bridgematch Lite — an investor-facing bridging finance matching tool that shows how many lenders would fund each deal.

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
- ✓ SDLT calculator (investor rates 2025/26) — existing
- ✓ Basic deal analysis function (calcDealAnalysis) — existing
- ✓ Image extraction pipeline (DOM → Firecrawl images → executeJavascript → two-pass backfill) — existing
- ✓ ~21 auction houses with DOM extractors — existing
- ✓ Tenure extraction from catalogues — existing

### Active

<!-- This milestone's scope -->

- [ ] Default frontend to future-only auctions (hide past catalogues by default)
- [ ] Improve sold/unsold detection reliability across auction houses
- [ ] Alerting when auto-analyse fails or discovery misses catalogues
- [ ] Improve lot image coverage — biggest data quality gap currently
- [ ] Better leverage Firecrawl's structured output capabilities (markdown, metadata, not just raw HTML)
- [ ] Firecrawl-powered enrichment via Zoopla/Rightmove (comps, rental estimates, sold prices) — supplements existing Land Registry data, available to all users
- [ ] Add more auction houses to expand directory coverage
- [ ] Verify subscription tier flows end-to-end (trial expiry, downgrade, resubscribe edge cases)
- [ ] Deal stacking calculator MVP — user inputs GDV, works cost, legal costs, expected rental; tool calculates SDLT + finance costs from Bridgematch lender data; outputs full investment stack (total cost in, profit, ROI, cash-on-cash)
- [ ] Wire up "Coming Soon" premium features (Yield Analysis, Comparables, Deal Stacking UI)

### Out of Scope

- Frontend redesign — future milestone
- Email alerts for new catalogues — future milestone
- Blog/content section for SEO — future milestone
- Full Bridgematch integration (auto-finance per lot) — future milestone
- Branding split (AuctionBrain vs Bridgematch) — future consideration
- EPC rating lookups — future milestone
- Automated calendar scraping via cron — partially exists via discovery, full automation deferred

## Context

- **Firecrawl is underutilised** — currently used mainly for raw HTML, but its USP is LLM-ready structured data. Should be leveraged for better image capture, metadata extraction, and property research enrichment.
- **Missing images are the #1 data quality issue** — lots without photos look unprofessional and reduce user trust.
- **Enrichment strategy:** Land Registry provides sold prices and basic comps. Firecrawl can supplement with Zoopla/Rightmove data (rental estimates, market context, recent sales). Enrichment data is free for all users — upgrade case comes from AI analysis and deal stacking.
- **Tier gating strategy:** Directory data always free, only AI features gated (per memory: `project_tier_strategy.md`).
- **Future lead model:** Broker pool/marketplace for regulated leads (per memory: `project_broker_marketplace.md`).
- **server.js is ~9,750 lines** — monolith containing all backend logic. No immediate plans to split.
- **Gemini free tier limits:** 15 RPM, 1500 RPD — rate limiter built in.
- **Firecrawl credit management:** Monthly budget cap, auto-exhaustion detection, hash-based skip saves ~50-70%.

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
| Gemini free tier | Sufficient for current volume, avoids cost | ✓ Good — monitor as houses expand |
| Directory data always free | Drives traffic and trust, gates only AI features | — Pending |
| Lender names always masked | Generates broker leads, not direct lender access | ✓ Good |
| Enrichment free for all users | Lifts overall product quality, upgrade case via deal stacking instead | — Pending |
| Deal stacking: SDLT + finance auto-calculated | Deterministic from purchase price and lender data | — Pending |
| Deal stacking: GDV, works, legal, rental = user input | These are assumptions the investor must provide | — Pending |

---
*Last updated: 2026-03-15 after initialization*
