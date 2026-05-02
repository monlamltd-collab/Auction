# CLAUDE.md — Bridgematch Auction Tool

## Project Overview

Bridgematch is a UK property auction directory and AI-powered catalogue analyser, live at [auctions.bridgematch.co.uk](https://auctions.bridgematch.co.uk). It scrapes upcoming auction catalogues from UK auction houses, uses Google Gemini AI to extract structured lot data, scores each lot for investment potential, and presents results in a filterable frontend.

**Owner:** Simon Deeming
**Repo:** `monlamltd-collab/Auction`
**Hosting:** Railway (Express server) — was originally Vercel but migrated
**Domain:** `auctions.bridgematch.co.uk` (the root `bridgematch.co.uk` serves the Bridging Finance tool)
**Stack:** Node.js (Express), Firecrawl (primary scraper) + Puppeteer (fallback), Google Gemini API (free tier), vanilla JS frontend

**Architecture map:** `docs/ARCHITECTURE.md` — file layout, data flow, tables, weakness audit. **Read that first** if you've just opened this codebase. This CLAUDE.md is conventions + gotchas; the architecture map is canonical.

---

## Architecture

```
server.js (Express, 428 lines — keep thin)
├── GET  /api/auctions        → Returns upcoming auction dates (curated list)
├── POST /api/analyse          → Scrapes catalogue URL, Gemini extracts lots, scores them
├── GET  /api/cost-monitor     → Firecrawl credit usage stats
├── POST /api/admin/calendar   → Add auction URLs (x-admin-secret auth)
├── GET  /auctions             → Serves index.html (directory view)
├── GET  /analyse              → Serves index.html (analyser view)
└── GET  /                     → Serves index.html

index.html (572 lines — thin shell, post Issue 8 split)
├── inline env-shim (window.__SUPABASE_URL__ etc — server substitutes at boot)
└── loads /public/styles.css + /public/app.js + /public/town-match.js

public/app.js (~4,680 lines — main frontend, extracted from index.html)
└── Auth, search, filters, render, admin UI

public/styles.css (~870 lines — design tokens + components)

admin.html
└── Admin dashboard — auction management, calendar, "Add Auction URL" form, backfill triggers

lib/fundability.js
└── Fundability Badge — maps lot data to BridgeMatch DealEssentials, calls /api/filter,
    caches results (1hr TTL, max 5000 entries). Exports: mapLotToDeal(), getFundabilityBadge(),
    enrichLotsWithFundability(), buildBridgematchUrl()

lib/os-places.js
└── OS Data Hub Places API client — UPRN + canonical address + lat/lng lookup
    on every first-contact lot. 90-day Supabase cache (os_places_cache),
    circuit breaker (3 fails → 10 min), 100ms rate limit. Exports: lookupAddress(),
    lookupByUprn(), getCircuitStatus()

lib/quality/field-source.js
└── Per-field provenance helper — setField(lot, field, value, source) writes
    the value AND stamps lot._fieldSources[field] = source. Persisted to the
    lots.field_sources JSONB column. Sparse by design — only new code paths use it.
```

### Phase A — First-Contact Maximisation (live)

When a brand-new lot URL is detected (`!existingMap.has(url)` in `lib/pipeline/persist-lots.js`),
the pipeline runs the kitchen-sink pass:
- Forced detail-page fetch (overrides `never-deep` profile, runs even when the
  catalogue card has every field — see `lib/scraper/lot-detail.js:fetchLotPage`)
- OS Data Hub Places API lookup → stamps UPRN, canonical address, lat/lng,
  classification code with `'os-places'` provenance
- Snapshot row written to `lot_history` for time-on-market analytics

New schema additions (see `migrations/2026-04-26-*.sql` and `schema.sql:380+`):

| Column / Table | Purpose |
|---|---|
| `lots.field_sources` JSONB | Per-field provenance — which source wrote each value |
| `lots.uprn` TEXT | Stable UK property identifier from OS Places |
| `lots.os_classification` TEXT | OS classification code (RD = residential, CR = retail, …) |
| `lots.property_key` TEXT (gen) | `lower(postcode)\|lower(addr-line-1)` fingerprint for cross-house dedup |
| `lot_history` table | Append-only price/status snapshots, idempotent via snapshot_hash |
| `os_places_cache` table | 90-day TTL cache of OS Places API responses, address-keyed |

### Key Dependencies
- `@google/generative-ai` — Gemini API for lot data extraction (free tier: 15 RPM, 1500 RPD)
- `jsdom` — DOM parsing for Firecrawl HTML (runs DOM extractors locally via `new Function('document', ...)`)
- `puppeteer` — Headless Chrome fallback for JS-rendered sites (conditional — Firecrawl is primary)
- `express` — HTTP server
- `@supabase/supabase-js` — Auth (for future features)

---

## How the Analyser Works

1. User pastes an auction catalogue URL or selects an auction house
2. Server fetches catalogue pages via Firecrawl (primary), Puppeteer (fallback), or HTTP (last resort) — `lib/scraper/rendering.js:scrapeRenderedPage`
3. DOM extractors parse the HTML (`lib/extractors/`); if they return <3 lots, the stripped HTML is sent to Gemini (Flash for known houses, Pro for unknown/PDF) with extraction instructions
4. DOM→Gemini merge: re-runs the DOM extractor on the original HTML and fills URL/imageUrl gaps in Gemini results by lot number
5. Server runs the **scoring engine** (`lib/pipeline/scoring.js:analyseLot`) on each lot
6. Results cached in `lots` table; `lot_history` snapshots written when fields change
7. Frontend (`public/app.js`) displays lots with filters (price, type, score, opportunities)

### Extraction Pipeline
- **Primary:** DOM extractors — custom per-house selectors that parse HTML directly via JSDOM
- **Fallback:** Gemini API extraction — when DOM extractors return < 3 lots, the stripped HTML is sent to Gemini with structured extraction prompts
- **DOM→Gemini merge:** When Gemini fallback is triggered, the DOM extractor is re-run on the raw HTML to harvest URLs and images, which are then merged into Gemini's lot data by lot number (with position-based fallback). This prevents the "cascading image loss" problem where Gemini extraction strips URLs/images from the HTML.
- **Models:** `gemini-2.5-flash-lite` for known houses (fast tier), `gemini-2.5-pro` for unknown houses and PDF extraction (capable tier). Defined in `lib/ai-provider.js`.
- **Rate limiting:** Configurable gap between calls via `GEMINI_MIN_GAP_MS` env var (default 100ms for paid tier; set to 4100 for free-tier-safe 15 RPM spacing)

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

Source of truth: `lib/pipeline/scoring.js:analyseLot()` (lines 114-151). Update the table below if you change the scorer.

| Signal | Score |
|---|---|
| Needs modernisation | +2.0 |
| Poor/derelict condition | +2.5 |
| Executor/probate | +1.5 |
| Receivership | +2.0 |
| Development potential (dwellings) | +2.0 |
| Development potential (land) | +0.5 |
| Extension/HMO potential | +1.5 |
| Vacant (house/bungalow/flat) | +1.0 |
| Freehold (house/bungalow) | +0.5 |
| Low £/sqft (<£200) | +2.0 |
| Mid-tier £/sqft (£200-300) | +1.0 |
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

### Currently Configured (~171 houses)
`lib/houses.js` exports 171 entries in `HOUSE_ROOTS`. 44 per-house DOM extractors live in `lib/extractors/houses/`, plus platform-family extractors (`lib/extractors/platforms/`) and a universal fallback (`lib/extractors/universal.js`). 8 detail-page extractors in `lib/extractors/detail/`. Houses without a custom extractor fall back to the universal extractor + Gemini AI. Health is tracked nightly via `scripts/audit.mjs`. Some houses that were previously failing were fixed by:
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

- **Mobile-first** responsive design
- **Design tokens are canonical in `public/styles.css:34-51`** — read that file rather than relying on this section staying in sync. Includes the `:root` block with all current colours and font choices.
- Use native HTML elements like `<details>/<summary>` for accordions — these are more reliable across browsers than JS-driven alternatives (learned the hard way)
- Avoid `overflow:hidden` on parent containers that need click events
- **Editing the frontend?** Edit `public/app.js` (JS) or `public/styles.css` (CSS), NOT inline in `index.html`. The env-shim block at `index.html:564-568` is the only inline JS that should remain — `server.js` does string substitution on it at startup.

---

## Known Issues & Gotchas

1. **Gemini rate limits** — Free tier is 15 RPM / 1500 RPD. Built-in rate limiter handles this, but large batch runs may hit daily limits
2. **Puppeteer memory** — Railway has limited RAM; use skip lists for houses that won't work anyway
3. **DOM extractor failures** — When a house redesigns their site, the DOM extractor breaks and falls back to Gemini API. The DOM→Gemini merge pattern mitigates URL/image loss during fallback.
4. **Cascading image loss** — If DOM extractor returns < 3 lots → Gemini fallback strips HTML → lots get empty URLs/images → backfill can't match. Fixed by DOM→Gemini merge but monitor image coverage for regressions.
5. **Firecrawl lazy-load images** — Firecrawl's `rawHtml` doesn't reliably capture lazy-loaded images. Mitigated with `executeJavascript` action + `images` format + two-pass backfill.
6. **Pagination** — handled in `lib/scraper/pagination.js` (`detectTotalPages`, `scrapeAllPages`, `buildPageUrl`) with per-house overrides via `lib/extractors/houses/`
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
| `ROLE` | Process role: `web` (HTTP only, no schedulers), `worker` (HTTP + schedulers, intended for the worker service when scaling beyond one instance), or unset (single-process default — both run together). |
| `SUPABASE_URL` | Supabase project URL (future auth) |
| `SUPABASE_ANON_KEY` | Supabase anon key (future auth) |
| `BRIDGEMATCH_API_URL` | BridgeMatch API base URL for fundability badge (default: `https://www.bridgematch.co.uk`) |
| `OS_DATA_HUB_KEY` | OS Data Hub Places API key — stamps UPRN + canonical address + lat/lng on first-contact lots (free tier 100k req/month) |
| `EPC_API_EMAIL` | EPC register API email (paired with `EPC_API_KEY`) |
| `EPC_API_KEY` | EPC register API key — fuels EPC enrichment + ?bedrooms backfill |
| `SUPABASE_SERVICE_KEY` | Service-role key for server-side DB writes (lots upsert, manifest, etc.) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token used by `lib/telegram.js` for self-healing REPORT messages. Optional — calls short-circuit gracefully if unset. |
| `TELEGRAM_CHAT_ID` | Destination chat for `lib/telegram.js`. Required alongside `TELEGRAM_BOT_TOKEN` for the auction-self-healing skill's REPORT phase to fire. |

---

## TODO / Roadmap

- [ ] Redesign auction frontend
- [ ] Connect more auction houses
- [x] Automated calendar scraping via cron — done (Tier 1-4 schedulers in `server.js:scheduleTick`)
- [ ] Email alerts when new catalogues drop
- [ ] Blog/content section for SEO
- [~] Land Registry comps integration — **partial**: street_avg + street_sales captured. Still missing: title number, ownership type, charges, deeper historical pulls
- [x] EPC rating lookups — done (`lib/enrichment.js`, EPC_API_KEY env var)
- [ ] **Integration with Bridgematch bridging finance tool** (see below) — fundability badge live; deeper deal-stack flow still outstanding
- [ ] Score transparency in the UI — show breakdown per signal, optionally per-user weights
- [ ] AI search reconsideration — measure whether it's helping or whether modified-scoring filters would do better

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

## Skills

Two skills exist in `.claude/skills/`:
- `auction-conventions` — invoke before any code edits (architecture, naming, file structure, API patterns, scoring rules, DOM extractor conventions, manifest stamping, harness alert signature)
- `auction-self-healing` — invoke when a house returns 0 lots or you suspect breakage; full diagnose-classify-fix-verify-report playbook

Operational rules to remember when working in any area:
- **Score range 0-10**, always clamped (`Math.max(0, Math.min(10, ...))`)
- **Firecrawl primary, Puppeteer fallback, HTTP last** — never reverse the order
- **Silent failures banned** — every skipped/failed lookup records a reason in `lots.enrichment_manifest`
- **Manifest gating on yield + below-market** to prevent double-counting in scoring (`canScoreYield` / `canScoreBelowMarket`)
- **`lib/scoring.js` was deleted** — never reintroduce; use `lib/pipeline/scoring.js::analyseLot`
- **Harness alerts** use the single-object signature: `fireAlert({ type, severity, house, message, meta })`
- **Don't reintroduce the `server.js` monolith** — logic lives in `routes/`, `lib/`, `lib/pipeline/`, `lib/harness/`
