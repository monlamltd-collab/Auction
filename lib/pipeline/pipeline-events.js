// lib/pipeline/pipeline-events.js — Append-only emitter for pipeline_events.
//
// Sibling wrapper to lib/pipeline/lot-events.js. Different concern,
// different contract — do NOT mix vocabularies in one wrapper.
//   lot_events:      per-lot field changes (lot_id NOT NULL, old/new diff)
//   pipeline_events: scrape + enrichment lifecycle (lot_id NULL-able,
//                    single event_data payload)
//
// Contract pinned by migrations/2026-05-25-pipeline-events.sql.
// Event-type set + per-type payload shape documented in
// audits/observability-views.md. Additive-only evolution rule applies
// from the moment this lands.
//
// Best-effort writes: insertPipelineEvents logs and continues on failure.
// The event stream is observability infrastructure, never the source of
// truth — it must never block or fail the primary write.
//
// Pure helpers (isValidEventType, buildPipelineEvent) are exported for
// unit testing without a Supabase dependency.

import { supabase } from '../supabase.js';

export const PIPELINE_EVENT_TYPES = Object.freeze({
  SCRAPE_SEEN:                 'scrape_seen',
  SCRAPE_PERSISTED:            'scrape_persisted',
  SCRAPE_FAILED:               'scrape_failed',
  ENRICH_UPRN_OK:              'enrich_uprn_ok',
  ENRICH_UPRN_FAIL:            'enrich_uprn_fail',
  ENRICH_UPRN_CIRCUIT_OPEN:    'enrich_uprn_circuit_open',
  ENRICH_UPRN_CIRCUIT_CLOSED:  'enrich_uprn_circuit_closed',
  ENRICH_UPRN_RATE_LIMITED:    'enrich_uprn_rate_limited',
  FIRECRAWL_CALL:              'firecrawl_call',
});

const VALID_TYPES = new Set(Object.values(PIPELINE_EVENT_TYPES));

export function isValidEventType(t) {
  return VALID_TYPES.has(t);
}

/**
 * Build a single pipeline_events row. Returns null + logs on invalid input —
 * never throws (caller is mid-write, the event log is a side channel).
 *
 * @param {object} args
 * @param {string} args.source     code-path that emitted the event (required)
 * @param {string} args.eventType  one of PIPELINE_EVENT_TYPES values (required)
 * @param {string} [args.lotId]    lots.id (UUID) — optional, may be null
 * @param {string} [args.auctionId] auction_calendar.id (UUID) — optional
 * @param {object} [args.eventData] JSONB-serialisable payload (default {})
 * @returns {object|null}
 */
export function buildPipelineEvent({ source, eventType, lotId = null, auctionId = null, eventData = {} }) {
  if (!source || typeof source !== 'string') {
    console.warn(`pipeline-events: buildPipelineEvent missing source (eventType=${eventType})`);
    return null;
  }
  if (!isValidEventType(eventType)) {
    console.warn(`pipeline-events: buildPipelineEvent invalid eventType="${eventType}" (source=${source})`);
    return null;
  }
  if (eventData !== null && typeof eventData !== 'object') {
    console.warn(`pipeline-events: buildPipelineEvent eventData must be object/null (source=${source}, eventType=${eventType})`);
    return null;
  }
  return {
    lot_id: lotId || null,
    auction_id: auctionId || null,
    source,
    event_type: eventType,
    event_data: eventData || {},
  };
}

/**
 * Best-effort batch insert. Logs and swallows errors — never throws.
 * Filters out null rows from buildPipelineEvent() failures so callers
 * can do `insertPipelineEvents([buildPipelineEvent(...), ...])` without
 * pre-filtering.
 *
 * @param {Array<object|null>} events
 * @returns {Promise<{inserted: number, attempted: number}>}
 */
export async function insertPipelineEvents(events) {
  const rows = (events || []).filter(Boolean);
  if (rows.length === 0) return { inserted: 0, attempted: 0 };
  if (!supabase) {
    console.warn('pipeline-events: supabase not initialised — skipping insert');
    return { inserted: 0, attempted: rows.length };
  }
  try {
    const { error } = await supabase.from('pipeline_events').insert(rows);
    if (error) {
      console.warn(`pipeline-events: insert error (${rows.length} events): ${error.message}`);
      return { inserted: 0, attempted: rows.length };
    }
    return { inserted: rows.length, attempted: rows.length };
  } catch (err) {
    console.warn(`pipeline-events: insert threw (${rows.length} events): ${err.message}`);
    return { inserted: 0, attempted: rows.length };
  }
}

/**
 * Convenience single-event emitter. Same best-effort semantics.
 *
 * @param {object} args - see buildPipelineEvent
 * @returns {Promise<void>}
 */
export async function emitPipelineEvent(args) {
  const evt = buildPipelineEvent(args);
  if (!evt) return;
  await insertPipelineEvents([evt]);
}
