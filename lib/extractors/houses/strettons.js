// lib/extractors/houses/strettons.js — Strettons extractor
export default {
  strettons: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Strettons 2026: Bootstrap/JS-rendered. Try multiple card strategies.
      let cards = document.querySelectorAll('.lot-item, .property-card, .catalogue-item');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="lot-item"], [class*="lot-card"], [class*="property-item"]');
      if (cards.length === 0) cards = document.querySelectorAll('article, .card');
      if (cards.length === 0) {
        // Fallback: find all links to lot/property pages and walk up
        const links = document.querySelectorAll('a[href*="/lot"], a[href*="/property"], a[href*="/auction"]');
        const parentSet = new Set();
        for (const link of links) {
          let p = link;
          for (let i = 0; i < 6 && p.parentElement; i++) {
            p = p.parentElement;
            const t = p.textContent || '';
            if (t.match(/Lot\\s+\\d/i) && t.match(/£[\\d,]/)) break;
          }
          if (!parentSet.has(p) && p.textContent.length > 20 && p.textContent.length < 3000) parentSet.add(p);
        }
        cards = parentSet;
      }
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        // Address
        let address = '';
        const addrEl = card.querySelector('[class*="address"], h2, h3, h4, .title');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address) continue;
        // Price
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // URL
        const link = card.querySelector('a[href*="/lot"], a[href*="/property"], a[href*="/auction"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        // Image
        let imageUrl = extractCardImage(card);
        const bullets = [];
        card.querySelectorAll('li, .description, .feature, [class*="description"]').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
