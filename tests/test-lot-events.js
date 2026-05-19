// tests/test-lot-events.js — locks the pure-helper contracts of the
// lot_events emitter. Exercises buildLotEvent's validation rules and
// diffLotEvents' field-by-field semantics. insertLotEvents (the Supabase
// I/O) is covered by integration only — no value in mocking it here.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const {
  LOT_EVENT_TYPES,
  isValidEventType,
  buildLotEvent,
  diffLotEvents,
  buildVanishedEvent,
} = await import('../lib/pipeline/lot-events.js');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const FIXED_LOT_ID = '00000000-0000-0000-0000-000000000001';
const VALID_SOURCE = {
  scrape_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  scraper_version: 'firecrawl-json',
  house: 'hollismorgan',
  writer: 'persist-lots.upsert',
};

// ── isValidEventType ───────────────────────────────────────────────────
console.log('\nisValidEventType: vocabulary guard');
{
  for (const t of Object.values(LOT_EVENT_TYPES)) {
    assert(isValidEventType(t), `accepts "${t}"`);
  }
  assert(!isValidEventType('lot_sold'), 'rejects fine-grained alternative we chose against');
  assert(!isValidEventType(''), 'rejects empty string');
  assert(!isValidEventType(undefined), 'rejects undefined');
}

// ── buildLotEvent — happy path ─────────────────────────────────────────
console.log('\nbuildLotEvent: happy path');
{
  const ev = buildLotEvent({
    lotId: FIXED_LOT_ID,
    eventType: LOT_EVENT_TYPES.STATUS_CHANGED,
    oldValue: { status: 'available' },
    newValue: { status: 'sold' },
    source: VALID_SOURCE,
  });
  assert(ev !== null, 'returns a row');
  assert(ev.lot_id === FIXED_LOT_ID, 'lot_id passes through');
  assert(ev.event_type === 'lot_status_changed', 'event_type set');
  assert(ev.old_value.status === 'available' && ev.new_value.status === 'sold', 'old/new payloads preserved');
  assert(ev.source.scrape_id === VALID_SOURCE.scrape_id, 'source.scrape_id passes through');
  assert(ev.source.scraper_version === 'firecrawl-json', 'source.scraper_version passes through');
  assert(ev.source.house === 'hollismorgan', 'source.house passes through');
  assert(ev.source.writer === 'persist-lots.upsert', 'source.writer passes through');
}

// ── buildLotEvent — validation rejects ─────────────────────────────────
console.log('\nbuildLotEvent: rejects invalid input (returns null, no throw)');
{
  const missingLotId = buildLotEvent({
    lotId: null, eventType: LOT_EVENT_TYPES.STATUS_CHANGED, source: VALID_SOURCE,
  });
  assert(missingLotId === null, 'null lotId → null');

  const invalidType = buildLotEvent({
    lotId: FIXED_LOT_ID, eventType: 'lot_made_up', source: VALID_SOURCE,
  });
  assert(invalidType === null, 'invalid eventType → null');

  const noSource = buildLotEvent({
    lotId: FIXED_LOT_ID, eventType: LOT_EVENT_TYPES.STATUS_CHANGED, source: null,
  });
  assert(noSource === null, 'null source → null');

  const partialSource = buildLotEvent({
    lotId: FIXED_LOT_ID, eventType: LOT_EVENT_TYPES.STATUS_CHANGED,
    source: { scraper_version: 'firecrawl-json', house: 'hm' },  // missing writer
  });
  assert(partialSource === null, 'source missing writer → null');

  const missingHouse = buildLotEvent({
    lotId: FIXED_LOT_ID, eventType: LOT_EVENT_TYPES.STATUS_CHANGED,
    source: { scraper_version: 'firecrawl-json', writer: 'persist-lots.upsert' },
  });
  assert(missingHouse === null, 'source missing house → null');
}

// ── buildLotEvent — scrape_id is optional, other source keys mandatory ──
console.log('\nbuildLotEvent: scrape_id optional, defaults to null');
{
  const ev = buildLotEvent({
    lotId: FIXED_LOT_ID,
    eventType: LOT_EVENT_TYPES.STATUS_CHANGED,
    oldValue: { status: 'available' },
    newValue: { status: 'sold' },
    source: { scraper_version: 'post-auction-sweep', house: 'hm', writer: 'post-auction-sweep.persistOutcome' },
  });
  assert(ev !== null, 'accepts source without scrape_id');
  assert(ev.source.scrape_id === null, 'scrape_id defaulted to null');
}

// ── diffLotEvents — first contact ──────────────────────────────────────
console.log('\ndiffLotEvents: first contact emits lot_first_seen only');
{
  const evs = diffLotEvents({
    lotId: FIXED_LOT_ID,
    before: null,
    after: { status: 'available', price: 250000, sold_price: null, price_status: 'guide' },
    source: VALID_SOURCE,
  });
  assert(evs.length === 1, 'one event');
  assert(evs[0].event_type === 'lot_first_seen', 'lot_first_seen');
  assert(evs[0].old_value === null, 'old_value is null');
  assert(evs[0].new_value.price === 250000 && evs[0].new_value.price_status === 'guide',
    'new_value carries the snapshot');
}

// ── diffLotEvents — no changes ─────────────────────────────────────────
console.log('\ndiffLotEvents: identical before/after emits nothing');
{
  const lot = { status: 'available', price: 100000, sold_price: null, price_status: 'guide' };
  const evs = diffLotEvents({ lotId: FIXED_LOT_ID, before: lot, after: lot, source: VALID_SOURCE });
  assert(evs.length === 0, 'zero events for no-op');
}

