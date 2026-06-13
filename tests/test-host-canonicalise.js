// tests/test-host-canonicalise.js — Defends canonicaliseHouseHost against the
// 2026-06-13 incident's calendar layer: the DB trigger trg_normalise_calendar_url
// strips `www.` and trailing slashes from every auction_calendar URL, but Hollis
// Morgan and Maggs & Allen only serve their catalogue on the www host (the bare
// host renders a lot-less stub) and the slashless /search-auction path 404s/stubs.
// Detail-page hrefs inherit the request host, so a bare-host scrape produced
// no-www hrefs that the recognisers (anchored on the real host) couldn't match.
// The trigger can't be relaxed without breaking dedup, so we re-canonicalise at
// scrape time — the one layer downstream of the trigger.
import { canonicaliseHouseHost } from '../lib/houses.js';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) { console.log(`✓ ${label}`); pass++; }
  else { console.log(`✗ ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); fail++; }
};

// Hollis: bare host + slashless path (the calendar-stored shape) → www + slash
check('hollis bare bid= url gains www',
  canonicaliseHouseHost('https://hollismorgan.co.uk/search-auction/?bid=11&showstc=on', 'hollismorgan'),
  'https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on');
check('hollis bare slashless search-auction gains www + slash',
  canonicaliseHouseHost('https://hollismorgan.co.uk/search-auction', 'hollismorgan'),
  'https://www.hollismorgan.co.uk/search-auction/');

// Maggs: same treatment
check('maggs bare slashless search-auction gains www + slash',
  canonicaliseHouseHost('https://maggsandallen.co.uk/search-auction', 'maggsandallen'),
  'https://www.maggsandallen.co.uk/search-auction/');
check('maggs bare auction= url gains www, query untouched',
  canonicaliseHouseHost('https://maggsandallen.co.uk/search-auction/?auction=3&n=0', 'maggsandallen'),
  'https://www.maggsandallen.co.uk/search-auction/?auction=3&n=0');

// Idempotent: already-www URLs pass through unchanged
check('hollis already www is unchanged',
  canonicaliseHouseHost('https://www.hollismorgan.co.uk/search-auction/', 'hollismorgan'),
  'https://www.hollismorgan.co.uk/search-auction/');

// Only the slashless /search-auction path gets a trailing slash — deeper paths
// (and paths that already end in a slash) are left alone.
check('maggs deeper path keeps its shape (just www)',
  canonicaliseHouseHost('https://maggsandallen.co.uk/auctions/bristol-auctioneers.html', 'maggsandallen'),
  'https://www.maggsandallen.co.uk/auctions/bristol-auctioneers.html');

// Houses not in the www-canonical set are never touched.
check('non-listed house is untouched',
  canonicaliseHouseHost('https://pattinson.co.uk/auction/property-search', 'pattinson'),
  'https://pattinson.co.uk/auction/property-search');

// Robustness: junk input never throws, returns input.
check('null url returns null', canonicaliseHouseHost(null, 'hollismorgan'), null);
check('garbage url returns input', canonicaliseHouseHost('not a url', 'hollismorgan'), 'not a url');

// Wrong-domain url for a listed house is left alone (defensive — only rewrite
// the host when it actually belongs to that house).
check('foreign domain for listed house untouched',
  canonicaliseHouseHost('https://example.com/x', 'hollismorgan'),
  'https://example.com/x');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
