// lib/extractors/houses/agentsproperty.js — Agents Property Auction extractor
export default {
  agentsproperty: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.card-grid-item');
      for (const card of cards) {
        // Lot number from pill badge
        let lotNum = 0;
        const pill = card.querySelector('span.pill--pink, span.card-img-meta');
        if (pill) {
          const m = (pill.textContent || '').match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from title link
        let address = '';
        const titleLink = card.querySelector('h3.card-title--property a, h3.card-title a');
        if (titleLink) address = (titleLink.textContent || '').replace(/<br\\s*\\/?>/gi, ', ').trim();
        if (!address || address.length < 5) continue;
        // Price from p.card-price
        let price = null;
        const priceEl = card.querySelector('p.card-price');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: CSS background-image on div.card-img-bg
        let imageUrl = '';
        const imgBg = card.querySelector('div.card-img-bg');
        if (imgBg) {
          const style = imgBg.getAttribute('style') || '';
          const urlMatch = style.match(/url\\(([^)]+)\\)/);
          if (urlMatch) imageUrl = urlMatch[1].replace(/['"]/g, '');
        }
        // Detail link
        let url = '';
        const detailLink = card.querySelector('a.u-link-cover, h3.card-title--property a');
        if (detailLink) url = detailLink.getAttribute('href') || '';
        // Bullets from card-excerpt
        const bullets = [];
        const excerpt = card.querySelector('div.card-excerpt');
        if (excerpt) {
          const t = (excerpt.textContent || '').trim();
          const bedMatch = t.match(/(\\d+)\\s*Bed/i);
          if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
          const bathMatch = t.match(/(\\d+)\\s*Bath/i);
          if (bathMatch) bullets.push(bathMatch[1] + ' bathrooms');
          const recMatch = t.match(/(\\d+)\\s*Recep/i);
          if (recMatch) bullets.push(recMatch[1] + ' receptions');
        }
        // Status
        const banner = card.querySelector('span.card-img-banner');
        if (banner) {
          const status = (banner.textContent || '').trim();
          if (status && status !== 'Upcoming') bullets.push(status);
        }
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
