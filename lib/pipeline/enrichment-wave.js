// lib/pipeline/enrichment-wave.js — Multi-pass data hygiene: price hunt, postcode rescue, enrichment, lot-page deep fill
import { supabase } from '../supabase.js';

/**
 * Extract price from raw HTML text using progressive pattern matching.
 * @param {string} text - Stripped HTML text
 * @returns {{ price: number|null, priceText: string|null }|null}
 */
export function extractPriceFromText(text) {
  const patterns = [
    /(?:guide\s*price|starting\s*bid|minimum\s*opening\s*bid|reserve\s*price|current\s*bid)[^£]{0,30}£([\d,]+)/i,
    /£([\d,]+)\s*(?:guide|starting|plus|reserve|\+)/i,
    /(?:price|sold\s*(?:for|at|price))[^£]{0,20}£([\d,]+)/i,
    /£([\d,]+)\s*[-–]\s*£([\d,]+)/i, // range — take lower
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const p = parseInt(m[1].replace(/,/g, ''), 10);
      if (p >= 500 && p <= 50000000) return { price: p, priceText: null };
    }
  }
  // Fallback: any standalone £ amount
  const allPrices = [...text.matchAll(/£([\d,]+)/g)]
    .map(m => parseInt(m[1].replace(/,/g, ''), 10))
    .filter(p => p >= 1000 && p <= 50000000);
  if (allPrices.length === 1) return { price: allPrices[0], priceText: null };
  if (allPrices.length > 1) {
    const nonFee = allPrices.filter(p => p >= 5000);
    if (nonFee.length > 0) return { price: nonFee[0], priceText: null };
  }
  // Detect explicit no-price
  if (/\b(?:price on application|p\.?o\.?a\.?|to be advised|t\.?b\.?a\.?|refer to auctioneer|contact.*for.*price|price available on request|offers? invited|no guide|by negotiation)\b/i.test(text)) {
    return { price: null, priceText: 'POA' };
  }
  return null;
}

/**
 * Run multi-pass data hygiene wave:
 * Pass 1 — Price hunter (lot-page fetch for priceless lots)
 * Pass 2 — Postcode rescue (lot-page enrichment for missing postcodes)
 * Pass 3 — Full enrichment (comps, yield, EPC, flood)
 * Pass 4 — Lot-page deep enrichment (tenure, condition, beds, images)
 *
 * @param {object} deps - Injected dependencies
 * @param {Function} deps.fetchLotPage
 * @param {Function} deps.enrichLotsFromLotPages
 * @param {Function} deps.enrichLots
 * @param {Function} deps.normaliseLotStatuses
 * @param {Function} deps.extractPostcode
 * @param {Function} deps.analyseLot
 * @param {Function} deps.dbRowToLot
 * @param {Function} deps.upsertToLotsTable
 * @param {Function} deps.upsertLotGroups
 */
