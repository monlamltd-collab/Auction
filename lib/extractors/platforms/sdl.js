// lib/extractors/platforms/sdl.js — SDL/BTG Eddisons platform extractors
export default {
  sdl: `
    (() => {
      const lots = [];
      const seen = new Set();
      // BTG Eddisons: find all property links, then walk up to their card container
      const propLinks = document.querySelectorAll('a[href*="/properties/"]');
      const processed = new Set();
      for (const propLink of propLinks) {
        const url = propLink.getAttribute('href') || '';
        if (!url || seen.has(url)) continue;
        // Walk up to find the card container (up to 8 levels)
        let card = propLink;
        for (let i = 0; i < 8; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          // Stop at a container that has both price text and a property link
          if (card.textContent.match(/Guide\\s*Price|£[\\d,]/i) && card.querySelector('img')) break;
        }
        // Skip if we already processed this card
        const cardId = card.getAttribute('data-idx') || card.innerHTML.substring(0, 100);
        if (processed.has(cardId)) continue;
        processed.add(cardId);
        seen.add(url);
        const text = card.textContent || '';
        // Lot number — plain 3-digit text like "001", "002"
        let lotNum = 0;
        const lotMatch = text.match(/(?:^|\\s)(\\d{2,4})(?:\\s|$)/);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from link text with postcode pattern
        let address = '';
        const allLinks = card.querySelectorAll('a[href*="/properties/"]');
        for (const link of allLinks) {
          const t = link.textContent.trim();
          if (t.length > 10 && t.match(/[A-Z]{1,2}\\d/i)) { address = t; break; }
        }
        // Fallback: h3 text
        if (!address) {
          const h3 = card.querySelector('h3');
          if (h3) address = h3.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        // Deduplicate address if it repeats (overlay + content)
        address = address.replace(/(.{20,})\\1/g, '$1').trim();
        // Price from "Guide Price: £X+" pattern
        let price = null;
        const priceMatch = text.match(/Guide\\s*Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Bullets — auction type, end date
        const bullets = [];
        const typeMatch = text.match(/(Multi-Lot Timed|Single-Lot Timed|Live Stream)\\s*Auction/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        const endMatch = text.match(/Auction\\s*Ends?:\\s*(\\d{2}\\/\\d{2}\\/\\d{4})/i);
        if (endMatch) bullets.push('Auction Ends: ' + endMatch[1]);
        if (text.match(/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i)) {
          bullets.push('SOLD/STC');
        }
        // Image — use shared helper that handles lazy-load (data-src/data-lazy-src/srcset)
        // and CSS background-image, with junk filter + thumbnail upgrade.
        // extractCardImage / getBestImgSrc / isJunkImage are auto-injected by
        // lib/extractors/runner.js via IMG_HELPERS.
        const imageUrl = extractCardImage(card);
        lots.push({ lot: lotNum || lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};

export const aliases = {
  markjenkinson: 'sdl',
  scargillmann: 'sdl',
};
