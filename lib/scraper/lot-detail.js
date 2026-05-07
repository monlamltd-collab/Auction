// ═══════════════════════════════════════════════════════════════
// lib/scraper/lot-detail.js — Per-lot detail-page enrichment.
// Owns lot_details cache + the unified lot-page enrichment pipeline
// honouring per-house EXTRACTION_PROFILE policies.
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { log } from '../logging.js';
import { HEADERS } from '../config.js';
import { supabase } from '../supabase.js';
import { getProfile } from '../houses.js';
import { extractLotDetail } from '../extractors/details/runner.js';
import { detectSourceStatus } from '../harness/sub-agents.js';
import { setField } from '../quality/field-source.js';
import { getBudget, getExtractPostcode } from './state.js';
import { scrapeWithFirecrawl } from './firecrawl.js';

const DETAIL_PRICE_MIN = 1000;
const DETAIL_PRICE_MAX = 50000000;
export function isPlausiblePrice(p) {
  return typeof p === 'number' && Number.isFinite(p) && p >= DETAIL_PRICE_MIN && p <= DETAIL_PRICE_MAX;
}

// Decode HTML entities that show up when capturing attribute values via raw
// regex on HTML source. Used by the image-URL extractor below — raw regex
// doesn't decode entities the way a DOM parser would, so a `src` attribute
// in the source like https://x.co/?a=1&amp;b=2 would be stored verbatim
// (with literal `&amp;`), and the browser would treat `amp;b` as a query
// param key when fetching it. Covers the ASCII subset that appears in
// real-world image URLs; numeric character references handled too.
export function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export async function getCachedLotDetail(url) {
  try {
    const { data, error } = await supabase
      .from('lot_details')
      .select('html, html_hash, extracted_data, source, fetched_at, expires_at')
      .eq('url', url)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export async function cacheLotDetail(url, house, html, extractedData, source) {
  try {
    const html_hash = createHash('sha256').update(html || '').digest('hex');
    await supabase.from('lot_details').upsert({
      url, house, html, html_hash,
      extracted_data: extractedData || null,
      source,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
    }, { onConflict: 'url' });
  } catch { /* never block on cache failure */ }
}

export async function fetchLotPage(url, opts = {}) {
  if (!opts.skipCache) {
    const cached = await getCachedLotDetail(url);
    if (cached && cached.html) {
      return { html: cached.html, url, source: 'cache', extractedData: cached.extracted_data };
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (resp.ok) {
      const html = await resp.text();
      const visibleText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (visibleText.length > 500) {
        const result = { html, url: resp.url || url, source: 'http' };
        if (opts.house) cacheLotDetail(url, opts.house, html, null, 'http');
        return result;
      }
    }
  } catch { /* timeout or network error */ }

  if (getBudget().canUseFirecrawl()) {
    try {
      const fcResult = await scrapeWithFirecrawl(url, { formats: ['rawHtml'] });
      if (fcResult.html && fcResult.html.length > 100) {
        const result = { html: fcResult.html, url: fcResult.sourceURL || url, source: 'firecrawl' };
        if (opts.house) cacheLotDetail(url, opts.house, fcResult.html, null, 'firecrawl');
        return result;
      }
    } catch { /* Firecrawl failed */ }
  }

  return null;
}

export async function enrichLotsFromLotPages(lots, opts = {}) {
  if (typeof opts === 'number') opts = { concurrency: opts };
  const concurrency = opts.concurrency || 5;

  const addrIsDescription = a => /^A\s+(one|two|three|four|five|six|\d+)\s+(bed|studio)/i.test(a);
  const isGapFillTarget = (l) => (
    !l.address || l.address.trim().length < 5
    || addrIsDescription(l.address || '')
    || !l.postcode
    || !l.imageUrl
    || !l.tenure
    || !l.condition
    || !l.beds
    || !l.price
    || l.vacant == null
    || !l.propType || l.propType === 'other' || l.propType === 'unknown'
    || (l.tenure === 'Leasehold' && !l.leaseLength)
  );

  const targets = [];
  const profileCounts = {};
  for (const l of lots) {
    if (!l.url || !/^https?:\/\//i.test(l.url)) continue;
    const profile = getProfile(l.house || opts.house);

    if (l._isFirstContact) {
      targets.push(l);
      continue;
    }

    if (profile.policy === 'never-deep') {
      if (isGapFillTarget(l)) targets.push(l);
      continue;
    }

    if (profile.policy === 'always-deep') {
      const cap = profile.maxPerCycle || Infinity;
      const used = profileCounts[l.house || opts.house || 'unknown'] || 0;
      if (used >= cap) continue;
      profileCounts[l.house || opts.house || 'unknown'] = used + 1;

      const overwrite = profile.overwriteFields || [];
      for (const field of overwrite) l[field] = null;

      targets.push(l);
      continue;
    }

    if (isGapFillTarget(l)) targets.push(l);
  }
  if (targets.length === 0) return 0;

  targets.sort((a, b) => (!a.beds ? 0 : 1) - (!b.beds ? 0 : 1));

  const junk = /logo|icon|nav|sprite|\.svg|placeholder|no-image|modal\.png|_NYC\.|_LCC\.|_BMDC\.|council|utilit|cardwell|badge|spacer|pixel|facebook|twitter|1x1|gavel|backdrop|generic[_-]?image|coming[_-]?soon/i;

  let fcUsed = 0;
  const stats = { address: 0, image: 0, tenure: 0, condition: 0, beds: 0, leaseLength: 0, propType: 0 };

  for (let i = 0; i < targets.length; i += concurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    const batch = targets.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(async (lot) => {
      try {
        const result = await fetchLotPage(lot.url, { house: lot.house });
        if (!result) return;
        if (result.source === 'firecrawl') fcUsed++;
        const html = result.html;

        try {
          const src = detectSourceStatus(html);
          if (src !== 'available' && (!lot.status || lot.status === 'available')) lot.status = src;
        } catch { /* non-fatal */ }

        try {
          const detail = extractLotDetail(html, lot.house, lot.url);
          if (detail) {
            if (detail.address && (!lot.address || lot.address.length < 5)) {
              setField(lot, 'address', detail.address, 'dom-detail');
              stats.address++;
            }
            if (detail.postcode && !lot.postcode) setField(lot, 'postcode', detail.postcode, 'dom-detail');
            if (Array.isArray(detail.images) && detail.images.length > 0) {
              if (!lot.imageUrl) {
                setField(lot, 'imageUrl', detail.imageUrl || detail.images[0], 'dom-detail');
                stats.image++;
              }
              if (!lot.images || lot.images.length < detail.images.length) lot.images = detail.images;
            }
            if (detail.tenure && !lot.tenure) { setField(lot, 'tenure', detail.tenure, 'dom-detail'); stats.tenure++; }
            if (detail.propType && (!lot.propType || lot.propType === 'other' || lot.propType === 'unknown')) {
              setField(lot, 'propType', detail.propType, 'dom-detail');
              stats.propType++;
            }
            if (detail.beds != null && !lot.beds) { setField(lot, 'beds', detail.beds, 'dom-detail'); stats.beds++; }
            if (detail.price && !lot.price && isPlausiblePrice(detail.price)) {
              setField(lot, 'price', detail.price, 'dom-detail');
            }
            if (detail.priceText && !lot.priceText) setField(lot, 'priceText', detail.priceText, 'dom-detail');
            if (detail.vacant != null && lot.vacant == null) setField(lot, 'vacant', detail.vacant, 'dom-detail');
            if (Array.isArray(detail.bullets) && detail.bullets.length > 0 && (!lot.bullets || lot.bullets.length === 0)) lot.bullets = detail.bullets;
            if (Array.isArray(detail.viewingDates) && detail.viewingDates.length > 0) lot.viewingDates = detail.viewingDates;
          }
        } catch (e) {
          // Per-house extractor failure is non-fatal
        }

        const text = html.replace(/<[^>]+>/g, ' ')
          .replace(/&#163;/g, '\u00A3').replace(/&pound;/g, '\u00A3')
          .replace(/&#8364;/g, '\u20AC').replace(/&euro;/g, '\u20AC')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ').toLowerCase();

        const addrLooksLikeDescription = lot.address && /^A\s+(one|two|three|four|five|six|\d+)\s+(bed|studio)/i.test(lot.address);
        if (!lot.address || lot.address.trim().length < 5 || addrLooksLikeDescription) {
          let address = '';
          const ogMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
                           html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
          if (ogMatch) address = ogMatch[1].trim();
          if (!address) {
            const h1Match = html.match(/<h1[^>]*>([^<]{10,})<\/h1>/i);
            if (h1Match) address = h1Match[1].trim();
          }
          if (!address) {
            const h2Match = html.match(/<h2[^>]*>([^<]{10,})<\/h2>/i);
            if (h2Match) address = h2Match[1].trim();
          }
          if (!address) {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) address = titleMatch[1].replace(/\s*[-|].*$/, '').trim();
          }
          if (address) {
            address = address.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
            address = address.replace(/^Lot\s+\d+\s*[-\u2013\u2014]\s*/i, '').trim();
          }
          if (address && address.length >= 5) { setField(lot, 'address', address, 'detail-page'); stats.address++; }
        }

        if (!lot.imageUrl) {
          const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;
          let m;
          while ((m = imgRe.exec(html)) !== null) {
            const src = m[1];
            if (!src || src.length <= 20 || src.startsWith('data:')) continue;
            // Decode HTML entities. Raw regex on HTML captures attribute
            // values verbatim, including ampersand-amp-semicolon sequences.
            // Bamboo whitelabels emit Next.js _next/image URLs whose query
            // separators are HTML-escaped; without decoding the stored URL
            // is broken (browser sends the entity, image 400s).
            let imgUrl = decodeHtmlEntities(src);
            if (!/^https?:\/\//i.test(imgUrl)) {
              try { imgUrl = new URL(imgUrl, result.url || lot.url).href; } catch { continue; }
            }
            if (junk.test(imgUrl)) continue;
            setField(lot, 'imageUrl', imgUrl, 'detail-page'); stats.image++;
            break;
          }
        }

        if (!lot.rawText) {
          const rawText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (rawText.length > 50) lot.rawText = rawText.slice(0, 10000);
        }

        if (!lot.tenure) {
          if (/share of freehold|share\s+of\s+the\s+freehold/.test(text)) { setField(lot, 'tenure', 'Share of Freehold', 'detail-page'); stats.tenure++; }
          else if (/flying freehold/.test(text)) { setField(lot, 'tenure', 'Freehold', 'detail-page'); stats.tenure++; }
          else if (/\bfreehold\b/.test(text) && !/leasehold/.test(text)) { setField(lot, 'tenure', 'Freehold', 'detail-page'); stats.tenure++; }
          else if (/\bleasehold\b|long\s+lease|lease\s+remaining|\byears?\s+(?:remaining|unexpired|left)\b|\b\d+\s*(?:year|yr)\s*lease\b/.test(text)) { setField(lot, 'tenure', 'Leasehold', 'detail-page'); stats.tenure++; }
          if (lot.tenure === 'Freehold' && lot.propType === 'house' && !(lot.opps || []).includes('Freehold') && !(lot.scoreBreakdown || []).some(s => s.signal === 'Freehold house')) {
            lot.score = (lot.score || 0) + 0.5;
            lot.opps = lot.opps || []; lot.opps.push('Freehold');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Freehold house', pts: 0.5 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          }
        }

        if (lot.tenure === 'Leasehold' && !lot.leaseLength) {
          const leaseMatch = text.match(/\b(\d{2,4})\s*(?:year|yr)s?\s*(?:remaining|unexpired|left|lease)\b/) ||
                             text.match(/lease\s*(?:length|term|remaining)?\s*:?\s*(\d{2,4})\s*(?:year|yr)s?\b/) ||
                             text.match(/\b(\d{2,4})\s*(?:year|yr)\s*lease\b/) ||
                             text.match(/(?:approx(?:imately)?|circa|c\.?)\s*(\d{2,4})\s*(?:year|yr)s?\s*(?:remaining|unexpired|left)?\b/) ||
                             text.match(/(?:term|length)\s*(?:of)?\s*(\d{2,4})\s*(?:year|yr)s?\b/) ||
                             text.match(/(\d{2,4})\s*(?:year|yr)s?\s*(?:from|commencing|starting)\s*\d{4}/);
          if (leaseMatch) {
            const years = parseInt(leaseMatch[1], 10);
            if (years >= 1 && years <= 999) { setField(lot, 'leaseLength', years, 'detail-page'); stats.leaseLength++; }
          }
          if (!lot.leaseLength) {
            const fromMatch = text.match(/(\d{2,4})\s*(?:year|yr)s?\s*(?:from|commencing|starting|dated)\s*(\d{4})/);
            if (fromMatch) {
              const total = parseInt(fromMatch[1], 10);
              const startYear = parseInt(fromMatch[2], 10);
              const remaining = total - (new Date().getFullYear() - startYear);
              if (remaining >= 1 && remaining <= 999) { setField(lot, 'leaseLength', remaining, 'detail-page'); stats.leaseLength++; }
            }
          }
        }

        if (!lot.condition) {
          if (/\b(?:derelict|uninhabitable|severe(?:ly)?\s+dilapidated|structurally?\s+(?:unsound|unsafe)|condemned)\b/.test(text)) {
            setField(lot, 'condition', 'derelict', 'detail-page'); stats.condition++;
          } else if (/\b(?:poor\s+condition|very\s+poor|badly?\s+(?:damaged|deteriorated)|significant(?:ly)?\s+(?:dated|tired)|extensive\s+(?:refurb|renovation|works?\s+required))\b/.test(text)) {
            setField(lot, 'condition', 'poor', 'detail-page'); stats.condition++;
          } else if (/\b(?:need(?:s|ing)\s+(?:modernis|refurb|renovation|updating|improvement)|in\s+need\s+of\s+(?:modernis|refurb|renovation)|(?:requires?|requiring)\s+(?:modernis|refurb|renovation|updating)|(?:tired|dated|worn)\s+(?:condition|decor|throughout))\b/.test(text)) {
            setField(lot, 'condition', 'needs modernisation', 'detail-page'); stats.condition++;
          } else if (/\b(?:good\s+(?:condition|order|decorative)|well\s+(?:maintained|presented|kept)|recently\s+(?:refurb|renovated|decorated|updated))\b/.test(text)) {
            setField(lot, 'condition', 'good', 'detail-page'); stats.condition++;
          }
          if (lot.condition === 'needs modernisation' && !(lot.opps || []).includes('Needs modernisation') && !(lot.scoreBreakdown || []).some(s => s.signal === 'Needs modernisation')) {
            lot.score = (lot.score || 0) + 2.0;
            lot.opps = lot.opps || []; lot.opps.push('Needs modernisation');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Needs modernisation', pts: 2.0 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          } else if ((lot.condition === 'poor' || lot.condition === 'derelict') && !(lot.opps || []).includes('Poor condition') && !(lot.scoreBreakdown || []).some(s => /Poor.*condition/i.test(s.signal))) {
            lot.score = (lot.score || 0) + 2.5;
            lot.opps = lot.opps || []; lot.opps.push('Poor condition');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Poor/derelict condition', pts: 2.5 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          }
        }

        if (!lot.beds) {
          const variantMatch = text.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*[-\s]?bed/i);
          const standardMatch = text.match(/\b(\d{1,2})\s*(?:[-\s])?(?:bed(?:room)?s?|double\s+bed(?:room)?s?)\b/i);
          const studioMatch = /\bstudio\s*(?:flat|apartment)?\b/i.test(text);
          if (variantMatch) {
            const n = Math.max(parseInt(variantMatch[1], 10), parseInt(variantMatch[2], 10));
            if (n >= 1 && n <= 20) { setField(lot, 'beds', n, 'detail-page'); stats.beds++; }
          } else if (standardMatch) {
            const n = parseInt(standardMatch[1], 10);
            if (n >= 1 && n <= 20) { setField(lot, 'beds', n, 'detail-page'); stats.beds++; }
          } else if (studioMatch) {
            setField(lot, 'beds', 0, 'detail-page'); stats.beds++;
          }
        }

        if (!lot.propType || lot.propType === 'other' || lot.propType === 'unknown') {
          if (/\b(?:flat|apartment|maisonette|studio\s+flat|penthouse)\b/.test(text)) { setField(lot, 'propType', 'flat', 'detail-page'); stats.propType++; }
          else if (/\b(?:terraced|semi[- ]detached|detached\s+house|end[- ]terrace|mid[- ]terrace|town\s*house|cottage|villa|lodge)\b/.test(text)) { setField(lot, 'propType', 'house', 'detail-page'); stats.propType++; }
          else if (/\bbungalow\b/.test(text)) { setField(lot, 'propType', 'house', 'detail-page'); stats.propType++; }
          else if (/\b(?:land|plot|garage|parking\s+space|storage\s+unit)\b/.test(text)) { setField(lot, 'propType', 'land', 'detail-page'); stats.propType++; }
          else if (/\b(?:shop|retail|office|warehouse|industrial|commercial|pub|hotel|restaurant)\b/.test(text)) { setField(lot, 'propType', 'commercial', 'detail-page'); stats.propType++; }
        }

        if (!lot.price) {
          const priceMatch = text.match(/(?:guide\s*price|starting\s*bid|reserve\s*price|price|asking)[^\u00A3]*\u00A3([\d,]+)/i)
            || text.match(/\u00A3([\d,]+)\s*(?:guide|starting|reserve|plus)/i);
          if (priceMatch) {
            const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            if (isPlausiblePrice(p)) {
              setField(lot, 'price', p, 'detail-page');
              if (!stats.price) stats.price = 0;
              stats.price++;
            }
          }
        }

        if (lot.vacant == null) {
          if (/\b(?:vacant\s+possession|sold\s+with\s+vacant|\bvp\b|vacant\s+property|with\s+vacant|currently\s+vacant|unoccupied)\b/.test(text)) {
            setField(lot, 'vacant', true, 'detail-page');
            if (!stats.vacant) stats.vacant = 0; stats.vacant++;
          } else if (/\b(?:(?:currently\s+)?(?:let|tenanted|rented|occupied)|tenant\s+in\s+situ|subject\s+to\s+tenanc|assured\s+shorthold|sitting\s+tenant|(?:rental|current)\s+income)\b/.test(text)) {
            setField(lot, 'vacant', false, 'detail-page');
            if (!stats.vacant) stats.vacant = 0; stats.vacant++;
          }
        }

        if (!lot.postcode && lot.address && getExtractPostcode()) {
          const pc = getExtractPostcode()(lot.address);
          if (pc) setField(lot, 'postcode', pc, 'detail-page');
        }

      } catch { /* timeout or network error -- skip */ }
    }));
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total > 0) {
    const parts = Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(' ');
    const bedCoverage = lots.filter(l => l.beds != null).length;
    console.log(`Lot-page enrichment: ${targets.length} pages fetched, ${total} fields filled -- ${parts}${fcUsed > 0 ? ` (${fcUsed} via Firecrawl)` : ''} | beds coverage: ${bedCoverage}/${lots.length} (${Math.round(bedCoverage/lots.length*100)}%)`);
  }
  return total;
}