// ── diffLotEvents — single-field changes ───────────────────────────────
console.log('\ndiffLotEvents: single-field changes emit one event each');
{
  const base = { status: 'available', price: 100000, sold_price: null, price_status: 'guide' };

  const statusOnly = diffLotEvents({
    lotId: FIXED_LOT_ID,
    before: base,
    after: { ...base, status: 'sold' },
    source: VALID_SOURCE,
  });
  assert(statusOnly.length === 1 && statusOnly[0].event_type === 'lot_status_changed',
    'status flip → lot_status_changed only');
  assert(statusOnly[0].old_value.status === 'available' && statusOnly[0].new_value.status === 'sold',
    'status payload carries old + new');

  const priceOnly = diffLotEvents({
    lotId: FIXED_LOT_ID,
    before: base,
    after: { ...base, price: 95000 },
    source: VALID_SOURCE,
  });
  assert(priceOnly.length === 1 && priceOnly[0].event_type === 'lot_price_changed',
    'price drop → lot_price_changed only');

  const soldPriceOnly = diffLotEvents({
    lotId: FIXED_LOT_ID,
    before: base,
    after: { ...base, sold_price: 110000 },
    source: VALID_SOURCE,
  });
  assert(soldPriceOnly.length === 1 && soldPriceOnly[0].event_type === 'lot_sold_price_set',
    'sold_price populated → lot_sold_price_set only');

  const priceStatusOnly = diffLotEvents({
    lotId: FIXED_LOT_ID,
    before: base,
    after: { ...base, price_status: 'poa' },
    source: VALID_SOURCE,
  });
  assert(priceStatusOnly.length === 1 && priceStatusOnly[0].event_type === 'lot_price_status_changed',
    'price_status flip → lot_price_status_changed only');
}

// ── diffLotEvents — multi-field changes ────────────────────────────────
console.log('\ndiffLotEvents: multi-field flip emits one event per field');
{
  const before = { status: 'available', price: 100000, sold_price: null, price_status: 'guide' };
  const after  = { status: 'sold',      price: 100000, sold_price: 115000, price_status: 'sold' };
  const evs = diffLotEvents({ lotId: FIXED_LOT_ID, before, after, source: VALID_SOURCE });

  assert(evs.length === 3, 'three events (status + sold_price + price_status)');
  const types = new Set(evs.map(e => e.event_type));
  assert(types.has('lot_status_changed'), 'includes lot_status_changed');
  assert(types.has('lot_sold_price_set'), 'includes lot_sold_price_set');
  assert(types.has('lot_price_status_changed'), 'includes lot_price_status_changed');
  assert(!types.has('lot_price_changed'), 'does NOT include lot_price_changed (price unchanged)');
}

// ── diffLotEvents — null / undefined normalisation ─────────────────────
console.log('\ndiffLotEvents: null and undefined treated equivalently');
{
  const before = { status: 'available', price: null, sold_price: undefined };
  const after  = { status: 'available', price: undefined, sold_price: null };
  const evs = diffLotEvents({ lotId: FIXED_LOT_ID, before, after, source: VALID_SOURCE });
  assert(evs.length === 0, 'null vs undefined → zero events');
}

// ── diffLotEvents — null → real value ──────────────────────────────────
console.log('\ndiffLotEvents: null → value fires (we finally know it)');
{
  const before = { status: 'available', price: null, sold_price: null, price_status: 'unknown' };
  const after  = { status: 'available', price: 100000, sold_price: null, price_status: 'guide' };
  const evs = diffLotEvents({ lotId: FIXED_LOT_ID, before, after, source: VALID_SOURCE });
  assert(evs.length === 2, 'two events — price and price_status');
  const priceEvt = evs.find(e => e.event_type === 'lot_price_changed');
  assert(priceEvt && priceEvt.old_value.price === null && priceEvt.new_value.price === 100000,
    'price event carries null → 100000');
}

// ── diffLotEvents — price_status independent of status ─────────────────
console.log('\ndiffLotEvents: price_status moves alone (key invariant for keeping it separate)');
{
  const evs = diffLotEvents({
    lotId: FIXED_LOT_ID,
    before: { status: 'available', price: null, sold_price: null, price_status: 'poa' },
    after:  { status: 'available', price: 250000, sold_price: null, price_status: 'guide' },
    source: VALID_SOURCE,
  });
  // status unchanged → no lot_status_changed
  const types = evs.map(e => e.event_type);
  assert(!types.includes('lot_status_changed'), 'no lot_status_changed when status unchanged');
  assert(types.includes('lot_price_status_changed'), 'lot_price_status_changed fires alone');
  assert(types.includes('lot_price_changed'), 'lot_price_changed fires alongside price_status flip');
}

// ── buildVanishedEvent ────────────────────────────────────────────────
console.log('\nbuildVanishedEvent: pairs with lot_status_changed in prune-vanished');
{
  const ev = buildVanishedEvent({ lotId: FIXED_LOT_ID, oldStatus: 'available', source: VALID_SOURCE });
  assert(ev !== null, 'returns a row');
  assert(ev.event_type === 'lot_vanished', 'event_type is lot_vanished');
  assert(ev.old_value.status === 'available', 'carries old status');
  assert(ev.new_value === null, 'new_value is null (lot is gone)');
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
