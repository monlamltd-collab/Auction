-- 2026-04-30: Persist Land Registry comps + EPC floor area (rollout #6).
--
-- Two related changes that together unblock the comps work in #7:
--
-- 1) postcode_sales table — promotes the per-lot lots.street_sales JSONB
--    blob to a queryable, cross-lot table. Each row is one Land Registry
--    sale. Key benefits:
--      • Build postcode-level statistics (median sold price, transaction
--        count, days-on-market) without scanning every lot's JSONB.
--      • Show "comparable sales" cards on the lot page from any postcode,
--        not just postcodes attached to one of our lots.
--      • Avoid duplicate API calls — multiple lots in the same postcode
--        share the same comp set.
--
-- 2) lots.epc_floor_area_sqm / lots.epc_floor_area_sqft — captures the
--    EPC-sourced floor area separately from lots.sqft (which is a mix of
--    listing-text-extracted, EPC-fallback, and manual sources). Splitting
--    them lets:
--      • £/sqft scoring use the right denominator with proper provenance
--      • Future per-lot quality reports tell "EPC floor area" from
--        "guesstimated by extractor" without losing context
--
-- Idempotent: CREATE / ADD COLUMN / INDEX all use IF NOT EXISTS.

-- ── Part 1: postcode_sales table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.postcode_sales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postcode      TEXT NOT NULL,
  address       TEXT NOT NULL,
  sold_price    INT  NOT NULL,
  sold_date     DATE NOT NULL,
  property_type TEXT,
  source        TEXT NOT NULL DEFAULT 'land-registry',
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The natural key is (postcode, address, sold_date, sold_price). Land
  -- Registry never sells the same property at the same price on the same
  -- date twice, and even if they did the data is fungible. UNIQUE on this
  -- tuple makes ON CONFLICT DO NOTHING safe for the backfill + ongoing
  -- upserts.
  UNIQUE (postcode, address, sold_date, sold_price)
);

CREATE INDEX IF NOT EXISTS idx_postcode_sales_postcode
  ON public.postcode_sales(postcode);
CREATE INDEX IF NOT EXISTS idx_postcode_sales_postcode_sold_date
  ON public.postcode_sales(postcode, sold_date DESC);
CREATE INDEX IF NOT EXISTS idx_postcode_sales_sold_date
  ON public.postcode_sales(sold_date DESC);

ALTER TABLE public.postcode_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS postcode_sales_read ON public.postcode_sales;
CREATE POLICY postcode_sales_read ON public.postcode_sales
  FOR SELECT USING (true);

-- INSERT/UPDATE/DELETE are service_role only — RLS denies by default; we
-- don't add policies for those.

COMMENT ON TABLE public.postcode_sales IS
'Cross-lot Land Registry sale records. Replaces the per-lot lots.street_sales JSONB blob (which is kept transitionally for back-compat). Populated by lib/enrichment.js queryLandRegistry path; backfilled from existing JSONB by migrations/2026-04-30-backfill-postcode-sales.sql.';

-- ── Part 2: EPC floor-area columns on lots ────────────────────────────
ALTER TABLE public.lots
  ADD COLUMN IF NOT EXISTS epc_floor_area_sqm DOUBLE PRECISION;
ALTER TABLE public.lots
  ADD COLUMN IF NOT EXISTS epc_floor_area_sqft INTEGER;

COMMENT ON COLUMN public.lots.epc_floor_area_sqm IS
'Total floor area from the EPC register (square metres). Distinct from lots.sqft, which may be sourced from listing text, EPC fallback, or manual entry. Set by EPC enrichment in lib/enrichment.js.';
COMMENT ON COLUMN public.lots.epc_floor_area_sqft IS
'Convenience conversion of epc_floor_area_sqm to square feet (rounded to integer). Set in the same enrichment step.';
