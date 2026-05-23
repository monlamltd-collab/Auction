/**
 * Offline tests for ai_usage per-user metering — verifies that callAI()
 * threads a userId through to the ai_usage insert, and that logAICost
 * degrades gracefully when the user_id column isn't present yet (migration
 * 2026-05-22-ai-usage-user-id not applied).
 *
 * The provider SDK and Supabase client are both faked so the test runs
 * without network, API keys, or a database.
 *
 * Run: node tests/test-ai-usage-metering.js
 */

// Zero the rate-limit gap before importing — GEMINI_MIN_GAP is read once at
// module load. Stub Supabase env so the import graph doesn't error.
process.env.GEMINI_MIN_GAP_MS = '0';
process.env.AI_PROVIDER = 'gemini';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { initAI, callAI } = await import('../lib/ai-provider.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Fake Gemini SDK — returns a canned response with usage metadata.
function makeFakeGenAI() {
  return {
    getGenerativeModel() {
      return {
        async generateContent() {
          return {
            response: {
              text: () => '{"indices":[0],"report":"ok"}',
              usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 340 },
            },
          };
        },
      };
    },
  };
}

// Fake Supabase — records every ai_usage insert. failFirstWithUserId makes
// the first insert resolve with a missing-column error to exercise the
// graceful-degradation retry.
function makeFakeSupabase({ failFirstWithUserId = false } = {}) {
  const inserts = [];
  let n = 0;
  return {
    inserts,
    from(table) {
      return {
        insert(row) {
          n++;
          inserts.push({ table, row });
          if (failFirstWithUserId && n === 1) {
            return Promise.resolve({
              error: { message: "Could not find the 'user_id' column of 'ai_usage' in the schema cache" },
            });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

// logAICost is fire-and-forget — callAI doesn't await it. Flush microtasks +
// the chained degradation retry before asserting.
const flush = () => new Promise(r => setTimeout(r, 25));

console.log('Test 1: callAI({ userId }) stamps user_id on the ai_usage row');
{
  const sb = makeFakeSupabase();
  initAI(makeFakeGenAI(), sb);
  await callAI('prompt', { tier: 'fast', taskType: 'search', userId: 'user-abc' });
  await flush();
  assert(sb.inserts.length === 1, 'exactly one ai_usage insert');
  const row = sb.inserts[0]?.row || {};
  assert(sb.inserts[0]?.table === 'ai_usage', 'insert targets ai_usage');
  assert(row.user_id === 'user-abc', `user_id = user-abc (got ${row.user_id})`);
  assert(row.task_type === 'search', 'task_type carries the endpoint dimension');
  assert(row.provider === 'gemini', 'provider recorded');
  assert(row.tokens_in === 1200 && row.tokens_out === 340, 'token counts recorded');
  assert(typeof row.est_cost === 'number' && row.est_cost > 0, 'est_cost computed');
}

console.log('\nTest 2: callAI() without userId -> user_id is null (pipeline/cron calls)');
{
  const sb = makeFakeSupabase();
  initAI(makeFakeGenAI(), sb);
  await callAI('prompt', { tier: 'fast', taskType: 'extraction' });
  await flush();
  assert(sb.inserts.length === 1, 'one insert');
  assert(sb.inserts[0].row.user_id === null, 'user_id is null when no user context');
}

console.log('\nTest 3: graceful degradation — missing user_id column -> retry without it');
{
  const sb = makeFakeSupabase({ failFirstWithUserId: true });
  initAI(makeFakeGenAI(), sb);
  await callAI('prompt', { tier: 'fast', taskType: 'search', userId: 'user-xyz' });
  await flush();
  assert(sb.inserts.length === 2, 'two inserts: failed-with-user_id then legacy retry');
  assert(sb.inserts[0].row.user_id === 'user-xyz', 'first insert carried user_id');
  assert(!('user_id' in sb.inserts[1].row), 'retry insert omits user_id entirely');
  assert(sb.inserts[1].row.provider === 'gemini' && sb.inserts[1].row.tokens_in === 1200,
    'retry insert still logs provider + tokens (cost logging survives)');
}

console.log('\nTest 4: a clean insert does NOT trigger the degradation retry');
{
  const sb = makeFakeSupabase();
  initAI(makeFakeGenAI(), sb);
  await callAI('prompt', { tier: 'fast', taskType: 'search', userId: 'user-1' });
  await flush();
  assert(sb.inserts.length === 1, 'single insert when the column exists');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
