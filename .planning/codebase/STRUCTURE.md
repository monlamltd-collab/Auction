# Directory Structure

> **⚠️ STALE — DO NOT TRUST.** Last accurate ~2026-04. Superseded by the 2026-05-08 refactor that retired `lib/extractors/`, `tests/snapshots/`, `scripts/audit*.mjs`, and decomposed `server.js` into `routes/`, `lib/`, `lib/scraper/`, `lib/pipeline/`, and `lib/harness/`. For the current project layout see `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `.claude/skills/auction-conventions/SKILL.md`. This file is retained only as a historical reference.

## Root Layout

```
Auction/
├── server.js                  # Main Express server (9,749 lines) — ALL backend logic
├── index.html                 # Main SPA frontend (auction directory + analyser)
├── admin.html                 # Admin dashboard (calendar management, backfill triggers)
├── welcome.html               # Post-signup welcome page
├── bridgematch-lite.html      # Investor-facing bridging finance tool (standalone)
├── privacy.html               # Privacy policy
├── terms.html                 # Terms of service
├── package.json               # Node.js config (ESM, Express + Gemini + Supabase + Stripe)
├── Dockerfile                 # Railway deployment (node:20-slim + optional Chromium)
├── vercel.json                # Legacy Vercel config (vestigial, not used)
├── CLAUDE.md                  # Project context for Claude Code agents
├── schema.sql                 # Core Supabase schema (cached_analyses, users, rate_limits, etc.)
├── leads_schema.sql           # Leads table schema
├── auction_calendar_schema.sql # Auction calendar table schema
├── smart_search_cache_schema.sql # Smart search cache + user tier column
├── analytics_snapshots_schema.sql # Analytics snapshots schema
├── add_session_token.sql      # Migration: add session_token to users
├── add_stats_columns.sql      # Migration: add stats columns
├── setup_auction.py           # Python setup script (likely initial data seeding)
├── server.js.txt              # Backup/reference copy of server.js
├── server_leads_endpoint.js   # Standalone leads endpoint reference
├── api/                       # Legacy Vercel serverless functions (NOT used in production)
├── public/                    # Static assets served at /public
├── scripts/                   # CLI tooling (audit, testing)
├── tests/                     # DOM extractor test suite
├── bridgematch-agents/        # Multi-agent loop system for development
├── bugs/                      # Agent loop logs and bug reports
├── skills/                    # Skills directory (placeholder)
├── .claude/                   # Claude Code skills and config
└── .github/                   # GitHub Actions workflows
```

---

## Directory Details

### `api/` -- Legacy Vercel Functions
These were the original serverless functions when the project was on Vercel. **Not used in production** (Railway runs `server.js` directly).

| File | Purpose |
|---|---|
| `api/analyse.js` | Vercel handler for catalogue analysis (uses Anthropic Claude, not Gemini) |
| `api/auctions.js` | Vercel handler for auction calendar (hardcoded list) |

### `public/` -- Static Assets
Served at `/public` by Express static middleware.

| File | Purpose |
|---|---|
| `public/favicon.svg` | Site favicon |
| `public/og-image.png` | OpenGraph image for social sharing |
| `public/og-image.svg` | SVG source for OG image |
| `public/supabase.min.js` | Supabase JS client (loaded by frontend for auth) |

### `scripts/` -- CLI Tooling

| File | Purpose |
|---|---|
| `scripts/audit.mjs` | Comprehensive health monitor for all auction house scrapers. Checks extractors against live sites, detects broken selectors and site redesigns. |
| `scripts/audit-fix.mjs` | Auto-fix companion to audit. Applies fixes and sends email reports via Resend. |
| `scripts/pre-launch-qa.mjs` | Pre-launch quality assurance checks |
| `scripts/test-btg-extractor.mjs` | BTG Eddisons extractor test |
| `scripts/test-new-houses.mjs` | Test script for newly added auction houses |
| `scripts/audit/fingerprints.json` | Saved audit fingerprints for change detection |
| `scripts/audit/last-audit.json` | Last audit results |

### `tests/` -- Test Suite

| File | Purpose |
|---|---|
| `tests/test-extractors.js` | DOM extractor test suite. Runs extractors against saved HTML snapshots via JSDOM. |
| `tests/snapshots/bondwolfe.html` | Saved HTML snapshot for Bond Wolfe |
| `tests/snapshots/savills.html` | Saved HTML snapshot for Savills |
| `tests/snapshots/sdl.html` | Saved HTML snapshot for SDL/BTG Eddisons |

### `bridgematch-agents/` -- Multi-Agent Development System
Shell-based agent loop system for parallel development tasks.

| File/Dir | Purpose |
|---|---|
| `launch.sh` | Launches all agent loops in parallel |
| `stop.sh` | Stops all running agent loops |
| `loops/` | Shell scripts for each agent loop (auth-stripe, coordinator, detail, forms-data, listings, resilience) |
| `missions/` | Mission briefs (markdown) defining each agent's objectives |

### `bugs/` -- Agent Loop Output
Logs and bug reports generated by the bridgematch-agents system.

### `.claude/` -- Claude Code Configuration

| Path | Purpose |
|---|---|
| `.claude/skills/auction-conventions/SKILL.md` | Skill definition for auction house conventions |
| `.claude/skills/auction-conventions/references/new-house-playbook.md` | Playbook for adding new auction houses |

### `.github/workflows/`

| File | Purpose |
|---|---|
| `.github/workflows/nightly-audit.yml` | Nightly cron (5am UTC): runs audit, applies fixes, commits changes, sends email report |

---

## Key File Locations

### Main Server
- **Entry point:** `server.js` (lines 8808-8836 for `app.listen()` and startup hooks)

### Routes by Category
All routes are defined in `server.js`:
- **Auth routes:** lines 1066-1170 (`/api/signup`, `/api/auth/consent`, `/api/auth/me`)
- **Stripe routes:** lines 1173-1380 (`/api/stripe/checkout`, `/api/stripe/webhook`, `/api/stripe/portal`, `/api/stripe/status`)
- **Lead routes:** lines 1385-1481 (`/api/leads`)
- **Calendar routes:** lines 2233-2353 (`/api/auctions`, `/api/admin/calendar`, `/api/admin/seed-calendar`, `/api/admin/dedup-calendar`)
- **Analysis routes:** lines 2440-2930 (`/api/analyse`)
- **Smart search:** lines 2931-3352 (`/api/smart-search`)
- **Cache/admin routes:** lines 3360-3800 (`/api/all-lots`, `/api/cache-status`, `/api/refresh-cache`, `/api/admin/backfill-images`, `/api/admin/clear-cache`, `/api/admin/rescrape`, `/api/admin/test-extractor`, `/api/analyse-all`)
- **Static pages:** lines 3809-3830 (`/admin`, `/welcome`, `/privacy`, `/terms`)
- **Diagnostics:** lines 3833-4014 (`/api/diag`, `/check`, `/api/admin/daily-stats`, `/api/skills`, `/api/cost-monitor`, `/api/quality-report`)
- **Analytics:** lines 9664-9697 (`/api/admin/analytics`, `/api/admin/seed-snapshot`)
- **Catch-all:** line 4015 (`GET *` -> `index.html`)

### Configuration
- **Env var validation:** `server.js` lines 28-41
- **Cache tiers:** `server.js` lines 203-214
- **Scraping config:** `server.js` lines 220-228 (MAX_PAGES, MAX_PUPPETEER_PAGES, MAX_LOTS_PER_SCRAPE, etc.)
- **Gemini models:** `server.js` lines 234-235
- **Firecrawl config:** `server.js` lines 249-272
- **House roots (catalogue URLs):** `server.js` lines 912-973
- **House display names:** `server.js` (search for `HOUSE_DISPLAY_NAMES`)
- **Extraction hints:** `server.js` (search for `HOUSE_EXTRACTION_HINTS`)
- **CORS allowed origins:** `server.js` line 59
- **Tier limits:** `server.js` lines 1615-1629

### Extraction Logic
- **DOM Extractors:** `server.js` lines 4862+ (`DOM_EXTRACTORS` object, ~3000+ lines of per-house JS)
- **Gemini extraction:** `server.js` lines 4660-4740 (`extractLotsWithAI()`)
- **PDF extraction:** `server.js` lines 4742-4824 (`extractLotsFromPdf()`)
- **HTML stripping:** `server.js` lines 4826-4857 (`stripHtml()`)
- **JSDOM extraction:** search for `extractWithJSDOM`
- **Auction house detection:** `server.js` line 4032 (`detectAuctionHouse()`)

### Scoring Engine
- **Full scoring:** `api/analyse.js` lines 272-375 (`analyseLot()`) -- canonical implementation with all signal detection
- **Enrichment:** `server.js` lines 8673-8760 (`enrichLots()`) -- Land Registry, yield, market comparison

### Scraping Orchestration
- **Three-tier scraper:** search for `scrapeRenderedPage` in `server.js`
- **Firecrawl client:** `server.js` lines 274-320 (`scrapeWithFirecrawl()`)
- **Puppeteer scraper:** search for `scrapeWithPuppeteer` in `server.js`
- **Image backfill:** search for `backfillImages` in `server.js`
- **Auto-analysis:** `server.js` lines 8867-9060 (`autoAnalyseAll()`, `_doAutoAnalyseAll()`)
- **Single URL analysis:** `server.js` line 9191 (`autoAnalyseOne()`)

### Database Schemas
- **Core schema:** `schema.sql` (cached_analyses, rate_limits, users, analytics_snapshots, house_skills)
- **Leads:** `leads_schema.sql`
- **Calendar:** `auction_calendar_schema.sql`
- **Search cache:** `smart_search_cache_schema.sql`

### Auth & Payments
- **JWT verification:** `server.js` lines 146-169 (`verifySupabaseToken()`)
- **User validation:** `server.js` lines 1532-1613 (`validateUserFromReq()`)
- **Stripe checkout:** `server.js` lines 1173-1215
- **Stripe webhook:** `server.js` lines 1217-1337
- **Welcome email:** `server.js` lines 1486+ (`sendWelcomeEmail()`)

---

## Naming Conventions

### Files
- **Server code:** `server.js` (monolith), `server_leads_endpoint.js` (reference/standalone)
- **SQL schemas:** `{feature}_schema.sql` or `{migration_name}.sql`
- **Scripts:** `{purpose}.mjs` (ESM) in `scripts/`
- **Tests:** `test-{feature}.js` in `tests/`
- **HTML pages:** lowercase, hyphenated (`bridgematch-lite.html`)
- **Static assets:** lowercase in `public/`

### Code Identifiers
- **House slugs:** lowercase, no separators (`savills`, `bondwolfe`, `edwardmellor`, `auctionhousescotland`)
- **Config constants:** SCREAMING_SNAKE_CASE (`MAX_PAGES`, `CACHE_TIERS`, `MODEL_FLASH`)
- **Functions:** camelCase (`scrapeRenderedPage`, `extractLotsWithAI`, `autoAnalyseAll`)
- **Route handlers:** inline anonymous async functions on `app.get/post()`
- **Section dividers:** `// ═══...═══` lines followed by `// SECTION NAME` comments

