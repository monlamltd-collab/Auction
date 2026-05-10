/**
 * Weekly digest — pure-function tests (Milestone 6).
 *
 * Covers selectDigestLots (top-N picker — score-sorted, recency tiebreak)
 * and renderDigestEmail (subject pluralisation, deep links, unsubscribe
 * token plumbing, HTML escaping). The cycle runner is exercised live
 * once the Monday cron fires.
 *
 * Run: node tests/test-weekly-digest.js
 */

import { selectDigestLots, renderDigestEmail } from '../lib/pipeline/weekly-digest.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const baseLot = {
  id: 'b9b0f77e-0001-0000-0000-000000000001',
  _house: 'allsop',
  lot: 1,
  url: 'https://example.com/lot/1',
  address: '12 Acacia Avenue, Bristol',
  postcode: 'BS1 1AB',
  price: 250000,
  priceText: '£250,000',
  propType: 'house',
  beds: 3,
  imageUrl: 'https://example.com/img.jpg',
  status: 'available',
  score: 7.5,
  lastSeen: '2026-05-09T08:00:00Z',
};

// ── Test 1: empty input ──
console.log('Test 1: selectDigestLots — empty / nullish input');
{
  assert(selectDigestLots([]).length === 0, 'empty array → empty');
  assert(selectDigestLots(null).length === 0, 'null → empty');
  assert(selectDigestLots(undefined).length === 0, 'undefined → empty');
}

// ── Test 2: score-sorted DESC ──
console.log('\nTest 2: top-N is score-sorted DESC');
{
  const lots = [
    { ...baseLot, id: 'a', score: 4.0 },
    { ...baseLot, id: 'b', score: 9.5 },
    { ...baseLot, id: 'c', score: 7.0 },
    { ...baseLot, id: 'd', score: 8.5 },
  ];
  const out = selectDigestLots(lots);
  assert(out.length === 4, 'all 4 returned (under topN)');
  assert(out[0].id === 'b', 'highest score first');
  assert(out[1].id === 'd', 'second-highest second');
  assert(out[2].id === 'c', 'third');
  assert(out[3].id === 'a', 'lowest score last');
}

// ── Test 3: topN cap ──
console.log('\nTest 3: topN cap — default 8, custom honoured');
{
  const lots = Array.from({ length: 20 }, (_, i) => ({ ...baseLot, id: 'l' + i, score: i }));
  const def = selectDigestLots(lots);
  assert(def.length === 8, 'default topN = 8');
  const five = selectDigestLots(lots, { topN: 5 });
  assert(five.length === 5, 'custom topN honoured');
  // Sanity: highest scores survived the cap
  assert(def[0].score === 19, 'top of cap is highest score');
  assert(def[7].score === 12, '8th is 8th-highest');
}

// ── Test 4: recency tiebreak when scores equal ──
console.log('\nTest 4: recency tiebreak when scores tie');
{
  const lots = [
    { ...baseLot, id: 'old', score: 7.0, lastSeen: '2026-05-01T00:00:00Z' },
    { ...baseLot, id: 'new', score: 7.0, lastSeen: '2026-05-09T00:00:00Z' },
    { ...baseLot, id: 'mid', score: 7.0, lastSeen: '2026-05-05T00:00:00Z' },
  ];
  const out = selectDigestLots(lots);
  assert(out[0].id === 'new', 'most recent wins on score tie');
  assert(out[1].id === 'mid', 'middle next');
  assert(out[2].id === 'old', 'oldest last');
}

// ── Test 5: missing-data lots dropped ──
console.log('\nTest 5: lots with no address / price / priceText are dropped');
{
  const lots = [
    { ...baseLot, id: 'good' },
    { ...baseLot, id: 'no-anything', address: null, price: null, priceText: null },
    { id: 'totally-empty' },
  ];
  const out = selectDigestLots(lots);
  assert(out.length === 1, 'only the well-formed lot kept');
  assert(out[0].id === 'good', 'kept the good one');
}

// ── Test 6: unscored lots sort last ──
console.log('\nTest 6: unscored lots fall to the back of the list');
{
  const lots = [
    { ...baseLot, id: 'unscored', score: null },
    { ...baseLot, id: 'low', score: 2.0 },
    { ...baseLot, id: 'high', score: 8.5 },
  ];
  const out = selectDigestLots(lots);
  assert(out[0].id === 'high', 'high-score first');
  assert(out[1].id === 'low', 'low-score second');
  assert(out[2].id === 'unscored', 'unscored last');
}

// ── Test 7: renderDigestEmail subject + content ──
console.log('\nTest 7: renderDigestEmail — basic shape');
{
  const out = renderDigestEmail({
    recipientEmail: 'someone@example.com',
    unsubscribeToken: 'abcd-token',
    matches: [baseLot],
    weekLabel: 'Week of May 03 – May 10',
  });
  assert(out.subject === '1 fresh auction lot worth a look this week', 'singular subject');
  assert(out.html.includes('12 Acacia Avenue, Bristol'), 'address rendered');
  assert(out.html.includes('£250,000'), 'price rendered');
  assert(out.html.includes('/lot/' + baseLot.id), 'deep link to lot detail page');
  assert(out.html.includes('Score 7.5/10'), 'score rendered');
  assert(out.html.includes('someone@example.com'), 'recipient email mentioned in unsub line');
  assert(out.html.includes('token=abcd-token'), 'unsubscribe token in URL');
  assert(out.html.includes('Week of May 03 – May 10'), 'week label rendered');
}

// ── Test 8: plural subject ──
console.log('\nTest 8: plural subject for >1 match');
{
  const out = renderDigestEmail({
    recipientEmail: 'a@b.com',
    unsubscribeToken: 't',
    matches: [baseLot, { ...baseLot, id: '2' }, { ...baseLot, id: '3' }],
  });
  assert(out.subject.startsWith('3 fresh auction lots'), 'plural subject for >1');
}

// ── Test 9: HTML escaping in week label + email ──
console.log('\nTest 9: user-controlled-ish strings are escaped');
{
  const out = renderDigestEmail({
    recipientEmail: '<script>alert(1)</script>@x.com',
    unsubscribeToken: 't',
    matches: [baseLot],
    weekLabel: '<b>injected</b>',
  });
  assert(!out.html.includes('<script>alert(1)</script>'), 'recipient email script tag escaped');
  assert(out.html.includes('&lt;script&gt;'), 'recipient escaped form present');
  assert(!out.html.includes('<b>injected</b>'), 'week label tag escaped');
}

// ── Test 10: unsubscribe token URL-encoded ──
console.log('\nTest 10: unsubscribe token URL-encoded');
{
  const out = renderDigestEmail({
    recipientEmail: 'x@y.com',
    unsubscribeToken: 'token with spaces & chars',
    matches: [baseLot],
  });
  assert(out.html.includes('token=token%20with%20spaces%20%26%20chars'),
    'token reaches unsubscribe URL safely encoded');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
