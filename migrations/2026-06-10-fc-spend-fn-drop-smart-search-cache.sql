-- migrations/2026-06-10-fc-spend-fn-drop-smart-search-cache.sql
--
-- Two pieces of the 2026-06-10 tidy-up:
--
-- 1. fc_cycle_spend(since) — sums booked Firecrawl credits from
--    pipeline_events so ResourceBudget.hydrateFcSpend() can restore the
--    cycle counter after a restart. Before this, every deploy zeroed the
--    in-memory counter and the 80/95/100% budget alerts never fired while
--    the real plan drained (100k credits burned in a fortnight, plan dead
--    2026-06-03 02:32 UTC).
--
-- 2. Drops smart_search_cache — a half-retired preset-cache idea. Nothing
--    inserts into or reads from the table (smart search uses an in-memory
--    Map); only two stale-marking UPDATE blocks remained, removed in the
--    same PR. 7 fossil cache rows, no data value.
--
-- DEPLOY ORDERING: apply AFTER the accompanying code deploys (the old code
-- still ran the stale-marking UPDATEs against smart_search_cache; harmless
-- failures, but avoid the window).
--
-- Idempotent: safe to run repeatedly.

create or replace function public.fc_cycle_spend(since timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum((event_data->>'weight')::numeric), 0)
  from public.pipeline_events
  where event_type = 'firecrawl_call'
    and created_at >= since;
$$;

drop table if exists public.smart_search_cache;
