# Architecture

## Overall Pattern

Bridgematch Auction is a **server-side monolith** built on Node.js/Express. A single file, `server.js` (~9,750 lines), contains all backend logic: HTTP routing, scraping orchestration, AI extraction, scoring, caching, auth, payments, and scheduled tasks. The frontend is a set of static HTML files served by the same Express process.

There is a vestigial `api/` directory from a prior Vercel deployment, but these files are **not used in production**. The live system runs entirely through `server.js` on Railway.

**Hosting:** Railway (Docker container with optional Chromium for Puppeteer)
**Database:** Supabase (PostgreSQL via `@supabase/supabase-js`)
**AI:** Google Gemini API (free tier) for lot extraction and smart search
**Scraping:** Firecrawl (primary), Puppeteer (fallback), plain HTTP (last resort)
**Payments:** Stripe (subscriptions + webhooks)
**Email:** Resend API
**Error tracking:** Sentry

---

## Layers and Responsibilities

### 1. HTTP / Middleware Layer (lines 1-200)
- Express app setup, CORS, security headers (CSP, HSTS, X-Frame-Options)
- CSRF origin validation for state-changing requests
- Stripe raw body handling (must precede `express.json()`)
- Structured JSON logging middleware
- Trust proxy configuration for Railway's reverse proxy

### 2. Auth Layer (lines 130-170, 1530-1650)
- Supabase JWT verification (ES256 via JWKS, HS256 fallback)
- `validateUserFromReq()` resolves Bearer tokens to user records
- Auto-linking: first JWT login links to existing user by email
- Auto-provisioning: new JWT users get 14-day Pro trial
- Legacy session_token fallback for migration period
- Tier-based gating: free users see blurred data after first 6 lots

### 3. Rate Limiting Layer (lines 982-1007)
- In-memory IP-based rate limiter (`rateLimit(windowMs, maxHits)`)
- Applied per-route as Express middleware
- Stale bucket cleanup every 5 minutes
- Supabase-backed rate limits for `/api/analyse` (daily IP cap)

### 4. Scraping Layer (lines 249-460, 4358-4658)
Three-tier fallback architecture:
1. **Firecrawl** (`scrapeWithFirecrawl()`) -- managed API with JS rendering, anti-bot, proxy rotation
2. **Puppeteer** (`scrapeWithPuppeteer()`) -- headless Chromium, conditional import
3. **Plain HTTP** (`fetchPage()`) -- direct `fetch()` for static HTML

Orchestrated by `scrapeRenderedPage(url, house)` which cascades through the tiers. Credit management tracks Firecrawl usage with monthly budget caps and auto-exhaustion detection.

### 5. Extraction Layer (lines 4660-4860)
Two extraction strategies per auction house:
1. **DOM Extractors** (`DOM_EXTRACTORS` object, lines 4862+) -- per-house JavaScript snippets that run inside JSDOM to parse lot data directly from HTML. ~40+ houses have custom extractors plus shared templates (`eigplatform`, `auctionhouseuk`).
2. **Gemini AI Extraction** (`extractLotsWithAI()`) -- fallback when DOM extractors return < 3 lots. Sends stripped HTML to Gemini with structured extraction prompts. Batches of 3 pages, 4.1s rate limit gap.
3. **PDF Extraction** (`extractLotsFromPdf()`) -- downloads PDF, sends as base64 to Gemini Pro for lot extraction.

DOM-to-Gemini merge pattern: when Gemini fallback triggers, DOM extractors still run to harvest URLs/images, which are merged into Gemini results by lot number.

### 6. Scoring & Enrichment Layer (lines 8670-8760, plus `analyseLot()` in `api/analyse.js`)
- `analyseLot()` -- signal-based scoring engine. Scans lot text for patterns (condition, executor/probate, development potential, yield, etc.) and assigns weighted scores (range 0-10).
- `enrichLots()` -- Land Registry queries by postcode for comparable sales, street average pricing, below-market detection. Rental yield estimation. Score adjustments based on market data.
- Title split detection (7 pattern types) for multi-unit freehold properties.

### 7. Caching Layer
- **Supabase `cached_analyses`** table stores analysis results per catalogue URL
- Tiered TTLs: high-traffic houses (12h), medium (18h), low (24h)
- Content hash (`contentHash`) comparison to detect catalogue changes without re-extracting
- Hash hit tracking saves 50-70% of Firecrawl credits

