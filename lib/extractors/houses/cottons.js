// lib/extractors/houses/cottons.js — Cottons extractor
export default {
  cottons: `
    (() => {
      const lots = [];
      const seen = new Set();
      const containers = document.querySelectorAll('.lot-container');
      for (const card of containers) {
        // Lot number from .lotnum (e.g. "LOT 1")
        const lotnumEl = card.querySelector('.lotnum');
        let lotNum = lots.length + 1;
        if (lotnumEl) {
          const m = lotnumEl.textContent.match(/LOT\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from .address or .address-mob
        const addrEl = card.querySelector('.address, .address-mob');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price — guide price or sold price
        let price = null;
        const priceEl = card.querySelector('.price');
        if (priceEl) {
          const priceText = priceEl.textContent;
          const pm = priceText.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('a[href*="lid="]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.lot-image, img[src*="eigpropertyauctions"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Description: text after the address in .lot-info (everything before = lot num + result)
        const bullets = [];
        const infoEl = card.querySelector('.lot-info');
        if (infoEl) {
          const fullText = infoEl.textContent || '';
          const addrIdx = fullText.indexOf(address);
          if (addrIdx >= 0) {
            let desc = fullText.substring(addrIdx + address.length).trim();
            // Strip leading price remnants like "£70,000."
            desc = desc.replace(/^£[\\d,]+\\+?\\.?\\s*/i, '');
            if (desc.length > 5 && desc.length < 200) bullets.push(desc);
          }
        }
        const _ct = card.textContent || '';
        if (_ct.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
