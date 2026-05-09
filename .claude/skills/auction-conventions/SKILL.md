---
name: auction-conventions
description: Use this skill when writing or modifying code in the Auction (Bridgematch AuctionBrain) project. Enforces project conventions for architecture, naming, file structure, API patterns, lot extraction (Firecrawl-first), styling, database queries, the enrichment manifest, the self-healing harness, and testing. Activates when the user adds features, fixes bugs, modifies the frontend, or touches server/pipeline code.
version: 3.0.0
---

# Auction Project Conventions

This skill enforces the conventions of the Bridgematch AuctionBrain project — a full-stack Node.js auction property analysis tool hosted on Railway.

The codebase was historically a monolithic `server.js` but has been **decomposed** into a staged pipeline under `lib/pipeline/` with a self-healing harness under `lib/harness/`. Do not reintroduce the monolith.

## Project Structure

```
/Auction/
├── server.js                     # Express wiring, middleware, route mounting (~312 lines — keep thin)
├── index.html                    # Single-page vanilla JS frontend (scraper/analyser UI)
├── bridgematch-lite.html         # Investor-facing bridging deal analyser (calls /api/filter)
├── admin.html                    # Admin dashboard
├── routes/                       # Express route handlers
│   ├── admin.js                  # Admin endpoints (large but cohesive — split when urgent)
│   ├── analyse.js                # /api/analyse
│   ├── auth.js                   # Auth endpoints (Supabase JWT)
│   ├── calendar.js               # Auction calendar CRUD
│   ├── leads.js                  # Lead capture
│   ├── search.js                 # Search endpoints
│   └── stripe.js                 # Stripe webhooks (must invalidateUserCache on tier changes)
├── lib/
│   ├── analysis.js               # Orchestration glue — wires autoAnalyseAll() via lib/pipeline/
│   ├── auth.js                   # validateUserFromReq() with 30s user cache + stale fallback
│   ├── fundability.js            # Maps lots → BridgeMatch /api/filter; type-aware LTV + GDV proxy
│   ├── enrichment.js             # External lookups (EPC, flood, LR, geocode) + manifest population
│   ├── enrichment-manifest.js    # Per-lot observability: recordScraped/recordExtract/recordFundability etc.
│   ├── scraper.js                # Façade re-exporting lib/scraper/* — keep imports stable
│   ├── houses.js                 # HOUSE_ROOTS catalogue URL registry + HOUSE_OVERRIDES (markdown recognisers)
│   ├── config.js                 # CACHE_DAYS, MAX_PAGES, TIMEOUT, rate-limit gaps
│   ├── ai-provider.js            # Gemini Flash-Lite + Pro model selection + rate limiter
│   ├── resource-budget.js        # Firecrawl credit + Gemini RPD budget tracking
│   ├── calendar.js               # Auction calendar helpers
│   ├── email.js                  # Transactional email (auth, alerts)
│   ├── logging.js                # Structured `log` object
│   ├── security.js               # validateUrl(), safeCompare(), CORS origin check
│   ├── supabase.js               # Supabase client factory
│   ├── telegram.js               # Telegram Bot API helper (alerts, heal reports)
│   ├── os-places.js              # OS Places API client (UPRN + canonical address)
│   ├── postcodes-io.js           # postcodes.io geocoder (free)
│   ├── land-registry-hpi.js      # HMLR HPI loader + lookup
│   ├── land-registry-companies.js # HMLR CCOD/OCOD overseas-owner lookup
│   ├── utils.js                  # Shared helpers
│   ├── scraper/                  # Three-tier scrape stack (Firecrawl → Puppeteer → HTTP)
│   │   ├── firecrawl.js          # Firecrawl REST client (rawHtml + markdown + JSON extract)
│   │   ├── puppeteer.js          # Headless Chrome fallback
│   │   ├── http.js               # Plain HTTP last-resort
│   │   ├── rendering.js          # scrapeRenderedPage() three-tier orchestration
│   │   ├── pagination.js         # Per-house pagination strategies
│   │   ├── allsop.js             # Allsop JSON-API consumer (zero credits, structured API)
│   │   ├── lot-detail.js         # Per-lot detail-page fetch + cache (lot_details table, 30d TTL)
│   │   ├── lot-schema.js         # Firecrawl JSON-extract schema + prompt (CRITICAL prompt instructions)
│   │   ├── extraction.js         # extractLotsWithAI(), extractLotsFromPdf() — Gemini fallback wrappers
│   │   ├── image-backfill.js     # Multi-image cascade
│   │   ├── validation.js         # Lot field validators
│   │   └── state.js              # initState() + last-scrape provenance (called via initScraper())
│   ├── pipeline/                 # ═══ The staged scrape → extract → enrich → score → persist pipeline ═══
│   │   ├── index.js              # Pipeline entry + stage composition
│   │   ├── scrape-stage.js       # Three-tier scrape, stamps _scrapedAt/_scrapeMethod
│   │   ├── scraper.js            # Pipeline-side scrape helpers (delegates to lib/scraper/)
│   │   ├── probe.js              # Content-hash change detection before full scrape
│   │   ├── scrape-diff.js        # Compare current vs cached scrape for regressions
│   │   ├── firecrawl-extract.js  # PRIMARY catalogue extractor — Firecrawl JSON extract + per-house markdown recogniser
│   │   ├── extractor.js          # AI-only fallback (Gemini Pro/Flash) when Firecrawl JSON returns 0 lots
│   │   ├── enrichment.js         # Parallel enrichment dispatch (delegates to lib/enrichment.js)
│   │   ├── enrichment-wave.js    # Wave-based parallel lookup executor (free-tier vs paid waves)
│   │   ├── enrich-stage.js       # Pipeline stage wrapper around enrichment
│   │   ├── cache-enrich-stage.js # Cache warming for enrichment
│   │   ├── scoring.js            # analyseLot() — the ONE production scoring function (0-10, capped)
│   │   ├── scorer.js             # Lightweight scoring helpers
│   │   ├── persist-stage.js      # Writes lots + enrichment_manifest to Supabase
│   │   ├── persist-lots.js       # Lot upsert helpers (hero-bleed guard, slug lowercase)
│   │   ├── lot-mappers.js        # LOTS_SELECT column list + dbRowToFrontendLot
│   │   ├── house-skills.js       # Per-house capability tracking (image_coverage, circuit_state)
│   │   ├── healing.js            # Self-healing: find new catalogue URLs when house returns 0 lots
│   │   ├── discovery.js          # Discover candidate new auction houses
│   │   ├── auction-watcher.js    # Watches for new auction dates
│   │   ├── calendar-sync.js      # Syncs auction_calendar from upstream sources
│   │   ├── drift-scheduler.js    # auditStatusDrift() — daytime hourly status sampling
│   │   ├── post-auction-sweep.js # sweepPostAuctionStatuses() — D+1..D+30 status reconciliation
│   │   ├── multi-image-sweep.js  # sweepMultiImages() — per-lot image gallery backfill
│   │   ├── retry-queue.js        # drainHygieneRetries() — enrichment retry drain
│   │   ├── harness-bridge.js     # Bridges pipeline events → harness alerts
│   │   ├── quality-gate.js       # Pipeline-side quality checks (lot count, field coverage)
│   │   ├── quality-regression.js # Detect quality drops vs last successful run
│   │   ├── activity-log.js       # Records pipeline activity
│   │   ├── analytics.js          # Pipeline-level analytics
│   │   ├── purge.js              # Stale data cleanup
│   │   └── types.js              # Shared type shapes (JSDoc)
│   └── harness/                  # ═══ Self-healing + quality assurance ═══
│       ├── manager.js            # AI-driven harness orchestrator (cycle budgets, corrective actions)
│       ├── alert-router.js       # fireAlert({ type, severity, ... }) — single-arg destructured
│       ├── house-health.js       # Circuit breakers (circuit_state, circuit_opened_at, consecutive_failures)
│       ├── quality-gate.js       # Pass/fail: min 3 lots, ≥60% core field coverage
│       ├── regression-detector.js # 0-lot regressions vs last successful scrape
│       ├── extractor-generator.js # Legacy — AI-generated DOM extractors (kept for diagnostic use only)
│       ├── house-discovery.js    # Web-search-based new house discovery
│       ├── data-contract.js      # Lot schema validation + quality scoring
│       ├── enrichment-engine.js  # Harness-side enrichment orchestration
│       └── sub-agents.js         # Periodic audits + calendar staleness checks (queries `house` column, NOT `house_slug`)
├── public/                       # Static assets (favicon, og-image, app.js, styles.css, supabase.min.js)
├── tests/                        # Hand-rolled Node assertions (no test framework). `npm test` = node tests/index.js style.
│   ├── test-scoring.js           # Imports analyseLot from lib/pipeline/scoring.js
│   ├── test-fundability.js       # ~107 tests — type-aware LTV, GDV proxy, loan term defaults
│   ├── test-enrichment.js        # Enrichment + manifest recorder coverage
│   ├── test-manifest.js          # initManifest + record* helper unit tests
│   ├── test-gating.js            # Manifest gating: canScoreYield, canScoreBelowMarket
│   ├── test-auth-cache.js        # validateUserFromReq cache + stale fallback
│   ├── test-frontend-shell.js    # Static HTML head/SEO/shell assertions
│   ├── test-harness.js           # alert-router, house-health, regression-detector
│   ├── test-image-coverage.js    # Hero-bleed guard + image cascade
│   ├── test-os-places.js         # OS Places client error paths
│   └── (others — search/filter, status drift, slug normalisation, etc.)
├── scripts/                      # CLI tooling. NO audit.mjs / audit-fix.mjs / DOM-snapshot scripts (retired 2026-05-08).
│   ├── refresh-hmlr-{hpi,companies,ppd}.mjs # Monthly HMLR dataset loaders (auto-spawned by server.js)
│   ├── discover-houses{,-search}.mjs        # Manual: Gemini-driven new-house discovery
│   ├── test-firecrawl-extract.mjs           # Manual: probe Firecrawl JSON extract on a single URL
│   ├── test-new-houses.mjs                  # Manual: validate new house against its catalogue
│   ├── coverage-report.mjs                  # Manual: enrichment coverage stats by house
│   ├── visual-audit.mjs                     # Auto-fix loop for visual heuristics
│   ├── pre-launch-qa.mjs                    # Pre-deploy data quality smoke checks
│   └── probe-{backfill,orphaned-houses}.mjs # Manual diagnostics
├── migrations/                   # Supabase SQL migrations — apply via MCP apply_migration
├── schema.sql                    # Current Supabase schema reference
└── Dockerfile                    # Railway deployment (node:20-slim + optional Chromium)
```

