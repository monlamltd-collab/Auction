# WORKSTREAMS.md — AuctionBrain

Current open work, resolved items, and the goal-aligned roadmap.
*Last updated: 2026-06-27*

---

## Schema migrations in flight

- **`get_active_lots()` unsold-sentinel guard** (2026-07-03). Sentinel-dated (`2099-12-31`) `unsold` rows satisfied the "unsold in the last 30 days" branch forever, keeping every stale re-list on the live board (the duplicate-lots incident). New rule: real past date → 30-day window unchanged; future/sentinel date → same `last_seen_at < 21d` recency gate as `available` (measured 2026-07-03: 187 still-listed rows stay, 544 stale ghosts retire). Migration: `migrations/2026-07-03-get-active-lots-unsold-sentinel-guard.sql` — **NOT yet applied** (apply with the PR). Companion one-off cleanup of existing duplicate rows: `migrations/2026-07-03-DRAFT-dedupe-visible-lots.sql` — **DRAFT, destructive, needs Simon's sign-off**.

- **`lots.house` → `house_slug`** (Phase 2a, started 2026-06-22). `lots.house` stores a *slug* but is named like the *display* columns elsewhere (`house_skills.house`, `auction_calendar.house`); it's being renamed to `house_slug`. **Gate 1 is live in prod**: `house_slug` exists, is backfilled, and a `before insert/update` mirror trigger keeps it equal to `house`, so **both columns are valid during the transition**. New/changed code should **read `house_slug`** — app reads use the `house:house_slug` PostgREST alias to keep the returned JSON key `house` unchanged — the alias lives in the `LOTS_SELECT` string while `LOT_COLUMNS` keeps the logical key `house` (so the column-contract test stays valid); filters use `house_slug` directly. The old `house` column is dropped only at the final gate (after a soak). Plan + runbook live on branch `infra/hermes-verifier` (`HOUSE_KEY_PLAN.md` / `HOUSE_KEY_2A_RUNBOOK.md`).

- **`get_active_lots()` `+ l.id`** (2026-06-25). The active-feed RPC now returns the lot UUID so the frontend carries `_dbId` on active lots (previously only unsold lots had it, via `LOTS_SELECT`). Powers the mobile lot-detail drawer's `?lot=<uuid>` URL state (Back-button close + shareable link) and lines up with the SSR `/lot/:id` page. **Applied to prod** (additive; inert for the deployed frontend until the drawer ships). Migration: `migrations/2026-06-25-get-active-lots-include-id.sql`. Rebuilt from the live Phase-2a definition (`house_slug as house`), not an older migration file.

- **`sdlauctions` house_skills row** (2026-06-27). SDL Auctions was onboarded in code (de-conflation plan 4) but never got a `house_skills` row, so the scheduler — which iterates `house_skills` — never scraped it (0 live lots). Migration `migrations/2026-06-27-onboard-sdlauctions-house-skills.sql` adds the row (mirrors the `btg_sdl` sister, `btgeddisons`). Companion code (same PR): a one-shot "Show: All" click in `lib/scraper/crawlee.js` `CLICK_TO_LOAD_SELECTORS` so the AJAX `/search/` render loads the full ~186-lot book instead of the default 12 (verified live: 11 → 186, recogniser 186/186). **NOT yet applied** — pending PR merge + deploy; **no restart needed** (SDL has no tripped circuit; the scheduler reads `house_skills` fresh). NB the sibling Charles Darrow is blocked separately by the in-memory circuit-reset deadlock (needs a restart/health-reload), coordinated elsewhere.

---

## Roadmap to 10k+ users

**The goal (canonical wording in `README.md` → "The Goal"):** tens of thousands of monthly users, monetised via bridging-finance leads first, then advertising/sponsorship and premium tools. Pillars in priority order: **Coverage → Trust → Growth → Revenue**.

**Review verdict (2026-06-10):** scraping/assessment foundations are strong. The growth surface is largely *built but unplugged*, and the lead funnel is live but loses attribution. Work the phases top-down — each unlocks the next.

**Division of labour:** outward-reach (social, content distribution, audience acquisition for both AuctionBrain and BridgeMatch) lives in the separate **ContentBrain** repo. This repo's growth remit is the indexable surface (Phases 1–2) and converting the traffic it earns (Phase 3); assets like the market report are produced here, distributed via ContentBrain.

