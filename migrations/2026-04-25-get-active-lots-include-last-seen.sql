-- 2026-04-25: Extend get_active_lots() RPC to return last_seen_at
-- Used by /api/all-lots to synthesise an "auction ended" signal for lots whose
-- auction_date is null but which haven't been re-scraped in 14+ days (e.g.
-- paulfosh listings where the catalogue URL isn't in auction_calendar and the
-- source doesn't expose an "Auction Ends: DD/MM/YYYY" bullet).
CREATE OR REPLACE FUNCTION public.get_active_lots()
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT l.house, l.lot_number, l.url, l.catalogue_url, l.address, l.postcode,
           l.price, l.price_text, l.prop_type, l.beds, l.tenure, l.lease_length,
           l.sqft, l.condition, l.image_url, l.bullets, l.units, l.auction_date,
           l.status, l.sold_price, l.epc_rating, l.epc_score, l.epc_date,
           l.flood_zone, l.flood_risk, l.street_avg, l.street_sales, l.street_sales_count,
           l.below_market, l.est_monthly_rent, l.est_annual_rent, l.est_gross_yield,
           l.score, l.score_breakdown, l.opps, l.risks, l.deal_type, l.vacant, l.title_split,
           l.last_seen_at
    FROM lots l
    INNER JOIN cached_analyses ca ON l.catalogue_url = ca.url
    WHERE ca.expires_at > now()
  ) t;
$function$;