**Key rules:**
- `server.js` is thin-ish (Express wiring + the cron driver `scheduleTick()`). Backend logic lives in `routes/*.js`, `lib/*.js`, `lib/scraper/*.js`, and `lib/pipeline/*.js`.
- Pipeline stages are **composable and independently testable** — do not collapse them back into `lib/analysis.js`.
- The frontend remains `index.html` (with `public/app.js` + `public/styles.css`) plus `bridgematch-lite.html` and `admin.html`.
- **Lot extraction is unified** — every house goes through `lib/pipeline/firecrawl-extract.js` (Firecrawl JSON extract). Gemini fallback (`lib/pipeline/extractor.js`) only fires when Firecrawl JSON returns 0 lots. Allsop is the only structured-API exception (`lib/scraper/allsop.js`).
- `lib/extractors/` was **deleted 2026-05-08** along with `tests/test-extractors.js`, `tests/test-detail-extractors.js`, `tests/snapshots/`, and `scripts/audit*.mjs`. Do not reintroduce. The `USE_FIRECRAWL_EXTRACT`, `FORCE_EXTRACT_HOUSES`, and `BROKEN_EXTRACTORS` flags / sets are also gone.
- `lib/scoring.js` was deleted (orphan). Never reintroduce — use `lib/pipeline/scoring.js::analyseLot`.
- `lib/pipeline/experiment.js` was deleted (vestigial A/B that never activated). Do not reintroduce.
- `api/` directory was deleted (Vercel orphan). Do not reintroduce.

