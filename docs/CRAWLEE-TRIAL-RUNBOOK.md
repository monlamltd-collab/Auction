# Crawlee-primary trial runbook (Firecrawl dry until June 16)

Operational guide for running Crawlee+Gemini as the main scraper while Firecrawl
credits are exhausted. Pairs with `docs/ENGINE-ROUTER.md` (architecture). All the
hardening below addresses the PR #67 post-merge review; the matching env knobs
have safe defaults, so the only **required** action is the deploy + the two
go-live vars.

## AI extractor resilience (OpenRouter) — removes the single point of failure

Crawlee renders, but a *render* is useless without an *extractor*. With Firecrawl
dead, Gemini was the only extractor, and a single Gemini 429/quota stalled the
whole catalogue (observed 2026-06-11: 0 extraction calls, every house 0 lots).
`callAI` is now a **provider cascade** (`lib/ai-provider.js`): it tries the
primary provider and rolls over to fallbacks on any failure. OpenRouter (one
key, OpenAI-compatible, access to Gemini/Claude/Kimi/… on its own billing) is the
drop-in second source.

| Var | Set to | Why |
|---|---|---|
| `OPENROUTER_API_KEY` | `sk-or-...` (from openrouter.ai) | Enables OpenRouter. **Required** for the fallback. |
| `AI_PROVIDER` | `openrouter` | Makes OpenRouter the **primary** extractor while the direct Gemini key is dead (avoids a wasted failed Gemini call per batch). Set back to `gemini` once Gemini is healthy — OpenRouter then stays as the auto-fallback. |
| `AI_FALLBACK_PROVIDERS` | *(unset)* | Defaults to `openrouter` whenever `OPENROUTER_API_KEY` is set. Override with a comma list (e.g. `openrouter,grok`) to chain more; set to empty string to disable fallback. |
| `OPENROUTER_FAST_MODEL` / `OPENROUTER_CAPABLE_MODEL` | *(optional)* | Default `google/gemini-2.5-flash-lite` / `google/gemini-2.5-pro` (parity, on OpenRouter's billing). Swap to e.g. `anthropic/claude-3.5-haiku` for full independence from Google. |
| `OPENROUTER_FALLBACK_MODELS` | *(optional)* | Comma-separated backup model slugs, e.g. `deepseek/deepseek-chat-v4-flash`. OpenRouter's `models` array tries them in order **within one request**, so if the primary model is down it rolls over automatically. Copy exact slugs from openrouter.ai → Models. |

Once set, `initAI` logs `AI provider initialized: chain=[openrouter → …]`, and the
`Gemini API rate limited` short-circuit is ignored while a non-Gemini path exists
(so a stale Gemini exhaustion flag can't block extraction). Verify via the
`ai_usage` query below — extraction calls should appear with the OpenRouter model.

## Railway env vars

| Var | Set to | Why |
|---|---|---|
| `FIRECRAWL_MONTHLY_BUDGET` | `1` | Deterministically latches `canUseFirecrawl()=false` so the very first cron call doesn't burn a 402 probe before failing over. Belt-and-braces alongside the 402-latch code fix. **Revert to `95000` on June 16.** |
| `CRAWLEE_DEFAULT` | `true` | Makes Crawlee the main engine for every non-override house (Firecrawl is the in-run 0-lot / low-recall fallback — moot while dry). |
| `CRAWLEE_SHADOW` | `true` | Keeps the parity gate auto-promoting houses that prove parity. (Harmless under `CRAWLEE_DEFAULT`; useful once Firecrawl returns.) |

Optional tuning (defaults are sensible — leave unless a watch-list signal says otherwise):

| Var | Default | Effect |
|---|---|---|
| `CRAWLEE_HOUSE_TIMEOUT_MS` | `600000` (10 min) | Per-house wall-clock for likely-Crawlee houses (vs 90s for Firecrawl). |
| `CRAWLEE_RENDER_BUDGET_MS` | `420000` (7 min) | Multi-page render stops adding pages past this, leaving headroom for Gemini. |
| `CRAWLEE_RECALL_FLOOR` | `0.85` | Below this, a Crawlee run falls back to Firecrawl **if available**; while dry, it serves the best available result. |
| `CRAWLEE_PROMOTE_PASSES` | `2` | Consecutive parity passes required before a house is promoted to `preferred_engine='crawlee'`. |
| `CRAWLEE_REQUEST_TIMEOUT_MS` | `300000` (5 min) | Hard per-render bridge timeout: bounds queue starvation under full-fleet load (N houses share the 3-slot crawler) and guarantees abandoned callers can't leak pending bridge entries. |

Rollback (no deploy): `UPDATE house_skills SET engine_locked='firecrawl' WHERE slug='<house>';` — a lock is absolute and never fails over to Crawlee. Global revert: unset `CRAWLEE_DEFAULT`.

## First-24-hours watch-list

Each row: the risk, the signal to look for, and the action if it fires.

| Risk | Signal | Action if seen |
|---|---|---|
| **Timeout cascade** (F1) | Logs: many `AUTO: ✗ <house> failed: House scrape timeout (600s)` in the 03:00 pass | Raise `CRAWLEE_HOUSE_TIMEOUT_MS`, or lower `CRAWLEE_RENDER_BUDGET_MS` so renders finish sooner. A few are fine; *most* houses failing is not. |
| **Pattinson pagination** (F2) | Logs: `[CRAWLEE-PAGINATION] pattinson: NN pages … (pattinson_p)` then `pagination not advancing, stopping`. SQL below. | If lot count collapsed, `engine_locked='firecrawl'` on pattinson and ping. |
| **Phantom withdrawals** (F3) | `pipeline_alerts` type `prune_skipped_low_ratio` (engine=crawlee). SQL below. | Expected to *hold* lots, not withdraw them. If a house withdraws >10% on a crawlee day, that's a recall hole — lock it. |
| **Product completeness** (F4) | `pipeline_alerts` types `extractor_image_regression` / `_tenure_` / `_beds_`. SQL below. | Some drop vs Firecrawl is expected (no detail-page backfill while dry). A house at ~0% image needs its hint reviewed. |
| **Failover correctness** (F5) | Logs: `→ engine crawlee (…firecrawl-exhausted)` and the hourly `BUDGET-FC … flags=plan-exhausted` staying **latched** (not toggling). | If `flags` toggles hourly, confirm `FIRECRAWL_MONTHLY_BUDGET=1` is set. |
| **/api/lot health** (F6) | Web-role 503s / user reports on lot deep-dives | Should now fall back to render+Gemini; a 503 means even that failed (rare). |
| **Crawlee health** | `pipeline_alerts` type `crawlee_crawler_restart`; logs: `Crawlee: crawler died`; container RSS on Railway (one Chromium) | The crawler auto-relaunches on the next render request (in-flight renders fail fast; those houses retry next cycle). Repeated restarts = memory pressure: lower the wave concurrency or raise the Railway plan. |
| **Extractor health** | `pipeline_alerts` type `ai_extraction_failure` (severity error) | Every AI batch threw for that house — wiring/provider/auth, NOT page content. Read `meta.lastError`, then confirm `ai_usage` shows successful `task_type='extraction'` rows again after the fix. |
| **Gemini saturation** | Logs: `Gemini API rate limited -- stopping all extraction` | The rest of that hour's houses get 0 lots. If frequent, stagger the wave or raise `GEMINI_MIN_GAP_MS`. |
| **Recall** | `pipeline_alerts` type `recall_diagnostic` (engine=crawlee) — now emitted on the Crawlee path | Track per-house recall trend; persistent <0.85 = recogniser/sentinel needs tuning. |

### SQL probes

```sql
-- Pattinson lot count (collapse from hundreds → ~25 means the ?page= bug)
SELECT count(*) FROM lots
WHERE house='pattinson' AND status NOT IN ('sold','withdrawn');

-- Phantom withdrawals in the last day, by house
SELECT house, count(*) FROM lots
WHERE enrichment_manifest->>'removed_reason'='vanished_from_catalogue'
  AND (enrichment_manifest->>'removed_at')::timestamptz > now() - interval '1 day'
GROUP BY house ORDER BY 2 DESC;

-- Prune holds (the gate protecting lots) vs engine
SELECT house, meta->>'engine' eng, meta->>'ratio' ratio, message
FROM pipeline_alerts
WHERE event_type='prune_skipped_low_ratio' AND created_at > now() - interval '1 day'
ORDER BY created_at DESC;

-- Image/field coverage today vs the prior week (per house)
SELECT house,
       round(avg((image_url IS NOT NULL)::int)*100) img_pct,
       round(avg((tenure   IS NOT NULL)::int)*100) tenure_pct,
       round(avg((beds     IS NOT NULL)::int)*100) beds_pct
FROM lots
WHERE last_seen_at > now() - interval '1 day'
GROUP BY house ORDER BY img_pct;

-- Crawlee recall history (now emitted on the crawlee path)
SELECT house, message, created_at FROM pipeline_alerts
WHERE event_type='recall_diagnostic' AND meta->>'engine'='crawlee'
ORDER BY created_at DESC LIMIT 50;

-- Engine outcomes / promotion progress
SELECT slug, preferred_engine, engine_locked,
       engine_stats->'crawlee'->>'runs' runs,
       engine_stats->'crawlee'->>'successes' ok,
       engine_stats->>'_parityPasses' passes
FROM house_skills WHERE engine_stats ? 'crawlee'
ORDER BY (engine_stats->'crawlee'->>'runs')::int DESC NULLS LAST;
```

## After June 16

1. Revert `FIRECRAWL_MONTHLY_BUDGET` to `95000` (or the real cap).
2. Houses that hit `CRAWLEE_PROMOTE_PASSES` consecutive parity passes are now
   `preferred_engine='crawlee'` and stay there; everything else reverts to
   Firecrawl-first automatically.
3. Use the `engine_stats` query above to decide the Firecrawl downgrade —
   keep it only for the houses Crawlee can't match (bot-walled, FIRE-1 healing,
   changeTracking-quirk).
