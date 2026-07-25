/**
 * Safe calendar entry helpers (Task 3).
 * Run: node tests/test-calendar-entries.js
 */
import {
  isRealCalendarDate,
  shouldRetireCalendarRow,
  pickRowsToRetire,
  buildUpcomingCatalogueRow,
  upsertUpcomingCatalogue,
  retirePastUpcomingRows,
} from '../lib/pipeline/calendar-entries.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-25';

console.log('isRealCalendarDate');
assert(isRealCalendarDate('2026-08-01') === true, 'real date');
assert(isRealCalendarDate('2099-12-31') === false, 'sentinel rejected');
assert(isRealCalendarDate(null) === false, 'null rejected');
assert(isRealCalendarDate('nope') === false, 'junk rejected');

console.log('\nshouldRetireCalendarRow / pickRowsToRetire');
{
  assert(shouldRetireCalendarRow({ status: 'always_on', date: '2020-01-01' }, { todayIso: TODAY }) === false,
    'always_on never retires');
  assert(shouldRetireCalendarRow({ status: 'upcoming', date: '2026-07-24' }, { todayIso: TODAY }) === true,
    'past upcoming retires');
  assert(shouldRetireCalendarRow({ status: 'upcoming', date: TODAY }, { todayIso: TODAY }) === false,
    'today upcoming stays');
  assert(shouldRetireCalendarRow({ status: 'upcoming', date: '2026-08-01' }, { todayIso: TODAY }) === false,
    'future stays');
  assert(shouldRetireCalendarRow({ status: 'upcoming', date: '2099-12-31' }, { todayIso: TODAY }) === false,
    'sentinel upcoming not retired via this helper');
  assert(shouldRetireCalendarRow({ status: 'past', date: '2026-01-01' }, { todayIso: TODAY }) === false,
    'already past skipped');
  assert(shouldRetireCalendarRow({ status: 'merged', date: '2026-01-01' }, { todayIso: TODAY }) === false,
    'merged skipped');

  const picked = pickRowsToRetire([
    { id: '1', status: 'always_on', date: '2020-01-01' },
    { id: '2', status: 'upcoming', date: '2026-07-01' },
    { id: '3', status: 'upcoming', date: '2026-08-01' },
    { id: '4', status: 'upcoming', date: '2099-12-31' },
  ], { todayIso: TODAY });
  assert(picked.length === 1 && picked[0].id === '2', 'only real past upcoming picked');
}

console.log('\nbuildUpcomingCatalogueRow');
{
  const bad = buildUpcomingCatalogueRow({ slug: 'x', url: 'https://x.com/a' });
  assert(bad.ok === false && bad.reason === 'missing_or_invalid_date', 'requires date by default');

  const sent = buildUpcomingCatalogueRow({
    slug: 'x', url: 'https://x.com/a', date: '2099-12-31',
  });
  assert(sent.ok === false, 'rejects sentinel date');

  const ok = buildUpcomingCatalogueRow({
    slug: 'savills',
    url: 'https://auctions.savills.co.uk/auctions/1-september-2026',
    date: '2026-09-01',
    title: '1 Sep',
    catalogueReady: true,
    source: 'test',
  });
  assert(ok.ok === true, 'builds row');
  assert(ok.row.status === 'upcoming', 'status upcoming');
  assert(ok.row.house_slug === 'savills', 'slug set');
  assert(ok.row.date === '2026-09-01', 'date set');
  assert(ok.row.catalogue_ready === true, 'ready true');

  const fb = buildUpcomingCatalogueRow({
    slug: 'x',
    url: 'https://x.com/a',
    allowDateFallback: true,
    fallbackDate: '2026-08-24',
  });
  assert(fb.ok === true && fb.row.date === '2026-08-24', 'fallback date allowed when opted in');
}

console.log('\nupsertUpcomingCatalogue dryRun + mock supabase');
{
  const dry = await upsertUpcomingCatalogue(null, {
    slug: 'savills',
    url: 'https://example.com/cat',
    date: '2026-08-18',
    dryRun: true,
  });
  assert(dry.ok === true && dry.action === 'dry_run', 'dry run ok without supabase');

  const calls = [];
  const mock = {
    from(table) {
      assert(table === 'auction_calendar', 'touches auction_calendar');
      return {
        select() {
          return {
            eq() { return this; },
            limit: async () => ({ data: [], error: null }),
          };
        },
        upsert: async (row, opts) => {
          calls.push({ row, opts });
          return { error: null };
        },
      };
    },
  };
  // Patch select chain more completely
  const mock2 = {
    from() {
      const api = {
        select() { return api; },
        eq() { return api; },
        limit: async () => ({ data: [], error: null }),
        upsert: async (row, opts) => {
          calls.push({ row, opts });
          return { error: null };
        },
      };
      return api;
    },
  };
  const res = await upsertUpcomingCatalogue(mock2, {
    slug: 'savills',
    url: 'https://example.com/cat',
    date: '2026-08-18',
    catalogueReady: true,
    source: 'unit',
    invalidateCache: false,
  });
  assert(res.ok === true && res.action === 'upserted', 'upserted');
  assert(calls.length === 1, 'one upsert call');
  assert(calls[0].opts.onConflict === 'url,date', 'conflict url,date');
  assert(calls[0].row.status === 'upcoming', 'wrote upcoming');
  assert(!('_source' in calls[0].row), 'internal source stripped');

  // house+date different URL blocks
  const mockBlock = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        limit: async () => ({
          data: [{ id: 'x', url: 'https://other.com/a', status: 'upcoming' }],
          error: null,
        }),
        upsert: async () => {
          throw new Error('should not upsert');
        },
      };
    },
  };
  const blocked = await upsertUpcomingCatalogue(mockBlock, {
    slug: 'savills',
    url: 'https://example.com/cat',
    date: '2026-08-18',
    invalidateCache: false,
  });
  assert(blocked.ok === false && blocked.reason === 'house_date_exists_different_url', 'blocks date collision');
}

console.log('\nretirePastUpcomingRows dryRun + mock');
{
  const dry = await retirePastUpcomingRows(null, { todayIso: TODAY, dryRun: true });
  // no supabase + dryRun still returns structure (considered 0)
  assert(dry.ok === true && dry.dryRun === true, 'retire dry without client');

  let updatedIds = null;
  const mock = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        lt() { return this; },
        gt() { return this; },
        limit: async () => ({
          data: [
            { id: 'a', status: 'upcoming', date: '2026-07-01' },
            { id: 'b', status: 'upcoming', date: '2026-08-01' },
            { id: 'c', status: 'always_on', date: '2020-01-01' }, // filter shouldn't return this, but if it did...
          ],
          error: null,
        }),
        update(payload) {
          assert(payload.status === 'past', 'sets past');
          return {
            in(_col, ids) {
              updatedIds = ids;
              return {
                eq: async (col, val) => {
                  assert(col === 'status' && val === 'upcoming', 'update constrained to upcoming');
                  return { error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  const res = await retirePastUpcomingRows(mock, {
    todayIso: TODAY,
    dryRun: false,
    invalidateCache: false,
  });
  assert(res.ok === true, 'retire ok');
  assert(res.retired === 1, 'one retired');
  assert(Array.isArray(updatedIds) && updatedIds.includes('a') && !updatedIds.includes('b'), 'only past id');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
