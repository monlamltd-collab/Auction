// lib/pipeline/probe.js — HTML change detection stage
// Determines whether a catalogue URL needs full re-scraping by hashing the
// rendered page and comparing to the stored content_hash. If unchanged and
// cache is still valid, extends the TTL and returns { skip: true }.
//
// Inputs:  { url, house, scrapeUrl, normalisedUrl }
// Outputs: { skip, contentHash, probeSource, cacheExtended }
//          skip=true  → caller should return cached data, no further stages needed
//          skip=false → caller proceeds to scrape stage, contentHash attached for persist stage

import { createHash } from 'crypto';
import { supabase } from '../supabase.js';
import { getCacheTTL } from '../config.js';
import { emitPipelineEvent } from './types.js';

/**
 * @param {object} ctx - Pipeline context
 * @param {string} ctx.url - Original catalogue URL
 * @param {string} ctx.house - Detected house slug
 * @param {string} ctx.scrapeUrl - Rewritten/normalised URL for scraping
 * @param {string} ctx.normalisedUrl - Normalised URL for DB lookups
 * @param {object} deps - Injected dependencies
 * @param {object} deps.budget - ResourceBudget instance
 * @param {function} deps.scrapeWithFirecrawl - Firecrawl scrape function
 * @param {function} deps.fetchPage - Plain HTTP fetch function
 * @returns {Promise<{ skip: boolean, contentHash: string|null, probeSource: string|null, cacheExtended: boolean }>}
 */
export async function probe(ctx, deps) {
  const { house, scrapeUrl, normalisedUrl } = ctx;
  const { budget, scrapeWithFirecrawl, fetchPage } = deps;

  // Check if there's an existing cache entry to compare against
  const { data: existingCache } = await supabase
    .from('cached_analyses')
    .select('content_hash, expires_at')
    .eq('url', normalisedUrl)
    .maybeSingle();

  // No existing cache → skip probe entirely (nothing to compare against)
  // Saves a Firecrawl credit and 5-15 seconds
  if (!existingCache) {
    emitPipelineEvent({ module: 'probe', house, action: 'skip_no_cache' });
    return { skip: false, contentHash: null, probeSource: null, cacheExtended: false };
  }

  // Fetch the first page to hash
  let probeHtml;
  let probeSource = 'http';

  try {
    if (budget.canUseFirecrawl() && !budget.isSkipped(house)) {
      try {
        const fcProbe = await scrapeWithFirecrawl(scrapeUrl, { formats: ['rawHtml'] });
        probeHtml = fcProbe.html || '';
        probeSource = 'firecrawl';
      } catch {
        // Firecrawl failed — fall back to plain HTTP
        probeHtml = await fetchPage(scrapeUrl);
      }
    } else {
      probeHtml = await fetchPage(scrapeUrl);
    }
  } catch (e) {
    // Probe failed entirely — proceed to full scrape (don't block pipeline)
    emitPipelineEvent({ module: 'probe', house, action: 'probe_failed', error: e.message });
    return { skip: false, contentHash: null, probeSource: null, cacheExtended: false };
  }

  const contentHash = createHash('md5').update(probeHtml).digest('hex');

  // Hash matches + cache still valid → extend TTL, skip re-scrape
  const cacheStillValid = existingCache.expires_at && new Date(existingCache.expires_at) > new Date();
  if (existingCache.content_hash === contentHash && cacheStillValid) {
    const newExpiry = new Date(Date.now() + getCacheTTL(house)).toISOString();
    await supabase
      .from('cached_analyses')
      .update({ expires_at: newExpiry, last_scraped_at: new Date().toISOString() })
      .eq('url', normalisedUrl);

    emitPipelineEvent({
      module: 'probe', house, action: 'hash_hit',
      probeSource, cacheExtendedHours: Math.round(getCacheTTL(house) / 3600000),
    });
    console.log(`probe:${house} → hash_hit, cache extended (probe: ${probeSource})`);
    return { skip: true, contentHash, probeSource, cacheExtended: true };
  }

  // Hash changed or cache expired → proceed to full scrape
  emitPipelineEvent({
    module: 'probe', house, action: 'hash_changed',
    probeSource, oldHash: existingCache.content_hash?.slice(0, 8), newHash: contentHash.slice(0, 8),
  });
  console.log(`probe:${house} → hash_changed, proceeding to scrape (probe: ${probeSource})`);
  return { skip: false, contentHash, probeSource, cacheExtended: false };
}
