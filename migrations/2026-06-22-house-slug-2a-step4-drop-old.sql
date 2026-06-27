-- ============================================================================
--  Phase 2a · STEP 4 — drop the old `house` column. THE point of no easy return.
--  Apply ONLY after: step 3 done, soak complete, "Deploy B" (writer switched to
--  house_slug) is live, AND the reader audit in HOUSE_KEY_2A_RUNBOOK.md confirms
--  NOTHING live still reads lots.house.
--
--  Drop the mirror trigger BEFORE the column (the trigger references new.house).
-- ============================================================================

-- Guard: refuse if any code path is still depending on the mirror (house != house_slug
-- should be impossible here, but check before the irreversible drop).
do $$
declare n int;
begin
  select count(*) into n from lots where house is distinct from house_slug;
  if n > 0 then raise exception 'ABORT: % lots have house != house_slug — investigate before dropping', n; end if;
end $$;

drop trigger if exists trg_lots_sync_house_slug on lots;
drop function if exists lots_sync_house_slug();
drop index if exists idx_lots_house;          -- the new idx_lots_house_slug remains
alter table lots drop column house;

-- ── ROLLBACK for step 4 (only path after the drop — re-create from house_slug) ──
--   alter table lots add column house text;
--   update lots set house = house_slug;
--   alter table lots alter column house set not null;
--   create index if not exists idx_lots_house on lots (house);
--   -- then revert Deploy A + Deploy B code, and re-run the step-2 RPC with l.house.
