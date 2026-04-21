// lib/extractors/platforms/countrywide.js — Countrywide platform extractors
export default {
  countrywide: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Cards use .property-gallery containers or fall back to anchors with property_details links
      let cards = document.querySelectorAll('.property-gallery');
      if (cards.length === 0) {
        // Fallback: find all h3 elements that sit near property_details links
        cards = document.querySelectorAll('a[href*="property_details"]');
        // Walk up to find parent containers
        const containers = new Set();
        for (const a of cards) {
          let el = a.parentElement;
          for (let i = 0; i < 5 && el; i++) {
            if (el.querySelectorAll('a[href*="property_details"]').length === 1) { containers.add(el); break; }
            el = el.parentElement;
          }
        }
        cards = [...containers];
      }
      let lotIndex = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        // Address from h3 or .property-gallery__address
        const addrEl = card.querySelector('h3, .property-gallery__address');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price — check h2, p, or any text containing £
        let price = null;
        let priceText = '';
        const priceEl = card.querySelector('h2, .property-gallery__title');
        if (priceEl) priceText = priceEl.textContent.trim();
        if (!priceText.includes('£')) {
          // Fallback: scan p tags and text nodes for guide price
          const pEls = card.querySelectorAll('p, span, div');
          for (const p of pEls) {
            if (p.textContent.includes('£') || p.textContent.match(/Guide/i)) { priceText = p.textContent.trim(); break; }
          }
        }
        const priceMatch = priceText.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL from detail link
        let url = '';
        const detailLink = card.querySelector('a[href*="property_details"]');
        if (detailLink) url = detailLink.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img:not(.sold)');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        // Bullets — sold status, virtual tour
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bPostponed\\b/i)) bullets.push('SOLD/STC');
        if (card.querySelector('.vu360')) bullets.push('Virtual Tour Available');
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  venmore: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.property-strip-block');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number from "Lot N" text
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from span.f-body-copy.db.marbot10
        let address = '';
        const addrEl = card.querySelector('.f-body-copy.db.marbot10, span[class*="marbot"]');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        // Price from span.p-text-green — "Guide Price £90,000 PLUS*"
        let price = null;
        const priceEl = card.querySelector('.p-text-green, span[class*="greatprimer"]');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from detail link
        let url = '';
        const link = card.querySelector('a[href*="Property-Details"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.img_resp, img[src*="resizeCrop"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — status, auction date
        const bullets = [];
        const statusEl = card.querySelector('.p-flash-green');
        if (statusEl) {
          const _st = statusEl.textContent.trim();
          if (_st.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          else if (_st.length > 1) bullets.push(_st);
        }
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        const dateMatch = text.match(/(\\d{2}\\/\\d{2}\\/\\d{4})/);
        if (dateMatch) bullets.push('Auction: ' + dateMatch[1]);
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  suttonkersh: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.propertyBox.auctionBox');
      for (const card of cards) {
        const text = card.textContent || '';
        // URL from detail link — MUST exist to confirm this is a real lot
        let url = '';
        const link = card.querySelector('a[href*="/properties/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        if (!url) continue;
        // Address from h1 > a inside .info
        let address = '';
        const addrEl = card.querySelector('.info h1 a, h1 a');
        if (addrEl) address = addrEl.textContent.replace(/\\n/g, ', ').trim();
        if (!address || address.length < 5) continue;
        // Skip if address looks like nav/chrome text
        if (address.match(/^(Home|Contact|About|Search|Properties|Menu|Login|Register)$/i)) continue;
        // Price from h2 > a inside .info — "Sold for £63,000" or "Available at £X"
        let price = null;
        const priceEl = card.querySelector('.info h2 a, h2 a');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot[:\\s]+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Image
        let imageUrl = '';
        const img = card.querySelector('.img_container img:not(.sold), img[src*="image_crop"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — status, property type (strict filtering)
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        if (text.match(/\\bPostponed\\b/i)) bullets.push('Postponed');
        // Property type from p tags — only keep lines that look like property descriptions
        const infoPs = card.querySelectorAll('.info p');
        for (const p of infoPs) {
          const pt = p.textContent.trim();
          if (pt.length < 4 || pt.length > 80) continue;
          // Skip lines that are clearly not property type/description
          if (pt.match(/Lot[:\\s]|Guide|Save|View|Click|Search|Contact|Share|Print|©|Cookie|Privacy|Tel:|Email:|Fax:/i)) continue;
          // Only keep if it looks like a property descriptor
          if (pt.match(/residential|commercial|land|investment|vacant|freehold|leasehold|semi|terrace|detach|flat|house|bungalow|garage|shop|office|warehouse|industrial|mixed.use|development|site/i)) {
            bullets.push(pt);
          }
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