### Phase 1 — Plug in the growth engine (days; highest ROI in the repo)

- **Serve the sitemap dynamically.** `scripts/regenerate-sitemap.mjs` can emit ~40k lot URLs, but it runs only on the worker (`server.js:602`) and writes a local file, while the web container serves the 5-URL repo copy via `sendFile` (`routes/admin.js:478`) — Google has never seen the lot URLs. Replace with a dynamic `/sitemap.xml` route querying Supabase (cache ~1h).
- **Link lot cards to `/lot/:id`.** The server-rendered lot pages (`routes/lots.js`) have full meta/JSON-LD/OG and are production-quality — and zero internal links point at them (`public/app.js` has no `/lot/` hrefs). Real anchors on cards + JS intercept for the inline expand.
- **True 404s.** The catch-all serves the SPA with HTTP 200 for every unknown path (`server.js:195`) — soft-404s waste crawl budget. Return real 404s; fix the phantom `/auctions` breadcrumb in `index.html`.
- **Keep sold lots indexable.** Sold lots are dropped from the sitemap and missing lots 302 to `/` — but sold-price pages are compounding SEO content ("what did X sell for at auction"). Keep them live as an archive.

### Phase 2 — Mid-tail SEO surfaces (reuse the `lots-render.js` pattern; data already in the DB)

- `/auction-houses/:slug` pages (~173 houses — "[house] next auction" queries).
- `/auctions/:town` directory pages ("property auctions leeds").
- An HTML auction-calendar page (the calendar is currently JSON-API-only).
- **Consolidate domain authority** — blog on `auctionbrain.co.uk`, app on `auctions.bridgematch.co.uk`, Organization schema pointing at `bridgematch.co.uk`. Pick one canonical home, 301 the rest.

### Phase 3 — Convert: finance leads first

Leads pay at hundreds of users; ads need ~50k sessions/month.

- **Attribution:** carry `lot_ref` + a click id through `buildBridgematchUrl` (`lib/fundability.js:168`) so BridgeMatch conversions are provable per lot/user.
- **CTAs where traffic lands:** lot-contextual finance block on `/lot/:id` (today a bare "Check finance options" link with no lot context) and a finance CTA in the daily/weekly digest emails (today none).
- **Lead form before handoff:** the per-card "BridgeMatch it" button goes straight off-site; the on-site form (name/email/phone → `leads` table + Resend) is buried in the expanded panel.
- **Mail the consented segment:** `users.consent_partner_marketing=true` is stored with an audit trail and has never been used.

### Phase 4 — Retain

- **Free saved-search alerts.** Alerts are Pro-gated server-side (`lib/pipeline/saved-search-alerts.js:197`), so free users' saved searches silently never email — the core return loop should be free; premium buys immediacy/granularity.
- Close Umami event gaps (saved-search creation untracked; finance CTA events use array index, not lot id).

### Phase 5 — Harden for the traffic (2026-06-10 robustness review)

- `/api/analyse` cost amplification: abort on client disconnect, key limits on user id not just IP, cap per-call enrichment fan-out (`routes/analyse.js:35`).
- Smart-search cache key omits `location` → cross-user wrong results (`routes/search.js:547`). One-line fix.
- Add `Cache-Control` to anonymous `/api/all-lots` (ETag-only today; every visitor hits origin — `routes/search.js:1597`).
- Express error middleware + Sentry error handler + `unhandledRejection` hook — **done 2026-06-10**; what remains is asyncHandler wrapping so async route rejections return JSON errors instead of hanging the request.
- Stripe webhook idempotency race: insert `processed_webhook_events` first, bail on `23505` (`routes/stripe.js:104`).
- Per-instance in-memory caches/rate-limits are fine at one web instance; add shared invalidation before scaling out (`lib/auth.js:113`, `server.js:831` TODO).

### Phase 6 — Monetise breadth (after Phases 1–3 prove traffic + lead value)

