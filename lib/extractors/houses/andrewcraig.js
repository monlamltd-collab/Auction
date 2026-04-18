// lib/extractors/houses/andrewcraig.js — Andrew Craig extractor
export default {
  andrewcraig: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.card[data-id]');
      let lotNum = 0;
      for (const card of cards) {
        // Skip CTA cards
        if (card.classList.contains('card--property-worth')) continue;
        lotNum++;
        // Address from the text link in card-content
        let address = '';
        const addrLink = card.querySelector('div.card-content > a.card-image-container');
        if (addrLink) address = (addrLink.textContent || '').trim();
        // Clean "X bed Y for sale in" prefix
        address = address.replace(/^\\d+\\s+bed\\s+\\w+\\s+for\\s+sale\\s+in\\s+/i, '').trim();
        if (!address || address.length < 5) continue;
        // Price from span.price-value
        let price = null;
        const priceEl = card.querySelector('span.price-value');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: data-src (lazy loaded with base64 placeholder in src)
        let imageUrl = '';
        const img = card.querySelector('div.card-image img');
        if (img) {
          imageUrl = img.getAttribute('data-src') || '';
          if (!imageUrl || imageUrl.startsWith('data:')) imageUrl = img.getAttribute('src') || '';
          if (imageUrl.startsWith('data:')) imageUrl = '';
        }
        // Detail link
        let url = '';
        const link = card.querySelector('a.card-image-container');
        if (link) url = link.getAttribute('href') || '';
        // Bullets: bedroom/bathroom counts from span.number elements
        const bullets = [];
        const numbers = card.querySelectorAll('div.card-content__detail__left span.number');
        if (numbers.length >= 1) bullets.push(numbers[0].textContent.trim() + ' bedrooms');
        if (numbers.length >= 2) bullets.push(numbers[1].textContent.trim() + ' bathrooms');
        if (numbers.length >= 3) bullets.push(numbers[2].textContent.trim() + ' receptions');
        // Property tag (e.g. "Land")
        const tag = card.querySelector('span.property-tag');
        if (tag) bullets.push((tag.textContent || '').trim());
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
