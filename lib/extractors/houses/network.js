// lib/extractors/houses/network.js — Network Auctions extractor
export default {
  network: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.current-lots-single');
      for (const card of cards) {
        const lotEl = card.querySelector('.lot-number, span.lot-number');
        let lotNum = lots.length + 1;
        if (lotEl) {
          const m = lotEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        const addrP = card.querySelector('.lot-info p');
        let address = '';
        if (addrP) {
          addrP.querySelectorAll('br').forEach(br => br.replaceWith(', '));
          address = addrP.textContent.trim().replace(/\\s+/g, ' ').replace(/, ,/g, ',');
        }
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let price = null;
        const priceEl = card.querySelector('p.guide-price, .guide-price');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/property/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        const text = card.textContent || '';
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
