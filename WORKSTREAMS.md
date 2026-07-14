# WORKSTREAMS.md — AuctionBrain

Current open work, resolved items, and the goal-aligned roadmap.
*Last updated: 2026-06-27*

---

## Schema migrations in flight

- **Deal-signal identifier layer** (2026-07-13, `feat/deal-signals`). Three new `lots` columns: `deal_signals` (jsonb array of multi-label archetype slugs — `hmo`, `investment-valuation`, `income-stated`, `title-split`, `short-lease`, `mixed-use`, `cash-buyers-only`, `planning-granted`, `regulated-tenancy`, `holiday-let`), `stated_income_pa` (listing-stated rent normalised to £/annum), `income_kind` (`passing`|`potential`). Written by `analyseLot` via the new pure-regex `lib/pipeline/deal-signals.js`; `deal_type` gains a single-label `HMO` value; `description` now feeds detection text and the narrative sweep re-analyses + rebuilds `search_text` after harvesting narrative. Ground truth: 3 Pembroke Avenue BS11 9SJ (6-bed HMO, "£47,700 per annum" in bullets, previously `Standard`). Migration: `migrations/2026-07-13-deal-signals.sql` — **NOT yet applied; MUST be applied BEFORE the PR deploys** (`LOTS_SELECT` references the new columns — deploying first breaks every lot read). The same file republishes `get_active_lots()` (rebuilt from the LIVE 2026-07-13 definition) with the three new columns so the browse-grid RPC path carries them too. Contract bump: LOT_SCHEMA_VERSION 3.4.0. Read-only preview: `node scripts/verify-deal-signals.mjs`. Hardened 2026-07-14 after a 3-lane adversarial review (6 confirmed findings fixed: potential-vs-passing income precedence, after-figure cost labels, single-AST big-house HMO false positive, "bedroom 3 en-suite" room-label miscount, freehold occupational-lease short-lease false positive, negated planning-granted).

- **`refund_ai_search(p_user_id, p_today)` RPC** (2026-07-07, `fix/search-trust-audit`). Companion to `increment_ai_search`: the daily AI-search quota is bumped atomically *before* the AI call to stay race-safe, so a search that then failed for a non-user-fault reason (no provider key, provider quota-dead, DB error) silently burned one of the user's daily searches. The route now calls this on those bail-outs. Atomic, floors at 0, same-day-only (a refund can't leak across the midnight reset), service_role-only grant. Migration: `migrations/2026-07-07-refund-ai-search-rpc.sql` — **APPLIED to prod 2026-07-07** (idempotent `CREATE OR REPLACE`; the route also has a guarded non-atomic fallback if the RPC is ever absent).

- **`users.preferred_location`** (2026-07-06, `feat/search-quality-preferred-location`). New JSONB column storing `{ input: 'Bristol' | 'BS1', radius: 10 }` from the onboarding location step (the anonymous location prompt + wizard step 4). The frontend applies it as the default town/postcode + radius filter on load and mirrors it in `localStorage.ab_pref_location`; `/api/auth/me` and `/api/auth/onboarding` now read/write it. Migration: `migrations/2026-07-06-preferred-location.sql` (idempotent) — **NOT yet applied; apply before/at PR merge** (until applied, onboarding saves that include the field will 500 and `/api/auth/me` falls back to the cached-user shape).