## Tech Stack

- **Runtime:** Node.js 20, ES modules (`"type": "module"`)
- **Server:** Express 4
- **Database:** Supabase PostgreSQL (direct client, no ORM)
- **AI:** Google Gemini (Flash-Lite for known houses, Pro for unknown/PDF) via `lib/ai-provider.js`
- **Scraping:** Firecrawl primary (managed), Puppeteer fallback, plain HTTP last resort — **never reverse this order**
- **Auth:** Supabase JWT (Jose library) with 30s in-memory user cache (see `lib/auth.js`)
- **Payments:** Stripe — webhooks must call `invalidateUserCache(supabase_auth_id)` on tier changes
- **Package manager:** npm
- **Dev mode:** `node --watch server.js`
- **No build step, no bundler, no framework**

## Naming Conventions

### Backend

| Category | Convention | Examples |
|----------|-----------|----------|
| Functions | camelCase, async verb-first | `validateUserFromReq()`, `fetchPage()`, `analyseLot()`, `scrapeRenderedPage()` |
| Pipeline stages | verb-noun, exported from stage file | `scrapeStage()`, `extractStage()`, `persistStage()` |
| Manifest recorders | `record{Event}()` | `recordScraped()`, `recordExtract()`, `recordFundability()`, `recordEpc()` |
| House enrichment | `enrich{House}Lots()` | `enrichAllsopLots()`, `enrichSavillsLots()` |
| Constants | ALL_CAPS | `DOM_EXTRACTORS`, `HOUSE_ROOTS`, `MAX_PAGES`, `CACHE_TIERS`, `LOTS_SELECT` |
| Model strings | ALL_CAPS | `MODEL_PRO`, `MODEL_FLASH`, `TYPICAL_ARRANGEMENT_FEE_PCT` |
| House slugs | lowercase, no spaces | `savills`, `allsop`, `sdl`, `network`, `bondwolfe` |
| Lot fields | camelCase | `lot`, `address`, `price`, `priceText`, `propType`, `titleSplit`, `dealType` |
| Manifest stamps on raw lots | `_underscoredCamel` | `_scrapedAt`, `_scrapeMethod`, `_extractStrategy`, `_extractFieldCoverage` |
| DB columns | snake_case | `cached_analyses`, `enrichment_manifest`, `house`, `circuit_opened_at` |
| Route handlers | `async (req, res) => {}` | Standard Express pattern |

