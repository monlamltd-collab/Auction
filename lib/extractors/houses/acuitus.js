// lib/extractors/houses/acuitus.js — Acuitus extractor
export default {
  acuitus: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Acuitus 2026: .property-card containers with .lot-number, .address, .guide-price
      let cards = document.querySelectorAll('.property-card');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="property-card"], [class*="property-item"], [class*="lot-card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotEl = card.querySelector('.lot-number, [class*="lot-number"]');
        const lotMatch = (lotEl ? lotEl.textContent : text).match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const addrEl = card.querySelector('.address, [class*="address"], h2, h3');
        const address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) continue;
        let price = null;
        const priceEl = card.querySelector('.guide-price, [class*="guide-price"], [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        const link = card.querySelector('a[href*="/property/"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        let imageUrl = extractCardImage(card);
        const bullets = [];
        const yieldEl = card.querySelector('.yield, [class*="yield"]');
        if (yieldEl && yieldEl.textContent.trim()) bullets.push('Yield: ' + yieldEl.textContent.trim());
        const typeEl = card.querySelector('.property-type, [class*="property-type"]');
        if (typeEl && typeEl.textContent.trim()) bullets.push(typeEl.textContent.trim());
        const statusEl = card.querySelector('.status, [class*="status"]');
        if (statusEl && statusEl.textContent.match(/sold|withdrawn/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
