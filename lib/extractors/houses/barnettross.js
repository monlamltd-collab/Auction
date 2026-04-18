// lib/extractors/houses/barnettross.js — Barnett Ross extractor
export default {
  barnettross: `
    (() => {
      const lots = [];
      const seen = new Set();
      const table = document.querySelector('table.auction-archive-table');
      if (!table) return lots;
      const rows = table.querySelectorAll('tr[onclick], tr[style*="cursor"]');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) continue;
        const lotNum = parseInt(cells[0].textContent.trim()) || (lots.length + 1);
        const address = cells[1].textContent.trim();
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let price = null;
        const priceText = cells[3].textContent || '';
        const pm = priceText.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        let url = '';
        const onclick = row.getAttribute('onclick') || '';
        const urlMatch = onclick.match(/document\\.location='([^']+)'/);
        if (urlMatch) url = urlMatch[1];
        const bullets = [];
        const _rt = row.textContent || '';
        if (_rt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        let imageUrl = '';
        const img = row.querySelector('img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s && s.length > 10 && !s.startsWith('data:') && !/logo|icon|\\.svg|spacer|pixel/i.test(s)) imageUrl = s;
        }
        lots.push({ lot: lotNum, address, price, url, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,
};
