# Coverage Fix Plan — Image / Price / Address / Comps

**Status (2026-04-27):** Rollout items **#1 + #2 SHIPPED** in commit `b2f79b7`. Baseline captured at `coverage-baseline.json`. The post-deploy data invalidates several premises of this document — see **"Post-deploy reality check"** below before working on items #3–#8.

**Original goal:** Move the auction pipeline towards 100% image, price, and address coverage, plus real local comps for deal stacking.

---

## Post-deploy reality check (added 2026-04-27)

Coverage measured against 10,366 lots in the live `lots` table:

| Field | Plan estimate | Actual | Real gap |
|---|---|---|---|
| `image_url` | "~80–90% real" | **96.5%** | Concentrated in 2 houses (`Charles Darrow` 17.6%, `landwood` 0%) — extractor bugs, not a generalised fix |
| `price` | "~70–85% real" | **97.5%** | `edwardmellor` (79.2%) is the only top-volume gap |
| `postcode` | (not estimated) | **83.9%** | `harmanhealy`, `edwardmellor`, `cliveemson`, `futureauctions` dominate the misses |
| `uprn` | "~70–80%, drops to ~40–50% on land" | **13.3%** | **The real gap** — most houses sit at 0%. Fix #2's UPRN re-targeting + retry queue is the highest-leverage piece in this whole plan |
| `epc_rating` | (not in plan) | **36.0%** | Underrated gap. Worth its own follow-up |
| `flood_risk` | (not in plan) | **71.5%** | Modest gap |
| `field_sources` non-empty | (not in plan) | **13.3%** | Exactly matches `uprn` count → provenance is currently only stamped by the OS Places path. Fix #6's catalogue-path stamping (live in `lib/pipeline/extractor.js`) should lift this on the next scrape cycle |

**Bug uncovered by the baseline:** 196 retry-queue rows are `exhausted` (5/5 attempts) with `reason='circuit_open'`. The drain in `lib/pipeline/enrichment-wave.js` Pass 6 burned 5 attempts per row while the OS Places circuit breaker was tripped, instead of skipping. Filed as a follow-up — drain should call `getCircuitStatus()` from `lib/os-places.js` and bail without incrementing attempts when the breaker is open.

**Headline takeaway:** The plan's "image/price coverage is the problem" framing was wrong. Image and price are already at 96–98%. The real gaps are UPRN (13%), EPC (36%), and a small handful of broken-extractor houses. Fixes #1+#2 still ship value (they unlock returning-lot UPRN recovery + dense provenance + retry infrastructure), but the next item should be sized against the real gaps, not the imagined ones.

**Recommended next item (revises the rollout table below):**
1. **Fix the retry-queue circuit_open bug** — small, blocks the UPRN gap-filler from making progress.
2. **Rollout #4 (per-lot quality score + targeted alerts)** — empirically justified now that we know the gaps are house-concentrated, not pipeline-wide. SLA-style alerts will catch the next `Charles Darrow`-style extractor break automatically.
3. **Investigate `Charles Darrow` + `landwood` image extractors** — a self-healing-harness task, not a fix from this plan.
4. **Investigate `edwardmellor` postcode extractor** — same.
5. **EPC coverage as its own plan** — 36% is too low to ignore but isn't addressed by anything in this document.

Defer until the above land:
- Rollout #3 (price normaliser): real gap is too small to prioritise.
- Rollout #5–#8 (comps build): unrelated to coverage, ships independently when product calls for it.

---

---

## Context — what's blocking 100% coverage today

### Image coverage (~80–90% real)
- Lazy-load swap (`lib/scraper.js:319`) only handles `data-src`/`data-lazy-src`/`data-original`. Misses `srcset`, CSS `background-image`, SVG `<use>`, custom JS loaders.
- Position-based fallback gated to ≥30% pre-match (`lib/scraper.js:415-425`). Below that, lots get nothing.
- Detail-page extraction harvests up to 8 images per lot but never merges back into the persisted `image_url` (sits in `lot._enrichment` only).
- Returning lots are frozen — detail-page enrichment only runs when `_isFirstContact` is true (`lib/pipeline/enrich-stage.js:141-143`).
- Hero-image bleed strip (`lib/pipeline/persist-lots.js:108-137`) nukes any image used by ≥3 addresses, including legitimate multi-unit hero shots.
- Firecrawl credit exhaustion stops Puppeteer fallback too (`lib/pipeline/enrich-stage.js:159-172`) — ~1hr blackout.
- No re-validation of cached image URLs (CDN expiry → silent broken images).
- `_fieldSources` provenance is sparse — can't audit why an image is missing.

