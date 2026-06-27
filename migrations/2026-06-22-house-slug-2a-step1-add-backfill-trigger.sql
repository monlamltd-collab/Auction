-- ============================================================================
--  Phase 2a · STEP 1 — add house_slug, backfill, mirror trigger, new index.
--  PROPOSE-ONLY. Apply this FIRST. Purely additive & reversible — no behaviour
--  change (house_slug just shadows the existing lots.house).
--  Rollback: see step "ROLLBACK" at the bottom.
-- ============================================================================

-- 1) Add the new slug column (nullable for now).
alter table lots add column if not exists house_slug text;

-- 2) Backfill from the existing canonical slug (lots.house holds the slug).
update lots set house_slug = house where house_slug is distinct from house;

-- 3) Mirror trigger: during the transition `house` stays the source of truth and
--    house_slug always equals it — so any writer not yet migrated (and the cron
--    pipeline mid-deploy) keeps house_slug correct with zero code coordination.
create or replace function lots_sync_house_slug() returns trigger
language plpgsql as $$
begin
  new.house_slug := new.house;   -- house is canonicalised upstream (canonicaliseHouseSlug)
  return new;
end;
$$;

drop trigger if exists trg_lots_sync_house_slug on lots;
create trigger trg_lots_sync_house_slug
  before insert or update on lots
  for each row execute function lots_sync_house_slug();

-- 4) New index mirroring idx_lots_house (keep BOTH until the drop step).
create index if not exists idx_lots_house_slug on lots (house_slug);

-- ── Verify (read-only) ──
--   select count(*) as mismatches from lots where house_slug is distinct from house;  -- expect 0
--   select count(*) as nulls from lots where house_slug is null;                       -- expect 0

-- ── ROLLBACK for step 1 (safe any time before step 4) ──
--   drop trigger if exists trg_lots_sync_house_slug on lots;
--   drop function if exists lots_sync_house_slug();
--   drop index if exists idx_lots_house_slug;
--   alter table lots drop column if exists house_slug;
