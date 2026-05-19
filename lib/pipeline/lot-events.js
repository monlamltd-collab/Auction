// lib/pipeline/lot-events.js — Append-only event emitter for lot_events.
//
// Sits alongside lot_history + lot_status_history during the migration
// window. Every writer that mutates lots.status / lots.price /
// lots.price_status / lots.sold_price funnels through buildLotEvent +
// insertLotEvents so the schema stays consistent.
//
// Six event types, mirroring the CHECK constraint in
// migrations/2026-05-19-lot-events.sql. Keep these two in sync.
//
// Best-effort writes: insertLotEvents logs and continues on failure.
// The event stream is observability infrastructure, not the source of
// truth — it must never block or fail the primary lot write.
//
// Pure helpers (diffLotEvents, buildLotEvent, isValidEventType) are
// exported for unit testing without a Supabase dependency.

import { supabase } from '../supabase.js';

export const LOT_EVENT_TYPES = Object.freeze({
  FIRST_SEEN:           'lot_first_seen',
  STATUS_CHANGED:       'lot_status_changed',
  PRICE_CHANGED:        'lot_price_changed',
  PRICE_STATUS_CHANGED: 'lot_price_status_changed',
  SOLD_PRICE_SET:       'lot_sold_price_set',
  VANISHED:             'lot_vanished',
});

const VALID_TYPES = new Set(Object.values(LOT_EVENT_TYPES));

export function isValidEventType(t) {
  return VALID_TYPES.has(t);
}

const REQUIRED_SOURCE_KEYS = ['scraper_version', 'house', 'writer'];

/**
 * Build a single lot_events row. Returns null + logs on invalid input —
 * never throws (caller is mid-write, the event log is a side channel).
 *
 * @param {object} args
 * @param {string} args.lotId           lots.id (UUID)
 * @param {string} args.eventType       one of LOT_EVENT_TYPES values
 * @param {*}      [args.oldValue]      JSONB-serialisable, may be null
 * @param {*}      [args.newValue]      JSONB-serialisable, may be null
 * @param {object} args.source          { scrape_id?, scraper_version, house, writer }
 * @returns {object|null}
 */
export function buildLotEvent({ lotId, eventType, oldValue = null, newValue = null, source }) {
  if (!lotId || typeof lotId !== 'string') {
    console.warn(`lot-events: buildLotEvent missing/invalid lotId (eventType=${eventType})`);
    return null;
  }
  if (!isValidEventType(eventType)) {
    console.warn(`lot-events: buildLotEvent invalid eventType="${eventType}" (lotId=${lotId})`);
    return null;
  }
  if (!source || typeof source !== 'object') {
    console.warn(`lot-events: buildLotEvent missing source (eventType=${eventType}, lotId=${lotId})`);
    return null;
  }
  for (const k of REQUIRED_SOURCE_KEYS) {
    if (!source[k]) {
      console.warn(`lot-events: buildLotEvent source missing "${k}" (eventType=${eventType}, lotId=${lotId})`);
      return null;
    }
  }
  return {
    lot_id: lotId,
    event_type: eventType,
    old_value: oldValue,
    new_value: newValue,
    source: {
      scrape_id: source.scrape_id ?? null,
      scraper_version: source.scraper_version,
      house: source.house,
      writer: source.writer,
    },
  };
}

// Strict equality check that treats null/undefined as equivalent.
// JS `0 === 0` and `null !== 0` so this matches the per-field semantics
// we want for diffing: a price moving from null → 0 should fire (we
// finally know the price), 0 → null should fire (we lost it).
function valuesDiffer(a, b) {
  const aNorm = (a === undefined) ? null : a;
  const bNorm = (b === undefined) ? null : b;
  return aNorm !== bNorm;
}

/**
 * Diff a before/after lot state and produce 0..N event rows.
 *
 * When `before` is null, emits a single `lot_first_seen` event capturing
 * the snapshot. Otherwise emits one event per changed field
 * (status / price / sold_price / price_status). Pure — no I/O.
 *
 * @param {object} args
 * @param {string}      args.lotId
 * @param {object|null} args.before  prior lot state (or null for first contact)
 * @param {object}      args.after   new lot state
 * @param {object}      args.source  { scrape_id?, scraper_version, house, writer }
 * @returns {Array<object>}
 */
export function diffLotEvents({ lotId, before, after, source }) {
  const out = [];
  const a = after || {};

  if (!before) {
    const ev = buildLotEvent({
      lotId,
      eventType: LOT_EVENT_TYPES.FIRST_SEEN,
      oldValue: null,
      newValue: {
        status: a.status ?? null,
        price: a.price ?? null,
        sold_price: a.sold_price ?? null,
        price_status: a.price_status ?? null,
      },
      source,
    });
    if (ev) out.push(ev);
    return out;
  }

  const b = before;

  if (valuesDiffer(b.status, a.status)) {
    const ev = buildLotEvent({
      lotId,
      eventType: LOT_EVENT_TYPES.STATUS_CHANGED,
      oldValue: { status: b.status ?? null },
      newValue: { status: a.status ?? null },
      source,
    });
    if (ev) out.push(ev);
  }
  if (valuesDiffer(b.price, a.price)) {
    const ev = buildLotEvent({
      lotId,
      eventType: LOT_EVENT_TYPES.PRICE_CHANGED,
      oldValue: { price: b.price ?? null },
      newValue: { price: a.price ?? null },
      source,
    });
    if (ev) out.push(ev);
  }
  if (valuesDiffer(b.sold_price, a.sold_price)) {
    const ev = buildLotEvent({
      lotId,
      eventType: LOT_EVENT_TYPES.SOLD_PRICE_SET,
      oldValue: { sold_price: b.sold_price ?? null },
      newValue: { sold_price: a.sold_price ?? null },
      source,
    });
    if (ev) out.push(ev);
  }
  if (valuesDiffer(b.price_status, a.price_status)) {
    const ev = buildLotEvent({
      lotId,
      eventType: LOT_EVENT_TYPES.PRICE_STATUS_CHANGED,
      oldValue: { price_status: b.price_status ?? null },
      newValue: { price_status: a.price_status ?? null },
      source,
    });
    if (ev) out.push(ev);
  }
  return out;
}

/**
 * Build a `lot_vanished` event for an in-play lot absent from the latest
 * scrape. Pairs with the `lot_status_changed → withdrawn` emitted by
 * persist-lots prune-vanished — both fire per design.
 */
export function buildVanishedEvent({ lotId, oldStatus, source }) {
  return buildLotEvent({
    lotId,
    eventType: LOT_EVENT_TYPES.VANISHED,
    oldValue: { status: oldStatus ?? null },
    newValue: null,
    source,
  });
}

/**
 * Batched insert into lot_events. Errors logged + swallowed.
 *
 * @param {Array<object>} events  rows produced by buildLotEvent / diffLotEvents
 * @returns {Promise<{ inserted: number }>}
 */
export async function insertLotEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return { inserted: 0 };
  const valid = events.filter(Boolean);
  if (valid.length === 0) return { inserted: 0 };

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const batch = valid.slice(i, i + CHUNK);
    const { error } = await supabase.from('lot_events').insert(batch);
    if (error) {
      console.warn(`lot-events: insert failed (batchSize=${batch.length}): ${error.message}`);
      continue;
    }
    inserted += batch.length;
  }
  return { inserted };
}