### Price coverage (~70–85% real, hidden by 60% gate)
- POA / TBA / "Guide TBC" → `price: null` with no recovery (`lib/extractors/details/_shared.js:98-99`).
- Range prices ("£100k–£120k") capture only the first number — every DOM extractor uses naive `/£([\d,]+)/`.
- `£300k` notation captures "300", not 300000.
- Detail-page price extraction exists but isn't merged back to `price` (same bug as images).
- Reserve / starting bid / hammer / guide / "plus fees" conflated.
- `sold_price` column exists in schema but isn't populated for most houses.
- Returning lots with `price: null` never re-tried.
- No plausibility check — Gemini can return "£15" for a house and it persists.
- Quality gate (`lib/harness/quality-gate.js:37-45`) only warns at <60% aggregate — 40% null prices passes silently.

### Address coverage (~70–80% UPRN, drops to ~40–50% on land/portfolio lots)
- OS Places only runs on first-contact lots (`lib/pipeline/enrich-stage.js:26-49`). Re-scrapes never canonicalise.
- Postcodeless addresses skip the entire enrichment chain. Land lots systematically under-served.
- Multi-property portfolios collapse to one address — no `lot_units` table.
- Circuit breaker silently ships UPRN-less lots during 10-min outage (`lib/os-places.js:64`). No retry queue.
- No OS Places budget counter (100k/month free tier — could blow silently).
- `property_key` dedup collides on null postcodes (everything starting "Land at" buckets together).
- No "address_completeness" flag distinguishing verified vs raw scraped addresses.
- No fallback geocoder (postcodes.io / Nominatim) when OS Places fails.

### Comps / deal stacking — barely exists
| Source | Status |
|---|---|
| Land Registry sold prices | **Partial** — fetched and used in scoring (`street_avg`, `below_market`), persisted as `street_sales` JSONB. 3-year window only. |
| EPC register | **Partial** — rating + score persisted; **floor area fetched but never written to schema**, so £/sqft is fragile. |
| VOA rentals | **Static lookup table** (`lib/enrichment.js:228-248`). Not a real market feed. |
| Rightmove / Zoopla current listings | **Not integrated**. |
| Title information | **Regex from text only**. No Land Registry Title API. |
| BridgeMatch fundability | **Integrated**, but lender appetite ≠ comps. |
| Postcode trend tables | **Don't exist**. |
| Cross-auction same-postcode comparison | **Doesn't exist**. |
| Days-on-market / lettability | **Not captured**. |

---

## The five structural fixes (leverage points)

### 1. Re-enrich returning lots, not just first-contact ⭐ NEXT SESSION
Replace `_isFirstContact` gating with **per-field staleness check**.

- Add `enriched_at` timestamps (or extend `field_sources` JSONB with timestamps).
- For each lot, re-run any enrichment whose target column is null OR `enriched_at` older than N days.
- Add a nightly "gap-filler" cron in `lib/pipeline/cache-enrich-stage.js` that selects lots where `image_url IS NULL`, `price IS NULL`, `uprn IS NULL`, or `epc_rating IS NULL` and re-attempts only the missing field.
- Unfreezes 100% of cached lots without re-scraping the catalogue.

### 2. Merge detail-page extracts into the persisted lot ⭐ NEXT SESSION
Detail-page extraction already runs (`enrichLotsFromLotPages`) — it stops at the manifest. Promote values onto the lot in `lib/pipeline/persist-lots.js` when the catalogue field is null or weaker:

- `imageUrl` ← first non-placeholder detail image if catalogue has none.
- `price` ← detail-page price if catalogue is null/POA and detail price passes a £5k–£10m sanity check.
- `address` ← detail-page address if it contains a postcode and catalogue doesn't.
- Stamp `field_sources[field] = 'detail-page'` for every promoted field.

### 3. Stamp `_fieldSources` everywhere
Make `setField()` from `lib/quality/field-source.js` mandatory in DOM extractors, Firecrawl backfill, Puppeteer backfill, Gemini fallback, detail-page merge. Cheap; transforms debugging.

### 4. Per-field SLAs replace the 60% aggregate gate
- New columns: `lots.quality_score`, `lots.quality_issues` JSONB (e.g. `["no_image","poa_price","no_postcode"]`).
- Per-field thresholds in `lib/harness/quality-gate.js`: image ≥ 95%, price ≥ 90%, postcode ≥ 90%, UPRN ≥ 80%.
- A failing field fires a targeted alert (`extractor_image_regression`, `extractor_price_regression`).

