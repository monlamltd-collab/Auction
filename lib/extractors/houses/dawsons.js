// lib/extractors/houses/dawsons.js — Dawsons extractor
export default {
  dawsons: `
    (() => {
      const lots = [];
      const usedImages = new Set();
      const contentBlocks = document.querySelectorAll('.homes-content');
      for (const block of contentBlocks) {
        const text = block.textContent || '';
        if (text.length < 10) continue;
        let address = '';
        const h3 = block.querySelector('h3');
        if (h3) address = h3.textContent.trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const priceEl = block.querySelector('.price-properties .title, .price-properties h3');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = block.querySelector('a[href*="/auction/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        // Strategy 1: image inside the block itself
        let img = block.querySelector('img.d-block, img.img-fluid, img[src*="auction"], img[src*="/assets/"]');
        // Strategy 2: sibling column in the same .row (each lot has its own .row)
        if (!img) {
          const row = block.closest('.row');
          if (row) {
            // Find images NOT inside this block (sibling col)
            const allImgs = row.querySelectorAll('img.d-block, img.img-fluid, img[src*="auction"], img[src*="/assets/"]');
            for (const candidate of allImgs) {
              if (!block.contains(candidate)) {
                const src = candidate.getAttribute('src') || '';
                // Skip if this exact image was already assigned to another lot
                if (src && !usedImages.has(src)) { img = candidate; break; }
              }
            }
          }
        }
        if (img) {
          const src = img.getAttribute('src') || '';
          if (src && !usedImages.has(src)) {
            imageUrl = src;
            usedImages.add(src);
          }
        }
        const bullets = [];
        const beds = block.querySelector('.fa-bed');
        if (beds && beds.nextElementSibling) bullets.push(beds.nextElementSibling.textContent.trim() + ' bed');
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lots.length + 1, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
