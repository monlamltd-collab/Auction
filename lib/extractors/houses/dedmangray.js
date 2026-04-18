// lib/extractors/houses/dedmangray.js — Dedman Gray extractor
export default {
  dedmangray: `
    (() => {
      const lots = [];
      const seen = new Set();
      const tables = document.querySelectorAll('table.lotdetails');
      for (const table of tables) {
        const lotCell = table.querySelector('td.lotnum');
        let lotNum = lots.length + 1;
        if (lotCell) {
          const m = lotCell.textContent.match(/LOT[:\\s]+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        const addrCell = table.querySelector('td.lottag');
        let address = addrCell ? addrCell.textContent.trim().replace(/\\s+/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let price = null;
        const text = table.textContent || '';
        const pm = text.match(/Guide Price[^£]*£([\\d,]+)/i);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        let url = '';
        const link = table.querySelector('a[href*="lot-details"], a[href*="lid="]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = table.querySelector('td.lotimagecol img, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        const descCells = table.querySelectorAll('td[colspan="2"]');
        if (descCells.length > 0) {
          const desc = descCells[0].textContent.trim().replace(/\\s+/g, ' ');
          if (desc.length > 10 && desc.length < 500 && !desc.match(/^Guide Price/i)) {
            bullets.push(desc.substring(0, 250));
          }
        }
        const _tt = table.textContent || '';
        if (_tt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
