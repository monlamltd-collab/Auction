// Hollis Morgan single-lot detail extractor
// URL pattern: https://www.hollismorgan.co.uk/property-details/{id}/...
// Shares CMS structure with Maggs & Allen and FSS Property.

import { extractAllShared, attr } from './_shared.js';

const HOLLIS_CHROME = /(?:^|\/)images\//i;
const isHollisRealPhoto = (src) => {
  if (src.includes('/resize/') || src.includes('/uploads/')) return true;
  return !HOLLIS_CHROME.test(src);
};

export default function extractHollismorgan(document) {
  const out = extractAllShared(document);

  if (Array.isArray(out.images)) out.images = out.images.filter(isHollisRealPhoto);

  const extra = [];
  const seen = new Set(out.images || []);
  const candidates = [
    ...document.querySelectorAll('.property-photos img'),
    ...document.querySelectorAll('.detail-gallery img'),
    ...document.querySelectorAll('img[src*="/resize/"]'),
    ...document.querySelectorAll('img[src*="/uploads/"]'),
  ];
  for (const img of candidates) {
    const src = attr(img, 'src') || attr(img, 'data-src');
    if (!src || seen.has(src)) continue;
    if (!isHollisRealPhoto(src)) continue;
    seen.add(src);
    extra.push(src);
  }
  out.images = [...(out.images || []), ...extra];

  return out;
}
