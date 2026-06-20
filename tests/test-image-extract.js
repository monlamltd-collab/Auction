/**
 * image-extract — pure helper unit tests (no deps, no DB).
 *
 * Locks the two house-agnostic primitives the gallery sweep relies on:
 *   • extractImagesFromHtml — pull real <img> URLs, drop junk/data:/short/dupes
 *   • stripBleedImages      — gallery analogue of the persist-lots hero-bleed
 *                             guard: an image shared across >=N distinct lots
 *                             of the same house is site chrome, not a photo.
 */
import { extractImagesFromHtml, stripBleedImages, JUNK_IMG } from '../lib/pipeline/image-extract.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); pass++; }
  else { console.error(`  FAIL: ${msg}`); fail++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('extractImagesFromHtml');
{
  const html = [
    '<img src="https://x.com/upload/photo1.jpg">',
    '<img class="brand" src="https://x.com/assets/logo.png">',      // junk
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
  ]), 'extracts real imgs (src + data-src), absolutises relative, drops logo/data:/short/dupes');

  assert(JUNK_IMG.test('https://x.com/assets/logo.png'), 'JUNK_IMG flags a logo url');
  assert(!JUNK_IMG.test('https://x.com/upload/53944_IMG_01.jpg'), 'JUNK_IMG passes a real property photo url');

  const many = Array.from({ length: 12 }, (_, i) => `<img src="https://x.com/upload/p${i}.jpg">`).join('');
  assert(extractImagesFromHtml(many, 'https://x.com').length === 8, 'caps at 8 images by default');
  assert(extractImagesFromHtml(many, 'https://x.com', { max: 3 }).length === 3, 'honours custom max');
  assert(eq(extractImagesFromHtml('', 'https://x.com'), []), 'empty html -> []');
}

console.log('\nstripBleedImages (gallery hero-bleed guard, per house)');
{
  // Three lots of houseA all carry the same boilerplate `chrome` first frame
  // plus a unique real photo each — mirrors S&S sharing one webdadi PNG.
  const results = [
    { house: 'a', lotKey: 'a1', images: ['https://c/chrome.png', 'https://c/a1.jpg'] },
    { house: 'a', lotKey: 'a2', images: ['https://c/chrome.png', 'https://c/a2.jpg'] },
    { house: 'a', lotKey: 'a3', images: ['https://c/chrome.png', 'https://c/a3.jpg'] },
    // houseB shares the SAME url but only on 1 lot -> below threshold for B.
    { house: 'b', lotKey: 'b1', images: ['https://c/chrome.png', 'https://c/b1.jpg'] },
    // a pair in houseA below threshold must survive.
    { house: 'a', lotKey: 'a4', images: ['https://c/pair.jpg'] },
    { house: 'a', lotKey: 'a5', images: ['https://c/pair.jpg'] },
  ];
  const { bleedByHouse } = stripBleedImages(results, 3);

  assert(eq(results[0].images, ['https://c/a1.jpg']), 'strips chrome shared across 3 houseA lots');
  assert(eq(results[2].images, ['https://c/a3.jpg']), 'strips chrome from every affected houseA lot');
  assert(results.find(r => r.lotKey === 'b1').images.includes('https://c/chrome.png'),
    'houseB keeps the url — counted per house, only 1 lot there (below threshold)');
  assert(results.find(r => r.lotKey === 'a4').images.includes('https://c/pair.jpg'),
    'url shared by only 2 houseA lots survives (below threshold)');
  assert(bleedByHouse.get('a')?.has('https://c/chrome.png') === true, 'reports the bleed url for houseA');

  // No false positives when every image is unique.
  const clean = [
    { house: 'a', lotKey: 'x1', images: ['https://c/1.jpg', 'https://c/2.jpg'] },
    { house: 'a', lotKey: 'x2', images: ['https://c/3.jpg'] },
  ];
  const before = JSON.stringify(clean);
  stripBleedImages(clean, 3);
  assert(JSON.stringify(clean) === before, 'all-unique galleries untouched');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
