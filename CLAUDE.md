# CLAUDE.md — Bridgematch Auction Tool

## Project Overview

Bridgematch is a UK property auction directory and AI-powered catalogue analyser, live at [auctions.bridgematch.co.uk](https://auctions.bridgematch.co.uk). It scrapes upcoming auction catalogues from UK auction houses, uses Google Gemini AI to extract structured lot data, scores each lot for investment potential, and presents results in a filterable frontend.

**Owner:** Simon Deeming
**Repo:** `monlamltd-collab/Auction`
**Hosting:** Railway (Express server) — was originally Vercel but migrated
**Domain:** `auctions.bridgematch.co.uk` (the root `bridgematch.co.uk` serves the Bridging Finance tool)
**Stack:** Node.js (Express), Firecrawl (primary scraper) + Puppeteer (fallback), Google Gemini API (free tier), vanilla JS frontend

---

## Architecture

```
server.js (Express, ~131K)
├── GET  /api/auctions        → Returns upcoming auction dates (curated list)
├── POST /api/analyse          → Scrapes catalogue URL, Gemini extracts lots, scores them
├── GET  /api/cost-monitor     → Firecrawl credit usage stats
├── POST /api/admin/calendar   → Add auction URLs (x-admin-secret auth)
├── GET  /auctions             → Serves index.html (directory view)
├── GET  /analyse              → Serves index.html (analyser view)
└── GET  /                     → Serves index.html

script.js (~105K)
└── Frontend JS — handles UI, filtering, lot display, analysis triggers

index.html (~79K)
└── Single-page app with tab switching between /auctions and /analyse views

admin.html
└── Admin dashboard — auction management, calendar, "Add Auction URL" form, backfill triggers

lib/fundability.js
└── Fundability Badge — maps lot data to BridgeMatch DealEssentials, calls /api/filter,
    caches results (1hr TTL, max 5000 entries). Exports: mapLotToDeal(), getFundabilityBadge(),
    enrichLotsWithFundability(), buildBridgematchUrl()
```

### Key Dependencies
- `@google/generative-ai` — Gemini API for lot data extraction (free tier: 15 RPM, 1500 RPD)
- `jsdom` — DOM parsing for Firecrawl HTML (runs DOM extractors locally via `new Function('document', ...)`)
- `puppeteer` — Headless Chrome fallback for JS-rendered sites (conditional — Firecrawl is primary)
- `express` — HTTP server
- `@supabase/supabase-js` — Auth (for future features)

---

## How the Analyser Works

1. User pastes an auction catalogue URL or selects an auction house
2. Server fetches catalogue pages (direct HTTP or Puppeteer for JS-rendered sites)
3. Each page's HTML is stripped and sent to Gemini (Flash for known houses, Pro for unknown/PDF) with extraction instructions
4. Gemini returns structured lot data as JSON
5. Server runs the **scoring engine** on each lot
6. Results cached in memory/database per auction house
7. Frontend displays lots with filters (price, type, score, opportunities)

### Extraction Pipeline
- **Primary:** DOM extractors — custom per-house selectors that parse HTML directly via JSDOM
- **Fallback:** Gemini API extraction — when DOM extractors return < 3 lots, the stripped HTML is sent to Gemini with structured extraction prompts
- **DOM→Gemini merge:** When Gemini fallback is triggered, the DOM extractor is re-run on the raw HTML to harvest URLs and images, which are then merged into Gemini's lot data by lot number (with position-based fallback). This prevents the "cascading image loss" problem where Gemini extraction strips URLs/images from the HTML.
- **Models:** `gemini-2.5-flash-lite` for known houses (fast tier), `gemini-2.5-pro` for unknown houses and PDF extraction (capable tier). Defined in `lib/ai-provider.js`.
- **Rate limiting:** Built-in 4.1s gap between calls to stay under Gemini free tier 15 RPM limit

### Image Extraction Pipeline
Images are extracted through multiple strategies in priority order:
1. **DOM extractors** — per-house selectors extract `imageUrl` directly from HTML
2. **Firecrawl `images` format** — returns all image URLs from the rendered page alongside `rawHtml`
3. **Firecrawl `executeJavascript`** — forces `data-src`/`data-lazy-src` → `src` swap to trigger lazy-loaded images before capture
4. **Two-pass backfill** — for lots still missing images after extraction:
   - Pass 1: `backfillImagesWithFirecrawl()` — fetches catalogue page, extracts images via JSDOM + Firecrawl images array, matches by lot number/URL/address/position
   - Pass 2: `backfillImagesWithPuppeteer()` — Puppeteer fallback for remaining misses (houses in `PUPPETEER_IMAGE_HOUSES`)
5. **Matching strategies** (in `extractWithJSDOM` and backfill): lot number in URL path → URL path overlap → address keyword → position-based (nth image = nth lot)

### Scraping Architecture (Three-Tier Fallback)
1. **Firecrawl** (primary) — Managed scraping API (`scrapeWithFirecrawl()`). Handles JS rendering, anti-bot, proxy rotation. Returns raw HTML which is parsed locally with JSDOM (`extractWithJSDOM()`). Controlled by `FIRECRAWL_API_KEY` env var.
2. **Puppeteer** (fallback) — Headless Chrome via `acquirePage()`. Used when Firecrawl is unavailable, credits exhausted, or house is in `FIRECRAWL_SKIP`. Puppeteer import is conditional — server works without it.
3. **Plain HTTP** (last resort) — `fetchPage()` for static HTML pages.

Key functions:
- `scrapeRenderedPage(url, house)` — Orchestrates the three-tier fallback, includes scroll actions + `executeJavascript` for lazy images
- `extractWithJSDOM(html, house, baseUrl, firecrawlImages)` — Runs DOM extractors in JSDOM, matches Firecrawl images to lots
- `scrapePageWithFirecrawl(url, house)` — Multi-page wrapper with pagination
- `backfillImagesWithFirecrawl(url, lots, house)` — Image backfill via rendered page + JSDOM extraction
- `backfillImagesWithPuppeteer(url, lots, house)` — Puppeteer fallback for image backfill
- `fetchLotPage(url)` — Smart lot-page fetcher: plain HTTP first, auto-escalates to Firecrawl if page appears JS-rendered (<500 chars visible text). Used by all three backfill functions (images, address, tenure)
- `healBrokenHouse(slug, oldUrl)` — Self-healing: finds replacement catalogue URLs when a house returns 0 lots

### Firecrawl-Powered Change Detection
- `autoAnalyseOne()` probes each catalogue URL with Firecrawl before full scrape
- Hashes the rendered HTML (not the JS shell) for accurate change detection
- If content hash matches cached version → extends cache TTL without re-scraping (saves full scrape cost)
- Falls back to plain HTTP probe if Firecrawl unavailable

### Firecrawl Credit Management
- Monthly budget cap via `FIRECRAWL_MONTHLY_BUDGET` env var (default 15000)
- Auto-exhaustion detection on 402/429 responses → falls back to Puppeteer
- 3 consecutive 5xx → marks temporarily down for 10min
- Credit exhaustion auto-clears after 1 hour
- Hash-based skip in `autoAnalyseOne()` saves ~50-70% of credits
- Per-house skip via `FIRECRAWL_SKIP_HOUSES` env var
- Stats visible at `/api/cost-monitor`

### Self-Healing Discovery
When a house that previously had lots returns 0, the system automatically attempts to find the new catalogue URL:
1. **Inline healing** — triggered immediately in `autoAnalyseOne()` when 0-lot regression detected
2. **Sweep healing** — runs at the end of `autoAnalyseAll()`, checks all unresolved `extractor_regression` alerts
3. **Manual healing** — `POST /api/admin/heal` with `{ slug }` to trigger healing, or omit slug to view status

**Healing process** (`healBrokenHouse()`):
- Extracts base domain from `HOUSE_ROOTS`
- Scrapes homepage with Firecrawl (falls back to plain fetch)
- Also scrapes the root URL if different from homepage
- Asks Gemini (capable tier) to find the new catalogue URL
- Verifies new URL is reachable via Firecrawl before committing
- Updates in-memory `HOUSE_ROOTS` + Supabase `auction_calendar`
- Records `url_healed` or `healing_failed` pipeline alert

**Cooldown**: Exponential backoff (24h → 48h → 96h, max 7 days) per house to avoid wasting credits on permanently broken houses.

**Cost per heal attempt**: ~1-3 Firecrawl credits + 1 Gemini capable call

**Discovery upgrade**: `discoverAndUpdateCalendar()` now uses Firecrawl instead of plain `fetch()` for root page scraping, with plain HTTP fallback.

### Rollback
- **Instant**: Remove `FIRECRAWL_API_KEY` from env → all paths use Puppeteer
- **Per-house**: Add slug to `FIRECRAWL_SKIP_HOUSES` env var
- Puppeteer remains in `package.json` and Dockerfile throughout

---

## Scoring System

Each lot gets an investment score based on detected signals:

| Signal | Score |
|---|---|
| Needs modernisation | +2.0 |
| Poor/derelict condition | +2.5 |
| Executor/probate | +1.5 |
| Receivership/distressed | +2.0 |
| Development potential | +2.0 |
| Extension/HMO potential | +1.5 |
| Vacant (residential) | +1.0 |
| Freehold house | +0.5 |
| Low £/sqft (<£200) | +2.0 |
| Good yield (6-8% GIY) | +1.5 |
| High yield (>8% GIY) | +2.5 |
| Quick completion | +0.5 |
| Motivated seller | +0.5 |
| Title split potential | +1.0 |
| Sitting tenant | -2.0 |
| Knotweed | -2.0 |
| Flying freehold | -1.0 |
| Non-standard construction | -1.0 |
| Flood risk | -1.0 |
| Contamination | -1.0 |

Title split detection covers 7 pattern types. Budget filtering has separate limits for standard vs title split deals.

---

## Self-Healing Harness (`lib/harness/`)

The harness is the pipeline orchestration and quality assurance layer. It runs during `autoAnalyseAll()` and manages house health, data quality, and self-healing.

### Components

| File | Size | Purpose |
|------|------|---------|
| `manager.js` | 23.8KB | Orchestrates all harness components — entry point for pipeline runs |
| `alert-router.js` | 3.9KB | Pipeline alerts + resolution tracking (e.g. `extractor_regression`, `url_healed`) |
| `house-health.js` | 8.7KB | Per-house health tracking + circuit breakers (consecutive failures → auto-skip) |
| `quality-gate.js` | 3.2KB | Pass/fail criteria for batches (minimum lot count, field coverage thresholds) |
| `regression-detector.js` | 3.5KB | Detects 0-lot regressions vs previous successful scrape |
| `extractor-generator.js` | 11.6KB | AI-powered DOM extractor generation (Gemini creates selectors from HTML) |
| `house-discovery.js` | 9.6KB | Automatic new auction house discovery via web search |
| `data-contract.js` | 8.9KB | Schema validation + lot quality scoring (field completeness, data integrity) |
| `enrichment-engine.js` | 6.7KB | EPC/flood/Land Registry/image coverage enrichment orchestration |
| `sub-agents.js` | 10KB | Data quality audits + calendar staleness checks |

### How They Fit Together

```
manager.js
├── house-health.js      → Should we scrape this house? (circuit breaker check)
├── regression-detector.js → Did we get fewer lots than last time?
│   └── alert-router.js   → Log the regression alert
├── quality-gate.js       → Did the batch pass quality checks?
├── data-contract.js      → Are the lot fields valid and complete?
├── enrichment-engine.js  → Backfill EPC/flood/LR/images
├── extractor-generator.js → Generate new DOM extractor if needed
├── house-discovery.js    → Find new auction houses to add
└── sub-agents.js         → Periodic audits and staleness checks
```

### Key Patterns

- **Circuit breakers** (`house-health.js`): 3 consecutive failures → house is auto-skipped for increasing cooldown periods
- **Alert lifecycle** (`alert-router.js`): `opened` → `acknowledged` → `resolved` (or `auto_resolved`)
- **Regression detection** (`regression-detector.js`): Compares current lot count against last successful scrape; 0 lots triggers healing
- **Quality gates** (`quality-gate.js`): Minimum 3 lots per house, minimum 60% field coverage for core fields (address, price)

---

## Auction Houses

### Currently Working (~21 houses, ~2,364 lots)
The system successfully scrapes and analyses lots from 21 auction houses. Some houses that were previously failing were fixed by:
- **BidX1** (90 lots) — DOM extraction fix
- **Edward Mellor** (24 lots) — DOM extraction fix
- **Bradley Hall** — URL moved to `auction.bradleyhall.co.uk`
- **Landwood** — Uses different domain `landwoodpropertyauctions.com`

### Summary Statistics (displayed as green badges)
- Total lots
- Lots under £100k
- Average yield percentage
- Properties with development potential
- Vacant properties

These are computed from lot data fields: `price`, `estGrossYield`, `opportunities` array, `vacant` boolean.

### Problem Houses
- Some block scraping requests entirely
- Some use JS-only rendering that even Puppeteer can't handle
- Some have catalogue timing issues (no current catalogue available)
- These are on the skip list to save memory/time

---

## Frontend Design

- **Light theme** — clean, professional look (distinct from Bridging Brain's dark theme)
- **Mobile-first** responsive design
- Colour palette:
  - Backgrounds: `--bg-primary: #f5f7fa`, `--bg-secondary: #ffffff`, `--bg-card: #eef2f7`
  - Accent: `--accent: #2e7d32` (forest green), `--accent-match: #4a9e2f`, `--accent-hover: #1b5e20`
  - Status: `--accent-warn: #e67e22` (orange), `--accent-danger: #c0392b` (red), `--accent-info: #2e86c1` (blue)
  - Text: `--text: #1a2a3a` (dark navy), `--text-muted: #6b7c8d`
  - Navy header gradient: `linear-gradient(135deg, #1a3a5c, #2a5a8c)`
  - Brand colours: "Bridge" in white, "Match" in `#8bc34a` (light green)
- Fonts: `--font-main: 'Outfit'`, `--font-brand: 'Sora'`, `--font-mono: 'JetBrains Mono'`
- Use native HTML elements like `<details>/<summary>` for accordions — these are more reliable across browsers than JS-driven alternatives (learned the hard way)
- Avoid `overflow:hidden` on parent containers that need click events

---

## Known Issues & Gotchas

1. **Gemini rate limits** — Free tier is 15 RPM / 1500 RPD. Built-in rate limiter handles this, but large batch runs may hit daily limits
2. **Puppeteer memory** — Railway has limited RAM; use skip lists for houses that won't work anyway
3. **DOM extractor failures** — When a house redesigns their site, the DOM extractor breaks and falls back to Gemini API. The DOM→Gemini merge pattern mitigates URL/image loss during fallback.
4. **Cascading image loss** — If DOM extractor returns < 3 lots → Gemini fallback strips HTML → lots get empty URLs/images → backfill can't match. Fixed by DOM→Gemini merge but monitor image coverage for regressions.
5. **Firecrawl lazy-load images** — Firecrawl's `rawHtml` doesn't reliably capture lazy-loaded images. Mitigated with `executeJavascript` action + `images` format + two-pass backfill.
6. **Pagination** — Each auction house has different pagination patterns; these are handled per-house in server.js
7. ~~**vercel.json still present**~~ — **RESOLVED**: Deleted (was legacy Vercel config, now on Railway)
8. ~~**`/api/diag` endpoint**~~ — **RESOLVED**: Deleted (was temporary debugging endpoint)

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key for lot extraction (free tier) |
| `FIRECRAWL_API_KEY` | Firecrawl API key for managed scraping (primary scraper) |
| `FIRECRAWL_MONTHLY_BUDGET` | Credit cap per month (default 15000) |
| `FIRECRAWL_SKIP_HOUSES` | Comma-separated house slugs to skip Firecrawl for |
| `FIRECRAWL_MIN_GAP_MS` | Min gap between Firecrawl calls in ms (default 300) |
| `PORT` | Server port (Railway sets this) |
| `SUPABASE_URL` | Supabase project URL (future auth) |
| `SUPABASE_ANON_KEY` | Supabase anon key (future auth) |
| `BRIDGEMATCH_API_URL` | BridgeMatch API base URL for fundability badge (default: `https://www.bridgematch.co.uk`) |

---

## TODO / Roadmap

- [ ] Redesign auction frontend
- [ ] Connect more auction houses
- [ ] Automated calendar scraping via cron
- [ ] Email alerts when new catalogues drop
- [ ] Blog/content section for SEO
- [ ] Land Registry comps integration
- [ ] EPC rating lookups
- [ ] **Integration with Bridgematch bridging finance tool** (see below)

---

## Sister Project: Bridgematch (Bridging Brain)

**Repo:** `monlamltd-collab/Bridging-Brain`
**What it does:** A bridging finance matching tool that takes a property deal's parameters and matches it against a proprietary database of ~50+ UK bridging lenders, showing which lenders will fund the deal and on what terms.

### Why This Matters for the Auction Tool
The ultimate vision is an **end-to-end pipeline**: the auction scraper identifies investment opportunities, and the bridging tool automatically shows how each lot could be funded. This is the key competitive advantage over Brickflow and Broka — neither combines auction analysis with finance matching.

### Bridgematch Lite / Bridgematch Investor
The file `bridgematch-lite.html` in this repo is the **investor-facing version** of the full Bridgematch bridging finance tool. It's a simplified deal analyser that runs the lender matching engine against a deal's parameters. This is distinct from the full broker-focused Bridgematch tool (in the Bridging-Brain repo) which has more detailed lender output and admin features.

### Integration Points
- **Lot data → Deal parameters:** Each auction lot has price, estimated yield, condition, property type — these map directly to the bridging tool's input fields (purchase price, GDV, works cost, property type)
- **Fundability scoring:** The bridging tool could add a "fundability" badge to each lot showing how many lenders would fund it and at what LTV
- **Domain:** Both will eventually be accessible via bridgematch.co.uk routes

### Branding (Evolving)
Current branding is everything under "Bridgematch" but this may split into:
- **AuctionBrain** — the auction catalogue scraper/analyser (this project)
- **Bridgematch** — the bridging finance matching tool (Bridging-Brain repo)

This is a future consideration — for now both live under bridgematch.co.uk, but keep branding loosely coupled so it's easy to rename later. The auction frontend already uses "BridgeMatch" with the green "Match" text as its brand mark.

### Design Language
- **Auction tool** (`index.html`): Light theme, forest green `#2e7d32`, navy gradient header, Outfit/Sora fonts
- **Bridgematch Lite / Investor** (`bridgematch-lite.html`): Warm cream `#faf8f4`, green `#0f8a5f`, Outfit font — based on the full Bridgematch tool's design
- **Deal Analyser** (standalone HTML, built in Claude Chat): Dark theme `#0c1220`, emerald `#10b981`, DM Sans — may or may not be used going forward
- Design language may converge as the products mature and branding is finalised

### Bridgematch Technical Context (for integration)
- **Backend:** Python FastAPI (`main.py`, ~155K)
- **Lender database:** SQLite with ~50+ lenders, each with detailed criteria columns (day-1 advance rates, interest rates, max LTV, max LTGDV, property types, geographic restrictions, works funding model, etc.)
- **Matching logic:** Per-lender LTGDV calculation that accounts for each lender's specific funding model:
  - **Upfront** (e.g., MS Lending at 85% gross, Mint at 90% gross) — works funded upfront as part of day-1 advance
  - **In arrears / tranched** (e.g., Octane at 75% net day-one plus staged works) — works released against progress
  - **Self-fund** — no works funding, borrower funds all refurb costs
- **Key calculation insight:** LTGDV must be calculated per-lender based on actual debt exposure (day-1 loan + rolled-up interest + lender-funded works) / GDV — NOT using purchase price, which was a previous bug that unfairly penalised deals
- **Frontend:** Single-page HTML apps (`index.html` for broker tool, `bridgematch-lite.html` for investor-facing version)

### IP & Competition
- Competitive advantage comes from trade secrets and the proprietary lender database, not patents
- Business methods alone aren't easily patentable in the UK
- Key competitors: Brickflow, Broka — neither has auction integration
- Marketing strategy: position Simon as a fellow investor who built useful tools, not a company selling products

---

## Appendix: Bridging Finance Domain Knowledge

See `BRIDGING_FINANCE_KNOWLEDGE_PACK.md` in this repo for comprehensive domain knowledge covering:
- Gross vs Net LTV calculations and why they matter
- Valuation basis hierarchy (MV vs 180-day vs 90-day) and impact on effective advance
- LTGDV formula (per-lender, not project-level) and the critical bug that was fixed
- The three funding models (upfront, arrears/staged, self-fund) and their cash flow implications
- Works intensity bands (light/medium/heavy/very heavy) and how they map to lender criteria
- Knockout rules and deal appetite scoring
- Lender ranking logic
- Property type → LTV column mapping
- Common auction + bridging scenarios

**Do not modify bridgematch-lite.html based on this knowledge right now** — it works. This appendix exists so future enhancements are built on correct domain logic rather than guesswork.

---

## Agent Skills Reference

Each agent listed below owns specific parts of the codebase. Before making changes, Claude Code should identify which agent's domain is affected and apply the relevant skills. Gaps or issues discovered should be noted.

### DevOps Agent
Owns: autoAnalyseAll(), caching layer, Puppeteer orchestration, Railway config
Must check before changes:
- Pagination caps (MAX_PUPPETEER_PAGES, MAX_LOTS_PER_SCRAPE)
- Lookahead limit (max 2 upcoming auctions per house)
- Credit exhaustion guard (creditExhausted flag)
- HTML change detection (contentHash comparison)
- Tiered cache TTLs (CACHE_TIERS)
- Puppeteer skip list (PUPPETEER_SKIP)
- Rate limit awareness (Gemini free tier: 15 RPM, 1500 RPD)

### Frontend Agent
Owns: index.html, welcome.html, all CSS and client-side JS
Must check before changes:
- Page load performance: lots per page should be configurable, default ≤ 100
- Pagination UX: user should never wait for more than 100 lots to render
- Lazy loading: images must lazy load
- Filter/sort state: preserved across pagination
- Mobile responsiveness: test at 375px width
- SEO: meta title, description, OG tags, JSON-LD structured data per page
- Lighthouse score awareness: flag anything scoring below 70
- Design system: use existing CSS variables, do not introduce new colour values

### Auction House Recruiter Agent
Owns: DOM_EXTRACTORS object, HOUSE_ROOTS, detectAuctionHouse()
Must check before changes:
- DOM extractor returns > 0 lots on a live test before committing
- Pagination detection: does the house paginate? How many pages?
- Skip list: if extractor consistently returns 0, add to PUPPETEER_SKIP
- Image URL extraction: at least one image URL per lot where available
- Lot deduplication: no duplicate lot numbers in output
- Fallback awareness: broken DOM extractor = Gemini API fallback (free but rate-limited)

### AI Extraction Agent
Owns: extractLotsWithAI(), callGemini(), batch logic, prompt templates
Must check before changes:
- Batch size: keep batches to ≤ 3 pages or ≤ 21000 chars
- Model: use gemini-2.5-flash-lite for known houses (fast tier), gemini-2.5-pro for unknown/PDF (capable tier)
- Rate limit guard: check creditExhausted flag before every batch (triggers on 429 / quota errors)
- Structured output: validate response has expected lot fields before caching
- Rate limiting: callGemini() enforces 4.1s gap between calls (15 RPM safe margin)

### Property Data Manager Agent
Owns: enrichLots(), Land Registry calls, VOA calls, scoring logic
Must check before changes:
- Address normalisation before Land Registry lookup
- Title split detection: false positive rate should stay below 5%
- Yield calculation: uses guide price, not sold price
- Score capping: score range 0-10, never exceed
- EPC lookups: only call if not already cached
- Fundability badge: mapLotToDeal() maps propType/condition/price to BridgeMatch DealEssentials. Cache key is price+type+refurb. Never blocks analysis pipeline.

### DI Manager (coordination)
Reviews output of all other agents. Produces weekly quality report covering:
- Houses with 0 lots (extractor broken)
- Houses where Gemini API fallback triggered > 3 times consecutively
- Image coverage rate (target > 70%)
- Cache hit rate (target > 60%)
- Gemini API daily request count vs 1500 RPD free tier limit
