# Research Summary: Bridgematch Auction Tool — Milestone v1.1

**Synthesized:** 2026-03-15
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

## Critical Course Corrections

### 1. Do NOT scrape Zoopla/Rightmove
Rightmove uses Cloudflare + session tokens + JS rendering; Zoopla aggressively bans scrapers. Both prohibit automated access in ToS. Projects have been shut down for this.

**Instead:** Use free public APIs for enrichment:
- **EPC ratings** — MHCLG open data API (free, no key needed)
- **Flood risk** — Environment Agency API (free)
- **Council tax band** — VOA API (free)
- **Land Registry comps** — already integrated
- **PropertyData.co.uk** — legitimate aggregator API (£28/mo for 2,000 credits) as premium supplement if needed

### 2. Fix broken existing code before adding features
- `calcSDLT()` uses pre-October 2024 rates (3% surcharge → should be 5%)
- `calcDealAnalysis()` is broken dead code with 5+ bugs
- Stripe `trial_used` flag set but never checked (unlimited trial abuse)
- Stripe webhooks have no event ID deduplication (idempotency risk)
- Downgrade on `subscription.deleted` is immediate, should honour `current_period_end`

### 3. Firecrawl optimisation is free
Switching from `rawHtml` to `['markdown', 'rawHtml']` costs zero additional credits and gives Gemini ~67% fewer tokens to process. Quick win for extraction quality.

## Stack Decisions

| Area | Recommendation | Confidence |
|------|---------------|------------|
| Enrichment data source | Free public APIs (EPC, flood, VOA) + Land Registry | High |
| Firecrawl format | Switch to markdown + rawHtml dual format | High |
| Deal stacking location | Frontend-only (client-side JS) | High |
| Lender data for deal stacking | Fetch from existing bridgematch.co.uk/api/lenders-lite | High |
| Alerting | Sentry rules + Resend email digest + webhook helper | High |
| Property portal scraping | DO NOT — use public APIs instead | Critical |

## Feature Priorities

### Table Stakes (close these gaps)
1. **Sold/unsold tracking** — every competitor shows this
2. **Image completeness** — #1 data quality issue
3. **EPC ratings** — free API, increasingly important for MEES 2025/26
4. **Data freshness defaults** — hide past auctions by default

### Differentiators (build moat)
1. **Deal stacking with live lender data** — genuinely unique, nobody else has this
2. **AI catalogue screening** — no competitor bulk-screens with investment scoring
3. **Free enrichment on all lots** — EPC + flood + comps layered on auction data
4. **Unsold lot scoring** — ~25-29% go unsold, no aggregator combines unsold tracking with scoring

### Anti-Features (don't build)
- General property portal — Rightmove owns this
- Portfolio management — Lendlord owns this
- Bidding platform — BidX1 owns this
- Full lender comparison — Brickflow owns this
- Gated directory data — EIG's paywall model is widely criticised

## Architecture Recommendations

1. **Enrichment must be async** — run post-upsert, batched by postcode, separate credit budget, lazy on-demand with 30-day cache
2. **Deal stacking is frontend-only** — `calcSDLT()` already client-side, port `matchLenders()` from bridgematch-lite.html, no new API endpoint needed
3. **Alerting uses existing stack** — Sentry (already imported), Resend (already used), fetch() for webhooks. 15-line `alertWebhook()` helper wired to failure points
4. **New code in new files** — server.js at ~9,750 lines. DOM extractors (3,000+ lines) can be extracted. New features should not bloat the monolith further.

## Build Order Recommendation

1. **Hardening** — Fix SDLT rates, Stripe vulnerabilities, broken calcDealAnalysis. Foundation must be solid.
2. **Data Freshness** — Sold tracking, past auction defaults, alerting on failures, Firecrawl markdown format switch
3. **Enrichment** — EPC + flood risk + VOA via free APIs, async pipeline with caching
4. **Auction House Expansion** — Add more houses with improved extraction quality (images focus)
5. **Deal Stacking MVP** — Frontend calculator with user inputs, auto SDLT + finance costs, full stack output
6. **Tier Verification** — End-to-end testing of all subscription flows

## Pricing Validation

£9.99/mo is well-positioned between DealSheet AI (£4.99/wk ≈ £20/mo) and PropMarker (£99.99/mo). More auction-specific value than either.

---
*Synthesized: 2026-03-15*
