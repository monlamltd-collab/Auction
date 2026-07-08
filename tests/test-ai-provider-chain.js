/**
 * Tests for the multi-provider fallback chain (lib/ai-provider.js):
 * buildProviderChain + hasAIFallback. This is what removes the single-provider
 * SPOF — a Gemini outage rolls over to OpenRouter instead of killing extraction.
 *
 * Run: node tests/test-ai-provider-chain.js
 */

import { buildProviderChain, hasAIFallback, openRouterGlobalBackups, baseModelSlug, openRouterBackoffMs, callSpecificModel, positiveIntEnv, callAI } from '../lib/ai-provider.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const KEYS = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDERS', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_FALLBACK_MODELS'];
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

console.log('\nTest 3: AI_PROVIDER=openrouter + GEMINI_API_KEY → openrouter primary, gemini fallback');
{
  reset();
  process.env.AI_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.GEMINI_API_KEY = 'AIza-test';
  const chain = buildProviderChain({ tier: 'fast' });
  // 2026-06-11 incident: this used to dedupe to [openrouter] ONLY — the healthy
  // direct-Gemini key was silently dropped, so any OpenRouter failure had no
  // fallback at all. Every configured provider must stay in the chain.
  assert(eq(chain, ['openrouter', 'gemini']), `chain = [openrouter, gemini] (got ${chain})`);
  assert(hasAIFallback() === true, 'hasAIFallback true (primary not gemini)');
}

console.log('\nTest 3b: AI_PROVIDER=openrouter WITHOUT a gemini key → openrouter only');
{
  reset();
  process.env.AI_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  const chain = buildProviderChain({ tier: 'fast' });
  assert(eq(chain, ['openrouter']), `chain = [openrouter] (got ${chain})`);
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

console.log('\nTest 8: OpenRouter global backups default to a free NON-Gemini model');
{
  reset();
  // 2026-06-17 incident: OpenRouter's default fast/capable models are BOTH
  // Gemini, so a Gemini-wide 429 had no non-Gemini rung and extraction cascaded.
  // The default backup must be non-Gemini so the chain actually survives.
  const backups = openRouterGlobalBackups();
  assert(backups.length === 1, `one default backup (got ${backups.length}: ${backups})`);
  assert(/llama|nemotron|deepseek|mistral|qwen/i.test(backups[0]) && !/gemini|google/i.test(backups[0]),
    `default backup is non-Gemini (got "${backups[0]}")`);
}

console.log('\nTest 9: OPENROUTER_FALLBACK_MODELS overrides + "" disables');
{
  reset();
  process.env.OPENROUTER_FALLBACK_MODELS = 'deepseek/deepseek-chat, mistralai/mistral-large';
  assert(eq(openRouterGlobalBackups(), ['deepseek/deepseek-chat', 'mistralai/mistral-large']),
    'custom comma-list is parsed in order');
  process.env.OPENROUTER_FALLBACK_MODELS = '';
  assert(eq(openRouterGlobalBackups(), []), 'empty string disables the default backup');
}

console.log('\nTest 10: baseModelSlug — undated request served as dated snapshot is the SAME model');
{
  assert(baseModelSlug('deepseek/deepseek-v4-flash-20260423') === 'deepseek/deepseek-v4-flash', 'strips -YYYYMMDD snapshot suffix');
  assert(baseModelSlug('deepseek/deepseek-v4-flash') === baseModelSlug('deepseek/deepseek-v4-flash-20260423'), 'undated == dated base (no false "backup" log)');
  assert(baseModelSlug('meta-llama/llama-3.3-70b-instruct:free') === 'meta-llama/llama-3.3-70b-instruct', 'strips :free tag');
  assert(baseModelSlug('deepseek/deepseek-v4-pro') !== baseModelSlug('google/gemini-2.5-pro'), 'genuinely different models stay different');
}

console.log('\nTest 11: openRouterBackoffMs — grows with attempt, honours Retry-After, capped at 8s');
{
  const a1 = openRouterBackoffMs(1, null), a3 = openRouterBackoffMs(3, null);
  assert(a1 >= 400 && a1 <= 500, `attempt 1 ≈ 400ms+jitter (got ${Math.round(a1)})`);
  assert(a3 > a1, `attempt 3 > attempt 1 (exponential) (got ${Math.round(a3)} > ${Math.round(a1)})`);
  assert(openRouterBackoffMs(1, 2000) === 2000, 'Retry-After honoured verbatim');
  assert(openRouterBackoffMs(10, null) <= 8000, 'capped at 8s');
  assert(openRouterBackoffMs(1, 999999) === 8000, 'huge Retry-After clamped to 8s');
}

// ── Integration: OpenRouter transient-failure retry (mocked fetch) ──
const realFetch = global.fetch;
const ok200 = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: '[]' } }], model: 'deepseek/deepseek-v4-flash-20260423', usage: { prompt_tokens: 5, completion_tokens: 2 } }) });
const err = (status) => ({ ok: false, status, headers: { get: () => null }, text: async () => `err ${status}` });

