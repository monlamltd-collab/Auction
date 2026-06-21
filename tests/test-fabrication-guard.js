// tests/test-fabrication-guard.js — detectFabricatedBatch (anti-hallucination guard).
const { detectFabricatedBatch } = await import('../lib/scraper/validation.js');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

// Fabricated batch: synthetic template addresses (the real SDL hallucination shape).
const fake = [
  { address: '456 Elm Street, Manchester, M1 2AB', url: 'https://www.sdlauctions.co.uk/auction/lot2/' },
  { address: '4 Willow Close, Anytown, AT1 1AD', url: 'https://www.sdlauctions.co.uk/auction/4' },
  { address: '321 Oak Road, Bristol, BS1 4AA', url: 'https://www.sdlauctions.co.uk/property-detail/5' },
  { address: '202 Maple Close, Leeds, LS1 5GH', url: 'https://www.sdlauctions.co.uk/auction/lot5/' },
  { address: '707 Poplar Drive, Newcastle, NE2 3RT', url: 'https://www.sdlauctions.co.uk/auction/lot10/' },
];
assert(detectFabricatedBatch(fake).flagged === true, 'fabricated template batch is flagged');

// Real batch: genuine varied addresses (must NOT be flagged) — real lots also use
// /property/{id}/ URLs, proving the guard does not key on URL shape.
const real = [
  { address: 'Land east of Bolton Road, Wigan, Greater Manchester WN2 5LB', url: 'https://www.btgeddisonspropertyauctions.com/properties/202603121017sq_9hc9-220626/for-auction-wigan' },
  { address: 'Former Trinity Methodist Church, Chapel Street, Woodhouse, Sheffield S13 7JL', url: 'https://x/property/50979/land-for-auction-sheffield/' },
  { address: '34-40 Bridge Street, Bury, Lancashire BL9 6HH', url: 'https://x/property/50931/' },
  { address: 'Flat 12, 53-55 Lancaster Gate, London W2 3NA', url: 'https://x/property/50863/' },
  { address: 'Bungalow & Land, Kelvin, 1 Backmoor Road, Sheffield S8 8LB', url: 'https://x/property/50980/' },
];
assert(detectFabricatedBatch(real).flagged === false, 'real varied batch is NOT flagged');

// Safety: too-small batch is never flagged (insufficient confidence).
assert(detectFabricatedBatch(fake.slice(0, 2)).flagged === false, 'batch < 5 lots never flagged');
assert(detectFabricatedBatch([]).flagged === false, 'empty batch safe');
assert(detectFabricatedBatch(null).flagged === false, 'null safe');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
