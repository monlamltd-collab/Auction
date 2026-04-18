// lib/extractors/houses/bagshaws.js — Bagshaws extractor
export default {
  bagshaws: `
  (() => {
    const lots = [];
    // Find all links to barnardmarcusauctions containing "Lot NNN"
    const lotLinks = document.querySelectorAll('a[href*="barnardmarcusauctions"], a[href*="/auctions/"]');
    const seen = new Set();
    for (const link of lotLinks) {
      const strong = link.querySelector('strong') || link;
      const lotMatch = (strong.textContent || '').match(/Lot\\s+(\\d+)/i);
      if (!lotMatch) continue;
      const num = parseInt(lotMatch[1]);
      if (seen.has(num)) continue;
      seen.add(num);
      const url = link.getAttribute('href') || '';
      // The parent <td> contains address and price as text nodes
      const td = link.closest('td');
      if (!td) continue;
      const tdText = td.textContent || '';
      // Address: everything between "Lot NNN" and "Guide:"
      const addrMatch = tdText.match(/Lot\\s+\\d+\\s*(.+?)\\s*Guide/is);
      const address = addrMatch ? addrMatch[1].replace(/\\s+/g, ' ').trim() : '';
      if (!address || address.length < 5) continue;
      const priceMatch = tdText.match(/£([\\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
      // Image: find img in same row or previous row linking to same lot URL
      let imageUrl = '';
      const table = td.closest('table');
      if (table && url) {
        const imgLink = table.querySelector('a[href="' + url.replace(/"/g, '') + '"] img');
        if (imgLink) {
          const s = imgLink.getAttribute('src') || '';
          if (s && s.length > 5) imageUrl = s;
        }
      }
      lots.push({ lot: num, address, price, url, imageUrl: imageUrl || undefined });
    }
    return lots;
  })()
`,
};
