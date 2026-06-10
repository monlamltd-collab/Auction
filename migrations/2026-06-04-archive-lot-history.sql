-- migrations/2026-06-04-archive-lot-history.sql
--
-- lot_events migration completion. ARCHIVES (does NOT drop) the two legacy
-- history tables and removes their last `lots` columns.
--
-- WHY ARCHIVE, NOT DROP (Simon's call, 2026-06-04): lot_events only goes back
-- to 2026-05-19 (~10k rows). lot_history (~297k rows, back to 2026-04-26) and
-- lot_status_history (~39k rows, back to 2026-04-05) hold price/status history
-- that exists nowhere else. Renaming to *_archive preserves every row while
-- removing the tables from the active data model. All new change-tracking now
-- goes to lot_events only (lib/pipeline/persist-lots.js).
--
-- DEPLOY ORDERING: the code in this PR stops writing/reading these tables and
-- the sold_price/price_status columns. DEPLOY THE CODE FIRST, then apply this.
-- (Applying while old code is live would error on the renamed tables / dropped
--  columns until the deploy lands — non-fatal/retried, but avoid it.)
--
-- Idempotent: safe to run repeatedly.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Archive the legacy history tables (preserve all rows).
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='lot_history')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='lot_history_archive') THEN
    ALTER TABLE public.lot_history RENAME TO lot_history_archive;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='lot_status_history')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='lot_status_history_archive') THEN
    ALTER TABLE public.lot_status_history RENAME TO lot_status_history_archive;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Make the archives standalone — drop their FK to lots(id) so a future
--    lots deletion can't cascade-delete the archived history.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS public.lot_history_archive        DROP CONSTRAINT IF EXISTS lot_history_lot_id_fkey;
ALTER TABLE IF EXISTS public.lot_status_history_archive DROP CONSTRAINT IF EXISTS lot_status_history_lot_id_fkey;

COMMENT ON TABLE public.lot_history_archive        IS 'ARCHIVE (frozen 2026-06-04): legacy per-scrape lot snapshots. Superseded by lot_events. Read-only historical reference — no new writes.';
COMMENT ON TABLE public.lot_status_history_archive IS 'ARCHIVE (frozen 2026-06-04): legacy status transitions. Superseded by lot_events. Read-only historical reference — no new writes.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Drop the lot_history snapshot-dedup RPC (only caller was persist-lots.js).
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.latest_lot_history_hashes(uuid[]);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Drop the now-unused lots columns.
--    Historical values live in lot_events (lot_sold_price_set /
--    lot_price_status_changed) and the *_archive tables.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.lots DROP COLUMN IF EXISTS sold_price;
ALTER TABLE public.lots DROP COLUMN IF EXISTS price_status;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. get_active_lots() — drop sold_price from the projection (otherwise
--    identical to migrations/rebuild-lots.sql's definition).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_active_lots()
RETURNS json LANGUAGE sql STABLE AS $function$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT l.house, l.auctioneer, l.lot_number, l.url, l.catalogue_url, l.address, l.postcode, l.lat, l.lng,
           l.price, l.price_text, l.prop_type, l.beds, l.tenure, l.lease_length, l.sqft, l.condition,
           l.image_url, l.images, l.floor_plans, l.bullets, l.units, l.auction_date, l.status,
           l.epc_rating, l.epc_score, l.floor_area_sqm, l.flood_zone, l.flood_risk,
           l.comparable_price, l.street_sales_count, l.below_market, l.est_monthly_rent, l.est_gross_yield,
           l.value_estimate, l.score, l.score_breakdown, l.opps, l.risks, l.deal_type, l.vacant, l.title_split, l.last_seen_at
    FROM lots l
    WHERE ((l.status = 'available' AND l.last_seen_at > now() - interval '21 days')
        OR (l.status = 'unsold'    AND l.auction_date > now() - interval '30 days'))
  ) t;
$function$;

COMMIT;
