// lib/extractors/houses/mccartneys.js — McCartneys extractor
export default {
  mccartneys: `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.repeat-team, .property-result, li.type-property, .office-slider');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address
      let address = '';
      const addrEl = card.querySelector('h4 a, h3 a, h2 a, .col-right h4 a');
      if (addrEl) address = addrEl.textContent.trim();
      if (!address || address.length < 5) { idx++; continue; }
      // URL
      let url = '';
      const link = card.querySelector('a[href*="/property-details/"], a[href*="/property/"], h4 a, h3 a');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const priceEl = card.querySelector('p.price, .price');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
