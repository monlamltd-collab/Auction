# Auction project — architecture map

**Audience:** future Claude (or human) opening a fresh context window.
**Goal:** orient in <5 minutes. Authoritative on file layout + data flow.
**Maintained by:** update this file in any PR that materially changes architecture.
Last verified: 2026-05-02 (post Issue 8 frontend split + rental-comps v2).

---

## Top-level layout

```
Auction/
├─ server.js                    Express wiring + scheduler (428 lines — keep thin)
├─ index.html                   Page shell only (572 lines after frontend split)
├─ public/
│  ├─ styles.css                All inline CSS lifted out of index.html
│  ├─ app.js                    All inline JS lifted out of index.html (~4,680 lines)
│  ├─ town-match.js             Search-filter helper (postcode-area predicate)
│  └─ supabase.min.js           Supabase SDK
├─ admin.html                   Admin dashboard (independent — no shared JS)
├─ bridgematch-lite.html        Investor-facing deal analyser (independent)
│
├─ routes/                      Express routes (mounted in server.js)
│  ├─ admin.js                  All /api/admin/* (gated by requireAdmin)
│  ├─ analyse.js                /api/analyse, /api/lot
│  ├─ auth.js                   Supabase JWT auth
│  ├─ calendar.js               /api/auctions, calendar admin
│  ├─ leads.js                  Lead capture
│  ├─ search.js                 /api/all-lots, /api/smart-search (AI), /api/lots/:id/comps
│  └─ stripe.js                 Stripe webhooks (must invalidateUserCache)
│
├─ lib/
│  ├─ analysis.js               Glue — wires autoAnalyseAll() via lib/pipeline/
│  ├─ auth.js                   validateUserFromReq, safeCompare, requireAdmin
│  ├─ enrichment.js             EPC/flood/LR/geocode/rent calls + manifest population
│  ├─ enrichment-manifest.js    Per-lot observability: recordEpc, recordFlood, etc.
│  ├─ ai-provider.js            Gemini Flash-Lite + Pro selection + rate limiter
│  ├─ resource-budget.js        Firecrawl credit + Gemini RPD budget
│  ├─ fundability.js            Lot → BridgeMatch deal-essentials mapping
│  ├─ houses.js                 HOUSE_ROOTS catalogue URL registry (~173 houses)
│  ├─ os-places.js              OS Data Hub — UPRN + canonical address (FIRST CONTACT ONLY)
│  ├─ logging.js                Structured `log` object
│  ├─ security.js               CSP headers, CSRF check, validateUrl (SSRF)
│  ├─ supabase.js               Supabase client factory
│  ├─ utils.js                  Shared helpers
│  ├─ telegram.js               Self-healing notifications (optional)
│  ├─ calendar.js               Auction calendar helpers
│  ├─ email.js                  Transactional email
│  ├─ config.js                 CACHE_DAYS, MAX_PAGES, TIMEOUT, ALLOWED_ORIGINS
│  │
│  ├─ scraper.js                Thin facade — re-exports from scraper/* slices
│  ├─ scraper/
│  │  ├─ state.js               Resource-budget state + Firecrawl credit tracking
│  │  ├─ http.js                fetchPage()
│  │  ├─ firecrawl.js           scrapeWithFirecrawl(url, {formats, waitFor, actions})
│  │  ├─ puppeteer.js           Conditional import — fallback only
│  │  ├─ rendering.js           scrapeRenderedPage() — three-tier orchestrator
│  │  ├─ pagination.js          detectTotalPages, scrapeAllPages
│  │  ├─ extraction.js          extractLotsWithAI() (Gemini fallback)
│  │  ├─ image-backfill.js      Two-pass image-only re-scrape
│  │  ├─ lot-detail.js          fetchLotPage() + 30-day detail cache
│  │  ├─ allsop.js              House-specific JSON API (single exception)
│  │  └─ validation.js          stripHtml, image-URL validators
│  │
│  ├─ extractors/
│  │  ├─ index.js               DOM_EXTRACTORS registry + extractWithJSDOM()
│  │  ├─ universal.js           Generic fallback extractor
│  │  ├─ houses/                ★ 44 per-house DOM extractors (one file each)
│  │  ├─ platforms/             Platform-family extractors (eig, sdl, cj-saas, …)
│  │  ├─ detail/                ★ 8 per-house detail-page extractors
│  │  ├─ runner.js              Detail-page orchestrator
│  │  └─ helpers.js             Shared parsers (price, beds, tenure)
│  │
│  ├─ pipeline/                 ★ STAGED scrape→extract→enrich→score→persist
│  │  ├─ index.js               Pipeline composer
│  │  ├─ scrape-stage.js        Stamps _scrapedAt, _scrapeMethod
│  │  ├─ probe.js               Content-hash change detection
│  │  ├─ scrape-diff.js         Compares current vs cached scrape
│  │  ├─ extractor.js           Runs DOM, falls back to Gemini, stamps strategy
│  │  ├─ enrich-stage.js        Wraps lib/enrichment.js
│  │  ├─ enrichment.js          Parallel enrichment dispatch
│  │  ├─ enrichment-wave.js     Wave-based parallel lookup executor
│  │  ├─ cache-enrich-stage.js  Enrichment cache warming
│  │  ├─ scoring.js             ★ analyseLot() — THE ONE scorer (0-10, clamped)
│  │  ├─ scorer.js              Lightweight scoring helpers
│  │  ├─ persist-stage.js       Writes lots + manifest, runs quality-gate
│  │  ├─ persist-lots.js        Lot upsert helpers (snapshot_hash dedup)
│  │  ├─ lot-mappers.js         LOTS_SELECT + dbRowToLot/dbRowToFrontendLot
│  │  ├─ house-skills.js        Per-house capability tracking
│  │  ├─ healing.js             healBrokenHouse() — find new catalogue URLs
│  │  ├─ discovery.js           Discover new auction houses
│  │  ├─ auction-watcher.js     watchAuctionCalendar()
│  │  ├─ calendar-sync.js       Syncs auction_calendar from upstream
│  │  ├─ harness-bridge.js      Pipeline events → harness alerts
│  │  ├─ quality-gate.js        Pipeline-side quality checks (price/image min)
│  │  ├─ activity-log.js        Records pipeline activity
│  │  ├─ analytics.js           Pipeline-level analytics
│  │  ├─ purge.js               Stale data cleanup
│  │  ├─ types.js               Shared JSDoc shapes
│  │  └─ drift-scheduler.js     pickNextHouseForDrift (round-robin)
│  │
│  ├─ harness/                  ★ SELF-HEALING + QUALITY ASSURANCE
│  │  ├─ manager.js             Orchestrator (754 lines — split candidate)
│  │  ├─ alert-router.js        fireAlert({type, severity, ...}) — single-arg
│  │  ├─ house-health.js        Circuit breakers (3 fails → cooldown)
│  │  ├─ quality-gate.js        Min 3 lots, ≥60% core field coverage
│  │  ├─ regression-detector.js Lot-count drop >50% / image drop >30pp
│  │  ├─ extractor-generator.js AI-generated DOM extractors (rate-limited)
│  │  ├─ house-discovery.js     New-house discovery (20 credits/wk budget)
│  │  ├─ data-contract.js       Lot schema validation + quality scoring
│  │  ├─ enrichment-engine.js   Cross-lot inference + cache carryforward
│  │  └─ sub-agents.js          Periodic audits + status drift
│  │
│  ├─ rentals/                  ★ Rental-comps scrapers (rollout #7)
│  │  ├─ index.js               Orchestrator + drainStaleRentals + sanity filters
│  │  ├─ spareroom.js           SpareRoom HTML parser (HTTP)
│  │  ├─ onthemarket.js         OnTheMarket dataLayer parser (HTTP)
│  │  └─ openrent.js            OpenRent (Firecrawl — needs JS render)
│  │
│  └─ quality/
│     ├─ field-source.js        setField(lot, k, v, source) — provenance stamp
│     └─ lot-quality.js         Lot quality scoring (computeLotQuality)
│
├─ migrations/                  Numbered SQL migrations (apply via Supabase MCP)
├─ schema.sql                   Current schema reference
├─ tests/                       Custom-assert tests (no test framework)
├─ scripts/
│  ├─ audit.mjs                 Per-house extractor health monitor (nightly cron)
│  ├─ visual-audit.mjs          Cross-house visual audit (Puppeteer + screenshots)
│  └─ audit/                    Persistent fingerprints
├─ Dockerfile                   Railway deployment (node:20-slim + Chromium)
└─ .claude/skills/
   ├─ auction-conventions/      MUST invoke before code edits
   └─ auction-self-healing/     Triggered by /heal or 0-lot regressions
```

