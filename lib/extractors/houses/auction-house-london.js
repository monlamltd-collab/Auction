// lib/extractors/houses/auction-house-london.js — Auction House London extractor
export default {
  auctionhouselondon: `
    (() => {
      const lots = [];
      const links = document.querySelectorAll('a[href*="/lot/"]');
      const seen = new Set();
      let idx = 1;
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const text = link.textContent || '';
        // Price from "Guide Price: £210,000+"
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // Address: find the semibold heading div, or parse from text
        const addrEl = link.querySelector('[class*="font-semibold"]');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) {
          // Fallback: strip LOT/price/badges from text, take first substantial line
          address = text.replace(/LOT\\s*\\d*/gi, '').replace(/Guide Price[^£]*£[\\d,]+\\+?/gi, '').replace(/£[\\d,]+\\+?/g, '');
          address = address.split('\\n').map(s=>s.trim()).filter(s=>s.length>5 && !s.match(/^(Flat|Leasehold|Freehold|Sold|SOLD|STC|View)$/i))[0] || '';
        }
        if (!address || address.length < 5) continue;
        // Image
        let imageUrl = '';
        const img = link.querySelector('img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s.length > 10 && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg')) imageUrl = s;
        }
        if (!imageUrl) {
          const parent = link.closest('[class*="mb-30"], [class*="w-full"]') || link.parentElement;
          if (parent) { const pi = parent.querySelector('img[src*="eigpropertyauctions"], img[src*="property"]'); if (pi) imageUrl = pi.getAttribute('src') || ''; }
        }
        // Description bullets
        const bullets = [];
        const descEl = link.querySelector('[class*="leading-normal"], [class*="text-15"]');
        if (descEl) { const d = descEl.textContent.trim(); if (d.length > 10) bullets.push(d); }
        // Sold/STC detection
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          bullets.push('SOLD/STC');
        }
        // Property type & tenure from badge spans
        const badges = link.querySelectorAll('span');
        let propType, tenure;
        for (const b of badges) {
          const bt = b.textContent.trim();
          if (/^(Flat|House|Bungalow|Land|Commercial|Maisonette)$/i.test(bt)) propType = bt;
          if (/^(Freehold|Leasehold|Share of Freehold)$/i.test(bt)) tenure = bt;
        }
        lots.push({ lot: idx++, address, price, url: href, bullets, imageUrl: imageUrl || undefined, propType, tenure });
      }
      return lots;
    })()
  `,
};
