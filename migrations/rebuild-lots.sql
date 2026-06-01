-- migrations/rebuild-lots.sql
--
-- Lean rebuild of public.lots. IN-PLACE (ALTER), not a table swap.
--
-- WHY IN-PLACE, NOT lots_v2 + swap (deviation from the original brief):
--   7 tables FK to lots.id — lot_events (source of truth), pipeline_events,
--   lot_units, curator_picks, enrichment_retry_queue, lot_history,
--   lot_status_history. A create-v2-and-rename swap breaks all 7 FK
--   constraints and orphans the children. An in-place ALTER preserves id and
--   every FK with zero re-pointing, and reaches the identical end schema.
--
-- GATE RULE (enforced by tests/test-lot-columns.js):
--   A column exists only if it is displayed to the investor OR feeds
--   score/fundability OR is required system infrastructure. Everything else
--   is derived-on-read or does not exist.
--
-- SCOPE OF THIS MIGRATION (the "contained" rebuild):
--   • DROP 13 dead/derived columns (+ the search_vector GIN index).
--   • RENAME 3 columns to their lean names, carrying data
--     (street_avg→comparable_price, epc_floor_area_sqm→floor_area_sqm,
--      floor_plan_url→floor_plans). field_sources→sources is deferred.
--   • ADD auctioneer + created_at.
--   • COMMENT every surviving column with why it exists.
--   • Rewrite get_active_lots() to the lean column set.
--
-- DEFERRED (NOT done here — see the commented block at the very bottom):
--   sold_price, price_status, and dropping lot_history / lot_status_history
--   are wired into the live lot_events / post-auction-sweep / status-drift
--   machinery (4+ writers). Removing them cleanly is the separate
--   "lot_events migration completion" task already tracked in WORKSTREAMS.md.
--   They are intentionally KEPT here.
--
-- Idempotent: safe to run repeatedly. Every step guards on current state.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. RENAMES (carry data) — guarded so re-runs are no-ops
-- ═══════════════════════════════════════════════════════════════════════════

-- street_avg (int) → comparable_price (numeric). Nearby-sold average from
-- Land Registry. Renamed to decouple the public name from the old
-- street_sales/street_avg comps internals.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='lots' AND column_name='street_avg')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='lots' AND column_name='comparable_price') THEN
    ALTER TABLE public.lots RENAME COLUMN street_avg TO comparable_price;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='lots' AND column_name='comparable_price') THEN
    ALTER TABLE public.lots ALTER COLUMN comparable_price TYPE numeric;
  END IF;
END $$;

-- epc_floor_area_sqm (double precision) → floor_area_sqm (numeric). EPC
-- register floor area; the sole stored floor-area field (sqft is derived
-- on read).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='lots' AND column_name='epc_floor_area_sqm')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='lots' AND column_name='floor_area_sqm') THEN
    ALTER TABLE public.lots RENAME COLUMN epc_floor_area_sqm TO floor_area_sqm;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='lots' AND column_name='floor_area_sqm') THEN
    ALTER TABLE public.lots ALTER COLUMN floor_area_sqm TYPE numeric;
  END IF;
END $$;

-- floor_plan_url (text, single) → floor_plans (jsonb array). Type change, so
-- this is add-backfill-drop rather than a plain rename.
ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS floor_plans jsonb;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='lots' AND column_name='floor_plan_url') THEN
    UPDATE public.lots
       SET floor_plans = jsonb_build_array(floor_plan_url)
     WHERE floor_plan_url IS NOT NULL
       AND floor_plan_url <> ''
       AND (floor_plans IS NULL OR jsonb_array_length(floor_plans) = 0);
    ALTER TABLE public.lots DROP COLUMN floor_plan_url;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ADD lean columns
-- ═══════════════════════════════════════════════════════════════════════════

-- auctioneer: human-readable auction house name for display (house stays the
-- canonical slug / system key). Populated at persist time from
-- getHouseDisplayName() in lib/houses.js.
ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS auctioneer text;