---

## Data flow: lot from scrape to display

```
                  ┌────────────────┐
   user/cron ─►   │ /api/analyse   │       routes/analyse.js
                  └───────┬────────┘
                          │
                          ▼
                  ┌────────────────┐
                  │ autoAnalyseAll │       lib/analysis.js
                  │ (per-house)    │
                  └───────┬────────┘
                          │
                          ▼
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
 ┌───────────┐    ┌───────────────┐   ┌───────────┐
 │ Firecrawl │ ──►│   Puppeteer   │──►│   HTTP    │   lib/scraper/rendering.js
 │ (primary) │    │  (fallback)   │   │ (last)    │   "three-tier fallback"
 └─────┬─────┘    └───────┬───────┘   └─────┬─────┘
       └──────────────────┼─────────────────┘
                          ▼
                  ┌────────────────┐
                  │  raw HTML      │
                  └────────┬───────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  extractWithJSDOM       │   lib/extractors/index.js
              │  (per-house DOM)        │
              └────────────┬────────────┘
                           │
                  if <3 lots returned ──┐
                                        ▼
                          ┌─────────────────────────┐
                          │  extractLotsWithAI      │   lib/scraper/extraction.js
                          │  (Gemini Flash/Pro)     │   (rate-limited)
                          │                         │
                          │  +DOM→Gemini merge:     │   (preserves URLs/imgs)
                          │   re-runs DOM, fills    │
                          │   in url+imageUrl by    │
                          │   lot-number match      │
                          └────────────┬────────────┘
                          │
                          ▼
                  ┌────────────────┐
                  │  raw lots[]    │
                  │  ._scrapedAt   │
                  │  ._scrapeMethod│
                  │  ._extractStrategy
                  └────────┬───────┘
                           │
                           ▼
         ┌────────────────────────────────────┐
         │  enrichLots (lib/enrichment.js)    │
         │  Per lot, in parallel waves:       │
         │   • OS Places (FIRST-CONTACT only) │  → uprn, lat, lng, classification
         │   • EPC API                        │  → epc_rating, epc_score, sqft
         │   • Flood API                      │  → flood_zone, flood_risk
         │   • postcodes.io geocode (fallback)│  → lat, lng
         │   • Land Registry comps            │  → street_avg, street_sales
         │   • Rental comps (5-tier+HMO)      │  → est_monthly_rent, est_gross_yield
         │   • estimateMonthlyRentSmart       │
         │  Each call records status into     │
         │  lot.enrichment_manifest (JSONB)   │
         └────────────────┬───────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  analyseLot           │   lib/pipeline/scoring.js
              │  (the ONE scorer)     │   "Score 0-10, clamped"
              │                       │
              │  Adds opps/risks,     │
              │  score, scoreBreakdown│
              │                       │
              │  Yield-scoring gated  │
              │  on manifest to       │
              │  prevent double-count │
              └───────────┬───────────┘
                          │
                          ▼
            ┌─────────────────────────────┐
            │ qualityGate (pipeline-side) │   lib/pipeline/quality-gate.js
            │  • Strip promo cards        │
            │  • Reject prices outside    │
            │    £1k–£50M                 │
            │  • Reject batch <30%        │
            │    price+image coverage     │
            └─────────────┬───────────────┘
                          │
                          ▼
            ┌──────────────────────────────┐
            │ persist-lots / persist-stage │
            │  • Compute snapshot_hash     │
            │    (price|status|sold|...)   │
            │  • Upsert to `lots`          │
            │  • Append `lot_history`      │
            │  • Stamp `field_sources`     │
            │  • Persist manifest JSONB    │
            └──────────────┬───────────────┘
                           │
                  ┌────────┴────────────┐
                  ▼                     ▼
           ┌────────────┐         ┌─────────────────┐
           │ harness    │         │ regression-     │
           │ qualityGate│         │ detector        │
           │ (policy)   │         │ (lot-count drop)│
           └────────────┘         └─────────────────┘
                                          │
                                          ▼ on regression
                                  ┌──────────────┐
                                  │  fireAlert   │ → pipeline_alerts table
                                  └──────────────┘

       Front-end: /api/all-lots → dbRowToFrontendLot → app.js renderLots
```

