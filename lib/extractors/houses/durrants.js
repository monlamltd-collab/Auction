// lib/extractors/houses/durrants.js — Durrants extractor
export default {
  durrants: `
    (() => {
      const lots = [];
      // Find all "Lot N" markers
      const lotMarkers = document.querySelectorAll('.elementor-icon-list-text');
      for (const marker of lotMarkers) {
        const lotMatch = marker.textContent.match(/Lot\\s*(\\d+)/i);
        if (!lotMatch) continue;
        const lotNum = parseInt(lotMatch[1]);
        // Walk up to the container section
        const section = marker.closest('.e-con, .elementor-section, .elementor-element');
        if (!section) continue;
        const text = section.textContent || '';
        // Address and price are in <p><strong> tags within text-editor widgets
        let address = '', price = null;
        const strongs = section.querySelectorAll('.elementor-widget-text-editor p strong, .elementor-text-editor p strong');
        for (const s of strongs) {
          const t = s.textContent.trim();
          const priceM = t.match(/(?:Guide Price|Auction Guide Price)[^£]*£([\\d,]+)/i);
          if (priceM) { price = parseInt(priceM[1].replace(/,/g, '')); continue; }
          if (t.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && !address) { address = t; }
        }
        if (!address || address.length < 5) continue;
        let url = '';
        const link = section.querySelector('a[href*="/property/"], a.elementor-button');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = section.querySelector('img[src*="durrants"], img[src*="property"]');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