### 8. Smart Search Layer (lines 2931-3352)
- Natural language search across all cached lots via Gemini
- Supabase `smart_search_cache` table with 1-hour TTL
- Stale URL tracking: when a catalogue is re-scraped, affected search cache entries are marked stale
- Tier-gated: anonymous (3/day), free (10/day), premium (unlimited)

### 9. Scheduled Tasks (lines 8808-8836)
Configured at `app.listen()` startup:
- `autoAnalyseAll()` -- runs 30s after startup, then every 6 hours. Discovers new catalogues, analyses all catalogue-ready auctions, backfills images.
- `saveDailySnapshot()` -- midnight analytics snapshot (lots, image coverage, house health).
- `syncCalendarAndHouseNames()` -- 5s after startup. Upserts fallback calendar to Supabase, fixes stale house names, purges past-date entries.
- Credit exhaustion auto-clear every 5 minutes (1h TTL for Gemini, 10min for Firecrawl).

---

## Data Flow

### User-Initiated Analysis (`POST /api/analyse`)
```
Browser
  -> POST /api/analyse { url, budget }
  -> CSRF check -> JWT auth -> rate limit check
  -> validateUrl() (SSRF prevention)
  -> detectAuctionHouse(url)
  -> Check Supabase cached_analyses for fresh cache
     -> If cache hit: return cached lots
     -> If cache miss:
        -> scrapeRenderedPage(url, house) [Firecrawl -> Puppeteer -> HTTP]
        -> extractWithJSDOM(html, house) [DOM extractors]
        -> If < 3 lots: extractLotsWithAI(pages, house) [Gemini fallback]
        -> analyseLot() on each lot [scoring]
        -> enrichLots() [Land Registry, yield estimates]
        -> Image backfill pipeline (HTTP -> Firecrawl -> Puppeteer)
        -> Cache to Supabase cached_analyses
  -> Return JSON { house, totalLots, lots, ... }
```

### Auto-Analysis Cycle (`autoAnalyseAll()`, every 6 hours)
```
Timer fires
  -> Purge cached_analyses rows for past auctions
  -> discoverAndUpdateCalendar() [scrape house root pages, Gemini extracts catalogue links]
  -> getCalendarAuctions() [Supabase auction_calendar, fallback to hardcoded]
  -> For each catalogue-ready auction (max 2 per house):
     -> Check cache freshness + content hash
     -> If stale/changed: autoAnalyseOne(url) [full scrape + extract + score + cache]
     -> If cached but missing images: multi-pass image backfill
     -> updateHouseSkill() [persist health/status to Supabase house_skills]
  -> saveDailySnapshot() at midnight
```

### Smart Search (`POST /api/smart-search`)
```
Browser
  -> POST /api/smart-search { query, filters }
  -> Auth check (tier determines daily limit)
  -> Check smart_search_cache for cached results
  -> If miss: load all lots from cached_analyses, send to Gemini with query
  -> Cache results (1h TTL)
  -> Return matched lots with AI-generated report
```

---

## Key Abstractions and Patterns

### Per-House Configuration Objects
The system uses several parallel lookup objects keyed by house slug:
- `HOUSE_ROOTS` -- root/listing page URLs for catalogue discovery
- `HOUSE_DISPLAY_NAMES` -- human-readable names
- `HOUSE_EXTRACTION_HINTS` -- structural hints passed to Gemini prompts
- `DOM_EXTRACTORS` -- JavaScript snippets for JSDOM-based extraction
- `HOUSE_URL_REWRITE` -- URL rewrite rules for API-based houses (e.g., Allsop)

### Shared DOM Extractor Templates
Common auction platforms have shared extractors:
- `eigplatform` -- EIG Online Auctions (used by Paul Fosh, Astleys, Henry Sykes, Clarke & Simpson, etc.)
- `auctionhouseuk` -- Auction House UK network (Scotland, Sussex & Hampshire)

### Credit/Exhaustion Guards
Both Firecrawl and Gemini have circuit-breaker patterns:
- `creditExhausted` / `fcCreditExhausted` flags
- Auto-clear after TTL (1h Gemini, 1h Firecrawl, 10min Firecrawl-down)
- Checked before every API call; if set, operations fall back or skip

### SSE Streaming
`POST /api/analyse` supports Server-Sent Events for progress updates during long-running analyses. The `sseWrite(res, event, data)` helper sends structured progress events.

