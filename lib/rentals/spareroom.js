// lib/rentals/spareroom.js — Rental scraper for spareroom.co.uk.
//
// Strategy: parse listing-card elements via JSDOM. SpareRoom is mostly
// room-share / HMO oriented, so most listings are per-room. We capture
// the per-room rent with is_room_share=true, plus the (often range) price,
// the bed count from the "X doubles" / "X singles" pattern, and the
// property_type ('room' for shares, 'studio' / 'flat' for whole units).
//
// HTML shape (verified live 2026-04-30):
//   <article class="listing-card listing-card--{featured|bold|...}">
//     <a class="listing-card__link" href="/flatshare/flatshare_detail.pl?flatshare_id=N&...">
//     <h2 class="listing-card__title">...</h2>
//     <p class="listing-card__location">Long Eaton (NG10)</p>
//     <p class="listing-card__price">£615 - £750 pcm</p>
//     <span class="listing-card__room offered">5 doubles</span>

import { JSDOM } from 'jsdom';
import { HEADERS } from '../config.js';

const TIMEOUT_MS = 8000;

export async function scrapeSpareRoom(postcode) {
  const url = buildSearchUrl(postcode);
  if (!url) return { listings: [] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    if (!resp.ok) return { listings: [] };
    html = await resp.text();
  } finally {
    clearTimeout(timer);
  }

  const dom = new JSDOM(html);
  const cards = dom.window.document.querySelectorAll('article.listing-card');
  const listings = [];
  const seen = new Set();

  for (const card of cards) {
    const linkEl = card.querySelector('a.listing-card__link');
    if (!linkEl) continue;
    const href = linkEl.getAttribute('href') || '';
    const idMatch = href.match(/flatshare_id=(\d+)/);
    if (!idMatch) continue;
    const sourceId = idMatch[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    const detailUrl = href.startsWith('http') ? href : `https://www.spareroom.co.uk${href}`;

    const priceText = (card.querySelector('.listing-card__price')?.textContent || '').trim();
    const rentPcm = parseRent(priceText);
    if (!rentPcm) continue; // No price = useless for comps

    const roomText = (card.querySelector('.listing-card__room')?.textContent || '').trim();
    const beds = parseBeds(roomText);
    const isRoom = /\b(double|single|ensuite|room)/i.test(roomText)
                || /room/i.test(linkEl.getAttribute('title') || '');

    const propertyType = detectPropertyType(roomText, linkEl.getAttribute('title') || '');
    const areaLabel = (card.querySelector('.listing-card__location')?.textContent || '').trim() || null;

    listings.push({
      source_id: sourceId,
      url: detailUrl,
      rent_pcm: rentPcm,
      beds,
      property_type: propertyType,
      is_room_share: isRoom,
      area_label: areaLabel,
    });
  }

  return { listings };
}

function buildSearchUrl(postcode) {
  if (!postcode || typeof postcode !== 'string') return null;
  const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}$/.test(cleaned)) return null;
  // SpareRoom search expects + in place of space, plus action=search.
  const q = encodeURIComponent(cleaned).replace(/%20/g, '+');
  return `https://www.spareroom.co.uk/flatshare/index.cgi?search=${q}&action=search`;
}

// SpareRoom shows ranges ("£615 - £750 pcm"), single values ("£900 pcm"),
// and weekly variants ("£200 pw"). We take the lower bound of a range —
// it's the conservative comp value. Convert pw → pcm via × 52 / 12.
function parseRent(text) {
  if (!text) return null;
  const t = text.replace(/&pound;|&#163;/gi, '£');
  const matches = [...t.matchAll(/£\s*([0-9,]+)/g)].map(m => parseInt(m[1].replace(/,/g, ''), 10));
  if (matches.length === 0) return null;
  const lower = Math.min(...matches.filter(n => Number.isFinite(n) && n > 0));
  if (!Number.isFinite(lower) || lower <= 0) return null;
  if (/\bpw\b/i.test(t)) return Math.round(lower * 52 / 12);
  return lower;
}

// "5 doubles", "1 single", "2 doubles & 1 single" → numeric bed count.
// For room shares, this is the bed count *of the property*, not the
// listing. The listing itself is ONE room. We expose it because
// downstream consumers may want to know whether a listing is a small
// share or a large HMO.
function parseBeds(text) {
  if (!text) return null;
  let total = 0;
  for (const m of text.matchAll(/(\d+)\s*(double|single|twin|ensuite|bedroom|bed)/gi)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0 && n < 30) total += n;
  }
  return total > 0 ? total : null;
}

function detectPropertyType(roomText, title) {
  const t = `${roomText} ${title}`.toLowerCase();
  if (/studio/.test(t)) return 'studio';
  if (/whole flat|whole property|entire flat/.test(t)) return 'flat';
  if (/whole house/.test(t)) return 'house';
  if (/double|single|ensuite|room/.test(t)) return 'room';
  return null;
}
