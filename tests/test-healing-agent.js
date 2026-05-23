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

const { healBrokenHouse, getHealingState, clearHealingCooldown } = await import('../lib/pipeline/healing.js');
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
