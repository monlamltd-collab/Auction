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
   - **Markdown recogniser** — optional per-house function (registered in `lib/scraper/house-recognisers.js`) reads the same rendered markdown to recover lots the JSON extractor missed. ~18 houses use one (Pattinson, John Pye, McHugh & Co, Mark Jenkinson, Maggs & Allen, Hollis Morgan, Nesbits, Bondwolfe, Propertysolvers, Auction House London, the Auction House UK platform, BTG Eddisons, Charles Darrow, SDL Auctions, Clive Emson, Purplebricks/GOTO, Edward Mellor, Savills). Some are `staticCatalogue: true` (plain-HTTP SSR sites — BTG Eddisons, Purplebricks/GOTO, Edward Mellor, John Pye, Savills, Sutton Kersh, Future Property Auctions, Bagshaws, Fox & Sons, William H Brown (Norwich) — bypass the browser render). **One recogniser can serve several houses:** `recogniseSequenceBranchLotsFromMarkdown` handles all three Sequence/Connells branches (Bagshaws, Fox & Sons, William H Brown Norwich), which serve an identical hand-built static XHTML template — see the Sequence-branch note below. Edward Mellor and Savills also have a `resolveCatalogueUrl` two-tier drill (landing/calendar → the dated auction page(s)). `resolveCatalogueUrl` may return ONE target or an ordered LIST: Edward Mellor's later dates are genuinely empty so it drills to the soonest, whereas Savills runs several sales concurrently and ALL of them carry live lots, so it returns a page target per sale (soonest-only would ship 94%). Firecrawl-at-heart by definition.
   - **Gemini fallback** — fires only when Firecrawl JSON returns 0 lots (Flash for known houses, Pro for unknown / PDF).
   - **Allsop JSON-API exception** — `lib/scraper/allsop.js` consumes Allsop's `/api/property-search` JSON endpoint directly (zero credits, ~50ms/page). Structured API consumer, not a scraper. `rewriteUrl('allsop', …)` **defaults any allsop URL to the residential property-search API** — a stale calendar row (`/auctions/future-auction-dates`) otherwise fell through and was scraped as raw HTML → 0 lots → `probe=error` stall.
4. `analyseLot()` (`lib/pipeline/scoring.js`) scores each lot 0–10.
5. Results written to `lots`; events written to `lot_events` (source of truth — see Database section).
6. Enrichment pipeline runs: UPRN (OS Places, plus a free fallback that harvests UPRN from matched EPC certificates), EPC, OpenRent rental comps, BridgeMatch fundability, value estimator.
7. Frontend (`public/app.js`) renders with filters.

> **Per-house knowledge** lives in `docs/houses/<slug>.md` (index: `docs/houses/README.md`) — the slug-keyed home for each house's config pointers, quirks, and incident history. Consult it first when touching a house; create/update it when onboarding (`auction-conventions` Step 6.5) or healing (`auction-self-healing` LEARN loop).

> **Duplicate brand-fronts are RETIRED, not scraped.** Several "dark" houses aren't dark — their lots are already captured in full under another slug, so scraping them duplicates properties in the product. `pugh`, `markjenkinson` and `sdl` front the same Eddisons-group auctions as **btgeddisons**, which holds the superset (proven: btgeddisons' "1-4 Salisbury Street, Widnes WA8 6PJ" appears verbatim in markjenkinson's 27-Jul catalogue). `auctionhousenational` is the roll-up of the ~25 auctionhouse.co.uk franchises — they share ONE lot-URL namespace (`online.auctionhouse.co.uk/lot/redirect/{id}`), and since `lots.url` is globally UNIQUE and persist-lots upserts `onConflict:'url'` with `house` in `IDENTITY_FIELDS`, whichever sibling scrapes last **steals** the row. All four are in `RETIRED_HOUSES` (2026-07-22) and 386 duplicate/stale `available` rows were flipped to `withdrawn`. **Before "fixing" a 0-lot house, check whether another slug already carries its lots** — otherwise the fix adds duplicates, not coverage.

