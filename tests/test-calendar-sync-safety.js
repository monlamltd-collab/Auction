/** syncCalendar must reconcile, never invent always_on format or readiness. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { syncCalendar } = await import('../lib/pipeline/calendar-sync.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function fakeSupabase(rows) {
  const mutations = [];
  return {
    mutations,
    from(table) {
      return {
        select() {
          return { or: async () => ({ data: rows, error: null }) };
        },
        delete() {
          return { in: async (_column, ids) => { mutations.push({ kind: 'delete', table, ids }); return { error: null }; } };
        },
        update(payload) {
          return { eq: async (column, value) => { mutations.push({ kind: 'update', table, payload, column, value }); return { error: null }; } };
        },
        insert(payload) {
          mutations.push({ kind: 'insert', table, payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

console.log('missing traditional house is never manufactured as always_on');
{
  const db = fakeSupabase([]);
  await syncCalendar({ supabase: db });
  assert(!db.mutations.some(m => m.kind === 'insert'), 'no sentinel/always_on insert when active rows are absent');
}

console.log('\nMcHugh dated pre-publication row stays false');
{
  const db = fakeSupabase([{
    id: 1, house_slug: 'mchughandco', url: 'https://mchughandco.com/current-auction',
    status: 'upcoming', date: '2026-09-16', catalogue_ready: false,
  }]);
  await syncCalendar({ supabase: db });
  assert(db.mutations.length === 0, 'canonical root does not imply published or ready');
}

console.log('\nexisting always_on URL realignment preserves readiness');
{
  const db = fakeSupabase([{
    id: 2, house_slug: 'landwood', url: 'https://landwoodpropertyauctions.com/',
    status: 'always_on', date: '2099-12-31', catalogue_ready: false,
  }]);
  await syncCalendar({ supabase: db });
  const update = db.mutations.find(m => m.kind === 'update');
  assert(!!update, 'drifted always_on URL is still repaired');
  assert(update?.payload?.catalogue_ready === false, 'URL repair does not force catalogue_ready=true');
  assert(!Object.hasOwn(update?.payload || {}, 'status') && !Object.hasOwn(update?.payload || {}, 'date'), 'repair does not alter format or date');
}

console.log('\nshared rolling URL on distinct dates is preserved');
{
  const db = fakeSupabase([
    { id: 3, house_slug: 'mchughandco', url: 'https://mchughandco.com/current-auction', status: 'upcoming', date: '2026-09-16', catalogue_ready: false },
    { id: 4, house_slug: 'mchughandco', url: 'https://www.mchughandco.com/current-auction/', status: 'upcoming', date: '2026-10-21', catalogue_ready: false },
  ]);
  await syncCalendar({ supabase: db });
  assert(!db.mutations.some(m => m.kind === 'delete'), 'normalised URL match does not erase a distinct sale date');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