**Fields and where they originate:**

| Field | Primary source | Fallback | Provenance stamped? |
|---|---|---|---|
| `address` | DOM extractor | Gemini AI / OS Places canonical | partial |
| `postcode` | DOM extractor / address regex | OS Places | partial |
| `uprn` | OS Places API | none — null if no UPRN | yes (`os-places`) |
| `lat`, `lng` | OS Places UPRN lookup | postcodes.io geocode | partial |
| `os_classification` | OS Places (RD/CR/etc) | none | yes |
| `price` / `priceText` | DOM extractor | Gemini AI | partial |
| `beds` | DOM extractor | EPC API / bullets parse | sparse |
| `tenure` | DOM / Gemini prompt | detail-page scrape | sparse |
| `sqft` | DOM | EPC API | sparse |
| `epc_rating` / `epc_score` / `epc_date` | EPC API | none | yes |
| `flood_zone` / `flood_risk` | Environment Agency API | none | yes |
| `street_avg` / `street_sales` | Land Registry comps | none | yes |
| `est_monthly_rent` | postcode_rentals comps (5-tier + HMO) | static VOA table | `_rentSource` |
| `est_gross_yield` | derived | derived | derived |
| `score` | analyseLot | always set | derived |
| `image_url` | DOM extractor / Firecrawl images | two-pass backfill | no |

