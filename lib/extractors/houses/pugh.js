// lib/extractors/houses/pugh.js — Pugh Auctions extractor
export default {
  pugh: `
  (() => {
    const lots = [];
    const seen = new Set();
    // Pugh: property cards in grid layout
    const cards = document.querySelectorAll('div.grid > div.h-full.mb-8, div.grid > div.h-full');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address from bold link inside card
      const addrLink = card.querySelector('div.text-white.uppercase.text-lg.font-bold a.block, div.uppercase a, h3 a, h2 a, a[href*="/property/"]');
      let address = addrLink ? addrLink.textContent.trim() : '';
      // Fallback: first link with substantial text
      if (!address) {
        const links = card.querySelectorAll('a');
        for (const lnk of links) {
          const t = lnk.textContent.trim();
          if (t.length > 10 && !t.match(/^(View|More|See|Back|Next|Previous)/i)) { address = t; break; }
        }
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Lot URL
      let url = '';
      if (addrLink) url = addrLink.getAttribute('href') || '';
      if (!url) {
        const anyLink = card.querySelector('a[href*="/property/"], a[href*="pugh-auctions.com/property"]');
        if (anyLink) url = anyLink.getAttribute('href') || '';
      }
      if (seen.has(url) && url) { idx++; continue; }
      if (url) seen.add(url);
      // Lot number from text
      const lotMatch = text.match(/Lot\\s*(?:No\\.?)?\\s*(\\d+)/i);
      const lotNum = lotMatch ? parseInt(lotMatch[1]) : idx;
      // Price from bold span
      let price = null;
      const priceEl = card.querySelector('p.text-secondary span.text-xl, span.text-xl, .price');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image — BTG Eddisons CDN or local
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && s.length > 10 && !/logo|icon|placeholder|\\.svg/i.test(s)) imageUrl = s;
      }
      // Bullets — auction type, status
      const bullets = [];
      if (/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/Timed\\s*Auction/i.test(text)) bullets.push('Timed Auction');
      if (/Live\\s*(Stream)?\\s*Auction/i.test(text)) bullets.push('Live Auction');
      const dateMatch = text.match(/(\\d{1,2}(?:st|nd|rd|th)?\\s+\\w+\\s+\\d{4})/i);
      if (dateMatch) bullets.push(dateMatch[1]);
      lots.push({ lot: lotNum, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
