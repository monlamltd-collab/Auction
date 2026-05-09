-- HMLR Corporate / Overseas Ownership Data — bulk-loaded monthly via
-- scripts/refresh-hmlr-companies.mjs. Both CCOD (UK companies) and OCOD
-- (overseas companies) share an identical schema, so they live in one
-- table distinguished by `dataset`.
--
-- Source: https://use-land-property-data.service.gov.uk
-- Datasets: ccod (~4.4M titles, 1.5GB) + ocod (~91k titles, 36MB).
-- Auction-brain uses this to flag lots whose postcode matches a corporate-
-- or overseas-owned title — often a probate / distressed-sale signal.

CREATE TABLE IF NOT EXISTS hmlr_corporate_owners (
  title_number                    TEXT          NOT NULL,
  dataset                         TEXT          NOT NULL,
  tenure                          TEXT,
  property_address                TEXT,
  district                        TEXT,
  county                          TEXT,
  region                          TEXT,
  postcode                        TEXT,
  multiple_address_indicator      TEXT,
  price_paid                      INTEGER,
  date_proprietor_added           DATE,
  additional_proprietor_indicator TEXT,
  proprietors                     JSONB,
  file_month                      DATE          NOT NULL,
  loaded_at                       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (title_number, dataset),
  CONSTRAINT hmlr_corporate_owners_dataset_chk CHECK (dataset IN ('ccod','ocod'))
);

CREATE INDEX IF NOT EXISTS idx_hmlr_corp_postcode
  ON hmlr_corporate_owners (postcode);

CREATE INDEX IF NOT EXISTS idx_hmlr_corp_dataset
  ON hmlr_corporate_owners (dataset);

CREATE INDEX IF NOT EXISTS idx_hmlr_corp_proprietors_gin
  ON hmlr_corporate_owners USING GIN (proprietors);

COMMENT ON TABLE hmlr_corporate_owners IS
  'HMLR CCOD + OCOD ownership data. PK (title_number, dataset). proprietors is a JSONB array of up to 4 entries: { name, company_no, category, country, address1, address2, address3 }.';
