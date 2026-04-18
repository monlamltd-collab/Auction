// lib/extractors/houses/underthehammer.js — Under The Hammer extractor
export default {
  underthehammer: `
    (() => {
      const lots = [];
      const seen = new Set();
      // UTH renders property cards client-side, but attempt to catch any SSR content
      // Look for any property links with /for-auction/ pattern
      const links = document.querySelectorAll('a[href*="/for-auction/"]');
      let lotNum = 0;
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href || href === '/for-auction/properties' || seen.has(href)) continue;
        if (!href.match(/\\/for-auction\\/[a-z0-9-]+$/i)) continue;
        seen.add(href);
        lotNum++;
        // Walk up to find the card container
        let card = link;
        for (let i = 0; i < 6 && card.parentElement; i++) {
          card = card.parentElement;
          const cl = (card.className || '').toLowerCase();
          if (cl.match(/card|property|listing|item|result/) || card.tagName === 'ARTICLE') break;
        }
        const text = card.textContent || '';
        // Address from heading or text
        let address = '';
        const heading = card.querySelector('h2, h3, h4');
        if (heading) address = (heading.textContent || '').trim();
        if (!address || address.length < 5) {
          // Try link title
          const title = link.getAttribute('title') || link.textContent.trim();
          if (title && title.length > 5) address = title;
        }
        if (!address || address.length < 5) continue;
        // Price
        let price = null;
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="property"], img[src*="blob.core.windows.net"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        if (!imageUrl) {
          const anyImg = card.querySelector('img[alt]');
          if (anyImg) {
            const srcset = anyImg.getAttribute('srcset') || '';
            const urlMatch = srcset.match(/url=([^&]+)/);
            if (urlMatch) { try { imageUrl = decodeURIComponent(urlMatch[1]); } catch(e) {} }
            if (!imageUrl) imageUrl = anyImg.getAttribute('src') || '';
          }
        }
        // Bullets
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(Detached|Semi-Detached|Terrace|Flat|Apartment|Bungalow|House|Cottage|Land|Commercial)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