-- created_at: row creation stamp, distinct from first_seen_at (which is a
-- pipeline "first time the scraper saw this lot" marker).
ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. DROP dead / derived columns
--    DROP COLUMN cascades to dependent objects (e.g. the search_vector GIN
--    index drops with the column). Verified 2026-06-01: no VIEW depends on
--    any column in this list.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.lots
  DROP COLUMN IF EXISTS raw_text,              -- 646MB of raw HTML; never read on the hot path
  DROP COLUMN IF EXISTS search_vector,         -- unused: search.js uses search_text ILIKE, not tsvector @@
  DROP COLUMN IF EXISTS est_annual_rent,       -- derive on read: est_monthly_rent * 12
  DROP COLUMN IF EXISTS epc_floor_area_sqft,   -- derive on read: floor_area_sqm * 10.7639
  DROP COLUMN IF EXISTS epc_works_cost_mid,    -- not displayed; deal-stack worksCost is derived client-side
  DROP COLUMN IF EXISTS epc_works_summary,     -- not displayed
  DROP COLUMN IF EXISTS os_classification,     -- internal OS code; not displayed, not scored
  DROP COLUMN IF EXISTS extracted_with,        -- scraper provenance; lives in enrichment_manifest / sources
  DROP COLUMN IF EXISTS scraped_with,          -- scraper provenance; lives in enrichment_manifest / sources
  DROP COLUMN IF EXISTS quality_score,         -- internal observability; not displayed, not scored
  DROP COLUMN IF EXISTS quality_issues,        -- internal observability; not displayed, not scored
  DROP COLUMN IF EXISTS epc_date,              -- not displayed (epc_rating + epc_score are)
  DROP COLUMN IF EXISTS street_sales;          -- raw comps array unused; comparable_price + street_sales_count cover the UI

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. COLUMN COMMENTS — why each surviving column exists
--    (displayed = rendered in public/app.js · scoring = feeds analyseLot /
--     fundability · system = required infrastructure / FK / provenance)
-- ═══════════════════════════════════════════════════════════════════════════

-- Identity & system
COMMENT ON COLUMN public.lots.id                  IS 'system: uuid PK. FK target for lot_events, pipeline_events, lot_units, curator_picks, enrichment_retry_queue, lot_history, lot_status_history.';
COMMENT ON COLUMN public.lots.house               IS 'system: canonical house slug (lowercase). The join/dedup key used across the pipeline.';
COMMENT ON COLUMN public.lots.auctioneer          IS 'displayed: human-readable auction house name (from getHouseDisplayName).';
COMMENT ON COLUMN public.lots.auction_id          IS 'system: FK to auction_calendar(id). NOT NULL.';
COMMENT ON COLUMN public.lots.catalogue_url       IS 'system: source catalogue page the lot was scraped from.';
COMMENT ON COLUMN public.lots.url                 IS 'system+displayed: lot detail-page URL; also the upsert conflict key (UNIQUE).';
COMMENT ON COLUMN public.lots.property_key        IS 'system: generated dedup key = lower(postcode)||"|"||lower(first address line).';
COMMENT ON COLUMN public.lots.first_seen_at       IS 'system: first scrape that saw this lot (default now() on insert).';
COMMENT ON COLUMN public.lots.last_seen_at        IS 'system: most recent scrape that saw this lot; drives the active-feed recency gate.';
COMMENT ON COLUMN public.lots.created_at          IS 'system: row creation timestamp (default now()).';
COMMENT ON COLUMN public.lots.enriched_at         IS 'system: last enrichment pass timestamp.';
COMMENT ON COLUMN public.lots.search_text         IS 'system: denormalised natural-language blob searched via ILIKE in routes/search.js.';
COMMENT ON COLUMN public.lots.enrichment_manifest IS 'system: per-scrape observability blob (no silent failures); records every lookup outcome + yield/below-market scoring gates.';
COMMENT ON COLUMN public.lots.field_sources       IS 'system: per-field provenance map { field: source }. (→sources rename deferred with the lot_events migration.)';

