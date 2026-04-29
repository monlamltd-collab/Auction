-- 2026-04-30: lot_units child table — Phase 2 of #5 (multi-unit lot model).
--
-- Most auction lots are single properties, but a meaningful minority are
-- portfolios ("12, 14, 16 High Street") or blocks ("flats 1-5 at X
-- House") sold as one lot but with multiple postal addresses. Today the
-- pipeline collapses those into a single row, losing every secondary
-- unit's UPRN, EPC, and Land Registry comp opportunity.
--
-- This table is the data model. Detection logic + per-unit enrichment
-- hooks are deferred to a follow-up — landing the schema first lets us
-- backfill in stages.
--
-- Idempotent: CREATE TABLE / INDEX / POLICY all use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.lot_units (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id        UUID NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
  position      INT  NOT NULL DEFAULT 0,  -- 0-based ordinal within the lot
  unit_address  TEXT NOT NULL,
  unit_postcode TEXT,
  unit_uprn     TEXT,
  unit_lat      DOUBLE PRECISION,
  unit_lng      DOUBLE PRECISION,
  unit_classification TEXT,
  unit_epc_rating     TEXT,
  field_sources       JSONB NOT NULL DEFAULT '{}'::jsonb,
  enrichment_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, position)
);

-- Indexes for the two natural lookup paths.
CREATE INDEX IF NOT EXISTS idx_lot_units_lot
  ON public.lot_units(lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_units_postcode
  ON public.lot_units(unit_postcode)
  WHERE unit_postcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lot_units_uprn
  ON public.lot_units(unit_uprn)
  WHERE unit_uprn IS NOT NULL;

-- updated_at trigger so JSONB merges keep the timestamp honest.
CREATE OR REPLACE FUNCTION public.lot_units_touch_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lot_units_updated_at ON public.lot_units;
CREATE TRIGGER lot_units_updated_at
  BEFORE UPDATE ON public.lot_units
  FOR EACH ROW EXECUTE FUNCTION public.lot_units_touch_updated();

-- RLS: same pattern as the lots table — readable by anyone (lot data is
-- already exposed via the search API), writes restricted to service_role.
ALTER TABLE public.lot_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lot_units_read ON public.lot_units;
CREATE POLICY lot_units_read ON public.lot_units
  FOR SELECT USING (true);

-- INSERT/UPDATE/DELETE are service_role only — RLS denies by default; we
-- don't add policies for those, so the only path is via the service key.

COMMENT ON TABLE public.lot_units IS
'Per-unit child rows for multi-property auction lots (portfolios, blocks). One row per individual postal address within the parent lot. Detection logic populates this; pipeline enrichment fans out per-unit (UPRN, EPC, comps).';
COMMENT ON COLUMN public.lot_units.position IS
'0-based ordinal within the parent lot. UNIQUE(lot_id, position) prevents duplicates on re-scrape.';
