// ═══════════════════════════════════════════════════════════════
// lib/scraper/allsop.js — Allsop-specific JSON API branch.
//
// Allsop exposes a JSON catalogue endpoint that bypasses Gemini
// extraction entirely. scrapeAllsopApi paginates the endpoint,
// extractAllsopLotsFromJson parses raw items into lot objects, and
// enrichAllsopLots back-fills reference/image data on lots that came
// in through the catalogue HTML path.
// ═══════════════════════════════════════════════════════════════

import { MAX_PAGES } from '../config.js';
import { setLastExtractorUsed } from '../extractors/index.js';
import { fetchPage } from './http.js';

export async function scrapeAllsopApi(baseUrl) {
  const pages = [];
  for (let pg = 1; pg <= MAX_PAGES; pg++) {
    const pageUrl = baseUrl.replace(/page=\d+/, `page=${pg}`);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length < 100 || html.includes('"data":[]') || html.includes('"template":"404"')) {
        console.log(`Allsop API: page ${pg} empty, stopping`);
        break;
      }
      pages.push({ page: pg, html });
      console.log(`Allsop API: got ${html.length} chars from page ${pg}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`Allsop API: page ${pg} failed: ${e.message}`);
      break;
    }
  }
  return pages;
}

// Parse Allsop JSON API pages directly into lot objects (bypasses Gemini entirely)
export function extractAllsopLotsFromJson(pages) {
  setLastExtractorUsed('api');
  const lots = [];
  const seen = new Set();
  for (const p of pages) {
    try {
      const json = JSON.parse(p.html);
      const results = json?.data?.results || json?.results || [];
      for (const item of results) {
        const ref = item.reference || '';
        if (seen.has(ref) && ref) continue;
        if (ref) seen.add(ref);

        // Address — allsop_address is most complete, fall back to address1+postcode
        const address = (item.allsop_address ||
          [item.address1, item.address2, item.address3, item.county, item.postcode].filter(Boolean).join(', ')
        ).trim();
        if (!address || address.length < 3) continue;

        // Lot number — API doesn't provide lot numbers, use positional
        const lotNum = lots.length + 1;

        // Price — numeric string like "19117000.00" or null
        let price = null;
        const priceText = item.price || item.price_description || '';
        const pm = String(priceText).replace(/,/g, '').match(/(\d+)/);
        if (pm) price = parseInt(pm[1]);

        // URL — construct from reference
        const slug = (address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')).substring(0, 60);
        const url = ref ? `https://www.allsop.co.uk/lot-overview/${slug}/${ref}`
                       : `https://www.allsop.co.uk/find-a-property/`;

        // Image — S3 bucket pattern
        let imageUrl = '';
        const imgId = item.image_file_id;
        if (imgId) {
          imageUrl = `https://as-prod-bau-object-storage.s3.eu-west-2.amazonaws.com/image_cache/${imgId}---auto--.jpg`;
        }

        // Bullets — property types, status, byline
        const bullets = [];
        if (item.property_types && item.property_types.length > 0) {
          bullets.push(item.property_types.join(', '));
        }
        if (item.sales_status && item.sales_status !== 'For Sale') {
          bullets.push(item.sales_status.toUpperCase());
        }
        if (item.price_description) bullets.push(item.price_description);
        if (item.department) bullets.push(item.department === 'RES' ? 'Residential' : item.department === 'COM' ? 'Commercial' : item.department);

        lots.push({
          lot: lotNum,
          address,
          price,
          url,
          imageUrl: imageUrl || undefined,
          bullets,
          reference: ref,
          allsopPropertyId: item.allsop_property_id || item.property_id,
          propType: (item.property_types || [])[0] || undefined,
        });
      }
    } catch (e) {
      console.log(`Allsop JSON parse error on page ${p.page}: ${e.message}`);
    }
  }
  console.log(`Allsop direct JSON extraction: ${lots.length} lots from ${pages.length} pages`);
  return lots;
}

// Enrich Allsop lots with reference and image data from raw API JSON
export function enrichAllsopLots(lots, pages) {
  // Parse all API results from raw JSON pages
  const apiItems = [];
  for (const p of pages) {
    try {
      const json = JSON.parse(p.html);
      const results = json?.data?.results || [];
      apiItems.push(...results);
    } catch {}
  }
  if (apiItems.length === 0) return;

  // Build lookup by postcode (most reliable match field)
  const byPostcode = {};
  for (const item of apiItems) {
    const pc = (item.postcode || '').trim().toUpperCase();
    if (pc) {
      if (!byPostcode[pc]) byPostcode[pc] = [];
      byPostcode[pc].push(item);
    }
  }

  // Track which API items have been matched to prevent double-matching
  const usedApiIds = new Set();

  let matched = 0;
  for (const lot of lots) {
    let match = null;

    // Strategy 1: Match by postcode (most reliable)
    const pcMatch = (lot.address || '').match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
    if (pcMatch) {
      // Normalise postcode: "EC4A3DQ" -> "EC4A 3DQ"
      const rawPc = pcMatch[0].toUpperCase().replace(/\s+/g, '');
      const lotPc = rawPc.slice(0, -3) + ' ' + rawPc.slice(-3);
      const candidates = (byPostcode[lotPc] || byPostcode[rawPc] || []).filter(c => !usedApiIds.has(c.property_id));
      // If only one property at this postcode, it's a match
      match = candidates.length === 1 ? candidates[0] : null;
      // If multiple, try matching by address text
      if (!match && candidates.length > 1) {
        const lotAddr = (lot.address || '').toLowerCase();
        match = candidates.find(c => {
          const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase();
          return lotAddr.includes(apiAddr.split(',')[0]) || apiAddr.includes(lotAddr.split(',')[0]);
        });
      }
    }

    // Strategy 2: Fuzzy address match across ALL API items (for lots without postcodes)
    if (!match) {
      const lotAddr = (lot.address || '').toLowerCase().replace(/[,.\s]+/g, ' ').trim();
      if (lotAddr.length > 5) {
        // Extract street number + name for matching
        const streetMatch = lotAddr.match(/(\d+[a-z]?)\s+(\w+)/);
        if (streetMatch) {
          const streetNum = streetMatch[1];
          const streetWord = streetMatch[2];
          match = apiItems.find(c => {
            if (usedApiIds.has(c.property_id)) return false;
            const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase();
            return apiAddr.includes(streetNum) && apiAddr.includes(streetWord);
          });
        }
        // Try matching by first significant word in both addresses
        if (!match) {
          match = apiItems.find(c => {
            if (usedApiIds.has(c.property_id)) return false;
            const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase().replace(/[,.\s]+/g, ' ').trim();
            // Both addresses must share at least the first meaningful segment
            const lotFirst = lotAddr.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
            const apiFirst = apiAddr.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
            return lotFirst.length > 5 && apiFirst.length > 5 &&
              (lotAddr.includes(apiFirst) || apiAddr.includes(lotFirst));
          });
        }
      }
    }

    if (match) {
      usedApiIds.add(match.property_id);
      lot.reference = match.reference;
      lot.allsopPropertyId = match.allsop_property_id;
      lot.imageFileId = match.image_file_id;
      // Construct image URL from image_file_id
      if (match.image_file_id && !lot.imageUrl) {
        lot.imageUrl = `https://as-prod-bau-object-storage.s3.eu-west-2.amazonaws.com/image_cache/${match.image_file_id}---auto--.jpg`;
      }
      matched++;
    }
  }
  console.log(`Allsop enrichment: matched ${matched}/${lots.length} lots with API data`);
}
