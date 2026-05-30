-- migrations/2026-05-30-remove-stc-from-active-feed.sql
--
-- Remove 'stc' (sold subject to contract) from the get_active_lots() status
-- whitelist. STC lots are under offer — they're not available for new
-- investors and pollute the feed. The original rationale ("deal not final,
-- may fall through") was reasonable but in practice these lots stay visible
-- for months, crowding out genuinely available auction stock.
--
-- Also adds an auction_date recency gate for 'unsold' lots (within 30 days)
-- so ancient unsold property doesn't pollute the directory.
--
-- Statuses in active feed after this: 'available' + 'unsold' (recent only).
-- 'stc' moves to the past-auctions bucket served by buildAllLotsResponse
-- when includePast=true.

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
    WHERE (
      -- Available: current auction stock (recency by last_seen_at)
      (l.status = 'available' AND l.last_seen_at > now() - interval '21 days')
      OR
      -- Unsold: recently-passed auctions only (recency by auction_date)
      (l.status = 'unsold' AND l.auction_date > now() - interval '30 days')
    )
  ) t;
$function$;
