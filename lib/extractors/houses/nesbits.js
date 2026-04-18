// lib/extractors/houses/nesbits.js — Nesbits extractor
export default {
  nesbits: `
  (() => {
    const lots = [];
    const seen = new Set();
    const links = document.querySelectorAll('a[href*="/property/"]');
    let idx = 1;
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (!href || seen.has(href)) continue;
      // Must be a property detail link (not nav/footer)
      const h4 = link.querySelector('h4');
      if (!h4) continue;
      seen.add(href);
      const address = h4.textContent.trim();
      if (!address || address.length < 5) { idx++; continue; }
      const text = link.textContent || '';
      // Price — "£X Guide price" text above the heading
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = link.querySelector('img[src]');
      if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
      // Bullets
      const bullets = [];
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      lots.push({ lot: idx, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
