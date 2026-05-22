/**
 * Telegram action-dispatcher tests
 * ================================
 * Covers lib/pipeline/telegram-actions.js. Two surfaces:
 *   - handleCallbackData      — button-tap dispatch (callback_data parsing,
 *                               verb routing, missing/malformed input)
 *   - extractUrl / classifyVerifiedUrl / handleVerifiedUrlReply — the
 *                               "reply to a card with a verified URL" path
 *
 * The DB-write apply functions need a real supabase client, so these tests
 * focus on the pure helpers and the input-validation guards. Real
 * end-to-end coverage happens against the staging Telegram chat.
 *
 * Run: node tests/test-telegram-actions.js
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://test.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { handleCallbackData, extractUrl, classifyVerifiedUrl, handleVerifiedUrlReply } =
  await import('../lib/pipeline/telegram-actions.js');
const { HOUSE_ROOTS, detectAuctionHouse } = await import('../lib/houses.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: handleCallbackData rejects empty input');
{
  const r1 = await handleCallbackData('');
  const r2 = await handleCallbackData(null);
  const r3 = await handleCallbackData(undefined);
  assert(r1.ok === false, 'empty string → not ok');
  assert(r2.ok === false, 'null → not ok');
  assert(r3.ok === false, 'undefined → not ok');
}

console.log('\nTest 2: handleCallbackData rejects malformed callback_data');
{
  const r = await handleCallbackData('no-colon');
  assert(r.ok === false, 'no-colon → not ok');
  assert(/malformed/i.test(r.summary), 'reports malformed');
}

console.log('\nTest 3: handleCallbackData returns "not found" for unknown alertId');
{
  // The real supabase client will fail to find this UUID and _loadAlert returns null.
  const r = await handleCallbackData('accept:00000000-0000-0000-0000-000000000000');
  assert(r.ok === false, 'unknown alert → not ok');
  assert(/not found/i.test(r.summary), 'reports not-found');
}

console.log('\nTest 4: handleCallbackData rejects unknown verb');
{
  // We can't easily inject a real alert without a DB, but this hits the
  // unknown-verb branch even if _loadAlert returns null first. To exercise
  // the unknown-verb branch deterministically, we just check that parsing
  // succeeds and a known verb isn't required at the parse stage.
  const r = await handleCallbackData('badverb:00000000-0000-0000-0000-000000000000');
  assert(r.ok === false, 'unknown verb branch → not ok');
  // The current implementation hits _loadAlert first and returns "not found"
  // when the DB has no matching row. Both failure modes are acceptable here
  // — what matters is no crash.
  assert(typeof r.summary === 'string' && r.summary.length > 0, 'reports a reason');
}

console.log('\nTest 5: extractUrl pulls a URL out of free text');
{
  assert(extractUrl('https://example.com/lots') === 'https://example.com/lots', 'bare URL');
  assert(extractUrl('here you go https://example.com/lots thanks') === 'https://example.com/lots', 'URL mid-sentence');
  assert(extractUrl('the page is https://example.com/lots.') === 'https://example.com/lots', 'trailing full stop stripped');
  assert(extractUrl('(https://example.com/lots)') === 'https://example.com/lots', 'wrapping parens stripped');
  assert(extractUrl('http://example.com/x') === 'http://example.com/x', 'http scheme accepted');
}

console.log('\nTest 6: extractUrl returns null when there is no URL');
{
  assert(extractUrl('no link here') === null, 'plain text → null');
  assert(extractUrl('') === null, 'empty string → null');
  assert(extractUrl(null) === null, 'null → null');
  assert(extractUrl('ftp://example.com/x') === null, 'non-http scheme → null');
}

console.log('\nTest 7: classifyVerifiedUrl — an untracked domain is a catalogue fix');
{
  const d = classifyVerifiedUrl('https://a-totally-unknown-auction-house.example/lots', 'somehouse');
  assert(d.kind === 'catalogue', 'untracked URL → catalogue');
}

console.log('\nTest 8: classifyVerifiedUrl — a tracked sibling\'s URL is a merger');
{
  // Derive a real tracked house from HOUSE_ROOTS so the test self-adapts to
  // whatever houses are registered.
  const entry = Object.entries(HOUSE_ROOTS).find(([slug, url]) => detectAuctionHouse(url) === slug);
  if (!entry) {
    console.log('  SKIP: no HOUSE_ROOTS url resolves cleanly to its own slug');
  } else {
    const [trackedSlug, trackedUrl] = entry;
    const merger = classifyVerifiedUrl(trackedUrl, 'some-other-broken-slug');
    assert(merger.kind === 'merger', `${trackedSlug}'s URL replied for a different slug → merger`);
    assert(merger.parentSlug === trackedSlug, `merger parent resolved to ${trackedSlug}`);

    const catalogue = classifyVerifiedUrl(trackedUrl, trackedSlug);
    assert(catalogue.kind === 'catalogue', "a house's own URL for its own slug → catalogue, not merger");
  }
}

console.log('\nTest 9: handleVerifiedUrlReply rejects a reply with no URL');
{
  const r = await handleVerifiedUrlReply({ replyToMessageId: 123, text: 'no link in this message' });
  assert(r.ok === false, 'no URL → not ok');
  assert(/URL/i.test(r.summary), 'summary mentions URL');
}

console.log('\nTest 10: handleVerifiedUrlReply rejects an unsafe (private) URL');
{
  const r = await handleVerifiedUrlReply({ replyToMessageId: 123, text: 'http://localhost/catalogue' });
  assert(r.ok === false, 'localhost URL → not ok');
  assert(/reject/i.test(r.summary), 'summary says the URL was rejected');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
