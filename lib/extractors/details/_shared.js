// lib/extractors/details/_shared.js — common detail-page helpers
// Maggs & Allen, Hollis Morgan and FSS Property share a common CMS pattern
// (per the comment in lib/houses.js). These helpers cover the overlap.

export function textOf(el) {
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

export function attr(el, name) {
  return el ? (el.getAttribute(name) || '').trim() : '';
}

export function metaContent(document, property) {
  const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return el ? attr(el, 'content') : '';
}

export function extractAddress(document) {
  // Strategy 1: og:title
  const og = metaContent(document, 'og:title');
  if (og && og.length >= 5) return og.replace(/\s*[|-]\s*Maggs.*$/i, '').replace(/\s*[|-]\s*Hollis.*$/i, '').replace(/\s*[|-]\s*FSS.*$/i, '').trim();
  // Strategy 2: H1
  const h1 = textOf(document.querySelector('h1'));
  if (h1 && h1.length >= 5) return h1;
  // Strategy 3: <title>
  const t = textOf(document.querySelector('title'));
  if (t) return t.split(/\s*[|-]\s*/)[0].trim();
  return '';
}

export function extractImages(document) {
  // Common gallery/carousel selectors used by these CMSes
  const selectors = [
    '.gallery img',
    '.property-images img',
    '.photo-gallery img',
    '.slick-slide img',
    '.carousel img',
    '.image-gallery img',
    'img[itemprop="image"]',
    '.lot-images img',
    '#gallery img',
  ];
  const out = [];
  const seen = new Set();
  for (const sel of selectors) {
    const imgs = document.querySelectorAll(sel);
    for (const img of imgs) {
      const src = attr(img, 'src') || attr(img, 'data-src') || attr(img, 'data-lazy-src') || attr(img, 'data-original');
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push(src);
    }
    if (out.length >= 8) break;
  }
  // Fallback: og:image
  if (out.length === 0) {
    const og = metaContent(document, 'og:image');
    if (og) out.push(og);
  }
  return out;
}

export function extractBullets(document) {
  // Feature lists, key features, summary bullets
  const selectors = [
    '.features li',
    '.key-features li',
    '.property-features li',
    '.summary li',
    '.features-list li',
    'ul.bullets li',
    '.lot-features li',
  ];
  const out = [];
  const seen = new Set();
  for (const sel of selectors) {
    const items = document.querySelectorAll(sel);
    for (const li of items) {
      const t = textOf(li);
      if (!t || t.length < 3 || t.length > 200 || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    if (out.length >= 12) break;
  }
  return out;
}

export function extractPrice(document) {
  // Try definition-list / table key-value first ("Guide Price: £xxx")
  const text = (document.body && document.body.textContent) || '';
  const guideMatch = text.match(/(?:guide\s*price|starting\s*bid|reserve)\s*[:\-]?\s*£\s*([\d,]+)/i);
  if (guideMatch) {
    const n = parseInt(guideMatch[1].replace(/,/g, ''), 10);
    if (n >= 1000 && n <= 50000000) return { price: n };
  }
  if (/\b(?:price\s+on\s+application|p\.?o\.?a\.?|to\s+be\s+advised|t\.?b\.?a\.?|offers?\s+invited|by\s+negotiation)\b/i.test(text)) {
    return { price: null, priceText: 'POA' };
  }
  return {};
}

export function extractTenure(document) {
  const text = (document.body && document.body.textContent) || '';
  if (/share\s+of\s+freehold/i.test(text)) return 'Share of Freehold';
  if (/\bleasehold\b/i.test(text) && !/\bfreehold\b/i.test(text)) return 'Leasehold';
  if (/\bfreehold\b/i.test(text) && !/\bleasehold\b/i.test(text)) return 'Freehold';
  return '';
}

export function extractPropType(document) {
  const text = (document.body && document.body.textContent || '').toLowerCase();
  if (/\b(?:flat|apartment|maisonette|studio\s+flat|penthouse)\b/.test(text)) return 'flat';
  if (/\b(?:terraced|semi[- ]detached|detached\s+house|town\s*house|cottage|bungalow|villa)\b/.test(text)) return 'house';
  if (/\b(?:land|plot|garage|parking\s+space)\b/.test(text)) return 'land';
  if (/\b(?:shop|retail|office|warehouse|industrial|commercial|pub|hotel)\b/.test(text)) return 'commercial';
  return '';
}

export function extractBeds(document) {
  const text = (document.body && document.body.textContent) || '';
  const m = text.match(/\b(\d{1,2})\s*[-\s]?bed(?:room)?s?\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20) return n;
  }
  if (/\bstudio\b/i.test(text)) return 0;
  return null;
}

export function extractPostcode(document) {
  const text = (document.body && document.body.textContent) || '';
  const m = text.match(/\b([A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2})\b/);
  return m ? m[1].toUpperCase().replace(/\s+/g, ' ') : '';
}

export function extractVacant(document) {
  const text = (document.body && document.body.textContent || '').toLowerCase();
  if (/vacant\s+possession|currently\s+vacant|sold\s+with\s+vacant/.test(text)) return true;
  if (/let|tenanted|tenant\s+in\s+situ|sitting\s+tenant|rental\s+income/.test(text)) return false;
  return null;
}

// Combined — most callers want the full lot in one go
export function extractAllShared(document) {
  const out = {
    address: extractAddress(document),
    images: extractImages(document),
    bullets: extractBullets(document),
    tenure: extractTenure(document),
    propType: extractPropType(document),
    beds: extractBeds(document),
    postcode: extractPostcode(document),
  };
  const vacant = extractVacant(document);
  if (vacant !== null) out.vacant = vacant;
  Object.assign(out, extractPrice(document));
  return out;
}
