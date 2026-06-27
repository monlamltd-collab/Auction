-- 2026-06-27-hermes-deterministic-house-rules.sql
--
-- Appends three deterministic SQL detection rules to
-- hermes_run_deterministic_rules(), replacing the Hermes Health Monitor's
-- monitoring role for quantifiable conditions it reports unreliably. Findings
-- are written via hermes_report_finding() (fingerprint = symptom||':'||subject,
-- so per-house rules dedupe by putting the slug in `subject`). The existing
-- pg_cron job `hermes-deterministic-health-rules` (daily 09:00) already calls
-- this function, so no new cron / app code is required.
--
-- This is a CREATE OR REPLACE that PRESERVES the three pre-existing rules
-- (stc_in_feed, active_feed_collapse, low_scoring_coverage) verbatim and adds:
--
--   1. house_went_dark        (fingerprint house_went_dark:<slug>)
--        A house that had a real feed in the trailing 21->4-day window but has
--        had NO lot of any status seen in the last 4 days. Keyed on
--        max(last_seen_at) across ALL statuses (the "scraper touched it" signal)
--        rather than available-lot count, so post-auction houses whose lots are
--        all `sold` are NOT false-flagged.
--
--   2. stale_extract          (fingerprint stale_extract:<slug>)
--        last_full_extract_at older than 10 days (the adaptive scheduler's 7-day
--        freshness floor + 3-day grace). NULL last_full_extract_at is excluded
--        (never-recorded != failure, per 2026-06-17-house-skills-liveness).
--        Excludes houses already raised by rule 1 so each house raises at most
--        one of the two per-house rules.
--
--   3. coverage_degraded      (fingerprint coverage_degraded:pipeline)
--        Pipeline-wide rollup: count of eligible houses (avg feed >= 5) with no
--        fresh sighting in 4 days; fires when that count breaches 5. Mirrors the
--        existing active_feed_collapse global style.
--
-- Gate for all three per the task spec (same intent as the extraction-liveness
-- endpoint's !dormant gate, tightened to circuit_state='closed' AND dormant=false):
-- only houses the system believes are HEALTHY are eligible, so we never re-flag
-- known cooldowns (circuit open) or deliberately dormant sources.
--
-- The Anomaly Scanner's domain (non-property classification) is intentionally
-- untouched -- that stays with Hermes as fuzzy work, not SQL.
--
-- Thresholds (all tunable in one place here):
--   dark window      = 4 days   (daily scraping is the norm; 4d silence on a
--                                "healthy" house is abnormal)
--   recent-feed proof= 10 lots  (trailing 21->4d window, rules 1)
--   stale extract    = 10 days  (rule 2)
--   coverage trip    = 5 houses (rule 3)
--
-- Idempotent: CREATE OR REPLACE. Safe to re-run.

CREATE OR REPLACE FUNCTION public.hermes_run_deterministic_rules()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_emitted        int := 0;
  v_stc            int;
  v_active         int;
  v_scored         int;
  v_avail          int;
  -- new-rule scratch
  r                record;
  v_dark_slugs     text[] := '{}';
  v_dark_count     int;
  v_eligible_count int;
  v_dark_list      text[];
begin
  -- ──────────────────────────────────────────────────────────────────────
  -- EXISTING RULES (preserved verbatim)
  -- ──────────────────────────────────────────────────────────────────────
  select count(*) into v_stc
    from json_array_elements(get_active_lots()) e where e->>'status' = 'stc';
  if v_stc > 0 then
    perform hermes_report_finding('det_rule','feed','stc_in_feed',
      format('%s STC lots leaked into the active feed (should be 0).', v_stc),
      jsonb_build_object('stc_count', v_stc), '[]'::jsonb,
      null, 'Check the get_active_lots RPC status whitelist.', 'det:stc_in_feed',
      interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  select json_array_length(get_active_lots()) into v_active;
  if v_active < 3000 then
    perform hermes_report_finding('det_rule','feed','active_feed_collapse',
      format('Active feed is %s lots (baseline ~4561; floor 3000).', v_active),
      jsonb_build_object('active_count', v_active), '[]'::jsonb,
      null, 'Investigate scrape/extraction pipeline health.', 'det:active_feed_collapse',
      interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  select count(*) filter (where score is not null), count(*)
    into v_scored, v_avail
    from lots
   where status = 'available' and last_seen_at > now() - interval '21 days';
  if v_avail >= 50 and v_scored::numeric / nullif(v_avail,0) < 0.5 then
    perform hermes_report_finding('det_rule','scoring','low_scoring_coverage',
      format('Only %s of %s available lots are scored (<50%%).', v_scored, v_avail),
      jsonb_build_object('scored', v_scored, 'available', v_avail), '[]'::jsonb,
      null, 'Check analyseLot()/scoring pipeline.', 'det:low_scoring_coverage',
      interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  -- ──────────────────────────────────────────────────────────────────────
  -- RULE 1: house_went_dark  (fingerprint house_went_dark:<slug>)
  -- Had a real feed in the trailing 21->4d window, but nothing seen in 4d.
  -- ──────────────────────────────────────────────────────────────────────
  for r in
    with agg as (
      select house_slug as slug,
             max(last_seen_at) as last_seen_any,
             count(*) filter (
               where last_seen_at between now() - interval '21 days'
                                      and now() - interval '4 days'
             ) as recent_window
      from lots
      group by house_slug
    )
    select a.slug, a.last_seen_any, a.recent_window,
           round(extract(epoch from now() - a.last_seen_any) / 86400.0, 1) as days_dark
    from agg a
    join house_skills h on h.slug = a.slug
    where h.circuit_state = 'closed'
      and h.dormant = false
      and a.last_seen_any < now() - interval '4 days'
      and a.recent_window >= 10
  loop
    perform hermes_report_finding(
      'det_rule', r.slug, 'house_went_dark',
      format('%s went dark: no lot of any status seen in %s days, but had %s lots in the trailing 21-day window. Circuit is closed and house is not dormant.',
             r.slug, r.days_dark, r.recent_window),
      jsonb_build_object('days_dark', r.days_dark,
                         'lots_recent_window', r.recent_window,
                         'last_seen_any', r.last_seen_any),
      '[]'::jsonb, null,
      'Check the catalogue URL. If reachable, the extractor broke; if the latest probe was an error, file relocation_needed (Dead House Recovery).',
      'det:house_went_dark', interval '7 days');
    v_emitted := v_emitted + 1;
    v_dark_slugs := array_append(v_dark_slugs, r.slug);
  end loop;

  -- ──────────────────────────────────────────────────────────────────────
  -- RULE 2: stale_extract  (fingerprint stale_extract:<slug>)
  -- last_full_extract_at older than 10d. NULLs excluded. Rule-1 winners excluded.
  -- ──────────────────────────────────────────────────────────────────────
  for r in
    select slug, last_full_extract_at, average_lot_count, last_probe_result,
           round(extract(epoch from now() - last_full_extract_at) / 86400.0, 1) as extract_age_days
    from house_skills
    where circuit_state = 'closed'
      and dormant = false
      and last_full_extract_at is not null
      and last_full_extract_at < now() - interval '10 days'
      and not (slug = any(v_dark_slugs))
  loop
    perform hermes_report_finding(
      'det_rule', r.slug, 'stale_extract',
      format('%s last extracted %s days ago (threshold 10d). Avg feed %s lots; last probe result: %s.',
             r.slug, r.extract_age_days, r.average_lot_count, coalesce(r.last_probe_result, 'n/a')),
      jsonb_build_object('extract_age_days', r.extract_age_days,
                         'average_lot_count', r.average_lot_count,
                         'last_probe_result', r.last_probe_result,
                         'last_full_extract_at', r.last_full_extract_at),
      '[]'::jsonb, null,
      'Stale extraction. If last_probe_result=error the house likely relocated (file relocation_needed); otherwise investigate the scheduler/extractor.',
      'det:stale_extract', interval '7 days');
    v_emitted := v_emitted + 1;
  end loop;

  -- ──────────────────────────────────────────────────────────────────────
  -- RULE 3: coverage_degraded  (fingerprint coverage_degraded:pipeline)
  -- Pipeline-wide rollup of eligible houses with no fresh sighting in 4d.
  -- ──────────────────────────────────────────────────────────────────────
  with g as (
    select slug, average_lot_count
    from house_skills
    where circuit_state = 'closed' and dormant = false
  ),
  agg as (
    select house_slug as slug, max(last_seen_at) as last_seen_any
    from lots group by house_slug
  )
  select
    count(*) filter (
      where g.average_lot_count >= 5
        and (a.last_seen_any is null or a.last_seen_any < now() - interval '4 days')
    ),
    count(*),
    coalesce(
      array_agg(g.slug) filter (
        where g.average_lot_count >= 5
          and (a.last_seen_any is null or a.last_seen_any < now() - interval '4 days')
      ), '{}'::text[]
    )
  into v_dark_count, v_eligible_count, v_dark_list
  from g
  left join agg a on a.slug = g.slug;

  if v_dark_count >= 5 then
    perform hermes_report_finding(
      'det_rule', 'pipeline', 'coverage_degraded',
      format('%s of %s eligible (circuit-closed, non-dormant) houses have no fresh lots in 4 days (threshold 5).',
             v_dark_count, v_eligible_count),
      jsonb_build_object('dark_houses', v_dark_count,
                         'eligible_houses', v_eligible_count,
                         'dark_slugs', to_jsonb(v_dark_list)),
      '[]'::jsonb, null,
      'Pipeline-wide coverage degradation. Cross-reference the per-house house_went_dark / stale_extract findings.',
      'det:coverage_degraded', interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  return v_emitted;
end;
$function$;
