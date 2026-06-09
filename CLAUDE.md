# CLAUDE.md — AuctionBrain (Bridgematch Auction Tool)

UK property auction directory + AI catalogue analyser. Live at [bridgematch.co.uk](https://bridgematch.co.uk).

**Owner:** Simon Deeming · **Repo:** `monlamltd-collab/Auction` · **Hosting:** Railway · **Stack:** Node.js (Express), Firecrawl (primary scraper), Google Gemini, Puppeteer, Supabase, vanilla JS frontend.

**Architecture map:** `docs/ARCHITECTURE.md` — file layout, data flow, tables, weakness audit. Read that first if you've just opened this codebase. For coding conventions, naming, file structure, testing, scoring rules, and "Adding a New Auction House", invoke the `auction-conventions` skill. This file is orientation only.

---

## North Star

**Goal: tens of thousands of monthly users, monetised through bridging-finance leads first, then advertising/sponsorship and premium tools.** The product that gets there: the most complete, freshest, free UK auction search with assessment users trust.

Four pillars, in priority order — every change should advance one, and if it doesn't, flag it instead of building it:

1. **Coverage** — every UK lot, every house, fresh and accurate (the moat)
2. **Trust** — scoring, value estimates and risk flags users believe
3. **Growth** — indexable lot/town/house pages, shareable URLs, alerts that bring people back
4. **Revenue** — finance leads pay from the first hundred users; display ads only pay past ~50k sessions/month

Phased roadmap and status: `WORKSTREAMS.md`.

---

## How the Analyser Works

1. User submits a catalogue URL or selects a house.
2. **Firecrawl** renders the page when needed (Puppeteer fallback, plain HTTP last resort) — `lib/scraper/rendering.js:scrapeRenderedPage`.
3. Lot extraction — every house goes through the same unified path:
   - **Firecrawl JSON extract** — primary, AI-driven, no per-house code (`lib/pipeline/firecrawl-extract.js:extractCatalogueListing`). Handles single-page and paginated catalogues. `changeTracking` short-circuits unchanged pages at ~1 credit.
   - **Markdown recogniser** — optional per-house function in `HOUSE_OVERRIDES` (currently Pattinson + John Pye) reads the same Firecrawl markdown response to recover lots the JSON extractor missed. Firecrawl-at-heart by definition.
   - **Gemini fallback** — fires only when Firecrawl JSON returns 0 lots (Flash for known houses, Pro for unknown / PDF).
   - **Allsop JSON-API exception** — `lib/scraper/allsop.js` consumes Allsop's private JSON endpoint directly (zero credits, ~50ms/page). Structured API consumer, not a scraper.
4. `analyseLot()` (`lib/pipeline/scoring.js`) scores each lot 0–10.
5. Results written to `lots`; events written to `lot_events` (source of truth — see Database section).
6. Enrichment pipeline runs: UPRN (OS Places), EPC, OpenRent rental comps, BridgeMatch fundability, value estimator.
7. Frontend (`public/app.js`) renders with filters.

> **DOM extractors retired 2026-05-08.** `lib/extractors/` was deleted along with `tests/snapshots/`, `tests/test-extractors.js`, `tests/test-detail-extractors.js`, and `scripts/audit*.mjs`. The `USE_FIRECRAWL_EXTRACT` env var, `FORCE_EXTRACT_HOUSES` safelist, `BROKEN_EXTRACTORS` set, and DOM→Gemini merge code are all gone. If you find references to any of these, they are stale — flag them.

### First-contact maximisation

On a brand-new lot URL, the pipeline forces a detail-page fetch + OS Places API lookup (UPRN, canonical address, lat/lng) and writes a `lot_events` record. See `lib/pipeline/persist-lots.js`.

### Recall sentinels

Every house should have a recall pattern. EIG / AH UK / Bamboo platforms are auto-detected by `detectPlatformSentinel()` in `lib/analysis.js`. For non-platform houses, add a `RECALL_SENTINELS[slug]` regex.

---

## Scoring & Self-Healing

- **Source of truth for scoring signals & weights:** `lib/pipeline/scoring.js:analyseLot()` (lines 114–151). Score range **0–10**, always clamped (`Math.max(0, Math.min(10, ...))`).
- Manifest gating prevents double-counting: `canScoreYield` / `canScoreBelowMarket` gates must pass before those signals are applied.
- Self-healing harness lives in `lib/harness/`. When a house returns 0 lots, `healBrokenHouse()` searches for the new catalogue URL via Firecrawl + Gemini, with exponential cooldown (24h → 7d). Invoke the `auction-self-healing` skill for the full diagnose-fix-verify-report playbook.
- Circuit breakers (`house-health.js`): 3 consecutive failures → auto-skip with backoff.
- Harness alert signature — always `fireAlert({ type, severity, house, message, meta })`. Never positional arguments.

---

## Database

**Write to `lot_events` only.** The legacy history tables were archived on 2026-06-04 (`migrations/2026-06-04-archive-lot-history.sql` — renamed with all rows preserved):

| Table | Status | Use |
|---|---|---|
| `lot_events` | Active — the only event table | Write all events here |
| `lot_history_archive` | Archived (was `lot_history`; ~297k rows back to 2026-04-26) | Read-only — pre-`lot_events` history |
| `lot_status_history_archive` | Archived (was `lot_status_history`; ~39k rows) | Read-only — pre-`lot_events` status history |

Other key tables:

| Table | Purpose |
|---|---|
| `lots` | Current lot state + `enrichment_manifest` |
| `scrape_health_daily` | Per-house daily health metrics |
| `house_skills` | Per-house scraping config |
| `catalogue_snapshots` | Change detection cache |
| `leads` | User registrations |
| `cached_analyses` | Analysis result cache (JSONB blob — untyped, validate on read) |

**Known data model notes (from WORKSTREAMS.md):**
- `bullets` field has two semantic shapes upstream. Needs reconciliation in `normaliseScrapedLot` — flag if behaviour changes.
- `auction_date` has no timezone handling. Europe/London is assumed implicitly throughout.
- `dbRowToLot` emits `enrichedAt` and `rawText` but canonical `LOTS_SELECT` doesn't fetch those columns — they resolve to `undefined` unless the caller expands their select.

---

## Runtime Dependencies

From `package.json`:

| Package | Purpose |
|---|---|
| express ^4.21.0 | Web server |
| puppeteer ^24.0.0 | Browser automation fallback |
| @google/generative-ai ^0.24.1 | Gemini |
| @supabase/supabase-js ^2.45.0 | Database |
| @sentry/node ^8.0.0 | Error monitoring — use for failure alerts |
| stripe ^20.4.0 | Payments (pricing route, premium tier) |
| jose ^5.0.0 | JWT authentication |
| sharp ^0.34.5 | Image processing |
| jsdom ^24.0.0 | DOM parsing |
| yauzl ^3.3.0 | ZIP/catalogue file extraction |
| compression ^1.8.1 | HTTP response compression |

**Not in package.json (called via raw HTTP fetch):** Firecrawl, OS Data Hub, OpenRent, BridgeMatch API. No version pinning on these integrations.

---

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API |
| `FIRECRAWL_API_KEY` | Primary scraper |
| `FIRECRAWL_MONTHLY_BUDGET` | Credit cap (see `lib/resource-budget.js`) |
| `FIRECRAWL_SKIP_HOUSES` | Comma-separated slugs to bypass Firecrawl |
| `OS_DATA_HUB_KEY` | UPRN + canonical address (free 100k/mo) |
| `EPC_API_EMAIL` / `EPC_API_KEY` | EPC register API |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY` | Database |
| `BRIDGEMATCH_API_URL` | BridgeMatch API base for fundability badge |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Self-healing alert destination |
| `STRIPE_SECRET_KEY` | Payment processing |
| `SENTRY_DSN` | Error monitoring |
| `ROLE` | `web` (HTTP only) / `worker` (HTTP + schedulers) / unset (single process) |

---

## Non-Negotiables

- **Firecrawl primary, Puppeteer fallback, HTTP last** — never reverse the order
- **Score range 0–10**, always clamped
- **Silent failures banned** — every skipped/failed lookup records a reason in `lots.enrichment_manifest`
- **Manifest gating on yield + below-market** to prevent double-counting
- **`lib/scoring.js` was deleted** — never reintroduce; use `lib/pipeline/scoring.js::analyseLot`
- **Harness alerts** use the single-object signature: `fireAlert({ type, severity, house, message, meta })`
- **Don't reintroduce the `server.js` monolith** — logic lives in `routes/`, `lib/`, `lib/pipeline/`, `lib/harness/`
- **Don't modify `bridgematch-lite.html`** based on bridging finance knowledge without explicit user confirmation
- **Frontend edits** go in `public/app.js` / `public/styles.css`, NOT inline in `index.html`
- **Write all events to `lot_events` only** — the legacy tables are archived (`lot_history_archive`, `lot_status_history_archive`); never write to them

---

## Known Stale Code (do not fix silently — flag first)

From WORKSTREAMS.md open notes:

- **Stale JSDoc in 5 files** — `lib/pipeline/value-estimator.js` (lines 8, 74), `lib/curator/select-picks.js` (line 33), `lib/curator/generate-prose.js` (line 40), `lib/pipeline/cache-enrich-stage.js` (line 23), `lib/pipeline/firecrawl-extract.js` (placeholder-address comment block). All reference deleted symbols `dbRowToFrontendLot` or `normaliseLot`.
- **`lib/types/lot.js` header** — "Migration status" block (lines ~53–62) says migration is pending but it completed in commit `1a73fe1`. Comment-only, no functional impact.
- **`lib/types/lot.js:89`** — lists `floor_plan_url` as intentionally omitted from `LOT_COLUMNS` but it was added at line 118 in `ea1b454`. Remove from the "intentionally OMITTED" list.
- **Helper duplication** — `looksLikeRealAddress`, `stripEigCatalogueParams`, `PLACEHOLDER_PHRASES`, `UK_POSTCODE_RE` exist in both `lib/pipeline/firecrawl-extract.js` and `lib/types/lot.js`. Intentional during transition. Long-term: migrate remaining consumers to `lib/types/lot.js` and delete the firecrawl-extract.js copies.
- **`scrape-diff.js` key order** — keys lots by `l.lotNumber || l.address || l.lot`. After canonical-shape migration `l.lotNumber` is always undefined so it keys by `l.address`. Should be `l.lot || l.address`. Pure refactor, no behaviour change.
- **`lib/pipeline/persist-lots.js:128`** — JSDoc still says "append-only inserts to the lot_history table"; superseded by the 2026-06-04 archive migration (the correct note is at line 561).

---

## Sister Projects

**BridgeMatch / Bridging-Brain** — Python FastAPI, ~50+ UK lender database. Repo: `monlamltd-collab/Bridging-Brain`. Integration live via `lib/fundability.js` calling `${BRIDGEMATCH_API_URL}/api/filter`. See `AUCTION_REPO__BRIDGING_FINANCE_KNOWLEDGE_PACK.md` — do not apply to `bridgematch-lite.html` without explicit confirmation.

**ContentBrain** — the outward-reach programme for both AuctionBrain and BridgeMatch: automated social/content distribution and audience acquisition. Repo: `monlamltd-collab/ContentBrain`. Outbound marketing automation belongs there — this repo's growth remit is the indexable surface and on-site conversion.

---

## Skills

- **`auction-conventions`** — invoke before any code edits. Architecture, naming, file structure, API patterns, scoring, manifest stamping, harness alert signature, "Adding a New Auction House".
- **`auction-self-healing`** — invoke when a house returns 0 lots, regresses, or you suspect breakage. Full diagnose-classify-fix-verify-report playbook.
