/**
 * Loveitts HTML → calendar entries
 * Run: node tests/test-loveitts-auctions.js
 */
import {
  toIsoDate,
  loveittsTimestampToIsoDate,
  collectLoveittsAuctionDates,
  entriesFromLoveittsHtml,
  LOVEITTS_CATALOGUE_URL,
} from '../lib/pipeline/loveitts-auctions.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-27';

console.log('toIsoDate / loveittsTimestampToIsoDate');
{
  assert(toIsoDate(2026, 7, 28) === '2026-07-28', 'numeric parts');
  assert(toIsoDate('2026', '08', '04') === '2026-08-04', 'string parts pad');
  assert(toIsoDate(2026, 13, 1) === null, 'bad month');
  assert(loveittsTimestampToIsoDate('2026-07-28 11:00:00') === '2026-07-28', 'space ts');
  assert(loveittsTimestampToIsoDate('2026-09-10T18:30:00') === '2026-09-10', 'T ts');
  assert(loveittsTimestampToIsoDate(null) === null, 'null ts');
}

const FIXTURE = `
<select name="auction_date_filter">
  <option selected="selected" value="">Select Auction Date</option>
  <option value="2026-07-28 11:00:00">2026-07-28 11:00:00</option>
  <option value="2026-08-04 11:00:00">2026-08-04 11:00:00</option>
  <option value="2026-08-11 11:00:00">2026-08-11 11:00:00</option>
  <option value="2026-09-10 18:30:00">2026-09-10 18:30:00</option>
</select>
<a href="/auctions/upcoming-auctions/152" class="btn">View lot list</a>
Date: Tuesday 4th Aug 2026 Start: 11:00 am
<a href="/auctions/upcoming-auctions/153" class="btn">View lot list</a>
Date: Tuesday 11th Aug 2026 Start: 11:00 am
<span class="js-enter-lot-trigger" data-date="2026-07-28 11:00:00"></span>
<input name="auction_date" type="hidden" value="2026-06-01 11:00:00">
`;

console.log('\ncollectLoveittsAuctionDates');
{
  const map = collectLoveittsAuctionDates(FIXTURE, { todayIso: TODAY });
  assert(map.has('2026-07-28'), 'jul 28 present');
  assert(map.has('2026-08-04'), 'aug 4 present');
  assert(map.has('2026-08-11'), 'aug 11 present');
  assert(map.has('2026-09-10'), 'sep 10 present');
  assert(!map.has('2026-06-01'), 'past hidden date dropped');
  assert(map.get('2026-08-04').saleIds.has('152'), 'sale id 152 on aug 4');
  assert(map.get('2026-07-28').sources.has('option'), 'option source');
  assert(map.get('2026-07-28').sources.has('data-date'), 'data-date source');
}

console.log('\nentriesFromLoveittsHtml');
{
  const entries = entriesFromLoveittsHtml(FIXTURE, { todayIso: TODAY });
  assert(entries.length === 4, `four future sales (got ${entries.length})`);
  assert(entries[0].date === '2026-07-28', 'soonest first');
  assert(entries.every((e) => e.url === LOVEITTS_CATALOGUE_URL), 'catalogue url pinned');
  assert(entries.every((e) => e.source === 'loveitts-auctions-html'), 'source tag');
  assert(entries.every((e) => e.catalogueReady === true), 'published dates ready');
  const aug4 = entries.find((e) => e.date === '2026-08-04');
  assert(!!aug4 && aug4.title.includes('#152'), 'title carries sale id');

  const pastOnly = entriesFromLoveittsHtml(
    '<option value="2026-01-01 11:00:00">old</option>',
    { todayIso: TODAY },
  );
  assert(pastOnly.length === 0, 'past-only html → empty');

  const empty = entriesFromLoveittsHtml('', { todayIso: TODAY });
  assert(empty.length === 0, 'empty html');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
