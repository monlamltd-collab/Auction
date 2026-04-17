// lib/extractors.js — DOM extraction registry & JSDOM runner
import { JSDOM } from 'jsdom';
import { log } from './logging.js';

// ── Broken extractor tracking (injected from server.js) ──
let _brokenExtractors = new Set();
export function initExtractors({ brokenExtractors }) {
  _brokenExtractors = brokenExtractors;
}
export function resetBrokenExtractors() {
  if (_brokenExtractors.size > 0) {
    console.log(`AUTO: Resetting ${_brokenExtractors.size} broken extractors for retry: ${[..._brokenExtractors].join(', ')}`);
    _brokenExtractors.clear();
  }
}

// ── Extractor type tracking ──
let _lastExtractorUsedValue = 'dom-house';
export function getLastExtractorUsed() { return _lastExtractorUsedValue; }
export function setLastExtractorUsed(v) { _lastExtractorUsedValue = v; }

// ── Image URL validation (duplicated from server.js, used by extractWithJSDOM) ──
const IMG_EXTENSIONS = /\.(jpe?g|png|webp)(\?.*)?$/i;
const IMG_CDN_DOMAINS = /cloudinary\.com|imgix\.net|cdn\.sanity\.io|images\.unsplash\.com|ik\.imagekit\.io|res\.cloudinary\.com|s3\.amazonaws\.com|amazonaws\.com\/.*\.(jpe?g|png|webp)|cdn\.shopify\.com|akamaized\.net|cloudfront\.net|twimg\.com|fbcdn\.net|googleusercontent\.com|wp-content\/uploads|supabase\.co\/storage|i\.imgur\.com|eigpropertyauctions\.co\.uk|auction|property|lot|catalogue|catalog/i;

function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (IMG_EXTENSIONS.test(url)) return true;
  if (IMG_CDN_DOMAINS.test(url)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// extractWithJSDOM — runs DOM extractors in JSDOM
// ═══════════════════════════════════════════════════════════════
export function extractWithJSDOM(html, house, baseUrl, firecrawlImages) {
  const dom = new JSDOM(html, { url: baseUrl });
  const { document } = dom.window;

  let lots = null;

  // Skip DOM extraction if house is in _brokenExtractors set (triggers Gemini AI fallback)
  if (_brokenExtractors.has(house)) {
    console.log(`JSDOM extractor for ${house}: SKIPPED (broken extractor -- Gemini fallback)`);
    dom.window.close();
    return null;
  }

  // Try house-specific extractor first
  const extractor = DOM_EXTRACTORS[house];
  if (extractor) {
    try {
      const fn = new Function('document', `${IMG_HELPERS}\nreturn ${extractor.trim()}`);
      const result = fn(document);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`JSDOM extractor for ${house}: found ${result.length} lots`);
        lots = result;
        _lastExtractorUsedValue = 'dom-house';
      }
    } catch (err) {
      log.warn('JSDOM extractor error', { house, error: err.message });
    }
  }

  // Fall back to universal extractor
  if (!lots) {
    try {
      const fn = new Function('document', `${IMG_HELPERS}\nreturn ${UNIVERSAL_DOM_EXTRACTOR.trim()}`);
      const result = fn(document);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`JSDOM universal extractor for ${house}: found ${result.length} lots`);
        lots = result;
        _lastExtractorUsedValue = 'dom-generic';
      }
    } catch (err) {
      log.warn('JSDOM universal extractor error', { house, error: err.message });
    }
  }

  if (!lots) {
    console.log(`All JSDOM extractors for ${house}: found 0 lots`);
    dom.window.close();
    return null;
  }

  // Save raw URLs for image matching
  const rawUrls = lots.map(l => l.url || '');

  // Resolve relative URLs to absolute
  for (const lot of lots) {
    if (lot.url && !/^https?:\/\//i.test(lot.url)) {
      try { lot.url = new URL(lot.url, baseUrl).href; } catch {}
    }
    if (lot.detailUrl && !/^https?:\/\//i.test(lot.detailUrl)) {
      try { lot.detailUrl = new URL(lot.detailUrl, baseUrl).href; } catch {}
    }
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Image extraction pass — match by lot URL href→image mapping
  try {
    const skip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji/i;
    const hrefImageMap = {};
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      const rawHref = link.getAttribute('href') || '';
      let absHref;
      try { absHref = new URL(rawHref, baseUrl).href; } catch { absHref = rawHref; }
      if (!rawHref || rawHref === '#') continue;
      if (hrefImageMap[rawHref] || hrefImageMap[absHref]) continue;

      // Strategy 1: <img> inside the link
      let imgSrc = '';
      let img = link.querySelector('img');
      // Strategy 2: Walk up parent (up to 5 levels)
      if (!img) {
        let el = link;
        for (let depth = 0; depth < 5; depth++) {
          el = el.parentElement;
          if (!el) break;
          img = el.querySelector('img');
          if (img) break;
        }
      }
      if (img) {
        imgSrc = img.getAttribute('src') || img.getAttribute('data-src')
          || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
          || (img.getAttribute('srcset') ? img.getAttribute('srcset').split(',')[0].trim().split(/\s+/)[0] : '');
      }

      // Strategy 3: background-image
      if (!imgSrc || imgSrc.startsWith('data:')) {
        let el = link;
        for (let depth = 0; depth < 5; depth++) {
          el = el.parentElement;
          if (!el) break;
          const bgEls = el.querySelectorAll('[style*="background"]');
          for (const bgEl of bgEls) {
            const style = bgEl.getAttribute('style') || '';
            const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)/i);
            if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
              imgSrc = bgMatch[1];
              break;
            }
          }
          if (imgSrc && !imgSrc.startsWith('data:')) break;
        }
      }

      if (!imgSrc || imgSrc.startsWith('data:') || imgSrc.length < 10 || skip.test(imgSrc)) continue;
      hrefImageMap[rawHref] = imgSrc;
      hrefImageMap[absHref] = imgSrc;
    }

    if (Object.keys(hrefImageMap).length > 0) {
      for (let i = 0; i < lots.length; i++) {
        if (lots[i].imageUrl) continue;
        const imgSrc = hrefImageMap[rawUrls[i]] || hrefImageMap[lots[i].url];
        if (imgSrc) {
          let imgUrl = imgSrc;
          if (!/^https?:\/\//i.test(imgUrl)) {
            try { imgUrl = new URL(imgUrl, baseUrl).href; } catch {}
          }
          lots[i].imageUrl = imgUrl;
        }
      }
      console.log(`JSDOM image extraction for ${house}: ${lots.filter(l => l.imageUrl).length}/${lots.length} lots got images`);
    }
  } catch (err) {
    log.warn('JSDOM image extraction error', { house, error: err.message });
  }

  // Resolve any remaining relative imageUrls
  for (const lot of lots) {
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Firecrawl images format fallback — match remaining imageless lots using Firecrawl's extracted image URLs
  if (firecrawlImages && firecrawlImages.length > 0) {
    const lotsMissingImg = lots.filter(l => !l.imageUrl).length;
    if (lotsMissingImg > 0) {
      // Filter to likely property images (not icons, logos, etc)
      const skipFc = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|favicon|banner|advert|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
      const propertyImages = firecrawlImages.filter(img => img && img.length > 20 && /^https?:\/\//i.test(img) && !skipFc.test(img));
      if (propertyImages.length > 0) {
        let fcMatched = 0;
        const usedImages = new Set();
        for (const lot of lots) {
          if (lot.imageUrl) continue;

          // Strategy 1: match by lot number anywhere in image URL (lot field or lotNumber)
          const lotNum = String(lot.lot || lot.lotNumber || '').replace(/\D/g, '');
          if (lotNum && lotNum.length >= 1) {
            const match = propertyImages.find(img => !usedImages.has(img) && (
              img.includes(`/${lotNum}/`) || img.includes(`/${lotNum}.`) || img.includes(`-${lotNum}.`)
              || img.includes(`lot-${lotNum}`) || img.includes(`lot${lotNum}`)
              || img.includes(`_${lotNum}.`) || img.includes(`_${lotNum}_`)
            ));
            if (match) { lot.imageUrl = match; usedImages.add(match); fcMatched++; continue; }
          }

          // Strategy 2: match by lot URL path overlap
          if (lot.url) {
            try {
              const lotPath = new URL(lot.url).pathname.replace(/\/$/, '').split('/').pop();
              if (lotPath && lotPath.length > 3) {
                const match = propertyImages.find(img => !usedImages.has(img) && img.toLowerCase().includes(lotPath.toLowerCase()));
                if (match) { lot.imageUrl = match; usedImages.add(match); fcMatched++; continue; }
              }
            } catch {}
          }

          // Strategy 3: match by address keyword (first meaningful word of street name)
          if (lot.address) {
            const words = lot.address.replace(/^(lot\s*\d+[,:]?\s*)/i, '').split(/[\s,]+/).filter(w => w.length > 3 && !/^\d+$/.test(w));
            const keyword = words[0];
            if (keyword && keyword.length > 3) {
              const kw = keyword.toLowerCase();
              const match = propertyImages.find(img => !usedImages.has(img) && img.toLowerCase().includes(kw));
              if (match) { lot.imageUrl = match; usedImages.add(match); fcMatched++; continue; }
            }
          }
        }

        // Strategy 4: position-based — nth property image = nth imageless lot (last resort)
        const stillMissing = lots.filter(l => !l.imageUrl);
        const unusedImages = propertyImages.filter(img => !usedImages.has(img));
        if (fcMatched < stillMissing.length && unusedImages.length >= stillMissing.length * 0.3) {
          let imgIdx = 0;
          for (const lot of stillMissing) {
            if (imgIdx >= unusedImages.length) break;
            lot.imageUrl = unusedImages[imgIdx++];
            fcMatched++;
          }
        }

        if (fcMatched > 0) console.log(`JSDOM Firecrawl images fallback for ${house}: matched ${fcMatched} lots`);
      }
    }
  }

  // Post-processing: filter junk images (same blocklist as extractWithDOM)
  const imgBlocklist = /logo|icon|placeholder|no-image|default|blank|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|noimage|favicon|banner|advert|sponsor|newsletter|widget|thumb_generic|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\.|watchLIVEauction|property-top-image|auc2-logo|gavel|backdrop|generic[_-]?image|auction[_-]?house[_-]?(?:logo|image)|coming[_-]?soon|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
  const imgDomainBlock = /flannels|kirklees|rdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|analytics|hotjar|intercom|crisp\.chat|tawk\.to|zendesk|hubspot|mailchimp|sendgrid/i;
  const hollisJunk = house === 'hollismorgan' || house === 'maggsandallen';
  for (const lot of lots) {
    if (!lot.imageUrl) continue;
    if (imgBlocklist.test(lot.imageUrl) || imgDomainBlock.test(lot.imageUrl)) {
      lot.imageUrl = '';
    } else if (hollisJunk && lot.imageUrl.includes('hollismorgan.co.uk') && !lot.imageUrl.includes('/resize/')) {
      lot.imageUrl = '';
    } else if (hollisJunk && lot.imageUrl.includes('maggsandallen.co.uk') && !lot.imageUrl.includes('/resize/')) {
      lot.imageUrl = '';
    }
  }

  // Second-chance image recovery — for lots still missing images after junk stripping,
  // walk the DOM to find their card container and extract background-image or <img>.
  // This catches sites that use CSS background-image slideshows (Cycle2, Flickity, etc.)
  // regardless of whether the per-house extractor handled them.
  const imgRecoverSkip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|favicon|banner|btn|gallery-left|gallery-right|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
  const lotsMissingImgCount = lots.filter(l => !l.imageUrl).length;
  if (lotsMissingImgCount > 0) {
    let recovered = 0;
    for (const lot of lots) {
      if (lot.imageUrl) continue;
      // Find the lot's anchor in the DOM by href
      const href = lot.url || '';
      if (!href) continue;
      const anchor = document.querySelector(`a[href="${href}"], a[href="${href.replace(baseUrl, '')}"]`);
      if (!anchor) continue;
      // Walk up to find the card container (up to 6 levels)
      let card = anchor;
      for (let d = 0; d < 6; d++) {
        card = card.parentElement;
        if (!card) break;
        // Stop at likely card boundaries
        const cls = card.className || '';
        if (/card|lot|listing|property|item/i.test(cls)) break;
      }
      if (!card) continue;
      // Strategy 1: background-image on any descendant (slideshow slides, cover images)
      const bgEl = card.querySelector('[style*="background-image"], .slide[style*="background"], [style*="background"][class*="slide"], [style*="background"][class*="cover"]');
      if (bgEl) {
        const style = bgEl.getAttribute('style') || '';
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)/i);
        if (bgMatch && bgMatch[1] && !imgRecoverSkip.test(bgMatch[1]) && bgMatch[1].length > 10) {
          let imgUrl = bgMatch[1];
          if (!/^https?:\/\//i.test(imgUrl)) { try { imgUrl = new URL(imgUrl, baseUrl).href; } catch {} }
          lot.imageUrl = imgUrl;
          recovered++;
          continue;
        }
      }
      // Strategy 2: <img> tag (excluding SVG nav, icons, logos)
      const imgs = card.querySelectorAll('img[src]');
      for (const img of imgs) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && s.length > 10 && !imgRecoverSkip.test(s)) {
          let imgUrl = s;
          if (!/^https?:\/\//i.test(imgUrl)) { try { imgUrl = new URL(imgUrl, baseUrl).href; } catch {} }
          lot.imageUrl = imgUrl;
          recovered++;
          break;
        }
      }
    }
    if (recovered > 0) console.log(`JSDOM image recovery for ${house}: rescued ${recovered}/${lotsMissingImgCount} imageless lots`);
  }

  // Validate image URLs — must be https and look like an actual image
  for (const lot of lots) {
    if (lot.imageUrl && !isValidImageUrl(lot.imageUrl)) {
      lot.imageUrl = null;
    }
  }

  // Image dedup guard — if the same image appears on >50% of lots, it's likely a
  // banner/hero/catalogue image, not a per-lot photo. Strip it from all lots.
  if (lots.length >= 3) {
    const imgCounts = {};
    for (const lot of lots) {
      if (lot.imageUrl) imgCounts[lot.imageUrl] = (imgCounts[lot.imageUrl] || 0) + 1;
    }
    for (const [img, count] of Object.entries(imgCounts)) {
      if (count > lots.length * 0.5) {
        console.log(`[IMG] ${house}: stripped duplicate image appearing on ${count}/${lots.length} lots: ${img.substring(0, 80)}`);
        for (const lot of lots) {
          if (lot.imageUrl === img) lot.imageUrl = null;
        }
      }
    }
  }

  // ── Multi-image collection — gather all property images per lot for carousel ──
  // Walk each lot's card container in the DOM and collect all valid <img> sources.
  // This runs universally so every extractor gets multi-image support for free.
  // Lots that already have an `images` array (e.g. Savills) are skipped.
  const imgCarouselSkip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|favicon|banner|btn|gallery-left|gallery-right|advert|1x1|noimage|placeholder|gavel|backdrop|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
  let carouselLots = 0;
  for (const lot of lots) {
    if (lot.images && lot.images.length > 1) { carouselLots++; continue; } // already has multi-image
    const href = lot.url || '';
    if (!href) continue;
    const relHref = href.replace(baseUrl, '').replace(/^\//, '');
    const anchor = document.querySelector(`a[href="${href}"], a[href="/${relHref}"], a[href="${relHref}"]`);
    if (!anchor) continue;
    // Walk up to find the card container
    let card = anchor;
    for (let d = 0; d < 6; d++) {
      card = card.parentElement;
      if (!card) break;
      const cls = card.className || '';
      if (/card|lot|listing|property|item|panel/i.test(cls)) break;
    }
    if (!card) continue;
    // Collect all valid images from the card
    const cardImgs = card.querySelectorAll('img[src], img[data-src]');
    const validSrcs = [];
    const seenSrcs = new Set();
    for (const img of cardImgs) {
      let s = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!s || s.length < 10 || s.startsWith('data:') || imgCarouselSkip.test(s)) continue;
      if (!/^https?:\/\//i.test(s)) { try { s = new URL(s, baseUrl).href; } catch { continue; } }
      if (seenSrcs.has(s)) continue;
      seenSrcs.add(s);
      if (imgBlocklist.test(s) || imgDomainBlock.test(s)) continue;
      validSrcs.push(s);
    }
    if (validSrcs.length > 1) {
      lot.images = validSrcs.slice(0, 8); // cap at 8 to keep payload reasonable
      // Ensure imageUrl is in the images array and is first
      if (lot.imageUrl && !lot.images.includes(lot.imageUrl)) {
        lot.images.unshift(lot.imageUrl);
        if (lot.images.length > 8) lot.images.pop();
      }
      carouselLots++;
    }
  }
  if (carouselLots > 0) console.log(`JSDOM multi-image: ${carouselLots}/${lots.length} lots got image carousels for ${house}`);

  // ═══════════════════════════════════════════════════════════════
  // UNIVERSAL LOT VALIDATION HARNESS — applies to ALL houses
  // Guards against page chrome leaking in as fake lots, junk
  // bullets, and other extraction artefacts.
  // ══════════════��════════════════════════════════════════════════

  const preHarnessCount = lots.length;

  // Guard 1: Address sanity — strip lots whose address looks like nav/chrome text
  const chromeAddressPattern = /^(Home|Contact|About|Search|Properties|Menu|Login|Register|Sign.?[Ii]n|Sign.?[Uu]p|Cookie|Privacy|Terms|FAQ|Help|Back|Next|Previous|View.?All|Show.?More|Load.?More|See.?All|Read.?More|Click.?Here|Subscribe|Newsletter|Disclaimer|Sitemap|Copyright|©)$/i;
  lots = lots.filter(lot => {
    if (chromeAddressPattern.test((lot.address || '').trim())) return false;
    return true;
  });

  // Guard 2: Duplicate address detection — if >3 lots share the exact same address,
  // something is wrong (likely the same element scraped repeatedly)
  const addrCounts = {};
  for (const lot of lots) {
    const norm = (lot.address || '').toLowerCase().trim();
    if (norm) addrCounts[norm] = (addrCounts[norm] || 0) + 1;
  }
  for (const [addr, count] of Object.entries(addrCounts)) {
    if (count > 3) {
      console.log(`[HARNESS] ${house}: stripped ${count} lots with duplicate address: "${addr.substring(0, 60)}"`);
      let kept = 0;
      lots = lots.filter(lot => {
        if ((lot.address || '').toLowerCase().trim() === addr) {
          kept++;
          return kept <= 1; // keep only the first one
        }
        return true;
      });
    }
  }

  // Guard 3: Bullet sanitisation — strip bullets that look like page chrome across all houses
  const junkBulletPattern = /^(Home|Contact|About|Search|Menu|Login|Register|Cookie|Privacy|Terms|FAQ|Help|©|Tel:|Email:|Fax:|Follow.?Us|Share|Print|Save|View|Click|Subscribe|Newsletter|All.?Rights|Powered.?By|Sitemap|Disclaimer)/i;
  for (const lot of lots) {
    if (lot.bullets && Array.isArray(lot.bullets)) {
      lot.bullets = lot.bullets.filter(b => !junkBulletPattern.test((b || '').trim()));
    }
  }

  const stripped = preHarnessCount - lots.length;
  if (stripped > 0) {
    console.log(`[HARNESS] ${house}: removed ${stripped} invalid lots (${preHarnessCount} → ${lots.length})`);
  }

  // Final image coverage logging
  const lotsWithImages = lots.filter(l => l.imageUrl).length;
  console.log(`[IMG] ${house}: ${lotsWithImages}/${lots.length} lots have images after extraction + Firecrawl merge`);

  dom.window.close();
  return lots;
}

