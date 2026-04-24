/**
 * Gating & Tier Resolution Test Suite
 * ====================================
 * Tests STRIPE_ENABLED flag, resolveEffectiveTier(), and getAISearchLimit().
 * Run: node tests/test-gating.js
 *
 * Extracts functions from lib/config.js using regex so STRIPE_ENABLED can be
 * injected with both true and false values within a single process (an `import`
 * would bake in whatever process.env.STRIPE_ENABLED was at module-load time).
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configCode = readFileSync(join(__dirname, '..', 'lib', 'config.js'), 'utf-8');

// ── Extract STRIPE_ENABLED constant ──
const stripeEnabledMatch = configCode.match(/const STRIPE_ENABLED\s*=\s*([^;]+);/);
if (!stripeEnabledMatch) {
  console.error('FAIL: Could not find STRIPE_ENABLED in lib/config.js');
  process.exit(1);
}

// ── Extract SIGNED_IN_DAILY_LIMIT constant ──
const dailyLimitMatch = configCode.match(/const SIGNED_IN_DAILY_LIMIT\s*=\s*(\d+);/);
if (!dailyLimitMatch) {
  console.error('FAIL: Could not find SIGNED_IN_DAILY_LIMIT in lib/config.js');
  process.exit(1);
}

// ── Extract resolveEffectiveTier function ──
const rETStart = configCode.indexOf('function resolveEffectiveTier(');
if (rETStart === -1) {
  console.error('FAIL: Could not find resolveEffectiveTier in lib/config.js');
  process.exit(1);
}

// Find the function body by brace matching
let braceDepth = 0;
let rETEnd = -1;
for (let i = rETStart; i < configCode.length; i++) {
  if (configCode[i] === '{') braceDepth++;
  if (configCode[i] === '}') {
    braceDepth--;
    if (braceDepth === 0) { rETEnd = i + 1; break; }
  }
}
const resolveEffectiveTierCode = configCode.substring(rETStart, rETEnd);

// ── Extract getAISearchLimit function ──
const gASLStart = configCode.indexOf('function getAISearchLimit(');
if (gASLStart === -1) {
  console.error('FAIL: Could not find getAISearchLimit in lib/config.js');
  process.exit(1);
}
braceDepth = 0;
let gASLEnd = -1;
for (let i = gASLStart; i < configCode.length; i++) {
  if (configCode[i] === '{') braceDepth++;
  if (configCode[i] === '}') {
    braceDepth--;
    if (braceDepth === 0) { gASLEnd = i + 1; break; }
  }
}
const getAISearchLimitCode = configCode.substring(gASLStart, gASLEnd);

// ── Extract constants needed by the functions ──
const anonLimitMatch = configCode.match(/const ANON_AI_SEARCH_LIMIT\s*=\s*(\d+);/);
const freeLimitMatch = configCode.match(/const FREE_AI_SEARCH_LIMIT\s*=\s*(\d+);/);

// ── Test runner ──
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── Build test harness: create functions with STRIPE_ENABLED overridable ──
function buildFunctions(stripeEnabled) {
  const STRIPE_ENABLED = stripeEnabled;
  const SIGNED_IN_DAILY_LIMIT = parseInt(dailyLimitMatch[1]);
  const ANON_AI_SEARCH_LIMIT = parseInt(anonLimitMatch[1]);
  const FREE_AI_SEARCH_LIMIT = parseInt(freeLimitMatch[1]);

  // Evaluate resolveEffectiveTier in context
  const resolveEffectiveTier = new Function(
    'STRIPE_ENABLED',
    `${resolveEffectiveTierCode}; return resolveEffectiveTier;`
  )(STRIPE_ENABLED);

  // Evaluate getAISearchLimit in context
  const getAISearchLimit = new Function(
    'STRIPE_ENABLED', 'SIGNED_IN_DAILY_LIMIT', 'ANON_AI_SEARCH_LIMIT', 'FREE_AI_SEARCH_LIMIT',
    `${getAISearchLimitCode}; return getAISearchLimit;`
  )(STRIPE_ENABLED, SIGNED_IN_DAILY_LIMIT, ANON_AI_SEARCH_LIMIT, FREE_AI_SEARCH_LIMIT);

  return { resolveEffectiveTier, getAISearchLimit, SIGNED_IN_DAILY_LIMIT, ANON_AI_SEARCH_LIMIT };
}

// ═══════════════════════════════════════════════════════════════
// TESTS: resolveEffectiveTier
// ═══════════════════════════════════════════════════════════════

console.log('\n--- resolveEffectiveTier tests ---');

// STRIPE_ENABLED=false
{
  const { resolveEffectiveTier } = buildFunctions(false);

  assertEqual(resolveEffectiveTier(null), 'anon',
    'resolveEffectiveTier(null) returns "anon" when STRIPE_ENABLED=false');

  assertEqual(resolveEffectiveTier({ tier: 'free' }), 'premium',
    'resolveEffectiveTier(user) returns "premium" when STRIPE_ENABLED=false (free user promoted)');

  assertEqual(resolveEffectiveTier({ tier: 'premium' }), 'premium',
    'resolveEffectiveTier(premium user) returns "premium" when STRIPE_ENABLED=false');
}

// STRIPE_ENABLED=true
{
  const { resolveEffectiveTier } = buildFunctions(true);

  assertEqual(resolveEffectiveTier(null), 'anon',
    'resolveEffectiveTier(null) returns "anon" when STRIPE_ENABLED=true');

  assertEqual(resolveEffectiveTier({ tier: 'premium' }), 'premium',
    'resolveEffectiveTier(premium user) returns "premium" when STRIPE_ENABLED=true');

  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  assertEqual(resolveEffectiveTier({ tier: 'free', trial_expires_at: futureDate }), 'premium',
    'resolveEffectiveTier(user with valid trial) returns "premium" when STRIPE_ENABLED=true');

  assertEqual(resolveEffectiveTier({ tier: 'free' }), 'free',
    'resolveEffectiveTier(free user, no trial) returns "free" when STRIPE_ENABLED=true');

  const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  assertEqual(resolveEffectiveTier({ tier: 'free', trial_expires_at: pastDate }), 'free',
    'resolveEffectiveTier(user with expired trial) returns "free" when STRIPE_ENABLED=true');
}

// ═══════════════════════════════════════════════════════════════
// TESTS: getAISearchLimit
// ═══════════════════════════════════════════════════════════════

console.log('\n--- getAISearchLimit tests ---');

// STRIPE_ENABLED=false
{
  const { getAISearchLimit, SIGNED_IN_DAILY_LIMIT, ANON_AI_SEARCH_LIMIT } = buildFunctions(false);

  assertEqual(getAISearchLimit(null), ANON_AI_SEARCH_LIMIT,
    `getAISearchLimit(null) returns ${ANON_AI_SEARCH_LIMIT} (anon limit) when STRIPE_ENABLED=false`);

  assertEqual(getAISearchLimit({ tier: 'free' }), SIGNED_IN_DAILY_LIMIT,
    `getAISearchLimit(signed-in user) returns ${SIGNED_IN_DAILY_LIMIT} when STRIPE_ENABLED=false`);

  assertEqual(getAISearchLimit({ tier: 'premium' }), SIGNED_IN_DAILY_LIMIT,
    `getAISearchLimit(premium user) returns ${SIGNED_IN_DAILY_LIMIT} when STRIPE_ENABLED=false (no Infinity)`);
}

// STRIPE_ENABLED=true
{
  const { getAISearchLimit, ANON_AI_SEARCH_LIMIT } = buildFunctions(true);

  assertEqual(getAISearchLimit(null), ANON_AI_SEARCH_LIMIT,
    `getAISearchLimit(null) returns ${ANON_AI_SEARCH_LIMIT} (anon limit) when STRIPE_ENABLED=true`);

  assertEqual(getAISearchLimit({ tier: 'premium' }), Infinity,
    'getAISearchLimit(premium user) returns Infinity when STRIPE_ENABLED=true');

  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  assertEqual(getAISearchLimit({ tier: 'free', trial_expires_at: futureDate }), Infinity,
    'getAISearchLimit(user with valid trial) returns Infinity when STRIPE_ENABLED=true');

  assertEqual(getAISearchLimit({ tier: 'free' }), 5,
    'getAISearchLimit(free user) returns 5 when STRIPE_ENABLED=true');
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