### URL Validation / SSRF Prevention
`validateUrl()` blocks requests to private IP ranges, localhost, and metadata endpoints. DNS resolution check catches DNS rebinding attacks.

---

## Entry Points

### Server Startup
`server.js` line 8808: `app.listen(PORT)` starts Express on `PORT` (default 3000, set by Railway).

Post-startup hooks:
- 5s: `syncCalendarAndHouseNames()`
- 30s: `autoAnalyseAll()`
- Recurring: `autoAnalyseAll()` every 6h, `saveDailySnapshot()` at midnight

### API Routes

**Public:**
- `GET /api/auctions` -- auction calendar (upcoming dates)
- `GET /api/all-lots` -- all cached lots for frontend filtering
- `GET /health`, `GET /check` -- health checks

**Authenticated (JWT):**
- `POST /api/analyse` -- analyse a catalogue URL
- `POST /api/smart-search` -- AI-powered natural language search
- `GET /api/auth/me` -- current user info
- `POST /api/signup` -- user registration
- `POST /api/auth/consent` -- record user consent

**Payments (Stripe):**
- `POST /api/stripe/checkout` -- create Stripe checkout session
- `POST /api/stripe/webhook` -- Stripe webhook handler
- `POST /api/stripe/portal` -- customer portal link
- `GET /api/stripe/status` -- subscription status

**Admin (x-admin-secret header):**
- `POST /api/admin/calendar` -- add/update auction calendar entries
- `POST /api/admin/seed-calendar` -- seed calendar from fallback
- `POST /api/admin/dedup-calendar` -- deduplicate calendar entries
- `DELETE /api/admin/calendar/:id` -- remove calendar entry
- `POST /api/admin/discover-catalogues` -- AI-powered catalogue discovery
- `POST /api/admin/backfill-images` -- trigger image backfill
- `POST /api/admin/clear-cache` -- clear cached analyses
- `POST /api/admin/rescrape` -- force re-scrape of a house
- `POST /api/admin/test-extractor` -- test a DOM extractor
- `POST /api/analyse-all` -- trigger full auto-analysis cycle
- `GET /api/admin/daily-stats` -- daily statistics
- `GET /api/admin/analytics` -- analytics snapshots
- `POST /api/admin/seed-snapshot` -- trigger analytics snapshot
- `GET /api/quality-report` -- system quality/health report
- `GET /api/cost-monitor` -- Firecrawl credit usage stats
- `GET /api/skills` -- house skill tracking data

**Leads:**
- `POST /api/leads` -- lead submission from BridgeMatch Lite

**Static Pages:**
- `GET /` -- `index.html` (main SPA)
- `GET /admin` -- `admin.html`
- `GET /welcome` -- `welcome.html`
- `GET /privacy` -- `privacy.html`
- `GET /terms` -- `terms.html`
- `GET *` -- fallback to `index.html`

### Vercel Functions (Legacy, Not Used in Production)
- `api/analyse.js` -- Vercel serverless handler using Anthropic Claude (not Gemini)
- `api/auctions.js` -- Vercel serverless handler for auction calendar

---

## Component Communication

### Server <-> Supabase
All database operations use the Supabase JS client with service role key. Tables: `cached_analyses`, `users`, `rate_limits`, `auction_calendar`, `smart_search_cache`, `house_skills`, `analytics_snapshots`, `leads`, `activity_events`.

### Server <-> Gemini API
Via `@google/generative-ai` SDK. Rate-limited to 15 RPM (4.1s gap). Two models: `gemini-2.5-flash-lite` for known houses, `gemini-2.5-pro` for unknown/PDF.

### Server <-> Firecrawl
Direct HTTP calls to `https://api.firecrawl.dev/v1/scrape`. Returns raw HTML for local JSDOM parsing. Supports `executeJavascript` actions for lazy-loaded images.

### Server <-> Stripe
Via `stripe` SDK. Checkout sessions, webhook signature verification, customer portal, subscription management.

### Server <-> Resend
Direct HTTP calls for transactional emails (welcome emails, lead notifications).

### Server <-> Land Registry
`queryLandRegistry()` fetches comparable sales data by postcode for lot enrichment.

### Frontend <-> Server
Vanilla JS frontend (`index.html` with inline `<script>`) makes `fetch()` calls to the Express API. Supabase JS client loaded from `public/supabase.min.js` for client-side auth (magic links, Google OAuth).
