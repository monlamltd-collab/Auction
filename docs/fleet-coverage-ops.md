# Fleet coverage ops runbook

Short ops guide for the automatic next-sale population stack (fleet-coverage robustness Tasks 0–11).

## Goal

Every **active** house either:

- has a **ready traditional upcoming** sale inside the horizon (default 56 days), or
- is a healthy **MMOA / always_on** rolling book (fresh available lots), or
- is explicitly explained (retired brand-front, empty book with reason).

Owner should not need routine tinkering.

## Overnight order (03:00 UK)

1. `watchAuctionCalendar` — Cat B + AH/EIG family expand, multi-sale horizon
2. `runHomepageDateFeed` — scored homepage dates → calendar (high conf)
3. `syncCalendar` — always_on continuity only
4. `autoAnalyseAll` — scrape / extract / persist
5. lot-date consensus (per house after persist; writers **default ON**)
6. `discoverAndUpdateCalendar` — post-scrape, dark / unhealthy only; skips watcher-handled
7. morning digests — enrichment coverage + fleet Telegram scoreboard (default ON)

Homepage-watch at 03:30 (alternate days) still runs; after a successful cycle it also re-runs the homepage date feed.

## Feature flags (safe defaults)

- `AUCTION_WATCHER_EXPAND_ENABLED` — **on** (set `false` = explicit Cat B only)
- `HOMEPAGE_DATE_FEED_AUTO_UPSERT` — **on** (≥80 conf, same-domain only)
- `LOT_DATE_CONSENSUS_LIFT_ENABLED` — **on** (2026-07-25 owner approve; set `false` = observe-only)
- `FLEET_COVERAGE_ALERTS_ENABLED` — **on** (Telegram scoreboard; set `false` to silence)
- `AUTO_HEAL_ENABLED` — **off** (do not flip casually)
- `BACKLOG_DIGEST_ENABLED` — **off** (noise control)
- `DISCOVERY_DARK_BUDGET` — 25
- `DISCOVERY_RECHECK_BUDGET` — 10
- `DISCOVERY_VIP_BUDGET` — 5 (extra slots so VIP must-cover never starve)
- `WATCHER_HORIZON_DAYS` — 56
- `WATCHER_MAX_UPSERTS` — 3
- `WATCHER_NEAR_READY_DAYS` — 21 (nearest sale in window must be ready or refresh)
- `WATCHER_STALE_NOT_READY_DAYS` — 7 (stale not-ready rows force refresh)

### Coverage rule (Savills class)

A house is **not** covered merely because *some* future sale is `catalogue_ready`. The **nearest** upcoming inside `WATCHER_NEAR_READY_DAYS` must be ready (or correctly not-ready with a **fresh** check). Multi-sale houses like Savills previously skipped refresh when Aug/Sep were ready while Jul stayed `ready=false` since March.

VIP must-cover list (`VIP_MUST_COVER_HOUSES` in `discovery-eligibility.js`): savills, allsop, btgeddisons, knightfrank, bondwolfe, suttonkersh, buttersjohnbee — shorter recheck (3d), higher priority, VIP budget overflow.

## Admin endpoints

All require existing admin auth.

### Fleet scoreboard

`GET /api/admin/fleet-coverage`

Optional query:

- `telegram=1` — include formatted Telegram preview
- `horizonDays=56`

Returns active population score, dark list, last in-process cycle summaries, and flag snapshot.

### Discovery eligibility / dry-run

`POST /api/admin/discovery/dry-run`

Body examples:

```json
{ "slug": "allsop" }
```

→ pure eligibility eval (no Gemini).

```json
{ "forceFull": true, "force": false }
```

→ full discovery dry-run (may call Gemini for selected slugs; does not write).

### Homepage date feed

`POST /api/admin/homepage-date-feed`

```json
{ "dryRun": true }
```

Default dry-run. Set `"dryRun": false` to apply high-confidence upserts.

### Watcher (existing)

`POST /api/admin/run-watcher`

```json
{ "slug": "maggsandallen", "force": true }
```

## What must never happen

- Retire / delete `always_on` when an upcoming appears
- Invent **today** for undated discovery candidates
- Auto cross-domain catalogue apply (mergers stay human)
- Silently flip `AUTO_HEAL_ENABLED` or backlog spam
- Stamp **2099** onto lot `auction_date`
- Unsupervised junk URL heal (regression class from prior incidents)

## Soak checklist before "hands off"

1. No increase in heal junk-URL / corpse alert noise  
2. No always_on mass alter beyond realign rules  
3. Traditional dark unexplained ↓ day over day  
4. Available lot inflow up for previously dark trad houses  
5. MMOA freshness does not regress >2pp  
6. Firecrawl / Gemini daily usage inside budget  

When gates hold: leave watcher expand + homepage feed + lot-consensus lift + fleet Telegram on. Kill with `=false` only if something misbehaves. Do **not** enable `AUTO_HEAL` or backlog digest as part of coverage work.

## Ballasts if something misbehaves

```bash
# Restrict watcher to hand configs only
AUCTION_WATCHER_EXPAND_ENABLED=false

# Homepage feed observe-only
HOMEPAGE_DATE_FEED_AUTO_UPSERT=false

# Consensus — observe-only if needed
LOT_DATE_CONSENSUS_LIFT_ENABLED=false

# Silence fleet Telegram only
FLEET_COVERAGE_ALERTS_ENABLED=false

# Discovery cheaper
DISCOVERY_DARK_BUDGET=10
DISCOVERY_RECHECK_BUDGET=5
```

## Metrics script (read-only baseline)

```bash
node scripts/fleet-coverage-baseline.mjs
```

Docs snapshot: `docs/fleet-coverage-baseline.md`.