`field_sources` JSONB column captures provenance **only on new code paths** that explicitly call `setField(lot, key, value, source)` from `lib/quality/field-source.js`. Old paths (most DOM extractors) write directly. This is intentional, sparse-by-design — but creates audit blind spots for existing field-quality issues.

---

## Tables in the database

Active tables and their write paths:

| Table | Row semantic | Write path |
|---|---|---|
| `lots` | 1 per (house, url) — SSOT | `lib/pipeline/persist-lots.js` |
| `lot_history` | 1 per scrape when fields change | `persist-lots.js` (snapshot_hash dedup) |
| `lot_status_history` | 1 per status transition | persist on status change |
| `lot_details` | 1 per detail-page URL (30-day TTL) | `lib/scraper/lot-detail.js` |
| `cached_analyses` | 1 per catalogue URL (legacy 7-day cache) | `routes/analyse.js` |
| `os_places_cache` | 1 per address (90-day TTL) | `lib/os-places.js` |
| `enrichment_cache` | 1 per (provider, query) | `lib/enrichment.js` |
| `image_classifications` | 1 per image URL (90-day TTL) — vision verdict cache | `lib/pipeline/image-quality-filter.js` |
| `house_skills` | 1 per house slug | `lib/harness/manager.js` |
| `auction_calendar` | 1 per (house, date, url) | `routes/calendar.js` admin |
| `pipeline_alerts` | 1 per alert event | `lib/harness/alert-router.js` |
| `discovery_candidates` | 1 per candidate URL | `lib/harness/house-discovery.js` |
| `manager_cycles` | 1 per harness cycle | `manager.js` |
| `users` | 1 per email | `routes/auth.js` |
| `user_lot_actions` | 1 per (user, house, url) — likes/analysed | `routes/user-data.js` |
| `user_deal_scenarios` | 1 per saved deal | `routes/user-data.js` |
| `saved_searches` | 1 per saved query | `routes/search.js` |
| `unsold_alerts` | 1 per user | preferences route |
| `analytics_snapshots` | 1 per date | nightly `scripts/audit.mjs` |
| `rate_limits` | 1 per (ip, date) | `increment_rate_limit` RPC |
| `ai_usage` | 1 per AI call | `routes/analyse.js`, `search.js` |
| `processed_webhook_events` | 1 per Stripe event_id | `routes/stripe.js` |
| `postcode_rentals` | 1 per scraped listing | `lib/rentals/index.js` |
| `postcode_rental_freshness` | 1 per (postcode, source) — cadence | `lib/rentals/index.js` |
| `postcode_sales` | 1 per LR sale | `lib/enrichment.js` (LR pull) |

