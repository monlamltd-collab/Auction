-- migrations/2026-05-26-pipeline-events-firecrawl-views.sql
--
-- Two observability views over pipeline_events 'firecrawl_call' rows.
--
-- Pure pipeline_events readers — no joins to lots, scrape_runs, or the
-- enrichment manifest. Match the contract style of
-- migrations/2026-05-25-pipeline-events-views.sql: additive-only,
-- contract-pinned by audit/observability-views.md.
--
-- At first deploy both views are empty until the next scrape pass emits
-- its first 'firecrawl_call' events.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. firecrawl_spend_24h
-- Endpoint × caller spend pivot over the last 24 hours: total calls,
-- total credits debited, success/failure split, mean latency. The unit
-- that matches the Firecrawl dashboard line items.
-- ─────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS firecrawl_spend_24h;
CREATE VIEW firecrawl_spend_24h AS
SELECT
  (event_data->>'endpoint')                                                       AS endpoint,
  (event_data->>'caller')                                                         AS caller,
  COUNT(*)                                                                        AS call_count,
  COALESCE(SUM((event_data->>'weight')::numeric), 0)                              AS total_weight,
  COUNT(*) FILTER (WHERE event_data->>'outcome' = 'success')                      AS success_count,
  COUNT(*) FILTER (WHERE event_data->>'outcome' IN ('failed','cancelled','timeout')) AS failure_count,
  ROUND(AVG((event_data->>'elapsedMs')::numeric), 0)                              AS avg_elapsed_ms,
  MAX(created_at)                                                                 AS last_call_at
FROM pipeline_events
WHERE event_type = 'firecrawl_call'
  AND created_at > now() - interval '24 hours'
GROUP BY (event_data->>'endpoint'), (event_data->>'caller')
ORDER BY total_weight DESC, call_count DESC;

COMMENT ON VIEW firecrawl_spend_24h IS
  'Per-endpoint per-caller Firecrawl spend over the last 24 hours, derived from pipeline_events.firecrawl_call. Columns: endpoint, caller, call_count, total_weight, success_count, failure_count, avg_elapsed_ms, last_call_at. Contract pinned by audit/observability-views.md.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. firecrawl_spend_7d
-- Endpoint roll-up over 7 days: total calls, total credits, average
-- weight per call. The "is FIRE-1 really 23 credits/call?" check.
-- ─────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS firecrawl_spend_7d;
CREATE VIEW firecrawl_spend_7d AS
SELECT
  (event_data->>'endpoint')                                                       AS endpoint,
  COUNT(*)                                                                        AS call_count_7d,
  COALESCE(SUM((event_data->>'weight')::numeric), 0)                              AS total_weight_7d,
  CASE WHEN COUNT(*) > 0
       THEN ROUND(SUM((event_data->>'weight')::numeric) / COUNT(*), 2)
       ELSE NULL
  END                                                                             AS avg_weight_per_call,
  COUNT(*) FILTER (WHERE event_data->>'outcome' = 'success')                      AS success_count_7d,
  COUNT(*) FILTER (WHERE event_data->>'outcome' IN ('failed','cancelled','timeout')) AS failure_count_7d,
  ROUND(AVG((event_data->>'elapsedMs')::numeric), 0)                              AS avg_elapsed_ms_7d
FROM pipeline_events
WHERE event_type = 'firecrawl_call'
  AND created_at > now() - interval '7 days'
GROUP BY (event_data->>'endpoint')
ORDER BY total_weight_7d DESC;

COMMENT ON VIEW firecrawl_spend_7d IS
  'Per-endpoint Firecrawl spend roll-up over the last 7 days, derived from pipeline_events.firecrawl_call. Columns: endpoint, call_count_7d, total_weight_7d, avg_weight_per_call, success_count_7d, failure_count_7d, avg_elapsed_ms_7d. The avg_weight_per_call column surfaces multiplier drift (e.g. FIRE-1 actual vs FIRECRAWL_FIRE1_CREDIT_MULT). Contract pinned by audit/observability-views.md.';
