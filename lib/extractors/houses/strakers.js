// lib/extractors/houses/strakers.js — Strakers extractor
export default {
  strakers: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.card-auction, .card[class*="auction"]');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('h5 a, h4 a, h3 a');
        if (heading) address = (heading.textContent || '').trim();
        if (!address) {
          const h = card.querySelector('h5, h4, h3');
          if (h) address = (h.textContent || '').trim();
        }
        if (!address || address.length < 5) continue;
        let price = null;
        const priceEl = card.querySelector('.card__price');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        if (!price) { const pm = text.match(/£([\\d,]+)/); if (pm) price = parseInt(pm[1].replace(/,/g, '')); }
        let imageUrl = '';
        const img = card.querySelector('.card__head img');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (!imageUrl) { const anyImg = card.querySelector('img'); if (anyImg) imageUrl = anyImg.getAttribute('src') || ''; }
        let url = '';
        const link = card.querySelector('a[href]');
        if (link) url = link.getAttribute('href') || '';
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const lot = lotMatch ? lotMatch[1] : String(lotNum);
        if (seen.has(url || address)) continue;
        seen.add(url || address);
        lots.push({ lot, address: address.substring(0, 200), price, url, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
