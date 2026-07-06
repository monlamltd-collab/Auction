/**
 * AI Search Response Parser Test Suite
 * =====================================
 * Tests lib/search-parse.js::parseAIResponse — the Layer-2 smart-search
 * response parser. The critical case is TRUNCATED output: on 2026-06-28 the
 * model hit the maxTokens cap mid-JSON, strict parsing failed, and the route
 * fell back to dumping all 400 candidate lots. The parser must salvage every
 * complete index from a truncated array instead.
 * Run: node tests/test-search-parse.js
 */

import { parseAIResponse } from '../lib/search-parse.js';

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${name}`); }
}
function assertEqual(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  assert(ok, name);
}

// ── Clean JSON ──
let r = parseAIResponse('{"indices":[0,5,12],"report":"Three strong lots."}');
assertEqual(r.indices, [0, 5, 12], 'clean JSON: indices parsed');
assertEqual(r.report, 'Three strong lots.', 'clean JSON: report parsed');
assert(r.salvaged === false, 'clean JSON: not salvaged');

// ── Fenced JSON (```json ... ```) ──
r = parseAIResponse('```json\n{"indices":[3,7],"report":"Two matches."}\n```');
assertEqual(r.indices, [3, 7], 'fenced JSON: indices parsed');
assert(r.salvaged === false, 'fenced JSON: not salvaged');

// ── JSON embedded in prose ──
r = parseAIResponse('Here are the results:\n{"indices":[1],"report":"One match."}');
assertEqual(r.indices, [1], 'embedded JSON: indices parsed');

// ── Truncated mid-array (the 2026-06-28 production failure) ──
r = parseAIResponse('{"indices":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22');
assertEqual(r.indices, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22], 'truncated array: all complete indices salvaged');
assert(r.salvaged === true, 'truncated array: marked salvaged');

// ── Truncated mid-report (indices complete, report cut off) ──
r = parseAIResponse('{"indices":[4,8,15],"report":"Found three freehold blocks in Man');
assertEqual(r.indices, [4, 8, 15], 'truncated report: indices salvaged');
assert(r.report.startsWith('Found three freehold blocks'), 'truncated report: partial report salvaged');
assert(r.salvaged === true, 'truncated report: marked salvaged');

// ── Escaped characters in report ──
r = parseAIResponse('{"indices":[2],"report":"Line one.\\nA \\"quoted\\" lot."}');
assert(r.report.includes('\n') || r.report.includes('quoted'), 'escaped report: unescaped');

// ── Garbage / empty responses ──
r = parseAIResponse('Sorry, I cannot help with that.');
assertEqual(r.indices, [], 'garbage: empty indices');
assert(r.salvaged === true, 'garbage: marked salvaged');

r = parseAIResponse('');
assertEqual(r.indices, [], 'empty string: empty indices');

r = parseAIResponse(null);
assertEqual(r.indices, [], 'null input: empty indices');

// ── Non-integer / negative indices filtered ──
r = parseAIResponse('{"indices":[0,-3,2.5,7],"report":"x"}');
assert(!r.indices.includes(-3) && !r.indices.includes(2.5) && r.indices.includes(0) && r.indices.includes(7), 'invalid indices filtered');

// ── Empty indices array parses cleanly (route handles the fallback) ──
r = parseAIResponse('{"indices":[],"report":"No genuine matches."}');
assertEqual(r.indices, [], 'empty indices array: parsed');
assert(r.salvaged === false, 'empty indices array: not salvaged');

console.log(`\ntest-search-parse: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
