// lib/pipeline/house-skills.js — House skill tracking
// Persists per-house rolling stats (lot count EMA, image coverage, status,
// platform family, pagination pattern) to the house_skills table.
//
// Called by persist-stage after each successful scrape cycle.
//
// Dependencies injected via `deps` to keep this module pure.

import { supabase } from '../supabase.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../houses.js';

/**
 * @param {string} slug - House slug
 * @param {object} params
 * @param {string} params.catalogueUrl
 * @param {number} params.lotCount
 * @param {number} params.imageCoverage - Percentage (0-100)
 * @param {string} params.scrapedWith - 'firecrawl'|'puppeteer'|'http'
 * @param {boolean} params.requiresPuppeteer
 * @param {object} deps - Injected dependencies (currently unused; kept for
 *   call-site compatibility — DOM_EXTRACTORS dependency was removed
 *   2026-05-08 with the Firecrawl-only migration).
 */
export async function updateHouseSkill(slug, { catalogueUrl, lotCount, imageCoverage, scrapedWith, requiresPuppeteer }, _deps = {}) {
  const { data: existing } = await supabase
    .from('house_skills')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  const now = new Date().toISOString();
  const displayName = HOUSE_DISPLAY_NAMES[slug] || slug;
  const rootUrl = HOUSE_ROOTS[slug] || catalogueUrl;

  // ── Determine extractor type ──
  const extractor = _detectExtractorType(slug);

  // ── Rolling average lot count (EMA) ──
  const prevAvg = existing?.average_lot_count || lotCount;
  const averageLotCount = Math.round((prevAvg * 0.7) + (lotCount * 0.3));

  // ── Pagination pattern ──
  let paginationPattern = existing?.pagination_pattern || 'none';
  if (rootUrl.includes('?page=')) paginationPattern = '?page=N';
  else if (rootUrl.includes('/page/')) paginationPattern = '/page/N';

  // ── Status ──
  let status = 'healthy';
  if (lotCount === 0) {
    status = 'broken';
  } else if (existing?.average_lot_count && lotCount < existing.average_lot_count * 0.7) {
    status = 'degraded';
  }

  // ── Image coverage drop alert ──
  const prevCoverage = existing?.image_coverage || 0;
  if (prevCoverage > 50 && imageCoverage < 50 && lotCount > 5) {
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'image_coverage_drop',
        severity: 'warning',
        house: slug,
        message: `${displayName} image coverage dropped from ${prevCoverage}% to ${imageCoverage}%`
      });
      console.log(`ALERT: Image coverage drop for ${displayName}: ${prevCoverage}% → ${imageCoverage}%`);
    } catch (alertErr) { console.warn('ALERT: Failed to record image coverage drop:', alertErr.message); }
  }

  // ── Platform family auto-detection ──
  const platformFamily = _detectPlatformFamily(existing, rootUrl, extractor);

  // ── Logo URL from domain (Google favicon API) ──
  let logoUrl = existing?.logo_url || null;
  if (!logoUrl && rootUrl) {
    try {
      const domain = new URL(rootUrl).hostname;
      logoUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch { /* invalid URL, skip */ }
  }

  const skill = {
    slug,
    house: displayName,
    catalogue_url: rootUrl,
    extractor,
    platform_family: platformFamily,
    last_verified: now,
    last_lot_count: lotCount,
    average_lot_count: averageLotCount,
    image_coverage: imageCoverage,
    requires_puppeteer: !!requiresPuppeteer,
    requires_firecrawl: scrapedWith === 'firecrawl',
    pagination_pattern: paginationPattern,
    notes: existing?.notes || '',
    status,
    logo_url: logoUrl,
  };

  const { error } = await supabase
    .from('house_skills')
    .upsert(skill, { onConflict: 'slug' });

  if (error) throw new Error(`Supabase skill upsert failed: ${error.message}`);
  console.log(`SKILL: ${displayName} → ${status} (${lotCount} lots, ${imageCoverage}% images)`);
}

function _detectExtractorType(slug) {
  // DOM extractors retired 2026-05-08. Catalogue extraction is now
  // Firecrawl JSON extract → Gemini fallback. Allsop uses a private JSON
  // API. Platform classification (eig/auctionhouse_uk/bamboo/...) lives in
  // _detectPlatformFamily, which reads from the canonical root URL.
  const rootUrl = (HOUSE_ROOTS && HOUSE_ROOTS[slug]) || '';
  if (rootUrl.toLowerCase().includes('allsop.co.uk')) return 'api';
  return 'firecrawl-json';
}

function _detectPlatformFamily(existing, rootUrl, extractor) {
  let platformFamily = existing?.platform_family || null;
  if (!platformFamily) {
    const url = (rootUrl || '').toLowerCase();
    if (url.includes('eigonlineauctions.com') || url.includes('eigpropertyauctions.co.uk') || url.includes('gotoproperties.co.uk') || extractor === 'eigplatform') platformFamily = 'eig';
    else if (url.includes('auctionhouse.co.uk') || extractor === 'auctionhouseuk') platformFamily = 'auctionhouse_uk';
    else if (url.includes('btgeddisonspropertyauctions.com') || url.includes('sdlauctions.co.uk')) platformFamily = 'btg_sdl';
    else if (url.includes('iamsold.co.uk')) platformFamily = 'iamsold';
    else if (url.includes('bambooauctions.com')) platformFamily = 'bamboo';
  }
  return platformFamily;
}
