// lib/extractors/houses/cheffins.js — Cheffins extractor
export default {
  cheffins: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.property-card');
      for (const card of cards) {
        // Lot number from pc-tag
        let lotNum = 0;
        const tag = card.querySelector('div.pc-tag');
        if (tag) {
          const m = (tag.textContent || '').match(/Lot\\s*(?:number)?:?\\s*(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from pc-add
        let address = '';
        const addrEl = card.querySelector('div.pc-add');
        if (addrEl) address = (addrEl.textContent || '').trim();
        if (!address || address.length < 5) continue;
        // Price from pc-price
        let price = null;
        const priceEl = card.querySelector('div.pc-price');
        if (priceEl) {
          const pt = (priceEl.textContent || '').trim();
          const pm = pt.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: data-img attribute on slider divs (EIG CDN)
        let imageUrl = '';
        const imgDiv = card.querySelector('div.pc-slide > div[data-img]');
        if (imgDiv) imageUrl = imgDiv.getAttribute('data-img') || '';
        // Detail link
        let url = '';
        const detailBtn = card.querySelector('a.btn--alt, a.btn');
        if (detailBtn) url = detailBtn.getAttribute('href') || '';
        // Bullets: status from pc-extraInfo
        const bullets = [];
        const extraInfo = card.querySelector('div.pc-extraInfo');
        if (extraInfo) {
          const status = (extraInfo.textContent || '').trim();
          if (status && status !== 'New') bullets.push(status);
        }
        // Description summary
        const summ = card.querySelector('div.pc-summ');
        if (summ) {
          const st = (summ.textContent || '').trim();
          if (st.match(/\\bland\\b/i)) bullets.push('Land');
          if (st.match(/\\bgarage\\b/i)) bullets.push('Garage');
          if (st.match(/\\bbarn\\b/i)) bullets.push('Barn');
          const bedMatch = st.match(/(\\d+)\\s*(?:bed|Bed)/i);
          if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        }
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
