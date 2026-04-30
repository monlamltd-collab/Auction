// lib/rentals/onthemarket.js — Rental scraper for onthemarket.com.
//
// Strategy: don't parse listing cards. OnTheMarket inlines a
// `window.dataLayer.push({...})` GA payload at the top of every search
// results page that contains:
//   - property-prices: ["13,953", "3,200", ...]    parallel array
//   - property-ids:    ["18261533", "19303561", …]  to property-prices
//   - price-frequency: "pcm"                        confirms monthly
//   - location-postal-district + location-region    metadata
//
// One regex captures the JSON, JSON.parse handles the rest. No DOM
// scraping = no breakage on layout changes. Trade-off: we don't get
// per-listing beds / property type from this payload, only price + id.
// That's enough to compute postcode-level medians; type-aware comps
// would require a per-listing detail-page fetch (deferred).

import { HEADERS } from '../config.js';

const TIMEOUT_MS = 8000;

/**
 * Scrape rentals for a postcode.
 * @returns {Promise<{ listings: Array, areaLabel?: string }>}
 */
export async function scrapeOnTheMarket(postcode) {
  const slug = canonicalSlug(postcode);
  if (!slug) return { listings: [] };

  const url = `https://www.onthemarket.com/to-rent/property/${slug}/`;
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

  // Extract the dataLayer.push JSON. The site emits one push call per
  // page with a single object literal — match the first one greedily.
  const m = html.match(/window\.dataLayer\.push\((\{[\s\S]*?\})\);/);
  if (!m) return { listings: [] };

  let payload;
  try {
    payload = JSON.parse(m[1]);
  } catch {
    return { listings: [] };
  }

  const prices = Array.isArray(payload['property-prices']) ? payload['property-prices'] : [];
  const ids = Array.isArray(payload['property-ids']) ? payload['property-ids'] : [];
  const freq = payload['price-frequency'] || 'pcm';
  const areaLabel = payload['location-name'] || null;

  if (prices.length === 0 || ids.length === 0) return { listings: [], areaLabel };

  // Pair the parallel arrays. Skip mismatches defensively.
  const listings = [];
  const seen = new Set();
  const pairCount = Math.min(prices.length, ids.length);
  for (let i = 0; i < pairCount; i++) {
    const id = String(ids[i] || '').trim();
    if (!id || seen.has(id)) continue;  // OTM repeats the first id at the end
    seen.add(id);

    const rawPrice = String(prices[i] || '').replace(/[£,\s]/g, '');
    const rentNum = parseInt(rawPrice, 10);
    if (!Number.isFinite(rentNum) || rentNum <= 0) continue;

    const rentPcm = freq === 'pw' ? Math.round(rentNum * 52 / 12) : rentNum;
    listings.push({
      source_id: id,
      url: `https://www.onthemarket.com/details/${id}/`,
      rent_pcm: rentPcm,
      beds: null,
      property_type: null,
      is_room_share: false,
      area_label: areaLabel,
    });
  }

  return { listings, areaLabel };
}

// onthemarket.com expects URLs like /to-rent/property/sw1a-1aa/ —
// lower-case, single space converted to a hyphen.
function canonicalSlug(postcode) {
  if (!postcode || typeof postcode !== 'string') return null;
  const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}$/.test(cleaned)) return null;
  return cleaned.toLowerCase().replace(' ', '-');
}
