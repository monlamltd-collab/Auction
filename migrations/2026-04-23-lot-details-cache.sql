-- ═══════════════════════════════════════════════════════════════
-- lot_details cache table (Phase 3 of detail-extraction-refactor)
-- Per-URL cache of fetched lot detail pages with 30-day TTL.
-- Cuts Firecrawl spend dramatically — same lot is not re-fetched
-- cycle-to-cycle. Read by fetchLotPage() before any HTTP/Firecrawl call.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lot_details (
  url            TEXT PRIMARY KEY,
  house          TEXT NOT NULL,
  html           TEXT,                      -- raw HTML of the detail page
  html_hash      TEXT,                      -- sha256 of raw HTML, for change detection
  extracted_data JSONB,                     -- result of DETAIL_EXTRACTORS[house](html)
  source         TEXT,                      -- 'http' | 'firecrawl' | 'puppeteer'
  fetched_at     TIMESTAMPTZ DEFAULT now(),
  expires_at     TIMESTAMPTZ DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS idx_lot_details_expires ON lot_details(expires_at);
CREATE INDEX IF NOT EXISTS idx_lot_details_house   ON lot_details(house);

ALTER TABLE lot_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lot_details FOR ALL USING (true) WITH CHECK (true);

-- Cleanup helper — delete expired rows. Call from a periodic task or include in autoAnalyseAll.
-- DELETE FROM lot_details WHERE expires_at < now();
