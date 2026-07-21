// tests/test-underthehammer-scraper.js — Under The Hammer JSON-API scraper.
//
// The house went dark (71 stale lots, 0 live) because underthehammer.com is a
// Next.js SPA: the catalogue page ships an empty shell and the AI extractor saw
// ~9 of 161 lots — then died outright with the AI quota. lib/scraper/underthehammer.js
// consumes the site's own /api/properties endpoint instead: deterministic, zero
// credits, no AI.
//
// The endpoint returns the WHOLE book (285 records today: 161 upcoming, 106 sold,
// 16 unsold, 2 withdrawn). The anti-leak contract — status === 'upcoming' AND a
// today-or-later auction end date, BOTH required — is what these fixtures exist
// to pin. A sold lot that still carries a future end date is a real record in
// today's feed and is the trap case below.
//
// Hermetic: no network. The fixture mirrors the live payload shape verified
// 2026-07-21 (field names, nested address, HTML description, blob.core.windows.net
// image URLs, embedded newline in address.street).

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const {
  mapUnderTheHammerProperty,
  isCurrentUnderTheHammerLot,
  extractUnderTheHammerLots,
  fetchUnderTheHammerProperties,
  auctionDateIso,
  UTH_CATALOGUE_URL,
} = await import('../lib/scraper/underthehammer.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const TODAY = '2026-07-21';

const prop = (over = {}) => ({
  id: 'a0YQ400000Z4P8XMAV',
  title: '30 Princes Street, DL4',
  status: 'upcoming',
  guidePrice: 30000,
  bedrooms: 2,
  bathrooms: 1,
  type: 'Terraced House',
  tenure: 'Freehold',
  occupied_status: 'Vacant',
  epc_rating: 'G',
  council_tax_band: null,
  completion_timescale: '28 days (4 weeks)',
  description: '<p>A freehold vacant 2 bedroom mid-terraced property.</p><p><br></p><p>Offered with vacant possession.</p>',
  images: [
    'https://advwebsaprod0.blob.core.windows.net/property-images/a0YQ400000Z4P8XMAV/84edd387.png',
    'https://advwebsaprod0.blob.core.windows.net/property-images/a0YQ400000Z4P8XMAV/7f0aae40.jpg',
  ],
  address: { street: '30 Princes Street', postalArea: 'DL4', postCode: 'DL4 1AX', city: 'Shildon', county: '' },
  auction: { id: 'a0ZQ40000086twTMAQ', startDate: '2026-08-12T08:00:00.000Z', endDate: '2026-08-12T11:00:00.000Z' },
  auctionEndsAt: '2026-08-12T11:00:00.000Z',
  ...over,
});

// A live book in miniature: 3 upcoming + every ended lifecycle the feed carries,
// including the sold-but-future-dated trap that a date-only gate would leak.
const FEED = [
  prop(),
  prop({
    id: 'a0YQ400000b8qKaMAI',
    // The source embeds a newline inside address.street.
    address: { street: '93 Doncaster Lane\nWoodlands', postCode: 'DN6 7LJ', city: 'Doncaster', county: '' },
    guidePrice: 35000, bedrooms: 3, type: 'Semi Detached House', council_tax_band: 'A',
    images: ['https://advwebsaprod0.blob.core.windows.net/property-images/a0YQ400000b8qKaMAI/e1.jpg'],
  }),
  prop({
    id: 'a0YQ400000bxSxRMAU',
    address: { street: "34 Cash's Lane", postCode: 'CV1 4DS', city: 'Coventry', county: '' },
    guidePrice: 39000, epc_rating: 'Ask Agent',
    images: ['https://advwebsaprod0.blob.core.windows.net/property-images/a0YQ400000bxSxRMAU/c9.jpg'],
    auction: { endDate: '2026-08-26T11:00:00.000Z' }, auctionEndsAt: '2026-08-26T11:00:00.000Z',
  }),
  // ── ended lifecycle — none of these may ever be emitted ──
  prop({ id: 'a0Yended000000SOLD', status: 'sold', soldPrice: 41000,
         auction: { endDate: '2026-06-24T11:00:00.000Z' }, auctionEndsAt: '2026-06-24T11:00:00.000Z' }),
  prop({ id: 'a0Yended00000UNSLD', status: 'unsold',
         auction: { endDate: '2026-06-24T11:00:00.000Z' }, auctionEndsAt: '2026-06-24T11:00:00.000Z' }),
  prop({ id: 'a0Yended0000WTHDRW', status: 'withdrawn',
         auction: { endDate: '2026-05-13T11:00:00.000Z' }, auctionEndsAt: '2026-05-13T11:00:00.000Z' }),
  // THE TRAP — sold, but the auction end date is still in the future. Present in
  // the real 2026-07-21 feed ("Robin's Nest, Church Street, Prees, SY13").
  prop({ id: 'a0YtrapSOLDFUTURE1', status: 'sold',
         auction: { endDate: '2026-07-28T11:00:00.000Z' }, auctionEndsAt: '2026-07-28T11:00:00.000Z' }),
  // Mirror trap — status upcoming but the auction has already ended (a stale
  // record the source forgot to reconcile). Gate 2 catches it.
  prop({ id: 'a0YtrapUPCOMINGOLD', status: 'upcoming',
         auction: { endDate: '2026-07-20T11:00:00.000Z' }, auctionEndsAt: '2026-07-20T11:00:00.000Z' }),
];

console.log('Under The Hammer JSON-API scraper — 100% of current lots, zero ended leak');

// ── 1. The anti-leak gate ────────────────────────────────────────────────
console.log('\nTest 1: isCurrentUnderTheHammerLot — status AND date, both required');
assert(isCurrentUnderTheHammerLot(prop(), TODAY) === true, 'upcoming + future end date → current');
assert(isCurrentUnderTheHammerLot(prop({ status: 'sold' }), TODAY) === false, 'sold → not current');
assert(isCurrentUnderTheHammerLot(prop({ status: 'unsold' }), TODAY) === false, 'unsold → not current');
assert(isCurrentUnderTheHammerLot(prop({ status: 'withdrawn' }), TODAY) === false, 'withdrawn → not current');
assert(
  isCurrentUnderTheHammerLot(prop({ status: 'sold', auctionEndsAt: '2026-07-28T11:00:00.000Z', auction: { endDate: '2026-07-28T11:00:00.000Z' } }), TODAY) === false,
  'SOLD with a FUTURE end date → not current (date-only gate would leak it)');
assert(
  isCurrentUnderTheHammerLot(prop({ auctionEndsAt: '2026-07-20T11:00:00.000Z', auction: { endDate: '2026-07-20T11:00:00.000Z' } }), TODAY) === false,
  'upcoming with a PAST end date → not current (status-only gate would leak it)');
assert(isCurrentUnderTheHammerLot(prop({ auctionEndsAt: TODAY + 'T11:00:00.000Z', auction: { endDate: TODAY + 'T11:00:00.000Z' } }), TODAY) === true,
  'auction ending TODAY is still current (>= today, not > today)');
assert(isCurrentUnderTheHammerLot(prop({ auction: {}, auctionEndsAt: null }), TODAY) === false, 'no auction date → not current');
assert(isCurrentUnderTheHammerLot(null, TODAY) === false, 'null → not current');
assert(auctionDateIso(prop()) === '2026-08-12', `auctionDateIso (got ${auctionDateIso(prop())})`);

// ── 2. Field mapping ─────────────────────────────────────────────────────
console.log('\nTest 2: mapUnderTheHammerProperty — real fields, no placeholders');
const m = mapUnderTheHammerProperty(prop());
assert(m.address === '30 Princes Street, Shildon, DL4 1AX',
  `full postal address, not the outward-code title (got "${m.address}")`);
assert(m.detail_url === 'https://www.underthehammer.com/property/a0YQ400000Z4P8XMAV',
  `detail url is /property/{id}, NOT /for-auction/{id} (got "${m.detail_url}")`);
assert(m.guide_price === '£30,000', `guide price formatted (got "${m.guide_price}")`);
assert(m.image_url.startsWith('https://advwebsaprod0.blob.core.windows.net/'), 'hero image is a real source photo');
assert(m.images.length === 2, `gallery carried through (got ${m.images.length})`);
assert(m.bedrooms === 2 && m.property_type === 'Terraced House' && m.tenure === 'Freehold', 'beds / type / tenure mapped');
assert(m.lot_status === 'available', 'current lot maps to available');
assert(m.auction_date === '2026-08-12', `auction date ISO (got "${m.auction_date}")`);
assert(!/<[a-z]/i.test(m.description) && /vacant possession/.test(m.description), 'description HTML stripped to text');
assert(m.lot_number === null, 'lot_number is null — the source publishes none (never a fabricated index)');

const mNewline = mapUnderTheHammerProperty(FEED[1]);
assert(mNewline.address === '93 Doncaster Lane Woodlands, Doncaster, DN6 7LJ',
  `embedded newline in address.street collapsed (got "${mNewline.address}")`);

// ── 3. Bullets must not carry the narrative ──────────────────────────────
// normaliseLotStatuses (lib/scraper/validation.js) re-greps bullets for /\bSOLD\b/
// and demotes any matching 'available' lot. 5 of today's 161 live descriptions say
// "sold" in prose, so folding the narrative into bullets would silently hide them.
console.log('\nTest 3: bullets are curated facts, never the narrative');
assert(!m.bullets.some(b => /\bsold\b/i.test(b)), 'no bullet contains "sold"');
assert(m.bullets.includes('Terraced House') && m.bullets.includes('Freehold') && m.bullets.includes('Vacant'),
  `structured facts present (got ${JSON.stringify(m.bullets)})`);
assert(m.bullets.includes('EPC G'), 'EPC band bulleted');
assert(!mapUnderTheHammerProperty(prop({ epc_rating: 'Ask Agent' })).bullets.some(b => /EPC/.test(b)),
  '"Ask Agent" EPC is not bulleted as a band');
assert(mNewline.bullets.includes('Council tax band A'), 'council tax band bulleted when present');
assert(!m.bullets.some(b => /council tax/i.test(b)), 'null council tax band produces no bullet');
{
  const narrative = mapUnderTheHammerProperty(prop({ description: '<p>Vacant house, sold with the benefit of planning.</p>' }));
  assert(!narrative.bullets.some(b => /\bsold\b/i.test(b)), 'a "sold"-containing narrative never reaches bullets');
  assert(/\bsold\b/i.test(narrative.description), 'but it IS preserved in description');
}

// ── 4. End-to-end recall through normaliseScrapedLot ─────────────────────
// This is the count that matters — a lot the recogniser "matched" but that
// normaliseScrapedLot rejects is not coverage.
console.log('\nTest 4: extractUnderTheHammerLots — survives normaliseScrapedLot, no leak');
const lots = extractUnderTheHammerLots(FEED, { todayIso: TODAY });
assert(lots.length === 3, `3 of 8 records survive — every current lot, nothing else (got ${lots.length})`);
assert(lots.every(l => l.status === 'available'), 'every emitted lot is available');
assert(lots.every(l => l._auctionDate >= TODAY), 'every emitted lot is dated today or later');
assert(lots.every(l => /^https:\/\/www\.underthehammer\.com\/property\/[A-Za-z0-9]{15,}$/.test(l.url)), 'every url is a real lot page');
assert(!lots.some(l => /ended|trap/i.test(l.url)), 'no sold / unsold / withdrawn / trap record emitted');
assert(lots.every(l => l.address && l.address.length > 10 && /[A-Z]{1,2}\d/.test(l.address)), 'addresses are real postal addresses');
assert(lots.every(l => l.price > 0 && l.priceText.startsWith('£')), 'prices are real numbers, not placeholders');
assert(lots.every(l => l.imageUrl.includes('blob.core.windows.net')), 'images are real source photos, not logos');
assert(new Set(lots.map(l => l.imageUrl)).size === lots.length,
  'no hero-image bleed — each lot binds its OWN first photo (fixture gives all 3 distinct galleries)');
assert(lots.every(l => l.imageUrl.includes(l.url.split('/').pop())),
  'hero image path carries the lot\'s own id — image cannot bleed from a neighbour');
assert(new Set(lots.map(l => l.url)).size === lots.length, 'no duplicate lot urls');
assert(lots[0].images.length === 2, 'gallery survives normalisation onto the canonical lot');
assert(lots.every(l => l._house === 'underthehammer' && l._extractionSource === 'underthehammer-api'), 'provenance stamped');

console.log('\nTest 5: dedup + junk tolerance');
assert(extractUnderTheHammerLots([...FEED, ...FEED], { todayIso: TODAY }).length === 3, 'duplicate records → deduped by id');
assert(extractUnderTheHammerLots([], { todayIso: TODAY }).length === 0, 'empty feed → 0 lots');
assert(extractUnderTheHammerLots(null, { todayIso: TODAY }).length === 0, 'null feed → 0 lots');
assert(extractUnderTheHammerLots([{}, { status: 'upcoming' }], { todayIso: TODAY }).length === 0, 'junk records → 0 lots, no throw');
assert(extractUnderTheHammerLots([prop({ address: { street: '', city: '', postCode: '' } })], { todayIso: TODAY }).length === 0,
  'record with no address is rejected by normaliseScrapedLot, not shipped');

// ── 6. Pagination against a stubbed endpoint ─────────────────────────────
console.log('\nTest 6: fetchUnderTheHammerProperties — paginates on skip until totalCount');
{
  const TOTAL = 285;
  const all = Array.from({ length: TOTAL }, (_, i) => prop({ id: `a0Ystub${String(i).padStart(11, '0')}` }));
  const seen = [];
  const stub = async (url) => {
    const u = new URL(url);
    const top = parseInt(u.searchParams.get('top'), 10);
    const skip = parseInt(u.searchParams.get('skip'), 10);
    seen.push(skip);
    return JSON.stringify({ properties: all.slice(skip, skip + top), totalCount: TOTAL });
  };
  const got = await fetchUnderTheHammerProperties(UTH_CATALOGUE_URL, { fetchPage: stub });
  assert(got.length === TOTAL, `all ${TOTAL} records fetched across pages (got ${got.length})`);
  assert(seen.length === 2 && seen[0] === 0 && seen[1] === 200, `skip walked 0,200 then stopped (got ${JSON.stringify(seen)})`);
  assert(new Set(got.map(p => p.id)).size === TOTAL, 'no page overlap');
}
{
  const stub = async () => { throw new Error('ECONNRESET'); };
  assert((await fetchUnderTheHammerProperties(UTH_CATALOGUE_URL, { fetchPage: stub })).length === 0, 'fetch failure → 0 records, no throw');
}
{
  const stub = async () => '<html>service unavailable</html>';
  assert((await fetchUnderTheHammerProperties(UTH_CATALOGUE_URL, { fetchPage: stub })).length === 0, 'non-JSON body → 0 records, no throw');
}
{
  // Belt-and-braces: if the server ever ignores ?status=upcoming and hands back
  // the whole book, the client-side gates must still hold the line.
  const stub = async () => JSON.stringify({ properties: FEED, totalCount: FEED.length });
  const got = await fetchUnderTheHammerProperties(UTH_CATALOGUE_URL, { fetchPage: stub });
  assert(extractUnderTheHammerLots(got, { todayIso: TODAY }).length === 3,
    'server ignoring status=upcoming still yields 0 ended lots');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
