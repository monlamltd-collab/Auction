// lib/extractors/houses/brutonknowles.js — Bruton Knowles extractor
export default {
  brutonknowles: `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.property-post-template, .wp-block-post');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Skip non-property cards
      if (text.length < 20) continue;
      // Address — from heading or first substantial text
      let address = '';
      const heading = card.querySelector('h3 a, h2 a, h3, h2');
      if (heading) address = heading.textContent.trim();
      if (!address || address.length < 5) {
        // Try link text
        const link = card.querySelector('a[href*="/property/"]');
        if (link) address = link.textContent.trim();
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      let url = '';
      const link = card.querySelector('a[href*="/property/"], a[href*="brutonknowles"]');
      if (link) url = link.getAttribute('href') || '';
      if (!url) {
        const anyLink = card.querySelector('a[href]');
        if (anyLink) url = anyLink.getAttribute('href') || '';
      }
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon|placeholder/i.test(s)) imageUrl = s;
      }
      // Bullets
      const bullets = [];
      const codeMatch = text.match(/Code\\s*(\\d+)/i);
      if (codeMatch) bullets.push('Ref: ' + codeMatch[1]);
      const acreMatch = text.match(/(\\d+\\.?\\d*)\\s*acres?/i);
      if (acreMatch) bullets.push(acreMatch[0]);
      if (/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/\\bPOA\\b|On Application/i.test(text)) bullets.push('POA');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
