/**
 * Platform family discovery resolver (Task 6)
 * Run: node tests/test-platform-discovery.js
 */
import {
  resolveDiscoveryConfig,
  listWatchableSlugs,
  looksLikeEigRoot,
  isAuctionWatcherExpandEnabled,
  ahFamilyConfig,
  eigFamilyConfig,
} from '../lib/pipeline/platform-discovery.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('explicit wins');
{
  const cfg = resolveDiscoveryConfig('savills', {
    explicit: { homepage: 'https://auctions.savills.co.uk/upcoming-auctions' },
    ahSlugs: new Set(['savills']),
  });
  assert(cfg.source === 'explicit', 'explicit source');
  assert(cfg.familyAuto === false, 'not family auto');
}

console.log('\nAH family');
{
  const cfg = resolveDiscoveryConfig('auctionhousenorthwest', {
    explicit: null,
    ahSlugs: new Set(['auctionhousenorthwest']),
    houseRoots: { auctionhousenorthwest: 'https://www.auctionhouse.co.uk/northwest/' },
  });
  assert(cfg && cfg.platform === 'auctionhouse-uk', 'AH platform');
  assert(cfg.source === 'family:ah', 'AH source');
  assert(cfg.familyAuto === true, 'family auto');
}

console.log('\nEIG family by root heuristic');
{
  assert(looksLikeEigRoot('https://www.maggsandallen.co.uk/search-auction/') === true, 'eig root');
  assert(looksLikeEigRoot('https://www.example.com/current') === false, 'non-eig');
  const cfg = resolveDiscoveryConfig('eiggy', {
    houseRoots: { eiggy: 'https://www.eiggy.co.uk/search-auction/' },
  });
  assert(cfg && cfg.platform === 'eig-whitelabel', 'eig platform');
  assert(typeof cfg.buildUrl === 'function', 'buildUrl present');
  const u = cfg.buildUrl('may');
  assert(u.includes('search-auction-may'), 'month slug url');
}

console.log('\nEIG fingerprint');
{
  const cfg = resolveDiscoveryConfig('finger', {
    houseRoots: { finger: 'https://finger.example/' },
    htmlFingerprints: { eig: true },
  });
  assert(cfg && cfg.source === 'family:eig', 'fingerprint eig');
}

console.log('\nexpand disabled');
{
  const cfg = resolveDiscoveryConfig('auctionhousenorthwest', {
    ahSlugs: new Set(['auctionhousenorthwest']),
    houseRoots: { auctionhousenorthwest: 'https://www.auctionhouse.co.uk/northwest/' },
    expandEnabled: false,
  });
  assert(cfg === null, 'no family when expand off');
}

console.log('\nlistWatchableSlugs');
{
  const slugs = listWatchableSlugs({
    explicitMap: { savills: {}, maggsandallen: {} },
    ahSlugs: ['auctionhousenorthwest', 'auctionhousekent', 'savills'],
    houseRoots: {
      savills: 'https://x',
      maggsandallen: 'https://y/search-auction/',
      auctionhousenorthwest: 'https://www.auctionhouse.co.uk/northwest/',
      auctionhousekent: 'https://www.auctionhouse.co.uk/kent/',
      retiredish: 'https://www.auctionhouse.co.uk/x/',
      puremmoa: 'https://pure.example/current',
    },
    retired: ['retiredish'],
    expandEnabled: true,
  });
  assert(slugs.includes('savills'), 'explicit included');
  assert(slugs.includes('auctionhousenorthwest'), 'AH auto');
  assert(slugs.includes('auctionhousekent'), 'AH auto 2');
  assert(!slugs.includes('retiredish'), 'retired excluded');
  assert(!slugs.includes('puremmoa'), 'pure mmoa root not auto-enrolled without signal');
  // maggs is explicit already
  assert(new Set(slugs).size === slugs.length, 'deduped');
}

console.log('\nflag');
{
  assert(isAuctionWatcherExpandEnabled({}) === true, 'default on');
  assert(isAuctionWatcherExpandEnabled({ AUCTION_WATCHER_EXPAND_ENABLED: 'false' }) === false, 'off');
  assert(isAuctionWatcherExpandEnabled({ AUCTION_WATCHER_EXPAND_ENABLED: 'true' }) === true, 'on');
}

console.log('\nhelpers');
assert(ahFamilyConfig('x').platform === 'auctionhouse-uk', 'ah helper');
assert(eigFamilyConfig('x', 'https://h.example/').platform === 'eig-whitelabel', 'eig helper');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
