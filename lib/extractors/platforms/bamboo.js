// lib/extractors/platforms/bamboo.js — Bamboo Auctions platform extractors
export default {
  hunters: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Each card is wrapped in an anchor with href="/property/slug-id" (relative)
      // OR href="https://{house}.bambooauctions.com/property/slug-id" (absolute, when
      // the SaaS catalogue is embedded on the auctioneer's own domain — eg. stags.co.uk).
      const allLinks = document.querySelectorAll('a[href*="/property/"]');
      const links = [];
      for (const a of allLinks) {
        const h = a.getAttribute('href') || '';
        // Accept relative /property/slug-id OR absolute *.bambooauctions.com/property/slug-id
        if (/^\\/property\\//.test(h) || /^https?:\\/\\/[^\\/]+\\.bambooauctions\\.com\\/property\\//.test(h)) {
          links.push(a);
        }
      }
      let lotIndex = 1;
      for (const link of links) {
        const url = link.getAttribute('href') || '';
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const card = link;

        // Title: h3 inside the card
        const titleEl = card.querySelector('h3');
        const title = titleEl ? titleEl.textContent.trim() : '';

        // Address: p element with class containing "Address" (styled-components)
        let address = '';
        const addrEl = card.querySelector('p[class*="Address"]');
        if (addrEl) {
          address = addrEl.textContent.trim();
        }
        // Fallback: use title + address combo or just title
        if (!address && title) address = title;
        // Don't skip lots with missing address — enrichLotsFromLotPages will fill them later

        // Combine title and address if they differ
        let fullAddress = address || '';
        if (title && address && !address.toUpperCase().includes(title.substring(0, 10).toUpperCase())) {
          fullAddress = title + ', ' + address;
        }

        // Price: p element with class containing "Price"
        let price = null;
        const priceEl = card.querySelector('p[class*="Price"]');
        if (priceEl) {
          const priceMatch = priceEl.textContent.match(/£([\\d,]+)/);
          if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        }

        // Image: extract from srcset (Next.js /_next/image?url=ENCODED&w=N format)
        // CDN varies: cdn.bambooauctions.com, s3 bamboo-cdn, cloudfront
        let imageUrl = '';
        const img = card.querySelector('img[alt]');
        if (img) {
          const srcset = img.getAttribute('srcset') || '';
          // Extract decoded URL from srcset — pick a mid-size image (w=640 or w=828)
          const srcsetParts = srcset.split(',').map(s => s.trim());
          for (const part of srcsetParts) {
            if (part.includes('/_next/image') || part.includes('/property/img/')) {
              const urlMatch = part.match(/url=([^&]+)/);
              if (urlMatch) {
                try { imageUrl = decodeURIComponent(urlMatch[1]); } catch(e) {}
              }
              if (part.includes('w=640') || part.includes('w=828') || part.includes('w=1080')) break;
            }
          }
          // Fallback to img src
          if (!imageUrl) {
            const src = img.getAttribute('src') || '';
            if (src.includes('/_next/image')) {
              const urlMatch = src.match(/url=([^&]+)/);
              if (urlMatch) {
                try { imageUrl = decodeURIComponent(urlMatch[1]); } catch(e) {}
              }
            } else if (src.includes('/property/img/')) {
              imageUrl = src;
            }
          }
          // Skip tracking pixels and non-property images
          if (imageUrl && (imageUrl.includes('logo') || imageUrl.includes('icon') ||
              imageUrl.includes('.svg') || imageUrl.includes('placeholder') ||
              imageUrl.includes('1x1') || imageUrl.includes('spacer'))) {
            imageUrl = '';
          }
        }

        // Bullets: auction type, bedrooms, bathrooms, property type
        const bullets = [];
        // Auction type ribbon (Traditional/Conditional)
        const ribbon = card.querySelector('[class*="AuctionTypeRibbon"] span, [class*="Ribbon"] span');
        if (ribbon) bullets.push('Auction: ' + ribbon.textContent.trim());
        // Bedrooms (icon: flaticon-bed)
        const bedIcon = card.querySelector('i[class*="flaticon-bed"]');
        if (bedIcon) {
          const bedDiv = bedIcon.parentElement;
          const beds = bedDiv ? bedDiv.textContent.trim() : '';
          if (beds) bullets.push(beds + ' bedrooms');
        }
        // Bathrooms (icon: flaticon-shower)
        const bathIcon = card.querySelector('i[class*="flaticon-shower"]');
        if (bathIcon) {
          const bathDiv = bathIcon.parentElement;
          const baths = bathDiv ? bathDiv.textContent.trim() : '';
          if (baths) bullets.push(baths + ' bathrooms');
        }
        // Property type (div with class containing PropertyType)
        const typeEl = card.querySelector('[class*="PropertyType"]');
        if (typeEl) bullets.push(typeEl.textContent.trim());

        const _ht = card.textContent || '';
        if (_ht.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({
          lot: lotIndex++,
          address: fullAddress,
          price,
          url,
          bullets,
          imageUrl: imageUrl || undefined
        });
      }
      return lots;
    })()
  `,
};

export const aliases = {
  lsk: 'hunters',
  carterjonas: 'hunters',
  allwalesauction: 'hunters',
  rendells: 'hunters',
  '247propertyauctions': 'hunters',
  // stags migrated from Homeflow to Bamboo on 2026-04-25 (catalogue moved to
  // stags.bambooauctions.com). Old Homeflow URL on www.stags.co.uk is now a
  // CMS placeholder labelled "Auction Properties Dummy".
  stags: 'hunters',
};