**Known naming inconsistency (unresolved):** `house` vs `slug` vs `auction_house` vs `house_slug` are used interchangeably. There is an open P3 task to unify these. Until then, when reading/writing to Supabase:
- `house_skills.house` (NOT `house_slug`)
- `lots.auction_house` in some contexts
- `sub-agents.js` queries `house` — do not "fix" this to `house_slug`
- When adding new code, prefer `house_slug` in JS and `house` as DB column, and leave a `TODO(naming-audit)` comment

### Frontend

| Category | Convention | Examples |
|----------|-----------|----------|
| CSS classes | kebab-case | `.lot-card`, `.search-panel`, `.filter-bar`, `.nav-cta` |
| IDs | camelCase | `#resultsPanel`, `#filterBar`, `#signupModal` |
| JS functions | camelCase | `handleSearch()`, `renderLots()`, `toggleHousePopover()` |
| Data attributes | kebab-case | `data-lot-item` |
| CSS variables | `--short-name` | `--bg`, `--text`, `--green`, `--navy`, `--radius` |

### Logging

Use structured JSON logging via the `log` object from `lib/logging.js`:
```javascript
log.info('message', { key: 'value' })
log.warn('message', { key: 'value' })
log.error('message', { key: 'value', err: error.message })
```

Harness alerts go through `alert-router.js::fireAlert()` with a **single destructured object**:
```javascript
fireAlert({ type: 'recall_diagnostic', severity: 'warning', house: 'savills', message: '...', meta: {...} })
// NOT: fireAlert('recall_diagnostic', 'warning', ...) — that positional signature is dead
```