async function run() {
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.OPENROUTER_MAX_ATTEMPTS = '3';

  console.log('\nTest 12: 429 twice then 200 → retries and succeeds');
  {
    let n = 0;
    global.fetch = async () => { n++; return n < 3 ? err(429) : ok200(); };
    const r = await callSpecificModel('x', { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', maxTokens: 8 });
    assert(n === 3, `made 3 attempts (got ${n})`);
    assert(r.text === '[]', 'returned the successful body');
  }

  console.log('\nTest 13: HTTP 400 → NOT retried (config error, fail fast)');
  {
    let n = 0;
    global.fetch = async () => { n++; return err(400); };
    let threw = false;
    try { await callSpecificModel('x', { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', maxTokens: 8 }); }
    catch { threw = true; }
    assert(threw, 'threw on 400');
    assert(n === 1, `made exactly 1 attempt, no retry (got ${n})`);
  }

  console.log('\nTest 14: network throw twice then 200 → retries and succeeds');
  {
    let n = 0;
    global.fetch = async () => { n++; if (n < 3) throw new Error('ECONNRESET'); return ok200(); };
    const r = await callSpecificModel('x', { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', maxTokens: 8 });
    assert(n === 3, `retried network errors (got ${n})`);
    assert(r.text === '[]', 'recovered after transient network failures');
  }

  console.log('\nTest 15: 429 every time → throws after exhausting attempts (does NOT hang)');
  {
    let n = 0;
    global.fetch = async () => { n++; return err(429); };
    let threw = false;
    try { await callSpecificModel('x', { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', maxTokens: 8 }); }
    catch { threw = true; }
    assert(threw, 'threw after retries exhausted');
    assert(n === 3, `made exactly OPENROUTER_MAX_ATTEMPTS=3 attempts (got ${n})`);
  }

  console.log('\nTest 16b: 429 with Retry-After beyond the 8s cap → fails over NOW (no futile wait)');
  {
    let n = 0;
    const err429ra = { ok: false, status: 429, headers: { get: (h) => (String(h).toLowerCase() === 'retry-after' ? '30' : null) }, text: async () => 'slow down' };
    global.fetch = async () => { n++; return err429ra; };
    let threw = false, msg = '';
    try { await callSpecificModel('x', { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', maxTokens: 8 }); }
    catch (e) { threw = true; msg = e.message; }
    assert(threw, 'threw');
    assert(n === 1, `failed over on the FIRST 429 — no sleep-and-re-429 (got ${n} attempts)`);
    assert(/failing over now/i.test(msg), 'error explains the early fail-over');
  }
}

console.log('\nTest 16: positiveIntEnv — non-numeric/0/negative fall back to default (NaN-cap guard)');
{
  assert(positiveIntEnv('high', 3) === 3, 'non-numeric "high" → default 3 (not NaN)');
  assert(positiveIntEnv(undefined, 3) === 3, 'unset → default');
  assert(positiveIntEnv('0', 3) === 3, '"0" → default (must be >0)');
  assert(positiveIntEnv('-2', 3) === 3, 'negative → default');
  assert(positiveIntEnv('5', 3) === 5, 'valid "5" → 5');
  assert(positiveIntEnv('7x', 3) === 7, 'parseInt-leading "7x" → 7 (radix 10)');
}

console.log('\nTest 17: callAI surfaces the WHOLE chain (primary first), not just the dead-Gemini tail');
{
  reset();
  process.env.AI_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.GEMINI_API_KEY = 'AIza-test'; // chain = [openrouter, gemini]
  const rf = global.fetch;
  // OpenRouter → non-retryable 400 (throws); Gemini → not-initialized (throws).
  global.fetch = async () => ({ ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad request' });
  let msg = '';
  try { await callAI('x', { tier: 'fast', maxTokens: 8 }); }
  catch (e) { msg = e.message; }
  global.fetch = rf;
  assert(/openrouter/i.test(msg) && /gemini/i.test(msg), `names BOTH providers (got: ${msg.slice(0, 120)})`);
  assert(msg.indexOf('openrouter') < msg.indexOf('gemini'), 'leads with the primary (openrouter) as the root cause');
  assert(/openrouter → gemini/.test(msg), 'shows the chain order');
}

await run().finally(() => { global.fetch = realFetch; });

for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
delete process.env.OPENROUTER_MAX_ATTEMPTS;

console.log(`\n${'═'.repeat(50)}`);
console.log(`AI provider chain tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
