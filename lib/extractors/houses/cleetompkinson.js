// lib/extractors/houses/cleetompkinson.js — Clee Tompkinson & Francis (CTF)
// Custom Ctesius theme on top of Homeflow assets. Distinct enough from the
// stock Homeflow extractor that it warrants its own selectors:
//   - Cards are .propertyTeaser
//   - URL is the first anchor matching /properties/{id}/sales (numeric id)
//   - Address is the first .u-line span (town/county)
//   - Bold span carries "Guide £XXX,XXX" + "Freehold|Leasehold" + "| N bedrooms"
//   - Image is .propertyTeaser-mainPhoto img with absolute //homeflow-assets URL
// IMG_HELPERS auto-injected by lib/extractors/runner.js.
export default {
  cleetompkinson: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.propertyTeaser');
      let lotIndex = 1;
      for (const card of cards) {
        // URL — must be a numeric lot id, not the nav "Properties for Sale" link
        const link = card.querySelector('a[href*="/properties/"][href*="/sales"]');
        const href = link ? (link.getAttribute('href') || '') : '';
        if (!/\\/properties\\/\\d+\\/sales/.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        // Address — first u-line span inside the description anchor
        let address = '';
        const addrEl = card.querySelector('.propertyTeaser-description a .u-line, .propertyTeaser-description a span');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\.$/, '');
        if (!address || address.length < 5) continue;

        // Bold line contains "Guide £165,000 Freehold | 4 bedrooms" — parse all three
        let price = null;
        const bullets = [];
        const boldEl = card.querySelector('.propertyTeaser-description .u-bold, .u-bold');
        const boldText = boldEl ? boldEl.textContent.replace(/\\s+/g, ' ').trim() : '';
        if (boldText) {
          const pm = boldText.match(/£\\s*([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
          if (/freehold/i.test(boldText)) bullets.push('Freehold');
          else if (/leasehold/i.test(boldText)) bullets.push('Leasehold');
          const bedM = boldText.match(/(\\d+)\\s*bed/i);
          if (bedM) bullets.push(bedM[1] + ' bedrooms');
        }

        // Auction date / SOLD-STC signal from short description
        const descEl = card.querySelector('.propertyShortDesc');
        const descText = descEl ? descEl.textContent : '';
        const dateM = descText.match(/(MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z\\s\\d]+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z\\s\\d]+\\d{4}/i);
        if (dateM) bullets.push(dateM[0].replace(/\\s+/g, ' ').trim());
        if (/\\b(SOLD|SALE\\s*AGREED|STC|WITHDRAWN)\\b/i.test((card.textContent || ''))) {
          if (!bullets.some(b => /SOLD|STC|WITHDRAWN|SALE AGREED/i.test(b))) bullets.push('SOLD/STC');
        }

        // Image — Ctesius cards use plain <img src> (not lazy attrs) but the
        // helper handles both and prepends https: to protocol-relative URLs.
        let imageUrl = extractCardImage(card) || '';
        if (imageUrl && imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

        lots.push({
          lot: lotIndex++,
          address,
          price,
          url: href,
          bullets,
          imageUrl: imageUrl || undefined,
        });
      }
      return lots;
    })()
  `,
};
