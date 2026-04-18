// lib/extractors/houses/symonds-and-sampson.js — Symonds & Sampson extractor
export default {
  symondsandsampson: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.FeaturedGrid__item-container, .FeaturedGrid__item');
      let lotNum = 0;
      for (const card of cards) {
        const link = card.tagName === 'A' ? card : card.querySelector('a.FeaturedGrid__item, a[href*="/property/"]');
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        if (!href.includes('/property/') || href.includes('property-for-sale') || href.includes('property-to-rent')) continue;
        lotNum++;
        // Address from first h3 inside FeaturedProperty__description
        const descDiv = link.querySelector('.FeaturedProperty__description');
        const h3s = descDiv ? descDiv.querySelectorAll('h3') : link.querySelectorAll('h3');
        let address = '';
        if (h3s.length > 0) {
          address = h3s[0].textContent.trim();
        }
        if (!address) continue;
        // Price from .nativecurrencyvalue
        let price = null;
        const priceEl = link.querySelector('.nativecurrencyvalue');
        if (priceEl) {
          const pm = priceEl.textContent.replace(/[^0-9]/g, '');
          if (pm) price = parseInt(pm);
        }
        // Image from data-bg on .FeaturedProperty__featured-image
        let imageUrl = '';
        const imgDiv = link.querySelector('.FeaturedProperty__featured-image, [data-bg]');
        if (imgDiv) imageUrl = imgDiv.getAttribute('data-bg') || '';
        if (!imageUrl) {
          const img = link.querySelector('img[src*="cdn.webdadi.net"]');
          if (img) imageUrl = img.getAttribute('src') || '';
        }
        // Property type from URL path
        const bullets = [];
        const typeMatch = href.match(/\\/(house|flat|land|bungalow|detached|semi-detached|terraced|cottage|studio|other|barn|garage|maisonette|commercial)[\\/]/i);
        if (typeMatch) bullets.push(typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1));
        const bedMatch = href.match(/(\\d+)-bedroom/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        lots.push({ lot: lotNum, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,
};
