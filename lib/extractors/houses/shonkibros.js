// lib/extractors/houses/shonkibros.js — Shonki Brothers extractor
export default {
  shonkibros: `
  (() => {
    const lots = [];
    const cards = document.querySelectorAll('.auction-image-container, .flat-item');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      const lotMatch = text.match(/Lot\\s*(?:number)?[:\\s]*(\\d+)/i);
      const num = lotMatch ? parseInt(lotMatch[1]) : idx;
      const heading = card.querySelector('h5 a strong, h5 a, h4 a, h3 a');
      const address = heading ? heading.textContent.trim() : '';
      if (!address || address.length < 5) { idx++; continue; }
      const priceEl = card.querySelector('.price, span.price');
      const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
      const link = card.querySelector('a[href*="/auctions/lot/"], a[href*="/lot/details/"]');
      const url = link ? link.getAttribute('href') : '';
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || '';
        if (s && s.length > 10 && !s.includes('logo') && !s.includes('icon')) imageUrl = s;
      }
      lots.push({ lot: num, address, price, url, imageUrl: imageUrl || undefined });
      idx++;
    }
    return lots;
  })()
`,
};
