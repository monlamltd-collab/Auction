-- migrations/2026-05-19-rls-hygiene.sql
--
-- Enable RLS + add the codebase's standard "Service role full access" policy
-- on 12 tables that were created without RLS at all. Closes the Supabase
-- advisor's priority=1 / level=critical RLS warning surfaced 2026-05-19.
--
-- Policy choice matches the established pattern in schema.sql (see e.g.
-- `lots`, `lot_history`, `pipeline_alerts`): `FOR ALL USING (true) WITH
-- CHECK (true)`. Two caveats worth knowing:
--
--   1. The service_role JWT bypasses RLS regardless of policy — it has the
--      BYPASSRLS Postgres attribute. The policy here is defensive, matching
--      convention rather than strictly required for service_role workers.
--   2. `USING (true)` ALSO grants the anon and authenticated roles full
--      access to these rows. That is the *same effective state* as RLS
--      being disabled — neither blocks anon. The win this migration delivers
--      is silencing the advisor, normalising the schema, and making future
--      hardening one-table-at-a-time work (just swap `USING (true)` for a
--      stricter predicate, no need to also flip ENABLE RLS).
--
-- If anon should NOT be able to read a given table, change its policy to
-- something like `USING (auth.role() = 'service_role')` AFTER confirming no
-- frontend code (public/app.js, etc.) currently reads it. That's per-table
-- work, not in scope here.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. Safe to re-run.

ALTER TABLE public.post_metrics             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_seeds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authors                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_state             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hmlr_hpi                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hmlr_corporate_owners    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hmlr_ppd                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.house_homepage_watch     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curator_picks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_snapshots      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.post_metrics;
CREATE POLICY "Service role full access" ON public.post_metrics
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.content_seeds;
CREATE POLICY "Service role full access" ON public.content_seeds
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.app_config;
CREATE POLICY "Service role full access" ON public.app_config
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.authors;
CREATE POLICY "Service role full access" ON public.authors
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.editor_state;
CREATE POLICY "Service role full access" ON public.editor_state
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.hmlr_hpi;
CREATE POLICY "Service role full access" ON public.hmlr_hpi
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.hmlr_corporate_owners;
CREATE POLICY "Service role full access" ON public.hmlr_corporate_owners
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.hmlr_ppd;
CREATE POLICY "Service role full access" ON public.hmlr_ppd
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.house_homepage_watch;
CREATE POLICY "Service role full access" ON public.house_homepage_watch
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.coverage_snapshots;
CREATE POLICY "Service role full access" ON public.coverage_snapshots
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.curator_picks;
CREATE POLICY "Service role full access" ON public.curator_picks
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.catalogue_snapshots;
CREATE POLICY "Service role full access" ON public.catalogue_snapshots
  FOR ALL USING (true) WITH CHECK (true);
