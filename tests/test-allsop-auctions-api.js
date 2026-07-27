/**
 * Allsop auctions API → calendar entries
 * Run: node tests/test-allsop-auctions-api.js
 */
import {
  allsopAuctionDateToUkIso,
  entriesFromAllsopAuctionsPayload,
  ALLSOP_RESIDENTIAL_CATALOGUE_URL,
  ALLSOP_COMMERCIAL_CATALOGUE_URL,
} from '../lib/pipeline/allsop-auctions-api.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-27';

console.log('allsopAuctionDateToUkIso');
{
  // BST: 28 Jul 23:00Z → 29 Jul London
  assert(allsopAuctionDateToUkIso('2026-07-28T23:00:00.000000Z') === '2026-07-29', 'BST midnight edge → 29 Jul');
  assert(allsopAuctionDateToUkIso('2026-10-06T23:00:00.000000Z') === '2026-10-07', 'Oct commercial UK date');
  assert(allsopAuctionDateToUkIso(null) === null, 'null');
  assert(allsopAuctionDateToUkIso('garbage') === null, 'garbage');
}

console.log('\nentriesFromAllsopAuctionsPayload');
{
  const payload = {
    data: {
      next_residential_auction: {
        allsop_name: 'Residential - July- 2026',
        allsop_auctiondate: '2026-07-28T23:00:00.000000Z',
        allsop_auctionreference: 'R260730',
        lots_published: true,
        early_lots: true,
      },
      next_commercial_auction: {
        allsop_name: 'Commercial - October - 2026',
        allsop_auctiondate: '2026-10-06T23:00:00.000000Z',
        allsop_auctionreference: 'C261001',
        lots_published: false,
        early_lots: false,
      },
    },
    futureResi: {
      allsop_name: 'Residential - August 2026',
      allsop_auctiondate: '2026-08-19T23:00:00.000000Z',
      lots_published: false,
    },
    futureComm: null,
  };

  const entries = entriesFromAllsopAuctionsPayload(payload, { todayIso: TODAY });
  assert(entries.length === 3, 'three future sales');
  assert(entries[0].date === '2026-07-29', 'nearest resi UK date first');
  assert(entries[0].catalogueReady === true, 'published resi ready');
  assert(entries[0].url === ALLSOP_RESIDENTIAL_CATALOGUE_URL, 'resi catalogue url');
  assert(entries[0].source === 'allsop-auctions-api', 'source tag');
  assert(entries[1].date === '2026-08-20' || entries[1].date === '2026-08-19', 'aug future present');
  // Aug 19 23:00Z → Aug 20 London
  assert(entries.some((e) => e.date === '2026-08-20' && e.catalogueReady === false), 'aug not ready');
  const comm = entries.find((e) => e.url === ALLSOP_COMMERCIAL_CATALOGUE_URL);
  assert(!!comm && comm.catalogueReady === false, 'commercial not ready when unpublished');
  assert(comm.date === '2026-10-07', 'commercial UK date');

  const pastOnly = entriesFromAllsopAuctionsPayload({
    data: {
      next_residential_auction: {
        allsop_auctiondate: '2026-06-01T23:00:00.000000Z',
        lots_published: true,
      },
    },
  }, { todayIso: TODAY });
  assert(pastOnly.length === 0, 'past sales dropped');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
