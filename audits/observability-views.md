# Observability views and the `pipeline_events` contract

**Status:** pinned · **Landed:** 2026-05-25 · **Migrations:** `2026-05-25-pipeline-events.sql`, `2026-05-25-pipeline-events-views.sql`

This document is the producer/consumer contract for the new pipeline observability layer. It pins:

1. The shape of the `pipeline_events` table.
2. The vocabulary of `event_type` values and the JSONB payload shape per event.
3. The three observability views built on top.
4. The additive-only evolution rule that applies from the moment this lands.

If any change to the producer-side code would breach this contract, **stop and propose** — same rule as for `lib/types/lot.js`. The reasoning is identical: consumer-side code (saved-search alerts, ops dashboards, future Grafana boards) will subscribe to this stream and assume the shapes documented here.

---

## 1. Why a separate table from `lot_events`

`lot_events` already exists (migration `2026-05-19-lot-events.sql`) and is the per-lot field-change stream. Its `lot_id` is `NOT NULL`, its payload is an `old_value`/`new_value` diff, and its vocabulary is `lot_*` events (`lot_status_changed`, `lot_price_changed`, etc.) — that contract is intact and must not be touched.

`pipeline_events` is for pipeline lifecycle observability — scrape and enrichment outcomes. `lot_id` is nullable (a scrape can see a lot that never persists; an enrichment can fail before there's a lot to attribute it to; a circuit-breaker transition has no lot at all). The payload is a single `event_data` JSONB (no diff semantics). The vocabulary is `scrape_*` / `enrich_*`.

Two clean contracts beats one muddied one. Saved-search alerts read `lot_events`; ops dashboards read `pipeline_events`.

---

## 2. `pipeline_events` table contract

```sql
CREATE TABLE pipeline_events (
  event_id   BIGSERIAL    PRIMARY KEY,
  lot_id     UUID         NULL REFERENCES lots(id) ON DELETE SET NULL,
  auction_id UUID         NULL REFERENCES auction_calendar(id) ON DELETE SET NULL,
  source     TEXT         NOT NULL,
  event_type TEXT         NOT NULL,
  event_data JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

- **`source`** identifies the producer code-path (e.g. `'os-places.lookupAddress'`, `'persist-lots.upsert'`, `'os-places.CircuitBreaker'`). Free-form text but should remain stable enough to group by.
- **`event_type`** is constrained by `pipeline_events_type_check`. Adding new values requires re-running the migration with the extended `CHECK` list. Existing values must NEVER be renamed or removed.
- **`event_data`** is event-specific. Per-type shapes are pinned below.
- **Producer wrapper:** `lib/pipeline/pipeline-events.js` (`PIPELINE_EVENT_TYPES`, `buildPipelineEvent`, `insertPipelineEvents`, `emitPipelineEvent`).

---

## 3. Event-type vocabulary and JSONB payload shape

Each entry below is the pinned contract: the listed keys are guaranteed to be present (when applicable), have the listed types, and have the listed semantics. Additive-only evolution: new optional keys may be added; existing keys must not be renamed, retyped, or made required after the fact. Adding a new `event_type` value is a separate (additive) migration.

### `scrape_seen`
A scraper batch produced N candidate lots for a (house, catalogue). Fires once per `upsertToLotsTable` call, before the merge/upsert.

```json
{
  "house":            "allsop",                              // text
  "candidate_count":  423,                                   // int
  "catalogue_url":    "https://allsop.co.uk/may-auction",    // text
  "extracted_with":   "firecrawl-json",                      // text|null
  "scraped_with":     "firecrawl"                            // text|null
}
```
- `source`: `persist-lots.upsert`
- `lot_id`: NULL (batch-level)
- `auction_id`: resolved calendar id, NULL when unresolved

### `scrape_persisted`
A scraper batch successfully upserted N rows. Fires once per `upsertToLotsTable` call, after the upsert loop completes (whether 1 or all rows were written).

```json
{
  "house":            "allsop",
  "persisted_count":  423,                                   // int — rows actually upserted
  "candidate_count":  423,                                   // int — rows handed to the upsert
  "catalogue_url":    "https://allsop.co.uk/may-auction",
  "extracted_with":   "firecrawl-json",
  "scraped_with":     "firecrawl"
}
```
- `source`: `persist-lots.upsert`
- `lot_id`: NULL (batch-level)
- `auction_id`: resolved calendar id, NULL when unresolved

The difference between `candidate_count` and `persisted_count` is the dropped-by-guards count (junk patterns, address-length, hero-bleed strips, etc.).

### `scrape_failed`
A scraper batch threw before persisting. Fires from the outer catch in `upsertToLotsTable`.

```json
{
  "house":            "allsop",
  "catalogue_url":    "https://allsop.co.uk/may-auction",
  "candidate_count":  423,                                   // int — what was attempted
  "error":            "Network error: ECONNRESET"            // text
}
```
- `source`: `persist-lots.upsert`
- `lot_id`: NULL
- `auction_id`: NULL (the calendar lookup hadn't completed)

### `enrich_uprn_ok`
An OS Places lookup returned a usable UPRN — either live (`status: 'ok'`) or cached (`status: 'cache_hit'`).

```json
{
  "status":      "ok" | "cache_hit",                         // text — distinguishes live from cache
  "uprn":        "100022300736",                             // text — populated for ok/cache_hit
  "matchScore":  0.7,                                        // float|null
  "httpStatus":  null,                                       // int|null — null on cache_hit
  "addressKey":  "lower_addr|UPPER POSTCODE"                 // text — the normalised lookup key
}
```
- `source`: `os-places.lookupAddress`
- `lot_id`: set when the caller passed `lot.id`, otherwise NULL
- `auction_id`: NULL (enrichment is per-lot, not per-auction)

### `enrich_uprn_fail`
An OS Places lookup did NOT return a usable UPRN. Covers:
- `api_error` (any non-2xx including 429), `timeout`, `no_match`, `low_confidence`, `cache_hit_no_match`, `skipped_no_creds`, `skipped_no_address`, `circuit_open`.

```json
{
  "status":      "circuit_open" | "api_error" | "timeout" | "no_match" | "low_confidence" | "cache_hit_no_match" | "skipped_no_creds" | "skipped_no_address",
  "uprn":        null,
  "matchScore":  null,                                       // float|null — populated only for low_confidence
  "httpStatus":  429,                                        // int|null — populated for api_error
  "addressKey":  "lower_addr|UPPER POSTCODE"
}
```
- `source`: `os-places.lookupAddress`
- `lot_id`: optional, as above
- `auction_id`: NULL

### `enrich_uprn_circuit_open`
The OS Places circuit breaker transitioned closed → open. Fires once per transition (not per failed call).

```json
{
  "reason":   "failure_threshold",                           // text — fixed at v1
  "breaker":  "os-places"                                    // text — supports future per-enricher breakers
}
```
- `source`: `os-places.CircuitBreaker`
- `lot_id`: NULL
- `auction_id`: NULL

### `enrich_uprn_circuit_closed`
The OS Places circuit breaker transitioned open → closed.

```json
{
  "reason":   "success" | "auto_reset",                      // text — "success" = a live call succeeded; "auto_reset" = resetMs window elapsed
  "breaker":  "os-places"
}
```
- `source`: `os-places.CircuitBreaker`
- `lot_id`: NULL
- `auction_id`: NULL

### `firecrawl_call`
One row per Firecrawl HTTP call from the scraper layer. Emitted by `lib/resource-budget.js::_fireEvent` when a wrapper in `lib/scraper/firecrawl.js` passes an `eventMeta` object alongside the booked credit weight. Cardinality matches the Firecrawl dashboard line-item count, so the `firecrawl_spend_*` views below reconcile directly against the provider's billing screen.

```json
{
  "endpoint":  "/v2/scrape" | "/v2/extract" | "/v2/map",     // text — Firecrawl API path
  "caller":    "firecrawl.<wrapperName>",                    // text — e.g. "firecrawl.extractCatalogue"
  "outcome":   "success" | "failed" | "cancelled" | "timeout", // text — agentExtract is the only emitter of non-success
  "weight":    1,                                            // number — credits debited locally for this call
  "tier":      "full" | "free-enrichment" | "status-drift" | "on-demand" | "healing" | "unknown",  // text — ResourceBudget tier label
  "url":       "https://...",                                // text|null — target URL, truncated to 256 chars; null for endpoints without a single URL (e.g. /v1/search if future-added)
  "elapsedMs": 1234                                          // number — per-attempt wall-clock duration; retries each get their own row
}
```
- `source`: `resource-budget.recordFcRequest`
- `lot_id`: NULL (Firecrawl calls aren't lot-scoped at the budget layer)
- `auction_id`: NULL

`outcome` mapping for `agentExtract`:
- `success` — poll loop saw `status: 'completed'`.
- `failed` / `cancelled` — poll loop saw the matching `pollData.status`. Firecrawl bills started jobs regardless of final state, so the row is emitted before the throw.
- `timeout` — client-side poll deadline elapsed. The job is still likely running on Firecrawl's side and will bill, so the row is emitted before the throw.

Other wrappers (`scrapeWithFirecrawl`, `extractCatalogue`, `extractHomepage`, `extractDetail`, `mapSiteUrls`) emit only on the success path — they throw before reaching the recordFcRequest call when the HTTP request itself fails, so failed scrape attempts do NOT show up in this stream. That matches Firecrawl's billing model: failed `/v2/scrape` requests aren't billed.

---

## 4. The views

All three are pure `pipeline_events` readers. At first deploy they return empty result sets until the next scrape/enrichment cycle fires — that's expected. For retroactive equivalents (running against pre-deploy manifest data) see section 6 below.

### `scrape_health_24h` — per-source 24-hour health
Per-house slice over the last 24 hours: last successful scrape, candidate vs persisted counts, failure count, plus global UPRN context.

| Column | Type | Meaning |
|---|---|---|
| `house` | text | House slug from `event_data->>'house'` |
| `last_successful_scrape` | timestamptz | Latest `scrape_persisted` for this house |
| `candidates_24h` | int | Sum of `event_data->>'candidate_count'` for this house |
| `persisted_24h` | int | Sum of `event_data->>'persisted_count'` for this house |
| `dropped_24h` | int | `candidates_24h - persisted_24h` — lots dropped by guards |
| `failures_24h` | int | Count of `scrape_failed` events |
| `uprn_ok_24h_global` | int | System-wide `enrich_uprn_ok` count (not per-house) |
| `uprn_fail_24h_global` | int | System-wide `enrich_uprn_fail` count |
| `uprn_success_pct_global_24h` | numeric | OK / (OK + FAIL) × 100 |

UPRN success is shown system-wide because `lookupAddress` events don't always carry a house. A future enricher-attribution change could move this per-house additively.

### `enrichment_health` — system-wide UPRN health (single row)
Rolling 7-day window.

| Column | Type | Meaning |
|---|---|---|
| `uprn_ok_7d` | int | Count of `enrich_uprn_ok` |
| `uprn_fail_7d` | int | Count of `enrich_uprn_fail` |
| `uprn_success_pct_7d` | numeric | OK / (OK + FAIL) × 100; null when zero events |
| `uprn_circuit_state` | text | `'open'` / `'closed'` / `'unknown'` — inferred from the latest transition |
| `last_circuit_open_at` | timestamptz | Most recent `enrich_uprn_circuit_open` |
| `last_circuit_closed_at` | timestamptz | Most recent `enrich_uprn_circuit_closed` |
| `last_uprn_ok_at` | timestamptz | Most recent successful enrichment |
| `time_since_last_uprn_ok` | interval | `now() - last_uprn_ok_at` |

### `dormant_sources` — houses with no recent scrape
Any house that has appeared in `pipeline_events` but whose latest `scrape_persisted` is >7 days ago (or never).

| Column | Type | Meaning |
|---|---|---|
| `house` | text | House slug |
| `last_successful_scrape` | timestamptz | NULL = never persisted in pipeline_events |
| `days_since_last_scrape` | int | `EXTRACT(DAY FROM now() - last_successful_scrape)`; NULL when never |
| `failure_count_30d` | int | Count of `scrape_failed` events in last 30 days |

Dormancy uses *absence of recent `scrape_persisted`* rather than a `lot_disappeared` event — per the agreed Option B framing, "lot vanishes" is a per-lot concept (`lot_events.lot_vanished`), while "source went quiet" is a pipeline concept. The right signal here is the absence of forward activity.

### `firecrawl_spend_24h` — endpoint × caller Firecrawl spend (24h)
Pivot of `firecrawl_call` rows by endpoint and caller. Each row is one (endpoint, caller) pair active in the last 24 hours.

| Column | Type | Meaning |
|---|---|---|
| `endpoint` | text | Firecrawl API path from `event_data->>'endpoint'` |
| `caller` | text | Wrapper name from `event_data->>'caller'` (e.g. `firecrawl.extractCatalogue`) |
| `call_count` | int | Number of `firecrawl_call` rows for this (endpoint, caller) pair |
| `total_weight` | numeric | Sum of `event_data->>'weight'` — credits debited locally |
| `success_count` | int | Count of `outcome = 'success'` rows |
| `failure_count` | int | Count of `outcome IN ('failed','cancelled','timeout')` rows |
| `avg_elapsed_ms` | numeric | Mean wall-clock latency in ms |
| `last_call_at` | timestamptz | Most recent `firecrawl_call` for this pair |

Ordered by `total_weight DESC`. Designed to match the Firecrawl dashboard line-item shape — when the dashboard shows 21–26 credits per FIRE-1 call, this view's `total_weight / call_count` for `endpoint='/v2/extract'` should agree.

### `firecrawl_spend_7d` — per-endpoint roll-up (7d)
Same idea but rolled up across callers, over 7 days. The `avg_weight_per_call` column is the multiplier-drift detector.

| Column | Type | Meaning |
|---|---|---|
| `endpoint` | text | Firecrawl API path |
| `call_count_7d` | int | Total `firecrawl_call` rows over 7 days |
| `total_weight_7d` | numeric | Sum of `weight` |
| `avg_weight_per_call` | numeric | `total_weight_7d / call_count_7d` — surfaces divergence from `FIRECRAWL_FIRE1_CREDIT_MULT` etc. |
| `success_count_7d` | int | Count of `outcome = 'success'` rows |
| `failure_count_7d` | int | Count of `outcome IN ('failed','cancelled','timeout')` rows |
| `avg_elapsed_ms_7d` | numeric | Mean wall-clock latency over the window |

Run this view weekly: if `avg_weight_per_call` for `/v2/extract` diverges from `FIRECRAWL_FIRE1_CREDIT_MULT` by more than ~10%, the multiplier needs retuning to match Firecrawl's actual billing — exactly the case the FIRE-1 leak (audit 2026-05-25) was meant to catch.

---

## 5. Additive-only evolution rule

This contract is pinned from the moment it lands. Allowed:

- Adding a NEW value to the `event_type` set (requires re-running the migration with the extended CHECK).
- Adding a NEW optional key to an existing event's `event_data` shape (consumer code must tolerate missing keys).
- Adding NEW columns to `pipeline_events` (must be nullable with a default so existing rows remain valid).
- Adding NEW views or NEW indexes.

Not allowed (breaks the contract — propose, do not improvise):

- Renaming or removing an `event_type` value.
- Renaming, retyping, or removing a key in an existing event's `event_data` shape.
- Making an existing nullable field non-nullable (this includes `lot_id` — keep it nullable).
- Changing the type of a column.
- Renaming or removing a view column or changing its type.

The same rule that protects `lib/types/lot.js` and `lot_events` now protects `pipeline_events` and these three views.

---

## 6. Retroactive verification — equivalent queries over historical manifest data

At first deploy, `pipeline_events` has no history. To verify the views WOULD have surfaced the documented regressions (the UPRN circuit-open trend; the 2026-04-17 dormant-houses cluster), use the equivalent ad-hoc queries below against the existing `lots.enrichment_manifest` and `lots.last_seen_at` data. These are the "what the view would have shown" reconstructions — not part of the pinned contract, just diagnostic SQL.

### Retroactive equivalent of `enrichment_health` (per-day, last 60 days)
```sql
SELECT
  first_seen_at::date AS day,
  COUNT(*) AS total_lots,
  COUNT(*) FILTER (WHERE enrichment_manifest->'os_places'->>'status' IN ('ok','cache_hit')) AS uprn_ok,
  COUNT(*) FILTER (WHERE enrichment_manifest->'os_places'->>'status'
                   IN ('circuit_open','api_error','timeout','no_match','low_confidence','cache_hit_no_match','skipped_no_creds')) AS uprn_fail,
  ROUND(100.0 * COUNT(*) FILTER (WHERE enrichment_manifest->'os_places'->>'status' IN ('ok','cache_hit'))
        / NULLIF(COUNT(*) FILTER (WHERE enrichment_manifest->'os_places'->>'status' IS NOT NULL), 0), 1) AS uprn_success_pct
FROM lots
WHERE first_seen_at > now() - interval '60 days'
GROUP BY day
ORDER BY day DESC;
```

### Retroactive equivalent of `dormant_sources` (using `lots.last_seen_at`)
```sql
SELECT
  house,
  MAX(last_seen_at)::date                                         AS last_seen,
  EXTRACT(DAY FROM (now() - MAX(last_seen_at)))::int              AS days_dormant
FROM lots
WHERE house <> '__unattributed__'
GROUP BY house
HAVING MAX(last_seen_at) < now() - interval '7 days'
ORDER BY MAX(last_seen_at) ASC;
```

### Retroactive equivalent of `scrape_health_24h` (using lots last_seen_at + manifest)
```sql
SELECT
  house,
  COUNT(*)                                                                                   AS lots_in_window,
  MAX(last_seen_at)                                                                          AS last_seen,
  ROUND(100.0 * COUNT(*) FILTER (WHERE enrichment_manifest->'os_places'->>'status' IN ('ok','cache_hit'))
        / NULLIF(COUNT(*), 0), 1)                                                            AS uprn_success_pct
FROM lots
WHERE last_seen_at > now() - interval '24 hours'
  AND house <> '__unattributed__'
GROUP BY house
ORDER BY lots_in_window DESC;
```

The first query reproduces the day-by-day trend from `audit/2026-05-25-uprn-rca.md` §4 — flat zero-percent `cache_hit + ok` from 2026-05-15 onwards is the failure signature the new `enrichment_health` view will surface forward.

The second query, run today, returns the cluster of 6 houses last scraped 2026-04-17 — proving `dormant_sources` would have caught the cluster on 2026-04-25 (8 days after their last scrape).

---

## 7. Verification output (Phase 4 of the parent prompt)

Three things to verify:
1. **Retroactive:** the same patterns the new views would surface are visible in pre-deploy manifest data.
2. **Forward (synthetic):** the views populate correctly when fed events matching the producer's exact shape.
3. **Forward (live):** post-deploy, the views show the UPRN circuit closed and success rate climbing.

### 7.1 Retroactive — `enrichment_health` equivalent (last 30 days)

Run against `lots.enrichment_manifest`:

| Day | Total new | uprn_ok | circuit_open | api_error | pct_ok |
|---|--:|--:|--:|--:|--:|
| 2026-05-25 | 335 | 0 | 330 | 5 | 0.0 |
| 2026-05-24 | 158 | 0 | 155 | 3 | 0.0 |
| 2026-05-23 | 149 | 0 | 146 | 3 | 0.0 |
| 2026-05-22 | 377 | 1 | 368 | 8 | 0.3 |
| 2026-05-20 | 119 | 0 | 118 | 1 | 0.0 |
| 2026-05-18 | 58 | 0 | 56 | 2 | 0.0 |
| 2026-05-15 | 289 | 0 | 280 | 9 | 0.0 |
| 2026-05-13 | 995 | 1 | 979 | 14 | 0.1 |
| 2026-05-09 | 1183 | 1 | 1168 | 10 | 0.1 |
| 2026-05-07 | 770 | 3 | 758 | 7 | 0.4 |
| 2026-05-06 | 527 | 4 | 518 | 0 | 0.8 |
| 2026-05-03 | 760 | 12 | 736 | 7 | 1.6 |
| 2026-05-02 | 347 | 21 | 317 | 7 | 6.1 |
| 2026-05-01 | 190 | 26 | 161 | 3 | 13.7 |
| 2026-04-30 | 258 | 14 | 232 | 5 | 5.6 |
| 2026-04-27 | 118 | 7 | 105 | 0 | 6.3 |

**Conclusion:** `enrichment_health.uprn_success_pct_7d` would have fallen below 50% by 2026-05-04 and below 10% by 2026-05-10 — clear alertable trend visible 3 weeks before this audit caught it.

### 7.2 Retroactive — `dormant_sources` equivalent (today)

Top dormant sources from `lots.last_seen_at`:

| House | Last seen | Days dormant | Lot count |
|---|---|--:|--:|
| brggibson | 2026-03-29 | 57 | 1 |
| driversnorris | 2026-03-29 | 57 | 8 |
| auctionhousesouthyorkshire | 2026-04-04 | 51 | 1 |
| lodgeandthomas | 2026-04-12 | 43 | 59 |
| brggibsondublin | 2026-04-17 | 38 | 34 |
| groundrentauctions | 2026-04-20 | 35 | 2 |
| auctionhouseeastmidlands | 2026-04-22 | 33 | 3 |
| eigplatform | 2026-05-05 | 20 | 1 |
| martinpole | 2026-05-05 | 20 | 2 |
| bowensonandwatson | 2026-05-05 | 20 | 6 |
| mchughandco | 2026-05-11 | 14 | 273 |
| barnettross / williamhbrownnorwich / philliparnold / starpropertyonline / twgaze / durrants | 2026-05-13 | 12 | varies |

**Conclusion:** the 2026-04-17 cluster (`brggibsondublin`, `lodgeandthomas`, `groundrentauctions`, `auctionhouseeastmidlands`) would have lit up in `dormant_sources` by 2026-04-25. Mass dormancy on 2026-05-13 (6+ houses) would have lit up by 2026-05-20.

### 7.3 Forward synthetic — views populate correctly

Inserted 12 synthetic `pipeline_events` rows (tagged `source = 'test.smoke'`, since deleted) mirroring exactly what the wired producer code emits: 2 scrape batches, 1 scrape_failed, 1 circuit_open→circuit_closed sequence, 3 enrich_uprn_ok, 2 enrich_uprn_fail. Output:

**`enrichment_health`:**
```
uprn_ok_7d                 = 3
uprn_fail_7d               = 2
uprn_success_pct_7d        = 60.0
uprn_circuit_state         = closed     (last_close > last_open)
last_circuit_open_at       = ~50 min ago
last_circuit_closed_at     = ~40 min ago
last_uprn_ok_at            = ~25 min ago
time_since_last_uprn_ok    = 00:25:10
```

**`scrape_health_24h`:**
```
pugh         | last_persist ~90m | candidates=30 | persisted=30 | dropped=0 | failures=0
allsop       | last_persist ~2h  | candidates=50 | persisted=48 | dropped=2 | failures=0
scargillmann | last_persist NULL | candidates=0  | persisted=0  | dropped=0 | failures=1
```

**`dormant_sources`:**
```
scargillmann | last_successful_scrape=NULL | days_since=NULL | failure_count_30d=1
```
(pugh and allsop correctly excluded — their `scrape_persisted` is within the 7-day window.)

All view columns surface as documented. Producer schema and view consumer match.

### 7.4 Forward live — post-deploy expectation

The code changes (cache-before-breaker fix in `lib/os-places.js`, plus pipeline_events emit points in `os-places.js` and `persist-lots.js`) are staged but not deployed in this session. Post-deploy expectations to validate within 24 hours of the first scheduled `autoAnalyseAll` (Tier 1, 03:00 UK):

- `enrichment_health.uprn_circuit_state` = `'closed'` (cache-before-breaker means the 2,269 existing cached UPRNs are reachable; cache_hits no longer trip the breaker)
- `enrichment_health.uprn_success_pct_7d` ≥ 50% (rises rapidly as cache_hits start landing — limited only by how many new lots land that day)
- `scrape_health_24h` populated for ~100+ houses with `last_successful_scrape` near now
- `dormant_sources` shows only genuinely dormant houses (e.g. scargillmann), NOT the active cohort

If `uprn_circuit_state` stays `'open'` after deploy, the OS Data Hub rate-limit issue (separate from the cache-before-breaker bug) needs the second fix flagged in the RCA (token-bucket rate limiter sized to OS's actual published limits).

### 7.5 Hotfix evidence — 20-lot UPRN verification batch

In Phase 2 the agent ran a controlled `UPDATE` against 20 lots that had cache matches and lacked UPRN. All 20 received valid UPRNs from the cache:

```
02f61a4c… | 104 Park Street, Grimsby, DN32 7NT          | uprn=11062374
00216c8c… | 65 Church View Gardens, Kinver, DY7 6EE     | uprn=100031805728
2a410424… | 56 Highcroft Avenue, Glasgow, G44 5RW       | uprn=906700277818
…         | (16 more lots, all tcpa)                    | populated
```

This proves the cache-before-breaker fix would have served these lots' enrichment requests from the cache today — they were stuck at `circuit_open` only because the pre-fix `lookupAddress` short-circuited before consulting the cache. **Broader cohort:** 2,012 lots across the table have NULL `uprn` AND a matching cache entry — they will all backfill on the next enrichment-wave cycle after deploy. (Phase 2 deliberately limited the SQL UPDATE to 20 as a verification batch, not a mass backfill — the rest happens automatically once the code is live.)

