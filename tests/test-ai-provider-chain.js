/**
 * Tests for the multi-provider fallback chain (lib/ai-provider.js):
 * buildProviderChain + hasAIFallback. This is what removes the single-provider
 * SPOF — a Gemini outage rolls over to OpenRouter instead of killing extraction.
 *
 * Run: node tests/test-ai-provider-chain.js
 */

import { buildProviderChain, hasAIFallback } from '../lib/ai-provider.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const KEYS = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDERS', 'OPENROUTER_API_KEY'];
const saved = {};
for (const k of KEYS) saved[k] = process.env[k];
function reset() { for (const k of KEYS) delete process.env[k]; }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('Test 1: default (no env) → gemini only, no fallback');
{
  reset();
  assert(eq(buildProviderChain({ tier: 'fast' }), ['gemini']), 'chain = [gemini]');
  assert(hasAIFallback() === false, 'hasAIFallback false');
}

console.log('\nTest 2: OPENROUTER_API_KEY present → gemini → openrouter');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  assert(eq(buildProviderChain({ tier: 'fast' }), ['gemini', 'openrouter']), 'chain = [gemini, openrouter]');
  assert(hasAIFallback() === true, 'hasAIFallback true (openrouter fallback exists)');
}

console.log('\nTest 3: AI_PROVIDER=openrouter → openrouter primary');
{
  reset();
  process.env.AI_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  const chain = buildProviderChain({ tier: 'fast' });
  // openrouter primary; default fallback is also openrouter → deduped to one.
  assert(chain[0] === 'openrouter', 'openrouter is primary');
  assert(chain.length === 1, 'deduped to a single entry');
  assert(hasAIFallback() === true, 'hasAIFallback true (primary not gemini)');
}

console.log('\nTest 4: explicit AI_FALLBACK_PROVIDERS list, deduped + unknowns dropped');
{
  reset();
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_FALLBACK_PROVIDERS = 'openrouter, gemini, bogus, grok';
  const chain = buildProviderChain({ tier: 'fast' });
  assert(eq(chain, ['gemini', 'openrouter', 'grok']), `gemini→openrouter→grok, deduped, bogus dropped (got ${chain})`);
}

console.log('\nTest 5: PDF forces gemini-only (no cross-provider inline PDF)');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  assert(eq(buildProviderChain({ tier: 'fast', pdfBase64: 'JVBER...' }), ['gemini']), 'pdf → [gemini] only');
}

console.log('\nTest 6: reasoning tier → claude primary, then fallbacks');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  assert(eq(buildProviderChain({ tier: 'reasoning' }), ['claude', 'openrouter']), 'reasoning → [claude, openrouter]');
}

console.log('\nTest 7: AI_FALLBACK_PROVIDERS="" explicitly disables fallback');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.AI_FALLBACK_PROVIDERS = '';
  assert(eq(buildProviderChain({ tier: 'fast' }), ['gemini']), 'empty fallback list → gemini only');
  assert(hasAIFallback() === false, 'hasAIFallback false when explicitly emptied');
}

for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }

console.log(`\n${'═'.repeat(50)}`);
console.log(`AI provider chain tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
