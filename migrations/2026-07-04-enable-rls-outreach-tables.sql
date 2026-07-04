-- migrations/2026-07-04-enable-rls-outreach-tables.sql
--
-- Enable RLS on the 8 outreach/social tables flagged ERROR-level by the
-- Supabase security advisor (2026-07-03 audit): they were fully exposed to
-- the anon and authenticated roles, and several hold outreach PII (contact
-- names, emails, LinkedIn URLs, reply bodies).
--
-- No policies are created deliberately: every consumer is ContentBrain,
-- which runs server-side on the service_role key (bypasses RLS). Verified
-- 2026-07-04: ContentBrain's Railway SUPABASE_ANON_KEY variable actually
-- holds a service_role JWT, and ContentBrain PR #28 makes the client prefer
-- a properly-named SUPABASE_SERVICE_KEY. Nothing anon-side reads these
-- tables (repo-wide grep across Auction / ContentBrain / *-Content repos).
--
-- Same pattern as 2026-07-04-processed-webhook-events.sql. Idempotent.

ALTER TABLE public.prospects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replies               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppression           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_outcomes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_audience_daily ENABLE ROW LEVEL SECURITY;
