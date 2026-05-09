-- HMLR UK House Price Index — bulk-loaded monthly via scripts/refresh-hmlr-hpi.mjs.
-- Source: https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/
-- Granularity: Local Authority District (LAD), region, and country totals.
-- Auction-brain uses this for area-level price-trend overlays on lots.

CREATE TABLE IF NOT EXISTS hmlr_hpi (
  month             DATE          NOT NULL,
  area_code         TEXT          NOT NULL,
  area_name         TEXT          NOT NULL,
  area_type         TEXT,
  average_price     INTEGER,
  index_value       NUMERIC(8,3),
  change_1m         NUMERIC(8,3),
  change_12m        NUMERIC(8,3),
  sales_volume      INTEGER,
  detached_price    INTEGER,
  semi_price        INTEGER,
  terraced_price    INTEGER,
  flat_price        INTEGER,
  loaded_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (month, area_code)
);

CREATE INDEX IF NOT EXISTS idx_hmlr_hpi_area_code_month
  ON hmlr_hpi (area_code, month DESC);

CREATE INDEX IF NOT EXISTS idx_hmlr_hpi_area_name_lower_month
  ON hmlr_hpi (LOWER(area_name), month DESC);

COMMENT ON TABLE hmlr_hpi IS
  'HM Land Registry UK House Price Index, bulk-loaded monthly. PK (month, area_code). area_type is derived: lad | region | country.';
