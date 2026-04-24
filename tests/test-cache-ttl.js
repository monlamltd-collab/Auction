/**
 * Cache TTL Test Suite
 * ====================
 * Tests getCacheTTL(houseKey, auctionDate?). Pure function, no DB.
 * Run: node tests/test-cache-ttl.js
 */

import { getCacheTTL } from '../lib/config.js';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, msg) {
  if (actual === expected) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg} — expected ${expected}, got ${actual}`);
    failed++;
  }
}

const HOUR = 3600000;
const now = Date.now();

// ── Tier-only (no auctionDate) ──
console.log('\n--- Tier-only behaviour ---');
assertEqual(getCacheTTL('allsop'), 12 * HOUR, 'high tier (allsop) → 12h');
assertEqual(getCacheTTL('cliveemson'), 18 * HOUR, 'medium tier (cliveemson) → 18h');
assertEqual(getCacheTTL('unknown'), 24 * HOUR, 'low tier (unknown) → 24h');
assertEqual(getCacheTTL('allsop', undefined), 12 * HOUR, 'undefined auctionDate → tier default');
assertEqual(getCacheTTL('allsop', null), 12 * HOUR, 'null auctionDate → tier default');

// ── Future auction > 48h: no cap ──
console.log('\n--- Future auction > 48h ---');
const in5Days = new Date(now + 5 * 24 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', in5Days), 12 * HOUR, 'high tier, 5d out → 12h (uncapped)');
assertEqual(getCacheTTL('cliveemson', in5Days), 18 * HOUR, 'medium tier, 5d out → 18h (uncapped)');
const in49h = new Date(now + 49 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', in49h), 12 * HOUR, 'high tier, 49h out → 12h (just outside window)');

// ── Near auction < 48h: capped at 2h ──
console.log('\n--- Near auction < 48h ---');
const in30h = new Date(now + 30 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', in30h), 2 * HOUR, 'high tier, 30h out → 2h (capped)');
assertEqual(getCacheTTL('cliveemson', in30h), 2 * HOUR, 'medium tier, 30h out → 2h (capped)');
assertEqual(getCacheTTL('unknown', in30h), 2 * HOUR, 'low tier, 30h out → 2h (capped)');
const in1h = new Date(now + 1 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', in1h), 2 * HOUR, 'high tier, 1h out → 2h (capped)');

// ── Past auction: no cap (finished auctions are irrelevant) ──
console.log('\n--- Past auction ---');
const yesterday = new Date(now - 24 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', yesterday), 12 * HOUR, 'high tier, 1d ago → 12h (past, no cap)');

// ── Boundary conditions ──
// The near-auction check uses strict `<` comparison, so exactly 48h → no cap.
console.log('\n--- Boundaries ---');
const in48hExact = new Date(now + 48 * HOUR + 1000).toISOString(); // +1s to absorb Date.now drift inside fn
assertEqual(getCacheTTL('allsop', in48hExact), 12 * HOUR, '48h exactly → tier default (not capped, strict <)');
const justInside = new Date(now + 47 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', justInside), 2 * HOUR, '47h out → 2h (inside window)');

// ── Invalid inputs: fall through to tier default, never throw ──
console.log('\n--- Invalid inputs ---');
assertEqual(getCacheTTL('allsop', 'not-a-date'), 12 * HOUR, 'invalid string → tier default');
assertEqual(getCacheTTL('allsop', ''), 12 * HOUR, 'empty string → tier default (falsy, skips check)');
assertEqual(getCacheTTL('allsop', new Date('garbage')), 12 * HOUR, 'invalid Date (NaN) → tier default');

// ── Accepts Date and string ──
console.log('\n--- Input types ---');
assertEqual(getCacheTTL('allsop', new Date(now + 30 * HOUR)), 2 * HOUR, 'Date instance, 30h out → 2h');
assertEqual(getCacheTTL('allsop', '2099-01-01'), 12 * HOUR, 'ISO date string, far future → 12h');

// ── Summary ──
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All cache-TTL tests passed!');
