// lib/extractors/houses/philliparnold.js — Phillip Arnold extractor
//
// Fix 2026-05-08: previously called `extractCardImage(el)` which was never
// defined in the page-context scope. ReferenceError caused the IIFE to
// crash silently for every lot → 0% image coverage. Replaced with inline
// img-tag extraction that also checks lazy-load attributes (data-src,
// data-lazy-src, data-original) to handle JS-rendered thumbnails.
export default {
  philliparnold: `
    (() => {
      const lots = [];
      document.querySelectorAll('.gallery-item, .lot-item, .property-item, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const link = el.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*price\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/guide\\s*price\\s*£[\\d,]+/i, '').replace(/£[\\d,]+/g, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          // Inline image extraction — tolerate lazy-loaded sites by
          // checking data-* attrs before falling back to src.
          const img = el.querySelector('img');
          let imageUrl = '';
          if (img) {
            imageUrl = img.getAttribute('data-src')
                   || img.getAttribute('data-lazy-src')
                   || img.getAttribute('data-original')
                   || img.getAttribute('src')
                   || '';
            // Skip data:image placeholders and empty results
            if (imageUrl.startsWith('data:')) imageUrl = '';
          }
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,
};
