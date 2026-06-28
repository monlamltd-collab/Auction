-- migrations/2026-06-27-lots-house-slug-shim.sql
--
-- RECONSTRUCTED FROM LIVE STATE (2026-06-27), not freshly authored — companion
-- to migrations/2026-06-21-hermes-findings.sql. Documents the "Phase 2a"
-- house -> house_slug change that was applied directly to the live
-- Auction.Bridgematch DB (project pohrbfhftbprlfzsozyj) with no committed
-- migration. This file makes the repo source of truth for what is ACTUALLY live.
--
-- DO NOT treat this as a pending change — every object below already exists in
-- prod. It is idempotent (add-column-if-not-exists / create-or-replace) and the
-- backfill touches 0 rows today (house_slug already == house for all rows).
--
-- ── WHAT IS ACTUALLY LIVE (and how it differs from how the repo described it) ──
-- The repo (lib/types/lot.js) described this as a completed RENAME of lots.house
-- -> lots.house_slug (old column gone). That is NOT what is live. Live state is
-- the EXPAND phase of an expand/contract migration:
--   * lots.house       — still present, NOT NULL, the CANONICAL write target.
--   * lots.house_slug  — added, NULLABLE, a verbatim SHADOW of house.
--   * trigger lots_sync_house_slug() sets new.house_slug := new.house on every
--     INSERT/UPDATE, so the two columns are always identical (verified: 156
--     distinct values each, 0 nulls, house = house_slug for all 26,248 rows).
-- So house is canonical and house_slug is derived — the OPPOSITE direction from
-- the eventual rename intent. The CONTRACT phase (stop writing house, make
-- house_slug NOT NULL, drop the trigger, drop house) has NOT happened. Do not
-- assume house_slug is independent of house; today it cannot diverge.

-- ── Column ────────────────────────────────────────────────────────────────────
alter table public.lots add column if not exists house_slug text;

-- ── Sync trigger function ───────────────────────────────────────────────────────
-- house is canonicalised upstream; house_slug shadows it during the transition.
create or replace function public.lots_sync_house_slug()
 returns trigger
 language plpgsql
as $function$
begin
  new.house_slug := new.house;
  return new;
end;
$function$;

-- ── Trigger (PG14+ supports CREATE OR REPLACE TRIGGER; live DB is PG17) ─────────
create or replace trigger trg_lots_sync_house_slug
  before insert or update on public.lots
  for each row execute function public.lots_sync_house_slug();

-- ── Backfill (historical; idempotent no-op now) ─────────────────────────────────
update public.lots set house_slug = house where house_slug is distinct from house;
