// FSS Property (Feather Smailes & Scales) single-lot detail extractor
// Shares CMS structure with Maggs & Allen and Hollis Morgan.

import { extractAllShared, attr } from './_shared.js';

const FSS_CHROME = /(?:^|\/)images\//i;
const isFssRealPhoto = (src) => {
  if (src.includes('/resize/') || src.includes('/uploads/')) return true;
  return !FSS_CHROME.test(src);
};

export default function extractFssproperty(document) {
  const out = extractAllShared(document);

  if (Array.isArray(out.images)) out.images = out.images.filter(isFssRealPhoto);

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
    if (!isFssRealPhoto(src)) continue;
    seen.add(src);
    extra.push(src);
  }
  out.images = [...(out.images || []), ...extra];

  return out;
}
