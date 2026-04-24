/**
 * Auth Cache + Trial Expiry Test Suite
 * ====================================
 * Unit tests for the user cache (`_userCacheInternals`, `invalidateUserCache`)
 * and the trial-expiry gating helper (`_maybeExpireTrial`).
 *
 * Run: node tests/test-auth-cache.js
 *
 * The DB-writing branch of `maybeExpireTrial` is intentionally not exercised
 * here — it's a single `supabase.from(...).update(...)` call that requires
 * a live client. The negative cases below verify the GATING logic that
 * decides whether to hit the DB at all, which is where the bug lived.
 */

// Supabase client throws on import without a URL. Stub the env vars before
// dynamically importing lib/auth.js so the module graph loads cleanly — no
// network traffic actually occurs since these tests exercise pure logic only.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const {
  _maybeExpireTrial,
  _userCacheInternals,
  invalidateUserCache,
} = await import('../lib/auth.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ─── maybeExpireTrial: gating logic ───
console.log('\n── maybeExpireTrial: does NOT downgrade ──');
{
  // Case 1: tier is already 'free' — no-op
  const freeUser = { id: 'u1', tier: 'free', tier_expires_at: '2020-01-01T00:00:00Z', stripe_subscription_id: null };
  await _maybeExpireTrial(freeUser);
  assert(freeUser.tier === 'free', 'free user stays free');

  // Case 2: tier_expires_at is null (lifetime premium) — no-op
  const lifetime = { id: 'u2', tier: 'premium', tier_expires_at: null, stripe_subscription_id: null };
  await _maybeExpireTrial(lifetime);
  assert(lifetime.tier === 'premium', 'lifetime premium stays premium');

  // Case 3: tier_expires_at is in the future — no-op
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const activeTrial = { id: 'u3', tier: 'premium', tier_expires_at: future, stripe_subscription_id: null };
  await _maybeExpireTrial(activeTrial);
  assert(activeTrial.tier === 'premium', 'active trial stays premium');
  assert(activeTrial.tier_expires_at === future, 'active trial preserves tier_expires_at');

  // Case 4 — THE BUG FIX: expired tier but an attached Stripe subscription.
  // Must not auto-downgrade — the webhook is authoritative and may be holding
  // a grace period for a past_due subscription.
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  const paidPastDue = { id: 'u4', tier: 'premium', tier_expires_at: past, stripe_subscription_id: 'sub_live_abc' };
  await _maybeExpireTrial(paidPastDue);
  assert(paidPastDue.tier === 'premium', 'expired user WITH Stripe sub is NOT downgraded (the bug fix)');
  assert(paidPastDue.tier_expires_at === past, 'tier_expires_at preserved for Stripe-subscribed users');
  assert(paidPastDue.stripe_subscription_id === 'sub_live_abc', 'stripe_subscription_id preserved');

  // Case 5: null/undefined input — does not throw
  await _maybeExpireTrial(null);
  await _maybeExpireTrial(undefined);
  assert(true, 'null/undefined input handled without throwing');
}

// ─── User cache: set/get/TTL/LRU/invalidate ───
console.log('\n── user cache basic set/get ──');
{
  _userCacheInternals.map.clear();
  const user = { id: 'u1', email: 'a@b.com', tier: 'premium' };
  _userCacheInternals.set('auth-1', user);
  const got = _userCacheInternals.get('auth-1');
  assert(got === user, 'cached user is returned verbatim');
  assert(_userCacheInternals.get('missing') === undefined, 'missing key returns undefined');
}

console.log('\n── user cache: TTL expiry ──');
{
  _userCacheInternals.map.clear();
  const user = { id: 'u1', tier: 'premium' };
  _userCacheInternals.set('auth-1', user);
  // Force the entry to look expired by rewriting its expires marker
  const entry = _userCacheInternals.map.get('auth-1');
  entry.expires = Date.now() - 1000;
  assert(_userCacheInternals.get('auth-1') === undefined, 'expired entry returns undefined');
  assert(!_userCacheInternals.map.has('auth-1'), 'expired entry is removed from map');
}

console.log('\n── user cache: invalidateUserCache ──');
{
  _userCacheInternals.map.clear();
  _userCacheInternals.set('auth-1', { id: 'u1' });
  _userCacheInternals.set('auth-2', { id: 'u2' });
  invalidateUserCache('auth-1');
  assert(_userCacheInternals.get('auth-1') === undefined, 'invalidated entry gone');
  assert(_userCacheInternals.get('auth-2') !== undefined, 'other entries untouched');
}

console.log('\n── user cache: LRU eviction when over MAX ──');
{
  _userCacheInternals.map.clear();
  // The cache evicts "oldest" (insertion order) when it exceeds MAX.
  // We can't easily set USER_CACHE_MAX from outside, but we can verify the
  // eviction policy by confirming the first inserted key is the one removed
  // when we exceed the current size by adding a large batch.
  const MAX_FOR_TEST = 2000; // must match USER_CACHE_MAX in lib/auth.js
  for (let i = 0; i < MAX_FOR_TEST; i++) {
    _userCacheInternals.set(`k${i}`, { id: i });
  }
  assert(_userCacheInternals.map.size === MAX_FOR_TEST, `populated to MAX (${MAX_FOR_TEST})`);
  // Insert one more — should trigger eviction of k0
  _userCacheInternals.set('k-new', { id: 'new' });
  assert(_userCacheInternals.map.size === MAX_FOR_TEST, 'size remains at MAX after overflow');
  assert(!_userCacheInternals.map.has('k0'), 'oldest entry (k0) was evicted');
  assert(_userCacheInternals.map.has('k-new'), 'newest entry retained');
}

// Leave the cache clean for any downstream tests
_userCacheInternals.map.clear();

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