- Un-hibernate Stripe (`STRIPE_ENABLED` — checkout/webhook/Day-Pass expiry already built and tested) with a real free-tier limit so willingness-to-pay data accumulates; move CSV export behind a server-side Pro check.
- Featured/sponsored slots in the daily digest + curator widget (`curator_picks` needs only a `sponsored` flag) — auction houses want bidders.
- Display ads only past ~50k sessions/month (ad-network thresholds); earlier, ads depress trust for pennies.
- Data plays: quarterly UK auction market report from `lot_events` (PR + backlinks); CSV/API export as Pro features; AI legal-pack summariser as a paid add-on (the scariest part of buying at auction — strong willingness to pay; needs careful not-legal-advice framing).

---

## Worktrees

### main
Foundation work only. Lot contract, observability views, schema reconciliation.

### worktree-ui (not yet created)
In-scope: `public/app.js`, `public/*.html`, `public/*.css`, route handlers that shape API responses for the frontend.

Out-of-scope: `lib/scraper/*`, `lib/pipeline/*`, `migrations/*`, `lib/types/*`.

Reads from the canonical Lot shape. Does not redefine field names.

### worktree-data (not yet created)
In-scope: queries and views over `lot_events`, `scrape_health_daily`, `house_skills`, `catalogue_snapshots`. New SQL views, diagnostic CLI commands, admin route surfacing per-source health.

Out-of-scope: `public/*`, `lib/scraper/*`, `lib/types/*`.

---

## Open Issues (deliberately not fixed yet)

### Data model

- **`bullets` field has two semantic shapes upstream** — multi-element vs single-element from description. Needs reconciliation in `normaliseScrapedLot`. Flag if behaviour changes.

- **`auction_date` has no timezone handling** at any boundary. Europe/London assumed implicitly. Out of scope for now.

- **`cached_analyses.lots` JSONB blob is untyped.** Validate against canonical Lot shape on read in a future pass.

- **`dbRowToLot` emits `enrichedAt` and `rawText`** but canonical `LOTS_SELECT` doesn't fetch `enriched_at` / `raw_text`. Keys always resolve to `undefined` unless caller expands their select. Either (a) add columns to `LOT_COLUMNS`, or (b) drop keys from `dbRowToLot`.

### Stale code (comment/JSDoc only — no functional impact)

- **Stale JSDoc in 5 files** — all reference deleted symbols `dbRowToFrontendLot` or `normaliseLot`:
  - `lib/pipeline/value-estimator.js` lines 8 and 74
  - `lib/curator/select-picks.js` line 33
  - `lib/curator/generate-prose.js` line 40
  - `lib/pipeline/cache-enrich-stage.js` line 23
  - `lib/pipeline/firecrawl-extract.js` placeholder-address comment block

- **`lib/types/lot.js` header** — "Migration status" block (lines ~53–62) says "DO NOT delete the originals before all callers are migrated" but migration completed in commit `1a73fe1`. Comment-only fix.

- **`lib/types/lot.js:89`** — `floor_plan_url` listed as intentionally omitted from `LOT_COLUMNS` but was added at line 118 in `ea1b454`. Remove from the "intentionally OMITTED" comment.

### Refactors (safe, no behaviour change)

- **Helper duplication** — `looksLikeRealAddress`, `stripEigCatalogueParams`, `PLACEHOLDER_PHRASES`, `UK_POSTCODE_RE` exist in both `lib/pipeline/firecrawl-extract.js` and `lib/types/lot.js`. Intentional during transition. Long-term: migrate consumers to `lib/types/lot.js`, delete from firecrawl-extract.js.

- **`scrape-diff.js` key order** — keys by `l.lotNumber || l.address || l.lot`. Post-migration `l.lotNumber` is always undefined. Flip to `l.lot || l.address` for clarity. Behaviour unchanged.

- **`lib/pipeline/persist-lots.js:128`** — JSDoc still says "append-only inserts to the lot_history table". Superseded by the 2026-06-04 archive migration; the correct note is at line 561.

### Infrastructure / housekeeping

- **UPRN enrichment still down (OS Places 429 wall)** — every live probe has returned 429 (~200/day) since mid-May, **including across the June 1 month boundary**, so this is not our request rate: the May code remediation (token bucket, cache-before-breaker, transition events — `lib/os-places.js`) landed and behaves correctly. Last successful lookup 2026-06-03; 165k+ `enrich_uprn_fail` events; `os_places_cache` frozen at 2,269 rows since 2026-04-27. Resolution lives in the **OS Data Hub dashboard** (plan/quota/key state) — account-side only. Recovery runbook once unblocked: restart the worker, then `node scripts/backfill-uprn-from-cache-2026-05-26.mjs`.

