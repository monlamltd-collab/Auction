// lib/extractors/houses/smithandsons.js — Smith and Sons extractor
export default {
  smithandsons: `
  (() => {
    const lots = [];
    const seen = new Set();
    const links = document.querySelectorAll('a[href*="/auctionproperties/"]');
    let idx = 1;
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (!href || seen.has(href) || href.split('/').length < 3) continue;
      // Skip navigation/auction event links (those are shorter paths)
      if (!/[a-z].*[a-z]/i.test(href.split('/auctionproperties/')[1] || '')) continue;
      seen.add(href);
      const text = link.textContent || '';
      // Address — look for postcode-containing text
      let address = '';
      const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 5);
      // Typically: price range, property type, address with postcode
      for (const line of lines) {
        if (/[A-Z]{1,2}\\d{1,2}\\s*\\d[A-Z]{2}/i.test(line) || (line.length > 10 && !line.startsWith('£') && !/^(Vacant|Commercial|Residential|Land|Guide)/i.test(line))) {
          address = line;
          break;
        }
      }
      if (!address) address = lines[lines.length - 1] || '';
      if (!address || address.length < 5) { idx++; continue; }
      // Price — range format "£75,000 - £85,000" or single
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = link.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || '';
        if (s && !/logo|icon/i.test(s)) imageUrl = s;
      }
      // Bullets
      const bullets = [];
      if (/Vacant/i.test(text)) bullets.push('Vacant');
      if (/Commercial/i.test(text)) bullets.push('Commercial');
      if (/Land/i.test(text)) bullets.push('Land');
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
