// lib/extractors/platforms/auction-house-uk.js — Auction House UK platform extractors
export default {
  auctionhouseuk: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.lot-search-result, .lot-search-wrapper');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/Guide[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const addrEl = card.querySelector('p.grid-address, .grid-address');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address) {
          const typeEl = card.querySelector('p.fw-bold.blue-text');
          if (typeEl) address = typeEl.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        let url = '';
        const link = card.querySelector('a[href*="/auction/lot/"], a.home-lot-wrapper-link');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img.lot-image, img[loading="lazy"]');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        // Skip sold/completed lots — search results include historical
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b|Auction\\s*Ended/i)) continue;
        const ribbon = card.querySelector('.lot-tag, .ribbon, [data-ribbon]');
        if (ribbon && /sold|completed|exchanged/i.test(ribbon.textContent || ribbon.getAttribute('data-ribbon') || '')) continue;
        const bullets = [];
        lots.push({ lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  auctionhouse: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], article, .search-result');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        // Image from card — uses lazy-load helpers for data-src/data-lazy-src/background-image fallback
        let imageUrl = extractCardImage(card);
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};

export const aliases = {
  auctionhousescotland: 'auctionhouseuk',
  austingray: 'auctionhouseuk',
  auctionhouseeastanglia: 'auctionhouseuk',
  auctionhousenorthwest: 'auctionhouseuk',
  auctionhousenortheast: 'auctionhouseuk',
  auctionhousewales: 'auctionhouseuk',
  auctionhousebirmingham: 'auctionhouseuk',
  auctionhousekent: 'auctionhouseuk',
  auctionhousedevon: 'auctionhouseuk',
  auctionhouseeastmidlands: 'auctionhouseuk',
  auctionhousewestmidlands: 'auctionhouseuk',
  auctionhouseessex: 'auctionhouseuk',
  auctionhousemanchester: 'auctionhouseuk',
  auctionhousesouthyorkshire: 'auctionhouseuk',
  auctionhousewestyorkshire: 'auctionhouseuk',
  auctionhouseteesvalley: 'auctionhouseuk',
  auctionhousehull: 'auctionhouseuk',
  auctionhousecumbria: 'auctionhouseuk',
  auctionhouselincolnshire: 'auctionhouseuk',
  auctionhouseuklondon: 'auctionhouseuk',
  auctionhousebedsandbucks: 'auctionhouseuk',
  auctionhousenorthamptonshire: 'auctionhouseuk',
  auctionhouseoxfordshire: 'auctionhouseuk',
  auctionhouseleicestershire: 'auctionhouseuk',
  auctionhousemidlands: 'auctionhouseuk',
  auctionhousecoventry: 'auctionhouseuk',
  auctionhousenottsandderby: 'auctionhouseuk',
  auctionhousechesterfield: 'auctionhouseuk',
  auctionhousestaffordshire: 'auctionhouseuk',
  auctionhousenorthwales: 'auctionhouseuk',
  auctionhousesouthwest: 'auctionhouseuk',
  auctionhousenorthernireland: 'auctionhouseuk',
  auctionhousenational: 'auctionhouseuk',
};
