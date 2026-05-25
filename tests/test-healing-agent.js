/**
 * Healing-agent smoke tests
 * =========================
 * Verifies the Gemini → Firecrawl FIRE-1 swap in lib/pipeline/healing.js and
 * lib/pipeline/auction-watcher.js. Module-level `supabase` makes mocking the
 * full healBrokenHouse flow infeasible without a test harness; instead we:
 *   1. Import both modules and assert their public exports still resolve
 *   2. Verify initWatcher accepts the new agentExtract-shaped signature
 *      (and falls back to the default when agentExtract is omitted)
 *   3. Verify healBrokenHouse short-circuits cleanly when called with the
 *      slimmed deps shape (no callAI key required any more)
 *
 * Real end-to-end coverage lives in the verification plan (E2E heal against
 * maggsandallen / bondwolfe). This file catches import-time breakage and
 * signature regressions.
 *
 * Run: node tests/test-healing-agent.js
 */

// Supply harmless fake env vars BEFORE the dynamic imports so lib/supabase.js
// can construct its singleton client. The tests never issue a real API call
// against this client — they exercise short-circuit branches only.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://test.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const {
  healBrokenHouse,
  getHealingState,
  clearHealingCooldown,
  isJunkSearchUrl,
  _fire1RecentlyCalled,
  _fire1MarkCalled,
  _resetFire1DedupForTests,
} = await import('../lib/pipeline/healing.js');
const { initWatcher } = await import('../lib/pipeline/auction-watcher.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── Test 1: healing.js public exports ───────────────────────────
console.log('Test 1: healing.js exports');
{
  assert(typeof healBrokenHouse === 'function', 'healBrokenHouse is a function');
  assert(typeof getHealingState === 'function', 'getHealingState is a function');
  assert(typeof clearHealingCooldown === 'function', 'clearHealingCooldown is a function');
}

// ── Test 2: initWatcher accepts new agentExtract signature ──────
console.log('\nTest 2: initWatcher accepts {agentExtract, ...} without throwing');
{
  let threw = false;
  try {
    initWatcher({
      scrapeWithFirecrawl: async () => ({ html: '' }),
      agentExtract: async () => ({ auctions: [] }),
      fireAlert: async () => {},
      budget: { canUseFirecrawl: () => true },
    });
  } catch { threw = true; }
  assert(!threw, 'initWatcher with agentExtract dep does not throw');
}

// ── Test 3: initWatcher tolerates omitted agentExtract (uses default) ─
console.log('\nTest 3: initWatcher tolerates omitted agentExtract (default import)');
{
  let threw = false;
  try {
    initWatcher({
      scrapeWithFirecrawl: async () => ({ html: '' }),
      fireAlert: async () => {},
      budget: { canUseFirecrawl: () => true },
    });
  } catch { threw = true; }
  assert(!threw, 'initWatcher without agentExtract dep does not throw');
}

// ── Test 4: healBrokenHouse short-circuits on missing FIRECRAWL_API_KEY ─
// Confirms the dep shape no longer requires callAI — the early-return at the
// top of healBrokenHouse should fire on missing FIRECRAWL_API_KEY alone.
console.log('\nTest 4: healBrokenHouse short-circuits on missing API key');
{
  const result = await healBrokenHouse('nonexistent-slug', 'https://example.com/old', {
    FIRECRAWL_API_KEY: undefined,
    scrapeWithFirecrawl: async () => ({ html: '' }),
    HEADERS: {},
  });
  assert(result === null, 'returns null when FIRECRAWL_API_KEY missing');
}

// ── Test 5: clearHealingCooldown is a no-op on unknown slug ─────
console.log('\nTest 5: clearHealingCooldown is safe on unknown slug');
{
  let threw = false;
  try { clearHealingCooldown('definitely-not-a-real-slug'); } catch { threw = true; }
  assert(!threw, 'clearHealingCooldown on unknown slug does not throw');
}

// ── Test 6: healBrokenHouse honours MAX_HEAL_ATTEMPTS lifetime cap ──
// Pre-seed _healingState with attempts AT the cap (8); the next call computes
// attempts = 9 > MAX (8) and must short-circuit before any Firecrawl call.
// This is the credit-protection guarantee for permanently-dead houses.
console.log('\nTest 6: healBrokenHouse honours MAX_HEAL_ATTEMPTS cap (no Firecrawl call)');
{
  const CAP_SLUG = 'cap-test-slug';
  const state = getHealingState();
  state.set(CAP_SLUG, { lastAttempt: Date.now(), attempts: 8, cooldownUntil: 0 });
  let firecrawlCalled = false;
  const result = await healBrokenHouse(CAP_SLUG, 'https://example.invalid/old', {
    FIRECRAWL_API_KEY: 'test-key',
    scrapeWithFirecrawl: async () => { firecrawlCalled = true; return { html: '' }; },
    HEADERS: {},
  });
  assert(result === null, 'returns null when at the cap');
  assert(!firecrawlCalled, 'no Firecrawl call when capped');
  state.delete(CAP_SLUG);
}

// ── Test 7: isJunkSearchUrl rejects social/video/PDF surfaces ───
console.log('\nTest 7: isJunkSearchUrl filters obvious non-catalogue URLs');
{
  const junk = [
    'https://www.facebook.com/groups/kiwifirsthomebuyers/posts/9504255699594706/',
    'https://www.facebook.com/AuctionBids/',
    'https://www.facebook.com/www.247propertyauctions.co.uk/',
    'https://youtu.be/abc123',
    'https://www.youtube.com/watch?v=xyz',
    'https://www.linkedin.com/company/maggsandallen',
    'https://www.instagram.com/maggsandallen/',
    'https://en.wikipedia.org/wiki/Allsop',
    'https://ahl.stagingenv.cloud/wp-content/uploads/2026/05/9400050-AHL-Catalogue.pdf',
    'https://example.com/catalogue.pdf?download=1',
    'https://more-homes.paperturn-view.com/boultons?pid=ODg8862235',
    'https://issuu.com/auctioncatalogue',
  ];
  for (const u of junk) assert(isJunkSearchUrl(u), `rejects ${u}`);
}

console.log('\nTest 8: isJunkSearchUrl accepts plausible auction-house URLs');
{
  const ok = [
    'https://www.hollismorgan.co.uk/search-auction/',
    'https://paulfosh.eigonlineauctions.com/search',
    'https://www.auctionhouse.co.uk/london/auction/search-results',
    'https://www.bondwolfe.com/auctions/properties/',
    'https://www.fishergerman.co.uk/land-property-auctions',
    'https://www.maggsandallen.co.uk/search-auction-may/',
  ];
  for (const u of ok) assert(!isJunkSearchUrl(u), `accepts ${u}`);
}

console.log('\nTest 9: isJunkSearchUrl handles non-string / empty input');
{
  assert(isJunkSearchUrl(null) === true, 'null → junk');
  assert(isJunkSearchUrl(undefined) === true, 'undefined → junk');
  assert(isJunkSearchUrl('') === true, 'empty string → junk');
  assert(isJunkSearchUrl(123) === true, 'number → junk');
}

// ── Test 10/11/12: FIRE-1 URL dedup window ─────────────────────
console.log('\nTest 10: _fire1RecentlyCalled is false before any mark');
{
  _resetFire1DedupForTests();
  assert(_fire1RecentlyCalled('https://example.com/heal') === false, 'fresh URL not recently called');
}

console.log('\nTest 11: mark + check round-trip — recently-called within window');
{
  _resetFire1DedupForTests();
  const url = 'https://example.com/heal';
  const now = 1_000_000_000_000;
  _fire1MarkCalled(url, now);
  // Same URL, 5 minutes later — still within 30-min window.
  assert(_fire1RecentlyCalled(url, now + 5 * 60_000) === true, 'duplicate within window detected');
  // Same URL, 31 minutes later — past the window.
  assert(_fire1RecentlyCalled(url, now + 31 * 60_000) === false, 'expires after window');
  // Different URL — independent key, not affected.
  assert(_fire1RecentlyCalled('https://other.example.com', now + 5 * 60_000) === false, 'different URL unaffected');
}

console.log('\nTest 12: dedup key handles arrays (sorted-joined for stable identity)');
{
  _resetFire1DedupForTests();
  const now = 2_000_000_000_000;
  _fire1MarkCalled(['https://b', 'https://a'], now);
  // Same set, different order — same key.
  assert(_fire1RecentlyCalled(['https://a', 'https://b'], now + 60_000) === true, 'array order does not affect dedup');
  // Subset — different key, not deduped.
  assert(_fire1RecentlyCalled(['https://a'], now + 60_000) === false, 'subset is a different key');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
