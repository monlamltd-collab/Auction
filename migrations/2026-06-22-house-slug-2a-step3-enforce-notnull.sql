-- ============================================================================
--  Phase 2a · STEP 3 — make house_slug NOT NULL. Apply ONLY after the soak
--  window (7-14 days) on Deploy A, once verified there are zero nulls/mismatches.
--  Safe: the mirror trigger guarantees house_slug = house (which is NOT NULL).
-- ============================================================================

-- Guard: refuse to proceed if any nulls remain (run this first; expect 0).
do $$
declare n int;
begin
  select count(*) into n from lots where house_slug is null;
  if n > 0 then raise exception 'ABORT: % lots have NULL house_slug — backfill before enforcing', n; end if;
end $$;

alter table lots alter column house_slug set not null;

-- ── ROLLBACK for step 3 ──
--   alter table lots alter column house_slug drop not null;
