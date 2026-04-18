// lib/extractors/houses/fssproperty.js — Feather Smailes & Scales extractor
export default {
  fssproperty: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('#search-results .property, .property');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        // Lot number from description
        const lotMatch = text.match(/LOT\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from first h3 > a[href*="/property-details/"]
        let address = '';
        const addrLink = card.querySelector('a[href*="/property-details/"]');
        if (addrLink) address = (addrLink.textContent || '').trim();
        if (!address || address.length < 5) continue;
        // Price from second h3
        let price = null;
        const h3s = card.querySelectorAll('h3');
        for (const h of h3s) {
          const t = (h.textContent || '').trim();
          const pm = t.match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        // Image: /resize/ pattern (same as Hollis Morgan)
        let imageUrl = '';
        const img = card.querySelector('img[src*="/resize/"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // URL
        let url = '';
        if (addrLink) url = addrLink.getAttribute('href') || '';
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*(?:bed|Bed)/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
