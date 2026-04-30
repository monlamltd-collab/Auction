// lib/extractors/platforms/eig.js — EIG platform extractors
export default {
  eigplatform: `
    (() => {
      const lots = [];
      // Strategy 1: lot-panel cards (grid/list view)
      let cards = document.querySelectorAll('.lot-panel');
      if (cards.length === 0) cards = document.querySelectorAll('[data-lot-item-toggle]');
      // Strategy 2: find lot links, dedupe by href, walk up to parent container
      if (cards.length === 0) {
        const links = document.querySelectorAll('a[href*="/lot/details/"]');
        const seen = new Set();
        const containers = [];
        for (const a of links) {
          const href = a.getAttribute('href');
          if (!href || seen.has(href)) continue;
          seen.add(href);
          // Walk up to find the lot container — try grandparent or great-grandparent
          let container = a.parentElement;
          // Keep walking up while container has little text (probably just wraps the link)
          for (let i = 0; i < 3 && container && container.textContent.length < 50; i++) {
            container = container.parentElement;
          }
          if (container) containers.push(container);
        }
        cards = containers;
      }
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:Guide Price|Opening Bid|Minimum Opening Bid)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // Address from known selectors — try specific selectors first, then generic
        let address = '';
        const addrEl = card.querySelector('h3.list-address') || card.querySelector('h4.grid-address')
          || card.querySelector('.lot-address') || card.querySelector('[data-address-searchable]')
          || card.querySelector('h4.lot-data-heading')
          || card.querySelector('h3') || card.querySelector('h4');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.list-image, img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon) {
          const r = ribbon.getAttribute('data-ribbon') || '';
          if (/sold|completed|exchanged/i.test(r)) continue;
          if (r) bullets.push(r);
        } else if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b|Auction\\s*Ended/i)) continue;
        // Extract bedrooms from card text (e.g. "3 Bedroom", "2 bed", "4-bed")
        const bedMatch = text.match(/(\\d+)\\s*[-\\s]?(?:bed(?:room)?s?)\\b/i);
        const beds = bedMatch ? parseInt(bedMatch[1]) : null;
        const entry = { lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined };
        if (beds) entry.beds = beds;
        lots.push(entry);
      }
      return lots;
    })()
  `,

  paulfosh: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Lot number from panel title
        const titleEl = card.querySelector('.panel-title');
        let lotNum = lotIndex;
        if (titleEl) {
          const lotMatch = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        }
        // Price from .grid-guideprice strong or b
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice strong, .grid-guideprice b');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.grid-img-container img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Tagline as bullet
        const bullets = [];
        const tagline = card.querySelector('.grid-tagline');
        if (tagline) {
          const t = tagline.textContent.trim().replace(/^Lot\\s+\\d+\\s*-\\s*/i, '');
          if (t.length > 3) bullets.push(t);
        }
        const _pt = card.textContent || '';
        // Skip ended/sold/completed lots — EIG /search includes historical
        const ribbon = card.querySelector('[data-ribbon]');
        const ribbonText = ribbon ? (ribbon.getAttribute('data-ribbon') || '') : '';
        if (/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b|Auction\\s*Ended/i.test(_pt)) continue;
        if (/sold|completed|exchanged|ended/i.test(ribbonText)) continue;
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  firstforauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        // Address from h4.grid-address
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price from div.grid-guideprice b
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice b');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from image container or View button
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a.btn-primary[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.grid-img-container img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        const bullets = [];
        const _ft = card.textContent || '';
        // Skip sold/completed/ended lots entirely — EIG /search includes historical
        if (_ft.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b|Auction\\s*Ended/i)) continue;
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon && /sold|completed|exchanged/i.test(ribbon.getAttribute('data-ribbon') || '')) continue;
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  harmanhealy: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Try data-lot-item-toggle first, fall back to lot-panel
      let cards = document.querySelectorAll('[data-lot-item-toggle]');
      if (cards.length === 0) cards = document.querySelectorAll('.lot-panel, a[href*="/lot/details/"]');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from [data-address-searchable] or first heading
        let address = '';
        const addrEl = card.querySelector('[data-address-searchable], h3 a, a h3, h3, h4.grid-address, h4');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        // Skip descriptions masquerading as addresses (e.g. "A three bedroom house" with no postcode)
        if (address && /^A\\s+(one|two|three|four|five|six|\\d+)\\s+(bed|studio)/i.test(address)) {
          // Try h3 which often has the real address on EIG sites like Harmanhealy
          const h3El = card.querySelector('h3');
          if (h3El && h3El !== addrEl) {
            const h3Text = h3El.textContent.trim().replace(/\\u00a0/g, ' ');
            if (h3Text && h3Text.length >= 10 && /[A-Z]{1,2}\\d/.test(h3Text)) address = h3Text;
          }
        }
        if (!address) {
          // Fallback: find postcode line in text
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && l.length < 200) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price — "Guide Price*: £165,000 plus"
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Minimum Opening)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        // Bullets — end time
        const bullets = [];
        const endMatch = text.match(/End Time[^\\d]*(\\d{2}\\/\\d{2}\\/\\d{4}\\s*\\d{2}:\\d{2})/i);
        if (endMatch) bullets.push('End Time: ' + endMatch[1]);
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bAuction Ended\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  seelauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Seel Auctions 2026: EIG platform — try multiple card selectors
      let cards = document.querySelectorAll('.lot-panel');
      if (cards.length === 0) cards = document.querySelectorAll('[data-lot-item-toggle]');
      if (cards.length === 0) cards = document.querySelectorAll('a[href*="/lot/details/"]');
      if (cards.length === 0) cards = document.querySelectorAll('.grid-item, [class*="lot-card"], [class*="property-card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10 || text.length > 3000) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        if (seen.has(num)) continue;
        seen.add(num);
        // Address
        let address = '';
        const addrEl = card.querySelector('h4.grid-address, .lot-address, [data-address-searchable], h4, h3, .address');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        // Price
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Opening Bid)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.grid-img, img.img-responsive, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bPostponed\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  knightfrank: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], .lot-card, .property-card, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const href = el.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:guide|price|reserve)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/£[\\d,]+/g, '').replace(/guide\\s*price/i, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          // Image from card — uses lazy-load helpers
          let imageUrl = extractCardImage(el);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  bradleyhall: `
    (() => {
      const lots = [];
      const seen = new Set();
      document.querySelectorAll('.lot-panel').forEach(panel => {
        const text = panel.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) return;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) return;
        seen.add(num);
        const link = panel.querySelector('a[href*="/lot/"]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/Guide Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const addrEl = panel.querySelector('.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) return;
        const taglineEl = panel.querySelector('.grid-tagline');
        const bullets = [];
        if (taglineEl) bullets.push(taglineEl.textContent.trim());
        // Image from grid-img
        let imageUrl = '';
        const img = panel.querySelector('img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && s.length > 10) imageUrl = s;
        }
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      });
      return lots;
    })()
  `,

  landwood: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const addrEl = card.querySelector('h3.list-address, h3.grid-address, h4.grid-address');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let lotNum = lotIndex;
        const titleEl = card.querySelector('.panel-title');
        if (titleEl) {
          const m = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        let price = null;
        const priceEl = card.querySelector('.list-guideprice strong, .grid-guideprice b, .grid-guideprice strong');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"], a[href*="/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const imgs = card.querySelectorAll('img');
        for (const img of imgs) {
          const s = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
          if (s && s.length > 10 && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !s.includes('gavel') && !s.includes('backdrop') && !s.includes('placeholder')) {
            imageUrl = s;
            break;
          }
        }
        // Dedup: reject image if already used by a previous lot (prevents image bleed)
        const usedImages = lots.map(l => l.imageUrl).filter(Boolean);
        if (imageUrl && usedImages.includes(imageUrl)) imageUrl = '';
        const bullets = [];
        const headingEl = card.querySelector('h4.lot-data-heading strong, h4.lot-data-heading');
        if (headingEl) {
          const t = headingEl.textContent.trim();
          if (t.length > 3 && t.length < 300) bullets.push(t);
        }
        const _ct2 = card.textContent || '';
        if (_ct2.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  mchughandco: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        // Address from h4.grid-address
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Lot number from panel title or text
        const titleEl = card.querySelector('.panel-title, .lot-number');
        let lotNum = lotIndex;
        if (titleEl) {
          const lotMatch = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        } else {
          const text = card.textContent || '';
          const lotMatch = text.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        }
        // Price from .grid-guideprice b or strong
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice b, .grid-guideprice strong');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('a[href*="/lot/"], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        // Tagline as bullet
        const bullets = [];
        const tagline = card.querySelector('.grid-tagline');
        if (tagline) {
          const t = tagline.textContent.trim().replace(/^Lot\\s+\\d+\\s*[-–]\\s*/i, '');
          if (t.length > 3) bullets.push(t);
        }
        const _ct = card.textContent || '';
        if (_ct.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  tcpa: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        // Address from span.lot-address
        const addrEl = card.querySelector('.lot-address, span[class*="lot-address"]');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price from span.price inside div.grid-guideprice
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice .price, span.price');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from image container link
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        if (seen.has(url) && url) continue;
        // Image — first real img in swiper
        let imageUrl = '';
        const img = card.querySelector('img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — auction end date, office name, features, ribbon
        const bullets = [];
        const timeEl = card.querySelector('time.text-success');
        if (timeEl) bullets.push('Auction Ends: ' + timeEl.textContent.trim());
        const officeEl = card.querySelector('.lot-auctioneer-name');
        if (officeEl) bullets.push(officeEl.textContent.trim());
        // Features list
        card.querySelectorAll('.grid-tagline.custom-fields li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 1) bullets.push(t);
        });
        // Ribbon badge
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon) {
          const ribbonText = ribbon.getAttribute('data-ribbon') || '';
          if (/sold|completed|exchanged/i.test(ribbonText)) continue;
          bullets.push(ribbonText);
        }
        // Skip sold/completed/ended lots — EIG /search includes historical
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b|Auction\\s*Ended/i)) continue;
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  futureauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Future Property Auctions 2026: ASP pages, property_details.asp links
      // Try both link-as-card and walking up from links to parent containers
      let cards = document.querySelectorAll('a[href*="property_details.asp"]');
      // If links are small (just "View Details"), walk up to parent containers
      const useParent = cards.length > 0 && cards[0].textContent.trim().length < 50;
      const processed = new Set();
      for (const el of cards) {
        const href = el.getAttribute('href') || '';
        if (processed.has(href)) continue;
        processed.add(href);
        // Walk up to the lot container
        let card = el;
        if (useParent) {
          for (let i = 0; i < 6 && card.parentElement; i++) {
            card = card.parentElement;
            const t = card.textContent || '';
            if (t.match(/£[\\d,]/) && t.match(/Lot\\s+\\d|bedroom|property/i)) break;
          }
        }
        const text = card.textContent || '';
        if (text.length < 20 || text.length > 3000) continue;
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        // Price
        let price = null;
        const priceMatch = text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Address — look for Google Maps link text or postcode-containing line
        let address = '';
        const mapsLink = card.querySelector('a[href*="maps.google"], a[href*="google.com/maps"]');
        if (mapsLink) address = mapsLink.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 3);
          for (const line of lines) {
            if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && line.length < 200) {
              address = line.replace(/Lot\\s+\\d+/i, '').replace(/£[\\d,]+[^\\n]*/g, '').trim();
              break;
            }
          }
          if (!address) {
            const h4 = card.querySelector('h4 a, h4, h3');
            if (h4) address = h4.textContent.trim();
          }
        }
        // Collapse internal whitespace — futureauctions h3/h4 fallback comes
        // from markup with embedded \\n\\t indentation that .trim() leaves intact.
        // Result: addresses like "Plot of Land \\n\\t\\t\\t...\\t8.4 Acres at Muirwood".
        if (address) address = address.replace(/\\s+/g, ' ').trim();
        if (!address || address.length < 5) continue;
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="/upload/"], img[src*="futurepropertyauctions"], img[src]');
        if (img) {
          let src = img.getAttribute('src') || '';
          if (src.startsWith('http://')) src = src.replace('http://', 'https://');
          if (src && !src.includes('logo') && !src.includes('icon') && src.length > 10) imageUrl = src;
        }
        const bullets = [];
        const typeMatch = text.match(/(Timed Online Auction|Live Auction)[^\\n]*/i);
        if (typeMatch) bullets.push(typeMatch[0].trim());
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  kivells: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('[class*="bg-listing-item-background"]');
      for (const card of cards) {
        const text = card.textContent || '';
        // Address from h2.font-serif
        const addrEl = card.querySelector('h2.font-serif, h2');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        // Price from h3.font-serif — "£250,000 Guide Price"
        let price = null;
        const priceEl = card.querySelector('h3.font-serif, h3');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from "View property details" link
        let url = '';
        const link = card.querySelector('a[href*="/properties/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image — first property image
        let imageUrl = '';
        const img = card.querySelector('img[src*="/media/Properties/"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Reference code and bedrooms from list items
        const bullets = [];
        card.querySelectorAll('ul li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 1 && t.length < 100) bullets.push(t);
        });
        // Description
        const descEl = card.querySelector('p.font-light.leading-loose, p.font-light');
        if (descEl) {
          const desc = descEl.textContent.trim();
          if (desc.length > 10 && desc.length < 300) bullets.push(desc);
        }
        const _kt = card.textContent || '';
        if (_kt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};

export const aliases = {
  cooperandtanner: 'eigplatform',
  purplebricksgoto: 'eigplatform',
  astleys: 'eigplatform',
  henrysykes: 'eigplatform',
  clarkesimpson: 'eigplatform',
  brownco: 'eigplatform',
  cheffinstimed: 'eigplatform',
  romanway: 'eigplatform',
  hammerprice: 'eigplatform',
  sarahmains: 'eigplatform',
  sageandco: 'eigplatform',
  auctiontrade: 'eigplatform',
  brggibson: 'eigplatform',
  higginsdrysdale: 'eigplatform',
  martinpole: 'eigplatform',
  jonespeckover: 'eigplatform',
  thepropertyauctionhouse: 'eigplatform',
  propertyauctionagent: 'eigplatform',
  lot9: 'eigplatform',
  auctionnorth: 'eigplatform',
  bowensonandwatson: 'eigplatform',
  sheldonbosley: 'eigplatform',
  nationalpropertyauctions: 'eigplatform',
  ahlondon: 'eigplatform',
  starpropertyonline: 'eigplatform',
  brggibsondublin: 'eigplatform',
  lsh: 'eigplatform',
  groundrentauctions: 'eigplatform',
  benjaminstevens: 'eigplatform',
  // 247propertyauctions moved to bamboo platform
  rogerparry: 'eigplatform',
  hmox: 'eigplatform',
  cotswoldpropertyauctions: 'eigplatform',
};