The `lots` table has **40 columns** grouped: identity + provenance, address, pricing, property attributes, enrichment, scoring, signals, text/search, media, auction timing, field provenance.

---

## AI search — `/api/smart-search`

Two-layer architecture:

**Layer 1 — DB filtering** (`routes/search.js:687 buildLayer1Query`)
- Parses query into hard filters (price, beds, tenure) + soft concepts (multi_unit_freehold, hmo_conversion, development, flip, buy_to_let, deal_stack)
- 3-tier relaxation: strict → location-only → wildcard
- Returns up to 400 candidate lots

**Layer 2 — Gemini Flash semantic re-rank**
- Sends candidate summaries + user intent + concept hints to Gemini Flash
- Output: `{indices: [0, 5, 12, …], report: "commentary"}`
- ~1k-2k tokens in / ~500 tokens out per call (~$0.003 each on paid tier)

**Caching**
- In-memory `_smartSearchCache` (Map) with 5-min TTL, keyed on `query + filters`

**Rate limits**
- Gemini: 15 RPM / 1500 RPD (free tier safety via `GEMINI_MIN_GAP_MS=4100`)
- Per-user: configurable daily search quota (free / paid tier)

**Fallback when Gemini unavailable**
- Layer 1 results returned unranked

---

## Self-healing

Three trigger paths:

1. **Inline** — `autoAnalyseAll()` detects 0-lot regression vs last scrape → calls `healBrokenHouse(slug, oldUrl)` in `lib/pipeline/healing.js`. Looks up homepage via Firecrawl, asks Gemini Pro to find new catalogue URL, verifies, updates `auction_calendar`. Cooldown 24h → 48h → 96h (max 7d) per house.

2. **Sweep** — at end of each scrape pass, `autoAnalyseAll` checks unresolved `extractor_regression` alerts and retries.

3. **Manual** — `POST /api/admin/heal` with `{slug}` (or no body to view status).

Plus the **`auction-self-healing` skill** (`.claude/skills/`) — a human/Claude playbook for diagnosing more complex breakage classes (URL rotation, captcha block, image bleed, address mangling, etc.). Triggered by user signals like "house X showing 0 lots" or unresolved `pipeline_alerts` rows.

Cost per heal attempt: ~1-3 Firecrawl credits + 1 Gemini Pro call.

---

## Where data drops (known weakness areas)

1. **Image coverage** — typically 60-80%, not the >90% you'd want. Two-pass backfill (`backfillImagesWithFirecrawl`/`backfillImagesWithPuppeteer`) helps but isn't run on every scrape.

2. **OS Places first-contact-only** — UPRN, canonical address, lat/lng never refreshed. Stale for lots that change catalogue systems.

3. **Land Registry: infra exists but underused** — `enrichment-manifest.js` defines `recordLandRegistry()` statuses, but the actual call site is sparse. Title number, ownership, charges not captured at all. **Biggest data-richness gap vs propertyauction.io.**

