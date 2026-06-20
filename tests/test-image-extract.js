/**
 * image-extract — pure helper unit tests (no deps, no DB).
 *
 * Locks the house-agnostic image primitives:
 *   • isChromeUrl          — unambiguous non-photo chrome (tokens + .svg/.gif)
 *   • extractImagesFromHtml — pull real <img> URLs, drop chrome/data:/short/dupes
 *   • computeBleedByHouse  — cross-lot repetition detector
 *   • stripBleedImages     — strip bleed from sweep galleries (uses the above)
 *   • dechromeGallery      — clean one lot's gallery + promote a real thumbnail
 */
import {
  extractImagesFromHtml, stripBleedImages, computeBleedByHouse,
  dechromeGallery, isChromeUrl, JUNK_IMG,
} from '../lib/pipeline/image-extract.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); pass++; }
  else { console.error(`  FAIL: ${msg}`); fail++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('isChromeUrl');
{
  // Real property photos — must NOT be chrome.
  for (const u of [
    'https://www.futurepropertyauctions.co.uk/upload/53944_14506729_IMG_01.jpg',
    'https://cdn.webdadi.net/Media/image/l/478647cb.jpg',
    'https://www.maggsandallen.co.uk/resize/34648679/0/850',
  ]) assert(!isChromeUrl(u), `real photo not chrome: ${u.slice(0, 48)}…`);

  // Unambiguous chrome — must be flagged.
  for (const u of [
    'https://maps.gstatic.com/tactile/basepage/loader_beige_2x.gif',     // gif + loader + gstatic
    'https://cdn.eigpropertyauctions.co.uk/ams/images/538/oas/Menu.svg', // svg + /oas/
    'https://drivers.co.uk/.../thumbs/Propertymark-logo.png',             // propertymark
    'https://www.maggsandallen.co.uk/images/naea.png.pagespeed.ce.x.png', // naea
    'https://www.maggsandallen.co.uk/images/Open-for-Business.jpg',       // open-for-business
    'https://www.philliparnoldauctions.co.uk/images/map-marker.svg',     // svg + map-marker
    'https://www.iamsold.co.uk/.../Cyber-Essentials-badge.png',          // cyber essentials
    'https://i.vimeocdn.com/portrait/1790141_60x60',                     // vimeocdn
  ]) assert(isChromeUrl(u), `chrome flagged: ${u.slice(0, 48)}…`);

  assert(isChromeUrl('') === true && isChromeUrl(null) === true, 'empty/null treated as non-photo');
}

console.log('\nextractImagesFromHtml');
{
  const html = [
    '<img src="https://x.com/upload/photo1.jpg">',
    '<img class="brand" src="https://x.com/assets/logo.png">',      // junk token
    '<img src="https://x.com/icons/Menu.svg">',                     // svg chrome
    '<img src="https://maps.gstatic.com/loader.gif">',              // gif chrome
    '<img src="data:image/png;base64,AAAA">',                        // data:
    '<img src="/x">',                                                // too short
    '<img data-src="https://x.com/upload/photo2.jpg">',              // lazy attr
    '<img src="https://x.com/upload/photo1.jpg">',                   // dup
    '<img src="/upload/relative-photo.jpg">',                        // relative -> absolutised
  ].join('\n');
  const imgs = extractImagesFromHtml(html, 'https://x.com');
  assert(eq(imgs, [
    'https://x.com/upload/photo1.jpg',
    'https://x.com/upload/photo2.jpg',
    'https://x.com/upload/relative-photo.jpg',
  ]), 'drops logo/svg/gif/data:/short/dupes; keeps real photos');

  assert(JUNK_IMG.test('https://x.com/assets/logo.png'), 'JUNK_IMG still flags a logo url');
  const many = Array.from({ length: 12 }, (_, i) => `<img src="https://x.com/upload/p${i}.jpg">`).join('');
  assert(extractImagesFromHtml(many, 'https://x.com').length === 8, 'caps at 8 images by default');
  assert(eq(extractImagesFromHtml('', 'https://x.com'), []), 'empty html -> []');
}

console.log('\ncomputeBleedByHouse (generic repetition, per house)');
{
  const items = [
    { house: 'a', lotKey: 1, urls: ['c', 'a1'] },
    { house: 'a', lotKey: 2, urls: ['c', 'a2'] },
    { house: 'a', lotKey: 3, urls: ['c', 'a3'] },   // c now on 3 distinct lots
    { house: 'a', lotKey: 4, urls: ['pair', 'x'] },
    { house: 'a', lotKey: 5, urls: ['pair'] },       // pair only 2 -> survives
    { house: 'b', lotKey: 6, urls: ['c'] },          // c on 1 lot for b
  ];
  const bleed = computeBleedByHouse(items, 3);
  assert(bleed.get('a')?.has('c') === true, 'flags url across 3 lots of house a');
  assert(bleed.get('a')?.has('pair') !== true, 'pair (2 lots) below threshold not flagged');
  assert(!bleed.has('b'), 'house b unaffected (1 lot) — counted per house');
}

console.log('\nstripBleedImages (sweep gallery guard)');
{
  const results = [
    { house: 'a', lotKey: 'a1', images: ['https://c/chrome.png', 'https://c/a1.jpg'] },
    { house: 'a', lotKey: 'a2', images: ['https://c/chrome.png', 'https://c/a2.jpg'] },
    { house: 'a', lotKey: 'a3', images: ['https://c/chrome.png', 'https://c/a3.jpg'] },
  ];
  const { bleedByHouse } = stripBleedImages(results, 3);
  assert(eq(results[0].images, ['https://c/a1.jpg']), 'strips repeated chrome from house galleries');
  assert(bleedByHouse.get('a')?.has('https://c/chrome.png') === true, 'reports the bleed url');
}

console.log('\ndechromeGallery (per-lot clean + thumbnail promotion)');
{
  // Chrome-led gallery, thumbnail is the chrome svg -> promote first real photo.
  const r1 = dechromeGallery(
    ['https://x/Menu.svg', 'https://x/upload/realA.jpg', 'https://x/upload/realB.jpg'],
    'https://x/Menu.svg',
  );
  assert(eq(r1.images, ['https://x/upload/realA.jpg', 'https://x/upload/realB.jpg']), 'drops chrome svg from gallery');
  assert(r1.imageUrl === 'https://x/upload/realA.jpg', 'promotes first real photo to thumbnail');
  assert(r1.changed === true, 'reports changed');

  // Bleed thumbnail (per-house placeholder) replaced by real photo.
  const r2 = dechromeGallery(
    ['https://x/textslide.png', 'https://x/upload/realA.jpg'],
    'https://x/textslide.png',
    new Set(['https://x/textslide.png']),
  );
  assert(eq(r2.images, ['https://x/upload/realA.jpg']) && r2.imageUrl === 'https://x/upload/realA.jpg',
    'bleed url stripped from gallery + thumbnail');

  // Already-clean lot is untouched.
  const r3 = dechromeGallery(['https://x/upload/a.jpg', 'https://x/upload/b.jpg'], 'https://x/upload/a.jpg');
  assert(r3.changed === false && r3.imageUrl === 'https://x/upload/a.jpg', 'clean lot unchanged');

  // A real thumbnail not present in the gallery is preserved (not chrome/bleed).
  const r4 = dechromeGallery(['https://x/upload/b.jpg'], 'https://x/upload/realThumb.jpg');
  assert(r4.imageUrl === 'https://x/upload/realThumb.jpg', 'real thumbnail preserved even if not in gallery');

  // All-chrome gallery -> empty + null thumbnail.
  const r5 = dechromeGallery(['https://x/a.svg', 'https://x/loader.gif'], 'https://x/a.svg');
  assert(eq(r5.images, []) && r5.imageUrl === null, 'all-chrome -> empty gallery + null thumbnail');

  // Missing thumbnail gets promoted from a clean gallery.
  const r6 = dechromeGallery(['https://x/upload/a.jpg'], null);
  assert(r6.imageUrl === 'https://x/upload/a.jpg' && r6.changed === true, 'null thumbnail promoted from gallery');
}

console.log('\ndechromeGallery — never blank via the repetition heuristic (safety guard)');
{
  const bleed = new Set(['https://c/shared.jpg', 'https://c/shared2.jpg']);

  // A single bleed-only image (could be a real photo shared across a development)
  // is KEPT, not blanked.
  const g1 = dechromeGallery(['https://c/shared.jpg'], 'https://c/shared.jpg', bleed);
  assert(eq(g1.images, ['https://c/shared.jpg']) && g1.imageUrl === 'https://c/shared.jpg' && g1.changed === false,
    'bleed-only single image kept (guard) — a real shared photo is never destroyed');

  // An all-bleed multi-image gallery is kept entirely (no real survivor to keep).
  const g2 = dechromeGallery(['https://c/shared.jpg', 'https://c/shared2.jpg'], 'https://c/shared.jpg', bleed);
  assert(g2.images.length === 2, 'all-bleed multi-image gallery kept (guard) — no blanking');

  // Token-chrome IS removed even when bleed must be kept; thumbnail promoted to the kept image.
  const g3 = dechromeGallery(['https://x/logo.svg', 'https://c/shared.jpg'], 'https://x/logo.svg', bleed);
  assert(eq(g3.images, ['https://c/shared.jpg']) && g3.imageUrl === 'https://c/shared.jpg',
    'token-chrome stripped, bleed kept as last image, thumbnail promoted to it');

  // Bleed IS removed once a non-bleed real image survives.
  const g4 = dechromeGallery(['https://c/shared.jpg', 'https://x/upload/real.jpg'], 'https://c/shared.jpg', bleed);
  assert(eq(g4.images, ['https://x/upload/real.jpg']) && g4.imageUrl === 'https://x/upload/real.jpg',
    'bleed removed + thumbnail re-pointed when a real survivor exists');

  // Token-chrome MAY blank (lot then becomes under-target → sweep refetches).
  const g5 = dechromeGallery(['https://x/a.svg', 'https://x/loader.gif'], 'https://x/a.svg', bleed);
  assert(eq(g5.images, []) && g5.imageUrl === null, 'all-token-chrome still blanks (sweep will refill)');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