// ═══════════════════════════════════════════════════════════════
// DOM EXTRACTORS - Per-house JS that runs inside Puppeteer
// Returns structured lot data directly, no Claude needed for extraction
// ═══════════════════════════════════════════════════════════════

// ── Image extraction helpers (embedded as string in DOM extractors) ──
// Provides getBestImgSrc(img) for lazy-load fallback chain and
// upgradeThumbnailUrl(url) for full-size image resolution.
// isJunkImage(url) filters out non-property images.
const IMG_HELPERS = `
  function getBestImgSrc(img) {
    if (!img) return '';
    return img.getAttribute('data-src')
      || img.getAttribute('data-lazy-src')
      || img.getAttribute('data-original')
      || img.getAttribute('src')
      || (img.getAttribute('srcset') ? img.getAttribute('srcset').split(',')[0].trim().split(/\\s+/)[0] : '')
      || '';
  }
  function getBackgroundImageUrl(el) {
    if (!el) return '';
    const style = el.getAttribute('style') || '';
    const m = style.match(/background(?:-image)?:\\s*url\\(['"]?([^'"\\)]+)/i);
    return (m && m[1] && !m[1].startsWith('data:')) ? m[1] : '';
  }
  function upgradeThumbnailUrl(url) {
    if (!url) return url;
    return url
      .replace(/\\/thumb\\//gi, '/large/')
      .replace(/\\/small\\//gi, '/medium/')
      .replace(/_thumb\\./gi, '.')
      .replace(/_tn\\./gi, '.')
      .replace(/[?&]w=\\d{2,3}(?=&|$)/gi, function(m) { return m.replace(/\\d+/, '800'); })
      .replace(/[?&]width=\\d{2,3}(?=&|$)/gi, function(m) { return m.replace(/\\d+/, '800'); });
  }
  function isJunkImage(src) {
    if (!src || src.length < 10 || src.startsWith('data:')) return true;
    return /logo|icon|nav|sprite|placeholder|arrow|spacer|pixel|\\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji|1x1|favicon|banner|advert|gavel|backdrop|generic[_-]?image|coming[_-]?soon/i.test(src);
  }
  function extractCardImage(card) {
    // Strategy 1: img with lazy-load attributes
    const imgs = card.querySelectorAll('img');
    for (const img of imgs) {
      const s = getBestImgSrc(img);
      if (!isJunkImage(s)) return upgradeThumbnailUrl(s);
    }
    // Strategy 2: background-image on card or child elements
    const bgEls = card.querySelectorAll('[style*="background"]');
    for (const el of bgEls) {
      const s = getBackgroundImageUrl(el);
      if (!isJunkImage(s)) return upgradeThumbnailUrl(s);
    }
    // Strategy 3: background-image on the card itself
    const cardBg = getBackgroundImageUrl(card);
    if (!isJunkImage(cardBg)) return upgradeThumbnailUrl(cardBg);
    return '';
  }
`;

