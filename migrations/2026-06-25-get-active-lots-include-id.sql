-- migrations/2026-06-25-get-active-lots-include-id.sql
--
-- Add lots.id (UUID) to the get_active_lots() JSON output so the frontend
-- carries `_dbId` on active-feed lots (not just unsold ones, which already get
-- it via LOTS_SELECT). Needed for the mobile lot drawer's ?lot=<uuid> URL state
-- (Back-button close + shareable link) and to line up with the SSR /lot/:id
-- page. Purely additive — every existing consumer reads columns by name, so an
-- extra `id` key in each row's json is inert to them. CREATE OR REPLACE makes
-- this idempotent.
--
-- Identical to 2026-05-30-remove-stc-from-active-feed.sql, with `l.id` added as
-- the first selected column.

CREATE OR REPLACE FUNCTION public.get_active_lots()
RETURNS json
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT l.id,
           l.house, l.lot_number, l.url, l.catalogue_url, l.address, l.postcode,
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