- **RLS on the 8 outreach/social tables** (2026-07-04, from the naming/security audit). `prospects`, `contacts`, `replies`, `sequences`, `suppression`, `outbound_outcomes`, `boost_runs`, `social_audience_daily` had RLS fully disabled (ERROR-level advisor finding; outreach PII exposed to the anon key). Migration `migrations/2026-07-04-enable-rls-outreach-tables.sql` enables RLS with **no policies** — every consumer is ContentBrain running on the service_role key (bypasses RLS; ContentBrain PR #28 names the key properly). **NOT yet applied** (apply with the PR).

- **`postcode_sales.property_type` vocabulary unification** (2026-07-04, from the naming audit). The retired live SPARQL endpoint wrote lowercase slugs (`terraced`, `flat-maisonette`); the current `hmlr_ppd` path writes Title style (`Terraced`, `Flat/Maisonette`) via `PPD_TYPE_LABEL`, and cached `lr_data` fan-outs kept re-inserting the legacy form (~21k rows each as of 2026-07-03). `canonPropertyType()` in `lib/enrichment.js` now normalises at the postcode_sales write site (in-memory sales keep their original casing — the type-matched comps regex is case-insensitive and untouched). Backfill: `migrations/2026-07-04-normalise-postcode-sales-property-type.sql` — **NOT yet applied** (apply with the PR).

- **`get_active_lots()` unsold-sentinel guard** (2026-07-03). Sentinel-dated (`2099-12-31`) `unsold` rows satisfied the "unsold in the last 30 days" branch forever, keeping every stale re-list on the live board (the duplicate-lots incident). New rule: real past date → 30-day window unchanged; future/sentinel date → same `last_seen_at < 21d` recency gate as `available` (187 still-listed rows stayed, 544 stale ghosts retired). Migration: `migrations/2026-07-03-get-active-lots-unsold-sentinel-guard.sql` — **APPLIED to prod 2026-07-03** (Simon authorized in-session). The companion cleanup `migrations/2026-07-03-DRAFT-dedupe-visible-lots.sql` was also **EXECUTED 2026-07-03** with Simon's sign-off after per-block pre-flight counts matched: robinsonhall 8 venue rows deleted, hollismorgan 79 querystring variants deleted + 36 canonicalised, venmore 73 property duplicates deleted (all FKs cascade; no mixed-address groups). Visible excess dupes 578 → 377; the residue is cliveemson town-only collisions (self-heals as the detail-fetch address upgrade runs) and AH-platform re-list pairs that age out under the new recency gate.

- **`lots.house` → `house_slug`** (Phase 2a, started 2026-06-22). `lots.house` stores a *slug* but is named like the *display* columns elsewhere (`house_skills.house`, `auction_calendar.house`); it's being renamed to `house_slug`. **Gate 1 is live in prod**: `house_slug` exists, is backfilled, and a `before insert/update` mirror trigger keeps it equal to `house`, so **both columns are valid during the transition**. New/changed code should **read `house_slug`** — app reads use the `house:house_slug` PostgREST alias to keep the returned JSON key `house` unchanged — the alias lives in the `LOTS_SELECT` string while `LOT_COLUMNS` keeps the logical key `house` (so the column-contract test stays valid); filters use `house_slug` directly. The old `house` column is dropped only at the final gate (after a soak). Plan + runbook live on branch `infra/hermes-verifier` (`HOUSE_KEY_PLAN.md` / `HOUSE_KEY_2A_RUNBOOK.md`).

- **`get_active_lots()` `+ l.id`** (2026-06-25). The active-feed RPC now returns the lot UUID so the frontend carries `_dbId` on active lots (previously only unsold lots had it, via `LOTS_SELECT`). Powers the mobile lot-detail drawer's `?lot=<uuid>` URL state (Back-button close + shareable link) and lines up with the SSR `/lot/:id` page. **Applied to prod** (additive; inert for the deployed frontend until the drawer ships). Migration: `migrations/2026-06-25-get-active-lots-include-id.sql`. Rebuilt from the live Phase-2a definition (`house_slug as house`), not an older migration file.

- **`lots.description` + `get_active_lots()` republish** (2026-07-04, `feat/lot-narrative`). New text column stores the source auction house's own narrative — the audit found the portfolio averaging under ~50 chars/lot (Bond Wolfe: 16, synthetic tags) while source pages carry 300–2,500 chars. Populated by the `normaliseScrapedLot`/detail-pass passthrough and the daily 07:00 narrative sweep (`lib/pipeline/narrative-sweep.js` — cache-first from `lot_details`, then HTTP→Crawlee; cross-lot repeated-paragraph strip). RPC republished with `l.description`, rebuilt from the LIVE definition (incl. the 2026-07-04 7-day freshness window). Migration: `migrations/2026-07-04-lots-description.sql` — **NOT yet applied; MUST be applied BEFORE the PR deploys** (the persist upsert writes the column unconditionally — deploying first breaks every lot upsert). Contract bump: LOT_SCHEMA_VERSION 3.3.0.

- **`sdlauctions` house_skills row** (2026-06-27). SDL Auctions was onboarded in code (de-conflation plan 4) but never got a `house_skills` row, so the scheduler — which iterates `house_skills` — never scraped it (0 live lots). Migration `migrations/2026-06-27-onboard-sdlauctions-house-skills.sql` adds the row (mirrors the `btg_sdl` sister, `btgeddisons`). Companion code (same PR): a one-shot "Show: All" click in `lib/scraper/crawlee.js` `CLICK_TO_LOAD_SELECTORS` so the AJAX `/search/` render loads the full ~186-lot book instead of the default 12 (verified live: 11 → 186, recogniser 186/186). **NOT yet applied** — pending PR merge + deploy; **no restart needed** (SDL has no tripped circuit; the scheduler reads `house_skills` fresh). NB the sibling Charles Darrow is blocked separately by the in-memory circuit-reset deadlock (needs a restart/health-reload), coordinated elsewhere.

---

## Roadmap to 10k+ users

**The goal (canonical wording in `README.md` → "The Goal"):** tens of thousands of monthly users, monetised via bridging-finance leads first, then advertising/sponsorship and premium tools. Pillars in priority order: **Coverage → Trust → Growth → Revenue**.

**Review verdict (2026-06-10):** scraping/assessment foundations are strong. The growth surface is largely *built but unplugged*, and the lead funnel is live but loses attribution. Work the phases top-down — each unlocks the next.

**Division of labour:** outward-reach (social, content distribution, audience acquisition for both AuctionBrain and BridgeMatch) lives in the separate **ContentBrain** repo. This repo's growth remit is the indexable surface (Phases 1–2) and converting the traffic it earns (Phase 3); assets like the market report are produced here, distributed via ContentBrain.

### Phase 1 — Plug in the growth engine — **SHIPPED 2026-07-03**

All four items landed in one PR (`feature/seo-phase1`):

- **Dynamic sitemap** — `lib/sitemap.js` builds `/sitemap.xml` from Supabase on the web process (1h in-process cache; stale-cache fallback on query failure). Live lots at priority 0.6/daily + the **sold archive at 0.4/monthly** (sold-price pages are compounding SEO content). The worker cron (old Tier 11), `scripts/regenerate-sitemap.mjs`, and the static `public/sitemap.xml` stub were deleted — the worker-writes/web-serves split meant Google had never seen a lot URL.
- **Lot cards link to `/lot/:id`** — the card address is a real `<a href="/lot/<uuid>">` (`_dbId`); plain click keeps the inline expand via `_cardAddrClick`, modified clicks + crawlers follow the href.
- **True 404s** — the catch-all serves the SPA at `/` only; unknown paths get a branded, `noindex` 404 (`renderNotFoundHtml` in `routes/lots-render.js`), unknown `/api/*` gets JSON 404. `/lot/:id` returns real 404s instead of 302-to-`/` (invalid or unknown id). Phantom `/auctions` breadcrumb removed from `index.html` JSON-LD.
- **Sold lots indexable** — in the sitemap (above) and their JSON-LD offer availability now reports `SoldOut` instead of `InStock`.

Post-deploy operator step: submit `https://auctions.bridgematch.co.uk/sitemap.xml` in Google Search Console and watch coverage.

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

### Phase 4 — Retain — **SHIPPED 2026-07-04**

- **Saved-search alerts are free** (`feature/free-alerts`): the server-side Pro gate is gone — every tier with `notify_email=true` gets the daily 08:00 alert. Pro's edge is depth: free emails show the top 5 matches + a view-all link (+ upgrade hint on overflow), Pro shows up to 10. Tier flows `runSavedSearchAlertsCycle → renderAlertEmail({tier})`.
- Umami gaps closed: `saved_search_created` event added; fundability badge + finance-click events now carry the lot UUID (`_dbId`) instead of the render-order array index, so events are joinable across sessions.

### Phase 5 — Harden for the traffic — **SHIPPED 2026-07-04** (`fix/traffic-hardening`)

- `/api/analyse` cost amplification: aborts at phase boundaries on client disconnect; rate limit keyed on `u:<user.id>` (IP keeps a 3× backstop ceiling — same `rate_limits` table/RPC); per-lot detail fetch fan-out capped at 30 on the user path (cron keeps 80).
- Smart-search cache key now includes the UI location filter — the omission served one user's location-scoped results to another user's identical query.
- Anonymous `/api/all-lots` gets `Cache-Control: public, max-age=120, s-maxage=300, stale-while-revalidate=600` (+`Vary: Authorization`); signed-in stays `private, no-cache`.
- `lib/async-handler.js` + wrapped the public async routes whose pre-try sections could hang on rejection (`/api/analyse`, `/api/lot`, `/api/smart-search`, `/lot/:id`, `/og/lot/:id.png`). Delete the helper on Express 5.
- Stripe webhook idempotency: insert-first claim on `processed_webhook_events` (23505 = duplicate delivery), claim released on handler failure so Stripe's retry reprocesses. **Discovered: the table never existed in prod** — the old select/upsert failed silently, so idempotency had never worked. Created via `migrations/2026-07-04-processed-webhook-events.sql` — **APPLIED to prod 2026-07-04**.
- Still open (pre-scale-out, not launch-blocking): shared cache invalidation across web instances (`lib/auth.js`, `server.js` TODO).

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
