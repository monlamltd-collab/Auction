// lib/extractors/houses/pearsons.js — Pearsons extractor
export default {
  pearsons: `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.propertyBlock.auctions');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address from h3 link
      const addrEl = card.querySelector('.propTextHolder h3 a, h3 a');
      const address = addrEl ? addrEl.textContent.trim() : '';
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      const url = addrEl ? addrEl.getAttribute('href') || '' : '';
      if (seen.has(url)) continue;
      seen.add(url);
      // Price from p.size18
      let price = null;
      const priceEl = card.querySelector('.propTextHolder p.size18, p.size18');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image from background-image on .propImageHolder
      let imageUrl = '';
      const imgHolder = card.querySelector('.propImageHolder');
      if (imgHolder) {
        const style = imgHolder.getAttribute('style') || '';
        const bgMatch = style.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
        if (bgMatch) imageUrl = bgMatch[1];
      }
      if (!imageUrl) {
        const img = card.querySelector('img[src]');
        if (img) imageUrl = img.getAttribute('src') || '';
      }
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
