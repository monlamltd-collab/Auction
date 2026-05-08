-- migrations/2026-05-06-rewrite-get-active-lots-rpc.sql
--
-- Fix B (companion to commit a7e7aa8): remove the INNER JOIN to
-- cached_analyses from get_active_lots(). That join was acting as a
-- "what's currently live" gate, but cached_analyses entries expire after
-- their TTL — so any house that didn't successfully re-scrape today
-- silently dropped out of the public feed even though its lots were still
-- healthy in the lots table.
--
-- Diagnosed 2026-05-06: cached_analyses had 12/167 active rows, leaving
-- only ~508 lots in the public feed instead of ~4,377 status='available'.
-- A Bristol-radius search returned 2 lots from a database with 78
-- available BS-postcode lots.
--
-- New definition: filter lots directly by status (live statuses only) and
-- last_seen_at recency. Independent of cached_analyses; the table can drift
-- as it likes without affecting visibility of healthy lot data.
--
-- Status whitelist: available + stc (sold subject to contract — deal not
-- final, may fall through) + unsold (post-auction reserved for re-listing).
-- Excludes: sold (transaction done), withdrawn (off market — added back
-- separately by buildAllLotsResponse for past-30-days history),
-- extraction_failure (placeholder-address rows from the 2026-05-05 cleanup).
--
-- Recency cutoff: 21 days last_seen_at. Catches houses on weekly/fortnightly
-- scrape cycles, excludes long-stale data.

CREATE OR REPLACE FUNCTION public.get_active_lots()
RETURNS json
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT l.house, l.lot_number, l.url, l.catalogue_url, l.address, l.postcode,
           l.lat, l.lng,
           l.price, l.price_text, l.prop_type, l.beds, l.tenure, l.lease_length,
           l.sqft, l.condition, l.image_url, l.bullets, l.units, l.auction_date,
           l.status, l.sold_price, l.epc_rating, l.epc_score, l.epc_date,
           l.flood_zone, l.flood_risk, l.street_avg, l.street_sales, l.street_sales_count,
           l.below_market, l.est_monthly_rent, l.est_annual_rent, l.est_gross_yield,
           l.score, l.score_breakdown, l.opps, l.risks, l.deal_type, l.vacant, l.title_split,
           l.last_seen_at
    FROM lots l
    WHERE l.status IN ('available', 'stc', 'unsold')
      AND l.last_seen_at > now() - interval '21 days'
  ) t;
$function$;