-- Listing facts (mirror the source)
COMMENT ON COLUMN public.lots.lot_number          IS 'displayed: lot number as listed.';
COMMENT ON COLUMN public.lots.auction_date        IS 'displayed: auction date (Europe/London assumed).';
COMMENT ON COLUMN public.lots.status              IS 'displayed+system: available / unsold / withdrawn / sold; gates the active feed.';
COMMENT ON COLUMN public.lots.address             IS 'displayed: full property address.';
COMMENT ON COLUMN public.lots.postcode            IS 'displayed+system: postcode; drives radius search + enrichment lookups.';
COMMENT ON COLUMN public.lots.lat                 IS 'system+displayed: latitude (OS Places / postcodes.io); powers map + radius search.';
COMMENT ON COLUMN public.lots.lng                 IS 'system+displayed: longitude.';
COMMENT ON COLUMN public.lots.price               IS 'displayed+scoring: guide price (integer £). Feeds £/sqft, yield, below-market.';
COMMENT ON COLUMN public.lots.price_text          IS 'displayed: verbatim guide text e.g. "Guide £250,000+".';
COMMENT ON COLUMN public.lots.price_status        IS 'system: structured price intent (guide/poa/tba/sold/...). DEFERRED for removal with the lot_events migration.';
COMMENT ON COLUMN public.lots.prop_type           IS 'displayed+scoring: property type (house/flat/land/commercial/...).';
COMMENT ON COLUMN public.lots.tenure              IS 'displayed+scoring: freehold / leasehold / share of freehold.';
COMMENT ON COLUMN public.lots.lease_length        IS 'displayed: remaining lease years (nullable).';
COMMENT ON COLUMN public.lots.beds                IS 'displayed+scoring: bedroom count (nullable).';
COMMENT ON COLUMN public.lots.sqft                IS 'displayed+scoring: floor area in sqft; feeds the £/sqft signal.';
COMMENT ON COLUMN public.lots.condition           IS 'scoring+displayed: derived condition (poor/needs work/good); feeds the refurb/modernisation signals.';
COMMENT ON COLUMN public.lots.units               IS 'displayed+scoring: unit count for multi-unit/portfolio lots; feeds title-split + block-lot gating.';
COMMENT ON COLUMN public.lots.bullets             IS 'displayed+scoring: feature/description bullets; the primary text analyseLot scores against.';
COMMENT ON COLUMN public.lots.image_url           IS 'displayed: best main image URL.';
COMMENT ON COLUMN public.lots.images              IS 'displayed: kept property-photo URLs (post image-quality-filter).';
COMMENT ON COLUMN public.lots.floor_plans         IS 'displayed: floor-plan image URLs (text[] as jsonb).';
COMMENT ON COLUMN public.lots.sold_price          IS 'displayed: realised price for past auctions. DEFERRED for removal with the lot_events migration.';

