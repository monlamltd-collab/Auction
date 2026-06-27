-- ============================================================================
--  hermes_findings  —  durable, conflict-free findings store for AuctionBrain
-- ============================================================================
--  Design principles (the reasons this exists, not just what it does):
--
--   1. STATE LIVES HERE, NOT IN GIT. Status transitions are column updates, so
--      concurrent Claude Code sessions never collide on a tracked task file.
--
--   2. OBSERVATION vs HYPOTHESIS ARE SEPARATED. Hermes is a cheap, unintelligent
--      model. What it MEASURED (a house went 833 -> 0 lots; a log contained
--      string X) is trustworthy. What it GUESSED about cause ("Gemini quota")
--      is not. The two are different column groups and are treated differently.
--
--   3. TRUST IS ASSIGNED BY THE VERIFIER, NEVER BY HERMES. There is no
--      Hermes-supplied confidence or severity column. Those are filled in only
--      after a real check (see hermes-verify.js).
--
--   4. DEDUP IS STRUCTURAL. These crons recur, so the same problem reappears
--      daily. A deterministic fingerprint + partial-unique upsert collapses
--      recurrences into one open row with an occurrence counter (the same
--      pattern as the growth-brain-ads SHA-256 dedup, but readable).
--
--   5. FINDINGS EXPIRE. AuctionBrain self-heals (url_healed events, scanners
--      that self-correct on the next run). A finding that is never verified
--      before its TTL elapses is auto-expired so stale work is not actioned.
--
--  Target: Postgres 15/16 (Supabase). No extensions required.
-- ============================================================================

create table if not exists hermes_findings (
    id                uuid primary key default gen_random_uuid(),

    -- ---- Identity / dedup -------------------------------------------------
    -- fingerprint = symptom || ':' || subject  e.g. 'zero_extraction:auctionhouse'
    -- The partial-unique index below makes a fresh report of an already-open
    -- problem UPDATE the existing row instead of inserting a duplicate.
    fingerprint       text        not null,

    -- ---- OBSERVATION  (Hermes measured this — higher trust) ---------------
    job_kind          text        not null,    -- which cron emitted it
    job_id            text,                     -- Hermes job_id, for traceback
    subject           text        not null,     -- house slug or pipeline component
    symptom           text        not null,     -- machine label, drives the verifier
    observation       text        not null,     -- factual claim, Hermes's words
    observed_metrics  jsonb       not null default '{}'::jsonb,
                                                 -- e.g. {"current_lots":0,"previous_lots":833}
    evidence_refs     jsonb       not null default '[]'::jsonb,
                                                 -- pointers Hermes actually cited:
                                                 -- log strings, file:line, URLs it curled.
                                                 -- THIS is what earns an observation trust.

    -- ---- HYPOTHESIS  (Hermes guessed this — low trust, never auto-acted) ---
    hypothesis        text,                      -- proposed root cause
    suggested_action  text,                      -- what Hermes thinks should happen
    -- NOTE: deliberately no hermes_confidence / hermes_severity column.

    -- ---- VERIFICATION  (filled by the verifier — trust is assigned here) ---
    status            text        not null default 'new'
                        check (status in
                          ('new','verifying','confirmed','dismissed','resolved','expired')),
    verdict           text
                        check (verdict in
                          ('confirmed_current','self_healed','false_positive','needs_human')),
    severity          text                       -- VERIFIER-assigned only
                        check (severity in ('low','medium','high','critical')),
    dismiss_reason    text
                        -- 'known_state' (added 2026-06-21): the house is at 0 lots
                        -- but that is an EXPECTED state — dormant, circuit-breaker
                        -- cooldown, or not-yet-due — not a breakage. The health gate
                        -- in hermes-verify.js dismisses these so cooldowns/dormancy
                        -- are never paraded as confirmed breakages.
                        check (dismiss_reason in
                          ('self_healed','false_positive','duplicate','wont_fix','known_state')),
    verifier_notes    text,
    verified_evidence jsonb,                      -- what the verifier found NOW
                                                  -- (current lot count, live log lines,
                                                  --  endpoint probe) — distinct from
                                                  --  Hermes's evidence_refs.
    verified_at       timestamptz,

    -- ---- Ownership (for the worktree conflict story) ----------------------
    assignee          text,                       -- session/worktree that claimed it
    files_touched     jsonb,                      -- files this fix will edit, so other
                                                  -- sessions can check overlap before
                                                  -- starting (disjoint-file-set guard)

    -- ---- Lifecycle --------------------------------------------------------
    created_at        timestamptz not null default now(),
    first_seen_at     timestamptz not null default now(),
    last_seen_at      timestamptz not null default now(),
    occurrence_count  integer     not null default 1,
    expires_at        timestamptz not null default now() + interval '24 hours',
    resolved_at       timestamptz
);

