-- migrations/2026-06-25-get-active-lots-include-id.sql
--
-- Add lots.id (UUID) to the get_active_lots() JSON output so the frontend
-- carries `_dbId` on active-feed lots (not just unsold ones, which already get
-- it via LOTS_SELECT). Needed for the mobile lot drawer's ?lot=<uuid> URL state
-- (Back-button close + shareable link) and to line up with the SSR /lot/:id
-- page. Purely additive — every existing consumer reads columns by name, so an
-- extra `id` key in each row's json is inert to them.
--
-- IMPORTANT: this body is the LIVE function definition pulled from the database
-- (which already has the Phase-2a `house_slug as house` rename + images/
-- floor_plans/value_estimate columns and has dropped sold_price/epc_date/
-- street_sales/street_avg/est_annual_rent), with ONLY `l.id` added. Do not
-- regenerate from older migration files — they reference dropped columns.
-- CREATE OR REPLACE makes it idempotent.

CREATE OR REPLACE FUNCTION public.get_active_lots()
RETURNS json
LANGUAGE sql
STABLE
AS $function$
  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  from (
    select l.id,
           l.house_slug as house,
           l.auctioneer, l.lot_number, l.url, l.catalogue_url, l.address, l.postcode, l.lat, l.lng,
           l.price, l.price_text, l.prop_type, l.beds, l.tenure, l.lease_length, l.sqft, l.condition,
           l.image_url, l.images, l.floor_plans, l.bullets, l.units, l.auction_date, l.status,
           l.epc_rating, l.epc_score, l.floor_area_sqm, l.flood_zone, l.flood_risk,
           l.comparable_price, l.street_sales_count, l.below_market, l.est_monthly_rent, l.est_gross_yield,
           l.value_estimate, l.score, l.score_breakdown, l.opps, l.risks, l.deal_type, l.vacant, l.title_split,
           l.last_seen_at
    from lots l
    where ((l.status = 'available' and l.last_seen_at > now() - interval '21 days')
        or (l.status = 'unsold'    and l.auction_date > now() - interval '30 days'))
  ) t;
$function$;