4. **Field-source provenance is sparse** — only new code paths stamp it. Most DOM extractors do direct assignment. Limits debugging when data looks wrong.

5. **No aggregate field-coverage dashboard** — no "% of lots missing EPC" / "% missing UPRN" view. Each manifest is per-lot only.

6. **DOM→Gemini merge intentionally drops DOM-only lots** — when DOM returns 5 and Gemini returns 2, the 3 DOM-only lots are lost. Optimised for Gemini accuracy over coverage.

---

## Hard rules (carry over from CLAUDE.md)

- **Score range 0–10, always clamped** (`Math.max(0, Math.min(10, ...))`)
- **Firecrawl primary, Puppeteer fallback, HTTP last** — never reverse
- **Silent failures banned** — every skipped/failed lookup records a reason in the manifest
- **Manifest gating on yield + below-market** — `canScoreYield`, `canScoreBelowMarket` prevent double-count
- **`lib/scoring.js` was deleted** — never reintroduce, use `lib/pipeline/scoring.js::analyseLot`
- **Harness alerts use `fireAlert({ type, severity, ... })` — single destructured object**
- **Don't reintroduce `server.js` monolith** — logic stays in `routes/`, `lib/`, `lib/pipeline/`

---

## Open simplification opportunities (priority ranked)

| # | Action | Status | Impact | Effort |
|---|---|---|---|---|
| 1 | Slim CLAUDE.md — drop stale file sizes, aspirational agent skills, double-counted scoring rows | ✅ done (`ca3f2b1`) | Reduces context bloat on every session | XS |
| 2 | Remove `auditLotFreshness()` (38 unused lines in sub-agents.js) | ✅ done (`5dc5f3c`) | Dead code | XS |
| 3 | Tighten `initGenerator(supabase, callAI)` — supabase param is unused | ✅ done (`5dc5f3c`) | Trivial cleanup | XS |
| 4 | Manager-on-failure trigger — only run cycle when alerts unresolved | ✅ done (Step 1 of Path 1, this commit) | ~95% Gemini cost cut for harness | XS |
| 5 | Extractor reliability + enrichment safeguards | ⏭ next session (Step 2 of Path 1) | Investor value: thorough lot data | M-L |
| 6 | Harness file flatten — Scenario A | ⏳ scheduled — remote agent fires 2026-05-30, decision based on `manager_cycles` data. Plan captured in `docs/PLANNED-harness-cleanup.md` | Codebase clarity | M |
| 7 | Add `/api/admin/field-coverage` dashboard — % of lots with each field populated | open | Surfaces data-quality drift before users see it | S |
| 8 | Wire Land Registry beyond comps — title number, ownership, charges | open | Biggest data-richness lever | M |
| 9 | Refresh OS Places on lots whose URL changed catalogues (not just first-contact) | open | Closes the "stale UPRN" weakness | S |
| 10 | Detail-page extraction on every lot (currently first-contact only) | open | Better tenure/lease/sqft coverage | M |
| 11 | Consolidate `dbRowToLot` and `dbRowToFrontendLot` (drift risk) | open | Maintenance | S |
| 12 | Move scheduled jobs from `server.js` Express callback to dedicated worker | open (env-gated since `c09179d`; needs Railway service) | Multi-instance scale | S |

---

## Pointers for fresh context windows

- **Scraping a new house?** → `auction-conventions` skill, `lib/extractors/houses/` for examples.
- **Self-healing?** → `auction-self-healing` skill.
- **Adding a DB column?** → migration in `migrations/`, then update `LOTS_SELECT` in `lib/pipeline/lot-mappers.js`.
- **Adding an enrichment source?** → record statuses in `lib/enrichment-manifest.js`, gate via manifest before scoring.
- **Frontend change?** → edit `public/app.js` or `public/styles.css`, NOT inline in `index.html` (the env-shim block at lines 564-568 stays inline).
