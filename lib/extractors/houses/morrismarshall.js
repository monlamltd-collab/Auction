// lib/extractors/houses/morrismarshall.js — Morris Marshall extractor
export default {
  morrismarshall: `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.product-container, .property');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      if (text.length < 20) continue;
      let address = '';
      const addrEl = card.querySelector('h4 a, h3 a, h2 a, .address, p');
      if (addrEl) address = addrEl.textContent.trim();
      if (!address || address.length < 5) {
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        for (const line of lines) {
          if (/[A-Z]{1,2}\\d/i.test(line) || (line.includes(',') && !line.startsWith('£'))) {
            address = line; break;
          }
        }
      }
      if (!address || address.length < 5) { idx++; continue; }
      let url = '';
      const link = card.querySelector('a[href*="/property/"], a[href*="/property-details/"], a[href]');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon/i.test(s)) imageUrl = s;
      }
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
