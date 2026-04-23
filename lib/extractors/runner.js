// lib/extractors/runner.js — DOM extraction runner (extractWithJSDOM) & state management
// NOTE: new Function() usage is intentional — DOM extractors are template literal strings
// that run in a sandboxed JSDOM context. This is the established pattern from the original
// extractors.js and is safe because extractors are defined in our own source code, not user input.
import { JSDOM } from 'jsdom';
import { log } from '../logging.js';
import { IMG_HELPERS } from './helpers.js';
import { DOM_EXTRACTORS } from './index.js';
import { UNIVERSAL_DOM_EXTRACTOR } from './universal.js';

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
      // eslint-disable-next-line no-new-func -- extractors are trusted source-code strings, not user input
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
      // eslint-disable-next-line no-new-func -- universal extractor is a trusted source-code string
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
      const skipFc = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|favicon|banner|advert/i;
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
  const imgBlocklist = /logo|icon|placeholder|no-image|default|blank|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|noimage|favicon|banner|advert|sponsor|newsletter|widget|thumb_generic|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\.|watchLIVEauction|property-top-image|auc2-logo|gavel|backdrop|generic[_-]?image|auction[_-]?house[_-]?(?:logo|image)|coming[_-]?soon/i;
  const imgDomainBlock = /flannels|kirklees|rdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|analytics|hotjar|intercom|crisp\.chat|tawk\.to|zendesk|hubspot|mailchimp|sendgrid/i;
  // Note: house-specific resize-only filtering for Maggs/Hollis was removed in
  // the detail-extraction refactor — DETAIL_EXTRACTORS now provide correct
  // images directly from each lot's detail page, so the blunt catalogue-side
  // workaround is no longer needed.
  for (const lot of lots) {
    if (!lot.imageUrl) continue;
    if (imgBlocklist.test(lot.imageUrl) || imgDomainBlock.test(lot.imageUrl)) {
      lot.imageUrl = '';
    }
  }

  // Second-chance image recovery — for lots still missing images after junk stripping,
  // walk the DOM to find their card container and extract background-image or <img>.
  // This catches sites that use CSS background-image slideshows (Cycle2, Flickity, etc.)
  // regardless of whether the per-house extractor handled them.
  const imgRecoverSkip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|favicon|banner|btn|gallery-left|gallery-right/i;
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
  const imgCarouselSkip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|favicon|banner|btn|gallery-left|gallery-right|advert|1x1|noimage|placeholder|gavel|backdrop/i;
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
  // ═══════════════════════════════════════════════════════════════

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