### Comments

- Section headers: `// ═══════════════════════════════════════════════════════════════`
- Subsections: `// ── SECTION NAME ──`
- Critical warnings: `// CRITICAL:` prefix
- Open questions: `// TODO(naming-audit):` or `// TODO(<topic>):` prefix

## API Endpoint Patterns

### Route structure
```javascript
app.post('/api/endpoint', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  // ... handler logic
});
```

`validateUserFromReq()` uses a 30-second in-memory cache + 5-minute stale fallback on Supabase errors. Do not bypass it. When a user's tier changes (Stripe webhook), call `invalidateUserCache(supabase_auth_id)`.

### Response formats
- **Success:** `{ house, totalLots, inBudget, titleSplits, topPicks, lots: [...] }`
- **Error:** `{ error: 'Human-readable message' }`
- **Health:** `GET /health` → `{ status: 'ok' }`

### Security checklist
- URL validation via `validateUrl()` (SSRF protection)
- CORS whitelist from `ALLOWED_ORIGINS` env var
- Origin header check on POST requests
- Supabase JWT verification in `validateUserFromReq`
- Rate limiting via `rate_limits` table + `increment_rate_limit` RPC
- Timing-safe token comparison via `safeCompare()`

## Lot Extraction (Firecrawl-First)

**Single unified path**, no per-house DOM extractors. The previous DOM extractor system was retired 2026-05-08. New houses do NOT need any per-house JS code beyond a `HOUSE_ROOTS` entry.

### Pipeline
1. **`lib/pipeline/firecrawl-extract.js::extractCatalogueListing()`** — primary path. Calls Firecrawl's structured `jsonOptions` extract against the catalogue URL with the schema in `lib/scraper/lot-schema.js`. Handles single-page and paginated catalogues. `changeTracking` short-circuits unchanged pages at ~1 credit.
2. **Per-house markdown recogniser** (optional) — `HOUSE_OVERRIDES[slug]` in `lib/houses.js` may point at a function that reads the same Firecrawl markdown response to recover lots the JSON extractor missed (currently used by Pattinson + John Pye). This is *recognition*, not new extraction — Firecrawl-at-the-heart by definition.
3. **AI fallback** — `lib/pipeline/extractor.js` runs Gemini Flash-Lite (known houses) or Pro (unknown / PDF) only when the Firecrawl JSON path returns 0 lots. Stamps `_extractStrategy` and `_extractFieldCoverage` provenance.
4. **Allsop JSON-API exception** — `lib/scraper/allsop.js` consumes Allsop's private JSON endpoint directly (zero credits, ~50ms/page). It's a structured-API consumer, not a layout scraper.

### Returned lot fields
- `lot` (Number) — lot number (required; `0` is valid)
- `address` (String) — full address (required)
- `price` (Number|null) — guide price as integer
- `priceText` (String) — original price string for display
- `url` (String) — detail page link
- `bullets` (String[]) — features, tenure, condition notes
- `imageUrl` (String|undefined) — property image URL (multi-image-sweep handles misses)
- `propType`, `beds`, `tenure`, `condition`, `vacant`, `titleSplit`, `dealType` — best-effort enrichment fields

