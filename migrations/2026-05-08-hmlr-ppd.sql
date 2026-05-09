-- HMLR Price Paid Data — bulk-loaded monthly via scripts/refresh-hmlr-ppd.mjs.
-- Replaces the live SPARQL endpoint at landregistry.data.gov.uk/landregistry/query
-- (currently used in lib/enrichment.js::queryLandRegistry). Same columns, but:
--   • served from Postgres (no flaky public SPARQL)
--   • filtered to lot postcodes only (--postcodes-only) to keep volume sane
--
-- PPD column reference: https://www.gov.uk/guidance/about-the-price-paid-data

CREATE TABLE IF NOT EXISTS hmlr_ppd (
  transaction_id    TEXT          PRIMARY KEY,
  price             INTEGER       NOT NULL,
  transfer_date     DATE          NOT NULL,
  postcode          TEXT,
  property_type     TEXT,         -- D | S | T | F | O
  is_new            BOOLEAN,
  duration          TEXT,         -- F (freehold) | L (leasehold)
  paon              TEXT,
  saon              TEXT,
  street            TEXT,
  locality          TEXT,
  town              TEXT,
  district          TEXT,
  county            TEXT,
  ppd_category      TEXT,         -- A (standard) | B (additional)
  record_status     TEXT,         -- A (added) | C (changed) | D (deleted)
  loaded_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Primary access pattern: queryLandRegistry(postcode) — postcode + recent dates.
CREATE INDEX IF NOT EXISTS idx_hmlr_ppd_postcode_date
  ON hmlr_ppd (postcode, transfer_date DESC);

COMMENT ON TABLE hmlr_ppd IS
  'HM Land Registry Price Paid Data, bulk-loaded. Replaces the live SPARQL endpoint. Property type codes: D=Detached, S=Semi, T=Terraced, F=Flat, O=Other.';
