// lib/extractors/houses/wilsons.js — Wilsons Auctions extractor
export default {
  wilsons: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.l-grid__item a[href*="/lots/"]');
      let lotNum = 0;
      for (const link of cards) {
        const href = link.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);
        lotNum++;
        const card = link.closest('.l-grid__item') || link;
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('h3, h2, h4');
        if (heading) address = (heading.textContent || '').trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const pm = text.match(/(?:Guide|Reserve|Starting)[:\\s]*£([\\d,]+)/i);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        if (!price) { const gm = text.match(/£([\\d,]+)/); if (gm) price = parseInt(gm[1].replace(/,/g, '')); }
        let imageUrl = '';
        const img = card.querySelector('img');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*Bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(House|Flat|Apartment|Bungalow|Land|Commercial|Cottage|Farm)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
