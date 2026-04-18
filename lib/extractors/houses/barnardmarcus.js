// lib/extractors/houses/barnardmarcus.js — Barnard Marcus extractor
export default {
  barnardmarcus: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Barnard Marcus 2026: .lot-item cards with BEM-style classes
      let cards = document.querySelectorAll('.lot-item');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="lot-item"], [class*="lot-card"], article');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number from .lot-info__name or text
        const lotEl = card.querySelector('.lot-info__name, [class*="lot-info"] [class*="name"], [class*="lot-number"]');
        const lotMatch = (lotEl ? lotEl.textContent : text).match(/(?:Lot\\s+)?(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        // Address from .lot-item__address
        const addrEl = card.querySelector('.lot-item__address, [class*="lot-item__address"], [class*="address"], h3, h4');
        const address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) continue;
        // Price from .lot-item__price
        let price = null;
        const priceEl = card.querySelector('.lot-item__price, [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        const link = card.querySelector('.lot-item__link, a[href*="lot"], a[href*="property"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.lot-item__img img, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        // Bullets
        const bullets = [];
        const desc = card.querySelector('.lot-item__description, [class*="description"]');
        if (desc) { const t = desc.textContent.trim(); if (t.length > 5) bullets.push(t.substring(0, 200)); }
        const loc = card.querySelector('.lot-item__location, [class*="location"]');
        if (loc && loc.textContent.trim()) bullets.push(loc.textContent.trim());
        const statusEl = card.querySelector('.lot-info__status, [class*="status"]');
        if (statusEl && statusEl.textContent.match(/sold|unsold|withdrawn/i)) continue;
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b/i)) continue;
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};

export const aliases = {
  foxandsons: 'barnardmarcus',
};