-- Assessment overlay
COMMENT ON COLUMN public.lots.uprn                IS 'system: OS Places UPRN; canonical property identifier for enrichment joins.';
COMMENT ON COLUMN public.lots.epc_rating          IS 'displayed: EPC band (A–G).';
COMMENT ON COLUMN public.lots.epc_score           IS 'displayed: EPC numeric score /100 (shown as "EPC B · 75/100").';
COMMENT ON COLUMN public.lots.floor_area_sqm      IS 'displayed+scoring: floor area in m² (EPC register); source for the derived sqft.';
COMMENT ON COLUMN public.lots.flood_zone          IS 'displayed: EA flood zone 1/2/3 (badge).';
COMMENT ON COLUMN public.lots.flood_risk          IS 'displayed+scoring: flood risk level; feeds the flood-risk penalty.';
COMMENT ON COLUMN public.lots.comparable_price    IS 'displayed: nearby sold average from Land Registry (street comps).';
COMMENT ON COLUMN public.lots.street_sales_count  IS 'displayed: number of comparable street sales behind comparable_price.';
COMMENT ON COLUMN public.lots.below_market        IS 'displayed: percent below local median (guide vs comparable_price).';
COMMENT ON COLUMN public.lots.est_monthly_rent    IS 'displayed+scoring: estimated monthly rent (OpenRent comps); est_annual_rent + yield derive from this.';
COMMENT ON COLUMN public.lots.est_gross_yield     IS 'displayed+scoring: gross initial yield %.';
COMMENT ON COLUMN public.lots.value_estimate      IS 'displayed: value-estimator output (jsonb: point estimate + confidence).';
COMMENT ON COLUMN public.lots.score               IS 'displayed+scoring: investment score 0–10 (analyseLot, clamped).';
COMMENT ON COLUMN public.lots.score_breakdown     IS 'displayed: per-signal scoring contributions ("why this scored X").';
COMMENT ON COLUMN public.lots.opps                IS 'displayed+scoring: opportunity tags from analyseLot.';
COMMENT ON COLUMN public.lots.risks               IS 'displayed+scoring: risk tags from analyseLot.';
COMMENT ON COLUMN public.lots.deal_type           IS 'displayed: deal-type badge (Refurb / Development / Title Split / ...).';
COMMENT ON COLUMN public.lots.vacant              IS 'displayed+scoring: vacant possession flag; feeds the vacant-dwelling signal.';
COMMENT ON COLUMN public.lots.title_split         IS 'displayed+scoring: title-split potential; feeds the title-split signal.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. get_active_lots() — lean rebuild
--    Same active-feed semantics as 2026-05-30-remove-stc-from-active-feed.sql
--    (available by last_seen_at recency, unsold by auction_date recency), with
--    the dead columns removed, street_avg→comparable_price, and auctioneer added.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_active_lots()
RETURNS json
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT l.house, l.auctioneer, l.lot_number, l.url, l.catalogue_url,
           l.address, l.postcode, l.lat, l.lng,
           l.price, l.price_text, l.prop_type, l.beds, l.tenure, l.lease_length,
           l.sqft, l.condition, l.image_url, l.images, l.floor_plans, l.bullets,
           l.units, l.auction_date, l.status, l.sold_price,
           l.epc_rating, l.epc_score, l.floor_area_sqm,
           l.flood_zone, l.flood_risk,
           l.comparable_price, l.street_sales_count, l.below_market,
           l.est_monthly_rent, l.est_gross_yield, l.value_estimate,
           l.score, l.score_breakdown, l.opps, l.risks, l.deal_type,
           l.vacant, l.title_split, l.last_seen_at
    FROM lots l
    WHERE (
      (l.status = 'available' AND l.last_seen_at > now() - interval '21 days')
      OR
      (l.status = 'unsold'    AND l.auction_date > now() - interval '30 days')
    )
  ) t;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DEFERRED — do NOT run until the lot_events migration is complete.
--
-- Dropping sold_price / price_status and the two legacy history tables
-- requires first migrating these writers/readers off them:
--   • lib/pipeline/persist-lots.js   (history snapshots, status-history inserts)
--   • lib/pipeline/drift-scheduler.js (status-drift writes lot_status_history)
--   • lib/pipeline/post-auction-sweep.js (writes sold_price + status history)
--   • routes/admin.js                (reads/writes lot_status_history)
--   • public/app.js                  (renders sold_price on past auctions)
--   • DROP FUNCTION latest_lot_history_hashes(uuid[])
--
-- Once those are migrated to lot_events, run:
--
--   ALTER TABLE public.lots DROP COLUMN IF EXISTS sold_price;
--   ALTER TABLE public.lots DROP COLUMN IF EXISTS price_status;
--   DROP TABLE IF EXISTS public.lot_history;
--   DROP TABLE IF EXISTS public.lot_status_history;
--   DROP FUNCTION IF EXISTS public.latest_lot_history_hashes(uuid[]);
-- ═══════════════════════════════════════════════════════════════════════════