> **Sequence/Connells branches are the counter-example — shared host, NOT duplicates.** `bagshaws`, `foxandsons` and `williamhbrownnorwich` all publish their lots on `barnardmarcusauctions.co.uk`, which is *also* an active house (`barnardmarcus`). That looks exactly like the brand-front pattern above and is **not** one: each branch contributes a **disjoint lot-id range** to a shared national sale, and `barnardmarcus`'s own catalogue is the London sale. Verified 2026-07-22 — **zero** lot-URL overlap across all four slugs in `lots`. Scraping all four adds coverage. The test that distinguishes the two cases is the same either way: **group by lot URL and count distinct houses** — brand-fronts collide on the URL, sibling branches do not. Re-run it before onboarding any further Sequence branch (William H Brown Leeds is pending). All three share ONE recogniser, `recogniseSequenceBranchLotsFromMarkdown`, because they serve a byte-identical hand-built static XHTML template; fix the parse once and all three benefit. Dossiers: `docs/houses/{bagshaws,foxandsons,williamhbrownnorwich}.md`.

> **A page is not a lot (`lib/types/lot.js::isNonLotUrl`).** `normaliseScrapedLot` rejects any lot whose detail URL is the site root, an `index`/`default` page, or the catalogue URL itself — that's the page the extractor was standing on, not a lot, and it's what a degraded run emits (usually with the site logo as the image). 47 such rows had reached `lots`, 17 served as `available`; because `lots.url` is globally UNIQUE each one also squats that page's identity slot. An **empty** `detail_url` is allowed through `normaliseScrapedLot` — but it must NOT become the catalogue URL downstream. `buildLotUrl` (`lib/enrichment.js`) used to end `return lot.url || sourceUrl`, stamping the catalogue URL onto every urlless lot; because `lots.url` is UNIQUE a whole degraded batch collapsed onto ONE page-identity row served as a fake `available` lot (the AI extractor path, which never reaches `isNonLotUrl`, is the main producer of urlless lots). Fixed 2026-07-22: `buildLotUrl` returns `''` for a urlless lot, and `persist-lots.js` (a) treats `url == catalogue_url` as urlless → a stable `__synthetic__` key, and (b) runs property-key adoption (postcode|first-address-segment, previously venmore-only) for any synthetic row on ANY house, so the lot UPDATEs its real-URL twin instead of squatting the catalogue URL. Real-URL rows never consult the property map, so the healthy path is unchanged. Covered by `tests/test-normalise-lot.js` Test 9 (`/linked-cottage` is not `/link`) and `tests/test-build-lot-url.js` (a urlless lot never inherits the catalogue URL).

