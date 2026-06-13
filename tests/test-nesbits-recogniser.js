// tests/test-nesbits-recogniser.js — recogniseNesbitsLotsFromMarkdown (2026-06-13).
//
// Nesbits lists auction lots on /auctions as IMAGE-ONLY anchors
// (`[![](img)](/property/{slug}/{id}/)`), so the listing markdown has no inline
// address/price and the Gemini extractor returned 0 — a live 23 Jun 2026
// auction delivered NONE. The recogniser harvests the lot URLs and seeds the
// address from the slug; the first-contact deep-fetch fills price/date/beds.
//
// Contract: harvest every /property/{slug-with-postcode}/{id} link, derive a
// sensible address from the slug, reject non-lot /property/ nav links, dedup.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseNesbitsLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// Real listing shape (6 lots from the live 23 Jun 2026 catalogue) plus noise:
// a /property/for-sale/ nav link (no id, no postcode) and a bare nav anchor.
const MD = `
Skip to content

[![](https://nesbits.co.uk/media/a.jpg)](https://nesbits.co.uk/property/villiers-road-southsea-po5-2hg/1458716/)
[![](https://nesbits.co.uk/media/b.jpg)](https://nesbits.co.uk/property/percy-road-southsea-po4-0bh/1382387/)
[![](https://www.nesbits.co.uk/media/c.jpg)](https://www.nesbits.co.uk/property/eastney-road-southsea-po4-9jb/1172252/)
[![](https://nesbits.co.uk/media/d.jpg)](https://nesbits.co.uk/property/forton-road-gosport-po12-3hd/1457986/)
[![](https://nesbits.co.uk/media/e.jpg)](https://nesbits.co.uk/property/nelson-road-southsea-po5-2as/1466086/)
[![](https://nesbits.co.uk/media/f.jpg)](https://nesbits.co.uk/property/cottage-grove-southsea-po5-1en/1059663/)

[For Sale by Auction](https://nesbits.co.uk/property/for-sale/)
[Contact](https://nesbits.co.uk/contact/)
`;

console.log('Test 1: harvests all 6 lots, rejects nav links');
{
  const lots = recogniseNesbitsLotsFromMarkdown(MD);
  assert(lots.size === 6, `got ${lots.size} lots (expected 6 — nav links /for-sale/ + /contact/ rejected)`);
}

console.log('\nTest 2: address derived from slug (street words + postcode)');
{
  const lots = recogniseNesbitsLotsFromMarkdown(MD);
  const villiers = lots.get('1458716');
  assert(villiers && villiers.address === 'Villiers Road Southsea, PO5 2HG', `villiers address (got "${villiers && villiers.address}")`);
  const forton = lots.get('1457986');
  assert(forton && forton.address === 'Forton Road Gosport, PO12 3HD', `4-char outcode PO12 parsed (got "${forton && forton.address}")`);
}

console.log('\nTest 3: detail_url canonical (www, trailing slash) for the deep-fetch');
{
  const lots = recogniseNesbitsLotsFromMarkdown(MD);
  const percy = lots.get('1382387');
  assert(percy && percy.detail_url === 'https://www.nesbits.co.uk/property/percy-road-southsea-po4-0bh/1382387/', `detail_url (got "${percy && percy.detail_url}")`);
  assert(percy && percy.lot_status === 'available', 'status defaults to available');
}

console.log('\nTest 4: dedups by id (same lot linked by image + text)');
{
  const dup = MD + `\n[View](https://nesbits.co.uk/property/villiers-road-southsea-po5-2hg/1458716/)`;
  const lots = recogniseNesbitsLotsFromMarkdown(dup);
  assert(lots.size === 6, `still 6 after a duplicate link (got ${lots.size})`);
}

console.log('\nTest 5: empty / junk input is safe');
{
  assert(recogniseNesbitsLotsFromMarkdown('').size === 0, 'empty string → empty Map');
  assert(recogniseNesbitsLotsFromMarkdown(null).size === 0, 'null → empty Map');
  assert(recogniseNesbitsLotsFromMarkdown('no nesbits links here /property/foo').size === 0, 'no valid lot URLs → empty Map');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
