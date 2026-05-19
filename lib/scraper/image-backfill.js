// lib/scraper/image-backfill.js — image coverage rescue passes.
// Three entry points escalating in cost: HTTP regex, Firecrawl rendered,
// per-lot detail-page fetch. All mutate `lots` in place and return a
// count (the HTTP variant returns lots/null).
//
// The fourth entry point (Puppeteer last-resort) was retired 2026-05-08
// alongside the DOM-extractor system it depended on. Firecrawl-rendered
// + per-lot detail-page fetch cover the same recall ground.

import { JSDOM } from 'jsdom';
import { log } from '../logging.js';
import { scrapeRenderedPage } from './rendering.js';
import { fetchLotPage } from './lot-detail.js';
import { detectSourceStatus } from '../harness/sub-agents.js';
import { unwrapProxyImageUrl } from './validation.js';

export async function backfillImagesWithFirecrawl(catalogueUrl, lots, house) {
  try {
    // Action budget: Firecrawl bills each action + wait as additional credits
    // on top of the base scrape, so the prior 15-action loop (4 scroll-down
    // cycles + 4 scroll-up cycles + 1 JS exec) was costing ~5–8 credits per
    // call. The shorter sequence below covers the same recall on lazy-loaded
    // image galleries: one settle scroll, one JS pass to materialise
    // data-src/data-lazy-src into src, one final wait so the rewritten srcs
    // resolve before Firecrawl serialises. Upward scrolls were never needed
    // (post-scroll DOM already contains every img URL that fired).
    const result = await scrapeRenderedPage(catalogueUrl, house, {
      actions: [
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'executeJavascript', script: `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });` },
        { type: 'wait', milliseconds: 1000 },
      ],
    });
    if (!result.html) return 0;

    const dom = new JSDOM(result.html, { url: catalogueUrl });
    const { document } = dom.window;

    const skip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji/i;
    const hrefImageMap = {};
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      const rawHref = link.getAttribute('href') || '';
      let absHref;
      try { absHref = new URL(rawHref, catalogueUrl).href; } catch { absHref = rawHref; }
      if (!rawHref || rawHref === '#') continue;
      if (hrefImageMap[rawHref] || hrefImageMap[absHref]) continue;

      let imgSrc = '';
      let img = link.querySelector('img');
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
      if (!imgSrc || imgSrc.startsWith('data:') || imgSrc.length < 10 || skip.test(imgSrc)) continue;
      hrefImageMap[rawHref] = imgSrc;
      hrefImageMap[absHref] = imgSrc;
    }

    let updated = 0;
    for (const lot of lots) {
      if (lot.imageUrl) continue;
      const imgSrc = hrefImageMap[lot.url];
      if (imgSrc) {
        let imgUrl = imgSrc;
        if (!/^https?:\/\//i.test(imgUrl)) {
          try { imgUrl = new URL(imgUrl, catalogueUrl).href; } catch {}
        }
        lot.imageUrl = unwrapProxyImageUrl(imgUrl);
        updated++;
      }
    }

    const allPageImages = [];
    const allImgs = document.querySelectorAll('img[src], img[data-src]');
    const skipFc = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|favicon|banner|advert/i;
    for (const img of allImgs) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src && src.length > 20 && !src.startsWith('data:') && !skipFc.test(src)) {
        let abs = src;
        if (!/^https?:\/\//i.test(abs)) { try { abs = new URL(abs, catalogueUrl).href; } catch { continue; } }
        allPageImages.push(unwrapProxyImageUrl(abs));
      }
    }
    if (result.images && result.images.length > 0) {
      for (const img of result.images) {
        if (img && img.length > 20 && /^https?:\/\//i.test(img) && !skipFc.test(img)) allPageImages.push(unwrapProxyImageUrl(img));
      }
    }
    const uniquePageImages = [...new Set(allPageImages)];
    if (uniquePageImages.length > 0) {
      const usedImgs = new Set(lots.filter(l => l.imageUrl).map(l => l.imageUrl));
      const available = uniquePageImages.filter(i => !usedImgs.has(i));
      for (const lot of lots) {
        if (lot.imageUrl) continue;
        const lotNum = String(lot.lot || lot.lotNumber || '').replace(/\D/g, '');
        if (lotNum) {
          const match = available.find(img => !usedImgs.has(img) && (
            img.includes(`/${lotNum}/`) || img.includes(`/${lotNum}.`) || img.includes(`-${lotNum}.`)
            || img.includes(`_${lotNum}.`) || img.includes(`lot${lotNum}`)
          ));
          if (match) { lot.imageUrl = match; usedImgs.add(match); updated++; }
        }
      }
      const stillMissing = lots.filter(l => !l.imageUrl);
      const unusedImgs = available.filter(i => !usedImgs.has(i));
      if (stillMissing.length > 0 && unusedImgs.length >= stillMissing.length * 0.3) {
        let idx = 0;
        for (const lot of stillMissing) {
          if (idx >= unusedImgs.length) break;
          lot.imageUrl = unusedImgs[idx++];
          updated++;
        }
      }
    }
    if (lots.length >= 3) {
      const imgCounts = {};
      for (const lot of lots) {
        if (lot.imageUrl) imgCounts[lot.imageUrl] = (imgCounts[lot.imageUrl] || 0) + 1;
      }
      for (const [img, count] of Object.entries(imgCounts)) {
        if (count > lots.length * 0.5) {
          console.log(`[IMG-BACKFILL] ${house}: stripped duplicate image on ${count}/${lots.length} lots: ${img.substring(0, 80)}`);
          for (const lot of lots) {
            if (lot.imageUrl === img) { lot.imageUrl = null; updated--; }
          }
        }
      }
      if (updated < 0) updated = 0;
    }
    dom.window.close();
    console.log(`Firecrawl image backfill for ${house}: ${updated}/${lots.length} lots got images`);
    return updated;
  } catch (err) {
    log.warn('Firecrawl image backfill error', { house, catalogueUrl, error: err.message });
    return 0;
  }
}