> **EIG card-boundary invariant (do not regress).** EIG-OAS renders a card's metadata header — `### Lot N | End Time - DD/MM/YYYY` — **above** that card's lot anchor. `recogniseEigOasLotsFromMarkdown` therefore slices blocks **header-to-header**, never anchor-to-anchor: anchor slicing hands every card the *following* card's end-date, status badge and lot number, and leaves the last card of a catalogue with no date (→ the `2099-12-31` sentinel). Fixed 2026-07-21 — the off-by-one made `higginsdrysdale` report 0 live lots because its one live lot inherited the next card's "Auction Ended", and the genuine-zero path then persisted nothing, self-perpetuating at 0. Themes that emit no `Lot N` header fall back to anchor slicing unchanged. Affects all ~26 houses in `EIG_OAS_HOUSES`; re-verify tcpa/landwood/firstforauctions after any change here.

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
- **AI-outage gate (`house-health.js::updateHealth`)** — a 0-lot scrape is only counted as a house failure when extraction could actually run. Callers pass `aiUnavailable` (from `getCreditExhausted()`); a zero raised while the AI stack is quota-dead is a **non-event** (health, circuit state and `consecutiveFailures` all left unchanged, logged not silent). Without this, one AI outage trips the WHOLE fleet's breakers and takes healthy houses out of rotation — 46 circuits opened in the 2026-07-15 event and 40 re-tripped within 4 days of a manual reset. A zero while the AI is UP still indicts the house, and recogniser-backed houses never hit this branch (they extract without AI), so real breakage is never masked. The proactive healing sweep (`analysis.js`) is gated the same way — the catalogue URL is not the problem when the extractor is down. Covered by `tests/test-ai-health-gate.js`.
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
- `description` (added 2026-07-04) is the source site's narrative — canonical home for lot prose. Captured at extraction (`normaliseScrapedLot` passthrough + detail pass) and backfilled by the daily 07:00 narrative sweep (`lib/pipeline/narrative-sweep.js`, house-agnostic extraction in `lib/pipeline/description-extract.js`). The bullets fold of `raw.description` remains for display/signal back-compat — don't remove it. Since 2026-07-13 `description` also feeds `analyseLot`'s detection text, and the narrative sweep re-analyses + rebuilds `search_text` after harvesting narrative.
- `deal_signals` / `stated_income_pa` / `income_kind` (added 2026-07-13, contract 3.4.0) — the multi-label deal-archetype layer, written by `analyseLot` via `lib/pipeline/deal-signals.js` (pure regex, no LLM). `deal_type` stays single-label (new `HMO` value). Slugs are literal filter keys — renames are breaking. Vendor-motivation slugs added 2026-07-23: `probate`, `receivership`, `repossession` (outranks receivership when both phrasings appear), `public-sector-disposal`. Scoring risks gained `Subsidence` (−1.5) and `Cladding/EWS1` (−1, defect-context only) the same day; the frontend's red-flag filter (`RED_FLAG_RISKS` in `public/app.js`) screens on the hard subset of `lots.risks`.
- `floor_plans` (jsonb array; was `floor_plan_url` text before the lean rebuild) holds the source site's floor plan(s). Its only writer used to be the Firecrawl JSON extractor, which is gated off — so the column sat empty fleet-wide. It is now backfilled by the daily 07:30 floor-plan sweep (`lib/pipeline/floor-plan-sweep.js`, house-agnostic extraction in `image-extract.js:extractFloorPlansFromHtml`). A plan's URL rarely contains "floor" — the signal is in the surrounding markup (alt/title/href/data-*, a Bootstrap modal, or an embedded JSON array), so match tags, never URLs.
- **Retirement provenance lives INSIDE `enrichment_manifest`, not in columns.** There is no `removed_reason` and no `removed_at` column on `lots` — the stamp is `enrichment_manifest.removed_reason` / `.removed_at` (written by the persist-lots prune; `docs/CRAWLEE-TRIAL-RUNBOOK.md` queries it that way). Naming them at the top level is a silent killer: PostgREST rejects the whole update ("Could not find the 'removed_at' column of 'lots' in the schema cache"), which is why the ghost sweep retired **nothing** from launch until 2026-07-22 while dutifully alerting and retrying. Don't "fix" it by adding the columns — that forks one fact across two homes and halves every existing provenance query. Retire via the **`retire_lots(p_ids, p_manifest_patch, p_allowed_statuses)` RPC** (`migrations/2026-07-22-retire-lots-rpc.sql` + `-allowed-statuses.sql`), which MERGES the stamp (`jsonb ||`) instead of replacing the manifest and only touches rows currently in `p_allowed_statuses` (default `{available}`), so a concurrent sale is never clobbered. A wholesale replace destroys real money: sweep candidates average ~9 manifest keys including paid OS Places lookups, and retired lots often come back via lot-URL churn. Both retirement paths now route through it — the ghost sweep (default guard) and the persist-lots vanished-lot prune, which **must** pass its own `IN_PLAY` set (`available`/`stc`/`unsold`): 53% of real prune flips are `stc`/`unsold`, and the available-only default would strand every one of them in play forever. `tests/test-ghost-sweep.js` Test 9 asserts every flip-patch key against `LOT_COLUMNS`; `tests/test-snapshot-prune.js` Tests 23–24 pin the prune's status set to `IN_PLAY`.
- `auction_date` has no timezone handling. Europe/London is assumed implicitly throughout.
- **`auction_date` must NEVER hold the always_on placeholder.** `calendar.js` stamps rolling/timed catalogue rows `2099-12-31` — that is a CALENDAR marker meaning "no fixed sale date", not a lot's auction date. `persist-lots.js` therefore drops any calendar date `> '2098-01-01'` to `null` before the precedence chain (bullets → recogniser/scraper `_auctionDate` → calendar date). Stamping it on a lot makes the lot **immortal**: `get_active_lots` gates on `auction_date >= current_date-1`, which a year-2099 date passes forever, so only the ghost sweep could ever retire it. Measured 2026-07-22 before the fix: **7,576 of 12,204 lots shown as live (62%) were live ONLY via this sentinel, 3,014 of them unseen for >4 days** — dead stock held visible by a fake date. `null` is the honest value and already the downstream semantics (`routes/search.js` nulls `> '2098-01-01'` on read). Covered by `tests/test-auction-date-sentinel.js`.
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
| `OS_DATA_HUB_KEY` | UPRN + canonical address via OS Places API. **NB OS Places is EXCLUDED from the Premium plan's £1k/mo free allowance** (Royal Mail PAF data) — £0.01/lookup after a 60-day / 2,000-txn trial (trial exhausted 2026-06-14). UPRN is ALSO harvested **free** from matched EPC certificates (`enrichment.js`), so paid OS Places is only needed for non-EPC lots. |
| `EPC_API_TOKEN` | EPC register API — Bearer token for get-energy-performance-data.communities.gov.uk (old `EPC_API_EMAIL`/`EPC_API_KEY` Basic-auth API retired 30 May 2026) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY` | Database |
| `BRIDGEMATCH_API_URL` | BridgeMatch API base for fundability badge |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Self-healing alert destination |
| `CRAWLEE_MAX_CONCURRENCY` | Shared render ceiling for BOTH browser engines (Crawlee fleet + puppeteer.js gate) — `renderConcurrency()` in `lib/config.js`. Default 5, clamp 1–8; set 3 to roll back to the pre-Phase-3 ceiling. Crawlee's AutoscaledPool still governs actual concurrency beneath it (memory-aware; pin the budget with Crawlee's native `CRAWLEE_MEMORY_MBYTES` if cgroup detection misreads). `Crawlee: mem after N renders` log lines show live RSS headroom. |
| `FRESHNESS_PULSE_DISABLED` / `FRESHNESS_PULSE_SKIP` / `FRESHNESS_PULSE_CONCURRENCY` / `FRESHNESS_PULSE_FLAP_HOURS` | Hourly catalogue-change pulse (Tier 20, `lib/pipeline/freshness-pulse.js`) — kill switch / extra skip slugs / probe concurrency (default 2) / flap-damp window (default 3h) |
| `GHOST_SWEEP_DISABLED` / `GHOST_SWEEP_UNSEEN_DAYS` | Daily 05:40 ghost sweep (Tier 21, `lib/pipeline/ghost-sweep.js`) — retires served-but-vanished 'available' lots on actively-scraped houses + long-past-dated stragglers. Kill switch / unseen threshold (default 4d). Per-house partial-scrape gate fires `ghost_sweep_held` alerts instead of hiding real lots. |
| `STRIPE_SECRET_KEY` | Payment processing |
| `SENTRY_DSN` | Error monitoring |
| `ROLE` | `web` (HTTP only) / `worker` (HTTP + schedulers) / unset (single process) |

---

## Non-Negotiables

- **THE 100% COMMANDMENT — every available lot, every time. NON-NEGOTIABLE.** For every house, 100% of the source's currently-available lots must reach the UI, with their real images and complete per-lot fields. **Anything below 100% is a BUG, not a "partial success"** — treat a house at 79% recall exactly as you would a crashed feature: unacceptable, and fixed in-session. The ONLY acceptable shortfall is a lot the source genuinely doesn't publish (e.g. raw land with no photo), and that must be a *proven* per-lot fact, never a stale/transient verdict or an untested assumption. Recall is measured against the house's live recall sentinel (`lib/scraper/recall-sentinels.js`); a scrape that lands below sentinel parity is a regression to be diagnosed and closed, never tolerated as "most of them". This commandment **outranks cost, latency, and genericness** — write bespoke per-house code when the source demands it to hit 100% (`allsop.js`, `symondsandsampson.js` do). Coverage is the moat; this rule is its enforcement. See the `feedback-100pct-lot-coverage` standing rule.
- **Best-engine-first** — the pipeline selects the best scraping engine *per house* by scored trade-off (recall → reliability → cost), conditioned on the house's nature (platform type, bot protection, API/PDF/markdown needs). Recall is never knowingly sacrificed for cost: a cheaper engine is preferred only when its recall is proven equal to the incumbent against the house's recall sentinel (**strict parity**). Within a chosen engine, the render fallback chain is Firecrawl → Puppeteer → HTTP. Engine choice is recorded and auditable; manual overrides via `house_skills.engine_locked` always win. Decision logic: `lib/scraper/engine-router.js`; design: `docs/ENGINE-ROUTER.md`.
- **The scraper builds the product** — the scraping layer exists to manufacture the product: clean, *complete* per-lot data that lets investors decide and unearth opportunities. **Engines are judged by the quality of the per-lot product they yield — recall AND field completeness (`batchQuality` + no per-field coverage regression) — never by lot count alone.** A house migrates Firecrawl→Crawlee only after passing the product-integrity parity gate (`lib/pipeline/parity-gate.js`) in shadow; no investor ever sees degraded data. This principle outranks cost in every engine decision.
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
