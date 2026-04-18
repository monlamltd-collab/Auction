// lib/extractors/houses/auctionestates.js — Auction Estates extractor
export default {
  auctionestates: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.result-container');
      let idx = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('.property-title, h1, h2, h3');
        if (heading) address = heading.textContent.trim();
        if (!address || address.length < 5) continue;
        const priceEl = card.querySelector('.property-guide-price');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const link = card.querySelector('a[href*="/property/"]');
        const url = link ? link.getAttribute('href') : '';
        let imageUrl = '';
        const img = card.querySelector('img.result-property-image, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        const flash = card.querySelector('.property-flash');
        if (flash && /\\bSOLD\\b|\\bWithdrawn\\b/i.test(flash.textContent)) {
          bullets.push(flash.textContent.trim());
        }
        lots.push({ lot: idx++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
