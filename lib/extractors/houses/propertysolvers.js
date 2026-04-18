// lib/extractors/houses/propertysolvers.js — Property Solvers extractor
export default {
  propertysolvers: `
  (() => {
    const lots = [];
    const seen = new Set();
    // PropertyHive: lot cards inside .phive-results container
    const cards = document.querySelectorAll('.phive-results .row.property, .property-results .row.property, .propertyhive-property');
    let idx = 1;
    for (const card of cards) {
      // Address from h3 link inside details
      const addrLink = card.querySelector('.phive-details-inner h3 a, .details h3 a, h3 a');
      const address = addrLink ? addrLink.textContent.trim() : '';
      if (!address || address.length < 5) { idx++; continue; }
      // Lot detail URL
      const url = addrLink ? addrLink.getAttribute('href') || '' : '';
      if (seen.has(url)) continue;
      seen.add(url);
      // Price — strip qualifier spans, extract £ amount
      const priceEl = card.querySelector('.phive-details-inner .price, .details .price, .price');
      let price = null;
      if (priceEl) {
        const priceText = priceEl.textContent.replace(/\\s+/g, ' ').trim();
        const pm = priceText.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image from thumbnail
      const img = card.querySelector('.phive-thumb img, .thumbnail img, img[src]');
      let imageUrl = '';
      if (img) {
        imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
      }
      // Bullets from CSS class metadata
      const bullets = [];
      const classList = card.className || '';
      if (/tenure-freehold/i.test(classList)) bullets.push('Freehold');
      if (/tenure-leasehold/i.test(classList)) bullets.push('Leasehold');
      if (/sale_by-unconditional/i.test(classList)) bullets.push('Unconditional');
      if (/sale_by-conditional/i.test(classList)) bullets.push('Conditional');
      if (/availability-sold/i.test(classList) || card.textContent.match(/\\bSOLD\\b|\\bSTC\\b/i)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`,
};