- **Firecrawl plan exhausted (2026-06-03 02:32 UTC)** — 100k credits burned in ~2 weeks; zero Firecrawl calls since (scraping degraded to Puppeteer/HTTP fallbacks). Root causes, both fixed 2026-06-10: (1) the in-memory budget counter zeroed on every deploy, so the 80/95/100% alerts never fired while the real plan drained — now hydrated from `pipeline_events` at boot, reset properly at cycle rollover, and paced daily against the cycle remainder (`lib/resource-budget.js`); (2) FIRE-1 credit leaks in healing + homepage-watch (~23 credits/call on junk URLs, duplicate calls, retired houses) — the stranded `fix/firecrawl-fire1-leak` branch is now landed. Outstanding operator actions: set `FIRECRAWL_PLAN_REFRESH_DAY` on Railway to the plan's real reset day (Firecrawl dashboard shows it), and decide top-up now vs waiting for the refresh.

- **`docs/ARCHITECTURE.md` layout is stale** — still shows `lib/extractors/` (deleted 2026-05-08), `scripts/audit.mjs`, and the DOM→Gemini merge flow. Needs a re-verify pass; CLAUDE.md points every fresh session at it.

- **`l.streetAvg`** — zero-byte stray at repo root. Deleted 2026-06-10 but recreated once by an unidentified local background process (not the test suite — a per-file bisect ran clean; the machine runs ~39 long-lived node daemons). Now gitignored so it can't pollute the tree; root cause open.

---

## Resolved (historical reference)

- **2026-06-10 tidy-up (incomplete-ideas audit)** — gth.net detection restored + johnpye retired (shipped in PR #65); zombie `api/auctions.js`, `bridgematch-agents/`, `bugs/`, and root scratch files deleted; root SQL snapshots archived to `migrations/archive/`; `audit/` merged into `audits/`; `smart_search_cache` retired (dead half-feature — code + table); legacy `session_token` auth fallback removed; unsold-lot alerts wired into the scheduler (Tier 19 — endpoint existed since April with no caller); Sentry Express error handler + unhandledRejection hook added; FIRE-1 leak fix landed from its stranded branch; budget counter made restart-proof with dynamic daily pacing.

- **`lot_events` consolidation complete (2026-06-04)** — `lot_history` and `lot_status_history` archived to `*_archive` via `migrations/2026-06-04-archive-lot-history.sql` (all rows preserved: ~297k + ~39k). `lots.sold_price` / `price_status` columns dropped. `lot_events` is the only active event table. *(Note: `price_status` was REINSTATED 2026-06-12 as a live price-intent column — guide/poa/tba/starting_bid/nil_reserve/sold/withdrawn/unknown, populated on every upsert; contract 3.1.0, `migrations/2026-06-12-nil-reserve-price-status.sql`. Distinct from the historical sold-price-status that lot_events owns.)*

- **`LOTS_SELECT` divergence** — `lib/pipeline/persist-stage.js:28` previously defined a local `LOTS_SELECT` referencing six columns that don't exist in the live `lots` table. Fixed in commit `1a73fe1` by replacing with canonical import.

- **DOM extractor retirement** — `lib/extractors/` deleted 2026-05-08. `USE_FIRECRAWL_EXTRACT`, `FORCE_EXTRACT_HOUSES`, `BROKEN_EXTRACTORS`, DOM→Gemini merge code all removed.

- **Canonical Lot shape migration** — `lib/types/lot.js` established as the single source of truth for the Lot shape. Legacy mappers deleted in `1a73fe1`.

---

## Planned Work (not started)

- **Always-cached architecture** — tiered refresh with fingerprinting and staggered scheduling. Design in `ALWAYS_CACHED_ARCHITECTURE.md`. Phase A (design) complete. Phase B onwards not yet started.

- **Hermes agent integration** — autonomous scraper monitoring via Hermes + Supabase MCP. Context file at `~/.hermes/context/auctionbrain.md`. Not yet active.
