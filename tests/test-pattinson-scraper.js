// tests/test-pattinson-scraper.js — Pattinson in-page paginated scraper.
//
// The house was capped at ~17% recall: pattinson.co.uk is behind Cloudflare
// (a datacenter fetch gets a 403 "Just a moment") AND paginates ~1,780 lots
// across 90 FIXED pages of 20, so the render path's MAX_PUPPETEER_PAGES=15
// ceiling could only ever reach ~300 lots. lib/scraper/pattinson.js renders
// page 1 once to clear Cloudflare, then walks the site's own paged JSON
// endpoint from inside that session (the host-gated IN_PAGE_PAGINATORS hook in
// lib/scraper/crawlee.js) and maps the records deterministically. No AI.
//
// Two things these fixtures exist to pin:
//   1. The anti-leak contract. The 1,783-record catalogue is NOT all live — on
//      2026-07-21 it carried 59 records whose auction deadline had passed, 4 of
//      them flagged sold. None may ever be emitted as available.
//   2. The headline trap. 646 of 1,783 headlines read "Being Sold via Secure
//      Sale Online Bidding". normaliseLotStatuses re-greps `bullets` for
//      /\bSOLD\b/ and demotes any matching 'available' lot, so a headline that
//      reached bullets would have marked 36% of the house sold.
//
// Hermetic: no network, no Chromium. Fixtures mirror the live payload shape
// verified 2026-07-21 (field names, nested address, propertyImages gallery,
// blob.core.windows.net image URLs, trailing-comma houseNameNumber, the
// isOnlineAuction:false records that carry no deadline at all).

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const {
  isCurrentPattinsonLot,
  auctionDateIso,
  buildAddress,
  buildBullets,
  mapPattinsonItem,
  extractPattinsonLots,
  scrapePattinson,
  PATTINSON_CATALOGUE_URL,
} = await import('../lib/scraper/pattinson.js');
const { inPagePaginatorFor, collectPagedJson } = await import('../lib/scraper/crawlee.js');
const { normaliseLotStatuses } = await import('../lib/scraper/validation.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// 2026-07-21T12:00:00Z — mid-day so "ended earlier today" and "ends later
// today" are both expressible, which a date-only gate cannot tell apart.
const NOW = Date.parse('2026-07-21T12:00:00.000Z');

let _seq = 0;
const item = (over = {}) => {
  const id = over.id ?? 500000 + (++_seq);
  return {
    id,
    price: 50000,
    priceDescription: 'Starting Bid',
    tenure: 'Freehold',
    propertyTypeName: 'Terraced House',
    deadline: '2026-08-10T11:00:00.000Z',
    millisecondsRemaining: 1683258761,
    isAuction: true,
    isOnlineAuction: true,
    auctionBids: 0,
    headline: 'Ideal Investment Opportunity ',
    bedrooms: 2,
    bathrooms: 1,
    receptions: 1,
    image: `https://pattinson.blob.core.windows.net/paccess/property-images/${id}/1_w1048_h786.jpg`,
    propertyImages: [
      { thumbnail: `https://pattinson.blob.core.windows.net/paccess/property-images/${id}/1_w248_h186.jpg`, image: `https://pattinson.blob.core.windows.net/paccess/property-images/${id}/1_w1048_h786.jpg`, id: 1 },
      { thumbnail: `https://pattinson.blob.core.windows.net/paccess/property-images/${id}/2_w248_h186.jpg`, image: `https://pattinson.blob.core.windows.net/paccess/property-images/${id}/2_w1048_h786.jpg`, id: 2 },
    ],
    address: { houseNameNumber: '10', street: 'Linden Road', city: 'Bishop Auckland', county: 'Durham', postcode: 'DL14 6EP', country: 'GB' },
    isRental: false,
    hasGarden: false,
    parkingTypes: ['On Street'],
    chainFree: true,
    salesDescription: '2 bed terraced house to buy in DL14',
    ...over,
  };
};

console.log('Pattinson in-page paginated scraper — 100% of the live book, zero ended leak');

// ── 1. The anti-leak gate ────────────────────────────────────────────────
console.log('\nTest 1: isCurrentPattinsonLot — sold flag AND deadline, both required');
assert(isCurrentPattinsonLot(item(), NOW) === true, 'future deadline + not sold → current');
assert(isCurrentPattinsonLot(item({ isSold: true }), NOW) === false, 'isSold true → not current');
assert(isCurrentPattinsonLot(item({ deadline: '2026-07-20T11:00:00.000Z' }), NOW) === false,
  'deadline yesterday → not current (44 such records in the live feed)');
assert(isCurrentPattinsonLot(item({ deadline: '2026-07-21T09:00:00.000Z' }), NOW) === false,
  'ended EARLIER TODAY → not current (a date-only gate would leak it)');
assert(isCurrentPattinsonLot(item({ deadline: '2026-07-21T14:50:00.000Z' }), NOW) === true,
  'ends LATER TODAY → still current');
assert(isCurrentPattinsonLot(item({ isSold: true, deadline: '2026-09-01T11:00:00.000Z' }), NOW) === false,
  'SOLD with a FUTURE deadline → not current (a date-only gate would leak it)');
assert(isCurrentPattinsonLot(item({ deadline: undefined, isOnlineAuction: false }), NOW) === true,
  'NO deadline (in-room auction lot) → current — 28 live records, all schema.org InStock');
assert(isCurrentPattinsonLot(item({ deadline: 'not-a-date' }), NOW) === false,
  'unparseable deadline → not current (never guess)');
assert(isCurrentPattinsonLot(item({ isSold: false }), NOW) === true, 'isSold false is live, not ended');
assert(isCurrentPattinsonLot(null, NOW) === false, 'null → not current');
assert(isCurrentPattinsonLot({ price: 1 }, NOW) === false, 'record with no id → not current');
assert(auctionDateIso(item()) === '2026-08-10', `auctionDateIso (got ${auctionDateIso(item())})`);
assert(auctionDateIso(item({ deadline: undefined })) === '', 'no deadline → empty auction date, never a sentinel');

// ── 2. Address assembly ──────────────────────────────────────────────────
console.log('\nTest 2: buildAddress — the source\'s structured parts, no placeholders');
assert(buildAddress(item().address) === '10 Linden Road, Bishop Auckland, Durham, DL14 6EP',
  `number joins the street with a SPACE, not a comma (got "${buildAddress(item().address)}")`);
{
  // The source leaves its own separator on some houseNameNumber values.
  const a = buildAddress({ houseNameNumber: 'First Floor Flat, ', street: '29a Hastings Road', city: 'London', county: 'Greater London', postcode: 'W13 8QH' });
  assert(a === 'First Floor Flat, 29a Hastings Road, London, Greater London, W13 8QH', `trailing-comma houseNameNumber kept as its own separator (got "${a}")`);
}
{
  // county === city on some records ("The Case Public House, Horse fair, Wisbech, Wisbech, PE13 1AR")
  const a = buildAddress({ houseNameNumber: 'The Case Public House', street: 'Horse fair', city: 'Wisbech', county: 'Wisbech', postcode: 'PE13 1AR' });
  assert(a === 'The Case Public House Horse fair, Wisbech, PE13 1AR', `duplicate city/county collapsed (got "${a}")`);
}
{
  const a = buildAddress({ street: 'Rawling Road', locality: 'Bensham', city: 'Gateshead', county: 'Tyne and Wear', postcode: 'NE8 4QR' });
  assert(a === 'Rawling Road, Bensham, Gateshead, Tyne and Wear, NE8 4QR', `locality included when present (got "${a}")`);
}
assert(buildAddress(null) === '', 'missing address object → empty string, never a throw');

// ── 3. Bullets are curated facts — NEVER the headline ────────────────────
console.log('\nTest 3: bullets carry no status vocabulary (the 646-headline trap)');
{
  const b = buildBullets(item());
  assert(b.includes('Terraced House') && b.includes('2 bedrooms') && b.includes('1 bathroom') && b.includes('1 reception'),
    `structured facts present (got ${JSON.stringify(b)})`);
  assert(b.includes('Freehold') && b.includes('On Street parking') && b.includes('Chain free'), 'tenure / parking / chain-free bulleted');
  assert(!b.some(x => /\bsold\b/i.test(x)), 'no bullet contains "sold"');
  assert(!b.includes('Garden'), 'hasGarden false produces no bullet');
}
assert(buildBullets(item({ tenure: 'Unknown' })).every(b => b !== 'Unknown'), '"Unknown" tenure is the source\'s null, not a bullet');
assert(buildBullets(item({ tenure: 'ShareOfFreehold' })).includes('Share Of Freehold'), 'ShareOfFreehold de-camel-cased');
assert(buildBullets(item({ parkingTypes: ['None'] })).every(b => !/parking/i.test(b)), '"None" parking produces no bullet');
assert(buildBullets(item({ bedrooms: 1 })).includes('1 bedroom'), 'singular bedroom');
assert(buildBullets(item({ hasGarden: true })).includes('Garden'), 'garden bulleted when present');
{
  // Emptiness guard: normaliseScrapedLot folds `description` into bullets when
  // bullets is empty — and 36% of descriptions say "Being Sold via…". A record
  // with no structured facts at all must still produce a status-free bullet.
  const bare = { id: 1, salesDescription: 'land to buy in NE1', headline: 'Being Sold via Secure Sale Online Bidding' };
  const b = buildBullets(bare);
  assert(b.length > 0, 'bullets are never empty (guards the description fold-back)');
  assert(!b.some(x => /\bsold\b/i.test(x)), 'the emptiness fallback carries no status vocabulary either');
}

// ── 4. Field mapping ─────────────────────────────────────────────────────
console.log('\nTest 4: mapPattinsonItem — real fields, real gallery');
{
  const m = mapPattinsonItem(item({ id: 505675 }));
  assert(m.detail_url === 'https://www.pattinson.co.uk/property/505675', `detail url is /property/{id} (got "${m.detail_url}")`);
  assert(m.guide_price === 'Starting Bid £50,000', `price keeps the source's own label (got "${m.guide_price}")`);
  assert(m.image_url.includes('/property-images/505675/'), 'hero image is bound to this lot\'s own id');
  assert(m.images.length === 2, `gallery carried through (got ${m.images.length})`);
  assert(m.bedrooms === 2 && m.tenure === 'Freehold' && m.property_type === 'Terraced House', 'beds / tenure / type mapped');
  assert(m.auction_date === '2026-08-10', `auction date ISO (got "${m.auction_date}")`);
  assert(m.lot_status === 'available', 'current record maps to available');
  assert(m.lot_number === null, 'lot_number is null — the source publishes none (never a fabricated index)');
  assert(m.description === 'Ideal Investment Opportunity', 'headline becomes the narrative, whitespace-collapsed');
}
assert(mapPattinsonItem(item({ price: 0 })).guide_price === '', 'no price → empty priceText, never a fabricated £0');
assert(mapPattinsonItem(item({ tenure: 'Unknown' })).tenure === '', '"Unknown" tenure maps to empty, not the literal word');
{
  const noGallery = mapPattinsonItem(item({ propertyImages: [], image: 'https://pattinson.blob.core.windows.net/paccess/property-images/9/a.jpg' }));
  assert(noGallery.image_url.endsWith('/9/a.jpg') && noGallery.images.length === 1, 'hero survives an empty gallery');
}
{
  const junkImg = mapPattinsonItem(item({ image: 'not-a-url', propertyImages: [{ image: 'javascript:alert(1)' }] }));
  assert(junkImg.image_url === '' && junkImg.images.length === 0, 'non-http image values are dropped, not passed through');
}
{
  const many = mapPattinsonItem(item({ propertyImages: Array.from({ length: 20 }, (_, i) => ({ image: `https://pattinson.blob.core.windows.net/paccess/property-images/7/${i}.jpg` })), image: 'https://pattinson.blob.core.windows.net/paccess/property-images/7/0.jpg' }));
  assert(many.images.length === 8, `gallery capped at 8 (got ${many.images.length})`);
  assert(new Set(many.images).size === 8, 'hero is not duplicated inside the gallery');
}

// ── 5. End-to-end recall through normaliseScrapedLot ─────────────────────
// This is the count that matters — a record the walk "collected" but that
// normaliseScrapedLot rejects is not coverage.
console.log('\nTest 5: extractPattinsonLots — survives normaliseScrapedLot, no leak');
const FEED = [
  item({ id: 511111 }),
  item({ id: 522222, address: { houseNameNumber: '38', street: 'Rawling Road', city: 'Gateshead', county: 'Tyne and Wear', postcode: 'NE8 4QR' }, price: 54000, propertyTypeName: 'Flat' }),
  // in-room lot: no deadline, guide price, isOnlineAuction false — LIVE
  item({ id: 533333, deadline: undefined, isOnlineAuction: false, priceDescription: 'Guide Price ', price: 35999,
         address: { houseNameNumber: '', street: 'Marion Street', city: 'Sunderland', county: 'Tyne and Wear', postcode: 'SR2 8RG' } }),
  // ── ended cohort — none of these may ever be emitted ──
  item({ id: 900001, deadline: '2026-07-20T12:00:00.000Z', isSold: true }),            // sold + past
  item({ id: 900002, deadline: '2026-07-17T13:30:00.000Z', isSold: false }),           // unsold + past
  item({ id: 900003, deadline: '2026-07-21T09:00:00.000Z' }),                          // ended earlier today
  item({ id: 900004, deadline: '2026-09-01T11:00:00.000Z', isSold: true }),            // THE TRAP: sold, future-dated
];
const lots = extractPattinsonLots(FEED, { nowMs: NOW });
assert(lots.length === 3, `3 of 7 records survive — every current lot, nothing else (got ${lots.length})`);
assert(lots.every(l => l.status === 'available'), 'every emitted lot is available');
assert(!lots.some(l => /90000\d/.test(l.url)), 'no sold / past-dated / trap record emitted');
assert(lots.every(l => !l._auctionDate || l._auctionDate >= '2026-07-21'), 'no emitted lot is dated before today');
assert(lots.find(l => l.url.endsWith('533333'))._auctionDate === '',
  'the in-room lot ships with an EMPTY date (routes/search.js treats null as live), never a 2099 sentinel');
assert(lots.every(l => /^https:\/\/www\.pattinson\.co\.uk\/property\/\d+$/.test(l.url)), 'every url is a real lot page');
assert(lots.every(l => l.address.length > 10 && /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(l.address)), 'addresses are real postal addresses with postcodes');
assert(lots.every(l => l.price > 0 && l.priceText.includes('£')), 'prices are real numbers, not placeholders');
assert(lots.every(l => l.imageUrl.includes('blob.core.windows.net')), 'images are real source photos, not logos');
assert(new Set(lots.map(l => l.imageUrl)).size === lots.length, 'no hero-image bleed — each lot binds its own first photo');
assert(lots.every(l => l.imageUrl.includes(`/property-images/${l.url.split('/').pop()}/`)),
  'hero image path carries the lot\'s own id — an image cannot bleed from a neighbour');
assert(new Set(lots.map(l => l.url)).size === lots.length, 'no duplicate lot urls');
assert(lots[0].images.length === 2, 'gallery survives normalisation onto the canonical lot');
assert(lots.every(l => l._house === 'pattinson' && l._extractionSource === 'pattinson-inpage-api'), 'provenance stamped');
assert(lots.every(l => l._sourceUrl === PATTINSON_CATALOGUE_URL), 'catalogue url stamped');
assert(lots.find(l => l.url.endsWith('511111')).priceStatus === 'starting_bid',
  'the "Starting Bid" label reaches derivePriceStatus — not mislabelled as a guide');

console.log('\nTest 6: the persist-path status normaliser leaves every lot available');
{
  // persist-stage.js runs normaliseLotStatuses over the lots. It re-greps
  // bullets for /\bSOLD\b/ — the exact check the headline would have tripped.
  const hl = extractPattinsonLots(
    [item({ id: 544444, headline: "Being Sold via Secure Sale Online Bidding T&C's Apply" })],
    { nowMs: NOW },
  );
  assert(hl.length === 1 && /\bSold\b/.test(hl[0].description), 'the "Being Sold via…" headline IS preserved as the narrative');
  assert(!/\bsold\b/i.test((hl[0].bullets || []).join(' ')), 'but it never reaches bullets');
  normaliseLotStatuses(hl);
  assert(hl[0].status === 'available', 'so normaliseLotStatuses leaves it available (this trap hits 646/1783 live records)');
}

console.log('\nTest 7: dedup + junk tolerance');
assert(extractPattinsonLots([...FEED, ...FEED], { nowMs: NOW }).length === 3, 'duplicate records → deduped by id');
assert(extractPattinsonLots([], { nowMs: NOW }).length === 0, 'empty feed → 0 lots');
assert(extractPattinsonLots(null, { nowMs: NOW }).length === 0, 'null feed → 0 lots');
assert(extractPattinsonLots([{}, { id: 1 }, null], { nowMs: NOW }).length === 0, 'junk records → 0 lots, no throw');
assert(extractPattinsonLots([item({ address: {} })], { nowMs: NOW }).length === 0,
  'record with no address is rejected by normaliseScrapedLot, not shipped');

// ── 8. The host gate on the in-page paginator ────────────────────────────
console.log('\nTest 8: IN_PAGE_PAGINATORS is host-gated — one house, no fleet blast radius');
{
  const e = inPagePaginatorFor(PATTINSON_CATALOGUE_URL);
  assert(!!e, 'pattinson.co.uk resolves an in-page paginator');
  assert(e.endpoint === '/api/property/list-search' && e.method === 'POST', 'endpoint + verb as verified live');
  assert(e.pageParam === 'p' && e.envelope === 'properties.results' && e.itemsKey === 'items', 'paging + envelope config');
  assert(e.body.includeCommercial === true, 'includeCommercial stays true (false silently drops 403 lots)');
  assert(e.body.st === 'auction', 'search type scopes to auction lots');
  assert(typeof e.maxPages === 'number' && e.maxPages > 90, 'hard page cap is set and clears the ~90-page book');
  assert(typeof e.budgetMs === 'number' && e.budgetMs < 90000, 'wall-clock budget sits inside the 90s handler timeout');
  assert(inPagePaginatorFor('https://pattinson.co.uk/x') !== null, 'apex domain matches too');
  assert(inPagePaginatorFor('https://www.bondwolfe.com/auctions/properties/') === null, 'another fleet house → null (never enters this branch)');
  assert(inPagePaginatorFor('https://www.pattinson.co.uk.evil.com/') === null, 'look-alike host does not match');
  assert(inPagePaginatorFor('not-a-url') === null, 'malformed URL → null, never throws');
}

// ── 9. The page walk itself, against a stubbed endpoint ──────────────────
console.log('\nTest 9: collectPagedJson — walks to pageCount, dedups, early-stops, budgets');
const CFG = { ...inPagePaginatorFor(PATTINSON_CATALOGUE_URL) };
const withFetch = async (impl, fn) => {
  const prev = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = prev; }
};
const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
const envelope = (page, size, total) => {
  const pageCount = Math.ceil(total / size);
  const start = (page - 1) * size;
  const items = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({ id: start + i + 1 }));
  return { properties: { results: { pageCount, totalItemCount: total, pageNumber: page, pageSize: size, items } } };
};
{
  const seen = [];
  const out = await withFetch(async (url, opts) => {
    const p = JSON.parse(opts.body).p;
    seen.push(p);
    return jsonRes(envelope(p, 20, 1783));
  }, () => collectPagedJson(CFG));
  assert(out.items.length === 1783, `all 1783 records collected (got ${out.items.length})`);
  assert(out.pageCount === 90 && out.total === 1783, 'page count + total read off the source envelope');
  assert(out.fetched === 90 && seen.length === 90, `exactly 90 requests, no over-fetch (got ${seen.length})`);
  assert(new Set(seen).size === 90 && Math.min(...seen) === 1 && Math.max(...seen) === 90, 'pages 1..90 each requested once');
  assert(out.stopped === 'page_count' && out.error === null, 'stopped because the source said so');
  assert(new Set(out.items.map(i => i.id)).size === 1783, 'no page overlap');
}
{
  // A server that clamps an over-range page to the last one must not loop.
  const out = await withFetch(async (url, opts) => {
    const p = Math.min(JSON.parse(opts.body).p, 3);
    return jsonRes(envelope(p, 20, 1783));   // lies: claims 90 pages, serves 3
  }, () => collectPagedJson(CFG));
  assert(out.stopped === 'no_new_ids', `repeated page → dedup-saturation stop (got "${out.stopped}")`);
  assert(out.items.length === 60, `only the 60 distinct records kept (got ${out.items.length})`);
}
{
  const out = await withFetch(async (url, opts) => jsonRes(envelope(JSON.parse(opts.body).p, 20, 25)),
    () => collectPagedJson({ ...CFG, concurrency: 1 }));
  assert(out.items.length === 25 && out.fetched === 2, 'a short book stops on its own page count');
}
{
  const out = await withFetch(async () => jsonRes(envelope(1, 20, 0)), () => collectPagedJson(CFG));
  assert(out.items.length === 0 && out.stopped === 'empty_first_page', 'genuinely empty catalogue → 0 records, no throw');
}
{
  const out = await withFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }), () => collectPagedJson(CFG));
  assert(out.items.length === 0 && /HTTP 403/.test(out.error || ''), 'a Cloudflare 403 is reported on `error`, never swallowed');
}
{
  // Mid-walk failure keeps what it already has AND flags the error, so the
  // caller can tell "partial" from "broken" instead of losing the run.
  const out = await withFetch(async (url, opts) => {
    const p = JSON.parse(opts.body).p;
    if (p >= 10) throw new Error('ECONNRESET');
    return jsonRes(envelope(p, 20, 1783));
  }, () => collectPagedJson({ ...CFG, concurrency: 1 }));
  assert(out.items.length === 180 && /ECONNRESET/.test(out.error || ''), `partial walk keeps its records and reports the error (got ${out.items.length})`);
}
{
  const out = await withFetch(async () => jsonRes({ nope: true }), () => collectPagedJson(CFG));
  assert(out.items.length === 0 && /no envelope/.test(out.error || ''), 'a changed response shape is reported, not silently 0');
}
{
  const out = await withFetch(async (url, opts) => jsonRes(envelope(JSON.parse(opts.body).p, 20, 1783)),
    () => collectPagedJson({ ...CFG, maxPages: 5, concurrency: 1 }));
  assert(out.fetched === 5 && out.items.length === 100, 'maxPages hard-caps the walk (a pathological site cannot spin forever)');
}
{
  const out = await withFetch(async (url, opts) => {
    await new Promise(r => setTimeout(r, 12));
    return jsonRes(envelope(JSON.parse(opts.body).p, 20, 1783));
  }, () => collectPagedJson({ ...CFG, budgetMs: 30, concurrency: 1 }));
  assert(out.stopped === 'budget' && out.fetched < 90, `wall-clock budget stops the walk (fetched ${out.fetched}, stopped "${out.stopped}")`);
}