export const DOM_EXTRACTORS = {
  // ─── SAVILLS ───────────────────────────────────────────────
  // auctions.savills.co.uk — each lot is a <li> containing:
  // "Lot X", "Guide Price £X", address in link title, bullets, "Full details" link
  // Paginated: need to handle via Puppeteer scrolling or multi-page
  savills: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Savills: lot cards are <li class="lot"> with id="lot-{id}"
      // Each contains: lot-left (image carousel) + lot-right (details)
      // Lot number in <p class="lot-number">Lot X</p>
      // Address in <a class="lot-name" title="...">
      // Images in <ul class="lot-image-list"> > <li class="lot-image"> > <a> > <img>
      const lotCards = document.querySelectorAll('li.lot[id^="lot-"]');
      for (const li of lotCards) {
        const text = li.textContent || '';
        // Lot number from .lot-number element or text match
        let lotNum = null;
        const lotNumEl = li.querySelector('.lot-number');
        if (lotNumEl) {
          const lm = lotNumEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (lm) lotNum = parseInt(lm[1]);
        }
        if (lotNum === null) {
          const lotMatch = text.match(/Lot\\s+(\\d+)/);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        }
        if (lotNum === null || seen.has(lotNum)) continue;
        seen.add(lotNum);
        // Address from lot-name link or any link with title containing a postcode
        let address = '';
        let url = '';
        const lotName = li.querySelector('a.lot-name[title]');
        if (lotName) {
          const title = lotName.getAttribute('title') || '';
          if (title) { address = title; url = lotName.getAttribute('href') || ''; }
        }
        if (!address) {
          const links = li.querySelectorAll('a[href]');
          for (const a of links) {
            const title = a.getAttribute('title') || '';
            const href = a.getAttribute('href') || '';
            const linkText = a.textContent.trim();
            if (title && title.match(/[A-Z]{1,2}\\d/) && !address) {
              address = title;
              url = href;
            } else if (linkText && linkText.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && !address) {
              address = linkText;
              url = href;
            }
          }
        }
        if (!address) {
          const addrMatch = text.match(/\\d+[a-z]?\\s+[A-Z][a-z]+[\\s\\S]*?[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/);
          if (addrMatch) address = addrMatch[0].trim();
        }
        if (!address) continue;
        // Full details link
        if (!url) {
          const links = li.querySelectorAll('a[href]');
          for (const a of links) {
            if (a.textContent.includes('Full details')) {
              url = a.getAttribute('href') || '';
              break;
            }
          }
        }
        // Price: Guide Price or Hammer Price
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Hammer Price)\\s*£([\\d,]+)/i);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        else {
          const pm2 = text.match(/£([\\d,]+)/);
          if (pm2) price = parseInt(pm2[1].replace(/,/g, ''));
        }
        // Bullets from nested list items (skip lot-image items)
        const bullets = [];
        const subLis = li.querySelectorAll('li:not(.lot-image)');
        for (const sub of subLis) {
          const t = sub.textContent.trim();
          if (t.length > 5 && t.length < 200 && !t.match(/^Lot\\s+\\d|^£|^Guide|^Hammer|Cancel proxy/i)) {
            bullets.push(t);
          }
        }
        // Detect sold/withdrawn
        if (text.match(/\\bSold\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/sold|withdrawn/i))) bullets.push('SOLD/STC');
        }
        // Image: prefer 2nd carousel image (1st is often a floorplan on Savills)
        // Savills loads all images (12-24) per lot card with no photo/floorplan metadata,
        // so we skip the first and take the second which is almost always a property photo.
        let imageUrl = '';
        const carouselImgs = li.querySelectorAll('.lot-image-list img[src], .lot-image img[src]');
        const validImgs = [];
        for (const img of carouselImgs) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !/floor[\\s_-]?plan|floorplan|site[\\s_-]?plan|epc/i.test(s) && s.length > 10) {
            validImgs.push(s);
          }
        }
        // Use 2nd image as primary (1st is often a floorplan on Savills), store all for carousel
        imageUrl = validImgs[1] || validImgs[0] || '';
        // Fallback: any img inside the lot card
        if (!imageUrl) {
          const anyImg = li.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || anyImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !/floor[\\s_-]?plan|floorplan|site[\\s_-]?plan|epc/i.test(s) && s.length > 10) imageUrl = s;
          }
        }
        // Store all valid images for frontend carousel (max 8 to keep payload reasonable)
        const images = validImgs.length > 1 ? validImgs.slice(0, 8) : undefined;
        const entry = { lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined };
        if (images) entry.images = images;
        lots.push(entry);
      }
      return lots;
    })()
  `,

  // ─── HOLLIS MORGAN ─────────────────────────────────────────
  // hollismorgan.co.uk — anchored on "SHOW ME MORE" detail links
  // Each lot: h3=address, h4=price, h4="Lot TBC", li=bullets
  hollismorgan: `
    (() => {
      const lots = [];
      const detailLinks = document.querySelectorAll('a[href*="property-details"]');
      let lotIndex = 1;
      for (const link of detailLinks) {
        const url = link.getAttribute('href') || '';
        if (!url || link.textContent.trim() === '') continue;
        let card = link.parentElement;
        for (let i = 0; i < 5 && card; i++) {
          if (card.querySelector('h3') && card.querySelector('h4')) break;
          card = card.parentElement;
        }
        if (!card) continue;
        const h3 = card.querySelector('h3');
        const address = h3 ? h3.textContent.trim() : '';
        if (!address) continue;
        let price = null;
        const h4s = card.querySelectorAll('h4');
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const pm = t.match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        let lotNum = lotIndex;
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const lm = t.match(/Lot\\s+(\\d+)/i);
          if (lm) { lotNum = parseInt(lm[1]); break; }
        }
        const bullets = [];
        const lis = card.querySelectorAll('li');
        for (const li of lis) {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        }
        const cardText = card.textContent;
        if (cardText.match(/\\bSOLD\\b|\\bSALEAGREED\\b|\\bSALE AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        // Image: property photos use img.property-grid-image with /resize/ URLs
        let imageUrl = '';
        const cardImg = card.querySelector('img.property-grid-image');
        if (cardImg) {
          imageUrl = cardImg.getAttribute('src') || cardImg.dataset.src || '';
        }
        // Fallback: any img whose src contains /resize/ (property photo pattern)
        if (!imageUrl) {
          const imgs = card.querySelectorAll('img[src]');
          for (const img of imgs) {
            const s = img.getAttribute('src') || '';
            if (s.includes('/resize/') && !s.includes('.svg')) { imageUrl = s; break; }
          }
        }
        // Filter out non-property images (icons, logos, banners)
        if (imageUrl && (imageUrl.includes('.svg') || imageUrl.includes('/images/') || imageUrl.includes('logo') || imageUrl.includes('icon') || imageUrl.includes('banner'))) {
          imageUrl = '';
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ─── MAGGS & ALLEN ─────────────────────────────────────────
  // maggsandallen.co.uk — same CMS as Hollis Morgan (Auction2 platform)
  maggsandallen: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Maggs & Allen 2026: Bootstrap .card layout with .auction-property-image, h2 > a for address
      let cards = document.querySelectorAll('.card');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="property-card"], article, .lot-card');
      for (const card of cards) {
        const text = card.textContent || '';
        // Skip nav/footer cards that aren't property listings
        if (text.length < 20 || text.length > 5000) continue;
        if (!text.match(/£[\\d,]|Lot\\s+\\d|Guide/i)) continue;
        // Address from h2 > a or h2/h3
        let address = '', url = '';
        const h2a = card.querySelector('h2 a, .card-body h2 a, h3 a');
        if (h2a) {
          address = h2a.textContent.trim();
          url = h2a.getAttribute('href') || '';
        }
        if (!address) {
          const h2 = card.querySelector('h2, h3');
          if (h2) address = h2.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        // URL fallback
        if (!url) {
          const link = card.querySelector('a[href*="property"], a[href*="details"], .card-footer a, a[href]');
          if (link) url = link.getAttribute('href') || '';
        }
        // Price from .card-text or text
        let price = null;
        const priceEl = card.querySelector('.card-text, [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/LOT\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        // Image: Auction2 CMS uses img.property-grid-image with /resize/ URLs (same as Hollis Morgan)
        let imageUrl = '';
        const cardImg = card.querySelector('img.property-grid-image');
        if (cardImg) {
          imageUrl = cardImg.getAttribute('src') || cardImg.dataset.src || '';
        }
        // Fallback: any img whose src contains /resize/ (Auction2 property photo pattern)
        if (!imageUrl) {
          const imgs = card.querySelectorAll('img[src]');
          for (const img of imgs) {
            const s = img.getAttribute('src') || '';
            if (s.includes('/resize/') && !s.includes('.svg')) { imageUrl = s; break; }
          }
        }
        // Filter out non-property images
        if (imageUrl && (imageUrl.includes('.svg') || imageUrl.includes('/images/') || imageUrl.includes('logo') || imageUrl.includes('icon') || imageUrl.includes('banner'))) {
          imageUrl = '';
        }
        // Bullets
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── BTG EDDISONS (formerly SDL Auctions) ──────────────────
  // btgeddisonspropertyauctions.com — Tailwind + Swiper. Cards are div.property-card
  // Each has: lot number as plain text, address in link text, guide price in
  // .text-btg-blue, images from asta.btgeddisonspropertyauctions.com, and
  // property links to /properties/{id}/for-auction-{slug}
  sdl: `
    (() => {
      const lots = [];
      const seen = new Set();
      // BTG Eddisons: find all property links, then walk up to their card container
      const propLinks = document.querySelectorAll('a[href*="/properties/"]');
      const processed = new Set();
      for (const propLink of propLinks) {
        const url = propLink.getAttribute('href') || '';
        if (!url || seen.has(url)) continue;
        // Walk up to find the card container (up to 8 levels)
        let card = propLink;
        for (let i = 0; i < 8; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          // Stop at a container that has both price text and a property link
          if (card.textContent.match(/Guide\\s*Price|£[\\d,]/i) && card.querySelector('img')) break;
        }
        // Skip if we already processed this card
        const cardId = card.getAttribute('data-idx') || card.innerHTML.substring(0, 100);
        if (processed.has(cardId)) continue;
        processed.add(cardId);
        seen.add(url);
        const text = card.textContent || '';
        // Lot number — plain 3-digit text like "001", "002"
        let lotNum = 0;
        const lotMatch = text.match(/(?:^|\\s)(\\d{2,4})(?:\\s|$)/);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from link text with postcode pattern
        let address = '';
        const allLinks = card.querySelectorAll('a[href*="/properties/"]');
        for (const link of allLinks) {
          const t = link.textContent.trim();
          if (t.length > 10 && t.match(/[A-Z]{1,2}\\d/i)) { address = t; break; }
        }
        // Fallback: h3 text
        if (!address) {
          const h3 = card.querySelector('h3');
          if (h3) address = h3.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        // Deduplicate address if it repeats (overlay + content)
        address = address.replace(/(.{20,})\\1/g, '$1').trim();
        // Price from "Guide Price: £X+" pattern
        let price = null;
        const priceMatch = text.match(/Guide\\s*Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Bullets — auction type, end date
        const bullets = [];
        const typeMatch = text.match(/(Multi-Lot Timed|Single-Lot Timed|Live Stream)\\s*Auction/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        const endMatch = text.match(/Auction\\s*Ends?:\\s*(\\d{2}\\/\\d{2}\\/\\d{4})/i);
        if (endMatch) bullets.push('Auction Ends: ' + endMatch[1]);
        if (text.match(/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i)) {
          bullets.push('SOLD/STC');
        }
        // Image — first real property image
        let imageUrl = '';
        const imgs = card.querySelectorAll('img[src]');
        const imgJunk = /logo|icon|\\.svg|placeholder|modal\\.png|_NYC\\.|_LCC\\.|_BMDC\\.|council|utilit|cardwell|download_\\(|captcha|floor[\\s_-]?plan|floorplan|site[\\s_-]?plan|epc[\\s_-]?chart|map[\\s_-]?view/i;
        for (const img of imgs) {
          const s = img.getAttribute('src') || '';
          if (s && s.length > 10 && !imgJunk.test(s)) {
            imageUrl = s;
            break;
          }
        }
        lots.push({ lot: lotNum || lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── BOND WOLFE ────────────────────────────────────────────
  // bondwolfe.com — WordPress + EIG. Similar card structure to SDL
  bondwolfe: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Bond Wolfe lot cards
      const cards = document.querySelectorAll('.property-card, .lot-card, [class*="property"], article, .search-result');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        const link = card.querySelector('a[href*="/property/"], a[href*="/lot/"], a[href*="/properties/"]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .property-title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li, .feature, .tag').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        // Image from card
        let imageUrl = '';
        const cardImg = card.querySelector('img[src]');
        if (cardImg) {
          const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── NETWORK AUCTIONS (WordPress + EIG images, tenant 24) ──
  network: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.current-lots-single');
      for (const card of cards) {
        const lotEl = card.querySelector('.lot-number, span.lot-number');
        let lotNum = lots.length + 1;
        if (lotEl) {
          const m = lotEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        const addrP = card.querySelector('.lot-info p');
        let address = '';
        if (addrP) {
          addrP.querySelectorAll('br').forEach(br => br.replaceWith(', '));
          address = addrP.textContent.trim().replace(/\\s+/g, ' ').replace(/, ,/g, ',');
        }
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let price = null;
        const priceEl = card.querySelector('p.guide-price, .guide-price');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/property/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        const text = card.textContent || '';
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── BARNARD MARCUS ────────────────────────────────────────
  // barnardmarcusauctions.co.uk — Countrywide CMS, server-rendered
  barnardmarcus: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Barnard Marcus 2026: .lot-item cards with BEM-style classes
      let cards = document.querySelectorAll('.lot-item');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="lot-item"], [class*="lot-card"], article');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number from .lot-info__name or text
        const lotEl = card.querySelector('.lot-info__name, [class*="lot-info"] [class*="name"], [class*="lot-number"]');
        const lotMatch = (lotEl ? lotEl.textContent : text).match(/(?:Lot\\s+)?(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        // Address from .lot-item__address
        const addrEl = card.querySelector('.lot-item__address, [class*="lot-item__address"], [class*="address"], h3, h4');
        const address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) continue;
        // Price from .lot-item__price
        let price = null;
        const priceEl = card.querySelector('.lot-item__price, [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        const link = card.querySelector('.lot-item__link, a[href*="lot"], a[href*="property"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.lot-item__img img, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        // Bullets
        const bullets = [];
        const desc = card.querySelector('.lot-item__description, [class*="description"]');
        if (desc) { const t = desc.textContent.trim(); if (t.length > 5) bullets.push(t.substring(0, 200)); }
        const loc = card.querySelector('.lot-item__location, [class*="location"]');
        if (loc && loc.textContent.trim()) bullets.push(loc.textContent.trim());
        const statusEl = card.querySelector('.lot-info__status, [class*="status"]');
        if (statusEl && statusEl.textContent.match(/sold|unsold|withdrawn/i)) continue;
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b/i)) continue;
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── AUCTION HOUSE LONDON ─────────────────────────────────
  // Lot numbers are empty on this site — deduplicate by href, assign positional numbers
  auctionhouselondon: `
    (() => {
      const lots = [];
      const links = document.querySelectorAll('a[href*="/lot/"]');
      const seen = new Set();
      let idx = 1;
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const text = link.textContent || '';
        // Price from "Guide Price: £210,000+"
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // Address: find the semibold heading div, or parse from text
        const addrEl = link.querySelector('[class*="font-semibold"]');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) {
          // Fallback: strip LOT/price/badges from text, take first substantial line
          address = text.replace(/LOT\\s*\\d*/gi, '').replace(/Guide Price[^£]*£[\\d,]+\\+?/gi, '').replace(/£[\\d,]+\\+?/g, '');
          address = address.split('\\n').map(s=>s.trim()).filter(s=>s.length>5 && !s.match(/^(Flat|Leasehold|Freehold|Sold|SOLD|STC|View)$/i))[0] || '';
        }
        if (!address || address.length < 5) continue;
        // Image
        let imageUrl = '';
        const img = link.querySelector('img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s.length > 10 && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg')) imageUrl = s;
        }
        if (!imageUrl) {
          const parent = link.closest('[class*="mb-30"], [class*="w-full"]') || link.parentElement;
          if (parent) { const pi = parent.querySelector('img[src*="eigpropertyauctions"], img[src*="property"]'); if (pi) imageUrl = pi.getAttribute('src') || ''; }
        }
        // Description bullets
        const bullets = [];
        const descEl = link.querySelector('[class*="leading-normal"], [class*="text-15"]');
        if (descEl) { const d = descEl.textContent.trim(); if (d.length > 10) bullets.push(d); }
        // Sold/STC detection
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          bullets.push('SOLD/STC');
        }
        // Property type & tenure from badge spans
        const badges = link.querySelectorAll('span');
        let propType, tenure;
        for (const b of badges) {
          const bt = b.textContent.trim();
          if (/^(Flat|House|Bungalow|Land|Commercial|Maisonette)$/i.test(bt)) propType = bt;
          if (/^(Freehold|Leasehold|Share of Freehold)$/i.test(bt)) tenure = bt;
        }
        lots.push({ lot: idx++, address, price, url: href, bullets, imageUrl: imageUrl || undefined, propType, tenure });
      }
      return lots;
    })()
  `,

  // ─── McHUGH & CO ──────────────────────────────────────────
  // ── MCHUGH & CO (EIG OAS platform) ──
  // mchughandco.com/current-auction → /future-auctions/{id}. EIG OAS lot panels.
  // Uses .lot-panel, h4.grid-address, .grid-guideprice b, img.grid-img.
  mchughandco: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        // Address from h4.grid-address
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Lot number from panel title or text
        const titleEl = card.querySelector('.panel-title, .lot-number');
        let lotNum = lotIndex;
        if (titleEl) {
          const lotMatch = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        } else {
          const text = card.textContent || '';
          const lotMatch = text.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        }
        // Price from .grid-guideprice b or strong
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice b, .grid-guideprice strong');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('a[href*="/lot/"], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        // Tagline as bullet
        const bullets = [];
        const tagline = card.querySelector('.grid-tagline');
        if (tagline) {
          const t = tagline.textContent.trim().replace(/^Lot\\s+\\d+\\s*[-–]\\s*/i, '');
          if (t.length > 3) bullets.push(t);
        }
        const _ct = card.textContent || '';
        if (_ct.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ─── CLIVE EMSON ───────────────────────────────────────────
  // cliveemson.co.uk — server-rendered catalogue with background-image and data-image
  cliveemson: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Clive Emson: lots are in .lot elements with .lotPic (background-image), .LotHeading, .LotLocation
      const cards = document.querySelectorAll('.lot, [class*="lot"], [class*="property"], .search-result, article');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('.LotHeading, .LotLocation, h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li, p').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 10 && t.length < 200 && !t.match(/^Lot|^Guide|^£/i)) bullets.push(t);
        });
        // Skip sold/completed lots
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b/i)) continue;
        // Image: Clive Emson grid-view cards have data-mainpic (filename) and data-auc (auction number)
        // Full URL pattern: https://www.cliveemson.co.uk/auc{data-auc}/pics/{data-mainpic}
        let imageUrl = '';
        const mainPic = card.getAttribute('data-mainpic') || '';
        const aucNum = card.getAttribute('data-auc') || '';
        if (mainPic && aucNum) {
          imageUrl = 'https://www.cliveemson.co.uk/auc' + aucNum + '/pics/' + mainPic;
        }
        // Fallback: background-image on .lotPic (list-view) or .lotImgWrap elements
        if (!imageUrl) {
          const lotPic = card.querySelector('.lotPic, .lotImgWrap, .lotImages [style*="background-image"]');
          if (lotPic) {
            const style = lotPic.getAttribute('style') || '';
            const bgMatch = style.match(/background-image:\\s*url\\(['"]?([^'"\\)]+)/i);
            if (bgMatch) imageUrl = bgMatch[1];
            if (!imageUrl) {
              const bg = getComputedStyle(lotPic).backgroundImage || '';
              const bgm = bg.match(/url\\(['"]?([^'"\\)]+)/);
              if (bgm) imageUrl = bgm[1];
            }
          }
        }
        // Fallback: data-image on child elements (carousel items)
        if (!imageUrl) {
          const dataImg = card.querySelector('[data-image]');
          if (dataImg) {
            const di = dataImg.getAttribute('data-image') || '';
            if (di && aucNum) imageUrl = 'https://www.cliveemson.co.uk/auc' + aucNum + '/pics/' + di;
            else if (di) imageUrl = di;
          }
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── STRETTONS ─────────────────────────────────────────────
  strettons: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Strettons 2026: Bootstrap/JS-rendered. Try multiple card strategies.
      let cards = document.querySelectorAll('.lot-item, .property-card, .catalogue-item');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="lot-item"], [class*="lot-card"], [class*="property-item"]');
      if (cards.length === 0) cards = document.querySelectorAll('article, .card');
      if (cards.length === 0) {
        // Fallback: find all links to lot/property pages and walk up
        const links = document.querySelectorAll('a[href*="/lot"], a[href*="/property"], a[href*="/auction"]');
        const parentSet = new Set();
        for (const link of links) {
          let p = link;
          for (let i = 0; i < 6 && p.parentElement; i++) {
            p = p.parentElement;
            const t = p.textContent || '';
            if (t.match(/Lot\\s+\\d/i) && t.match(/£[\\d,]/)) break;
          }
          if (!parentSet.has(p) && p.textContent.length > 20 && p.textContent.length < 3000) parentSet.add(p);
        }
        cards = parentSet;
      }
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        // Address
        let address = '';
        const addrEl = card.querySelector('[class*="address"], h2, h3, h4, .title');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address) continue;
        // Price
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // URL
        const link = card.querySelector('a[href*="/lot"], a[href*="/property"], a[href*="/auction"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        // Image
        let imageUrl = extractCardImage(card);
        const bullets = [];
        card.querySelectorAll('li, .description, .feature, [class*="description"]').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── ACUITUS ───────────────────────────────────────────────
  acuitus: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Acuitus 2026: .property-card containers with .lot-number, .address, .guide-price
      let cards = document.querySelectorAll('.property-card');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="property-card"], [class*="property-item"], [class*="lot-card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotEl = card.querySelector('.lot-number, [class*="lot-number"]');
        const lotMatch = (lotEl ? lotEl.textContent : text).match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const addrEl = card.querySelector('.address, [class*="address"], h2, h3');
        const address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) continue;
        let price = null;
        const priceEl = card.querySelector('.guide-price, [class*="guide-price"], [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        const link = card.querySelector('a[href*="/property/"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        let imageUrl = extractCardImage(card);
        const bullets = [];
        const yieldEl = card.querySelector('.yield, [class*="yield"]');
        if (yieldEl && yieldEl.textContent.trim()) bullets.push('Yield: ' + yieldEl.textContent.trim());
        const typeEl = card.querySelector('.property-type, [class*="property-type"]');
        if (typeEl && typeEl.textContent.trim()) bullets.push(typeEl.textContent.trim());
        const statusEl = card.querySelector('.status, [class*="status"]');
        if (statusEl && statusEl.textContent.match(/sold|withdrawn/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── AUCTION HOUSE UK ─────────────────────────────────────
  auctionhouse: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], article, .search-result');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        // Image from card — uses lazy-load helpers for data-src/data-lazy-src/background-image fallback
        let imageUrl = extractCardImage(card);
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── KNIGHT FRANK (EIG platform) ──
  knightfrank: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], .lot-card, .property-card, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const href = el.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:guide|price|reserve)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/£[\\d,]+/g, '').replace(/guide\\s*price/i, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          // Image from card — uses lazy-load helpers
          let imageUrl = extractCardImage(el);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── PATTINSON (React SPA with bid cards) ──
  pattinson: `
    (() => {
      const lots = [];
      document.querySelectorAll('[class*="card"], [class*="property"], [class*="auction-item"], .lot-item').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a[href*="auction"]') || card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:starting|current|guide)\\s*(?:bid|price)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.split('\\n').find(l => l.trim().length > 10 && !l.match(/^(?:lot|starting|current|guide|£|bid)/i));
        if (address) {
          let imageUrl = extractCardImage(card);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: num, address: address.trim().substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── BIDX1 (React SPA) ──
  bidx1: `
    (() => {
      const lots = [];
      document.querySelectorAll('[class*="property"], [class*="card"], [class*="listing"], [class*="lot"]').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/€([\\d,]+)/) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        const address = lines.find(l => !l.match(/^(?:€|£|\\d+\\s*bed|guide|reserve|sold)/i));
        if (address) {
          let imageUrl = extractCardImage(card);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: lots.length + 1, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── PHILLIP ARNOLD (PHP gallery) ──
  philliparnold: `
    (() => {
      const lots = [];
      document.querySelectorAll('.gallery-item, .lot-item, .property-item, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const link = el.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*price\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/guide\\s*price\\s*£[\\d,]+/i, '').replace(/£[\\d,]+/g, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          let imageUrl = extractCardImage(el);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── EDWARD MELLOR (WordPress, verified HTML) ──
  edwardmellor: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="/property-for-sale/"]').forEach(link => {
        const text = link.textContent || '';
        const href = link.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+|TBC)/i);
        const num = lotMatch && lotMatch[1] !== 'TBC' ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*price\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const addressLine = text.split('\\n').find(l => l.trim().length > 10 && l.match(/[A-Z]{1,2}\\d/));
        const address = addressLine ? addressLine.trim() : text.split('\\n')[0].trim();
        if (address && address.length > 5) {
          const bullets = [];
          const beds = text.match(/(\\d+)\\s*bed/i);
          if (beds) bullets.push(beds[1] + ' bed');
          // Image: Edward Mellor uses widget cards on auction page
          let imageUrl = '';
          const linkParent = link.parentElement;
          if (linkParent) {
            const parentImg = linkParent.querySelector('img[src]') || (linkParent.parentElement ? linkParent.parentElement.querySelector('img[src]') : null);
            if (parentImg) {
              const s = parentImg.getAttribute('src') || parentImg.dataset.src || '';
              if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
            }
          }
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
            if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
          }
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── BARNETT ROSS (PHP, table.auction-archive-table) ──
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

  // ── COTTONS (EIG embed via current-auction.htm) ──
  // EIG embed renders .lot-container divs with .lotnum, .address, .price, img.lot-image
  // Prices may show "Guide Price*: £X" (upcoming) or "Result: Sold for £X" (past).
  cottons: `
    (() => {
      const lots = [];
      const seen = new Set();
      const containers = document.querySelectorAll('.lot-container');
      for (const card of containers) {
        // Lot number from .lotnum (e.g. "LOT 1")
        const lotnumEl = card.querySelector('.lotnum');
        let lotNum = lots.length + 1;
        if (lotnumEl) {
          const m = lotnumEl.textContent.match(/LOT\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from .address or .address-mob
        const addrEl = card.querySelector('.address, .address-mob');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price — guide price or sold price
        let price = null;
        const priceEl = card.querySelector('.price');
        if (priceEl) {
          const priceText = priceEl.textContent;
          const pm = priceText.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('a[href*="lid="]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.lot-image, img[src*="eigpropertyauctions"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Description: text after the address in .lot-info (everything before = lot num + result)
        const bullets = [];
        const infoEl = card.querySelector('.lot-info');
        if (infoEl) {
          const fullText = infoEl.textContent || '';
          const addrIdx = fullText.indexOf(address);
          if (addrIdx >= 0) {
            let desc = fullText.substring(addrIdx + address.length).trim();
            // Strip leading price remnants like "£70,000."
            desc = desc.replace(/^£[\\d,]+\\+?\\.?\\s*/i, '');
            if (desc.length > 5 && desc.length < 200) bullets.push(desc);
          }
        }
        const _ct = card.textContent || '';
        if (_ct.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── DEDMAN GRAY (EIG embed, tenant 33, table-based layout) ──
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

  probateauction: `
    (() => {
      const lots = [];
      document.querySelectorAll('.property-list-card').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a[href*="/lot/"], a[href*="property"]');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
        // Address is typically the first substantial line that isn't lot number or price
        const address = lines.find(l => l.length > 10 && !l.match(/^(?:lot|guide|£|sold|property details|view|swipe)/i));
        // Description is the longest paragraph-like text
        const desc = lines.filter(l => l.length > 30 && !l.match(/^(?:lot|£)/i)).join(' ').substring(0, 300);
        // Image — check background-image slides first (Cycle2 gallery uses <a class="slide" style="background-image:url(...)">)
        let imageUrl = '';
        const slideDiv = card.querySelector('.slide[style*="background"], .swiper-slide [style*="background"], [style*="background-image"]');
        if (slideDiv) {
          const bg = slideDiv.getAttribute('style') || '';
          const bgMatch = bg.match(/background(?:-image)?:\\s*url\\(['"]?([^'"\\)]+)/i);
          if (bgMatch) imageUrl = bgMatch[1];
        }
        if (!imageUrl) {
          // Fallback to img tags — exclude SVG nav arrows and icons
          const swiperImg = card.querySelector('.swiper-slide img, img[src*="uploads"]');
          if (swiperImg) {
            const s = swiperImg.getAttribute('src') || swiperImg.dataset.src || '';
            if (s && !s.includes('.svg') && !s.includes('arrow') && !s.includes('logo') && !s.includes('icon')) imageUrl = s;
          }
        }
        if (!imageUrl) {
          const anyImg = card.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !s.includes('arrow') && s.length > 10) imageUrl = s;
          }
        }
        if (address) {
          const bullets = desc ? [desc] : [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
            if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
          }
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── BRADLEY HALL (EIG platform with lot-panel cards) ──
  bradleyhall: `
    (() => {
      const lots = [];
      const seen = new Set();
      document.querySelectorAll('.lot-panel').forEach(panel => {
        const text = panel.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) return;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) return;
        seen.add(num);
        const link = panel.querySelector('a[href*="/lot/"]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/Guide Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const addrEl = panel.querySelector('.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) return;
        const taglineEl = panel.querySelector('.grid-tagline');
        const bullets = [];
        if (taglineEl) bullets.push(taglineEl.textContent.trim());
        // Image from grid-img
        let imageUrl = '';
        const img = panel.querySelector('img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && s.length > 10) imageUrl = s;
        }
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      });
      return lots;
    })()
  `,

  // ── LANDWOOD (EIG OAS platform, tenant 188, LIST view) ──
  landwood: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const addrEl = card.querySelector('h3.list-address, h3.grid-address, h4.grid-address');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let lotNum = lotIndex;
        const titleEl = card.querySelector('.panel-title');
        if (titleEl) {
          const m = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        let price = null;
        const priceEl = card.querySelector('.list-guideprice strong, .grid-guideprice b, .grid-guideprice strong');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"], a[href*="/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const imgs = card.querySelectorAll('img');
        for (const img of imgs) {
          const s = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
          if (s && s.length > 10 && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !s.includes('gavel') && !s.includes('backdrop') && !s.includes('placeholder')) {
            imageUrl = s;
            break;
          }
        }
        // Dedup: reject image if already used by a previous lot (prevents image bleed)
        const usedImages = lots.map(l => l.imageUrl).filter(Boolean);
        if (imageUrl && usedImages.includes(imageUrl)) imageUrl = '';
        const bullets = [];
        const headingEl = card.querySelector('h4.lot-data-heading strong, h4.lot-data-heading');
        if (headingEl) {
          const t = headingEl.textContent.trim();
          if (t.length > 3 && t.length < 300) bullets.push(t);
        }
        const _ct2 = card.textContent || '';
        if (_ct2.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ── CONNECT UK AUCTIONS ──
  connectuk: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], .search-result, article, [class*="card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        let imageUrl = extractCardImage(card);
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── AUCTION ESTATES ──
  // Site has no lot numbers — assign by position. Catalogue at /view-properties.
  auctionestates: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.result-container');
      let idx = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('.property-title, h1, h2, h3');
        if (heading) address = heading.textContent.trim();
        if (!address || address.length < 5) continue;
        const priceEl = card.querySelector('.property-guide-price');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const link = card.querySelector('a[href*="/property/"]');
        const url = link ? link.getAttribute('href') : '';
        let imageUrl = '';
        const img = card.querySelector('img.result-property-image, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        const flash = card.querySelector('.property-flash');
        if (flash && /\\bSOLD\\b|\\bWithdrawn\\b/i.test(flash.textContent)) {
          bullets.push(flash.textContent.trim());
        }
        lots.push({ lot: idx++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── LOVEITTS ──
  loveitts: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], .search-result, article, [class*="card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        let imageUrl = extractCardImage(card);
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── HUNTERS (BAMBOO AUCTIONS) ───────────────────────────────
  // hunters.bambooauctions.com — React/Next.js SPA with styled-components.
  // Cards are a[href^="/property/"] wrapping div with Title h3, Address p, Price p.
  // Images on cdn.bambooauctions.com. No lot numbers — uses sequential index.
  hunters: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Each card is wrapped in an anchor with href="/property/slug-id"
      const links = document.querySelectorAll('a[href^="/property/"]');
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

  // ─── COUNTRYWIDE / SUTTON KERSH ────────────────────────────
  // countrywidepropertyauctions.co.uk / suttonkersh.co.uk
  // Bootstrap grid. Cards are div.property-gallery with h2.property-gallery__title (price)
  // and h3.property-gallery__address (address). Static HTML, no JS needed.
  countrywide: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.property-gallery');
      let lotIndex = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        // Address
        const addrEl = card.querySelector('.property-gallery__address, h3');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price from h2.property-gallery__title — "Guide Price: £90,000+" or "Sold Prior"
        let price = null;
        const titleEl = card.querySelector('.property-gallery__title, h2');
        const titleText = titleEl ? titleEl.textContent.trim() : '';
        const priceMatch = titleText.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL from detail link
        let url = '';
        const detailLink = card.querySelector('a[href*="property_details"]');
        if (detailLink) url = detailLink.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.property-gallery__image img:not(.sold)');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — sold status, virtual tour
        const bullets = [];
        if (titleText.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bPostponed\\b/i)) bullets.push('SOLD/STC');
        if (card.querySelector('.vu360')) bullets.push('Virtual Tour Available');
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── VENMORE AUCTIONS ───────────────────────────────────────
  // venmoreauctions.co.uk — Liverpool. Cards are div.property-strip-block.
  // Server-rendered, lot numbers in text, prices as "Guide Price £X PLUS*"
  venmore: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.property-strip-block');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number from "Lot N" text
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from span.f-body-copy.db.marbot10
        let address = '';
        const addrEl = card.querySelector('.f-body-copy.db.marbot10, span[class*="marbot"]');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        // Price from span.p-text-green — "Guide Price £90,000 PLUS*"
        let price = null;
        const priceEl = card.querySelector('.p-text-green, span[class*="greatprimer"]');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from detail link
        let url = '';
        const link = card.querySelector('a[href*="Property-Details"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.img_resp, img[src*="resizeCrop"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — status, auction date
        const bullets = [];
        const statusEl = card.querySelector('.p-flash-green');
        if (statusEl) {
          const _st = statusEl.textContent.trim();
          if (_st.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          else if (_st.length > 1) bullets.push(_st);
        }
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        const dateMatch = text.match(/(\\d{2}\\/\\d{2}\\/\\d{4})/);
        if (dateMatch) bullets.push('Auction: ' + dateMatch[1]);
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── TOWN & COUNTRY PROPERTY AUCTIONS (TCPA) ───────────────
  // townandcountrypropertyauctions.co.uk — National franchise on EIG platform.
  // Cards are div.lot-panel with span.lot-address, span.price, time.text-success
  tcpa: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        // Address from span.lot-address
        const addrEl = card.querySelector('.lot-address, span[class*="lot-address"]');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price from span.price inside div.grid-guideprice
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice .price, span.price');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from image container link
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        if (seen.has(url) && url) continue;
        // Image — first real img in swiper
        let imageUrl = '';
        const img = card.querySelector('img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — auction end date, office name, features, ribbon
        const bullets = [];
        const timeEl = card.querySelector('time.text-success');
        if (timeEl) bullets.push('Auction Ends: ' + timeEl.textContent.trim());
        const officeEl = card.querySelector('.lot-auctioneer-name');
        if (officeEl) bullets.push(officeEl.textContent.trim());
        // Features list
        card.querySelectorAll('.grid-tagline.custom-fields li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 1) bullets.push(t);
        });
        // Ribbon badge
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon) {
          const ribbonText = ribbon.getAttribute('data-ribbon') || '';
          if (/sold|completed|exchanged/i.test(ribbonText)) continue;
          bullets.push(ribbonText);
        }
        // Skip sold/completed lots — EIG /search includes historical
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b/i)) continue;
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── FUTURE PROPERTY AUCTIONS ──────────────────────────────
  // futurepropertyauctions.co.uk — ASP classic, classless HTML.
  // Cards are a[href*="property_details.asp"]. Price as "£X OPENING BID".
  futureauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Future Property Auctions 2026: ASP pages, property_details.asp links
      // Try both link-as-card and walking up from links to parent containers
      let cards = document.querySelectorAll('a[href*="property_details.asp"]');
      // If links are small (just "View Details"), walk up to parent containers
      const useParent = cards.length > 0 && cards[0].textContent.trim().length < 50;
      const processed = new Set();
      for (const el of cards) {
        const href = el.getAttribute('href') || '';
        if (processed.has(href)) continue;
        processed.add(href);
        // Walk up to the lot container
        let card = el;
        if (useParent) {
          for (let i = 0; i < 6 && card.parentElement; i++) {
            card = card.parentElement;
            const t = card.textContent || '';
            if (t.match(/£[\\d,]/) && t.match(/Lot\\s+\\d|bedroom|property/i)) break;
          }
        }
        const text = card.textContent || '';
        if (text.length < 20 || text.length > 3000) continue;
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        // Price
        let price = null;
        const priceMatch = text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Address — look for Google Maps link text or postcode-containing line
        let address = '';
        const mapsLink = card.querySelector('a[href*="maps.google"], a[href*="google.com/maps"]');
        if (mapsLink) address = mapsLink.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 3);
          for (const line of lines) {
            if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && line.length < 200) {
              address = line.replace(/Lot\\s+\\d+/i, '').replace(/£[\\d,]+[^\\n]*/g, '').trim();
              break;
            }
          }
          if (!address) {
            const h4 = card.querySelector('h4 a, h4, h3');
            if (h4) address = h4.textContent.trim();
          }
        }
        if (!address || address.length < 5) continue;
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="/upload/"], img[src*="futurepropertyauctions"], img[src]');
        if (img) {
          let src = img.getAttribute('src') || '';
          if (src.startsWith('http://')) src = src.replace('http://', 'https://');
          if (src && !src.includes('logo') && !src.includes('icon') && src.length > 10) imageUrl = src;
        }
        const bullets = [];
        const typeMatch = text.match(/(Timed Online Auction|Live Auction)[^\\n]*/i);
        if (typeMatch) bullets.push(typeMatch[0].trim());
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── KIVELLS ────────────────────────────────────────────────
  // kivells.com — Devon/Cornwall. Tailwind + Alpine.js.
  // Cards are div.bg-listing-item-background with h2 address, h3 price.
  kivells: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('[class*="bg-listing-item-background"]');
      for (const card of cards) {
        const text = card.textContent || '';
        // Address from h2.font-serif
        const addrEl = card.querySelector('h2.font-serif, h2');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        // Price from h3.font-serif — "£250,000 Guide Price"
        let price = null;
        const priceEl = card.querySelector('h3.font-serif, h3');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from "View property details" link
        let url = '';
        const link = card.querySelector('a[href*="/properties/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image — first property image
        let imageUrl = '';
        const img = card.querySelector('img[src*="/media/Properties/"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Reference code and bedrooms from list items
        const bullets = [];
        card.querySelectorAll('ul li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 1 && t.length < 100) bullets.push(t);
        });
        // Description
        const descEl = card.querySelector('p.font-light.leading-loose, p.font-light');
        if (descEl) {
          const desc = descEl.textContent.trim();
          if (desc.length > 10 && desc.length < 300) bullets.push(desc);
        }
        const _kt = card.textContent || '';
        if (_kt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── FIRST FOR AUCTIONS ─────────────────────────────────────
  // online.firstforauctions.co.uk — EIG platform.
  // Cards are div.lot-panel with h4.grid-address, div.grid-guideprice b.
  // ─── PAUL FOSH (EIG ONLINE AUCTIONS) ────────────────────────
  // paulfosh.eigonlineauctions.com — EIG platform, same structure as firstforauctions.
  // Lot panels with h4.grid-address, .grid-guideprice, img.grid-img.
  paulfosh: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Lot number from panel title
        const titleEl = card.querySelector('.panel-title');
        let lotNum = lotIndex;
        if (titleEl) {
          const lotMatch = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        }
        // Price from .grid-guideprice strong or b
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice strong, .grid-guideprice b');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.grid-img-container img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Tagline as bullet
        const bullets = [];
        const tagline = card.querySelector('.grid-tagline');
        if (tagline) {
          const t = tagline.textContent.trim().replace(/^Lot\\s+\\d+\\s*-\\s*/i, '');
          if (t.length > 3) bullets.push(t);
        }
        const _pt = card.textContent || '';
        if (_pt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  firstforauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        // Address from h4.grid-address
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price from div.grid-guideprice b
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice b');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from image container or View button
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a.btn-primary[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.grid-img-container img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        const bullets = [];
        const _ft = card.textContent || '';
        // Skip sold/completed lots entirely — EIG /search includes historical
        if (_ft.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b/i)) continue;
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon && /sold|completed|exchanged/i.test(ribbon.getAttribute('data-ribbon') || '')) continue;
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── SUTTON KERSH ───────────────────────────────────────────
  // suttonkersh.co.uk — Liverpool. Static HTML gallery.
  // Cards are .propertyBox.auctionBox with .info h1 a (address) and h2 a (price).
  // Must validate cards have a lot link to filter out page chrome.
  suttonkersh: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.propertyBox.auctionBox');
      for (const card of cards) {
        const text = card.textContent || '';
        // URL from detail link — MUST exist to confirm this is a real lot
        let url = '';
        const link = card.querySelector('a[href*="/properties/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        if (!url) continue;
        // Address from h1 > a inside .info
        let address = '';
        const addrEl = card.querySelector('.info h1 a, h1 a');
        if (addrEl) address = addrEl.textContent.replace(/\\n/g, ', ').trim();
        if (!address || address.length < 5) continue;
        // Skip if address looks like nav/chrome text
        if (address.match(/^(Home|Contact|About|Search|Properties|Menu|Login|Register)$/i)) continue;
        // Price from h2 > a inside .info — "Sold for £63,000" or "Available at £X"
        let price = null;
        const priceEl = card.querySelector('.info h2 a, h2 a');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot[:\\s]+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Image
        let imageUrl = '';
        const img = card.querySelector('.img_container img:not(.sold), img[src*="image_crop"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — status, property type (strict filtering)
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        if (text.match(/\\bPostponed\\b/i)) bullets.push('Postponed');
        // Property type from p tags — only keep lines that look like property descriptions
        const infoPs = card.querySelectorAll('.info p');
        for (const p of infoPs) {
          const pt = p.textContent.trim();
          if (pt.length < 4 || pt.length > 80) continue;
          // Skip lines that are clearly not property type/description
          if (pt.match(/Lot[:\\s]|Guide|Save|View|Click|Search|Contact|Share|Print|©|Cookie|Privacy|Tel:|Email:|Fax:/i)) continue;
          // Only keep if it looks like a property descriptor
          if (pt.match(/residential|commercial|land|investment|vacant|freehold|leasehold|semi|terrace|detach|flat|house|bungalow|garage|shop|office|warehouse|industrial|mixed.use|development|site/i)) {
            bullets.push(pt);
          }
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── HARMAN HEALY ──────────────────────────────────────────
  // harman-healy.co.uk — National, EIG platform (tenant 18).
  // Cards use [data-lot-item-toggle] or a[href*="/lot/details/"].
  harmanhealy: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Try data-lot-item-toggle first, fall back to lot-panel
      let cards = document.querySelectorAll('[data-lot-item-toggle]');
      if (cards.length === 0) cards = document.querySelectorAll('.lot-panel, a[href*="/lot/details/"]');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from [data-address-searchable] or first heading
        let address = '';
        const addrEl = card.querySelector('[data-address-searchable], h3 a, a h3, h3, h4.grid-address, h4');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        // Skip descriptions masquerading as addresses (e.g. "A three bedroom house" with no postcode)
        if (address && /^A\\s+(one|two|three|four|five|six|\\d+)\\s+(bed|studio)/i.test(address)) {
          // Try h3 which often has the real address on EIG sites like Harmanhealy
          const h3El = card.querySelector('h3');
          if (h3El && h3El !== addrEl) {
            const h3Text = h3El.textContent.trim().replace(/\\u00a0/g, ' ');
            if (h3Text && h3Text.length >= 10 && /[A-Z]{1,2}\\d/.test(h3Text)) address = h3Text;
          }
        }
        if (!address) {
          // Fallback: find postcode line in text
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && l.length < 200) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price — "Guide Price*: £165,000 plus"
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Minimum Opening)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        // Bullets — end time
        const bullets = [];
        const endMatch = text.match(/End Time[^\\d]*(\\d{2}\\/\\d{2}\\/\\d{4}\\s*\\d{2}:\\d{2})/i);
        if (endMatch) bullets.push('End Time: ' + endMatch[1]);
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bAuction Ended\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── SEEL & CO ─────────────────────────────────────────────
  // online.seelauctions.co.uk — Cardiff, EIG platform (tenant 46).
  // Cards are a[href*="/lot/details/"] with h4 address, Guide Price in text.
  seelauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Seel Auctions 2026: EIG platform — try multiple card selectors
      let cards = document.querySelectorAll('.lot-panel');
      if (cards.length === 0) cards = document.querySelectorAll('[data-lot-item-toggle]');
      if (cards.length === 0) cards = document.querySelectorAll('a[href*="/lot/details/"]');
      if (cards.length === 0) cards = document.querySelectorAll('.grid-item, [class*="lot-card"], [class*="property-card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10 || text.length > 3000) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        if (seen.has(num)) continue;
        seen.add(num);
        // Address
        let address = '';
        const addrEl = card.querySelector('h4.grid-address, .lot-address, [data-address-searchable], h4, h3, .address');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        // Price
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Opening Bid)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.grid-img, img.img-responsive, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bPostponed\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── ROBINSON & HALL ───────────────────────────────────────
  // robinsonandhallauctions.co.uk — WordPress/Elementor + EIG.
  // Cards are article.ae-post-item with a.ae-element-custom-field (address).
  robinsonhall: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('article.ae-post-item, [data-source="ams-property"] article');
      // Helper: extract per-card image, rejecting duplicates (prevents image bleed)
      function extractCardImg(card, usedImages) {
        const imgs = card.querySelectorAll('img');
        for (const img of imgs) {
          const s = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
          if (s && s.length > 10 && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !s.includes('gavel') && !s.includes('backdrop') && !s.includes('placeholder')) {
            if (!usedImages.has(s)) { usedImages.add(s); return s; }
          }
        }
        return '';
      }
      const usedImages = new Set();
      if (cards.length === 0) {
        // Fallback: find lot blocks by guide-price class
        const priceBlocks = document.querySelectorAll('.guide-price');
        for (const pb of priceBlocks) {
          const card = pb.closest('article, .elementor-section, .ae-post-item') || pb.parentElement?.parentElement;
          if (!card) continue;
          const text = card.textContent || '';
          let address = '';
          const addrLink = card.querySelector('a.ae-element-custom-field');
          if (addrLink) address = addrLink.textContent.trim();
          if (!address || address.length < 5) continue;
          let price = null;
          const pm = text.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
          let url = addrLink ? addrLink.getAttribute('href') || '' : '';
          let lotNum = lots.length + 1;
          const lotEl = card.querySelector('.lot-block .ae-element-custom-field');
          if (lotEl) lotNum = parseInt(lotEl.textContent.trim()) || lotNum;
          const imageUrl = extractCardImg(card, usedImages);
          const bullets = [];
          const desc = card.querySelector('.property-strapline');
          if (desc) bullets.push(desc.textContent.trim().substring(0, 200));
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
            if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
          }
          lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        }
        return lots;
      }
      for (const card of cards) {
        const text = card.textContent || '';
        let address = '';
        const addrLink = card.querySelector('a.ae-element-custom-field');
        if (addrLink) address = addrLink.textContent.trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        let url = addrLink ? addrLink.getAttribute('href') || '' : '';
        let lotNum = lots.length + 1;
        const lotEl = card.querySelector('.lot-block .ae-element-custom-field');
        if (lotEl) lotNum = parseInt(lotEl.textContent.trim()) || lotNum;
        const imageUrl = extractCardImg(card, usedImages);
        const bullets = [];
        const desc = card.querySelector('.property-strapline');
        if (desc) bullets.push(desc.textContent.trim().substring(0, 200));
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      // Deduplicate by address (Elementor repeaters duplicate cards)
      const seen = new Set();
      return lots.filter(l => {
        const key = l.address.toLowerCase().replace(/\\s+/g, ' ');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })()
  `,

  // ── EIG PLATFORM (reusable for any EIG-hosted house) ──
  eigplatform: `
    (() => {
      const lots = [];
      // Strategy 1: lot-panel cards (grid/list view)
      let cards = document.querySelectorAll('.lot-panel');
      if (cards.length === 0) cards = document.querySelectorAll('[data-lot-item-toggle]');
      // Strategy 2: find lot links, dedupe by href, walk up to parent container
      if (cards.length === 0) {
        const links = document.querySelectorAll('a[href*="/lot/details/"]');
        const seen = new Set();
        const containers = [];
        for (const a of links) {
          const href = a.getAttribute('href');
          if (!href || seen.has(href)) continue;
          seen.add(href);
          // Walk up to find the lot container — try grandparent or great-grandparent
          let container = a.parentElement;
          // Keep walking up while container has little text (probably just wraps the link)
          for (let i = 0; i < 3 && container && container.textContent.length < 50; i++) {
            container = container.parentElement;
          }
          if (container) containers.push(container);
        }
        cards = containers;
      }
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:Guide Price|Opening Bid|Minimum Opening Bid)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // Address from known selectors — try specific selectors first, then generic
        let address = '';
        const addrEl = card.querySelector('h3.list-address') || card.querySelector('h4.grid-address')
          || card.querySelector('.lot-address') || card.querySelector('[data-address-searchable]')
          || card.querySelector('h4.lot-data-heading')
          || card.querySelector('h3') || card.querySelector('h4');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.list-image, img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon) {
          const r = ribbon.getAttribute('data-ribbon') || '';
          if (/sold|completed|exchanged/i.test(r)) continue;
          if (r) bullets.push(r);
        } else if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b/i)) continue;
        // Extract bedrooms from card text (e.g. "3 Bedroom", "2 bed", "4-bed")
        const bedMatch = text.match(/(\\d+)\\s*[-\\s]?(?:bed(?:room)?s?)\\b/i);
        const beds = bedMatch ? parseInt(bedMatch[1]) : null;
        const entry = { lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined };
        if (beds) entry.beds = beds;
        lots.push(entry);
      }
      return lots;
    })()
  `,

  // ── AUCTION HOUSE UK TEMPLATE (auctionhouse.co.uk branches) ──
  auctionhouseuk: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.lot-search-result, .lot-search-wrapper');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/Guide[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const addrEl = card.querySelector('p.grid-address, .grid-address');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address) {
          const typeEl = card.querySelector('p.fw-bold.blue-text');
          if (typeEl) address = typeEl.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        let url = '';
        const link = card.querySelector('a[href*="/auction/lot/"], a.home-lot-wrapper-link');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img.lot-image, img[loading="lazy"]');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        // Skip sold/completed lots — search results include historical
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b/i)) continue;
        const ribbon = card.querySelector('.lot-tag, .ribbon, [data-ribbon]');
        if (ribbon && /sold|completed|exchanged/i.test(ribbon.textContent || ribbon.getAttribute('data-ribbon') || '')) continue;
        const bullets = [];
        lots.push({ lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── GOLDINGS (goldingsauctions.co.uk) ──
  // Clean BEM structure: div.property-card with data-lotid
  goldings: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.property-card, .block-lot-listing__lot');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        let lotNum = lots.length + 1;
        const lotEl = card.querySelector('.property-card__lot-no strong');
        if (lotEl) lotNum = parseInt(lotEl.textContent.trim()) || lotNum;
        let address = '';
        const addrEl = card.querySelector('.property-card__additional-meta__address');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const priceEl = card.querySelector('.property-card__meta-price span');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('.property-card__gallery-main-image img, .property-card__gallery img');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        const tagline = card.querySelector('.property-card__additional-meta__tagline');
        if (tagline) bullets.push(tagline.textContent.trim().substring(0, 200));
        const soldFlag = card.querySelector('.property-card__sold-flag');
        if (soldFlag || text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b/i)) continue;
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── DAWSONS (dawsonsproperty.co.uk) ──
  // Bootstrap layout with div.homes-content for each lot, images in sibling col within same .row
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

  // ── DURRANTS (durrants.com) ──
  // Elementor page builder — lots are manual sections with elementor-icon-list-text containing "Lot N"
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

  // ── Agents Property Auction (WordPress, agentspropertyauction.com) ──
  // Cards: article.card--property inside div.card-grid-item
  // Lot: span.pill--pink ("Lot 1"), Address: h3.card-title--property a, Price: p.card-price
  // Image: background-image on div.card-img-bg, Link: a.u-link-cover
  agentsproperty: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.card-grid-item');
      for (const card of cards) {
        // Lot number from pill badge
        let lotNum = 0;
        const pill = card.querySelector('span.pill--pink, span.card-img-meta');
        if (pill) {
          const m = (pill.textContent || '').match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from title link
        let address = '';
        const titleLink = card.querySelector('h3.card-title--property a, h3.card-title a');
        if (titleLink) address = (titleLink.textContent || '').replace(/<br\\s*\\/?>/gi, ', ').trim();
        if (!address || address.length < 5) continue;
        // Price from p.card-price
        let price = null;
        const priceEl = card.querySelector('p.card-price');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: CSS background-image on div.card-img-bg
        let imageUrl = '';
        const imgBg = card.querySelector('div.card-img-bg');
        if (imgBg) {
          const style = imgBg.getAttribute('style') || '';
          const urlMatch = style.match(/url\\(([^)]+)\\)/);
          if (urlMatch) imageUrl = urlMatch[1].replace(/['"]/g, '');
        }
        // Detail link
        let url = '';
        const detailLink = card.querySelector('a.u-link-cover, h3.card-title--property a');
        if (detailLink) url = detailLink.getAttribute('href') || '';
        // Bullets from card-excerpt
        const bullets = [];
        const excerpt = card.querySelector('div.card-excerpt');
        if (excerpt) {
          const t = (excerpt.textContent || '').trim();
          const bedMatch = t.match(/(\\d+)\\s*Bed/i);
          if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
          const bathMatch = t.match(/(\\d+)\\s*Bath/i);
          if (bathMatch) bullets.push(bathMatch[1] + ' bathrooms');
          const recMatch = t.match(/(\\d+)\\s*Recep/i);
          if (recMatch) bullets.push(recMatch[1] + ' receptions');
        }
        // Status
        const banner = card.querySelector('span.card-img-banner');
        if (banner) {
          const status = (banner.textContent || '').trim();
          if (status && status !== 'Upcoming') bullets.push(status);
        }
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Andrew Craig (Estate Apps platform, andrewcraig.co.uk) ──
  // Cards: div.card[data-id], Address: div.card-content > a.card-image-container (text)
  // Price: span.price-value, Image: img[data-src] (lazy loaded), Link: a.card-image-container[href]
  // Pagination: ?page=N, No lot numbers — uses property IDs
  andrewcraig: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.card[data-id]');
      let lotNum = 0;
      for (const card of cards) {
        // Skip CTA cards
        if (card.classList.contains('card--property-worth')) continue;
        lotNum++;
        // Address from the text link in card-content
        let address = '';
        const addrLink = card.querySelector('div.card-content > a.card-image-container');
        if (addrLink) address = (addrLink.textContent || '').trim();
        // Clean "X bed Y for sale in" prefix
        address = address.replace(/^\\d+\\s+bed\\s+\\w+\\s+for\\s+sale\\s+in\\s+/i, '').trim();
        if (!address || address.length < 5) continue;
        // Price from span.price-value
        let price = null;
        const priceEl = card.querySelector('span.price-value');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: data-src (lazy loaded with base64 placeholder in src)
        let imageUrl = '';
        const img = card.querySelector('div.card-image img');
        if (img) {
          imageUrl = img.getAttribute('data-src') || '';
          if (!imageUrl || imageUrl.startsWith('data:')) imageUrl = img.getAttribute('src') || '';
          if (imageUrl.startsWith('data:')) imageUrl = '';
        }
        // Detail link
        let url = '';
        const link = card.querySelector('a.card-image-container');
        if (link) url = link.getAttribute('href') || '';
        // Bullets: bedroom/bathroom counts from span.number elements
        const bullets = [];
        const numbers = card.querySelectorAll('div.card-content__detail__left span.number');
        if (numbers.length >= 1) bullets.push(numbers[0].textContent.trim() + ' bedrooms');
        if (numbers.length >= 2) bullets.push(numbers[1].textContent.trim() + ' bathrooms');
        if (numbers.length >= 3) bullets.push(numbers[2].textContent.trim() + ' receptions');
        // Property tag (e.g. "Land")
        const tag = card.querySelector('span.property-tag');
        if (tag) bullets.push((tag.textContent || '').trim());
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Butters John Bee (Rex Software v2 platform, buttersjohnbee.com) ──
  // Cards: h4 address headings near a[href*="/listings/"] links
  // Image in sibling <a> with img, Price in text, Pagination: ?page=N
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

  // ── Cheffins (cheffins.co.uk, EIG-based catalogue pages) ──
  // Cards: div.property-card, Lot: div.pc-tag ("Lot number: N"), Address: div.pc-add
  // Price: div.pc-price, Image: div.pc-slide div[data-img] (EIG CDN), Link: a.btn--alt
  cheffins: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.property-card');
      for (const card of cards) {
        // Lot number from pc-tag
        let lotNum = 0;
        const tag = card.querySelector('div.pc-tag');
        if (tag) {
          const m = (tag.textContent || '').match(/Lot\\s*(?:number)?:?\\s*(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from pc-add
        let address = '';
        const addrEl = card.querySelector('div.pc-add');
        if (addrEl) address = (addrEl.textContent || '').trim();
        if (!address || address.length < 5) continue;
        // Price from pc-price
        let price = null;
        const priceEl = card.querySelector('div.pc-price');
        if (priceEl) {
          const pt = (priceEl.textContent || '').trim();
          const pm = pt.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: data-img attribute on slider divs (EIG CDN)
        let imageUrl = '';
        const imgDiv = card.querySelector('div.pc-slide > div[data-img]');
        if (imgDiv) imageUrl = imgDiv.getAttribute('data-img') || '';
        // Detail link
        let url = '';
        const detailBtn = card.querySelector('a.btn--alt, a.btn');
        if (detailBtn) url = detailBtn.getAttribute('href') || '';
        // Bullets: status from pc-extraInfo
        const bullets = [];
        const extraInfo = card.querySelector('div.pc-extraInfo');
        if (extraInfo) {
          const status = (extraInfo.textContent || '').trim();
          if (status && status !== 'New') bullets.push(status);
        }
        // Description summary
        const summ = card.querySelector('div.pc-summ');
        if (summ) {
          const st = (summ.textContent || '').trim();
          if (st.match(/\\bland\\b/i)) bullets.push('Land');
          if (st.match(/\\bgarage\\b/i)) bullets.push('Garage');
          if (st.match(/\\bbarn\\b/i)) bullets.push('Barn');
          const bedMatch = st.match(/(\\d+)\\s*(?:bed|Bed)/i);
          if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        }
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Feather Smailes & Scales (fssproperty.co.uk, same CMS as Hollis Morgan) ──
  fssproperty: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('#search-results .property, .property');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        // Lot number from description
        const lotMatch = text.match(/LOT\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from first h3 > a[href*="/property-details/"]
        let address = '';
        const addrLink = card.querySelector('a[href*="/property-details/"]');
        if (addrLink) address = (addrLink.textContent || '').trim();
        if (!address || address.length < 5) continue;
        // Price from second h3
        let price = null;
        const h3s = card.querySelectorAll('h3');
        for (const h of h3s) {
          const t = (h.textContent || '').trim();
          const pm = t.match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        // Image: /resize/ pattern (same as Hollis Morgan)
        let imageUrl = '';
        const img = card.querySelector('img[src*="/resize/"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // URL
        let url = '';
        if (addrLink) url = addrLink.getAttribute('href') || '';
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*(?:bed|Bed)/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── iamsold (server-rendered with data-bkimage for images) ──
  iamsold: `
    (() => {
      const lots = [];
      const seen = new Set();
      // iamsold uses div.c__property cards with structured content
      const cards = document.querySelectorAll('.c__property, .c__propertyAlt');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        // Address from .c__property__address (contains bed count + street + area + postcode)
        let address = '';
        const addrEl = card.querySelector('.c__property__address');
        if (addrEl) {
          address = (addrEl.textContent || '').replace(/\\s+/g, ' ').trim();
          // Remove leading "X bed Type" prefix (e.g. "2 bed Apartment")
          address = address.replace(/^\\d+\\s+bed\\s+\\w+\\s*/i, '').trim();
        }
        if (!address || address.length < 5) {
          // Fallback: try link slug
          const link = card.querySelector('a[href*="/property/"]');
          if (link) {
            const href = link.getAttribute('href') || '';
            const slug = href.split('/property/')[1];
            if (slug) address = slug.replace(/\\/$/, '').replace(/-/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase());
          }
        }
        if (!address || address.length < 5) continue;
        // Price from tags or status text
        let price = null;
        const tags = card.querySelectorAll('.c__property__tags li, .c__property__infoPoints li');
        for (const tag of tags) {
          const tm = (tag.textContent || '').match(/(?:Starting\\s*bid|Guide\\s*Price)[:\\s]*£([\\d,]+)/i);
          if (tm) { price = parseInt(tm[1].replace(/,/g, '')); break; }
        }
        if (!price) {
          const pm = text.match(/(?:Starting\\s*bid|Guide\\s*Price)[:\\s]*£([\\d,]+)/i);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        if (!price) {
          const pm = text.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image from data-bkimage (cloudfront CDN)
        let imageUrl = '';
        const bkImg = card.querySelector('[data-bkimage]');
        if (bkImg) imageUrl = bkImg.getAttribute('data-bkimage') || '';
        if (!imageUrl) {
          const webpAlt = card.querySelector('[data-webpalt]');
          if (webpAlt) imageUrl = webpAlt.getAttribute('data-webpalt') || '';
        }
        if (!imageUrl) imageUrl = extractCardImage(card);
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/property/"]');
        if (link) url = link.getAttribute('href') || '';
        // Bullets
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(Detached|Semi-Detached|Terrace|Flat|Apartment|Bungalow|House|Cottage|Land|Commercial)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        // Status tag
        const statusEl = card.querySelector('.c__property__status');
        if (statusEl) {
          const st = (statusEl.textContent || '').trim();
          if (st && st !== 'Available') bullets.push(st);
        }
        if (seen.has(url || address)) continue;
        seen.add(url || address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Wilsons Auctions (wilsonsauctions.com — l-grid__item cards) ──
  wilsons: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.l-grid__item a[href*="/lots/"]');
      let lotNum = 0;
      for (const link of cards) {
        const href = link.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);
        lotNum++;
        const card = link.closest('.l-grid__item') || link;
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('h3, h2, h4');
        if (heading) address = (heading.textContent || '').trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const pm = text.match(/(?:Guide|Reserve|Starting)[:\\s]*£([\\d,]+)/i);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        if (!price) { const gm = text.match(/£([\\d,]+)/); if (gm) price = parseInt(gm[1].replace(/,/g, '')); }
        let imageUrl = '';
        const img = card.querySelector('img');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*Bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(House|Flat|Apartment|Bungalow|Land|Commercial|Cottage|Farm)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Strakers (strakers.co.uk — .card.card-auction cards) ──
  strakers: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.card-auction, .card[class*="auction"]');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('h5 a, h4 a, h3 a');
        if (heading) address = (heading.textContent || '').trim();
        if (!address) {
          const h = card.querySelector('h5, h4, h3');
          if (h) address = (h.textContent || '').trim();
        }
        if (!address || address.length < 5) continue;
        let price = null;
        const priceEl = card.querySelector('.card__price');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        if (!price) { const pm = text.match(/£([\\d,]+)/); if (pm) price = parseInt(pm[1].replace(/,/g, '')); }
        let imageUrl = '';
        const img = card.querySelector('.card__head img');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (!imageUrl) { const anyImg = card.querySelector('img'); if (anyImg) imageUrl = anyImg.getAttribute('src') || ''; }
        let url = '';
        const link = card.querySelector('a[href]');
        if (link) url = link.getAttribute('href') || '';
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const lot = lotMatch ? lotMatch[1] : String(lotNum);
        if (seen.has(url || address)) continue;
        seen.add(url || address);
        lots.push({ lot, address: address.substring(0, 200), price, url, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Under The Hammer (Next.js SPA — underthehammer.com) ──
  // React SPA, no server-rendered lot cards. The site uses /for-auction/properties
  // which loads property data via client-side JS. DOM extractor will return <3 lots,
  // triggering the Gemini AI fallback which handles JS-rendered content via Firecrawl.
  underthehammer: `
    (() => {
      const lots = [];
      const seen = new Set();
      // UTH renders property cards client-side, but attempt to catch any SSR content
      // Look for any property links with /for-auction/ pattern
      const links = document.querySelectorAll('a[href*="/for-auction/"]');
      let lotNum = 0;
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href || href === '/for-auction/properties' || seen.has(href)) continue;
        if (!href.match(/\\/for-auction\\/[a-z0-9-]+$/i)) continue;
        seen.add(href);
        lotNum++;
        // Walk up to find the card container
        let card = link;
        for (let i = 0; i < 6 && card.parentElement; i++) {
          card = card.parentElement;
          const cl = (card.className || '').toLowerCase();
          if (cl.match(/card|property|listing|item|result/) || card.tagName === 'ARTICLE') break;
        }
        const text = card.textContent || '';
        // Address from heading or text
        let address = '';
        const heading = card.querySelector('h2, h3, h4');
        if (heading) address = (heading.textContent || '').trim();
        if (!address || address.length < 5) {
          // Try link title
          const title = link.getAttribute('title') || link.textContent.trim();
          if (title && title.length > 5) address = title;
        }
        if (!address || address.length < 5) continue;
        // Price
        let price = null;
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="property"], img[src*="blob.core.windows.net"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        if (!imageUrl) {
          const anyImg = card.querySelector('img[alt]');
          if (anyImg) {
            const srcset = anyImg.getAttribute('srcset') || '';
            const urlMatch = srcset.match(/url=([^&]+)/);
            if (urlMatch) { try { imageUrl = decodeURIComponent(urlMatch[1]); } catch(e) {} }
            if (!imageUrl) imageUrl = anyImg.getAttribute('src') || '';
          }
        }
        // Bullets
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(Detached|Semi-Detached|Terrace|Flat|Apartment|Bungalow|House|Cottage|Land|Commercial)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── SYMONDS & SAMPSON ─────────────────────────────────────
  // WebDadi platform — event detail pages serve lots in FeaturedGrid cards
  // Each card: a.FeaturedGrid__item with data-bg image, h3 address, nativecurrencyvalue price
  symondsandsampson: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.FeaturedGrid__item-container, .FeaturedGrid__item');
      let lotNum = 0;
      for (const card of cards) {
        const link = card.tagName === 'A' ? card : card.querySelector('a.FeaturedGrid__item, a[href*="/property/"]');
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        if (!href.includes('/property/') || href.includes('property-for-sale') || href.includes('property-to-rent')) continue;
        lotNum++;
        // Address from first h3 inside FeaturedProperty__description
        const descDiv = link.querySelector('.FeaturedProperty__description');
        const h3s = descDiv ? descDiv.querySelectorAll('h3') : link.querySelectorAll('h3');
        let address = '';
        if (h3s.length > 0) {
          address = h3s[0].textContent.trim();
        }
        if (!address) continue;
        // Price from .nativecurrencyvalue
        let price = null;
        const priceEl = link.querySelector('.nativecurrencyvalue');
        if (priceEl) {
          const pm = priceEl.textContent.replace(/[^0-9]/g, '');
          if (pm) price = parseInt(pm);
        }
        // Image from data-bg on .FeaturedProperty__featured-image
        let imageUrl = '';
        const imgDiv = link.querySelector('.FeaturedProperty__featured-image, [data-bg]');
        if (imgDiv) imageUrl = imgDiv.getAttribute('data-bg') || '';
        if (!imageUrl) {
          const img = link.querySelector('img[src*="cdn.webdadi.net"]');
          if (img) imageUrl = img.getAttribute('src') || '';
        }
        // Property type from URL path
        const bullets = [];
        const typeMatch = href.match(/\\/(house|flat|land|bungalow|detached|semi-detached|terraced|cottage|studio|other|barn|garage|maisonette|commercial)[\\/]/i);
        if (typeMatch) bullets.push(typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1));
        const bedMatch = href.match(/(\\d+)-bedroom/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        lots.push({ lot: lotNum, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,

  // ─── STAGS / GTH (HOMEFLOW SPA) ───────────────────────────
  // Homeflow platform renders property cards after JS hydration
  // Cards: .property-card or li with .list-address + .list-price
  stags: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Try multiple Homeflow card selectors
      const cards = document.querySelectorAll('.property-results-list li, .property-card, [class*="property"] li');
      let lotNum = 0;
      for (const card of cards) {
        // Address
        const addrEl = card.querySelector('.list-address, h3 a, .property-title, .address');
        if (!addrEl) continue;
        const address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        lotNum++;
        // Price
        let price = null;
        const priceEl = card.querySelector('.list-price, .price, [class*="price"]');
        if (priceEl) {
          const pm = priceEl.textContent.replace(/[^0-9]/g, '');
          if (pm && pm.length >= 4) price = parseInt(pm);
        }
        // URL
        let url = '';
        const link = addrEl.tagName === 'A' ? addrEl : (card.querySelector('a[href*="/properties/"]') || card.querySelector('a[href]'));
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="homeflow-assets"], img[src*="cdn"], img[data-src]');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const bgEl = card.querySelector('[style*="background"]');
        if (!imageUrl && bgEl) {
          const bgMatch = (bgEl.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
          if (bgMatch) imageUrl = bgMatch[1];
        }
        // Bullets from property type badges or text
        const bullets = [];
        const typeEl = card.querySelector('.property-type, .type');
        if (typeEl) bullets.push(typeEl.textContent.trim());
        const bedEl = card.querySelector('.beds, .bedrooms, [class*="bed"]');
        if (bedEl) {
          const bm = bedEl.textContent.match(/(\\d+)/);
          if (bm) bullets.push(bm[1] + ' bedrooms');
        }
        lots.push({ lot: lotNum, address, price, url, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,

};

// ── SHONKI BROTHERS ──
// Own site hosts lots from EIG backend. Cards at /auctions/latest-auctions/view
DOM_EXTRACTORS['shonkibros'] = `
  (() => {
    const lots = [];
    const cards = document.querySelectorAll('.auction-image-container, .flat-item');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      const lotMatch = text.match(/Lot\\s*(?:number)?[:\\s]*(\\d+)/i);
      const num = lotMatch ? parseInt(lotMatch[1]) : idx;
      const heading = card.querySelector('h5 a strong, h5 a, h4 a, h3 a');
      const address = heading ? heading.textContent.trim() : '';
      if (!address || address.length < 5) { idx++; continue; }
      const priceEl = card.querySelector('.price, span.price');
      const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
      const link = card.querySelector('a[href*="/auctions/lot/"], a[href*="/lot/details/"]');
      const url = link ? link.getAttribute('href') : '';
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || '';
        if (s && s.length > 10 && !s.includes('logo') && !s.includes('icon')) imageUrl = s;
      }
      lots.push({ lot: num, address, price, url, imageUrl: imageUrl || undefined });
      idx++;
    }
    return lots;
  })()
`;

// ── BAGSHAWS ──
// Ancient table-based layout. Images in one row, text in next row, 4 lots per row pair.
DOM_EXTRACTORS['bagshaws'] = `
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
`;

// Wire up EIG house aliases to the shared eigplatform extractor
for (const slug of ['astleys', 'henrysykes', 'clarkesimpson', 'brownco', 'cheffinstimed', 'romanway', 'hammerprice', 'sarahmains', 'sageandco', 'auctiontrade', 'brggibson', 'higginsdrysdale', 'martinpole', 'jonespeckover', 'thepropertyauctionhouse', 'propertyauctionagent', 'lot9', 'auctionnorth', 'bowensonandwatson', 'sheldonbosley', 'nationalpropertyauctions', 'ahlondon', 'starpropertyonline', 'brggibsondublin', 'lsh', 'groundrentauctions', 'benjaminstevens']) {
  DOM_EXTRACTORS[slug] = DOM_EXTRACTORS.eigplatform;
}
// Wire up Bamboo Auctions platform houses to the shared hunters extractor
DOM_EXTRACTORS['lsk'] = DOM_EXTRACTORS.hunters;
// Wire up Sequence/Connells platform houses to the shared barnardmarcus extractor
DOM_EXTRACTORS['foxandsons'] = DOM_EXTRACTORS.barnardmarcus;
// Wire up iamsold platform houses
DOM_EXTRACTORS['driversnorris'] = DOM_EXTRACTORS.iamsold;
DOM_EXTRACTORS['wrightmarshall'] = DOM_EXTRACTORS.iamsold;
// Mark Jenkinson merged into BTG Eddisons (sdl)
DOM_EXTRACTORS['markjenkinson'] = DOM_EXTRACTORS.sdl;
// Scargill Mann uses SDL Auctions platform
DOM_EXTRACTORS['scargillmann'] = DOM_EXTRACTORS.sdl;
// Carter Jonas uses Bamboo Auctions platform (same as hunters)
DOM_EXTRACTORS['carterjonas'] = DOM_EXTRACTORS.hunters;
// All Wales Auction uses Bamboo via The Property People
DOM_EXTRACTORS['allwalesauction'] = DOM_EXTRACTORS.hunters;
// Rendells Devon uses Bamboo Auctions platform (same as hunters)
DOM_EXTRACTORS['rendells'] = DOM_EXTRACTORS.hunters;
// Cooper and Tanner uses EIG platform for auctions
DOM_EXTRACTORS['cooperandtanner'] = DOM_EXTRACTORS.eigplatform;
// GOTO Properties platform is EIG-based (purplebricks.gotoproperties.co.uk)
DOM_EXTRACTORS['purplebricksgoto'] = DOM_EXTRACTORS.eigplatform;
// GTH (Greenslade Taylor Hunt) uses Homeflow SPA platform (same as stags)
DOM_EXTRACTORS['gth'] = DOM_EXTRACTORS.stags;
// Clee Tompkinson Francis also uses Homeflow (same tag/auction URL pattern)
DOM_EXTRACTORS['cleetompkinson'] = DOM_EXTRACTORS.stags;
// John Francis uses Homeflow with /properties/sales/tag-auction URL
DOM_EXTRACTORS['johnfrancis'] = DOM_EXTRACTORS.stags;
// Bradleys Devon uses Homeflow with /properties/sales/tag-auction URL
DOM_EXTRACTORS['bradleysdevon'] = DOM_EXTRACTORS.stags;

// ─── PROPERTY SOLVERS ──────────────────────────────────────
// PropertyHive WordPress plugin, single page (no pagination), ~111 lots
DOM_EXTRACTORS['propertysolvers'] = `
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
`;
// ─── PUGH AUCTIONS ─────────────────────────────────────────
// Server-rendered Laravel, Tailwind CSS. ~1,193 lots across 60 pages.
// Part of BTG/SDL family but has own frontend with different selectors.
DOM_EXTRACTORS['pugh'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    // Pugh: property cards in grid layout
    const cards = document.querySelectorAll('div.grid > div.h-full.mb-8, div.grid > div.h-full');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address from bold link inside card
      const addrLink = card.querySelector('div.text-white.uppercase.text-lg.font-bold a.block, div.uppercase a, h3 a, h2 a, a[href*="/property/"]');
      let address = addrLink ? addrLink.textContent.trim() : '';
      // Fallback: first link with substantial text
      if (!address) {
        const links = card.querySelectorAll('a');
        for (const lnk of links) {
          const t = lnk.textContent.trim();
          if (t.length > 10 && !t.match(/^(View|More|See|Back|Next|Previous)/i)) { address = t; break; }
        }
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Lot URL
      let url = '';
      if (addrLink) url = addrLink.getAttribute('href') || '';
      if (!url) {
        const anyLink = card.querySelector('a[href*="/property/"], a[href*="pugh-auctions.com/property"]');
        if (anyLink) url = anyLink.getAttribute('href') || '';
      }
      if (seen.has(url) && url) { idx++; continue; }
      if (url) seen.add(url);
      // Lot number from text
      const lotMatch = text.match(/Lot\\s*(?:No\\.?)?\\s*(\\d+)/i);
      const lotNum = lotMatch ? parseInt(lotMatch[1]) : idx;
      // Price from bold span
      let price = null;
      const priceEl = card.querySelector('p.text-secondary span.text-xl, span.text-xl, .price');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image — BTG Eddisons CDN or local
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && s.length > 10 && !/logo|icon|placeholder|\\.svg/i.test(s)) imageUrl = s;
      }
      // Bullets — auction type, status
      const bullets = [];
      if (/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/Timed\\s*Auction/i.test(text)) bullets.push('Timed Auction');
      if (/Live\\s*(Stream)?\\s*Auction/i.test(text)) bullets.push('Live Auction');
      const dateMatch = text.match(/(\\d{1,2}(?:st|nd|rd|th)?\\s+\\w+\\s+\\d{4})/i);
      if (dateMatch) bullets.push(dateMatch[1]);
      lots.push({ lot: lotNum, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── PEARSONS ────────────────────────────────────────────────
// Custom Bootstrap site, server-rendered. ~22 lots, single page.
// Cards use .propertyBlock.auctions with background-image for photos.
DOM_EXTRACTORS['pearsons'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.propertyBlock.auctions');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address from h3 link
      const addrEl = card.querySelector('.propTextHolder h3 a, h3 a');
      const address = addrEl ? addrEl.textContent.trim() : '';
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      const url = addrEl ? addrEl.getAttribute('href') || '' : '';
      if (seen.has(url)) continue;
      seen.add(url);
      // Price from p.size18
      let price = null;
      const priceEl = card.querySelector('.propTextHolder p.size18, p.size18');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image from background-image on .propImageHolder
      let imageUrl = '';
      const imgHolder = card.querySelector('.propImageHolder');
      if (imgHolder) {
        const style = imgHolder.getAttribute('style') || '';
        const bgMatch = style.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
        if (bgMatch) imageUrl = bgMatch[1];
      }
      if (!imageUrl) {
        const img = card.querySelector('img[src]');
        if (img) imageUrl = img.getAttribute('src') || '';
      }
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── NESBITS ─────────────────────────────────────────────────
// WordPress custom theme, server-rendered. ~9 lots.
// Cards are <a href="/property/..."> wrappers with h4 for address.
DOM_EXTRACTORS['nesbits'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const links = document.querySelectorAll('a[href*="/property/"]');
    let idx = 1;
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (!href || seen.has(href)) continue;
      // Must be a property detail link (not nav/footer)
      const h4 = link.querySelector('h4');
      if (!h4) continue;
      seen.add(href);
      const address = h4.textContent.trim();
      if (!address || address.length < 5) { idx++; continue; }
      const text = link.textContent || '';
      // Price — "£X Guide price" text above the heading
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = link.querySelector('img[src]');
      if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
      // Bullets
      const bullets = [];
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      lots.push({ lot: idx, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── SMITH AND SONS ──────────────────────────────────────────
// Custom CMS (Gud Design), server-rendered. ~9 lots per auction event.
// Cards are <a href="/auctionproperties/..."> with img + price range + address.
DOM_EXTRACTORS['smithandsons'] = `
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
`;

// ─── BRUTON KNOWLES ──────────────────────────────────────────
// WordPress custom (not PropertyHive), server-rendered. ~220 lots.
// Cards use .property-post-template with code references and prices.
DOM_EXTRACTORS['brutonknowles'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.property-post-template, .wp-block-post');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Skip non-property cards
      if (text.length < 20) continue;
      // Address — from heading or first substantial text
      let address = '';
      const heading = card.querySelector('h3 a, h2 a, h3, h2');
      if (heading) address = heading.textContent.trim();
      if (!address || address.length < 5) {
        // Try link text
        const link = card.querySelector('a[href*="/property/"]');
        if (link) address = link.textContent.trim();
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      let url = '';
      const link = card.querySelector('a[href*="/property/"], a[href*="brutonknowles"]');
      if (link) url = link.getAttribute('href') || '';
      if (!url) {
        const anyLink = card.querySelector('a[href]');
        if (anyLink) url = anyLink.getAttribute('href') || '';
      }
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon|placeholder/i.test(s)) imageUrl = s;
      }
      // Bullets
      const bullets = [];
      const codeMatch = text.match(/Code\\s*(\\d+)/i);
      if (codeMatch) bullets.push('Ref: ' + codeMatch[1]);
      const acreMatch = text.match(/(\\d+\\.?\\d*)\\s*acres?/i);
      if (acreMatch) bullets.push(acreMatch[0]);
      if (/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/\\bPOA\\b|On Application/i.test(text)) bullets.push('POA');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── McCARTNEYS ──────────────────────────────────────────────
// WordPress + PropertyHive, server-rendered.
// URL: /property-search/?department=property-land-auctions
DOM_EXTRACTORS['mccartneys'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.repeat-team, .property-result, li.type-property, .office-slider');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address
      let address = '';
      const addrEl = card.querySelector('h4 a, h3 a, h2 a, .col-right h4 a');
      if (addrEl) address = addrEl.textContent.trim();
      if (!address || address.length < 5) { idx++; continue; }
      // URL
      let url = '';
      const link = card.querySelector('a[href*="/property-details/"], a[href*="/property/"], h4 a, h3 a');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const priceEl = card.querySelector('p.price, .price');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── BRAMLEYS ────────────────────────────────────────────────
// Custom CMS (Property Jungle), server-rendered. .property cards.
// URL: /search/?instruction_type=Sale&department=Auction
DOM_EXTRACTORS['bramleys'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.property, .product-container');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      if (text.length < 20) continue;
      // Address from paragraph or heading
      let address = '';
      const addrEl = card.querySelector('p, h4');
      if (addrEl) {
        // Address is usually the line with a town/postcode
        const lines = (card.textContent || '').split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        for (const line of lines) {
          if (/[A-Z]{1,2}\\d/i.test(line) || (line.includes(',') && !line.startsWith('£') && !line.startsWith('Auction') && !/^\\d+\\s*Bed/i.test(line))) {
            address = line;
            break;
          }
        }
      }
      if (!address) {
        const h4 = card.querySelector('h4');
        if (h4) address = h4.textContent.trim();
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      let url = '';
      const link = card.querySelector('a[href*="/property-details/"], a[href]');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const pm = text.match(/(?:Guide|Auction)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon/i.test(s)) imageUrl = s;
      }
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*Bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      const typeMatch = text.match(/\\b(Detached|Semi|Terrace|Back to Back|End Terrace|Flat|Bungalow|House|Cottage|Land)\\b/i);
      if (typeMatch) bullets.push(typeMatch[0]);
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/FOR SALE/i.test(text)) bullets.push('For Sale');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── MORRIS MARSHALL ─────────────────────────────────────────
// Property Jungle CMS, Infinite Ajax Scroll. .product-container cards.
// URL: /search/?instruction_type=Auction
DOM_EXTRACTORS['morrismarshall'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.product-container, .property');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      if (text.length < 20) continue;
      let address = '';
      const addrEl = card.querySelector('h4 a, h3 a, h2 a, .address, p');
      if (addrEl) address = addrEl.textContent.trim();
      if (!address || address.length < 5) {
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        for (const line of lines) {
          if (/[A-Z]{1,2}\\d/i.test(line) || (line.includes(',') && !line.startsWith('£'))) {
            address = line; break;
          }
        }
      }
      if (!address || address.length < 5) { idx++; continue; }
      let url = '';
      const link = card.querySelector('a[href*="/property/"], a[href*="/property-details/"], a[href]');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon/i.test(s)) imageUrl = s;
      }
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// Wire up Auction House UK branches to the shared auctionhouseuk extractor
for (const slug of ['auctionhousescotland', 'austingray', 'auctionhouseeastanglia', 'auctionhousenorthwest', 'auctionhousenortheast', 'auctionhousewales', 'auctionhousebirmingham', 'auctionhousekent', 'auctionhousedevon', 'auctionhouseeastmidlands', 'auctionhousewestmidlands', 'auctionhouseessex', 'auctionhousemanchester', 'auctionhousesouthyorkshire', 'auctionhousewestyorkshire', 'auctionhouseteesvalley', 'auctionhousehull', 'auctionhousecumbria', 'auctionhouselincolnshire', 'auctionhouseuklondon', 'auctionhousebedsandbucks', 'auctionhousenorthamptonshire', 'auctionhouseoxfordshire', 'auctionhouseleicestershire', 'auctionhousemidlands', 'auctionhousecoventry', 'auctionhousenottsandderby', 'auctionhousechesterfield', 'auctionhousestaffordshire', 'auctionhousenorthwales', 'auctionhousesouthwest', 'auctionhousenorthernireland', 'auctionhousenational']) {
  DOM_EXTRACTORS[slug] = DOM_EXTRACTORS.auctionhouseuk;
}

// Universal DOM extractor — works on any auction site by detecting common patterns
export const UNIVERSAL_DOM_EXTRACTOR = `
  (() => {
    const lots = [];
    const seen = new Set();
    
    // Strategy 1: Find all links to individual property/lot pages
    const propLinks = document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], a[href*="property-details"], a[href*="/properties/"], a[href*="/auction/"], a[href*="/catalogue/"], a[href*="/sale/"], a[href*="lot-overview"], a[href*="/listing/"], a[href*="/auctions/lot"]');
    const linkSet = new Set();
    
    for (const link of propLinks) {
      const href = link.getAttribute('href') || '';
      if (linkSet.has(href)) continue;
      linkSet.add(href);
      
      // Walk up to find the card container (look for a repeating parent element)
      let card = link;
      for (let i = 0; i < 8 && card.parentElement; i++) {
        card = card.parentElement;
        // Stop when we find an element that likely wraps a single lot
        const cl = (card.className || '').toLowerCase();
        const tag = card.tagName.toLowerCase();
        if (cl.match(/card|lot|property|listing|item|result|auction/) || 
            (tag === 'article') || 
            (tag === 'li' && card.querySelector('a[href]'))) break;
      }
      
      const text = card.innerText || card.textContent || '';
      if (text.length < 20 || text.length > 5000) continue;
      
      // Extract price
      let price = null;
      const priceMatch = text.match(/(?:Guide[\\s]*(?:Price)?|Price|Starting|Reserve|Estimate)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
      
      // Extract address — look for postcode pattern
      let address = '';
      const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 0);
      // First try: line with a UK postcode
      for (const line of lines) {
        if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && line.length < 200) {
          address = line;
          break;
        }
      }
      // Second try: first heading in the card
      if (!address) {
        const heading = card.querySelector('h1, h2, h3, h4, h5, .title, .address, [class*="title"], [class*="address"]');
        if (heading) address = heading.textContent.trim();
      }
      // Third try: link title or first substantial text
      if (!address) {
        const title = link.getAttribute('title');
        if (title && title.length > 5) address = title;
      }
      if (!address) {
        const substantial = lines.find(l => l.length > 10 && l.length < 150 && !l.match(/^(Guide|Price|Lot|Find|View|More|Search|Filter|Sort|Show|Order|£)/i));
        if (substantial) address = substantial;
      }
      if (!address || address.length < 5) continue;
      
      // Deduplicate by address
      const addrKey = address.toLowerCase().replace(/\\s+/g, ' ').substring(0, 60);
      if (seen.has(addrKey)) continue;
      seen.add(addrKey);
      
      // Extract lot number
      let lotNum = lots.length + 1;
      const lotMatch = text.match(/Lot\\s+(\\d+)/i);
      if (lotMatch) lotNum = parseInt(lotMatch[1]);
      
      // Extract bullets/features
      const bullets = [];
      card.querySelectorAll('li, .feature, .tag, .type, .property-type, .meta').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 2 && t.length < 200 && !t.match(/^(Search|Filter|Sort|Show|View|Order|My|Menu|Buy|Sell|About|Contact|Home)/i)) {
          bullets.push(t);
        }
      });
      // Also grab description-like paragraphs
      card.querySelectorAll('p, .description, [class*="desc"]').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 15 && t.length < 300 && !bullets.includes(t)) bullets.push(t);
      });
      
      // Detect sold/withdrawn status
      if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
        if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
      }
      
      // Extract image from card
      let imageUrl = '';
      const junkImg = /\\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge|placeholder|no-image|1x1/i;
      const img = card.querySelector('img[src], img[data-src], img[data-lazy-src]');
      if (img) {
        const imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
        if (imgSrc && imgSrc.length > 10 && !imgSrc.startsWith('data:') && !junkImg.test(imgSrc)) {
          imageUrl = imgSrc;
        }
      }
      // Also check for background-image on card or immediate children
      if (!imageUrl) {
        const bgEl = card.querySelector('[style*="background"]');
        if (bgEl) {
          const bgMatch = (bgEl.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
          if (bgMatch && bgMatch[1] && !junkImg.test(bgMatch[1])) imageUrl = bgMatch[1];
        }
      }

      lots.push({ lot: lotNum, address, price, url: href, imageUrl: imageUrl || undefined, bullets: bullets.slice(0, 8) });
    }

    // Strategy 2: If no property links found, look for repeated card-like elements
    if (lots.length === 0) {
      // Find the most common class pattern that appears 5+ times with £ prices
      const candidates = document.querySelectorAll('[class*="card"], [class*="lot"], [class*="property"], [class*="listing"], [class*="item"], [class*="auction"], article');
      for (const card of candidates) {
        const text = card.innerText || card.textContent || '';
        if (text.length < 30 || text.length > 5000) continue;
        const priceMatch = text.match(/£([\\d,]+)/);
        if (!priceMatch) continue;
        const price = parseInt(priceMatch[1].replace(/,/g, ''));
        if (price < 1000) continue; // Skip non-property prices
        
        let address = '';
        const heading = card.querySelector('h1, h2, h3, h4, h5, .title, .address, [class*="title"], [class*="address"]');
        if (heading) address = heading.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 10 && s.length < 150);
          if (lines.length) address = lines[0];
        }
        if (!address || address.length < 5) continue;
        
        const addrKey = address.toLowerCase().replace(/\\s+/g, ' ').substring(0, 60);
        if (seen.has(addrKey)) continue;
        seen.add(addrKey);
        
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bSALE.?AGREED\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        
        // Extract image from card
        let imageUrl = '';
        const junkImg2 = /\\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge|placeholder|no-image|1x1/i;
        const img2 = card.querySelector('img[src], img[data-src], img[data-lazy-src]');
        if (img2) {
          const imgSrc2 = img2.getAttribute('src') || img2.getAttribute('data-src') || img2.getAttribute('data-lazy-src') || '';
          if (imgSrc2 && imgSrc2.length > 10 && !imgSrc2.startsWith('data:') && !junkImg2.test(imgSrc2)) {
            imageUrl = imgSrc2;
          }
        }
        if (!imageUrl) {
          const bgEl2 = card.querySelector('[style*="background"]');
          if (bgEl2) {
            const bgMatch2 = (bgEl2.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
            if (bgMatch2 && bgMatch2[1] && !junkImg2.test(bgMatch2[1])) imageUrl = bgMatch2[1];
          }
        }

        lots.push({ lot: lotMatch ? parseInt(lotMatch[1]) : lots.length + 1, address, price, url, imageUrl: imageUrl || undefined, bullets: bullets.slice(0, 8) });
      }
    }

    return lots;
  })()
`;
