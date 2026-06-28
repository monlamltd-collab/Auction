-- migrations/2026-06-28-hermes-rules-liveness.sql
--
-- ███ PROPOSAL — NOT APPLIED TO PROD. Awaiting Simon's approval. ███
-- Unlike the 2026-06-21 / 2026-06-27 reconstructions (which documented existing
-- live objects), this file would CHANGE behaviour: it replaces
-- hermes_run_deterministic_rules() to add three scrape-liveness rules that emit
-- NEW findings via hermes_report_finding(). Do NOT run it against the live DB
-- until the reconciled set is signed off.
--
-- Decisions locked: 1(A) probe-based signal + stale rollup-only; 2(A) rename the
-- rollup to scrape_coverage_degraded. Existing 3 rules (stc_in_feed,
-- active_feed_collapse, low_scoring_coverage) are carried VERBATIM and unchanged.
--
-- Why the probe-based signal (not last_success_at bands): circuit-open houses
-- stop being re-probed, so last_success_at / circuit_state are stale for
-- ~138/167 houses and conflate "broken" with "between auctions". The reachable+
-- 0-extracted+was-productive predicate isolates genuine extractor breakage.
--
-- ── DRY-RUN SNAPSHOT (2026-06-28, nothing written) ────────────────────────────
--   stc_in_feed ............. 0 stc            → no finding
--   active_feed_collapse .... 4280 active       → no finding (floor 3000)
--   low_scoring_coverage .... 100% scored       → no finding
--   house_went_dark ......... 7 houses          → 7 per-house findings
--       bondwolfe, humberts, johnpye, markjenkinson, mchughandco, network,
--       wrightmarshall  (johnpye/mchughandco/markjenkinson/bondwolfe are
--       markdown-recogniser houses — "0 lots on a live site" = recogniser broke)
--   stale (unreachable >10d)  62 houses         → rollup-only (no per-house spam)
--   scrape_coverage_degraded  69 degraded total → 1 rollup finding (>= 5)

create or replace function public.hermes_run_deterministic_rules()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_emitted int := 0;
  v_stc     int;
  v_active  int;
  v_scored  int;
  v_avail   int;
  v_dark    int;
  v_stale   int;
  r         record;
begin
  -- ── Rule: stc_in_feed (unchanged) ──
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

  -- ── Rule: active_feed_collapse (unchanged) ──
  select json_array_length(get_active_lots()) into v_active;
  if v_active < 3000 then
    perform hermes_report_finding('det_rule','feed','active_feed_collapse',
      format('Active feed is %s lots (baseline ~4561; floor 3000).', v_active),
      jsonb_build_object('active_count', v_active), '[]'::jsonb,
      null, 'Investigate scrape/extraction pipeline health.', 'det:active_feed_collapse',
      interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  -- ── Rule: low_scoring_coverage (unchanged) ──
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

  -- ── Rule: house_went_dark (NEW, per-house) ──
  -- Site reachable this probe (changed/same) but 0 lots extracted, for a house
  -- that is normally productive (avg > 0), sustained >4d. = extractor/recogniser
  -- broke on a LIVE site (distinct from an unreachable/relocated dead house).
  for r in
    select slug, average_lot_count
      from house_skills
     where not coalesce(dormant,false)
       and last_probe_result in ('changed','same')
       and coalesce(last_extracted_count,0) = 0
       and coalesce(average_lot_count,0) > 0
       and (last_success_at is null or last_success_at < now() - interval '4 days')
  loop
    perform hermes_report_finding('det_rule', r.slug, 'house_went_dark',
      format('%s extracted 0 lots on a reachable site for >4d (normally ~%s lots).',
             r.slug, r.average_lot_count),
      jsonb_build_object('avg_lot_count', r.average_lot_count, 'extracted', 0),
      '[]'::jsonb,
      'Probe reports the site reachable but the extractor/recogniser yielded 0 — likely broken extraction, not a dead house.',
      'Inspect this house''s recogniser/extractor against current live markup.',
      'det:house_went_dark', interval '7 days');
    v_emitted := v_emitted + 1;
  end loop;

  -- ── Rule: scrape_coverage_degraded (NEW, rollup) ──
  -- Systemic scrape-liveness rollup. Counts extractor-broken (dark) + long
  -- unreachable (stale, >10d) houses. The unreachable houses are NOT emitted
  -- per-house here (they route via the existing relocation_needed handoff in
  -- lib/pipeline/healing.js); they only contribute to this rollup. Renamed from
  -- coverage_degraded to avoid colliding with low_scoring_coverage (scoring %).
  select count(*) into v_dark
    from house_skills
   where not coalesce(dormant,false)
     and last_probe_result in ('changed','same')
     and coalesce(last_extracted_count,0) = 0
     and coalesce(average_lot_count,0) > 0
     and (last_success_at is null or last_success_at < now() - interval '4 days');

  select count(*) into v_stale
    from house_skills
   where not coalesce(dormant,false)
     and last_probe_result = 'error' and circuit_state = 'open'
     and (last_success_at is null or last_success_at < now() - interval '10 days');

  if (v_dark + v_stale) >= 5 then
    perform hermes_report_finding('det_rule','pipeline','scrape_coverage_degraded',
      format('%s houses in degraded scrape state (%s extractor-broken on live sites, %s unreachable >10d).',
             v_dark + v_stale, v_dark, v_stale),
      jsonb_build_object('degraded_total', v_dark + v_stale,
                         'extractor_broken', v_dark, 'unreachable', v_stale),
      '[]'::jsonb,
      'Multiple houses degraded simultaneously — systemic rather than per-house.',
      'Triage extractor-broken houses (see house_went_dark findings); unreachable houses route via relocation_needed.',
      'det:scrape_coverage_degraded', interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  return v_emitted;
end;
$function$;