### Rules
- Never throw out of an extractor; return an empty list and let the harness alert
- Status detection (SOLD/STC/Withdrawn) is in `lib/pipeline/firecrawl-extract.js` and `lib/scraper/validation.js`
- Hero-bleed guard at upsert (`lib/pipeline/persist-lots.js::HERO_BLEED_THRESHOLD = 3`) auto-strips a single image URL shared across ≥3 distinct addresses
- Slug-case dedup at upsert: `house = (house || '').toLowerCase()` — avoid mixed-case duplicates
- For non-EIG / non-AH-UK / non-Bamboo houses, add a `RECALL_SENTINELS[slug]` regex in `lib/analysis.js` so the harness can measure recall against Firecrawl markdown

## Enrichment Manifest (Observability Layer)

Every lot persisted to Supabase has an `enrichment_manifest` JSONB column tracking what was attempted, succeeded, skipped, or failed. **This is the core observability mechanism** — do not silently bypass it.

### How to populate
Import recorders from `lib/enrichment-manifest.js`:
```javascript
import { initManifest, recordScraped, recordExtract, recordFundability, recordEpc } from './enrichment-manifest.js';

const manifest = initManifest();
recordScraped(manifest, { at: lot._scrapedAt, method: lot._scrapeMethod });
recordExtract(manifest, { strategy: lot._extractStrategy, aiTier: lot._extractAiTier, fieldCoverage: lot._extractFieldCoverage });
recordFundability(manifest, { status: 'api_ok', inputs_sent: [...], lender_count: 12 });
```

Upstream stages (`scrape-stage.js`, `extractor.js`) stamp provenance fields onto raw lots with `_` prefix; `lib/enrichment.js` then translates those stamps into manifest entries.

### What to record
- Each external lookup (EPC, flood, LR, geocode, fundability) records status: `ok` | `skipped_no_creds` | `no_match` | `api_error` | `circuit_open`
- Fundability records `inputs_sent` and `inputs_missing` — never silently send incomplete deals
- Scoring records `yield_scored_by` to prevent double-counting between `scoring` and `enrichment`

### Anti-pattern
**Silent no-ops are banned.** If a lookup is skipped (missing creds, circuit open, no postcode), the manifest must record the reason. "Empty" and "unknown" are different states.

## Database Patterns

### Query style (Supabase JS client, no ORM)
```javascript
const { data, error } = await supabase
  .from('table_name')
  .select('*')
  .eq('column', value)
  .single();
```

### Key tables
- `lots` — Canonical lot storage, JSONB `enrichment_manifest` (GIN-indexed), selected via `LOTS_SELECT` in `lib/pipeline/lot-mappers.js`
- `cached_analyses` — URL-keyed legacy cache with 7-day TTL, lots stored as JSONB
- `lot_details` — Per-URL detail-page cache (30-day TTL, keyed on `url`)
- `house_skills` — Per-house capabilities + health (`health_score`, `circuit_state`, `circuit_opened_at`, `consecutive_failures`, `healing_cooldown_until`, `healing_attempts`)
- `auction_calendar` — Upcoming auction dates + catalogue URLs
- `pipeline_alerts` — Harness alert lifecycle (`opened` → `acknowledged` → `resolved`)
- `enrichment_cache` — Memoised external lookup results (EPC, LR, etc.)
- `rate_limits` — IP + date rate tracking (updated via `increment_rate_limit` RPC)
- `users` — Auth, tier, Stripe IDs, preferences

### Applying migrations
SQL files live in `migrations/`. Apply via the Supabase MCP `apply_migration` tool, NOT by running `psql` locally. Each migration must be idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

## Frontend Styling

### Design system (CSS variables)
```css
--bg-primary: #f5f7fa;   --bg-secondary: #ffffff;  --bg-card: #eef2f7;
--accent: #2e7d32;        --accent-hover: #1b5e20;  --accent-match: #4a9e2f;
--accent-warn: #e67e22;   --accent-danger: #c0392b; --accent-info: #2e86c1;
--text: #1a2a3a;          --text-muted: #6b7c8d;
```
- Navy header gradient: `linear-gradient(135deg, #1a3a5c, #2a5a8c)`
- Brand: "Bridge" white, "Match" `#8bc34a`

