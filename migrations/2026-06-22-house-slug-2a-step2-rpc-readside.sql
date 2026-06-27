-- ============================================================================
--  Phase 2a · STEP 2 — point the active-feed RPC at house_slug, WITHOUT changing
--  the public JSON contract. Apply this TOGETHER WITH "Deploy A" (the reader code
--  changes — see HOUSE_KEY_2A_RUNBOOK.md). Requires step 1 applied & backfilled.
--
--  The ONLY change vs the live definition is `l.house` -> `l.house_slug AS house`,
--  so the emitted JSON key stays "house" and the browser/API contract is unchanged.
--  Verified against the live pg_get_functiondef on 2026-06-22.
-- ============================================================================
create or replace function public.get_active_lots()
 returns json
 language sql
 stable
as $function$
  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  from (
    select l.house_slug as house,                       -- was: l.house
           l.auctioneer, l.lot_number, l.url, l.catalogue_url, l.address, l.postcode, l.lat, l.lng,
           l.price, l.price_text, l.prop_type, l.beds, l.tenure, l.lease_length, l.sqft, l.condition,
           l.image_url, l.images, l.floor_plans, l.bullets, l.units, l.auction_date, l.status,
           l.epc_rating, l.epc_score, l.floor_area_sqm, l.flood_zone, l.flood_risk,
           l.comparable_price, l.street_sales_count, l.below_market, l.est_monthly_rent, l.est_gross_yield,
           l.value_estimate, l.score, l.score_breakdown, l.opps, l.risks, l.deal_type, l.vacant, l.title_split, l.last_seen_at
    from lots l
    where ((l.status = 'available' and l.last_seen_at > now() - interval '21 days')
        or (l.status = 'unsold'    and l.auction_date > now() - interval '30 days'))
  ) t;
$function$;

-- ── Verify (read-only) — active feed unchanged vs the old column ──
--   select json_array_length(get_active_lots());   -- compare to the count before step 2
--   -- spot-check a few houses still appear under key "house":
--   select (e->>'house') as house, count(*) from json_array_elements(get_active_lots()) e group by 1 order by 2 desc limit 5;

-- ── ROLLBACK for step 2 ── re-run the prior definition (l.house instead of l.house_slug).