export async function backfillImages(catalogueUrl, lots) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(catalogueUrl, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    const resolvedBase = resp.url || catalogueUrl;

    for (const lot of lots) {
      if (lot.url && !/^https?:\/\//i.test(lot.url)) {
        try { lot.url = new URL(lot.url, resolvedBase).href; } catch {}
      }
    }

    const resolveImg = (src) => {
      if (!src || src.startsWith('data:') || src.length < 10
        || /\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge/i.test(src)) return null;
      const abs = /^https?:\/\//i.test(src) ? src : (() => { try { return new URL(src, resolvedBase).href; } catch { return null; } })();
      if (!abs) return null;
      return unwrapProxyImageUrl(abs);
    };

    const hrefImgMap = {};
    const linkImgRe = /<a[^>]+href="([^"]+)"[^>]*>[^]*?<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    let m;
    while ((m = linkImgRe.exec(html)) !== null) {
      const href = m[1];
      const src = resolveImg(m[2]);
      if (src && !hrefImgMap[href]) hrefImgMap[href] = src;
    }
    const linkBgRe = /<a[^>]+href="([^"]+)"[^>]*>[^]*?background(?:-image)?:\s*url\(['"]?([^'")\s]+)/gi;
    while ((m = linkBgRe.exec(html)) !== null) {
      const href = m[1];
      const src = resolveImg(m[2]);
      if (src && !hrefImgMap[href]) hrefImgMap[href] = src;
    }

    const allImages = [];
    const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    while ((m = imgRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) allImages.push(src);
    }
    const bgRe = /background(?:-image)?:\s*url\(['"]?([^'")\s]+)/gi;
    while ((m = bgRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) allImages.push(src);
    }
    const srcsetRe = /srcset="([^"]+)"/gi;
    while ((m = srcsetRe.exec(html)) !== null) {
      const first = m[1].split(',')[0].trim().split(/\s+/)[0];
      const src = resolveImg(first);
      if (src) allImages.push(src);
    }

    const imgPositions = [];
    const imgPosRe = /<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    while ((m = imgPosRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) imgPositions.push({ pos: m.index, src });
    }

    let updated = 0;
    for (const lot of lots) {
      if (lot.imageUrl) continue;
      if (!lot.url) continue;
      let imgSrc = null;

      const urlVariants = [lot.url];
      try { urlVariants.push(new URL(lot.url).pathname); } catch {}
      if (lot.url.startsWith('http://')) urlVariants.push(lot.url.replace('http://', 'https://'));
      else if (lot.url.startsWith('https://')) urlVariants.push(lot.url.replace('https://', 'http://'));
      for (const v of urlVariants) {
        if (hrefImgMap[v]) { imgSrc = hrefImgMap[v]; break; }
      }

      if (!imgSrc) {
        try {
          const path = new URL(lot.url).pathname;
          const ids = path.match(/\d{4,}/g) || [];
          for (const id of ids) {
            imgSrc = allImages.find(src => src.includes('/' + id + '/') || src.includes('/' + id + '.') || src.includes('-' + id + '.') || src.includes('/' + id + '_'));
            if (imgSrc) break;
          }
        } catch {}
      }

      if (!imgSrc) {
        for (const v of urlVariants) {
          const pos = html.indexOf(v);
          if (pos === -1) continue;
          let best = null, bestDist = 2000;
          for (const ip of imgPositions) {
            const dist = Math.abs(ip.pos - pos);
            if (dist < bestDist) { bestDist = dist; best = ip.src; }
          }
          if (best) { imgSrc = best; break; }
        }
      }

      if (imgSrc) {
        lot.imageUrl = imgSrc;
        updated++;
      }
    }
    const urlLessLots = lots.filter(l => !l.imageUrl && !l.url);
    if (urlLessLots.length > 0 && allImages.length > 0) {
      const seen = new Set();
      const uniqueImages = allImages.filter(img => { if (seen.has(img)) return false; seen.add(img); return true; });
      if (uniqueImages.length >= urlLessLots.length * 0.3) {
        let posMatched = 0;
        for (let i = 0; i < urlLessLots.length && i < uniqueImages.length; i++) {
          urlLessLots[i].imageUrl = uniqueImages[i];
          posMatched++;
        }
        updated += posMatched;
        if (posMatched > 0) console.log(`Image backfill position-match for URL-less lots: ${posMatched}/${urlLessLots.length}`);
      }
    }

    console.log(`Image backfill for ${catalogueUrl.substring(0, 60)}: ${updated}/${lots.filter(l => !l.imageUrl).length + updated} matched`);
    return updated > 0 ? lots : null;
  } catch (err) {
    log.warn('Image backfill error', { catalogueUrl, error: err.message });
    return null;
  }
}