### 5. Add a retry queue
New table `enrichment_retry_queue (lot_id, field, attempts, next_retry_at, last_error)`. Anything hitting `circuit_open`, `timeout`, `api_error`, or `no_match` gets queued. Cron drains it. Exponential backoff, max 5 attempts. Catches OS Places outages, Firecrawl exhaustion, transient 5xx.

---

## Image-specific fixes
- Broaden lazy-load swap (`lib/scraper.js:319`) to cover `srcset`, `data-bg`, `data-image`, `style="background-image:..."`.
- Drop the 30% gate on position-based fallback. Replace with strict matcher: only use position when `unusedImgs.length === stillMissing.length` AND both came from the same DOM container in document order.
- Soften hero-bleed strip — *demote* shared images (`_imageIsShared=true`), let detail-page merge replace them with property-specific photos.
- Validate cached image URLs weekly (HEAD request cron). 4xx/5xx → null the column, queue for backfill.
- Add `force_image_backfill` admin endpoint per house.
- Reject placeholders by perceptual hash, not URL regex.

## Price-specific fixes
- Add `parseGuidePrice(text)` in `lib/utils.js`. Every extractor uses it.
- New columns: `price_status` (`guide` | `poa` | `tba` | `starting_bid` | `withdrawn` | `sold`), `price_min`, `price_max`.
- Plausibility check post-extraction (£5k–£10m). Outside range → flag, don't auto-accept.
- `post_auction_resolver` cron: after auction date passes, re-fetch lot URL, extract `sold_price` + `result`. This is what unlocks real comps later.
- Remove POA from price-coverage denominator — known unknowns, not failures.

## Address-specific fixes
- Add `postcodes.io` fallback when OS Places returns `no_match` (free, no key). Nominatim as third tier.
- Multi-unit data model: new `lot_units` child table (`lot_id`, `unit_address`, `unit_uprn`, `unit_postcode`). Split when address contains "block of N", "portfolio of N", or comma-separated postal addresses.
- OS Places budget counter (`usage_counters` table). Alert at 80% monthly cap, hard-stop at 99%.
- Fix `property_key` collision — generated column `NULL` when postcode is null.
- New `address_completeness` column: `verified` | `postcode_only` | `partial` | `none`.
- Cache validation: Levenshtein check between input address and cached canonical before serving cache hit. >0.4 distance → re-query.

## Comps build (real new feature, not a fix)
1. Persist what you have: write Land Registry results to `postcode_sales` table; write EPC `floor_area_sqft` to lots schema.
2. Materialised `postcode_stats` view: median sold, transaction count, 90/180/365-day windows by property_type + beds. Refreshed nightly.
3. Rentals feed: cheap path = Firecrawl Rightmove rental search per postcode weekly into `postcode_rentals`. Proper path = PropertyData / Patma / Lofty Data API.
4. Wire `est_monthly_rent` to `postcode_rentals`, keep static table as final fallback.
5. New endpoint `/api/lots/:id/comps` returning 5 nearest sold + 5 nearest rentals + £/sqft band + yield band.
6. Cross-auction same-postcode endpoint joining `lots` to `lots` on postcode within last 12 months.
7. Land Registry Title API for tenure / lease length / title number. Gate behind paid trigger (~£3/title).
8. Days-on-market signal from `lot_history` (`first_seen_at` → `sold_at`).

---

## Rollout order (by ROI)

| # | Fix | Effort | Outcome |
|---|---|---|---|
| 1 | Detail-page merge + `_fieldSources` everywhere | 1–2 days | Recovers ~10% of missing fields, unblocks audit |
| 2 | Re-enrichment of returning lots + retry queue | 2–3 days | Recovers more, stops permanent freezes |
| 3 | Price normaliser + `price_status` column | 1 day | Fixes silent corruption |
| 4 | Per-lot quality score + targeted alerts | 1 day | Future regressions become visible |
| 5 | Multi-unit `lot_units` table + postcodes.io fallback | 2 days | Fixes worst address gaps |
| 6 | Persist Land Registry sales + EPC floor area | 1 day | Unblocks comps |
| 7 | Rentals feed + `postcode_stats` view | ~1 week | Real comps |
| 8 | Title API + comps UI | TBD | Once data layer is solid |

**Combined target for #1 + #2:** lifts coverage from ~75% to ~90% with no new external dependencies.

---

## How to start the next session

Open a new chat in this repo and say:

> Read `docs/COVERAGE_FIX_PLAN.md`. Implement fixes #1 and #2 from the rollout table together — detail-page merge with `_fieldSources` stamping, plus re-enrichment of returning lots with a retry queue. Single PR.

The fresh session will have project conventions loaded via the `auction-conventions` skill and can pick up from there.
