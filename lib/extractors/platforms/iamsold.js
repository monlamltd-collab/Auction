// lib/extractors/platforms/iamsold.js — iamsold platform extractors
export default {
  iamsold: `
    (() => {
      const lots = [];
      const seen = new Set();
      // iamsold uses div.c__property cards with structured content
      const cards = document.querySelectorAll('.c__property, .c__propertyAlt');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        // Address from .c__property__address (contains bed count + street + area + postcode)
        let address = '';
        const addrEl = card.querySelector('.c__property__address');
        if (addrEl) {
          address = (addrEl.textContent || '').replace(/\\s+/g, ' ').trim();
          // Remove leading "X bed Type" prefix (e.g. "2 bed Apartment")
          address = address.replace(/^\\d+\\s+bed\\s+\\w+\\s*/i, '').trim();
        }
        if (!address || address.length < 5) {
          // Fallback: try link slug
          const link = card.querySelector('a[href*="/property/"]');
          if (link) {
            const href = link.getAttribute('href') || '';
            const slug = href.split('/property/')[1];
            if (slug) address = slug.replace(/\\/$/, '').replace(/-/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase());
          }
        }
        if (!address || address.length < 5) continue;
        // Price from tags or status text
        let price = null;
        const tags = card.querySelectorAll('.c__property__tags li, .c__property__infoPoints li');
        for (const tag of tags) {
          const tm = (tag.textContent || '').match(/(?:Starting\\s*bid|Guide\\s*Price)[:\\s]*£([\\d,]+)/i);
          if (tm) { price = parseInt(tm[1].replace(/,/g, '')); break; }
        }
        if (!price) {
          const pm = text.match(/(?:Starting\\s*bid|Guide\\s*Price)[:\\s]*£([\\d,]+)/i);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        if (!price) {
          const pm = text.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image from data-bkimage (cloudfront CDN)
        let imageUrl = '';
        const bkImg = card.querySelector('[data-bkimage]');
        if (bkImg) imageUrl = bkImg.getAttribute('data-bkimage') || '';
        if (!imageUrl) {
          const webpAlt = card.querySelector('[data-webpalt]');
          if (webpAlt) imageUrl = webpAlt.getAttribute('data-webpalt') || '';
        }
        if (!imageUrl) imageUrl = extractCardImage(card);
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/property/"]');
        if (link) url = link.getAttribute('href') || '';
        // Bullets
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(Detached|Semi-Detached|Terrace|Flat|Apartment|Bungalow|House|Cottage|Land|Commercial)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        // Status tag
        const statusEl = card.querySelector('.c__property__status');
        if (statusEl) {
          const st = (statusEl.textContent || '').trim();
          if (st && st !== 'Available') bullets.push(st);
        }
        if (seen.has(url || address)) continue;
        seen.add(url || address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};

export const aliases = {
  driversnorris: 'iamsold',
  wrightmarshall: 'iamsold',
};
