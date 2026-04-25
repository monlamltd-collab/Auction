// lib/extractors/platforms/homeflow.js — Homeflow platform extractors
export default {
  stags: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Try multiple Homeflow card selectors
      const cards = document.querySelectorAll('.property-results-list li, .property-card, [class*="property"] li');
      let lotNum = 0;
      for (const card of cards) {
        // Address
        const addrEl = card.querySelector('.list-address, h3 a, .property-title, .address');
        if (!addrEl) continue;
        const address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        lotNum++;
        // Price
        let price = null;
        const priceEl = card.querySelector('.list-price, .price, [class*="price"]');
        if (priceEl) {
          const pm = priceEl.textContent.replace(/[^0-9]/g, '');
          if (pm && pm.length >= 4) price = parseInt(pm);
        }
        // URL
        let url = '';
        const link = addrEl.tagName === 'A' ? addrEl : (card.querySelector('a[href*="/properties/"]') || card.querySelector('a[href]'));
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="homeflow-assets"], img[src*="cdn"], img[data-src]');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const bgEl = card.querySelector('[style*="background"]');
        if (!imageUrl && bgEl) {
          const bgMatch = (bgEl.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
          if (bgMatch) imageUrl = bgMatch[1];
        }
        // Bullets from property type badges or text
        const bullets = [];
        const typeEl = card.querySelector('.property-type, .type');
        if (typeEl) bullets.push(typeEl.textContent.trim());
        const bedEl = card.querySelector('.beds, .bedrooms, [class*="bed"]');
        if (bedEl) {
          const bm = bedEl.textContent.match(/(\\d+)/);
          if (bm) bullets.push(bm[1] + ' bedrooms');
        }
        lots.push({ lot: lotNum, address, price, url, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,
};

export const aliases = {
  gth: 'stags',
  // cleetompkinson removed 2026-04-25 — uses Ctesius theme (.propertyTeaser),
  // not Homeflow's .property-results-list. House-specific extractor lives in
  // lib/extractors/houses/cleetompkinson.js.
  johnfrancis: 'stags',
  bradleysdevon: 'stags',
};
