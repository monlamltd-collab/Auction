// tests/test-slug-normalisation.js — Defends canonicaliseHouseSlug against the
// display-name-leak bug that stranded 412 lots under 11 non-canonical "slugs".
import { canonicaliseHouseSlug } from '../lib/houses.js';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) {
    console.log(`✓ ${label}`);
    pass++;
  } else {
    console.log(`✗ ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    fail++;
  }
};

// Already-canonical slugs pass through unchanged
check('already a slug', canonicaliseHouseSlug('venmore'), 'venmore');
check('uppercase slug', canonicaliseHouseSlug('VENMORE'), 'venmore');

// All 11 leaked display names map to canonical slugs
check('Future Property Auctions',     canonicaliseHouseSlug('future property auctions'),    'futureauctions');
check('Butters John Bee',             canonicaliseHouseSlug('butters john bee'),            'buttersjohnbee');
check('Venmore Auctions',             canonicaliseHouseSlug('Venmore Auctions'),            'venmore');
check('Maggs & Allen',                canonicaliseHouseSlug('maggs & allen'),               'maggsandallen');
check('Knight Frank',                 canonicaliseHouseSlug('knight frank'),                'knightfrank');
check('John Francis',                 canonicaliseHouseSlug('john francis'),                'johnfrancis');
// 'SDL Auctions' is a SEPARATE house (slug 'sdlauctions') — registered by plan 4
// (onboarded 2026-06-22). Its display name now canonicalises to its own slug, NOT
// btgeddisons (the de-conflation guard against re-conflation).
check('SDL Auctions',                 canonicaliseHouseSlug('SDL Auctions'),                'sdlauctions');
check('Greenslade Taylor Hunt',       canonicaliseHouseSlug('greenslade taylor hunt'),      'gth');
check('Auction House West Midlands',  canonicaliseHouseSlug('Auction House West Midlands'), 'auctionhousewestmidlands');
check('Auction House East Midlands',  canonicaliseHouseSlug('Auction House East Midlands'), 'auctionhouseeastmidlands');
check('Scargill Mann',                canonicaliseHouseSlug('scargill mann'),               'scargillmann');

// Unknown / garbage returns null so caller refuses the persist
check('unknown name', canonicaliseHouseSlug('made up house'), null);
check('empty string', canonicaliseHouseSlug(''), null);
check('null input',   canonicaliseHouseSlug(null), null);
check('undefined',    canonicaliseHouseSlug(undefined), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
