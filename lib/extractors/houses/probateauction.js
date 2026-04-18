// lib/extractors/houses/probateauction.js — Probate Auction extractor
export default {
  probateauction: `
    (() => {
      const lots = [];
      document.querySelectorAll('.property-list-card').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a[href*="/lot/"], a[href*="property"]');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
        // Address is typically the first substantial line that isn't lot number or price
        const address = lines.find(l => l.length > 10 && !l.match(/^(?:lot|guide|£|sold|property details|view|swipe)/i));
        // Description is the longest paragraph-like text
        const desc = lines.filter(l => l.length > 30 && !l.match(/^(?:lot|£)/i)).join(' ').substring(0, 300);
        // Image — check background-image slides first (Cycle2 gallery uses <a class="slide" style="background-image:url(...)">)
        let imageUrl = '';
        const slideDiv = card.querySelector('.slide[style*="background"], .swiper-slide [style*="background"], [style*="background-image"]');
        if (slideDiv) {
          const bg = slideDiv.getAttribute('style') || '';
          const bgMatch = bg.match(/background(?:-image)?:\\s*url\\(['"]?([^'"\\)]+)/i);
          if (bgMatch) imageUrl = bgMatch[1];
        }
        if (!imageUrl) {
          // Fallback to img tags — exclude SVG nav arrows and icons
          const swiperImg = card.querySelector('.swiper-slide img, img[src*="uploads"]');
          if (swiperImg) {
            const s = swiperImg.getAttribute('src') || swiperImg.dataset.src || '';
            if (s && !s.includes('.svg') && !s.includes('arrow') && !s.includes('logo') && !s.includes('icon')) imageUrl = s;
          }
        }
        if (!imageUrl) {
          const anyImg = card.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !s.includes('arrow') && s.length > 10) imageUrl = s;
          }
        }
        if (address) {
          const bullets = desc ? [desc] : [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
            if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
          }
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,
};
