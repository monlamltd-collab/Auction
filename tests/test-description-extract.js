/**
 * description-extract — pure helper unit tests (no deps, no DB).
 *
 * Locks the house-agnostic narrative primitives:
 *   • extractDescriptionParas   — heading-anchored + container-scored + meta cascade
 *   • paraKey                   — stable cross-lot paragraph key
 *   • computeDescriptionBleed   — cross-lot boilerplate detector
 *   • assembleDescription       — bleed-strip + join + length guards
 *   • extractDescriptionFromHtml — one-shot convenience
 */
import {
  extractDescriptionParas, computeDescriptionBleed, assembleDescription,
  extractDescriptionFromHtml, paraKey, DESCRIPTION_MAX_CHARS,
  shouldUpgradeDescription, EXTRACT_HTML_CAP,
} from '../lib/pipeline/description-extract.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); pass++; }
  else { console.error(`  FAIL: ${msg}`); fail++; }
}

const NARRATIVE_1 = 'The property comprises a three bedroom semi detached house arranged over ground and first floors requiring a programme of refurbishment throughout.';
const NARRATIVE_2 = 'Situated in a popular residential location close to local shops, schools and mainline railway station with easy access to the city centre.';
const DISCLAIMER = 'All measurements are approximate and provided for guidance only, prospective purchasers should make their own enquiries before bidding.';
const BIDDING = 'To place a bid you must register for the auction and each bid increment is displayed on the bidding platform before you confirm.';

function page(body) {
  return `<!doctype html><html><head><meta property="og:description" content="A meta summary of this auction lot with enough length to count."></head><body><nav><ul><li>Home is where the heart is and this nav item is long</li></ul></nav>${body}<footer><p>Registered in England. Sutton Kersh is a trading name of Countrywide Estate Agents Limited with a very long footer sentence.</p></footer></body></html>`;
}

console.log('extractDescriptionParas — container-scored');
{
  const html = page(`<div class="property-description"><p>${NARRATIVE_1}</p><p>${NARRATIVE_2}</p><p>${DISCLAIMER}</p></div><div class="bid-help"><p>${BIDDING}</p></div>`);
  const paras = extractDescriptionParas(html);
  assert(paras.includes(NARRATIVE_1), 'narrative paragraph 1 extracted');
  assert(paras.includes(NARRATIVE_2), 'narrative paragraph 2 extracted');
  assert(!paras.includes(DISCLAIMER), 'disclaimer filtered by boilerplate regex');
  assert(!paras.some(p => p.includes('place a bid')), 'bidding help not extracted');
  assert(!paras.some(p => p.includes('Registered in England')), 'footer chrome removed');
}

console.log('extractDescriptionParas — heading-anchored (brochure pages, bare text nodes)');
{
  const html = page(`<div><p class="headline">A vacant freehold house</p><h4>Property Description</h4>${NARRATIVE_1} ${NARRATIVE_2}<h4>Accommodation</h4>Ground Floor: Hall, Reception Room, Kitchen. First Floor: Landing, Three Bedrooms, Bathroom with a white suite fitted.<h4>Pre-auction Offers</h4>Offers in excess of the guide price may be considered and each bid increment is displayed on the bidding platform.</div>`);
  const paras = extractDescriptionParas(html);
  const joined = paras.join(' ');
  assert(joined.includes('three bedroom semi detached'), 'narrative after Description heading captured');
  assert(joined.includes('Ground Floor: Hall'), 'Accommodation section captured');
  assert(!joined.includes('Pre-auction'), 'non-narrative heading section excluded');
}

console.log('extractDescriptionParas — headline-only description div must not beat content');
{
  const html = page(`<div class="PropertyHeader-description"><p>A vacant freehold semi detached property today</p></div><div class="lot-content"><p>${NARRATIVE_1}</p><p>${NARRATIVE_2}</p></div>`);
  const paras = extractDescriptionParas(html);
  assert(paras.includes(NARRATIVE_1), 'content container wins over 40-char hinted headline');
}

console.log('extractDescriptionParas — meta fallback');
{
  const html = page('<div><p>Short.</p></div>');
  const paras = extractDescriptionParas(html);
  assert(paras.length === 1 && paras[0].startsWith('A meta summary'), 'og:description fallback used when body yields nothing');
}

console.log('extractDescriptionParas — degenerate input');
{
  assert(extractDescriptionParas('').length === 0, 'empty html → []');
  assert(extractDescriptionParas(null).length === 0, 'null html → []');
  assert(extractDescriptionParas('<p>tiny</p>').length === 0, 'sub-200-char html → []');
}

