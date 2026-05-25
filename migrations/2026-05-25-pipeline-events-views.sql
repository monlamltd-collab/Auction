-- migrations/2026-05-25-pipeline-events-views.sql
--
-- Three observability views over pipeline_events.
--
-- All three are PURE pipeline_events readers — they do not read from `lots`,
-- `lot_history`, or `enrichment_manifest`. The intent is a clean
-- separation: pipeline_events is the source of truth for pipeline activity;
-- these views are the standard slices ops dashboards consume.
--
-- At first deploy, pipeline_events is empty — the views will return empty
-- result sets until the next scheduled scrape pass emits its first events
-- (within minutes via the 30-min Tier 2 enrichment wave, and within 24h
-- via the 03:00 Tier 1 full pass). Retroactive verification for the
-- audit/2026-05-25-data-integrity-audit.md findings uses equivalent
-- ad-hoc queries against the manifest data — see Phase 4 of the parent
-- prompt for those queries.
--
-- View vocabulary is part of the observability contract documented in
-- audit/observability-views.md. Renames or column-type changes here are
-- a breaking change to consumers — additive-only evolution applies.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. scrape_health_24h
-- Per-source health over the last 24 hours: last successful scrape,
-- lot count delta (seen vs persisted), failure count, UPRN success rate.
-- ─────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS scrape_health_24h;
CREATE VIEW scrape_health_24h AS
WITH win AS (
  SELECT
    (event_data->>'house')                                          AS house,
    event_type,
    (event_data->>'candidate_count')::int                           AS candidate_count,
    (event_data->>'persisted_count')::int                           AS persisted_count,
    created_at
  FROM pipeline_events
  WHERE created_at > now() - interval '24 hours'
    AND (event_data->>'house') IS NOT NULL
),
scrape AS (
  SELECT
    house,
    MAX(created_at) FILTER (WHERE event_type = 'scrape_persisted')        AS last_successful_scrape,
    COALESCE(SUM(candidate_count) FILTER (WHERE event_type = 'scrape_seen'), 0)         AS candidates_24h,
    COALESCE(SUM(persisted_count) FILTER (WHERE event_type = 'scrape_persisted'), 0)    AS persisted_24h,
    COUNT(*) FILTER (WHERE event_type = 'scrape_failed')                  AS failures_24h
  FROM win
  GROUP BY house
),
-- UPRN enrichment outcomes are NOT per-source in pipeline_events (the
-- lookupAddress emitter doesn't always know the house). We compute the
-- global UPRN success rate for the same window and surface it as context.
enrich AS (
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'enrich_uprn_ok')           AS uprn_ok_24h_global,
    COUNT(*) FILTER (WHERE event_type = 'enrich_uprn_fail')         AS uprn_fail_24h_global
  FROM pipeline_events
  WHERE created_at > now() - interval '24 hours'
)
SELECT
  s.house,
  s.last_successful_scrape,
  s.candidates_24h,
  s.persisted_24h,
  (s.candidates_24h - s.persisted_24h)                              AS dropped_24h,
  s.failures_24h,
  e.uprn_ok_24h_global,
  e.uprn_fail_24h_global,
  CASE WHEN (e.uprn_ok_24h_global + e.uprn_fail_24h_global) > 0
       THEN ROUND(100.0 * e.uprn_ok_24h_global / NULLIF(e.uprn_ok_24h_global + e.uprn_fail_24h_global, 0), 1)
       ELSE NULL
  END                                                               AS uprn_success_pct_global_24h
FROM scrape s
CROSS JOIN enrich e
ORDER BY s.last_successful_scrape DESC NULLS LAST;

COMMENT ON VIEW scrape_health_24h IS
  'Per-source scrape health over the last 24 hours, derived from pipeline_events. Columns: house, last_successful_scrape, candidates_24h, persisted_24h, dropped_24h, failures_24h, plus global UPRN context. Contract pinned by audit/observability-views.md.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. enrichment_health
