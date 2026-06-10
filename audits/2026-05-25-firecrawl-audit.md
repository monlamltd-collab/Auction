# Firecrawl Spend & Puppeteer Migration Audit

**Date:** 2026-05-25
**Auditor:** Claude (diagnostic only — no code changes)
**Repo:** `monlamltd-collab/Auction` (working tree at `C:\Users\User\Documents\GitHub\Auction`)

## Context
- `HOUSE_ROOTS` currently has **218 active slugs**; `RETIRED_HOUSES` skips 12.
- The 2026-05-08 migration retired all DOM extractors. Every house now flows through Firecrawl JSON extract (`lib/pipeline/firecrawl-extract.js::extractCatalogueListing`) — the only structural exception is Allsop (`paginateAs:'allsop_api'`, hits Allsop's private JSON endpoint, zero credits).
- Internal credit weights (`lib/resource-budget.js:28-43`): `jsonExtractCreditMult = 5`, `fire1CreditMult = 5`, `actionCreditCost = 1`. Caps: monthly 95,000; daily 8,000.
- Section 1 is descriptive; Sections 2–6 are diagnostic and prescriptive.

---

## 1. Firecrawl call inventory

All wrappers live in `lib/scraper/firecrawl.js`. Eight distinct endpoint surfaces:

| # | Wrapper | File:Line | Endpoint | Internal weight |
|---|---------|-----------|----------|-----------------|
| 1 | `scrapeWithFirecrawl(url, opts)` | `lib/scraper/firecrawl.js:37` | POST `/v2/scrape` (rawHtml + markdown, no JSON extract) | `1 + actionCount` |
| 2 | `extractCatalogue(url, opts)` | `lib/scraper/firecrawl.js:116` | POST `/v2/scrape` with `formats:[{type:'json', schema:CATALOGUE_SCHEMA}, 'markdown', changeTracking]` | `5` (or `1` when `changeStatus==='same'` short-circuits) |
| 3 | `extractHomepage(url, opts)` | `lib/scraper/firecrawl.js:194` | POST `/v2/scrape` with `formats:[{type:'json', schema:HOMEPAGE_AUDIT_SCHEMA}, 'markdown', changeTracking]` | `5` (or `1` on `same`) |
| 4 | `extractDetail(url, opts)` | `lib/scraper/firecrawl.js:258` | POST `/v2/scrape` with `formats:[{type:'json', schema:DETAIL_SCHEMA}]`, no changeTracking | `5` always |
| 5 | `batchExtractCatalogues(urls, opts)` | `lib/scraper/firecrawl.js:307` | POST `/v2/batch/scrape` | Declared, **not called anywhere in production** (see Bug 5.2) |
| 6 | `pollBatchJob(jobId)` | `lib/scraper/firecrawl.js:340` | GET `/v2/batch/scrape/{jobId}` | n/a — paired with #5 |
| 7 | `mapSiteUrls(url, search)` | `lib/scraper/firecrawl.js:370` | POST `/v2/map` | Untracked by `recordFcRequest` |
| 8 | `agentExtract(urls, prompt, schema, opts)` | `lib/scraper/firecrawl.js:390` | POST `/v2/extract` with `agent:{model:'FIRE-1'}` + polling | `5` (`fire1CreditMult`) |

### 1.1 Catalogue extraction (the hot path — biggest spend bucket)

**Primary orchestrator:** `extractCatalogueListing(url, house, options)` at `lib/pipeline/firecrawl-extract.js:746`.

For a single-page catalogue: 1 call to `extractCatalogue` (JSON extract). Returns `{skipped:true}` if `changeTracking` reports `same`.
For paginated (`maxPages > 1`): page 1 first (gate); then pages 2..N fanned out in batches of `maxConcurrency=10` with early-stop via `EMPTY_PAGE_RUN=3`. Each page is a separate `/v2/scrape` JSON-extract call.

**Triggers:**
- **Nightly full pass** — `server.js:427-435`, cron Tier 1 at **03:00 UK**. Runs `autoAnalyseAll` → per-house `autoAnalyseOne` (`lib/analysis.js:531`) which calls either `extractPaginatedCatalogue` (paginated houses) or `extractCatalogueNative` (single-page) at `lib/analysis.js:990-991`. `forceExtract = false` so unchanged catalogues short-circuit at ~1 credit each.
- **Adaptive re-scrape ticks** — `lib/pipeline/scheduling.js`. `next_scrape_at` per house: 6h on changed, scaling to 168h on `consecutive_same_count >= 5`, floor 7 days. `scheduleTick` polls `house_skills` and calls `autoAnalyseOne` when eligible.
- **Manual `/api/analyse`** — `routes/analyse.js:205`. Always calls `extractCatalogueListing(scrapeUrl, house, { paginateAs, maxPages:25, forceExtract:true })`. `forceExtract:true` bypasses changeTracking — every user-initiated analysis is a full 5-credit (× pages) hit. Rate-limited to ~30/hour at the router level.
- **Healing path** — when a house returns 0 lots, `_deps.healBrokenHouse` (analysis.js:504) → `lib/pipeline/healing.js`. Then re-tries `autoAnalyseOne` with the healed URL.
- **Per-house overrides (`HOUSE_OVERRIDES` in `lib/analysis.js:589-662`):**
  - `pattinson`: `maxPages:84`, `paginateAs:'pattinson_p'`, `changeTracking:false`. Plus a page-1 rawHtml hash gate (`lib/analysis.js:673-691`) that runs `scrapeWithFirecrawl(scrapeUrl, {formats:['rawHtml']})` first — ~1 credit — and stores the MD5 in `house_skills.catalogue_page1_hash` so the next run can skip 84 × 5 credit pages on a no-change result.
  - `johnpye`, `mchughandco`, `markjenkinson`, `hollismorgan`: `maxPages:1` with `recogniseFromMarkdown`. JSON extract per scrape; the recogniser is free (reads markdown already in the response).
  - `maggsandallen`: `maxPages:1`, `changeTracking:false` — every run is a full 5-credit JSON extract; no short-circuit.

### 1.2 Homepage watch (daily-ish)

`lib/pipeline/homepage-watch.js` → `extractHomepage` per house.

**Trigger:** `server.js:617`, cron Tier 12 at **03:30 UK every other day** (epoch-day parity). `auditHouseHomepage` (line 160) calls `extractHomepage(homepageOf(configuredUrl), {changeTracking:true, fcTimeout:90s})`. `CONCURRENCY=5`.

Cost per cycle: 218 houses × (`changeStatus:'same'` ≈ 1 credit each, otherwise 5 credits). AH-platform slugs (`AH_PLATFORM_SLUGS`) short-circuit via `fetchAhFutureDates()` which uses one single `extractHomepage` call against `AH_FUTURE_DATES_URL` (see `lib/pipeline/ah-resolver.js:96`) instead of 35+ individual regional fetches.

### 1.3 Per-lot detail-page fetches

`fetchLotPage(url, opts)` at `lib/scraper/lot-detail.js:75`. Order of operations:
1. Check `lot_details` cache (30-day TTL) → return cached HTML if present, **zero credits**.
2. Plain HTTP fetch with 15s timeout + 500-char visible-text gate → if OK, **zero credits**.
3. Fall back to `scrapeWithFirecrawl(url, {formats:['rawHtml']})` → **1 credit each**.

**Callers (each one its own daily spend bucket):**

| Caller | Trigger | Volume cap | Cooldown |
|---|---|---|---|
| `multi-image-sweep.js` | 06:00 UK daily, `server.js:557` | `SWEEP_BATCH_LIMIT=200/day` + `SWEEP_WALL_CLOCK_MS=30min` (lib/pipeline/multi-image-sweep.js:34) | 14 days |
| `post-auction-sweep.js` | 05:00 UK daily, `server.js:485` | `SWEEP_BATCH_LIMIT=1500/day` + 30 min wall clock | 12 hours |
| `same-day-sweep.js` | 20:00 UK daily, `server.js:808` | `SWEEP_BATCH_LIMIT=500/day` + 15 min wall clock | 6 hours |
| `enrichLotsFromLotPages` (Pass 4) | every 30 min on `freeOnly:false`; ~3-hourly `freeOnly:true` skips this pass | 300/cycle | none (gap-fill via missing-field SQL filter) |
| `enrichment-wave.js` Pass 1 (price hunter) | as above | 500/cycle | none |
| `enrichment-wave.js` Pass 2 (postcode rescue) | as above | 300/cycle | none |
| `routes/analyse.js:257` (`enrichLotsFromLotPages(analysed)` on every `/api/analyse`) | user-initiated | per-call (every lot on the page) | none |
| `routes/admin.js:179` (`/api/admin/firecrawl-probe`) | manual; `rateLimit(60s, 10)` | trivial | n/a |
| `lib/harness/sub-agents.js:208` status-drift | hourly 09–18 UK, sampled | small | n/a |

### 1.4 Per-lot Firecrawl detail extract (full JSON)

`extractLotDetailFirecrawl(url, house)` → `extractDetail` (5 credits each). Only called from:
- **`POST /api/lot`** — `routes/analyse.js:420`. User clicks "deep analysis" on a lot. Single hit per request, no cache hit on the Firecrawl side (cache lives in `lot_details` post-hoc).

### 1.5 Healing (FIRE-1 agent + scrapeWithFirecrawl combo)

`lib/pipeline/healing.js` is the most expensive single workflow per invocation. One full `healBrokenHouse` attempt:
- `_scrapeHomepage` → 1 × `scrapeWithFirecrawl(homepage, …)` plus 1 × `scrapeWithFirecrawl(rootUrl, …)` if different. **2 credits**.
- `_askAIForNewUrl` → 1 × `agentExtract` (FIRE-1). **5 credits** (default fire1CreditMult).
- `_verifyNewUrl` → 1 × `scrapeWithFirecrawl(newUrl, …)`. **1 credit**.
- Strategy B sitemap fallback (when AI fails): 1 × `scrapeWithFirecrawl(sitemapUrl, …)` + 1 × `agentExtract` over candidate URLs. **6 credits**.
- `classifyNewDomainDrift` (homepage-watch NEW_DOMAIN path): 1 × `agentExtract`. **5 credits**.

**Triggers:**
- Nightly heal-sweep in `autoAnalyseAll` when houses return 0 lots (`lib/analysis.js:430-460`).
- Homepage-watch URL drift → calls `healBrokenHouse` (lib/pipeline/homepage-watch.js:447).
- Manual `/api/admin/heal` (uses `resetAdaptiveBackoff` to clear backoff first).

### 1.6 Discovery / watcher

- `discoverAndUpdateCalendar` (`lib/pipeline/discovery.js:82`) — `scrapeWithFirecrawl(rootUrl, {formats:['rawHtml']})` per discovered house (1 credit each). Runs after `autoAnalyseAll`.
- `watchAuctionCalendar` (`lib/pipeline/auction-watcher.js`) — calls `agentExtract` (line 290) to discover new auctions and `scrapeWithFirecrawl` (line 211) on indexes when candidates can't be located in markdown. Tier 1 at 03:00 UK.

### 1.7 Rentals

`lib/rentals/openrent.js:44` — `scrapeWithFirecrawl(url, …)` for OpenRent (other rental sources are plain HTTP). Trigger: 04:00 UK daily `drainStaleRentals({limit:50})` (`server.js:471`). ~50 credits/day worst case.

### 1.8 Untracked / suspect

- `mapSiteUrls` (`lib/scraper/firecrawl.js:370`) does **not** call `recordFcRequest` — silent credit cost (see Bug 5.1).
- `pollBatchJob` does not credit either (acceptable — Firecrawl bills the batch call itself).
- `agentExtract` only records credits on the **completed** poll branch — if the agent times out (line 451), no credits are booked even though Firecrawl will have charged for the job (see Bug 5.4).

---

## 2. Waste pattern analysis

Ranked by estimated weekly credit impact. Note: there is no internal credit-by-caller logging — `creditsByTier` rolls all calls into 6 buckets (`full`/`free-enrichment`/`status-drift`/`on-demand`/`healing`/`unknown`) at `lib/resource-budget.js:77`. Per-call provenance does not survive into `scrape_runs` or anywhere else queryable, so the numbers below are derived from cron config + observed code paths, not from spend telemetry.

### 2.1 RANK 1 — Per-page JSON-extract on every paginated house, every run (~3,000–6,000 credits/week)

Whenever a paginated house's page-1 changeTracking returns `changed`, the orchestrator fans out **every** subsequent page as a fresh JSON-extract (5 credits each) — even if pages 2..N haven't moved:

`lib/pipeline/firecrawl-extract.js:827-836`:
```
pageResults = [page1];
for (let start = 1; start < pageUrls.length; start += maxConcurrency) {
  const batch = pageUrls.slice(start, start + maxConcurrency);
  const batchResults = await Promise.all(batch.map(scrapePage));
  …
}
```

`scrapePage` does pass `changeTracking` through, so pages 2..N benefit from per-page short-circuit on *individual* page hash matches. BUT — because `extractCatalogue` enables JSON extract unconditionally on every page (`lib/scraper/firecrawl.js:120-122`), each unchanged page still costs ~5 credits when the LLM extraction runs server-side. The 1-credit short-circuit only kicks in when the per-page `changeStatus` resolves to `same` server-side.

Empirically a daily Pattinson run on a "changed" day = page-1-hash miss + 84-page fan-out × 5 credits ≈ **420 credits in one house** (the comment at firecrawl-extract.js:826 acknowledges the cost: *"Saves the empty-page extracts on houses whose maxPages cap exceeds the real catalogue length"*).

**Why it's waste:** Most catalogues change one or two lots between scrapes. Re-running CATALOGUE_SCHEMA extraction (5×) on pages 2..84 when only page 1 has moved is paying for LLM work whose output is bit-identical to the previous run's output for those pages. There is currently no per-page MD5 content hash stored in `house_skills` (only `catalogue_page1_hash`), so the orchestrator has no way to tell.

**Fix surface:** cache the *raw* page-N rawHtml MD5 hash per house per page; only fire the JSON-extract format when the hash changes. The existing changeTracking covers some of this server-side, but the fact that Pattinson has `changeTracking:false` AND maxPages:84 means it's the worst offender by a large margin.

### 2.2 RANK 2 — `enrichLotsFromLotPages` running on every `/api/analyse` (~1,000–4,000 credits/week)

`routes/analyse.js:257` runs `await enrichLotsFromLotPages(analysed)` synchronously on every catalogue analyse — including lots already enriched in a prior cycle. `enrichLotsFromLotPages` (`lib/scraper/lot-detail.js:115`) gap-fills missing fields per lot, falling back to Firecrawl on HTTP failure (1 credit). For a 100-lot Pattinson analyse, even a 20% Firecrawl fallback ratio = ~20 credits *per* `/api/analyse` hit. There is no fingerprint check against the `lot_details` cache before the work starts — the call always proceeds, gated only by which lot fields are null.

Compounds with the manual-analyse rate limit being relatively generous (~30/hour). One vendor-demo session that hits /api/analyse 5–10 times during a presentation can burn hundreds of credits.

### 2.3 RANK 3 — Homepage watch JSON-extract on 218 houses every other day (~2,200–10,000 credits/month)

`server.js:612` comment quotes *"~150 Firecrawl credits/run; every other day ≈ ~2,250/month"*. That estimate predates the 5× JSON-extract multiplier shipped 2026-05-22 (`migrations/2026-05-22-house-skills-page1-hash.sql` plus the `jsonExtractCreditMult` introduction in resource-budget.js). Real cost:
- 218 houses minus the AH platform short-circuit (the AH resolver collapses ~35 regional slugs into 1 call): ~185 individual Firecrawl JSON extracts per run.
- `changeStatus:'same'` short-circuits to 1 credit. `changed`/`new` is 5 credits. Estimated mix at ~80% same: `185 × (0.8×1 + 0.2×5) = 185 × 1.8 ≈ 333 credits/run × 15 runs/month ≈ 5,000 credits/month`.
- Old "~2,250/month" assumption was off by ~2×.

Not waste exactly — homepage watch is genuinely useful — but the JSON-schema cost is now meaningful enough that **dropping JSON extract entirely** when changeTracking returns `same` is worth doing. Currently the JSON format is requested regardless; the format list is set inside `extractHomepage` before the call (`lib/scraper/firecrawl.js:198`), so a same-result still cost 1 credit because the formats array included JSON. A simpler 1st-pass rawHtml change-probe could halve it.

### 2.4 RANK 4 — `forceExtract:true` on every `/api/analyse` (~500–2,000 credits/week)

`routes/analyse.js:208` hard-codes `forceExtract:true` — every user-initiated analysis bypasses changeTracking, even if the catalogue's hash hasn't moved since the last cron. There's a deliberate justification in the code comments ("response always reflects the live catalogue"), but in practice most user-triggered analyses fire on the same catalogues the cron has already scraped within the past 6h. A 25-page catalogue at 5 credits each = 125 credits *minimum* per `/api/analyse` hit even when nothing changed.

**Mitigation room:** `forceExtract` could check `house_skills.last_full_extract_at` and only bypass if older than e.g. 1h. Or add a `forceExtract: !lastWithinMinutes(60)` heuristic.

### 2.5 RANK 5 — `extractDetail` (5 credits) on every `/api/lot` (~200–1,000 credits/week)

`routes/analyse.js:420` calls `extractLotDetailFirecrawl(url, house)` unconditionally, even when `lot_details` already has fresh structured data for that URL. The cache write happens *after* the fetch (line 458), but there's no read-cache gate on entry. A user who refreshes a lot page within the 30-day TTL re-pays 5 credits.

### 2.6 RANK 6 — Pattinson page-1 hash probe not extended to other paginated houses (~400–800 credits/week wasted opportunity)

`lib/analysis.js:673-691` runs a cheap rawHtml hash probe to short-circuit Pattinson's 84-page fan-out. The gate is inside the `if (HOUSE_OVERRIDES[house])` branch and ONLY fires when `ovr.changeTracking === false && ovr.maxPages > 1`. Other paginated houses (sdl, savills, suttonkersh, countrywide, pugh) don't have a `changeTracking:false` override, so they rely on per-page changeTracking only — which still costs 1 credit per unchanged page. For an 8-page SDL catalogue: 8 × 1 = 8 credits/run minimum. A single page-1 hash probe would collapse that to 1 credit on unchanged runs.

### 2.7 RANK 7 — `agentExtract` (FIRE-1) on every same-domain heal attempt (~150–500 credits/week)

Healing always reaches the FIRE-1 path (lib/pipeline/healing.js:495) before the heuristic sitemap/nav fallbacks. FIRE-1 is 5× weight, ~25 credits per agent call observed. When the simple `_strategyNavLink` (lines 414-427) would resolve the new URL from already-fetched homepage hrefs — purely free, no extra Firecrawl call — the code still tries FIRE-1 first. Reordering to (cheap strategies first → FIRE-1 last) would save credits on heals that don't actually need an LLM.

### 2.8 Patterns explicitly NOT seen (worth noting in case the audit user expected them)

- **No duplicate short-window calls.** The 30-min `runEnrichmentWave` tick uses cooldown filters at the SQL level (`enrichment_manifest` recorded_at vs cutoff). The 12h post-auction cooldown + 6h same-day cooldown are well-implemented.
- **No infinite-retry loops.** `extractCatalogue` exponential backoff is bounded at 5 attempts (lib/scraper/firecrawl.js:161). `extractDetail` same. `scrapeWithFirecrawl` is 1 retry only (line 99).
- **No scraping of `RETIRED_HOUSES`.** `autoAnalyseAll` filters them upstream (verified against `lib/analysis.js:_doAutoAnalyseAll` → it iterates `auction_calendar` rows, retired houses are excluded by calendar sync).
- **No detail-backfill for catalogue lots.** Confirmed in the file header comment at `lib/pipeline/firecrawl-extract.js:28` — *"~840 extra Firecrawl calls per Pattinson cycle to recover what's already in the markdown… Wasteful."* Already explicitly avoided.
- **Allsop's JSON API exemption holds.** Verified via `paginateAs:'allsop_api'` short-circuit before extractCatalogueListing fires.

### 2.9 Logging gap

There is **no per-call credit attribution stored in Supabase.** The `BUDGET-FC` hourly log line (server.js:417) emits the 6-bucket `creditsByTier` to stdout, which rolls off Railway's 500-line buffer within hours. `scrape_runs` does NOT have a `firecrawl_credits` column. Recommendation logged in Section 6.

---

## 3. Puppeteer migration candidates

Bar for Category A is strict: high-volume contributor to Firecrawl spend AND server-rendered (or trivially hydrated) AND stable selectors AND not blocking headless browsers. Each candidate below was probed live with a Windows-Chrome `curl` (plain HTTP, no JS) to verify the HTML structure independently of Firecrawl's wrapper.

### Category A — strong migration candidates (3 confident, ~65 underlying slugs)

#### A1. Auction House UK regional family (~35 slugs)
Slugs covered: `auctionhouseuklondon`, `auctionhouseeastanglia`, `auctionhousenorthwest`, `auctionhousenortheast`, `auctionhousewales`, `auctionhousebirmingham`, `auctionhousekent`, `auctionhousedevon`, `auctionhousewestmidlands`, `auctionhouseessex`, `auctionhousemanchester`, `auctionhousesouthyorkshire`, `auctionhousewestyorkshire`, `auctionhouseteesvalley`, `auctionhousehull`, `auctionhousecumbria`, `auctionhouselincolnshire`, `auctionhousebedsandbucks`, `auctionhousenorthamptonshire`, `auctionhouseoxfordshire`, `auctionhouseleicestershire`, `auctionhousemidlands`, `auctionhousecoventry`, `auctionhousenottsandderby`, `auctionhousechesterfield`, `auctionhousestaffordshire`, `auctionhousenorthwales`, `auctionhousesouthwest`, `auctionhousenorthernireland`, `auctionhousenational`, `auctionhousescotland`, `austingray`, `auctionhouselondon`, plus the parent `auctionhouse` slug.

**Probe result:** `https://www.auctionhouse.co.uk/london/auction/search-results` -> HTTP 200, 591 KB HTML, 1.9s, **243 unique `/lot/redirect/{id}` URLs** present in initial HTML. Plain HTTP, no JS hydration required.

**Selector blueprint (verified against London probe):**
- Card boundary: `.lot-search-result`
- Lot URL: `a.home-lot-wrapper-link[href]`
- Lot number: `.image-sticker` (text e.g. "Lot 47")
- Image: `img.lot-image[src]` (CDN URLs in `cdn.eigpropertyauctions.co.uk` or local `/lot-image/`)
- Address: `.grid-address` (full UK postal address with postcode)
- Property type/beds summary: `.summary-info-wrapper p:first-child` (e.g. "2 Bed Property For Sale")
- Status / guide-price overlay: `.grid-view-guide` (e.g. "Postponed", "Guide £XX,XXX", "Sold")

**Why 100% enrichment is plausible:** the catalogue page contains lot number, full address (including postcode), image URL, property type, bedroom count and lot status inline. The detail-page fetch only adds tenure/condition/full description — already gap-filled by the current `enrichLotsFromLotPages` chain (plain HTTP first, Firecrawl fallback). Migrating the catalogue layer to Puppeteer + cheerio while keeping `fetchLotPage` for detail enrichment loses no fields.

**Current Firecrawl cost (estimated):** 35 slugs × adaptive cadence (mix of 6h/12h/daily) × 5 credits per JSON-extract when changed. At a 70/30 changed/same mix: 35 × (0.3×1 + 0.7×5) ≈ 130 credits/night from cron full passes alone. Plus user-initiated `/api/analyse` hits with `forceExtract:true` (5 credits per call, ~bi-daily).

**Risks:**
- AH UK uses Cloudflare in front of the regional pages; the probe succeeded with a standard Chrome UA, but Puppeteer must mimic a real browser env (set headers, viewport, optionally `--disable-blink-features=AutomationControlled`) or risk Bot Management challenges.
- `image-sticker` class also stamps onto other badges; selectors must scope via parent context.
- Three of the regional slugs (`auctionhouse`, `auctionhouseuklondon`, `auctionhousenational`) share lots across regions — dedup logic must mirror current pipeline behaviour.

#### A2. EIG whitelabel family (~30 slugs sharing one template)
Slugs covered (all `*.eigonlineauctions.com` or platform-bridged custom domains): `paulfosh`, `harmanhealy`, `tcpa`, `firstforauctions`, `seelauctions`, `sheldonbosley`, `benjaminstevens`, `hmox`, `henrysykes`, `sarahmains`, `cotswoldpropertyauctions`, `brownco`, `astleys`, `clarkesimpson`, `loveitts`, `fssproperty`, `cooperandtanner`, `ahlondon`, `starpropertyonline`, `sageandco`, `higginsdrysdale`, `martinpole`, `jonespeckover`, `thepropertyauctionhouse`, `propertyauctionagent`, `lot9`, `auctionnorth`, `bowensonandwatson`, `rogerparry`, `yoowin`, `mchughandco` (own domain, identical platform), plus the `purplebricksgoto` GOTO bridge.

**Probe results:**
- `https://paulfosh.eigonlineauctions.com/search` -> HTTP 200, 96 KB, 0.84s, **50 unique `/lot/details/{id}` URLs**, server-rendered.
- `https://www.harman-healy.co.uk/search` (after 301 -> `harmanhealy.eigonlineauctions.com/search`) -> HTTP 200, 128 KB, 1.3s, **50 unique lot URLs**, server-rendered.
- `https://www.townandcountrypropertyauctions.co.uk/search` -> HTTP 200, 536 KB, 1.9s, **50 unique lot URLs**.
- `https://www.mchughandco.com/current-auction` -> HTTP 200, 60 KB, 0.8s; 2 lot URLs visible (auction currently between cycles).

**Selector blueprint (verified consistent across paulfosh / harmanhealy / tcpa probes):**
- Lot URL: `a[href^="/lot/details/"]`
- Image: `.grid-img-container img.grid-img[src]`
- Address (with postcode): `.grid-price h4.grid-address`
- Lot number + type summary: `.grid-tagline`
- Buy-Now price (when present): `.grid-details a.btn` text (e.g. "Buy Now for £59,000")
- Withdrawn / Sold ribbon: `.panel-auction-ended-holder .panel-auction-ended[data-ribbon]`

**Why 100% enrichment is plausible:** catalogue card has URL, address with postcode, image, lot number, descriptor, status. Detail page (`/lot/details/{id}`) is also server-rendered and the existing `fetchLotPage` chain handles it via plain HTTP for free in most cases.

**Current Firecrawl cost (estimated):** 30 slugs × nightly × 5 credits = up to ~150 credits/night, ~130 credits/night net of changeTracking short-circuits, ~900 credits/week from catalogue scrapes alone.

**Risks:**
- The EIG platform is shared infrastructure; a template change cascades. Mitigated by automated DOM-shape sentinels + the existing `recall_diagnostic` alerts.
- McHugh's catalogue is normally on `mchughandco.com` but EIG sometimes routes specific auctions via the `.com` subdomain; a wrapper redirect handler is needed.
- Auction-mode lots show no price in the catalogue card (only Buy Now lots do); price still comes from detail page — same as current behaviour.

#### A3. Hollis Morgan (single bespoke house, high per-call value, also fixes recall)
Slug: `hollismorgan`.

**Probe result:** `https://www.hollismorgan.co.uk/search-auction/` -> HTTP 200, 788 KB HTML, 2.2s, **111 unique `/property-details/{id}` URLs** in initial HTML, fully server-rendered.

**Selector blueprint (verified against the "College Road, Clifton, BS8 3HX" card):**
- Card boundary: `.thumb-description.auction-thumbs`
- Lot number: `.thumb-description h4.green-font` (text after "Lot ", may be "TBC")
- Address: `.address-block h3` (full UK postal address with postcode)
- Price: `.price-block h4 strong` (e.g. "£1,500,000 +++")
- Bullets: `.bullet-thumbs ul li`
- Detail URL: `a.btn.btn-primary-green[href^="/property-details/"]`
- Image: `.thumb-img img[src]` (one per card, sibling of `.thumb-description`)

**Why 100% enrichment is plausible:** every catalogue field the pipeline cares about is in the card itself, **including price** — which is what makes HM unusually high-value to migrate. The current Firecrawl JSON extract under-counts on dense renders (that is why `recogniseHollisMorganLotsFromMarkdown` at firecrawl-extract.js:623 exists). A deterministic DOM extractor would have 100% recall by construction.

**Current Firecrawl cost (estimated):** single-page nightly + adaptive 6h re-tries on changed days × 5 credits per call. ~30-60 credits/week from full passes, plus ~20-40/week from `/api/analyse` hits. Lower absolute spend than A1/A2 but the recall lift (deterministic > LLM + recogniser fallback) is a secondary motivation.

**Risks:**
- HM runs its own CMS; selector drift if they re-skin the site. Single-house regression alert via the existing recall-diagnostic harness is sufficient mitigation.
- 111 cards in 788 KB — large but still one HTTP request, no Puppeteer wall-clock risk.

### Category B — keep on Firecrawl
- **Pattinson** — plain HTTP returns only 20 of expected ~840 property URLs from 2.1 MB of HTML; the rest hydrate via React after page load. The existing 84-page paginated extract is what it is; Puppeteer at that scale would trip Pattinson's anti-bot.
- **Bond Wolfe** (`/auctions/properties/`) — 121 KB plain HTML with zero property URLs; catalogue cards client-side rendered.
- **Strettons** — Gatsby static site, lots loaded via `/page-data/.../page-data.json`. Migration path is a direct JSON fetch, not Puppeteer (separate refactor; out of scope here).
- **Cliveemson** — 572 KB plain HTML, no lot links; AJAX-loaded.
- **Countrywide South West** (`countrywide` slug) — 31 KB response, JS-loaded.
- **Savills** — `preferPuppeteer:true` already; the existing Puppeteer fallback handles multi-step catalogue auto-discovery, but Firecrawl primary stays because Savills runs aggressive bot detection on cold-start headless.
- **bidx1**, **knightfrank**, **philliparnold** — flagged `blocked` or `SKIP_PUPPETEER` because of reCAPTCHA / StackProtect / WAF.
- **iamsold platform** (`iamsold`, `driversnorris`, `wrightmarshall`, `davidjames`) — server-rendered URLs but the platform aggressively rotates Cloudflare turnstile; Firecrawl handles the challenge transparently.
- **Bamboo whitelabels** (`hunters`, `stags`, `carterjonas`, `lsk`, `rendells`, `247propertyauctions`, `allwalesauction`) — Next.js, hydrated; existing Firecrawl `formats:['rawHtml']` path is fine.

### Category C — broken / regressed (route to /heal rather than migration)
- `network` (BTG Eddisons live-stream) — retired 2026-05-20 (slug merged into `sdl`).
- `hammertime` — retired 2026-05-20 (404).
- `clarkegammon`, `taylerandfletcher`, `woolleyandwallis`, `morrismarshall` — retired 2026-05-09/10 (no live auction).

### Category D — unknown / would benefit from further probing
- `sdl` (BTG Eddisons) — large paginated catalogue; needs a probe of `https://www.btgeddisonspropertyauctions.com/properties/` to confirm whether it is SSR or SPA.
- `acuitus` — `preferPuppeteer:true` and `agentExtract` 600s timeout indicates an unusual structure.
- `johnpye` — markdown recogniser indicates server-rendering enough that the recogniser works; promising but needs render verification.
- Independent bespoke regional houses with `paginateAs:null, preferPuppeteer:false` — most are low-volume single-page catalogues. Worth a one-off audit pass if A1/A2/A3 are migrated and Firecrawl spend is still high.

---

## 4. Estimated savings

**Assumptions (state explicitly so anyone can re-run the math when better data lands):**
- Internal credit weights are correct: `jsonExtractCreditMult = 5`, FIRE-1 `5`, action `1`. These are documented placeholders in `lib/resource-budget.js:32-43` ("Conservative default = 5×; revisit once we have a fresh internal-vs-dashboard reconciliation"). Real burn could be ~2-3× internal weight if the multiplier is undercounting. The 3×-overrun the user is observing strongly suggests the JSON multiplier is the dominant variable.
- "Changed" vs "same" mix per house assumed 70/30 for AHUK regional and EIG whitelabel (live-stream auctions churn weekly), 50/50 for Hollis Morgan (a single fortnightly auction).
- Nightly full-pass + ~3 user-initiated `/api/analyse` hits per migrated house per week (for the headline houses; tail houses get none).
- All three candidates land Puppeteer in the catalogue layer only — detail-page enrichment stays on the existing `fetchLotPage` HTTP-first chain (already cheap).

**Per-week savings table:**

| Candidate | Slugs | Nightly catalogue credits saved | Per-week catalogue credits saved | Notes |
|---|---|---|---|---|
| A1 — AHUK regional | 35 | 130 | ~900 | mostly cron full-pass spend |
| A2 — EIG whitelabel | 30 | 130 | ~900 | live-stream churn keeps changeTracking from helping |
| A3 — Hollis Morgan | 1 | 5-10 | ~50 | recall improvement is the bigger qualitative win |
| **Combined catalogue** | **66** | **~270** | **~1,850** | one third of total observed spend |
| Plus `extractDetail` saves on `/api/lot` for the same houses (HTTP-first chain instead of 5-credit Firecrawl JSON detail extract) | n/a | n/a | ~100-300 | depends on user traffic |

**Plausible total reduction: ~2,000-2,200 credits/week, ~9,000/month**. If the Firecrawl invoice is showing roughly 3× the internal tracking, the dashboard impact is closer to **~6,000 credits/week dashboard-side**, or **~24,000-26,000/month** — material against a 95,000 monthly cap.

**Caveat:** the savings above are derived from cron config + per-house cadence + the public 5×-multiplier weight. They do **not** account for the unknown overcount factor (Bug 5.1 / 5.4 / 5.3 below). Before committing to the migration, paying down the logging gap (Section 6 prompt #1) will give a real number.

---

## 5. Findings — bugs to fix in follow-up prompts

These are observable Firecrawl-related issues turned up during the diagnostic walk. No code changes here — each one becomes a candidate follow-up prompt.

### 5.1 `mapSiteUrls` calls don't record credit usage
`lib/scraper/firecrawl.js:370-388` issues a `POST /v2/map` then returns without calling `recordFcRequest` or `recordFcSuccess`. Every `discoverCatalogueUrl(house)` call in `lib/pipeline/firecrawl-extract.js:973-988` (used by the watcher + manual healing) consumes credits invisibly. Magnitude is low-medium (one-off per house during discovery/healing) but it pollutes the budget delta vs the Firecrawl dashboard — exactly the kind of silent drain that produces the "Firecrawl burn is 3× what we think" sensation.

### 5.2 `batchExtractCatalogues` / `pollBatchJob` dead code
`lib/scraper/firecrawl.js:307` and `:340` declare batch endpoints. The file header in `lib/pipeline/firecrawl-extract.js:22-26` documents the deliberate decision not to use `/v2/batch/scrape` (recall regression vs direct `/v2/scrape`). No production caller invokes either. Dead code — keep an eye on it during reviews; remove in a separate cleanup pass.

### 5.3 `extractDetail` weight assumed = `jsonExtractCreditMult` only
`lib/scraper/firecrawl.js:284`: `computeScrapeWeight({jsonExtract:true, actionCount:0})` -> 5 credits. But Firecrawl bills per-page schema-extract calls in the same band as `extractCatalogue`, which can include `changeTracking` and `markdown` deltas. There's no acknowledgement here that detail extract pages without changeTracking *might* be cheaper than catalogue extract (or might not). Empirical measurement would tighten the budget model.

### 5.4 FIRE-1 agent failure path doesn't credit
`lib/scraper/firecrawl.js:425-449`: only the completed-poll branch (`pollData.status === 'completed'`) calls `recordFcAgentRequest`. If the agent times out after 5 minutes (line 451), the job was *started* on Firecrawl's side (their /v2/extract POST returned a job ID — they charged for it) but the local accounting never books the credits. Healing failures + auction watcher failures + drift-classification failures all silently drain credits.

### 5.5 `/api/analyse` always forces full extract regardless of recent cron
`routes/analyse.js:208`: `forceExtract:true` is unconditional. If the nightly cron has already scraped that exact catalogue 30 minutes ago, the user-initiated analyse still costs 5 credits × pageCount because the changeTracking short-circuit is suppressed by `forceExtract`. A `house_skills.last_full_extract_at < 30min ago` gate would save real money on the manual-demo path.

### 5.6 `enrichLotsFromLotPages` on `/api/analyse` re-fetches recently-enriched lots
`routes/analyse.js:257` calls `enrichLotsFromLotPages(analysed)` synchronously every time. Inside, `fetchLotPage` consults `lot_details` cache only when `opts.skipCache` is falsy — which it is — but the cache is keyed on URL and only returns when the row is `expires_at > now()` (30-day TTL by default). Any lot already analysed *but missing one of the gap-fill fields* (tenure, condition, beds, etc.) goes back to the fetch path because the gap-fill predicate `isGapFillTarget` (lot-detail.js:120) ignores the cache decision. Result: stable lots whose detail page never had the missing field still cost Firecrawl credits on re-analyse.

### 5.7 `extractLotDetailFirecrawl` ignores `lot_details` cache
`routes/analyse.js:420`: `extractLotDetailFirecrawl(url, house)` calls `extractDetail` (5 credits) without first checking `lot_details.extracted_data` for an existing extract. The cache write at line 458 happens *after* the fetch. Lots fetched within the last 30 days re-pay 5 credits each.

### 5.8 Pattinson page-1 hash gate is opt-in via `HOUSE_OVERRIDES` only
`lib/analysis.js:673-691`: the cheap rawHtml page-1 hash check fires only when `ovr.changeTracking === false && ovr.maxPages > 1`. Paginated houses *without* a `changeTracking:false` override (sdl, savills, suttonkersh, countrywide, pugh) rely on per-page changeTracking — which costs 1 credit per unchanged page server-side. A unified page-1 hash gate for every paginated house would collapse those to a single 1-credit probe.

### 5.9 Healing tries FIRE-1 (5 credits) before the free heuristic strategies
`lib/pipeline/healing.js`: the strategy order calls `_askAIForNewUrl` (FIRE-1) early, before the free heuristic `_strategyNavLink` would have a chance. Reordering to cheap-strategies-first would save credits on the simple drift cases that don't need an LLM.

### 5.10 No `firecrawl_credits` column on `scrape_runs`
Per-tier aggregates exist (in-memory only) and the hourly `BUDGET-FC` log line emits them to stdout (server.js:417). Nothing persists per-house, per-cycle credit attribution. The user can see the Firecrawl dashboard daily total and the internal `creditsByTier` but cannot pivot by `house`, `caller`, or `cron tier`. Until that lands, every claim in this audit's Section 4 is an estimate.

---

## 6. Recommended next prompts

In priority order:

### Prompt 1 — Land Firecrawl credit telemetry (do this FIRST)
> Add per-call Firecrawl credit attribution so we can stop guessing. Specifically: 
> (a) Add a `firecrawl_credits` JSONB column to `scrape_runs` capturing `{calls, weight_sum, by_endpoint, by_caller}` per run.
> (b) Threading: pass a `callerLabel` through `getBudget().recordFcRequest(tier, weight, callerLabel)` so the budget collector can roll up by caller.
> (c) Persist the daily roll-up to a new `firecrawl_daily_credits` table at midnight UTC inside `_autoReset` so we have a queryable history.
> (d) Backfill: emit one telemetry row per `scrapeWithFirecrawl` / `extractCatalogue` / `extractHomepage` / `extractDetail` / `agentExtract` / `mapSiteUrls` call. Fix the silent `mapSiteUrls` and agent-timeout gaps from Audit findings 5.1 and 5.4 in the same pass.
> Goal: produce one week of data so we can re-do this audit's Section 4 with real numbers, not estimates.

### Prompt 2 — Migrate Auction House UK regional family to Puppeteer + DOM extractor
> Migrate the 35 AHUK regional slugs (`auctionhouseuklondon`, all the regionals, plus `auctionhouselondon`, `austingray`, `auctionhousescotland`) to a single shared Puppeteer + cheerio catalogue extractor. The selector blueprint is in Audit Section 3.1. Keep the existing `enrichLotsFromLotPages` detail-page chain unchanged. Add a per-shape sentinel that fires `firecrawl_extract_regression` alert when the DOM shape drifts. Verify against `/london/auction/search-results` first (243 lots, 591 KB), then roll out to the other regional slugs by updating the `paginateAs` / extractor routing in `lib/houses.js::rewriteUrl`. **Do not** retire the Firecrawl fallback — keep it as Tier 2 in the existing three-tier scraper.

### Prompt 3 — Migrate the EIG whitelabel family (~30 slugs) using one shared extractor
> Same shape as Prompt 2 but for the EIG whitelabel template (selectors in Audit Section 3.2). All `*.eigonlineauctions.com` plus the platform-bridged `harman-healy.co.uk`, `mchughandco.com`, `townandcountrypropertyauctions.co.uk`, `auctionworks.co.uk`, `sbkauctions.co.uk`, etc. The single shared extractor reads `.grid-img-container`, `.grid-address`, `.grid-tagline`, `.grid-details`, `.panel-auction-ended` and produces the same lot shape currently coming out of `extractCatalogueListing`. Verify against `paulfosh.eigonlineauctions.com/search` (50 lots), `harmanhealy.eigonlineauctions.com/search` (50), `townandcountrypropertyauctions.co.uk/search` (50). Keep Firecrawl as Tier 2 fallback.

### Prompt 4 — Cheap wins: gate `/api/analyse` and `/api/lot` against fresh cache, add page-1 hash to all paginated houses
> Three small bug fixes from the audit:
> (a) `routes/analyse.js:208` — change `forceExtract:true` to `forceExtract: notWithinLastMinutes(house, 30)`. Only bypass changeTracking when the cron's most recent extract is genuinely stale.
> (b) `routes/analyse.js:420` — `/api/lot`: gate `extractLotDetailFirecrawl` behind a `lot_details.extracted_data` read for the same URL with `expires_at > now()`. Return the cached extract when present.
> (c) `lib/analysis.js:673-691` — lift the Pattinson page-1 rawHtml hash gate out of `HOUSE_OVERRIDES` into a generic "any house with `maxPages > 1`" check. Add a per-house `catalogue_page1_hash` column on `house_skills` if not already there (migration 2026-05-22-house-skills-page1-hash.sql may already provide it — verify).
> Goal: ship in one PR, no scope creep. Estimated savings 500-1,000 credits/week with no migration risk.

---

## 7. CRITICAL CORRECTION based on Firecrawl dashboard data (added 2026-05-25, post-review)

The activity log from the Firecrawl dashboard contradicts Section 1's spend model in one critical way: **the dominant endpoint is `/v2/extract` (FIRE-1 agent), not `/v2/scrape` (JSON catalogue extract)**. Every single visible call in the dashboard's Recent Activity list shows endpoint `/extract`, with credit cost **21-26 credits per call (mean ~23)**.

Reconciliation against internal accounting:
- `lib/resource-budget.js:28` sets `fire1CreditMult = 5` (env-overridable). Real per-call cost is ~23, so the multiplier is **undercounting FIRE-1 spend by ~4.6×**.
- `lib/resource-budget.js:37` sets `jsonExtractCreditMult = 5`. Most `/v2/scrape` JSON-extract calls are NOT in the visible 30-day activity list, suggesting either they're paginated off the dashboard's first page (likely — Firecrawl shows recent /extract jobs first) or they cost materially less than 5 credits each. The dashboard's 30-day total is **121,561 credits**; if the visible /extract calls were the majority, the math works out to ~5,000+ FIRE-1 calls in 30 days = ~165/day.
- `_autoReset` does not align with the Firecrawl plan refresh (Jun 14 in the dashboard) — the internal `creditsUsed` rolls over on UTC month boundary, which puts the internal counter and the plan-cycle counter out of sync. This is one reason the 80/95% threshold alerts haven't fired despite real spend being ~70% through the plan.

This explains the "3× actual vs internal" sensation. Sections 1, 2, 4, and 6 all underestimated FIRE-1 contribution. The Puppeteer migration in Section 3 remains sound, but it would solve a smaller-than-thought problem until the FIRE-1 leak is plugged.

### 7.1 What the activity log actually reveals

Sample window: **2026-05-25 03:00-04:00 UK** (cron Tier 1 full pass + Tier 12 homepage watch). All entries from this hour are `/extract` (FIRE-1) jobs.

| Category | Sample URLs hit | Cost (~23/call) | Root cause |
|---|---|---|---|
| **Retired house heal attempts** | `auctiontrade.eigonlineauctions.com`, `nationalpropertyauctions.eigonlineauctions.com`, `romanway.eigonlineauctions.com`, `hammerprice.eigonlineauctions.com`, `brggibsondublinauctions.eigonlineauctions.com` (×3 — `/`, `/pages/faq` ×2) | ~7 calls × 23 = ~160 credits in 5 minutes | Healing fires when 0-lot scrape; retired EIG subdomains 404 → 0 lots → heal. Plus `homepage-watch.js:276` iterates ALL `HOUSE_ROOTS` without filtering `RETIRED_HOUSES`. |
| **Off-platform search-result garbage** | `https://www.facebook.com/groups/kiwifirsthomebuyers/posts/9504255699594706/` (NZ first-home-buyers FB group), `https://www.facebook.com/AuctionBids/`, `https://www.facebook.com/www.247propertyauctions.co.uk/`, `https://higginsdrysdale.com/blog/online-house-auctions-tools-and-guides`, `https://ahl.stagingenv.cloud/.../9400050-AHL-Catalogue.pdf` | ~5 calls × 23 = ~115 credits in one window | `_webSearchForCatalogue` (lib/pipeline/healing.js:531-612) runs 3 search queries per heal; **query #3 is NOT site-scoped** (`"${houseName}" property auction current lots`) so it pulls in random Facebook posts, blog spam, and PDF catalogues — all fed to FIRE-1 at 23 credits each. |
| **House homepage roots (heal probe)** | `https://www.iamsold.co.uk`, `https://www.bondwolfe.com`, `https://www.markjenkinson.co.uk`, `https://www.dawsonsproperty.co.uk`, `https://www.barnardmarcusauctions.co.uk/`, `https://www.kivells.com` ×2, `https://www.fishergerman.co.uk` ×4 in 15 min | ~30+ calls × 23 = ~700 credits in one window | `_askAIForNewUrl` (healing.js:482) is invoked in the heal flow before cheap heuristic strategies even get tried in many code paths. Multiple identical URLs hit within minutes = no dedup gate before FIRE-1. |
| **Duplicate-fire of same URL** | `brggibsondublinauctions.eigonlineauctions.com/pages/faq` appears 2× in same second; `kivells.com/farms-and-land/farms-and-land-for-auction` 2× in 1 min; `fishergerman.co.uk/land-property-auctions` 4× in 1 min | each duplicate = ~23 wasted credits | No in-process URL-call dedup in healing pipeline. `_webSearchForCatalogue` runs the 3 queries sequentially; if early queries surface the same candidate URLs the FIRE-1 calls fire repeatedly. |
| **Watcher Tier 2 AI fallback** | `https://www.allsop.co.uk/`, `https://www.maggsandallen.co.uk/`, `https://www.hollismorgan.co.uk/`, `https://www.auctionhouselondon.co.uk/`, `https://www.suttonkersh.co.uk/`, `https://www.buttersjohnbee.com/properties-for-auction` — all `AUCTION_DISCOVERY` slugs at 03:00-03:02 | 6+ calls × 23 = ~140 credits | `lib/pipeline/auction-watcher.js:263 discoverViaAI` fires when the cheaper Tier 1 (regex) + Tier 1.5 (probe) tiers can't find a future-dated link. Triggered Tier 1 at 03:00 daily. |

Visible /extract calls in that one hour: ~60+. At 23 credits each, **~1,400 credits in a single cron window** — and that's just the FIRE-1 layer, not the /v2/scrape JSON extracts the cron also fires for catalogue scraping.

Daily burn from the chart: peak ~8,000 credits/day, recent average ~6,000/day. If ~30-50% of daily burn is FIRE-1 (consistent with the cron-window sample above), **FIRE-1 alone is burning 60-100k credits/month — 60-100% of the plan**. The "3× internal-vs-real" sensation is almost entirely the `fire1CreditMult=5` placeholder being off by ~4.6×.

### 7.2 New bugs (additive to Section 5)

#### 5.11 RETIRED_HOUSES not filtered by homepage-watch (CRITICAL — easiest fix)
`lib/pipeline/homepage-watch.js:276` does `const houses = Object.entries(HOUSE_ROOTS)`. `RETIRED_HOUSES` is imported in `lib/analysis.js` and `lib/pipeline/calendar-sync.js` but **not** in homepage-watch. Every retired slug is checked every other day, and the 7 retired EIG subdomains (`groundrentauctions`, `auctiontrade`, `romanway`, `hammerprice`, `brggibson`, `brggibsondublin`, `nationalpropertyauctions`) plus the 5 newer retirements all trigger drift/parked verdicts. The `URL_DRIFT_NEW_DOMAIN` path fires `classifyNewDomainDrift` (FIRE-1, ~23 credits). The `DOMAIN_PARKED` path is cheaper (no FIRE-1) but still spams alerts.

**Estimated waste:** 12 retired × every-other-day × ~23 credits per drift call × ~50% drift verdict rate ≈ **~140 credits/run × 15 runs/month ≈ 2,100-4,000 credits/month**. Possibly higher because retired EIG subdomains return identical content to live ones, biasing toward URL_DRIFT_NEW_DOMAIN.

**Fix:** one-line `.filter(([slug]) => !RETIRED_HOUSES.has(slug))` after the `Object.entries` call.

#### 5.12 `_webSearchForCatalogue` un-scoped 3rd query pulls in garbage URLs (CRITICAL)
`lib/pipeline/healing.js:539-543`:
```
const queries = [
  `"${houseName}" auction lots site:${domain}`,
  `"${houseName}" auction catalogue properties site:${domain}`,
  `"${houseName}" property auction current lots`,   // <-- no site: scope
];
```
The third query has no `site:` operator and is what is putting Facebook groups, blog posts, PDF catalogues, and unrelated third-party URLs into the FIRE-1 candidate pipeline. Each query's top 5 results are handed to FIRE-1 as `candidateUrls` and FIRE-1 visits each (~23 credits per agent call, internal scrape weight on each visit too).

**Estimated waste:** for every house that triggers `_webSearchForCatalogue` (= every healed house whose homepage scan didn't yield a URL), ~1 FIRE-1 call from query #3 × ~23 credits = ~23 credits. Across the retired-EIG churn alone, **~5-10× per day = ~3,000-7,000 credits/month**.

**Fix options:** (a) drop the un-scoped query entirely; (b) prepend `site:.co.uk OR site:.com OR site:.org.uk` and exclude `facebook.com`, `twitter.com`, `youtube.com`, `linkedin.com`, `paperturn-view.com` in the candidate filter; (c) make query #3 only fire when the first two queries returned zero results.

#### 5.13 No URL dedup in healing → same URL hit by FIRE-1 within seconds
Dashboard shows `brggibsondublinauctions.eigonlineauctions.com/pages/faq` twice in the same second (2026-05-25 03:51), `kivells.com/farms-and-land/farms-and-land-for-auction` twice within 1 minute, and `fishergerman.co.uk/land-property-auctions` four times within 1 minute (03:06-03:07 and 03:19). Healing fires for the same broken slug across the cron full-pass AND the heal-sweep step within minutes; each invocation does its own search → candidate set → FIRE-1 call without coordinating with the prior heal's outcome.

**Fix:** lift the existing `_healingState` cooldown gate to also check for "FIRE-1 already called for this URL within last N minutes" before re-invoking. Cheap; one extra Map check.

#### 5.14 `fire1CreditMult = 5` is wildly wrong; should be ~23
`lib/resource-budget.js:28`. Dashboard says 21-26 per call. Real multiplier ≈ 4.6× the placeholder. The 80%/95% threshold alerts in `_autoReset` never fire because internal `creditsUsed` lags Firecrawl's actual by this exact ratio. Until this is corrected, the entire budget enforcement chain (canUseFirecrawl, threshold alerts, daily-cap-hit, monthly-cap-hit) is functionally disabled for the FIRE-1 path.

**Fix:** set `FIRECRAWL_FIRE1_CREDIT_MULT=23` in Railway env immediately (no code change). Optionally raise the default in code in a follow-up.

#### 5.15 `_autoReset` rolls on UTC month boundary, not Firecrawl plan refresh date
`lib/resource-budget.js:413` resets `creditsUsed` (and crucially `thresholdAlert80Hit`, `thresholdAlert95Hit`) on UTC month boundary. Firecrawl Standard plan refresh date is mid-month (Jun 14 per dashboard). The internal counter ratchets through "month 1" while the plan ratchets through "billing cycle". Even if 5.14 is fixed, the threshold alerts would still fire at wrong times.

**Fix:** make the reset day configurable via `FIRECRAWL_PLAN_REFRESH_DAY` env var (default current behaviour, but the Standard plan would set it to 14).

#### 5.16 `/v1/search` calls in `_webSearchForCatalogue` are never credited
`lib/pipeline/healing.js:548-556`: `fetch('https://api.firecrawl.dev/v1/search', ...)` runs a Firecrawl search and consumes credits, but does not call `recordFcRequest` or any budget hook. Three searches per heal × multiple heals/night = unbudgeted spend invisible to internal accounting. Similar to Section 5.1 (`mapSiteUrls` silent) but a different endpoint.

### 7.3 Revised Section 4 — estimated savings, real-world

Section 4 estimated ~2,000 credits/week saved from migrating ~65 slugs to Puppeteer. That figure was modelled on the WRONG dominant endpoint. Revised, post-correction:

| Fix | Type | Estimated savings | Confidence |
|---|---|---|---|
| 5.11 — filter `RETIRED_HOUSES` in homepage-watch | one-line change | 2,000-4,000 credits/month | high |
| 5.12 — drop un-scoped 3rd search query in `_webSearchForCatalogue` | small refactor | 3,000-7,000 credits/month | high |
| 5.13 — dedup FIRE-1 calls per URL within window | small change | 500-1,500 credits/month | medium |
| 5.14 — set `FIRECRAWL_FIRE1_CREDIT_MULT=23` (env) | env tweak | 0 direct credits but: budget enforcement starts working, threshold alerts fire, daily-cap blocks runaway | critical for observability |
| 5.15 — align `_autoReset` to plan refresh day | small change | 0 direct credits, fixes threshold-alert correctness | high |
| 5.16 — credit `/v1/search` calls | small change | 0 direct credits, fixes accounting | high |
| 5.9 — reorder heal strategies (cheap first) | small refactor | 1,000-3,000 credits/month | high |
| Section 3 — Puppeteer migration (A1+A2+A3) | medium project | ~8,000-10,000 credits/month | medium (depends on `/v2/scrape` real cost which is unverified) |
| 5.5 — gate `/api/analyse` `forceExtract` | small change | 500-1,500 credits/month | medium |
| 5.6/5.7 — cache gates on `/api/lot` + `enrichLotsFromLotPages` | small change | 300-800 credits/month | medium |

**Combined immediate-win (do these THIS WEEK):** 5.11 + 5.12 + 5.13 + 5.14 + 5.16 = **~6,000-13,000 credits/month saved + budget enforcement restored**. These are 4 small code changes + 1 env var. Estimated effort: half a day.

**Combined Puppeteer migration (do this NEXT):** ~8,000-10,000 credits/month additional. Estimated effort: a focused week with the selector blueprints in Section 3.

### 7.4 Revised Section 6 prompt order

Replace the original Prompt order with this:

#### PROMPT 1 (URGENT — do today) — Stop the FIRE-1 leak
> Three small fixes to stop the visible FIRE-1 credit leak:
> (a) `lib/pipeline/homepage-watch.js:276` — filter out `RETIRED_HOUSES` slugs from the iteration: `const houses = Object.entries(HOUSE_ROOTS).filter(([slug]) => !RETIRED_HOUSES.has(slug))`. Add the import.
> (b) `lib/pipeline/healing.js:539-543` — `_webSearchForCatalogue` queries: remove the un-scoped third query, OR add an exclusion filter on candidate URLs that drops anything matching `facebook.com|twitter.com|x.com|youtube.com|linkedin.com|instagram.com|paperturn-view.com|reddit.com|tiktok.com|.pdf$` before handing to FIRE-1.
> (c) `lib/pipeline/healing.js:_webSearchForCatalogue` — add an in-process `Set<url>` of "FIRE-1 already called this URL in last 30 min" and skip duplicates. Likely 6 lines added.
> Verification: deploy, watch the Firecrawl dashboard activity log for 24h, confirm no more facebook.com / retired-house entries.

#### PROMPT 2 (URGENT — same PR) — Restore budget enforcement
> Two-part change:
> (a) Set Railway env var `FIRECRAWL_FIRE1_CREDIT_MULT=23` immediately. (No code change — `lib/resource-budget.js:28` already reads this env.) This restores threshold-alert correctness.
> (b) `lib/resource-budget.js`: add a `recordFcSearchRequest()` and call it inside `_webSearchForCatalogue` after each `fetch('https://api.firecrawl.dev/v1/search', ...)`. Treat each search as ~1 credit weight (Firecrawl's documented search pricing) until reconciliation lands.
> (c) Optional: `lib/resource-budget.js:413` `_autoReset` — accept `FIRECRAWL_PLAN_REFRESH_DAY` env var so the monthly counter aligns with the plan cycle (Jun 14, 14th of each month for the Standard plan). Until this lands, the 80%/95% threshold alerts will keep firing at wrong times.
> Verification: by tomorrow, `BUDGET-FC` log line shows credits-used numbers that are within ~10% of the dashboard daily total.

#### PROMPT 3 (telemetry — formerly Prompt 1) — Land per-call credit attribution
> (Same as the original Prompt 1 — `firecrawl_credits` JSONB on `scrape_runs`, threading `callerLabel` through `recordFcRequest`, daily roll-up table.) Now extra-important because we know FIRE-1 is the dominant cost.

#### PROMPT 4 — Reorder heal strategies (cheap-first)
> `lib/pipeline/healing.js` (around line 215-296): currently runs `_strategySitemap` → `_strategyNavLink` → merger check → `_askAIForNewUrl` (FIRE-1) → `_webSearchForCatalogue` (more FIRE-1). The two free heuristic strategies often succeed for simple URL drift; for those cases the FIRE-1 path should never have fired. Verify the current order and ensure FIRE-1 only fires after BOTH heuristic strategies AND the redirect-follow strategy have returned null. Add an `if (FIRECRAWL_FIRE1_DISABLED)` env-gate to allow operators to force-disable FIRE-1 healing in budget emergencies.

#### PROMPT 5 — Puppeteer migration (formerly Prompt 2) — AH UK regional family
> (Same as original Prompt 2 — selectors in Section 3.1.)

#### PROMPT 6 — Puppeteer migration (formerly Prompt 3) — EIG whitelabel family
> (Same as original Prompt 3 — selectors in Section 3.2.)