// ── 10. The scrape-stage entry point ─────────────────────────────────────
console.log('\nTest 10: scrapePattinson — never throws, never invents lots');
{
  const stub = async () => ({ html: '<html></html>', sourceURL: PATTINSON_CATALOGUE_URL, inPageData: { items: FEED, pageCount: 1, total: FEED.length, fetched: 1, stopped: 'page_count', error: null, elapsedMs: 5 } });
  const got = await scrapePattinson(PATTINSON_CATALOGUE_URL, { scrapeWithCrawlee: stub, nowMs: NOW });
  assert(got.length === 3, `end-to-end through the stage entry point (got ${got.length})`);
  assert(got.every(l => l.status === 'available' && l._house === 'pattinson'), 'normalised lots come straight out — no second extraction step');
}
{
  const stub = async () => ({ html: '', sourceURL: '' });   // hook did not run
  assert((await scrapePattinson(PATTINSON_CATALOGUE_URL, { scrapeWithCrawlee: stub })).length === 0, 'missing inPageData → 0 lots, no throw');
}
{
  const stub = async () => { throw new Error('Crawlee crawler died'); };
  assert((await scrapePattinson(PATTINSON_CATALOGUE_URL, { scrapeWithCrawlee: stub })).length === 0, 'render failure → 0 lots, no throw');
}
{
  const stub = async () => ({ inPageData: { items: [], pageCount: null, total: null, fetched: 0, stopped: 'evaluate_failed', error: 'boom' } });
  assert((await scrapePattinson(PATTINSON_CATALOGUE_URL, { scrapeWithCrawlee: stub })).length === 0, 'failed in-page walk → 0 lots, no throw');
}
{
  // Belt-and-braces: if the endpoint ever stops scoping to live lots and hands
  // back an all-ended page, the client-side gates must still hold the line.
  const ended = FEED.filter(i => /^90000/.test(String(i.id)));
  const stub = async () => ({ inPageData: { items: ended, pageCount: 1, total: ended.length, fetched: 1, stopped: 'page_count', error: null } });
  assert((await scrapePattinson(PATTINSON_CATALOGUE_URL, { scrapeWithCrawlee: stub, nowMs: NOW })).length === 0,
    'an all-ended payload yields 0 lots — the anti-leak gate is the guarantee, not the endpoint');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
