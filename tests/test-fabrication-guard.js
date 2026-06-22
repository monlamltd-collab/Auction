// tests/test-fabrication-guard.js — detectFabricatedBatch (anti-hallucination guard).
const { detectFabricatedBatch, PLACEHOLDER_ADDRESS_RE } = await import('../lib/scraper/validation.js');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

// Fabricated batch: blatant placeholder town names + the impossible AT1 demo
// postcode (the SDL Auctions 2026-06 hallucination shape). Every lot is unambiguous.
const fake = [
  { address: '1 High Street, Anytown, AT1 1AD', url: 'https://www.sdlauctions.co.uk/auction/lot1/' },
  { address: '2 Market Square, Sometown, AT1 1AB', url: 'https://www.sdlauctions.co.uk/auction/2' },
  { address: '3 Church Lane, Exampletown, EX1 1AA', url: 'https://www.sdlauctions.co.uk/property-detail/3' },
  { address: '4 The Green, Sampletown, S1 1AA', url: 'https://www.sdlauctions.co.uk/auction/lot4/' },
  { address: '5 Mill Road, Placeholdertown, P1 1AA', url: 'https://www.sdlauctions.co.uk/auction/lot5/' },
];
assert(detectFabricatedBatch(fake).flagged === true, 'fabricated placeholder-town batch is flagged');

// Real batch: genuine varied addresses (must NOT be flagged). INCLUDES real
// tree-named streets ("Elm Road", "Willow Close", "Oak Drive") to lock the
// false-positive fix — the guard must never key on street name. Real lots also
// use /property/{id}/ URLs, proving the guard does not key on URL shape either.
const real = [
  { address: '12 Elm Road, Streatham, London SW16 6NX', url: 'https://x/property/50979/' },
  { address: '2 Willow Close, Nottingham NG5 4JA', url: 'https://x/property/50931/' },
  { address: '5 Oak Drive, Huddersfield HD4 6XF', url: 'https://x/property/50863/' },
  { address: '34-40 Bridge Street, Bury BL9 6HH', url: 'https://x/property/50980/' },
  { address: 'Flat 12, 53-55 Lancaster Gate, London W2 3NA', url: 'https://x/property/50864/' },
];
assert(detectFabricatedBatch(real).flagged === false, 'real varied batch (incl. tree-named streets) is NOT flagged');

// Direct regex assertions: a placeholder town/postcode matches, a real tree-named
// street does NOT — this is the false-positive fix locked at the regex level.
assert(PLACEHOLDER_ADDRESS_RE.test('4 Willow Close, Anytown, AT1 1AD') === true, 'regex matches placeholder town/postcode');
assert(PLACEHOLDER_ADDRESS_RE.test('12 Elm Road, Streatham, London SW16 6NX') === false, 'regex does NOT match a real tree-named street');

// Safety: too-small batch is never flagged (insufficient confidence).
assert(detectFabricatedBatch(fake.slice(0, 2)).flagged === false, 'batch < 5 lots never flagged');
assert(detectFabricatedBatch([]).flagged === false, 'empty batch safe');
assert(detectFabricatedBatch(null).flagged === false, 'null safe');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
