# Continuation prompt — pick up where we left off (2026-04-30)

Paste this into a new Claude Code session in this repo to resume.

---

## Drop-in prompt

> Context: we just finished a long session on the Auction project (15 commits between `d207764` and `3c2db38`). All scoped urgent fixes shipped + a lot of comps/rentals data layer built. Read `docs/CONTINUATION-2026-04-30.md` for the full state. Then do this next: **{pick one from the "Pick next" section below}**.
>
> Before touching code: invoke the `auction-conventions` skill. For any house-broken / image-coverage / extractor incident: invoke `auction-self-healing`. For any Supabase work: the MCP is authenticated, use `mcp__plugin_supabase_supabase__execute_sql` directly.

---

## What shipped today (15 commits, all on `main`)

| Commit | What |
|---|---|
| `d207764` | Past-auction filter — drop 7-day grace (stale Maggs lots fix) |
| `03ead25` | 5 critical code-review fixes: dbQuery typo, severity 'warn' typo, OS Places isOpen mutation, below_market double-count, admin secret out of localStorage |
| `186c1b5` | Migration: reset legacy `circuit_open` retry-queue rows |
| `4a073b8` | `scripts/apply-2026-04-29-reset-circuit-open.mjs` runner |
| `3b0e062` | Security batch: admin body-secret + rate-limit + validateUrl + Pass-3 fix + toPublicUser allowlist |
| `b989dd3` | Atomic AI-search counter via `increment_ai_search` RPC |
| `2ce72fa` | `lot_units` schema + units year-as-count regex bug |
| `658e722` | `postcode_sales` table + `lots.epc_floor_area_sqm/sqft` |
| `19a39dd` | SpareRoom + OnTheMarket rental scrapers (`lib/rentals/*`) |
| `d64d7a0` | `auction_calendar` URL→date cache (5-min TTL) |
| `a69b4f0` | `latest_lot_history_hashes` RPC — fixes silent duplicate snapshots |
| `ab2bb6b` | Cron `unsold-alerts` batched: 1 alerts query, 1 users query, 1 lots query |
| `60e659a` | `estimateMonthlyRentSmart` + `GET /api/lots/:id/comps` endpoint |
| `7e5fb60` | futureauctions extractor: collapse address whitespace |
| `3c2db38` | Skill update: feed two new failure modes into `auction-self-healing` |

## Live DB changes via Supabase MCP today

- **Retry queue:** 25 legacy `circuit_open` rows reset (`attempts: 5 → 0`); 1,147 stalled `circuit_open`-stamped lots re-enqueued
- **Units corruption:** 8 rows with `units >= 100` cleared (year-as-count contamination)
- **Land Registry:** 18,155 sales backfilled into new `postcode_sales` table from `lots.street_sales` JSONB
- **EPC:** 1,522 lots backfilled with `epc_floor_area_sqm`/`_sqft` from manifest data
- **Postcodes.io pilot:** 119 lots geocoded (1 batch of 100 unique postcodes)
- **Rental scrape pilot:** 352 listings inserted (25 highest-priority postcodes via OTM + filtered SpareRoom)
- **futureauctions:** 143 image URLs upgraded `http://` → `https://`; ~140 addresses whitespace-cleaned

## New tables / RPCs / migrations now live

```
TABLES:
  postcode_sales                 (18,155 rows, idx on postcode + sold_date)
  postcode_rentals               (352 rows, idx on postcode/beds/scraped_at)
  postcode_rental_freshness      (27 rows — cadence ledger)
  lot_units                      (empty schema, ready for detector)

LOTS COLUMNS ADDED:
  epc_floor_area_sqm DOUBLE PRECISION
  epc_floor_area_sqft INTEGER

RPCs:
  increment_ai_search(uuid, date, int) → (searches_used int, allowed bool)
  latest_lot_history_hashes(uuid[])    → (lot_id uuid, snapshot_hash text)

MIGRATIONS (in repo, all applied via MCP):
  migrations/2026-04-29-reset-circuit-open-exhausted.sql
  migrations/2026-04-30-increment-ai-search-rpc.sql
  migrations/2026-04-30-lot-units-schema.sql
  migrations/2026-04-30-lr-comps-and-epc-floor-area.sql
  migrations/2026-04-30-rental-comps.sql
  migrations/2026-04-30-latest-lot-history-rpc.sql

ADMIN ENDPOINTS ADDED:
  POST /api/admin/rentals/drain  (header-only auth, rateLimit 5/min)
```

## Code review backlog status — ALL 13 CLOSED ✅

| # | Item | Commit |
|---|---|---|
| 1–5 | Top criticals (dbQuery, severity, isOpen, below_market, localStorage) | `03ead25` |
| 6 | admin body-secret + rate-limit | `3b0e062` |
| 7 | validateUrl on probes | `3b0e062` |
| 8 | auction_calendar full-table scan | `d64d7a0` |
| 9 | lot_history limit bug | `a69b4f0` |
| 10 | AI search counter race | `b989dd3` |
| 11 | Pass-3 score overwrite | `3b0e062` |
| 12 | cron unsold-alerts N+1 | `ab2bb6b` |
| 13 | toPublicUser allowlist | `3b0e062` |

