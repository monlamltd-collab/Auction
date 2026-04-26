// lib/extractors/platforms/eig-whitelabel.js — EIG Property Auctions white-label
//
// Detects Hollis Morgan, Maggs & Allen, FSS Property and similar regional
// auctioneers running a white-label EIG site on their own domain. Fingerprint
// in the rendered HTML: `auctioneertemplates.eigroup.co.uk` + the
// `/search-auction/?auction=N` (or `?bid=N`) URL pattern.
//
// Both sites share the same backend conventions even though the surrounding
// templates differ:
//   - Each lot card carries `data-property="<lotId>"` (the EIG property id)
//   - Detail pages live at `/property-details/<lotId>/...`
//   - Images live at `/resize/<lotId>/0/<size>` (background-image OR <img src>)
//   - Status overlay is a `corner-flash` SVG/IMG with text SOLD / SALE AGREED /
//     POSTPONED / WITHDRAWN
//
// Crucially the listing page mixes lots from the *previous* auction (sold/STC)
// with lots for the *next* auction. The user's site only wants the upcoming
// ones, so this extractor SKIPS lots whose status overlay marks them as sold
// or withdrawn. (Past unsold lots are picked up separately by the existing
// unsold-tracking flow.)

export default {
  eigwhitelabel: `
    (() => {
      const lots = [];
      const seen = new Set();

      // Each lot card carries the EIG property id as data-property — same on
      // both Hollis (.propertybox) and Maggs (.card inside .col-md-4).
      // Fall back to .card containers if no data-property attributes exist.
      let cards = Array.from(document.querySelectorAll('[data-property]'));
      if (cards.length === 0) {
        const rawCards = Array.from(document.querySelectorAll('.card, .panel.panel-default, .property-grid'));
        // Each card must contain at least one /property-details/ link to count
        cards = rawCards.filter(c => c.querySelector('a[href*="/property-details/"]'));
      }

      for (const card of cards) {
        const text = (card.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();

        // ── Status overlay (skip past-auction lots) ──
        // Two signals: corner-flash SVG/IMG OR explicit "SOLD @" / "Sold for"
        // text in the description. POSTPONED is kept (lot may return).
        let status = '';
        const flashSvg = card.querySelector('svg.corner-flash');
        const flashImg = card.querySelector('img[src*="corner-flash-"]');
        if (flashSvg) {
          status = (flashSvg.textContent || '').replace(/\\s+/g, ' ').trim().toUpperCase();
        } else if (flashImg) {
          const src = flashImg.getAttribute('src') || '';
          const altMatch = (flashImg.getAttribute('alt') || '').toUpperCase();
          if (/corner-flash-sold/i.test(src) || altMatch === 'SOLD') status = 'SOLD';
          else if (/corner-flash-stc|corner-flash-agreed/i.test(src)) status = 'SALE AGREED';
          else if (/corner-flash-under-?offer/i.test(src)) status = 'UNDER OFFER';
          else if (/corner-flash-reserve/i.test(src)) status = 'RESERVE NOT MET';
          else if (/corner-flash-postponed/i.test(src)) status = 'POSTPONED';
          else if (/corner-flash-withdrawn/i.test(src)) status = 'WITHDRAWN';
          else status = altMatch;
        }
        if (!status) {
          // Text fallback — bullet items or price block sometimes carry the result
          if (/\\bSold\\s*(?:@|for)\\b/i.test(text) || /\\bSALE\\s*AGREED\\b/i.test(text)
              || /\\bUNDER\\s*OFFER\\b/i.test(text) || /\\bRESERVE\\s*NOT\\s*MET\\b/i.test(text)
              || /\\bWITHDRAWN\\b/i.test(text)) {
            // Heuristic — only mark as done if the price block itself talks
            // about a result rather than a guide. Avoids false positives where
            // bullets mention "previously sold for £X" as a feature.
            const priceText = (card.querySelector('.price-block, h2.black, h4 strong')?.textContent || '').toUpperCase();
            const m = priceText.match(/SOLD|SALE\\s*AGREED|UNDER\\s*OFFER|RESERVE\\s*NOT\\s*MET|WITHDRAWN/);
            if (m) status = m[0];
          }
        }
        // Treat all of these as "done" — past auction lots that shouldn't be
        // surfaced as upcoming. POSTPONED is intentionally NOT in this list
        // because the lot may return at the next auction.
        if (/^SOLD\\b|^SALE\\s*AGREED|^UNDER\\s*OFFER|^RESERVE\\s*NOT\\s*MET|^WITHDRAWN/.test(status)) continue;

        // ── Lot number ──
        // Hollis shows "Lot TBC" for upcoming, Maggs shows "LOT 1". Take the
        // first integer we see in a lot-y element. Leave null when no number
        // is found rather than guessing a sequential index — guessing risks
        // colliding with another card's real lot number.
        let lotNum = null;
        const lotEl = card.querySelector('.lot strong, h4.green-font.uppercase, .lot-tbc, .lot');
        if (lotEl) {
          const lm = (lotEl.textContent || '').match(/(\\d+)/);
          if (lm) lotNum = parseInt(lm[1], 10);
        }
        if (lotNum === null) {
          const lm = text.match(/\\bLot\\s+(\\d+)/i);
          if (lm) lotNum = parseInt(lm[1], 10);
        }

        // ── Detail URL — strip query string so dedup works ──
        let url = '';
        const link = card.querySelector('a[href*="/property-details/"]');
        if (link) {
          const raw = link.getAttribute('href') || '';
          url = raw.split('?')[0];
        }

        // ── Address ──
        let address = '';
        const addrEl = card.querySelector('.address-block h3, .card-title h2.text-center, .card-title h2:not(.black)');
        if (addrEl) address = (addrEl.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
        if (!address && link) {
          // Fallback: text of the property-details link itself
          address = (link.textContent || '').replace(/\\s+/g, ' ').trim();
        }
        // Strip trailing CTA labels like "SHOW ME MORE" / "Full Details"
        address = address.replace(/\\s*(SHOW\\s+ME\\s+MORE|Full\\s+Details?)\\s*$/i, '').trim();
        if (!address || address.length < 5) continue;

        // ── Price ──
        let price = null;
        let priceText = '';
        const priceEl = card.querySelector('.price-block h4 strong, .price-block h4, .card-body h2.black, h2.black');
        if (priceEl) priceText = (priceEl.textContent || '').replace(/\\u00a0/g, ' ').trim();
        if (!priceText) {
          const pm = text.match(/(?:Guide\\s*Price|Asking|Reserve|Starting)[^£]*£([\\d,]+)/i);
          if (pm) priceText = pm[0];
        }
        const priceMatch = priceText.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''), 10);

        // ── Image ──
        // Two patterns:
        //   Hollis: <img class="main-image" src="/resize/<id>/0/480.pagespeed...">
        //   Maggs:  <div class="auction-property-image" style="background:url(/resize/<id>/0/600)...">
        let imageUrl = '';
        const mainImg = card.querySelector('img.main-image, img[src*="/resize/"]');
        if (mainImg) imageUrl = mainImg.getAttribute('src') || mainImg.getAttribute('data-src') || '';
        if (!imageUrl) {
          const bgEl = card.querySelector('.auction-property-image[style*="background"]');
          if (bgEl) {
            const bgMatch = (bgEl.getAttribute('style') || '').match(/url\\(['\"]?([^'\")]+)['\"]?\\)/);
            if (bgMatch) imageUrl = bgMatch[1];
          }
        }

        // ── Bullets ──
        const bullets = [];
        const bulletEls = card.querySelectorAll('.bullet-thumbs ul li, .disc-outside li, ul.disc-outside li');
        for (const li of bulletEls) {
          const t = (li.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
          if (t && t.length < 200) bullets.push(t);
          if (bullets.length >= 8) break;
        }
        if (status === 'POSTPONED') bullets.unshift('POSTPONED — may return at a future auction');

        // ── Beds (Hollis room-icons widget) ──
        let beds = null;
        const bedEl = card.querySelector('.room-icons span img[alt="Bedrooms"]');
        if (bedEl) {
          const strong = bedEl.parentElement && bedEl.parentElement.querySelector('strong');
          if (strong) {
            const n = parseInt((strong.textContent || '').trim(), 10);
            if (Number.isFinite(n) && n > 0 && n < 30) beds = n;
          }
        }

        // ── Dedup by detail URL OR address fallback ──
        const dedupKey = url || (lotNum + '|' + address.toLowerCase());
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const entry = {
          lot: lotNum,
          address: address.substring(0, 200),
          price,
          url,
          bullets,
          imageUrl: imageUrl || undefined,
        };
        if (beds) entry.beds = beds;
        lots.push(entry);
      }

      return lots;
    })()
  `,
};

// Houses on the EIG white-label platform. Add new ones here as they're spotted
// (fingerprint: \`auctioneertemplates.eigroup.co.uk\` in the page HTML AND
// listing path matches /search-auction/?(auction|bid)=\\d+).
export const aliases = {
  hollismorgan: 'eigwhitelabel',
  maggsandallen: 'eigwhitelabel',
};
