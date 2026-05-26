-- migrations/2026-05-26-pipeline-events-firecrawl-call.sql
--
-- Extend pipeline_events.event_type CHECK to include 'firecrawl_call'.
--
-- Additive change: a new event_type value, no rename or removal of any
-- existing value. Re-runnable — DROP IF EXISTS then ADD pattern mirrors
-- migrations/2026-05-25-pipeline-events.sql.
--
-- The 'firecrawl_call' event records every Firecrawl HTTP call from the
-- scraper layer. event_data shape (pinned in
-- contracts/pipeline-events.contract.js + audit/observability-views.md):
--
--   {
--     endpoint:   '/v2/scrape' | '/v2/extract' | '/v2/map'
--                 | '/v2/batch/scrape' | '/v1/search',
--     caller:     'firecrawl.<wrapperName>',
--     outcome:    'success' | 'failed' | 'cancelled' | 'timeout',
--     weight:     number,    -- credits debited from local counter
--     tier:       string,    -- ResourceBudget tier label
--     url:        string|null,  -- target URL (truncated to 256 chars), may be null for search
--     elapsedMs:  number     -- wall-clock duration of the call
--   }
--
-- Producer: lib/resource-budget.js _fireEvent() invoked from
-- recordFcRequest/recordFcAgentRequest/recordFcMapRequest when an
-- eventMeta object is supplied by the scraper wrapper.
--
-- Consumer: firecrawl_spend_24h + firecrawl_spend_7d views
-- (migrations/2026-05-26-pipeline-events-firecrawl-views.sql).

ALTER TABLE pipeline_events
  DROP CONSTRAINT IF EXISTS pipeline_events_type_check;

ALTER TABLE pipeline_events
  ADD CONSTRAINT pipeline_events_type_check
  CHECK (event_type IN (
    'scrape_seen',
    'scrape_persisted',
    'scrape_failed',
    'enrich_uprn_ok',
    'enrich_uprn_fail',
    'enrich_uprn_circuit_open',
    'enrich_uprn_circuit_closed',
    'enrich_uprn_rate_limited',
    'firecrawl_call'
  ));
