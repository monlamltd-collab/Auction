/**
 * The always_on calendar placeholder must never become a lot's auction_date.
 *
 * calendar.js stamps rolling/timed catalogues '2099-12-31' — a CALENDAR marker
 * meaning "no fixed sale date". persist-lots used to fall through to it whenever
 * a lot carried no date of its own, which made the lot immortal: get_active_lots
 * gates on `auction_date >= current_date-1`, and a year-2099 date passes that
 * forever, so only the ghost sweep could ever retire the row (and that was
 * broken in prod until 2026-07-22).
 *
 * Measured 2026-07-22: 7,576 of 12,204 lots shown as live (62%) were live ONLY
 * via this sentinel; 3,014 of those had been unseen >4 days — dead stock held
 * visible by a fake date.
 *
 * NULL is the honest value and already the downstream semantics (routes/search.js
 * nulls anything > '2098-01-01' on read). These tests pin the precedence rule:
 *   bullets → recogniser/scraper _auctionDate → calendar date (real dates only).
 *
 * Run: node tests/test-auction-date-sentinel.js
 */

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// The exact precedence expression shipped in lib/pipeline/persist-lots.js.
// Mirrored here so the RULE is pinned even as the surrounding function evolves.
function resolveLotAuctionDate({ bulletDate = null, scraperDate = null, calendarDate = null }) {
  const calendar = (calendarDate && calendarDate > '2098-01-01') ? null : calendarDate;
  return bulletDate || scraperDate || calendar || null;
}

const SENTINEL = '2099-12-31';

console.log('auction_date precedence — the always_on sentinel must never reach a lot');

// ── The bug this fixes ──
assert(resolveLotAuctionDate({ calendarDate: SENTINEL }) === null,
  'lot with no date of its own does NOT inherit the 2099 sentinel (gets null)');
assert(resolveLotAuctionDate({ calendarDate: '2099-01-01' }) === null,
  'any far-future placeholder (>2098) is treated as no-date, not just 2099-12-31');

// ── Real calendar dates still flow through ──
assert(resolveLotAuctionDate({ calendarDate: '2026-08-24' }) === '2026-08-24',
  'a REAL calendar date is still inherited');
assert(resolveLotAuctionDate({ calendarDate: '2026-07-01' }) === '2026-07-01',
  'a real PAST calendar date is still inherited (expiry must still work)');

// ── Precedence is unchanged ──
assert(resolveLotAuctionDate({ bulletDate: '2026-09-16', scraperDate: '2026-09-01', calendarDate: '2026-08-01' }) === '2026-09-16',
  'bullets win over scraper and calendar');
assert(resolveLotAuctionDate({ scraperDate: '2026-09-01', calendarDate: '2026-08-01' }) === '2026-09-01',
  'scraper/recogniser date wins over calendar');
assert(resolveLotAuctionDate({ bulletDate: '2026-09-16', calendarDate: SENTINEL }) === '2026-09-16',
  'a real bullet date still wins even when the calendar is the sentinel');
assert(resolveLotAuctionDate({ scraperDate: '2026-09-16', calendarDate: SENTINEL }) === '2026-09-16',
  'a real recogniser date still wins over the sentinel (EIG per-lot end times)');

// ── No date anywhere ──
assert(resolveLotAuctionDate({}) === null, 'no date anywhere → null, never a placeholder');

// ── The invariant, stated plainly ──
for (const d of [SENTINEL, '2098-06-01', '2200-01-01']) {
  assert(resolveLotAuctionDate({ calendarDate: d }) === null, `placeholder ${d} never becomes a lot auction_date`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