export async function runEnrichmentWave(deps) {
  const {
    fetchLotPage, enrichLotsFromLotPages, enrichLots,
    normaliseLotStatuses, extractPostcode, analyseLot,
    dbRowToLot, upsertToLotsTable, upsertLotGroups,
  } = deps;

  const stats = { lotPageFetched: 0, pricesFound: 0, pricesPoa: 0, postcodeFixed: 0, enriched: 0, lotPageEnriched: 0 };
  console.log(`HYGIENE: Starting at ${new Date().toISOString()}...`);

  // ═══ PASS 1: Price Hunter — fetch lot pages for every lot missing price ═══
  // Price is the #1 non-negotiable. 500 per cycle — Firecrawl budget has headroom.
  const { data: pricelessLots } = await supabase
    .from('lots')
    .select('*')
    .or('price.is.null,price.eq.0')
    .not('url', 'like', '__synthetic__%')
    .is('price_text', null) // skip lots already confirmed POA
    .order('last_seen_at', { ascending: false })
    .limit(500);

  if (pricelessLots && pricelessLots.length > 0) {
    console.log(`HYGIENE [price]: ${pricelessLots.length} lots missing prices...`);
    for (let i = 0; i < pricelessLots.length; i += 5) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      const batch = pricelessLots.slice(i, i + 5);
      await Promise.allSettled(batch.map(async (dbRow) => {
        try {
          const result = await fetchLotPage(dbRow.url);
          if (!result) return;
          stats.lotPageFetched++;
          const text = result.html.replace(/<[^>]+>/g, ' ')
            .replace(/&#163;/g, '£').replace(/&pound;/g, '£')
            .replace(/&#8364;/g, '€').replace(/&euro;/g, '€')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ').toLowerCase();
          const extracted = extractPriceFromText(text);
          const update = {};
          if (extracted) {
            if (extracted.price) { update.price = extracted.price; stats.pricesFound++; }
            if (extracted.priceText) { update.price_text = extracted.priceText; stats.pricesPoa++; }
          }
          // Capture raw_text while we have the page
          if (!dbRow.raw_text) {
            const rawText = result.html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (rawText.length > 50) update.raw_text = rawText.slice(0, 10000);
          }
          if (Object.keys(update).length > 0) {
            await supabase.from('lots').update(update).eq('id', dbRow.id);
          }
        } catch { /* retry next cycle */ }
      }));
    }
    console.log(`HYGIENE [price]: ✓ ${stats.pricesFound} found, ${stats.pricesPoa} POA`);
  }

  // ═══ PASS 2: Postcode rescue — lot-page fetch for lots with no postcode ═══
  const { data: noPostcodeLots } = await supabase
    .from('lots')
    .select('*')
    .is('postcode', null)
    .not('url', 'like', '__synthetic__%')
    .order('last_seen_at', { ascending: false })
    .limit(300);

  if (noPostcodeLots && noPostcodeLots.length > 0) {
    console.log(`HYGIENE [postcode]: ${noPostcodeLots.length} lots missing postcodes...`);
    const lotObjs = noPostcodeLots.map(dbRowToLot);
    await enrichLotsFromLotPages(lotObjs, 3);
    for (const lot of lotObjs) {
      if (!lot.postcode && lot.address) {
        lot.postcode = extractPostcode(lot.address);
        if (lot.postcode) stats.postcodeFixed++;
      }
    }
    await upsertLotGroups(lotObjs, 'hygiene-postcode');
    console.log(`HYGIENE [postcode]: ✓ ${stats.postcodeFixed} postcodes recovered`);
  }

  // ═══ PASS 3: Full enrichment — comps, yield, EPC, flood for lots with postcode but missing data ═══
  const { data: needsEnrichment } = await supabase
    .from('lots')
    .select('*')
    .not('postcode', 'is', null)
    .or('enriched_at.is.null,epc_rating.is.null,flood_risk.is.null,street_avg.is.null,est_gross_yield.is.null')
    .order('last_seen_at', { ascending: false })
    .limit(500);

  if (needsEnrichment && needsEnrichment.length > 0) {
    console.log(`HYGIENE [enrich]: ${needsEnrichment.length} lots have postcode but missing EPC/flood/comps/yield...`);
    const groups = {};
    for (const row of needsEnrichment) {
      const key = `${row.house}|${row.catalogue_url}`;
      if (!groups[key]) groups[key] = { house: row.house, catalogueUrl: row.catalogue_url, rows: [] };
      groups[key].rows.push(row);
    }

    for (const [, group] of Object.entries(groups)) {
      try {
        const lotObjs = group.rows.map(dbRowToLot);
        // Re-analyse unscored lots
        for (const lot of lotObjs) {
          if (lot.score === 0 && (!lot.scoreBreakdown || lot.scoreBreakdown.length === 0)) {
            Object.assign(lot, analyseLot(lot));
          }
          // Condition inference from bullets
          if (!lot.condition && lot.bullets && lot.bullets.length > 0) {
            const t = lot.bullets.join(' ').toLowerCase();
            if (/derelict|dilapidated|fire damage/.test(t)) lot.condition = 'poor';
            else if (/modernis|refurbishment|renovation|updating|in need of|improvement|requires? (?:updating|work|repair)|fixer.upper/.test(t)) lot.condition = 'needs work';
            else if (/good order|good decorative|well maintained|recently refurbished|good condition/.test(t)) lot.condition = 'good';
          }
        }
        // enrichLots does: Land Registry comps, yield calc, EPC lookup, flood check
        await enrichLots(lotObjs, group.house, group.catalogueUrl);
        normaliseLotStatuses(lotObjs);
        await upsertToLotsTable(lotObjs, group.house, group.catalogueUrl, { scrapedWith: 'hygiene-enrich' });
        stats.enriched += lotObjs.length;
        console.log(`HYGIENE [enrich]: ✓ ${group.house}: ${lotObjs.length} lots`);
      } catch (e) {
        console.warn(`HYGIENE [enrich]: Failed for ${group.house}: ${e.message}`);
      }
    }
  }

  // ═══ PASS 4: Lot-page deep enrichment — tenure, condition, beds, vacant, images ═══
  const { data: needsLotPage } = await supabase
    .from('lots')
    .select('*')
    .not('url', 'like', '__synthetic__%')
    .or('tenure.is.null,condition.is.null,beds.is.null,image_url.is.null,prop_type.is.null,vacant.is.null')
    .order('last_seen_at', { ascending: false })
    .limit(300);

  if (needsLotPage && needsLotPage.length > 0) {
    console.log(`HYGIENE [lot-page]: ${needsLotPage.length} lots need deep enrichment from lot pages...`);
    const lotObjs = needsLotPage.map(dbRowToLot);
    try {
      await enrichLotsFromLotPages(lotObjs, 3);
      await upsertLotGroups(lotObjs, 'hygiene-lotpage');
      stats.lotPageEnriched += lotObjs.length;
      console.log(`HYGIENE [lot-page]: ✓ ${lotObjs.length} lots enriched`);
    } catch (e) {
      console.warn(`HYGIENE [lot-page]: Failed: ${e.message}`);
    }
  }

  // ═══ Summary ═══
  const { count: remainingNoPrice } = await supabase.from('lots').select('*', { count: 'exact', head: true }).or('price.is.null,price.eq.0').is('price_text', null);
  const { count: remainingNoPostcode } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('postcode', null).not('url', 'like', '__synthetic__%');
  const { count: remainingNoEnrich } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('enriched_at', null).not('postcode', 'is', null);
  console.log(`HYGIENE: Complete — prices:${stats.pricesFound}found/${stats.pricesPoa}poa, postcodes:${stats.postcodeFixed}fixed, enriched:${stats.enriched}, lotPages:${stats.lotPageEnriched}`);
  console.log(`HYGIENE: Remaining gaps — no price:${remainingNoPrice || 0}, no postcode:${remainingNoPostcode || 0}, no enrichment:${remainingNoEnrich || 0}`);
}