-- Single-row system-wide view of UPRN enrichment over the last 7 days.
-- ─────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS enrichment_health;
CREATE VIEW enrichment_health AS
WITH events_7d AS (
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'enrich_uprn_ok')                  AS uprn_ok_7d,
    COUNT(*) FILTER (WHERE event_type = 'enrich_uprn_fail')                AS uprn_fail_7d,
    MAX(created_at) FILTER (WHERE event_type = 'enrich_uprn_ok')           AS last_uprn_ok_at,
    MAX(created_at) FILTER (WHERE event_type = 'enrich_uprn_circuit_open') AS last_circuit_open_at,
    MAX(created_at) FILTER (WHERE event_type = 'enrich_uprn_circuit_closed') AS last_circuit_closed_at
  FROM pipeline_events
  WHERE created_at > now() - interval '7 days'
)
SELECT
  uprn_ok_7d,
  uprn_fail_7d,
  CASE WHEN (uprn_ok_7d + uprn_fail_7d) > 0
       THEN ROUND(100.0 * uprn_ok_7d / NULLIF(uprn_ok_7d + uprn_fail_7d, 0), 1)
       ELSE NULL
  END                                              AS uprn_success_pct_7d,
  -- Current circuit state inferred from the most recent transition event.
  -- If neither has fired in the window, default to 'unknown' so consumers
  -- can distinguish "definitely closed" from "no data yet".
  CASE
    WHEN last_circuit_open_at IS NULL AND last_circuit_closed_at IS NULL THEN 'unknown'
    WHEN last_circuit_open_at IS NULL                                    THEN 'closed'
    WHEN last_circuit_closed_at IS NULL                                  THEN 'open'
    WHEN last_circuit_open_at > last_circuit_closed_at                   THEN 'open'
    ELSE                                                                       'closed'
  END                                              AS uprn_circuit_state,
  last_circuit_open_at,
  last_circuit_closed_at,
  last_uprn_ok_at,
  (now() - last_uprn_ok_at)                        AS time_since_last_uprn_ok
FROM events_7d;

COMMENT ON VIEW enrichment_health IS
  'System-wide UPRN enrichment health over the last 7 days, derived from pipeline_events. Single-row view. Columns: uprn_ok_7d, uprn_fail_7d, uprn_success_pct_7d, uprn_circuit_state, last_circuit_open_at, last_circuit_closed_at, last_uprn_ok_at, time_since_last_uprn_ok. Contract pinned by audit/observability-views.md.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. dormant_sources
-- Any source whose latest scrape_persisted is more than 7 days ago, OR has
-- never emitted a scrape_persisted at all (and exists in the event stream).
-- ─────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS dormant_sources;
CREATE VIEW dormant_sources AS
SELECT
  house,
  last_successful_scrape,
  EXTRACT(DAY FROM (now() - last_successful_scrape))::int       AS days_since_last_scrape,
  failure_count_30d
FROM (
  SELECT
    (event_data->>'house')                                                              AS house,
    MAX(created_at) FILTER (WHERE event_type = 'scrape_persisted')                      AS last_successful_scrape,
    COUNT(*) FILTER (WHERE event_type = 'scrape_failed' AND created_at > now() - interval '30 days') AS failure_count_30d
  FROM pipeline_events
  WHERE (event_data->>'house') IS NOT NULL
  GROUP BY (event_data->>'house')
) per_source
WHERE last_successful_scrape IS NULL
   OR last_successful_scrape < now() - interval '7 days'
ORDER BY last_successful_scrape NULLS FIRST;

COMMENT ON VIEW dormant_sources IS
  'Houses whose latest scrape_persisted event is >7 days ago (or never), derived from pipeline_events. Columns: house, last_successful_scrape, days_since_last_scrape, failure_count_30d. NOTE: at first deploy this view returns empty until pipeline_events accumulates enough history; for the retroactive equivalent see audit/observability-views.md.';