### Supabase Tables
- snake_case: `cached_analyses`, `rate_limits`, `auction_calendar`, `smart_search_cache`, `house_skills`, `analytics_snapshots`, `activity_events`

---

## Where to Find Specific Types of Code

| Type | Location |
|---|---|
| API routes | `server.js` -- search for `app.get(` or `app.post(` |
| Middleware | `server.js` lines 52-198 (CORS, security headers, CSRF, logging) |
| Auth logic | `server.js` lines 130-170, 1530-1650 |
| Rate limiting | `server.js` lines 982-1007 |
| DOM extractors | `server.js` search for `DOM_EXTRACTORS` (~line 4862) |
| Scoring signals | `api/analyse.js` lines 272-375 (`analyseLot()`) |
| Scraping logic | `server.js` search for `scrapeRenderedPage`, `scrapeWithFirecrawl`, `scrapeWithPuppeteer` |
| AI prompts | `server.js` search for `callGemini` callsites |
| Caching | `server.js` search for `cached_analyses` |
| Scheduled tasks | `server.js` lines 8808-8836 (startup hooks) |
| Stripe integration | `server.js` lines 1173-1380 |
| Email sending | `server.js` search for `resend.com` or `sendWelcomeEmail` |
| Frontend JS | Inline in `index.html` |
| Admin UI | `admin.html` |
| Database schemas | `*.sql` files in project root |
| CI/CD | `.github/workflows/nightly-audit.yml` |
| Docker config | `Dockerfile` |
| Test snapshots | `tests/snapshots/*.html` |
