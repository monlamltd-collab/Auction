-- migrations/2026-06-21-hermes-findings.sql
--
-- RECONSTRUCTED FROM LIVE STATE (2026-06-26), not freshly authored.
-- The Hermes findings subsystem was created directly against the live
-- Auction.Bridgematch DB (project pohrbfhftbprlfzsozyj) and never had a
-- migration committed — the codebase carried no record of it. This file
-- documents reality so the repo becomes source of truth.
--
-- It mirrors the live objects EXACTLY, using create-if-not-exists /
-- create-or-replace so it is safe to (re)run but applies no change to a DB
-- that already has these objects. DO NOT treat this as a pending change:
-- every object below already exists in prod. If a future `pg_get_*` diff
-- shows live state and this file diverging, the file is stale — reconcile.
--
-- Objects captured:
--   table  hermes_findings           (+ 4 CHECK constraints, PK, 4 indexes, RLS)
--   fn     hermes_report_finding()   (upsert-by-fingerprint, SECURITY DEFINER)
--   fn     hermes_expire_stale()
--   fn     hermes_run_deterministic_rules()  (3 live rules: stc_in_feed,
--                                              active_feed_collapse,
--                                              low_scoring_coverage)
--   view   hermes_open
--   view   hermes_actionable

-- ─────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.hermes_findings (
    id                uuid        not null default gen_random_uuid(),
    fingerprint       text        not null,
    job_kind          text        not null,
    job_id            text,
    subject           text        not null,
    symptom           text        not null,
    observation       text        not null,
    observed_metrics  jsonb       not null default '{}'::jsonb,
    evidence_refs     jsonb       not null default '[]'::jsonb,
    hypothesis        text,
    suggested_action  text,
    status            text        not null default 'new'
                        check (status in ('new','verifying','confirmed','dismissed','resolved','expired')),
    verdict           text        check (verdict in ('confirmed_current','self_healed','false_positive','needs_human')),
    severity          text        check (severity in ('low','medium','high','critical')),
    dismiss_reason    text        check (dismiss_reason in ('self_healed','false_positive','duplicate','wont_fix','known_state')),
    verifier_notes    text,
    verified_evidence jsonb,
    verified_at       timestamptz,
    assignee          text,
    files_touched     jsonb,
    created_at        timestamptz not null default now(),
    first_seen_at     timestamptz not null default now(),
    last_seen_at      timestamptz not null default now(),
    occurrence_count  integer     not null default 1,
    expires_at        timestamptz not null default (now() + interval '24:00:00'),
    resolved_at       timestamptz,
    constraint hermes_findings_pkey primary key (id)
);

-- Partial unique index that backs hermes_report_finding()'s
-- `on conflict (fingerprint) where status in (...)`. Lets a fingerprint
-- recur once its prior finding is resolved/dismissed/expired, but keeps a
-- single OPEN row per fingerprint.
create unique index if not exists hermes_findings_open_fingerprint
    on public.hermes_findings (fingerprint)
    where (status in ('new','verifying','confirmed'));

create index if not exists hermes_findings_status_idx  on public.hermes_findings (status);
create index if not exists hermes_findings_subject_idx on public.hermes_findings (subject);

-- RLS is enabled with NO policies in live: only the service role (which
-- bypasses RLS) and SECURITY DEFINER functions can touch the table.
alter table public.hermes_findings enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- Function: hermes_report_finding — upsert a finding keyed by fingerprint
-- (symptom:subject). New open row, or bump last_seen_at/occurrence_count on
-- the existing open one. Returns was_new = (xmax = 0).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.hermes_report_finding(
    p_job_kind text,
    p_subject text,
    p_symptom text,
    p_observation text,
    p_observed_metrics jsonb default '{}'::jsonb,
    p_evidence_refs jsonb default '[]'::jsonb,
    p_hypothesis text default null::text,
    p_suggested_action text default null::text,
    p_job_id text default null::text,
    p_ttl interval default '24:00:00'::interval)
 returns table(id uuid, fingerprint text, was_new boolean)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
-- Return columns share names with table columns (id, fingerprint). The
-- ON CONFLICT inference clause cannot be table-qualified, so without this
-- pragma 'fingerprint' is ambiguous. use_column resolves bare names to the
-- table column, which is what the inference clause needs.
#variable_conflict use_column
declare
    v_fp text := p_symptom || ':' || p_subject;
begin
    return query
    insert into hermes_findings as f
        (fingerprint, job_kind, job_id, subject, symptom, observation,
         observed_metrics, evidence_refs, hypothesis, suggested_action, expires_at)
    values
        (v_fp, p_job_kind, p_job_id, p_subject, p_symptom, p_observation,
         coalesce(p_observed_metrics, '{}'::jsonb),
         coalesce(p_evidence_refs, '[]'::jsonb),
         p_hypothesis, p_suggested_action, now() + p_ttl)
    on conflict (fingerprint) where status in ('new','verifying','confirmed')
    do update set
        last_seen_at     = now(),
        occurrence_count = f.occurrence_count + 1,
        observed_metrics = excluded.observed_metrics,
        evidence_refs    = excluded.evidence_refs,
        expires_at       = now() + p_ttl
    returning f.id, f.fingerprint, (xmax = 0) as was_new;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Function: hermes_expire_stale — expire untriaged 'new' findings past TTL.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.hermes_expire_stale()
 returns integer
 language plpgsql
as $function$
declare v_count integer;
begin
    update hermes_findings
       set status = 'expired'
     where status = 'new'
       and expires_at < now();
    get diagnostics v_count = row_count;
    return v_count;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Function: hermes_run_deterministic_rules — emit findings for hard-coded
-- invariants. LIVE rule set (3): stc_in_feed, active_feed_collapse,
-- low_scoring_coverage. Returns the number of findings emitted this run.
-- ─────────────────────────────────────────────────────────────────────────
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
begin
  -- Rule: stc_in_feed — STC lots must never appear in the active feed.
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

  -- Rule: active_feed_collapse — total active feed below the 3000 floor.
  select json_array_length(get_active_lots()) into v_active;
  if v_active < 3000 then
    perform hermes_report_finding('det_rule','feed','active_feed_collapse',
      format('Active feed is %s lots (baseline ~4561; floor 3000).', v_active),
      jsonb_build_object('active_count', v_active), '[]'::jsonb,
      null, 'Investigate scrape/extraction pipeline health.', 'det:active_feed_collapse',
      interval '7 days');
    v_emitted := v_emitted + 1;
  end if;

  -- Rule: low_scoring_coverage — <50% of recent available lots are scored.
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.hermes_open as
 select id, fingerprint, status, verdict, severity, subject, symptom,
        observation, hypothesis, occurrence_count, last_seen_at, expires_at
   from hermes_findings
  where status = any (array['new'::text, 'verifying'::text, 'confirmed'::text])
  order by (
        case severity
            when 'critical' then 0
            when 'high'     then 1
            when 'medium'   then 2
            when 'low'      then 3
            else 4
        end), last_seen_at desc;

create or replace view public.hermes_actionable as
 select id, fingerprint, severity, subject, symptom, observation,
        verified_evidence, verifier_notes, assignee, files_touched
   from hermes_findings
  where status = 'confirmed'::text and verdict = 'confirmed_current'::text
  order by (
        case severity
            when 'critical' then 0
            when 'high'     then 1
            when 'medium'   then 2
            when 'low'      then 3
            else 4
        end), last_seen_at desc;
