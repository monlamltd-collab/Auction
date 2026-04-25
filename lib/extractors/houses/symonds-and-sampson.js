// lib/extractors/houses/symonds-and-sampson.js — Symonds & Sampson extractor
//
// Bug fix (2026-04-25): event-listing cards on auctions.symondsandsampson.co.uk
// don't expose `data-bg` on the same container as the main /property/ pages, and
// the listing-page hrefs use opaque slug shapes (no /house/ /flat/ or /N-bedroom/),
// so URL-regex extraction silently failed and the frontend showed:
//   - house brand panel as "image" (data-bg empty → cdn.webdadi.net fallback empty
//     → falls through to CSS background-image of an ancestor)
//   - address = single town name only
//   - property type = "other", beds = "1 bed" (regex defaults)
//
// Fix: route image through shared extractCardImage() helper (auto-injected by
// lib/extractors/runner.js), read full address from sibling element, read type
// and bed count from card badges instead of URL.
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

        // Address — combine h3 (often town only) with street/postcode sibling
        const descDiv = link.querySelector('.FeaturedProperty__description') || link;
        const h3 = descDiv.querySelector('h3');
        const addrEl = descDiv.querySelector('.FeaturedProperty__address, h3 + p, h3 ~ p, [class*="address" i]');
        const town = h3 ? h3.textContent.trim() : '';
        const street = addrEl ? addrEl.textContent.trim() : '';
        const parts = [street, town].filter(Boolean);
        const dedup = [];
        for (const p of parts) if (!dedup.some(d => d.toLowerCase() === p.toLowerCase())) dedup.push(p);
        const address = dedup.join(', ') || town;
        if (!address) continue;

        // Price
        let price = null;
        const priceEl = link.querySelector('.nativecurrencyvalue, [class*="guide" i], [class*="price" i]');
        if (priceEl) {
          const pm = priceEl.textContent.replace(/[^0-9]/g, '');
          if (pm) price = parseInt(pm);
        }

        // Image — shared helper handles data-bg, data-src, data-lazy-src, srcset, background-image, junk filter
        let imageUrl = '';
        try { imageUrl = extractCardImage(card) || ''; } catch (_) { imageUrl = ''; }
        if (!imageUrl) {
          // Legacy fallbacks for /property/ detail-style cards
          const imgDiv = link.querySelector('.FeaturedProperty__featured-image, [data-bg]');
          if (imgDiv) imageUrl = imgDiv.getAttribute('data-bg') || '';
          if (!imageUrl) {
            const img = link.querySelector('img[src*="cdn.webdadi.net"]');
            if (img) imageUrl = img.getAttribute('src') || '';
          }
        }

        // Bullets — read from card badges, not URL regex (URL regex was failing on event listing slugs)
        const bullets = [];
        const seen = new Set();
        const badgeEls = card.querySelectorAll('[class*="badge" i], [class*="tag" i], [class*="feature" i] li, .FeaturedProperty__features *, .FeaturedProperty__icons *');
        for (const b of badgeEls) {
          const t = (b.textContent || '').trim();
          if (!t || t.length > 40) continue;
          const k = t.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          if (/\\bbed(room)?s?\\b|\\bbath(room)?s?\\b|\\brecep(tion)?s?\\b|leasehold|freehold|share of freehold|\\bepc\\b|garage|garden|modernisation|tenure|detached|semi[- ]?detached|terrac|cottage|bungalow|flat|apartment|land|barn|maisonette|commercial/i.test(t)) {
            bullets.push(t);
          }
        }
        // Fallback to URL regex only if nothing useful was harvested from badges
        if (bullets.length === 0) {
          const typeMatch = href.match(/\\/(house|flat|land|bungalow|detached|semi-detached|terraced|cottage|studio|other|barn|garage|maisonette|commercial)[\\/]/i);
          if (typeMatch) bullets.push(typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1));
          const bedMatch = href.match(/(\\d+)-bedroom/i);
          if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        }

        lots.push({ lot: lotNum, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,
};
