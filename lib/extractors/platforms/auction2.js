// lib/extractors/platforms/auction2.js — Auction2 platform extractors (Hollis Morgan / Maggs & Allen)
export default {
  hollismorgan: `
    (() => {
      const lots = [];
      const detailLinks = document.querySelectorAll('a[href*="property-details"]');
      let lotIndex = 1;
      for (const link of detailLinks) {
        const url = link.getAttribute('href') || '';
        if (!url || link.textContent.trim() === '') continue;
        let card = link.parentElement;
        for (let i = 0; i < 5 && card; i++) {
          if (card.querySelector('h3') && card.querySelector('h4')) break;
          card = card.parentElement;
        }
        if (!card) continue;
        const h3 = card.querySelector('h3');
        const address = h3 ? h3.textContent.trim() : '';
        if (!address) continue;
        let price = null;
        const h4s = card.querySelectorAll('h4');
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const pm = t.match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        let lotNum = lotIndex;
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const lm = t.match(/Lot\\s+(\\d+)/i);
          if (lm) { lotNum = parseInt(lm[1]); break; }
        }
        const bullets = [];
        const lis = card.querySelectorAll('li');
        for (const li of lis) {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        }
        const cardText = card.textContent;
        if (cardText.match(/\\bSOLD\\b|\\bSALEAGREED\\b|\\bSALE AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        // Image: prefer img.property-grid-image (Auction2 platform hint),
        // route through getBestImgSrc to honour lazy-load attrs, then fall
        // back to extractCardImage. Helpers auto-injected via IMG_HELPERS.
        let imageUrl = '';
        const cardImg = card.querySelector('img.property-grid-image');
        if (cardImg) imageUrl = getBestImgSrc(cardImg);
        if (!imageUrl || isJunkImage(imageUrl)) imageUrl = extractCardImage(card);
        // Extra safety: drop obvious non-property URLs even after helpers passed them
        if (imageUrl && /\\.svg|\\/images\\/|logo|icon|banner/i.test(imageUrl)) imageUrl = '';
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  maggsandallen: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Maggs & Allen 2026: Bootstrap .card layout with .auction-property-image, h2 > a for address
      let cards = document.querySelectorAll('.card');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="property-card"], article, .lot-card');
      for (const card of cards) {
        const text = card.textContent || '';
        // Skip nav/footer cards that aren't property listings
        if (text.length < 20 || text.length > 5000) continue;
        if (!text.match(/£[\\d,]|Lot\\s+\\d|Guide/i)) continue;
        // Address from h2 > a or h2/h3
        let address = '', url = '';
        const h2a = card.querySelector('h2 a, .card-body h2 a, h3 a');
        if (h2a) {
          address = h2a.textContent.trim();
          url = h2a.getAttribute('href') || '';
        }
        if (!address) {
          const h2 = card.querySelector('h2, h3');
          if (h2) address = h2.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        // URL fallback
        if (!url) {
          const link = card.querySelector('a[href*="property"], a[href*="details"], .card-footer a, a[href]');
          if (link) url = link.getAttribute('href') || '';
        }
        // Price from .card-text or text
        let price = null;
        const priceEl = card.querySelector('.card-text, [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/LOT\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        // Image: Auction2 CMS uses img.property-grid-image (same as Hollis Morgan).
        // Route through getBestImgSrc for lazy-load attrs, then fall back to
        // extractCardImage. Helpers auto-injected via IMG_HELPERS.
        let imageUrl = '';
        const cardImg = card.querySelector('img.property-grid-image');
        if (cardImg) imageUrl = getBestImgSrc(cardImg);
        if (!imageUrl || isJunkImage(imageUrl)) imageUrl = extractCardImage(card);
        if (imageUrl && /\\.svg|\\/images\\/|logo|icon|banner/i.test(imageUrl)) imageUrl = '';
        // Bullets
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
