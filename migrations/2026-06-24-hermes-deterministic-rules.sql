-- ============================================================================
--  Hermes re-scope (2026-06-24): propose-via-public-key + deterministic rules
-- ----------------------------------------------------------------------------
--  Part of reducing the Hermes LLM crons to fuzzy-judgement-only. Two pieces:
--   1. Let the re-scoped crons PROPOSE findings with only the publishable/anon
--      key — so no service-role secret is needed in cron prompts.
--   2. The deterministic SQL replacement for the retired "Daily Health Monitor":
--      pure SELECT rules that emit findings into hermes_findings, run by pg_cron.
--  Additive + reversible. Target: Supabase Postgres (pg_cron already enabled).
-- ============================================================================

-- 1) hermes_report_finding -> SECURITY DEFINER so it inserts as the owner
--    (bypassing the findings-table RLS) and can be called with the anon key.
--    Body unchanged. A fixed search_path keeps the definer function safe.
alter function hermes_report_finding(text,text,text,text,jsonb,jsonb,text,text,text,interval)
  security definer;
alter function hermes_report_finding(text,text,text,text,jsonb,jsonb,text,text,text,interval)
  set search_path = public, pg_temp;
grant execute on function hermes_report_finding(text,text,text,text,jsonb,jsonb,text,text,text,interval)
  to anon, authenticated;

-- 2) Deterministic health rules — the SQL replacement for the retired LLM
--    monitor. Pure SELECTs; on a breach, record a finding (7-day TTL so it
--    survives for review). No LLM, no Telegram. Dedup is structural (fingerprint).
create or replace function hermes_run_deterministic_rules()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emitted int := 0;
  v_stc     int;
  v_active  int;
  v_scored  int;
  v_avail   int;
begin
  -- Rule 1: STC must not appear in the active feed (a get_active_lots regression).
  select count(*) into v_stc from lots
   where status = 'stc' and last_seen_at > now() - interval '21 days';
  if v_stc > 0 then
    perform hermes_report_finding('det_rule','feed','stc_in_feed',
      format('%s STC lots in the 21-day active window (should be 0).', v_stc),
      jsonb_build_object('stc_count', v_stc), '[]'::jsonb,
      null, 'Check the get_active_lots RPC status whitelist.', 'det:stc_in_feed',
      interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  -- Rule 2: the active feed must not collapse (baseline ~4561; floor 3000).
  select json_array_length(get_active_lots()) into v_active;
  if v_active < 3000 then
    perform hermes_report_finding('det_rule','feed','active_feed_collapse',
      format('Active feed is %s lots (baseline ~4561; floor 3000).', v_active),
      jsonb_build_object('active_count', v_active), '[]'::jsonb,
      null, 'Investigate scrape/extraction pipeline health.', 'det:active_feed_collapse',
      interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  -- Rule 3: scoring coverage on available lots must stay healthy (>=50%).
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

  return v_emitted;
end;
$$;
grant execute on function hermes_run_deterministic_rules() to anon, authenticated;

-- 3) Schedule daily at 09:00 (replaces the retired LLM Health Monitor's slot).
select cron.schedule('hermes-deterministic-health-rules', '0 9 * * *',
  $$select hermes_run_deterministic_rules();$$);