### Typography
- Body: `'Outfit'`
- Brand: `'Sora'`
- Monospace (prices/lots): `'JetBrains Mono'`
- Use `clamp()` for responsive font sizing

### Component patterns
- Cards: `.lot-card`, `.stat-card`, `.paywall-card`
- Buttons: `.btn-main` (green), `.cta-primary` (gradient), `.cta-secondary` (white), `.ex-btn` (border only)
- Modals: `.modal-bg` (backdrop) + `.modal` (content)
- Inputs: border with `var(--border)`, focus state uses `var(--accent)`
- Transitions: `all .15s` (standard), `all .2s` (emphasis)
- Accordions: Use native `<details>/<summary>` — more reliable than JS alternatives
- Avoid `overflow:hidden` on parent containers that need click events

### Auth / session state
- 30-minute inactivity timeout (`INACTIVITY_TIMEOUT_MS`), reset on `mousemove`/keyboard/click + `onSignIn`
- Cold-start bails if token has >10min remaining (don't kick users for stale-looking-but-valid tokens)
- `SESSION_STALENESS_THRESHOLD_MS = 10 * 60 * 1000`

### State management
- Global variables for UI state (`currentView`, `allLots`, `filteredLots`, `currentUser`)
- `localStorage` for persistence (`auctionSession`, `auctionUser`, `auctionFilters`)
- Re-render via `renderLots()` after state changes

### bridgematch-lite.html (investor deal analyser)
- Uses `TYPICAL_ARRANGEMENT_FEE_PCT` (2%) for `estimateNetFromGross()` — **never** use `parseProcFee` (that's broker commission, not borrower fee)
- LTGDV is per-lender, based on `(day1_advance + rolled_interest + lender_funded_works) / GDV`
- **Do not modify this file based on bridging finance domain knowledge without explicit user confirmation** — the logic is fragile and correct

## Fundability Integration (`lib/fundability.js`)

Maps auction lots to BridgeMatch `/api/filter` deal parameters. Must send complete inputs or record `inputs_missing` in the manifest.

- **LTV by property type:** resi/HMO=75, commercial/office/retail=60, land/dev_site=45, unknown=65
- **Works cost by condition:** derelict/major_works=35%, poor/needs_modernisation=20%, cosmetic=8%, default=15%
- **GDV proxy:** `price + works_cost + (price * 0.15)` — NOT `price * 1.25`
- **Default loan term:** 6 months (auction bridging norm), NOT 12
- **Zero price:** returns `{ status: 'no_price', lenderCount: null }` — NOT bare `null`
- **Cache key:** includes `price` (bucketed), `type`, `is_refurb`, `geography`, `works_cost` (£5k bucket), `loan_term`
- `buildBridgematchUrl()` passes `works_cost`, `gdv`, `loan_term` as URL params

## Scoring System (`lib/pipeline/scoring.js::analyseLot`)

Score range **0-10**, never exceed: `Math.max(0, Math.min(10, score))`.

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

Yield is scored **once** — either by `scoring.js` or `enrichment.js`, never both. The manifest records which one fired (`yield_scored_by`).

## Testing

- Framework: hand-rolled Node assertions (no Jest / Mocha / Vitest). `process.exit(1)` on failure.
- Run: `npm test`
- Scoring tests: `tests/test-scoring.js` imports `analyseLot` from `lib/pipeline/scoring.js`
- Fundability tests: `tests/test-fundability.js` — ~107 tests covering type-aware LTV, works inference, GDV proxy, loan term defaults, zero-price shape
- Enrichment + manifest tests: `tests/test-enrichment.js`, `tests/test-manifest.js`, `tests/test-gating.js`
- Auth cache: `tests/test-auth-cache.js` (30s cache + 5min stale fallback)
- Frontend shell: `tests/test-frontend-shell.js` (HTML head, SEO tags, env-shim presence)
- Harness: `tests/test-harness.js` (alert-router dedup, house-health circuit, regression-detector)
- For new lot-extraction work, validate end-to-end via `node scripts/test-firecrawl-extract.mjs <url>` rather than DOM snapshots (those scripts and `tests/snapshots/` were retired 2026-05-08)

## Gemini Model Selection (`lib/ai-provider.js`)

```javascript
MODEL_FLASH = 'gemini-2.5-flash-lite'   // Known houses (fast tier)
MODEL_PRO   = 'gemini-2.5-pro'          // Unknown houses & PDF extraction
```

- Known houses → Flash-Lite + extraction hints
- Unknown houses → Pro (higher capability)
- Rate limiter via `GEMINI_MIN_GAP_MS` env var (default 100ms paid tier; 4100ms for free-tier 15 RPM safety)
- `creditExhausted` flag stops all calls on 429/quota errors

## Resource Limits (`lib/config.js`)

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_PAGES` | 40 | Page scraping cap |
| `MAX_PUPPETEER_PAGES` | 15 | Memory protection on Railway |
| `MAX_LOTS_PER_SCRAPE` | 100 | API cost management |
| `MAX_AUCTIONS_PER_HOUSE` | 2 | Show upcoming, not historical |
| `TIMEOUT` | 25000ms | Request timeout |
| `CACHE_DAYS` | 7 | Default cache TTL (planned: cap at 2h when auction < 48h away) |

## Git Conventions

- **Commit format:** `type: subject` (lowercase, imperative)
- **Types:** `fix:`, `feat:`, `chore:`, `refactor:`
- **Branch:** Single `main` branch, direct commits
- **Example:** `fix: increase SDL page cap to 40 + clean up test scripts`

## Deployment

- **Platform:** Railway (Docker)
- **Base image:** `node:20-slim` with Chromium
- **Health check:** `GET /health`
- **Non-root user:** `appuser`
- **Port:** Railway-assigned
- Never commit `.env` files — use `.env.example` as template

## Non-Negotiables

From `CLAUDE.md` and project review:

- **Never reintroduce the `server.js` monolith** — logic belongs in `routes/`, `lib/`, or `lib/pipeline/`
- **Score range 0-10**, always clamped
- **Firecrawl primary, Puppeteer fallback, HTTP last resort** — never reverse
- **Silent failures are banned** — every skipped/failed lookup records a reason in the manifest
- **Do not modify `bridgematch-lite.html`** based on bridging finance knowledge without explicit user confirmation — the logic is fragile
- **Frontend design system** — use CSS variables, don't introduce new colour values
- **Harness alerts** use the single-object `fireAlert({ type, severity, ... })` signature

## Adding a New Auction House

See `references/new-house-playbook.md` for the full checklist. Summary (Firecrawl-first; no per-house JS for the common case):

1. **Register the house** — add `HOUSE_ROOTS[slug]` (catalogue URL) and `HOUSE_DISPLAY_NAMES[slug]` in `lib/houses.js`. Add a `detectAuctionHouse()` clause for the domain.
2. **Recall sentinel (recommended)** — add a `RECALL_SENTINELS[slug]` regex in `lib/analysis.js` so the harness can measure how many lots Firecrawl markdown sees vs how many made it into JSON. EIG / AH UK / Bamboo platforms are auto-detected by `detectPlatformSentinel()` — no entry needed.
3. **Test the extraction** — run `node scripts/test-firecrawl-extract.mjs <catalogue-url>` and confirm lot count + key fields look right. If Firecrawl JSON misses lots, inspect the markdown — usually a per-house `HOUSE_OVERRIDES` markdown recogniser is the fix (see Pattinson, John Pye for examples), not a new DOM extractor.
4. **Optional: pagination / Puppeteer hint** — if the catalogue uses an unusual pagination pattern or strictly needs a JS-rendered page, set the relevant flag on the `rewriteUrl(slug, url)` return in `lib/houses.js`.
5. **Mirror in `admin.html`** if the slug needs a friendly name in the admin UI.
6. **Run `npm test`** — must stay green.
7. **Commit:** `feat: add {slug} auction house (N lots)`
