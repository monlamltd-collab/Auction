// contracts/lot-events.contract.js — Pinned lot_events contract.
//
// Source of truth: lib/pipeline/lot-events.js (producer) + the live
// public.lot_events table (consumer). Bump LOT_EVENTS_SCHEMA_VERSION on
// any change. The CI harness in contracts/check.js fails on:
//   - removed/renamed/retyped columns,
//   - removed/renamed event_type values,
//   - removed/renamed/retyped payload keys.
// Additive changes (new columns, new event types, new payload keys) pass
// without a version bump, but bumping is still recommended discipline so
// consumers know to look.

export const LOT_EVENTS_SCHEMA_VERSION = '1.0.0';

export const LOT_EVENTS_TABLE = Object.freeze({
  columns: {
    id:          { type: 'bigint',                   nullable: false },
    lot_id:      { type: 'uuid',                     nullable: false },
    event_type:  { type: 'text',                     nullable: false },
    old_value:   { type: 'jsonb',                    nullable: true  },
    new_value:   { type: 'jsonb',                    nullable: true  },
    detected_at: { type: 'timestamp with time zone', nullable: false },
    source:      { type: 'jsonb',                    nullable: false },
  },
});

export const LOT_EVENT_TYPES_PINNED = Object.freeze([
  'lot_first_seen',
  'lot_status_changed',
  'lot_price_changed',
  'lot_price_status_changed',
  'lot_sold_price_set',
  'lot_vanished',
]);

// Per-event-type old_value / new_value JSONB shape. `null` means the
// column is null for that event type (not "anything"). The CI gate compares
// key sets and types; values for keys not listed here are allowed (additive).
export const LOT_EVENT_PAYLOADS = Object.freeze({
  lot_first_seen: {
    old: null,
    new: { status: 'string|null', price: 'number|null', sold_price: 'number|null', price_status: 'string|null' },
  },
  lot_status_changed: {
    old: { status: 'string|null' },
    new: { status: 'string|null' },
  },
  lot_price_changed: {
    old: { price: 'number|null' },
    new: { price: 'number|null' },
  },
  lot_price_status_changed: {
    old: { price_status: 'string|null' },
    new: { price_status: 'string|null' },
  },
  lot_sold_price_set: {
    old: { sold_price: 'number|null' },
    new: { sold_price: 'number|null' },
  },
  lot_vanished: {
    old: { status: 'string|null' },
    new: null,
  },
});

// Required keys on the `source` JSONB column. Removing one is breaking.
export const LOT_EVENTS_SOURCE_REQUIRED = Object.freeze([
  'scraper_version', 'house', 'writer',
]);
