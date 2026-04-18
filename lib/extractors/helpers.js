// lib/extractors/helpers.js — Image extraction helpers (embedded as string in DOM extractors)
// Provides getBestImgSrc(img) for lazy-load fallback chain and
// upgradeThumbnailUrl(url) for full-size image resolution.
// isJunkImage(url) filters out non-property images.
export const IMG_HELPERS = `
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
