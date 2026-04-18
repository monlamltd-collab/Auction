// lib/extractors/universal.js — Universal DOM extractor
// Works on any auction site by detecting common patterns
export const UNIVERSAL_DOM_EXTRACTOR = `
  (() => {
    const lots = [];
    const seen = new Set();

    // Strategy 1: Find all links to individual property/lot pages
    const propLinks = document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], a[href*="property-details"], a[href*="/properties/"], a[href*="/auction/"], a[href*="/catalogue/"], a[href*="/sale/"], a[href*="lot-overview"], a[href*="/listing/"], a[href*="/auctions/lot"]');
    const linkSet = new Set();

    for (const link of propLinks) {
      const href = link.getAttribute('href') || '';
      if (linkSet.has(href)) continue;
      linkSet.add(href);

      // Walk up to find the card container (look for a repeating parent element)
      let card = link;
      for (let i = 0; i < 8 && card.parentElement; i++) {
        card = card.parentElement;
        // Stop when we find an element that likely wraps a single lot
        const cl = (card.className || '').toLowerCase();
        const tag = card.tagName.toLowerCase();
        if (cl.match(/card|lot|property|listing|item|result|auction/) ||
            (tag === 'article') ||
            (tag === 'li' && card.querySelector('a[href]'))) break;
      }

      const text = card.innerText || card.textContent || '';
      if (text.length < 20 || text.length > 5000) continue;

      // Extract price
      let price = null;
      const priceMatch = text.match(/(?:Guide[\\s]*(?:Price)?|Price|Starting|Reserve|Estimate)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));

      // Extract address — look for postcode pattern
      let address = '';
      const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 0);
      // First try: line with a UK postcode
      for (const line of lines) {
        if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && line.length < 200) {
          address = line;
          break;
        }
      }
      // Second try: first heading in the card
      if (!address) {
        const heading = card.querySelector('h1, h2, h3, h4, h5, .title, .address, [class*="title"], [class*="address"]');
        if (heading) address = heading.textContent.trim();
      }
      // Third try: link title or first substantial text
      if (!address) {
        const title = link.getAttribute('title');
        if (title && title.length > 5) address = title;
      }
      if (!address) {
        const substantial = lines.find(l => l.length > 10 && l.length < 150 && !l.match(/^(Guide|Price|Lot|Find|View|More|Search|Filter|Sort|Show|Order|£)/i));
        if (substantial) address = substantial;
      }
      if (!address || address.length < 5) continue;

      // Deduplicate by address
      const addrKey = address.toLowerCase().replace(/\\s+/g, ' ').substring(0, 60);
      if (seen.has(addrKey)) continue;
      seen.add(addrKey);

      // Extract lot number
      let lotNum = lots.length + 1;
      const lotMatch = text.match(/Lot\\s+(\\d+)/i);
      if (lotMatch) lotNum = parseInt(lotMatch[1]);

      // Extract bullets/features
      const bullets = [];
      card.querySelectorAll('li, .feature, .tag, .type, .property-type, .meta').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 2 && t.length < 200 && !t.match(/^(Search|Filter|Sort|Show|View|Order|My|Menu|Buy|Sell|About|Contact|Home)/i)) {
          bullets.push(t);
        }
      });
      // Also grab description-like paragraphs
      card.querySelectorAll('p, .description, [class*="desc"]').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 15 && t.length < 300 && !bullets.includes(t)) bullets.push(t);
      });

      // Detect sold/withdrawn status
      if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
        if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
      }

      // Extract image from card
      let imageUrl = '';
      const junkImg = /\\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge|placeholder|no-image|1x1/i;
      const img = card.querySelector('img[src], img[data-src], img[data-lazy-src]');
      if (img) {
        const imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
        if (imgSrc && imgSrc.length > 10 && !imgSrc.startsWith('data:') && !junkImg.test(imgSrc)) {
          imageUrl = imgSrc;
        }
      }
      // Also check for background-image on card or immediate children
      if (!imageUrl) {
        const bgEl = card.querySelector('[style*="background"]');
        if (bgEl) {
          const bgMatch = (bgEl.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
          if (bgMatch && bgMatch[1] && !junkImg.test(bgMatch[1])) imageUrl = bgMatch[1];
        }
      }

      lots.push({ lot: lotNum, address, price, url: href, imageUrl: imageUrl || undefined, bullets: bullets.slice(0, 8) });
    }

    // Strategy 2: If no property links found, look for repeated card-like elements
    if (lots.length === 0) {
      // Find the most common class pattern that appears 5+ times with £ prices
      const candidates = document.querySelectorAll('[class*="card"], [class*="lot"], [class*="property"], [class*="listing"], [class*="item"], [class*="auction"], article');
      for (const card of candidates) {
        const text = card.innerText || card.textContent || '';
        if (text.length < 30 || text.length > 5000) continue;
        const priceMatch = text.match(/£([\\d,]+)/);
        if (!priceMatch) continue;
        const price = parseInt(priceMatch[1].replace(/,/g, ''));
        if (price < 1000) continue; // Skip non-property prices

        let address = '';
        const heading = card.querySelector('h1, h2, h3, h4, h5, .title, .address, [class*="title"], [class*="address"]');
        if (heading) address = heading.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 10 && s.length < 150);
          if (lines.length) address = lines[0];
        }
        if (!address || address.length < 5) continue;

        const addrKey = address.toLowerCase().replace(/\\s+/g, ' ').substring(0, 60);
        if (seen.has(addrKey)) continue;
        seen.add(addrKey);

        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bSALE.?AGREED\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }

        // Extract image from card
        let imageUrl = '';
        const junkImg2 = /\\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge|placeholder|no-image|1x1/i;
        const img2 = card.querySelector('img[src], img[data-src], img[data-lazy-src]');
        if (img2) {
          const imgSrc2 = img2.getAttribute('src') || img2.getAttribute('data-src') || img2.getAttribute('data-lazy-src') || '';
          if (imgSrc2 && imgSrc2.length > 10 && !imgSrc2.startsWith('data:') && !junkImg2.test(imgSrc2)) {
            imageUrl = imgSrc2;
          }
        }
        if (!imageUrl) {
          const bgEl2 = card.querySelector('[style*="background"]');
          if (bgEl2) {
            const bgMatch2 = (bgEl2.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
            if (bgMatch2 && bgMatch2[1] && !junkImg2.test(bgMatch2[1])) imageUrl = bgMatch2[1];
          }
        }

        lots.push({ lot: lotMatch ? parseInt(lotMatch[1]) : lots.length + 1, address, price, url, imageUrl: imageUrl || undefined, bullets: bullets.slice(0, 8) });
      }
    }

    return lots;
  })()
`;
