// tests/test-extraction-chunking.js — content chunking that prevents the 16k
// output-cap truncation on dense catalogues (THE 100% COMMANDMENT). A dense
// page must be split so no single extraction call truncates and drops lots.

import { chunkContent } from '../lib/scraper/extraction.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('\nchunkContent: small content is a single call (no behaviour change)');
{
  assert(chunkContent('short catalogue', 55000).length === 1, 'tiny input → 1 chunk');
  const exact = 'a'.repeat(55000);
  assert(chunkContent(exact, 55000).length === 1, 'input == maxChars → 1 chunk');
  assert(chunkContent('', 55000).length === 1, 'empty input → 1 chunk (empty string)');
}

console.log('\nchunkContent: oversized content is split under the cap');
{
  // Build 130k chars with frequent newlines (mimics a dense markdown catalogue).
  const dense = Array.from({ length: 130000 }, (_, i) => (i % 800 === 0 ? '\n' : 'x')).join('');
  const chunks = chunkContent(dense, 55000, 2500);
  assert(chunks.length >= 3, `130k chars → ${chunks.length} chunks (>=3)`);
  assert(chunks.every(c => c.length <= 55000), 'every chunk <= maxChars (no call will truncate)');
  // Full coverage: every character index appears in some chunk (overlap allowed).
  assert(chunks.join('').length >= dense.length, 'chunks cover the whole content (>= original length, overlap ok)');
}

console.log('\nchunkContent: overlap so a lot straddling a split survives whole');
{
  const dense = ('LOT\n' + 'y'.repeat(796) + '\n').repeat(200); // ~160k, uniform lot blocks
  const chunks = chunkContent(dense, 55000, 2500);
  // Each chunk's first `overlap` chars equal the previous chunk's last `overlap`
  // chars — so a lot near a split appears whole in at least one chunk.
  let overlaps = 0;
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].slice(0, 2500) === chunks[i - 1].slice(-2500)) overlaps++;
  }
  assert(overlaps === chunks.length - 1, 'every adjacent chunk pair overlaps by the overlap window (boundary lots survive)');
}

console.log('\nchunkContent: terminates on adversarial input (no infinite loop)');
{
  const noNewlines = 'z'.repeat(300000); // no newline to snap to
  const chunks = chunkContent(noNewlines, 55000, 2500);
  assert(chunks.length > 0 && chunks.length < 100, `no-newline 300k → ${chunks.length} chunks, terminates`);
  assert(chunks.every(c => c.length <= 55000), 'no-newline chunks still <= maxChars');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