console.log('paraKey');
{
  assert(paraKey('  Hello   World  ') === 'hello world', 'normalises whitespace + case');
  assert(paraKey('x'.repeat(300)) === 'x'.repeat(100), 'caps at 100 chars');
}

console.log('computeDescriptionBleed');
{
  const items = [
    { house: 'h1', paras: [NARRATIVE_1, 'Auction terms paragraph repeated on every single lot page of this house verbatim.'] },
    { house: 'h1', paras: [NARRATIVE_2, 'Auction terms paragraph repeated on every single lot page of this house verbatim.'] },
    { house: 'h1', paras: ['Another unique narrative about a bungalow with sea views and a generous garden plot.', 'Auction terms paragraph repeated on every single lot page of this house verbatim.'] },
    { house: 'h2', paras: ['Auction terms paragraph repeated on every single lot page of this house verbatim.'] },
  ];
  const bleed = computeDescriptionBleed(items, 3);
  const h1 = bleed.get('h1');
  assert(h1 && h1.has(paraKey('Auction terms paragraph repeated on every single lot page of this house verbatim.')), 'para on 3+ lots of same house is bleed');
  assert(h1 && !h1.has(paraKey(NARRATIVE_1)), 'unique narrative is not bleed');
  assert(!bleed.get('h2'), 'other house below threshold — no bleed set');
}

console.log('assembleDescription');
{
  const bleedSet = new Set([paraKey(DISCLAIMER)]);
  const text = assembleDescription([NARRATIVE_1, DISCLAIMER, NARRATIVE_2], bleedSet);
  assert(text.includes(NARRATIVE_1) && text.includes(NARRATIVE_2), 'narrative kept');
  assert(!text.includes('measurements'), 'bleed paragraph stripped');
  assert(text.includes('\n\n'), 'paragraphs joined with blank line');
  assert(assembleDescription(['short'], null) === null, 'below min chars → null');
  const long = assembleDescription(['A'.repeat(3000) + ' end', 'B'.repeat(3000) + ' end'], null);
  assert(long.length <= DESCRIPTION_MAX_CHARS + 1 && long.endsWith('…'), 'capped at max chars with ellipsis');
}

console.log('extractDescriptionFromHtml — one-shot');
{
  const html = page(`<div class="description"><p>${NARRATIVE_1}</p><p>${NARRATIVE_2}</p></div>`);
  const text = extractDescriptionFromHtml(html);
  assert(text && text.includes(NARRATIVE_1) && text.includes(NARRATIVE_2), 'one-shot returns assembled narrative');
  assert(extractDescriptionFromHtml('<html><body></body></html>') === null || extractDescriptionFromHtml('<html><body></body></html>').length >= 40, 'empty body → null or meta');
}

console.log('shouldUpgradeDescription — prefer-longer rule (sweep-side #194 mirror)');
{
  const rich = 'R'.repeat(400);
  const thin = 'T'.repeat(100);
  assert(shouldUpgradeDescription(null, rich) === true, 'no existing + real candidate → upgrade');
  assert(shouldUpgradeDescription('', rich) === true, 'empty existing → upgrade');
  assert(shouldUpgradeDescription(thin, rich) === true, 'longer candidate replaces shorter stored');
  assert(shouldUpgradeDescription(rich, thin) === false, 'shorter candidate NEVER clobbers richer stored');
  assert(shouldUpgradeDescription(rich, rich) === false, 'equal length → no churn');
  assert(shouldUpgradeDescription(null, 'x'.repeat(10)) === false, 'below MIN_CHARS → not narrative, no write');
  assert(shouldUpgradeDescription(thin, null) === false, 'null candidate → no write');
}

console.log('EXTRACT_HTML_CAP — huge SPA shells cannot OOM the parse');
{
  // Narrative in the head of the page, followed by multi-MB of script payload
  // (the shape that OOM-killed the prod process). The cap must bound the parse
  // while still extracting the narrative that sits before it.
  const hugeTail = '<script>' + 'x'.repeat(EXTRACT_HTML_CAP + 500_000) + '</script>';
  const html = page(`<div class="description"><p>${NARRATIVE_1}</p><p>${NARRATIVE_2}</p></div>`).replace('</body>', hugeTail + '</body>');
  const paras = extractDescriptionParas(html);
  assert(paras.some(p => p.includes('three bedroom semi detached')), 'narrative before the cap still extracted');
  assert(typeof EXTRACT_HTML_CAP === 'number' && EXTRACT_HTML_CAP <= 1_000_000, `cap exported and bounded (${EXTRACT_HTML_CAP})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
