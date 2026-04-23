// lib/extractors/details/runner.js — DETAIL-page extraction runner
// Detail extractors are plain (document) => lot functions that run in JSDOM.
// Unlike catalogue extractors (which run in Puppeteer page context as IIFE
// strings), detail extractors only ever execute server-side, so they can be
// regular ES module exports — no string eval needed.

import { JSDOM } from 'jsdom';
import { log } from '../../logging.js';
import { DETAIL_EXTRACTORS } from './index.js';

const IMG_EXTENSIONS = /\.(jpe?g|png|webp)(\?.*)?$/i;
function isLikelyImage(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:')) return false;
  return IMG_EXTENSIONS.test(url) || /\/(image|images|media|uploads|cdn|gallery|photo)/i.test(url);
}

/**
 * Run a per-house detail extractor against a single lot page.
 * @param {string} html - raw HTML of the lot detail page
 * @param {string} house - house slug (e.g. 'maggsandallen')
 * @param {string} baseUrl - canonical URL of the page (for resolving relative links)
 * @returns {object|null} extracted fields, or null if no extractor / extractor failed
 */
export function extractLotDetail(html, house, baseUrl) {
  const extractor = DETAIL_EXTRACTORS[house];
  if (typeof extractor !== 'function') return null;

  let dom;
  try {
    dom = new JSDOM(html, { url: baseUrl });
  } catch (err) {
    log.warn('Detail JSDOM init failed', { house, error: err.message });
    return null;
  }
  const { document } = dom.window;

  let result = null;
  try {
    result = extractor(document);
  } catch (err) {
    log.warn('Detail extractor error', { house, error: err.message });
    dom.window.close();
    return null;
  }

  if (!result || typeof result !== 'object') {
    dom.window.close();
    return null;
  }

  // ── Normalise images ──
  const images = Array.isArray(result.images) ? result.images.filter(s => typeof s === 'string') : [];
  const absoluteImages = [];
  const seen = new Set();
  for (const src of images) {
    if (!src) continue;
    let abs = src;
    if (!/^https?:\/\//i.test(abs)) {
      try { abs = new URL(abs, baseUrl).href; } catch { continue; }
    }
    if (!isLikelyImage(abs) || seen.has(abs)) continue;
    seen.add(abs);
    absoluteImages.push(abs);
  }
  result.images = absoluteImages.slice(0, 8); // cap at 8 like catalogue carousel
  if (result.images.length > 0 && !result.imageUrl) result.imageUrl = result.images[0];

  // ── Trim string fields, drop empties ──
  for (const k of ['address', 'postcode', 'tenure', 'propType', 'condition', 'priceText']) {
    if (typeof result[k] === 'string') {
      result[k] = result[k].trim();
      if (!result[k]) delete result[k];
    }
  }
  if (Array.isArray(result.bullets)) {
    result.bullets = result.bullets.map(b => (typeof b === 'string' ? b.trim() : '')).filter(Boolean);
    if (result.bullets.length === 0) delete result.bullets;
  }
  if (Array.isArray(result.viewingDates)) {
    result.viewingDates = result.viewingDates.filter(Boolean);
    if (result.viewingDates.length === 0) delete result.viewingDates;
  }

  dom.window.close();
  return result;
}