export async function backfillImagesFromLotPages(lots, concurrency = 5) {
  const missing = lots.filter(l => l.url && !l.imageUrl && /^https?:\/\//i.test(l.url));
  if (missing.length === 0) return 0;
  const capped = missing.slice(0, 50);
  const junk = /logo|icon|nav|sprite|\.svg|placeholder|no-image|modal\.png|_NYC\.|_LCC\.|_BMDC\.|council|utilit|cardwell|badge|spacer|pixel|facebook|twitter|1x1|gavel|backdrop|generic[_-]?image|coming[_-]?soon/i;
  let filled = 0, fcUsed = 0;
  for (let i = 0; i < capped.length; i += concurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    const batch = capped.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(async (lot) => {
      try {
        const result = await fetchLotPage(lot.url, { house: lot.house });
        if (!result) return;
        if (result.source === 'firecrawl') fcUsed++;
        try {
          const src = detectSourceStatus(result.html);
          if (src !== 'available' && (!lot.status || lot.status === 'available')) lot.status = src;
        } catch { /* non-fatal */ }
        const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;
        let m;
        while ((m = imgRe.exec(result.html)) !== null) {
          const src = m[1];
          if (!src || src.length <= 20 || src.startsWith('data:')) continue;
          let imgUrl = src;
          if (!/^https?:\/\//i.test(imgUrl)) {
            try { imgUrl = new URL(imgUrl, result.url || lot.url).href; } catch { continue; }
          }
          if (junk.test(imgUrl)) continue;
          lot.imageUrl = unwrapProxyImageUrl(imgUrl); filled++;
          break;
        }
      } catch { /* skip */ }
    }));
  }
  if (filled > 0) console.log(`Image backfill (lot pages): ${filled}/${missing.length}${fcUsed > 0 ? ` (${fcUsed} via Firecrawl)` : ''}`);
  return filled;
}

// backfillImagesWithPuppeteer was retired 2026-05-08 with the
// DOM-extractor system. The remaining backfill chain
// (Firecrawl rendered → per-lot detail-page fetch) covers the same recall
// ground. Callers still passing this function as a dep are no-ops; it
// will be removed entirely from the dependency-injection surface in a
// follow-up commit.
export async function backfillImagesWithPuppeteer() {
  return 0;
}
