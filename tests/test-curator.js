// tests/test-curator.js
/**
 * Curator pipeline tests
 * ======================
 * Covers: selectPicks (selection algorithm + diversity caps),
 *         parseProseJson (LLM output parser),
 *         buildPrompt (prompt assembly contract),
 *         generateProse (happy path with stubbed AI),
 *         renderDailyDigestEmail (HTML escaping + card rendering).
 *
 * Run: node tests/test-curator.js
 */

import { selectPicks, _internal as selectInternal } from '../lib/curator/select-picks.js';
import { parseProseJson, buildPrompt, generateProse } from '../lib/curator/generate-prose.js';
import { renderDailyDigestEmail, _internal as digestInternal } from '../lib/pipeline/daily-digest.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function test(name, fn) {
  console.log(`\n${name}`);
  return Promise.resolve().then(fn).catch(e => {
    failed++;
    console.error(`  THREW: ${e.message}\n${e.stack}`);
  });
}

// ── Test fixture builder ─────────────────────────────────────────────
function makeLot(overrides = {}) {
  const future = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return {
    _dbId: overrides._dbId || `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`,
    _house: overrides._house || 'savills',
    address: '1 High Street, Bristol, BS1 1AA',
    postcode: 'BS1 1AA',
    price: 150000,
    priceText: '£150,000',
    propType: 'house',
    beds: 3,
    tenure: 'Freehold',
    score: 8.0,
    status: 'available',
    imageUrl: 'https://example.com/img.jpg',
    _auctionDate: future,
    _lastSeenAt: new Date().toISOString(),
    fundability: { lenderCount: 12, ltv: 75, possibleCount: 8 },
    opps: ['Needs modernisation'],
    risks: [],
    bullets: ['Three bedroom terrace', 'Vacant possession', 'Needs modernisation'],
    scoreBreakdown: [{ signal: 'Needs modernisation', pts: 2 }],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// selectPicks — selection algorithm
// ═══════════════════════════════════════════════════════════════

await test('selectPicks: empty input returns []', () => {
  const out = selectPicks([], []);
  assert(Array.isArray(out) && out.length === 0, 'returns empty array');
});

await test('selectPicks: rejects lots below MIN_SCORE', () => {
  const out = selectPicks([makeLot({ score: 6.5 })], []);
  assert(out.length === 0, 'lot with score 6.5 not picked');
});

await test('selectPicks: accepts lots at exactly MIN_SCORE', () => {
  const out = selectPicks([makeLot({ score: 7.0 })], []);
  assert(out.length === 1, 'lot with score 7.0 picked');
});

await test('selectPicks: rejects lots without imageUrl', () => {
  const out = selectPicks([makeLot({ imageUrl: null })], []);
  assert(out.length === 0, 'no image → rejected');
});

await test('selectPicks: rejects lots without fundability', () => {
  const out = selectPicks([makeLot({ fundability: null })], []);
  assert(out.length === 0, 'fundability null → rejected');
  const out2 = selectPicks([makeLot({ fundability: { lenderCount: 0 } })], []);
  assert(out2.length === 0, 'fundability zero lenders → rejected');
});

await test('selectPicks: rejects lots with non-available status', () => {
  for (const status of ['sold', 'withdrawn', 'unsold', 'extraction_failure']) {
    const out = selectPicks([makeLot({ status })], []);
    assert(out.length === 0, `status='${status}' → rejected`);
  }
});

await test('selectPicks: rejects lots with auction date too soon', () => {
  const tooSoon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const out = selectPicks([makeLot({ _auctionDate: tooSoon })], []);
  assert(out.length === 0, 'auction date 3 days away → rejected');
});

await test('selectPicks: skips lots picked in the last 14 days', () => {
  const lot = makeLot({ _dbId: 'aaaa-already-picked' });
  const recent = [{ lot_id: 'aaaa-already-picked', pick_date: '2026-05-08' }];
  const out = selectPicks([lot], recent);
  assert(out.length === 0, 'recently-picked lot dedup');
});

await test('selectPicks: caps at TOP_N (default 8) even with 20 eligible', () => {
  // Must satisfy all three diversity caps simultaneously:
  //   MAX_PER_HOUSE=2, MAX_PER_PROP_TYPE=3, MAX_PER_REGION=2.
  // Use unique houses + cycle 4 propTypes + cycle 10 regions so 20
  // candidates yield at least 8 valid picks.
  const regions = ['BS', 'M1', 'B1', 'LS', 'NE', 'E1', 'CF', 'EH', 'BT', 'NR'];
  const types = ['house', 'flat', 'bungalow', 'commercial'];
  const lots = Array.from({ length: 20 }, (_, i) => {
    const area = regions[i % regions.length];
    return makeLot({
      _dbId: `lot-${i}`,
      _house: `house-${i}`,
      propType: types[i % types.length],
      address: `${i} High St, Town${i}, ${area} 1AA`,
      postcode: `${area} 1AA`,
    });
  });
  const out = selectPicks(lots, []);
  assert(out.length === 8, `picked exactly 8, got ${out.length}`);
});

await test('selectPicks: enforces MAX_PER_HOUSE diversity cap', () => {
  const lots = Array.from({ length: 5 }, (_, i) => makeLot({
    _dbId: `lot-${i}`,
    _house: 'savills', // same house
    address: `${i} Different Street, Town${i}, BS${i + 1} 1AA`,
    postcode: `BS${i + 1} 1AA`,
  }));
  const out = selectPicks(lots, []);
  assert(out.length === selectInternal.MAX_PER_HOUSE, `max 2 from same house, got ${out.length}`);
});

await test('selectPicks: enforces MAX_PER_REGION diversity cap', () => {
  // All postcodes in BS = south_west
  const lots = Array.from({ length: 5 }, (_, i) => makeLot({
    _dbId: `lot-${i}`,
    _house: `house-${i}`,
    address: `${i} High St, Bristol, BS${i + 1} 1AA`,
    postcode: `BS${i + 1} 1AA`,
  }));
  const out = selectPicks(lots, []);
  assert(out.length === selectInternal.MAX_PER_REGION, `max 2 per region, got ${out.length}`);
});

await test('selectPicks: sorts by score DESC then by lower LTV', () => {
  const lots = [
    makeLot({ _dbId: 'low-score', _house: 'a', score: 7.5, postcode: 'NE1 1AA', address: '1 St, Newcastle, NE1 1AA' }),
    makeLot({ _dbId: 'top-score', _house: 'b', score: 9.5, postcode: 'M1 1AA', address: '1 St, Manchester, M1 1AA' }),
    makeLot({ _dbId: 'mid-score', _house: 'c', score: 8.0, postcode: 'B1 1AA', address: '1 St, Birmingham, B1 1AA' }),
  ];
  const out = selectPicks(lots, []);
  assert(out[0]._dbId === 'top-score', 'highest score first');
  assert(out[1]._dbId === 'mid-score', 'mid second');
  assert(out[2]._dbId === 'low-score', 'lowest last');
});

await test('selectPicks: lots without _dbId are filtered out', () => {
  const out = selectPicks([makeLot({ _dbId: null })], []);
  assert(out.length === 0, 'null _dbId → skipped');
});

// ═══════════════════════════════════════════════════════════════
// parseProseJson — LLM output parser
// ═══════════════════════════════════════════════════════════════

await test('parseProseJson: parses clean JSON', () => {
  const raw = '{"headline":"H","prose":"P","hook":"K"}';
  const out = parseProseJson(raw);
  assert(out && out.headline === 'H' && out.prose === 'P' && out.hook === 'K', 'parsed');
});

await test('parseProseJson: strips ```json fences', () => {
  const raw = '```json\n{"headline":"H","prose":"P","hook":"K"}\n```';
  const out = parseProseJson(raw);
  assert(out && out.headline === 'H', 'fence stripped');
});

await test('parseProseJson: strips bare ``` fences', () => {
  const raw = '```\n{"headline":"H","prose":"P","hook":"K"}\n```';
  const out = parseProseJson(raw);
  assert(out && out.headline === 'H', 'bare fence stripped');
});

await test('parseProseJson: extracts JSON from preamble', () => {
  const raw = 'Here is the analysis:\n{"headline":"H","prose":"P","hook":"K"}\nLet me know if you need more.';
  const out = parseProseJson(raw);
  assert(out && out.headline === 'H', 'preamble ignored');
});

await test('parseProseJson: invalid JSON returns null', () => {
  assert(parseProseJson('not json') === null, 'plain text → null');
  assert(parseProseJson('') === null, 'empty → null');
  assert(parseProseJson(null) === null, 'null → null');
  assert(parseProseJson('{ broken } not json') === null, 'broken JSON → null');
});

await test('parseProseJson: trims output strings', () => {
  const raw = '{"headline":"  H  ","prose":"  P  ","hook":"  K  "}';
  const out = parseProseJson(raw);
  assert(out.headline === 'H' && out.prose === 'P' && out.hook === 'K', 'trimmed');
});

// ═══════════════════════════════════════════════════════════════
// buildPrompt — prompt assembly contract
// ═══════════════════════════════════════════════════════════════

await test('buildPrompt: includes core lot fields', () => {
  const lot = makeLot({ score: 8.4 });
  const prompt = buildPrompt(lot, null);
  assert(prompt.includes('1 High Street, Bristol'), 'address');
  assert(prompt.includes('£150,000'), 'price formatted');
  assert(prompt.includes('property_type: house'), 'propType');
  assert(prompt.includes('bedrooms: 3'), 'beds');
  assert(prompt.includes('score: 8.4/10'), 'score with decimals');
});

await test('buildPrompt: includes fundability when present', () => {
  const lot = makeLot({ fundability: { lenderCount: 12, ltv: 75 } });
  const prompt = buildPrompt(lot, null);
  assert(prompt.includes('12 eligible lenders at 75% LTV'), 'fundability line');
});

await test('buildPrompt: includes HPI context when present', () => {
  const hpi = { latest: { area_name: 'Bristol', average_price: 280000, terraced_price: 240000 }, yoy: 4.2 };
  const lot = makeLot({});
  const prompt = buildPrompt(lot, hpi);
  assert(prompt.includes('Bristol avg £280,000'), 'HPI area + avg');
  assert(prompt.includes('12m change 4.2%'), 'HPI yoy');
});

await test('buildPrompt: includes opps and risks', () => {
  const lot = makeLot({ opps: ['Needs modernisation', 'Vacant'], risks: ['Sitting tenant'] });
  const prompt = buildPrompt(lot, null);
  assert(prompt.includes('Needs modernisation · Vacant'), 'opps joined');
  assert(prompt.includes('Sitting tenant'), 'risks present');
});

await test('buildPrompt: caps source bullets at 8', () => {
  const bullets = Array.from({ length: 20 }, (_, i) => `Bullet ${i}`);
  const lot = makeLot({ bullets });
  const prompt = buildPrompt(lot, null);
  // First 8 should appear, 9th onwards should not
  assert(prompt.includes('Bullet 7'), 'bullet 7 in prompt');
  assert(!prompt.includes('Bullet 8'), 'bullet 8 not in prompt');
});

// ═══════════════════════════════════════════════════════════════
// generateProse — happy path with stubbed AI
// ═══════════════════════════════════════════════════════════════

await test('generateProse: happy path with stubbed callAI returns parsed object', async () => {
  const stub = async () => JSON.stringify({
    headline: 'A clear short headline test',
    prose: 'P'.repeat(200),
    hook: 'A reasonable hook for sharing.',
  });
  const lot = makeLot({});
  const out = await generateProse(lot, { callAI: stub, queryHPI: async () => ({ status: 'no_match' }) });
  assert(out !== null, 'returns prose');
  assert(out.headline === 'A clear short headline test', 'headline ok');
  assert(out.prose.length === 200, 'prose at expected length');
});

await test('generateProse: rejects too-short headline', async () => {
  const stub = async () => JSON.stringify({ headline: 'Hi', prose: 'P'.repeat(200), hook: 'A reasonable hook.' });
  const out = await generateProse(makeLot({}), { callAI: stub, queryHPI: async () => ({ status: 'no_match' }) });
  assert(out === null, 'rejects 2-char headline');
});

await test('generateProse: rejects too-short prose', async () => {
  const stub = async () => JSON.stringify({ headline: 'Reasonable headline length here', prose: 'tiny', hook: 'A reasonable hook.' });
  const out = await generateProse(makeLot({}), { callAI: stub, queryHPI: async () => ({ status: 'no_match' }) });
  assert(out === null, 'rejects tiny prose');
});

await test('generateProse: returns null on missing address/price', async () => {
  const stub = async () => JSON.stringify({ headline: 'OK', prose: 'P'.repeat(200), hook: 'A hook.' });
  const out1 = await generateProse({ price: 100000 }, { callAI: stub, queryHPI: async () => ({ status: 'no_match' }) });
  assert(out1 === null, 'missing address → null');
  const out2 = await generateProse({ address: 'X' }, { callAI: stub, queryHPI: async () => ({ status: 'no_match' }) });
  assert(out2 === null, 'missing price → null');
});

await test('generateProse: returns null when callAI throws', async () => {
  const stub = async () => { throw new Error('AI down'); };
  const out = await generateProse(makeLot({}), { callAI: stub, queryHPI: async () => ({ status: 'no_match' }) });
  assert(out === null, 'AI error → null');
});

// ═══════════════════════════════════════════════════════════════
// renderDailyDigestEmail — HTML escaping + structure
// ═══════════════════════════════════════════════════════════════

await test('renderDailyDigestEmail: produces subject + html', () => {
  const picksWithLots = [{
    pick: { id: 'p1', rank: 1, headline: 'A great deal', prose: 'Detailed prose.', hook: 'Sharp hook.' },
    lot: { id: 'l1', address: '1 St', price: 100000, prop_type: 'house', score: 8.0, image_url: null, house: 'savills' },
  }];
  const out = renderDailyDigestEmail({ recipientEmail: 'x@y.com', unsubscribeToken: 'tok', picksWithLots, pickDate: '2026-05-10' });
  assert(out.subject.includes('1 hand-picked'), 'subject reflects count');
  assert(out.html.includes('A great deal'), 'headline rendered');
  assert(out.html.includes('£100,000'), 'price formatted');
  assert(out.html.includes('Detailed prose.'), 'prose rendered');
});

await test('renderDailyDigestEmail: escapes HTML in user data', () => {
  // Quote check goes in prose because hook isn't surfaced in the email body
  // (hook is the LinkedIn-share artefact, see routes/curator.js share endpoint).
  const picksWithLots = [{
    pick: { id: 'p1', rank: 1, headline: '<script>alert(1)</script>', prose: 'A & B with "quoted" text', hook: 'unused-in-email' },
    lot: { id: 'l1', address: '1 <em>St</em>', price: 100000, prop_type: 'house', score: 8.0, image_url: null, house: 'h' },
  }];
  const out = renderDailyDigestEmail({ recipientEmail: 'x@y.com', unsubscribeToken: 't', picksWithLots, pickDate: '2026-05-10' });
  assert(!out.html.includes('<script>alert(1)</script>'), 'script not present raw');
  assert(out.html.includes('&lt;script&gt;'), 'script escaped');
  assert(out.html.includes('A &amp; B'), 'ampersand escaped');
  assert(out.html.includes('&quot;quoted&quot;'), 'quotes escaped');
});

await test('renderDailyDigestEmail: includes unsubscribe link with cadence=daily', () => {
  const picksWithLots = [{
    pick: { id: 'p1', rank: 1, headline: 'H', prose: 'P', hook: 'K' },
    lot: { id: 'l1', address: '1 St', price: 100000, prop_type: 'house', score: 8.0, image_url: null, house: 'h' },
  }];
  const out = renderDailyDigestEmail({ recipientEmail: 'x@y.com', unsubscribeToken: 'tok123', picksWithLots, pickDate: '2026-05-10' });
  assert(out.html.includes('cadence=daily'), 'unsub url has cadence=daily');
  assert(out.html.includes('token=tok123'), 'token in unsub url');
});

await test('renderDailyDigestEmail: each lot link gets utm_medium=email', () => {
  const picksWithLots = [{
    pick: { id: 'p1', rank: 1, headline: 'H', prose: 'P', hook: 'K' },
    lot: { id: 'lot-uuid-1', address: '1 St', price: 100000, prop_type: 'house', score: 8.0, image_url: null, house: 'h' },
  }];
  const out = renderDailyDigestEmail({ recipientEmail: 'x@y.com', unsubscribeToken: 't', picksWithLots, pickDate: '2026-05-10' });
  // URL is HTML-escaped in href attribute → '&' becomes '&amp;'
  assert(out.html.includes('/lot/lot-uuid-1?utm_source=curator&amp;utm_medium=email&amp;utm_campaign=daily'), 'UTM params present (HTML-escaped)');
});

// ═══════════════════════════════════════════════════════════════
// digest internal helpers
// ═══════════════════════════════════════════════════════════════

await test('daily-digest: formatDateLabel formats UK date', () => {
  const out = digestInternal.formatDateLabel('2026-05-10');
  assert(out.includes('Sunday'), `${out} contains weekday`);
  assert(out.includes('10') && out.includes('May'), `${out} contains date+month`);
});

await test('daily-digest: escapeHtml handles all chars', () => {
  const out = digestInternal.escapeHtml('<a&b>"c\'d"');
  assert(out === '&lt;a&amp;b&gt;&quot;c&#39;d&quot;', `escaped correctly, got: ${out}`);
});

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log(`\n──────────────────────────────────────────`);
console.log(`Curator tests: ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────────────────`);

if (failed > 0) process.exit(1);