## Rollout (`COVERAGE_FIX_PLAN.md`) status

| # | Item | Status |
|---|---|---|
| 1 | Detail-page merge + `_fieldSources` | ✅ shipped earlier |
| 2 | Re-enrichment + retry queue | ✅ shipped earlier |
| 3 | Price normaliser + `price_status` | ✅ shipped earlier |
| 4 | Per-lot quality score + alerts | ✅ shipped earlier |
| 5 | Multi-unit + postcodes.io | 🟡 Phase 1 ✅ / schema ✅ / detector deliberately skipped (low ROI argument made — see chat) |
| 6 | Persist LR sales + EPC floor area | ✅ shipped today (`658e722`) |
| 7 | Rentals feed + postcode_stats | 🟡 Phase 1 ✅ scrapers built, comps endpoint built, est_monthly_rent wired. Cron + materialised view + frontend integration outstanding |
| 8 | Title API + comps UI | ❌ not started |

---

## OUTSTANDING / "PICK NEXT"

### 🔴 Action items the user needs to run (no code work)

1. **Run postcodes.io backfill** to clear remaining 3,500 has-postcode-no-geocode lots:
   ```
   railway run node scripts/backfill-postcodes-io.mjs
   ```
   Or with local env: `SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/backfill-postcodes-io.mjs`. Expected: ~3,400 succeed (97% match rate).
2. **Watch UPRN coverage climb** — baseline was 11.1%; ceiling ~70% if every retry hits OS Places. Check after 24-48h:
   ```sql
   SELECT COUNT(*) FILTER (WHERE uprn IS NOT NULL) * 100.0 / COUNT(*) AS uprn_pct FROM lots;
   ```
3. **Watch `pipeline_alerts`** for anything fired by today's deploys (15 commits, 7+ Railway redeploys).

### 🟢 High-leverage next builds (small, ship today-equivalent)

4. **`postcode_rental_stats` + `postcode_sales_stats` materialised views** — median/p25/p75 per postcode (+ bed band for rentals), refreshed nightly. ~30 min. Cheap rollup that makes the comps endpoint faster.
5. **Cron trigger for rental scraper** — currently manual admin only. Without it, the 30-day freshness logic is dormant. Add a Railway cron that hits `drainStaleRentals({ limit: 50 })` daily.
6. **Scrape remaining ~475 active-auction postcodes for rentals** — only top 25 done. Either (a) wait for cron, or (b) run `scripts/one-shot-rental-scrape.mjs` in batches via the Supabase MCP path.

### 🟠 Known house-level regressions (from this morning's baseline)

7. **Charles Darrow image extractor** — 17.6% image coverage (rest of houses ~95%+). Domain might have changed; may need extractor selectors update or `healBrokenHouse()` run.
8. **landwood image extractor** — 0% image coverage. Likely a fresh extractor break.
9. **edwardmellor postcode extractor** — drives the bulk of the no-postcode gap (per baseline).
10. **Lot 18 Maggs "Guide TBA badge over £200k price"** — extractor vs badge logic disagree on one lot. Per-house, low priority.

For 7-9, run:
```sql
SELECT house, image_coverage, last_scrape_at FROM house_skills
WHERE slug IN ('charlesdarrow','landwood','edwardmellor');
```
Then invoke `auction-self-healing` skill.

### 🟠 Frontend integration gaps

11. **Frontend doesn't call `/api/lots/:id/comps`** — endpoint exists, UI doesn't render comps anywhere.
12. **Frontend doesn't disclose new fields** — UPRN, EPC floor area, lat/lng, postcode_sales, postcode_rentals all sit in DB unread by UI. The lot card / detail view needs a "Verified address" badge, "Comparable sales" disclosure, "Rental estimate" tile, etc.
13. **`/api/lots/:id/comps` not in any HTML** — the frontend integration of today's comps work is the natural #1 PR for tomorrow.

### 🟡 Lower priority / deferred

