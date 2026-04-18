// lib/extractors/houses/goldings.js — Goldings extractor
export default {
  goldings: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.property-card, .block-lot-listing__lot');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        let lotNum = lots.length + 1;
        const lotEl = card.querySelector('.property-card__lot-no strong');
        if (lotEl) lotNum = parseInt(lotEl.textContent.trim()) || lotNum;
        let address = '';
        const addrEl = card.querySelector('.property-card__additional-meta__address');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const priceEl = card.querySelector('.property-card__meta-price span');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('.property-card__gallery-main-image img, .property-card__gallery img');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        const tagline = card.querySelector('.property-card__additional-meta__tagline');
        if (tagline) bullets.push(tagline.textContent.trim().substring(0, 200));
        const soldFlag = card.querySelector('.property-card__sold-flag');
        if (soldFlag || text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b/i)) continue;
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
