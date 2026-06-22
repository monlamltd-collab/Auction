// ═══════════════════════════════════════════════════════════════
// lib/scraper/pagination.js — Page count detection, per-house URL
// builders, and the multi-page plain-HTTP scrape loop.
//
// scrapeAllPages is the plain-HTTP path; the Firecrawl path lives in
// firecrawl.js (scrapePageWithFirecrawl) and shares this module's
// detectTotalPages + buildPageUrl helpers.
// ═══════════════════════════════════════════════════════════════

import { MAX_PAGES } from '../config.js';
import { fetchPage } from './http.js';

export async function scrapeAllPages(baseUrl, house) {
  const pages = [];
  const html1 = await fetchPage(baseUrl);
  pages.push({ page: 1, html: html1 });
  const totalPages = detectTotalPages(html1, baseUrl, house);
  const pageCap = Math.min(totalPages, MAX_PAGES);
  for (let pg = 2; pg <= pageCap; pg++) {
    const pageUrl = buildPageUrl(baseUrl, pg, house);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length > 1000) { pages.push({ page: pg, html }); }
      else { break; }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { break; }
  }
  if (totalPages > MAX_PAGES) console.log(`${house} pagination cap reached at ${MAX_PAGES} pages`);
  return pages;
}

export function detectTotalPages(html, url, house) {
  const pageMatches = [...html.matchAll(/page[=-](\d+)/gi)];
  if (pageMatches.length > 0) return Math.max(...pageMatches.map(m => parseInt(m[1])));
  const ofMatch = html.match(/page\s+\d+\s+of\s+(\d+)/i);
  if (ofMatch) return parseInt(ofMatch[1]);
  const numMatches = [...html.matchAll(/<a[^>]*>\s*(\d{1,3})\s*<\/a>/g)];
  const nums = numMatches.map(m => parseInt(m[1])).filter(n => n >= 2 && n <= 100);
  if (nums.length) return Math.max(...nums);
  return 1;
}

export function buildPageUrl(baseUrl, page, house) {
  const clean = baseUrl.replace(/\/page[-=]\d+/i, '').replace(/[?&]page=\d+/i, '');
  switch (house) {
    case 'savills': return `${clean}/page-${page}`;
    case 'allsop': return `${clean}?page=${page}`;
    case 'btgeddisons': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'pugh': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'network': return `${clean}?page=${page}`;
    case 'bondwolfe': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'barnardmarcus': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'acuitus': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    // New houses (pagination)
    case 'agentsproperty': return `${clean.replace(/\/page\/\d+\/?/, '')}/page/${page}/`;
    case 'suttonkersh': {
      const skClean = clean.replace(/[?&]start=\d+/i, '');
      const offset = (page - 1) * 16;
      return skClean.includes('?') ? `${skClean}&start=${offset}` : `${skClean}?start=${offset}`;
    }
    case 'buttersjohnbee': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'brownco': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'purplebricksgoto': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'iamsold': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'andrewcraig': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    default:
      if (baseUrl.includes('/page-')) return `${clean}/page-${page}`;
      return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
  }
}
