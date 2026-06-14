# AuctionBrain — UK Property Auction Directory

A free public auction directory and AI-powered deal analyser at [bridgematch.co.uk](https://bridgematch.co.uk).

Covers upcoming auction dates across all major UK houses, with a continuously updated lot database, AI scoring of every lot for investment potential, title split detection, UPRN enrichment, rental yield comps, and bridging finance fundability via BridgeMatch.

---

## The Goal

**Become the place UK auction buyers start their search — then monetise the traffic.**

The thesis is simple: a free, complete, continuously fresh directory of every UK auction lot, with intelligent assessment built in (scores, value estimates, yields, risk flags, finance checks), grows to tens of thousands of monthly users. That audience is monetised through bridging-finance leads (BridgeMatch), advertising/sponsorship, and premium tools — in that order, because finance leads pay from the first hundred users while display ads only pay meaningfully past ~50k sessions/month.

Every change should advance one of four pillars:

| Pillar | Meaning |
|---|---|
| **Coverage** | Every lot, every house, fresh and accurate — the moat |
| **Trust** | Assessment users believe: scoring, value estimates, risk flags |
| **Growth** | Indexable pages, shareable lots, alerts that bring users back |
| **Revenue** | Finance leads first; ads and subscriptions as traffic compounds |

If a change doesn't move one of these, question it. The phased roadmap lives in `WORKSTREAMS.md`.

---

## Live URLs

| URL | Purpose |
|---|---|
| `bridgematch.co.uk/auctions` | Upcoming auction dates directory |
| `bridgematch.co.uk/analyse` | AI-powered catalogue analyser |
| `bridgematch.co.uk/admin` | Admin dashboard (authenticated) |
| `bridgematch.co.uk/admin-curator` | Lot curation interface (authenticated) |

---

## Architecture
Railway Worker Process (background)
├── Adaptive scrape scheduler  →  Firecrawl (primary)
│                                  Markdown recogniser (per-house + AuctionHouse platform; Bond Wolfe via Crawlee "Load more")
│                                  Gemini fallback (Flash / Pro)
│                                  Allsop JSON API (direct exception)
│                                  Puppeteer (browser fallback)
├── Self-healing harness       →  healBrokenHouse() + circuit breakers
├── Enrichment pipeline        →  UPRN (OS Places) + EPC + value estimator
│                                  OpenRent rental comps
│                                  BridgeMatch fundability badge
├── Post-auction sweep         →  Phantom lot removal + status transitions
├── Weekly digest              →  Email + Telegram
└── Alert sweeper              →  Saved search notifications
Railway Web Process (HTTP)
├── Express server (server.js → routes/)
├── GET  /api/auctions         →  Upcoming auction dates + lot counts
├── POST /api/analyse          →  On-demand catalogue analysis
├── GET  /api/lots/:id         →  Individual lot detail
├── GET  /api/admin/*          →  Admin routes (authenticated)
└── GET  /                     →  Serves index.html
Supabase (Postgres)
├── lots                       →  Current lot state + enrichment_manifest
├── lot_events                 →  Append-only event log (the only active event table)
├── lot_history_archive        →  Archived 2026-06-04 — read-only legacy history
├── lot_status_history_archive →  Archived 2026-06-04 — read-only legacy history
├── scrape_health_daily        →  Per-house daily health metrics
├── house_skills               →  Per-house scraping config
├── catalogue_snapshots        →  Change detection cache
├── leads                      →  User registrations
└── cached_analyses            →  Analysis result cache

---

## Scraping Pipeline

The pipeline is strictly ordered. Never reverse it.

**1. Firecrawl JSON extract** (primary)
AI-driven extraction with no per-house DOM code. Handles single-page and paginated catalogues. `changeTracking` short-circuits unchanged pages at ~1 credit. Lives in `lib/pipeline/firecrawl-extract.js`. Called via HTTP fetch — no SDK.

**2. Markdown recogniser** (optional per-house override)
In `HOUSE_RECOGNISERS` — currently Pattinson, John Pye, McHugh & Co, Mark Jenkinson, Maggs & Allen, Hollis Morgan, Nesbits, Bond Wolfe, Property Solvers, Auction House London, and BTG Eddisons (the SDL-network catalogue under the `sdl` slug), plus the Auction House UK platform recogniser shared across the ~33 `auctionhouse.co.uk/{region}` franchise sites. Reads the same markdown (Firecrawl's, or the turndown bridge's when Crawlee renders) to recover lots the JSON extractor missed. Some houses (e.g. Nesbits) list lots as image-only links with no inline text — the recogniser harvests the lot URLs and seeds the address from the URL slug, leaving the first-contact deep-fetch to fill price/date/beds. Recogniser URL regexes are host-tolerant (`(?:www\.)?`) because Crawlee renders on whichever host the calendar URL uses. On the Crawlee path the recogniser also corroborates the AI extractor: for lot ids both saw, the recogniser's deterministically-parsed status (and hero image, when the extractor has none) wins — AI status inference smears SOLD/STC across overlay-heavy pages. Some houses (e.g. Bond Wolfe) append their catalogue via a WordPress "Load more" button behind Cloudflare with a JS-injected ajax nonce, so a plain-HTTP API consumer is impossible — the Crawlee render clicks "Load more" to exhaustion (`CLICK_TO_LOAD_SELECTORS` in `crawlee.js`) before the recogniser parses the rendered cards.

**3. Gemini fallback** (fires when Firecrawl returns 0 lots)
Flash model for known houses, Pro for unknown houses or PDF catalogues. SDK: `@google/generative-ai`.

**4. Allsop JSON-API exception**
`lib/scraper/allsop.js` consumes Allsop's private JSON endpoint directly. Zero API credits, ~50ms/page. Not a scraper — a structured API consumer.

**5. Puppeteer** (browser fallback for JS-heavy pages)
Full headless Chrome. Heavier than Firecrawl. Used for pages that require a real browser session. SDK: `puppeteer`.

**6. Symonds & Sampson CF-stealth exception**
`lib/scraper/symondsandsampson.js` — `auctions.symondsandsampson.co.uk` is behind Cloudflare, which 403s every engine except Firecrawl's residential `proxy:'stealth'`. A bespoke two-tier scraper resolves the soonest upcoming event from the stable events page, then parses its `/property/{id}/{postcode}/{town}/{slug}` lots. Dispatched on `paginateAs:'symondsandsampson_stealth'` (mirrors the Allsop exception). Stealth costs ~5 credits/scrape, so it scrapes only the soonest event — the events page lists lots ~6 weeks pre-auction, so later events are empty.

> **DOM extractors were retired 2026-05-08.** `lib/extractors/` was deleted. References to `USE_FIRECRAWL_EXTRACT`, `FORCE_EXTRACT_HOUSES`, `BROKEN_EXTRACTORS`, or DOM→Gemini merge code are stale — flag them.

---

## Self-Healing Harness

`lib/harness/` handles autonomous recovery from scraper failures.

- **`healBrokenHouse()`** — when a house returns 0 lots, searches for the new catalogue URL via Firecrawl + Gemini with exponential cooldown (24h → 7d backoff).
- **Circuit breakers** (`house-health.js`) — 3 consecutive failures → auto-skip with backoff.
- **Recall sentinels** — every house should have a recall pattern. EIG / AH UK / Bamboo platforms are auto-detected by `detectPlatformSentinel()` in `lib/analysis.js`. Non-platform houses need a `RECALL_SENTINELS[slug]` regex.
- **Auction-date precedence** (`persist-lots.js`) — a lot's date resolves as **bullets → recogniser/scraper-parsed `_auctionDate` → catalogue/calendar**. A recogniser that parses the date itself (BTG Eddisons from the lot id's `-DDMMYY`, Auction House London from the "All Lots for …" header, symondsandsampson from the event) beats a stale/past calendar row or a `2099` `always_on` placeholder — the rolling-URL fix that keeps freshly-scraped catalogues live.
- **Telegram alerts** — self-healing reports delivered via `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`.

Invoke the `auction-self-healing` skill for the full diagnose-classify-fix-verify-report playbook.

---

## Enrichment Pipeline

After lot extraction, each lot is enriched with:

| Source | Data | API |
|---|---|---|
| OS Data Hub | UPRN, canonical address, lat/lng | `OS_DATA_HUB_KEY` (free 100k/mo) |
| EPC (Get energy performance of buildings data) | Energy rating band + score + floor area | `EPC_API_TOKEN` (Bearer; new API since the old one retired 30 May 2026) |
| EPC — on-page fallback | Band scraped from the listing/detail page ("EPC rating: D") when the address→API match can't run (number withheld) | `lib/scraper/lot-detail.js:extractEpcBand` |
| OpenRent | Rental comparables for yield | HTTP fetch |
| BridgeMatch | Bridging finance fundability badge | `BRIDGEMATCH_API_URL` |
| Value estimator | Estimated market value | `lib/pipeline/value-estimator.js` |

Every enrichment result (success or failure) is recorded in `lots.enrichment_manifest`. Silent failures are banned — every skipped lookup records a reason.

---

## Scoring System

`lib/pipeline/scoring.js:analyseLot()` — score range **0–10**, always clamped.

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
| Good yield (6–8% GIY) | +1.5 |
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

Manifest gating prevents double-counting: `canScoreYield` and `canScoreBelowMarket` gates must pass before yield or below-market signals are applied.

---

## Tech Stack

### Runtime dependencies (package.json)

| Package | Version | Purpose |
|---|---|---|
| express | ^4.21.0 | Web server |
| puppeteer | ^24.0.0 | Browser automation fallback |
| @google/generative-ai | ^0.24.1 | Gemini AI fallback |
| @supabase/supabase-js | ^2.45.0 | Database |
| @sentry/node | ^8.0.0 | Error monitoring |
| stripe | ^20.4.0 | Payments |
| jose | ^5.0.0 | JWT authentication |
| sharp | ^0.34.5 | Image processing |
| jsdom | ^24.0.0 | DOM parsing |
| yauzl | ^3.3.0 | ZIP/catalogue file handling |
| compression | ^1.8.1 | HTTP response compression |

### External services called via HTTP (no SDK)

| Service | Purpose |
|---|---|
| Firecrawl | Primary scraper — no version pin |
| OS Data Hub | UPRN + canonical address |
| OpenRent | Rental comparables |
| BridgeMatch API | Fundability badge |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API |
| `FIRECRAWL_API_KEY` | Primary scraper |
| `FIRECRAWL_MONTHLY_BUDGET` | Credit cap (see `lib/resource-budget.js`) |
| `FIRECRAWL_SKIP_HOUSES` | Comma-separated slugs to bypass Firecrawl |
| `OS_DATA_HUB_KEY` | UPRN enrichment (free 100k/mo) |
| `EPC_API_EMAIL` / `EPC_API_KEY` | EPC register |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public Supabase key |
| `SUPABASE_SERVICE_KEY` | Server-side writes |
| `BRIDGEMATCH_API_URL` | Fundability badge API base |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Self-healing alerts |
| `STRIPE_SECRET_KEY` | Payment processing |
| `SENTRY_DSN` | Error monitoring |
| `ROLE` | `web` / `worker` / unset (single process) |

---

## Development

```bash
npm install
cp .env.example .env
# populate with real API keys
npm run dev        # runs with --watch, opens at http://localhost:3000
```

### Running tests

```bash
npm test           # runs all 78 test files
```

Key test files: `test-scoring.js`, `test-harness.js`, `test-enrichment.js`, `test-healing-agent.js`, `test-recall.js`, `test-fundability.js`, `test-manifest.js`.

---

## Deploy to Railway

The project deploys automatically to Railway on push to `main`.

Two processes run separately:
- `npm run start:web` (`ROLE=web`) — HTTP server only
- `npm run start:worker` (`ROLE=worker`) — HTTP + all background schedulers

Add all environment variables from the table above in Railway → Service → Variables.

---

## Known Structural Debt

These are documented open issues, not bugs:

1. **UPRN enrichment down** — OS Places has returned 429 on every live call since mid-May (account/plan-side; the code remediation landed). Runbook in WORKSTREAMS.md.

2. **Stale JSDoc references** — five files still reference deleted symbols (`dbRowToFrontendLot`, `normaliseLot`). See WORKSTREAMS.md for specific locations.

3. **Helper duplication** — `looksLikeRealAddress`, `stripEigCatalogueParams`, `PLACEHOLDER_PHRASES`, `UK_POSTCODE_RE` exist in both `lib/pipeline/firecrawl-extract.js` and `lib/types/lot.js`. Intentional during transition; long-term should consolidate to `lib/types/lot.js`.

---

## Sister Projects

**BridgeMatch / Bridging-Brain** — Python FastAPI, ~50+ UK lender database. Repo: `monlamltd-collab/Bridging-Brain`. Integration live via `lib/fundability.js`. See `AUCTION_REPO__BRIDGING_FINANCE_KNOWLEDGE_PACK.md` for domain knowledge.

**ContentBrain** — the outward-reach programme for both AuctionBrain and BridgeMatch: automated social/content distribution and audience acquisition. Repo: `monlamltd-collab/ContentBrain`. Outbound marketing lives there; this repo owns the indexable surface and on-site conversion.

---

## Non-Negotiables

- **Firecrawl primary, Puppeteer fallback, HTTP last** — never reverse
- **Score range 0–10**, always clamped (`Math.max(0, Math.min(10, ...))`)
- **Silent failures banned** — every skipped/failed lookup records a reason in `lots.enrichment_manifest`
- **`lib/scoring.js` was deleted** — never reintroduce; use `lib/pipeline/scoring.js::analyseLot`
- **No server.js monolith** — logic lives in `routes/`, `lib/`, `lib/pipeline/`, `lib/harness/`
- **Frontend edits** go in `public/app.js` / `public/styles.css`, NOT inline in `index.html`
- **Do not modify `bridgematch-lite.html`** without explicit confirmation — logic is fragile
- **Harness alert signature** — always `fireAlert({ type, severity, house, message, meta })`

---

*Last updated: June 2026*
