/**
 * Tests for selectAuctionsPerHouse in lib/analysis.js — which catalogue-ready
 * auctions survive the MAX_AUCTIONS_PER_HOUSE lookahead budget.
 *
 * The bug this locks (2026-07-22): the old code sorted every row by date and
 * sliced the nearest N. `always_on` rows carry a 2099-12-31 sentinel date, so
 * they always sorted LAST — meaning two stale dated rows could starve a house's
 * only lot-bearing URL out of the scrape queue.
 *
 * suttonkersh went fully dark that way: a dated 404 and a dated 0-lot hub page
 * outranked the always_on gallery holding all 16 live lots. Health 0, circuit
 * open, last_success NULL — with a completely healthy extractor.
 *
 * Run: node tests/test-calendar-selection.js
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { selectAuctionsPerHouse } = await import('../lib/analysis.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const urls = (rows) => rows.map(r => r.url);

console.log('Test 1: the real suttonkersh shape — always_on must survive');
{
  const byHouse = {
    suttonkersh: [
      { url: '/auctions/current-auction-lots', date: '2026-07-16', status: 'upcoming' }, // 404
      { url: '/auctions-property', date: '2026-07-16', status: 'upcoming' },             // 0 lots
      { url: '/properties/gallery/?section=auction', date: '2099-12-31', status: 'always_on' }, // 16 lots
    ],
  };
  const { ready, skipped } = selectAuctionsPerHouse(byHouse, 2);
  assert(urls(ready).includes('/properties/gallery/?section=auction'),
    'the always_on gallery (the only lot-bearing URL) is scraped');
  assert(ready.length === 2, `budget of 2 respected (got ${ready.length})`);
  assert(skipped.length === 1 && skipped[0].house === 'suttonkersh',
    'the surplus dated row is reported as skipped');
}

console.log('\nTest 2: budget is not inflated by always_on');
{
  const byHouse = {
    h: [
      { url: 'a', date: '2026-08-01', status: 'upcoming' },
      { url: 'b', date: '2026-08-09', status: 'upcoming' },
      { url: 'c', date: '2026-08-20', status: 'upcoming' },
      { url: 'evergreen', date: '2099-12-31', status: 'always_on' },
    ],
  };
  const { ready, skipped } = selectAuctionsPerHouse(byHouse, 2);
  assert(ready.length === 2, `still only 2 scrapes (got ${ready.length})`);
  assert(urls(ready).includes('evergreen'), 'always_on kept');
  assert(urls(ready).includes('a'), 'nearest dated sale fills the remaining slot');
  assert(skipped.length === 2, 'the two further-out sales are skipped and logged');
}

console.log('\nTest 3: no always_on — nearest dated rows win, as before');
{
  const byHouse = {
    h: [
      { url: 'far', date: '2026-12-01', status: 'upcoming' },
      { url: 'near', date: '2026-07-25', status: 'upcoming' },
      { url: 'mid', date: '2026-09-01', status: 'upcoming' },
    ],
  };
  const { ready } = selectAuctionsPerHouse(byHouse, 2);
  assert(JSON.stringify(urls(ready)) === JSON.stringify(['near', 'mid']),
    `nearest-two ordering preserved (got ${JSON.stringify(urls(ready))})`);
}

console.log('\nTest 4: two always_on rows both survive, dated rows yield');
{
  const byHouse = {
    h: [
      { url: 'ev1', date: '2099-12-31', status: 'always_on' },
      { url: 'ev2', date: '2099-12-31', status: 'always_on' },
      { url: 'dated', date: '2026-08-01', status: 'upcoming' },
    ],
  };
  const { ready, skipped } = selectAuctionsPerHouse(byHouse, 2);
  assert(urls(ready).sort().join(',') === 'ev1,ev2', 'both evergreen catalogues kept');
  assert(skipped.length === 1 && skipped[0].auction.url === 'dated', 'dated row skipped');
}

console.log('\nTest 5: houses are independent + nothing is silently dropped');
{
  const byHouse = {
    a: [{ url: 'a1', date: '2026-08-01', status: 'upcoming' }],
    b: [
      { url: 'b1', date: '2026-08-01', status: 'upcoming' },
      { url: 'b2', date: '2026-08-02', status: 'upcoming' },
      { url: 'b3', date: '2026-08-03', status: 'upcoming' },
    ],
  };
  const { ready, skipped } = selectAuctionsPerHouse(byHouse, 2);
  assert(ready.length === 3 && skipped.length === 1, 'a:1 kept, b:2 kept + 1 skipped');
  assert(ready.length + skipped.length === 4, 'every input row is accounted for (kept or logged)');
  assert(skipped[0].auction.url === 'b3', 'the furthest-out row is the one dropped');
}

console.log('\nTest 6: empty input');
{
  const { ready, skipped } = selectAuctionsPerHouse({}, 2);
  assert(ready.length === 0 && skipped.length === 0, 'no houses → nothing selected, no crash');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