-- Dedup: only ONE open row per fingerprint. Once a row is resolved/dismissed/
-- expired it no longer blocks a new one, so a recurrence of a *closed* problem
-- correctly opens a fresh finding.
create unique index if not exists hermes_findings_open_fingerprint
    on hermes_findings (fingerprint)
    where status in ('new','verifying','confirmed');

create index if not exists hermes_findings_status_idx  on hermes_findings (status);
create index if not exists hermes_findings_subject_idx on hermes_findings (subject);

-- Self-documenting: encode the trust model in the catalogue itself.
comment on column hermes_findings.observation      is 'TRUSTED: what Hermes measured.';
comment on column hermes_findings.evidence_refs    is 'TRUSTED: pointers Hermes cited.';
comment on column hermes_findings.hypothesis       is 'UNTRUSTED: Hermes guess at cause. Never auto-acted.';
comment on column hermes_findings.severity         is 'Verifier-assigned only. Hermes severity is not stored.';
comment on column hermes_findings.verified_evidence is 'What the verifier found at verification time (current state).';


-- ============================================================================
--  Ingestion API  —  Hermes (or a thin shim) calls ONE function.
--  Wrapping the upsert removes a whole class of errors a cheap model would
--  make writing ON CONFLICT SQL by hand.
-- ============================================================================
create or replace function hermes_report_finding(
    p_job_kind         text,
    p_subject          text,
    p_symptom          text,
    p_observation      text,
    p_observed_metrics jsonb     default '{}'::jsonb,
    p_evidence_refs    jsonb     default '[]'::jsonb,
    p_hypothesis       text      default null,
    p_suggested_action text      default null,
    p_job_id           text      default null,
    p_ttl              interval  default interval '24 hours'
) returns table (id uuid, fingerprint text, was_new boolean)
language plpgsql as $$
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
        observed_metrics = excluded.observed_metrics,  -- refresh with latest numbers
        evidence_refs    = excluded.evidence_refs,
        expires_at       = now() + p_ttl               -- a live recurrence resets the clock
    returning f.id, f.fingerprint, (xmax = 0) as was_new;
end;
$$;


-- ============================================================================
--  Housekeeping  —  expire findings that were never verified in time.
--  Run from a scheduled job (pg_cron, or a daily Hermes/Make tick).
-- ============================================================================
create or replace function hermes_expire_stale()
returns integer language plpgsql as $$
declare v_count integer;
begin
    update hermes_findings
       set status = 'expired'
     where status = 'new'            -- only the never-looked-at ones
       and expires_at < now();
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;


-- ============================================================================
--  Read views
-- ============================================================================
-- Everything still needing a human / Claude Code eye.
create or replace view hermes_open as
    select id, fingerprint, status, verdict, severity, subject, symptom,
           observation, hypothesis, occurrence_count, last_seen_at, expires_at
      from hermes_findings
     where status in ('new','verifying','confirmed')
     order by
       case severity when 'critical' then 0 when 'high' then 1
                     when 'medium' then 2 when 'low' then 3 else 4 end,
       last_seen_at desc;

-- Verified-still-broken: the only set safe to put in front of the human gate.
create or replace view hermes_actionable as
    select id, fingerprint, severity, subject, symptom, observation,
           verified_evidence, verifier_notes, assignee, files_touched
      from hermes_findings
     where status = 'confirmed' and verdict = 'confirmed_current'
     order by
       case severity when 'critical' then 0 when 'high' then 1
                     when 'medium' then 2 when 'low' then 3 else 4 end,
       last_seen_at desc;


-- ============================================================================
--  RLS  —  lock the table; service_role bypasses RLS in Supabase.
--  Adjust to align with your own RLS conventions (and your Clerk migration).
--  With RLS enabled and no permissive policy, anon/authenticated get nothing
--  while the service role Hermes uses still has full access.
-- ============================================================================
alter table hermes_findings enable row level security;
-- (Add a read policy here later if your dashboard needs authenticated reads.)
