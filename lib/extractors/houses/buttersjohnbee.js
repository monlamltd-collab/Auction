// lib/extractors/houses/buttersjohnbee.js — Butters John Bee extractor
export default {
  buttersjohnbee: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Find all h4 elements that look like addresses (near listing links)
      const h4s = document.querySelectorAll('h4');
      let lotNum = 0;
      for (const h4 of h4s) {
        const t = (h4.textContent || '').trim();
        if (t.length < 5 || t.length > 200) continue;
        if (t.match(/^\\d+$/) || t.match(/^(Guide|£|Auction|Search|Filter|Sort)/i)) continue;
        // Walk up to find parent container with listing link
        let container = h4.parentElement;
        let link = null;
        for (let i = 0; i < 8 && container; i++) {
          link = container.querySelector('a[href*="/listings/"]');
          if (link) break;
          container = container.parentElement;
        }
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        if (!href.match(/\\/listings\\//)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        lotNum++;
        // Price from container text
        let price = null;
        const cText = container ? (container.textContent || '') : '';
        const pm = cText.match(/(?:Guide\\s*Price\\s*)?£([\\d,]+)/i);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        // Image from the img link
        let imageUrl = '';
        if (container) {
          const img = container.querySelector('img');
          if (img) imageUrl = getBestImgSrc(img);
          if (isJunkImage(imageUrl)) imageUrl = '';
          if (!imageUrl) imageUrl = extractCardImage(container);
        }
        // Bullets from text
        const bullets = [];
        const bedMatch = cText.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const bathMatch = cText.match(/(\\d+)\\s*bath/i);
        if (bathMatch) bullets.push(bathMatch[1] + ' bathrooms');
        lots.push({ lot: lotNum, address: t.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,
};