14. **Multi-unit detector (Phase 2 of #5)** — schema is in place but we made the explicit case against building the detector now (zero genuine portfolio lots in current data; planning-permission counts dominate; per-unit addresses rarely available). Revisit when real data appears.
15. **OpenRent scraper** — deferred. Needs Firecrawl with JS rendering (their search endpoint returns 405 to plain GET). Not started.
16. **Per-listing detail-page fetch on OnTheMarket** — would give us per-listing beds/property_type. Currently we have postcode-level prices but no per-listing typing.
17. **SpareRoom postcode search broken** — returns national popular listings instead of postcode-relevant. Filtered at insert today via area-label heuristic. Either fix the scraper (use SpareRoom's location-id system) or drop SpareRoom entirely if OTM is enough.
18. **EPC coverage 36%** — flagged at start of session as worth its own plan. Not addressed today.
19. **Cross-auction same-postcode endpoint** — quick win on existing data. Would let users click "show me other auctions in this postcode in the last 12 months". Build alongside frontend integration.
20. **Title API + comps UI (rollout #8)** — paid (~£3/title); gate behind a button or price threshold.
21. **`units` column corruption recurrence guard** — fixed today via regex cap, but worth a CI test that asserts `units < 100` for any newly-scraped lot.

### 🟡 From earlier session findings

22. **4,973 lots stamped `os_places.status = 'circuit_open'` in manifest** — investigated today: 1,147 re-enqueued, 2,883 already in queue, 943 already had UPRN. Mostly resolved. Verify via:
    ```sql
    SELECT COUNT(*) FROM lots WHERE enrichment_manifest -> 'os_places' ->> 'status' = 'circuit_open' AND uprn IS NULL;
    ```
23. **Lot 18 Maggs "Guide TBA over £200k"** — same as #10 above, listed twice for emphasis.

---

## Conventions to follow

- **Always invoke `auction-conventions` skill before touching code.** Architecture rules, naming, file layout, manifest patterns.
- **Always invoke `auction-self-healing` skill for any house-broken / image-coverage / extractor incident.** Distilled from real prod incidents.
- **Three-tier scrape: Firecrawl → Puppeteer → plain HTTP.** Never reverse.
- **Silent failures are banned.** Every skipped/failed lookup records a reason in `enrichment_manifest`.
- **Score range 0-10, always clamped.** `lib/pipeline/scoring.js::analyseLot` is the single source.
- **Pipeline stages live under `lib/pipeline/`.** Never reintroduce the `server.js` monolith.
- **Supabase MCP is authenticated.** Use `mcp__plugin_supabase_supabase__execute_sql` directly. No env vars required.
- **Push convention:** `type: subject` lowercase imperative. `git pull --rebase origin main` if push rejected.
- **Tests must pass:** `npm test` is currently 108/108 — every commit today kept it green.

## Files that changed today (and might be referenced)

```
lib/enrichment.js                       — estimateMonthlyRentSmart, postcode_sales upsert
lib/enrichment-manifest.js              — POSTCODES_IO_STATUSES, recordPostcodesIo, canScoreBelowMarket
lib/extractors/platforms/eig.js         — futureauctions whitespace fix
lib/os-places.js                        — peekOpen() pure read added
lib/postcodes-io.js                     — NEW: postcodes.io fallback
lib/pipeline/enrich-stage.js            — postcodes.io hook into runOsPlacesPass
lib/pipeline/enrichment-wave.js         — Pass-3 score overwrite fix
lib/pipeline/persist-lots.js            — auction_calendar cache + lot_history RPC switch + epc floor area
lib/pipeline/scoring.js                 — units regex cap (\d{1,2}) + below_market gate
lib/pipeline/lot-mappers.js             — epc_floor_area_sqm/sqft mapping
lib/pipeline/auction-watcher.js         — calendar cache invalidation
lib/pipeline/calendar-sync.js           — calendar cache invalidation
lib/analysis.js                         — calendar cache invalidation + severity 'warning' fix
lib/rentals/index.js                    — NEW: orchestrator
lib/rentals/onthemarket.js              — NEW: OTM scraper (dataLayer JSON parse)
lib/rentals/spareroom.js                — NEW: SpareRoom scraper (JSDOM cards)
routes/admin.js                         — validateUrl on probes, rateLimit, /api/admin/rentals/drain
routes/auth.js                          — toPublicUser allowlist, batched cron unsold-alerts
routes/calendar.js                      — header-only admin auth, rate-limited
routes/search.js                        — past-auction filter, atomic AI search, /api/lots/:id/comps
admin.html                              — sessionStorage admin secret
server.js                               — initRentals wiring
scripts/apply-2026-04-29-reset-circuit-open.mjs   — NEW: retry-queue reset runner
scripts/backfill-postcodes-io.mjs                 — NEW: postcodes.io backfill runner
scripts/one-shot-rental-scrape.mjs                — NEW: rental scrape driver (no admin secret needed)
docs/COVERAGE_FIX_PLAN.md                         — rollout doc, updated reality-check
.claude/skills/auction-self-healing/SKILL.md      — 2 new failure modes added
```

---

## My recommendation for the next session

In this order:

1. **#7 cron + materialised views + scrape remaining postcodes** (combined ~2 hr of small work) — turns today's rental work from "demo" into "running infrastructure".
2. **Frontend integration of `/api/lots/:id/comps` + new field disclosure** (~3 hr) — first user-visible payoff for everything we built today.
3. **Charles Darrow + landwood + edwardmellor extractors** (~1 hr each via auction-self-healing skill) — closes the known image/postcode regressions.
4. **Then consider:** EPC coverage plan, OpenRent via Firecrawl, Title API.

Don't start the multi-unit detector until real portfolio lots appear in the data.
