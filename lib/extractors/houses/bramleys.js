// lib/extractors/houses/bramleys.js — Bramleys extractor
export default {
  bramleys: `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.property, .product-container');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      if (text.length < 20) continue;
      // Address from paragraph or heading
      let address = '';
      const addrEl = card.querySelector('p, h4');
      if (addrEl) {
        // Address is usually the line with a town/postcode
        const lines = (card.textContent || '').split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        for (const line of lines) {
          if (/[A-Z]{1,2}\\d/i.test(line) || (line.includes(',') && !line.startsWith('£') && !line.startsWith('Auction') && !/^\\d+\\s*Bed/i.test(line))) {
            address = line;
            break;
          }
        }
      }
      if (!address) {
        const h4 = card.querySelector('h4');
        if (h4) address = h4.textContent.trim();
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      let url = '';
      const link = card.querySelector('a[href*="/property-details/"], a[href]');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const pm = text.match(/(?:Guide|Auction)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon/i.test(s)) imageUrl = s;
      }
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*Bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      const typeMatch = text.match(/\\b(Detached|Semi|Terrace|Back to Back|End Terrace|Flat|Bungalow|House|Cottage|Land)\\b/i);
      if (typeMatch) bullets.push(typeMatch[0]);
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/FOR SALE/i.test(text)) bullets.push('For Sale');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
