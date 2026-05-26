// contracts/pipeline-events.contract.js — Pinned pipeline_events contract.
//
// Source of truth: lib/pipeline/pipeline-events.js (producer wrapper) + the
// live public.pipeline_events table + emit call sites in lib/os-places.js
// and lib/pipeline/persist-lots.js.
//
// Sibling to lot-events.contract.js, separate vocabulary. Bump
// PIPELINE_EVENTS_SCHEMA_VERSION on any change. CI gate (contracts/check.js)
// fails on:
//   - removed/renamed/retyped columns,
//   - removed/renamed event_type values,
//   - removed/renamed/retyped payload keys.
// Additive changes pass without a version bump but the bump is still
// recommended discipline so consumers know to look.

export const PIPELINE_EVENTS_SCHEMA_VERSION = '1.2.0';

export const PIPELINE_EVENTS_TABLE = Object.freeze({
  columns: {
    event_id:   { type: 'bigint',                   nullable: false },
    lot_id:     { type: 'uuid',                     nullable: true  },
    auction_id: { type: 'uuid',                     nullable: true  },
    source:     { type: 'text',                     nullable: false },
    event_type: { type: 'text',                     nullable: false },
    event_data: { type: 'jsonb',                    nullable: false },
    created_at: { type: 'timestamp with time zone', nullable: false },
  },
});

export const PIPELINE_EVENT_TYPES_PINNED = Object.freeze([
  'scrape_seen',
  'scrape_persisted',
  'scrape_failed',
  'enrich_uprn_ok',
  'enrich_uprn_fail',
  'enrich_uprn_circuit_open',
  'enrich_uprn_circuit_closed',
  'enrich_uprn_rate_limited',
  'firecrawl_call',
]);

// Per-event-type event_data shape. CI gate compares key sets and types;
// values present on the live payload but not listed here are allowed
// (additive). Keys listed here that disappear or change type fail.
export const PIPELINE_EVENT_PAYLOADS = Object.freeze({
  scrape_seen: {
    house: 'string',
    candidate_count: 'number',
    catalogue_url: 'string|null',
    extracted_with: 'string|null',
    scraped_with: 'string|null',
  },
  scrape_persisted: {
    house: 'string',
    persisted_count: 'number',
    candidate_count: 'number',
    catalogue_url: 'string|null',
    extracted_with: 'string|null',
    scraped_with: 'string|null',
  },
  scrape_failed: {
    house: 'string',
    catalogue_url: 'string|null',
    candidate_count: 'number',
    error: 'string',
  },
  enrich_uprn_ok: {
    status: 'string',
    uprn: 'string|null',
    matchScore: 'number|null',
    httpStatus: 'number|null',
    addressKey: 'string',
  },
  enrich_uprn_fail: {
    status: 'string',
    uprn: 'string|null',
    matchScore: 'number|null',
    httpStatus: 'number|null',
    addressKey: 'string',
  },
  enrich_uprn_circuit_open: {
    reason: 'string|null',
    breaker: 'string',
  },
  enrich_uprn_circuit_closed: {
    reason: 'string|null',
    breaker: 'string',
  },
  // Emitted when the OS Places token bucket forces a live call to wait
  // longer than the throttle threshold. Cache hits never emit this — they
  // bypass the bucket entirely.
  enrich_uprn_rate_limited: {
    waited_ms: 'number',
    threshold_ms: 'number',
    bucket_tokens: 'number',
    bucket_capacity: 'number',
  },
  // One row per Firecrawl HTTP call, emitted from
  // lib/resource-budget.js _fireEvent() when a scraper wrapper supplies
  // an eventMeta object. endpoint is the Firecrawl API path; caller is
  // 'firecrawl.<wrapperName>'; outcome covers success / failed /
  // cancelled / timeout. weight is the credit count debited locally
  // for this call (allows the firecrawl_spend_7d view to surface
  // multiplier drift). url may be null for endpoints that aren't
  // URL-scoped (e.g. /v1/search) and is truncated to 256 chars.
  firecrawl_call: {
    endpoint: 'string',
    caller: 'string',
    outcome: 'string',
    weight: 'number',
    tier: 'string',
    url: 'string|null',
    elapsedMs: 'number',
  },
});
