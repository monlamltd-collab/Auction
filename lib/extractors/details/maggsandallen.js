// Maggs & Allen single-lot detail extractor
// URL pattern: https://www.maggsandallen.co.uk/property-details/{id}/-/{town}/{slug}
// CMS shared with Hollis Morgan and FSS Property.

import { extractAllShared, attr, textOf } from './_shared.js';

// Maggs CMS chrome lives at /images/ root (logos, sprites). Real photos live
// under /resize/ or /uploads/. Strip the chrome wherever it appears.
const MAGGS_CHROME = /(?:^|\/)images\//i;
const isMaggsRealPhoto = (src) => {
  if (src.includes('/resize/') || src.includes('/uploads/')) return true;
  return !MAGGS_CHROME.test(src);
};

export default function extractMaggsandallen(document) {
  const out = extractAllShared(document);

  // Filter shared output through Maggs-specific chrome rules
  if (Array.isArray(out.images)) {
    out.images = out.images.filter(isMaggsRealPhoto);
  }

  // Add Maggs-specific gallery selectors
  const extra = [];
  const seen = new Set(out.images || []);
  const candidates = [
    ...document.querySelectorAll('.property-photos img'),
    ...document.querySelectorAll('.detail-gallery img'),
    ...document.querySelectorAll('.lot-photos img'),
    ...document.querySelectorAll('img[src*="/resize/"]'),
    ...document.querySelectorAll('img[src*="/uploads/"]'),
  ];
  for (const img of candidates) {
    const src = attr(img, 'src') || attr(img, 'data-src');
    if (!src || seen.has(src)) continue;
    if (!isMaggsRealPhoto(src)) continue;
    seen.add(src);
    extra.push(src);
  }
  out.images = [...(out.images || []), ...extra];

  // Maggs viewing dates — usually under a heading "Viewings" or similar
  const viewings = [];
  const viewingHeading = [...document.querySelectorAll('h2, h3, h4, strong')].find(
    h => /\bviewing/i.test(textOf(h))
  );
  if (viewingHeading) {
    let sib = viewingHeading.nextElementSibling;
    let safety = 5;
    while (sib && safety-- > 0) {
      const t = textOf(sib);
      if (t && /\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(t)) {
        viewings.push(t);
      }
      sib = sib.nextElementSibling;
    }
  }
  if (viewings.length > 0) out.viewingDates = viewings;

  return out;
}
