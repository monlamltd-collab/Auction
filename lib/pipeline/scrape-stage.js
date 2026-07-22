// lib/pipeline/scrape-stage.js — Legacy catalogue-scrape fallback.
//
// Runs ONLY when the primary Firecrawl JSON extract path
// (lib/pipeline/firecrawl-extract.js, called from autoAnalyseOne) returns
// 0 lots or is otherwise unavailable. The Firecrawl path handles the
// happy case for every house except Allsop.
//
// Two branches:
//   1. Bespoke house scrapers, dispatched on `rewritten.paginateAs` — Allsop's
//      private JSON API (lib/scraper/allsop.js), Symonds & Sampson's CF-stealth
//      two-tier scraper, Under The Hammer's public JSON API, Pattinson's
//      render-once-then-walk-the-JSON-endpoint paginator. Exceptions, not
//      the anti-pattern: zero credits, structurally stable, no AI dependency.
//   2. Generic Gemini fallback — render the catalogue once, hand to
//      extractLotsWithAI. The DOM-extractor pipeline + per-house paginated
//      branches were retired 2026-05-08 as part of the Firecrawl-only
//      migration.
//
// Inputs:  { house, url, scrapeUrl, rewritten }
// Outputs: { rawLots }  (empty array if nothing found)
//          Side-effect: triggers self-healing + regression alert when 0 lots

import { supabase } from '../supabase.js';
import { SKIP_PUPPETEER } from '../config.js';
import { HOUSE_DISPLAY_NAMES } from '../houses.js';
import { emitPipelineEvent } from './types.js';

/**
 * @param {object} ctx - Pipeline context
 * @param {string} ctx.house - Detected house slug
 * @param {string} ctx.url - Original catalogue URL
 * @param {string} ctx.scrapeUrl - Rewritten/normalised URL for scraping
 * @param {object} ctx.rewritten - Output of rewriteUrl() (paginateAs, preferPuppeteer, waitFor, actions, baseUrl)
 * @param {object} deps - Injected dependencies
 * @param {function} deps.scrapeAllsopApi
 * @param {function} deps.extractAllsopLotsFromJson
 * @param {function} deps.scrapeSymondsAndSampson
 * @param {function} deps.scrapeUnderTheHammer
 * @param {function} deps.scrapePattinson
 * @param {function} deps.scrapeRenderedPage
 * @param {function} deps.fetchPage
 * @param {function} deps.scrapeAllPages
 * @param {function} deps.extractLotsWithAI
 * @param {function} deps.isFcCreditExhausted
 * @param {function} deps.isCreditExhausted - Gemini credit exhaustion check
 * @param {function} deps.getLastScrapeEngine
 * @returns {Promise<{ rawLots: Array }>}
 */
export async function scrapeStage(ctx, deps) {
  const { house, url, scrapeUrl, rewritten } = ctx;
  const creditExhausted = deps.isCreditExhausted();
  let rawLots = [];

  if (rewritten.paginateAs === 'allsop_api') {
    const pages = await deps.scrapeAllsopApi(rewritten.baseUrl);
    if (pages.length > 0) {
      rawLots = deps.extractAllsopLotsFromJson(pages);
    }
  } else if (rewritten.paginateAs === 'symondsandsampson_stealth') {
    // Cloudflare-blocked house: bespoke two-tier Firecrawl-stealth scraper.
    // Returns already-normalised lots (see lib/scraper/symondsandsampson.js).
    rawLots = await deps.scrapeSymondsAndSampson(rewritten.baseUrl);
  } else if (rewritten.paginateAs === 'underthehammer_api') {
    // Next.js SPA served off a public JSON endpoint. Bespoke consumer — zero
    // credits, no render, no AI. Returns already-normalised lots, filtered to
    // the live book (see lib/scraper/underthehammer.js).
    rawLots = await deps.scrapeUnderTheHammer(rewritten.baseUrl);
  } else if (rewritten.paginateAs === 'pattinson_api') {
    // Cloudflare-protected Next.js catalogue, 90 fixed pages of 20 — far past
    // MAX_PUPPETEER_PAGES. One render clears CF, then the host-gated in-page
    // paginator walks the site's own JSON endpoint from inside that session.
    // Returns already-normalised lots (see lib/scraper/pattinson.js).
    rawLots = await deps.scrapePattinson(rewritten.baseUrl);
  } else {
    rawLots = await _scrapeGeminiFallback(ctx, deps, creditExhausted);
  }

  // ── 0-lot regression detection + self-healing ──
  if (rawLots.length === 0) {
    console.log(`AUTO: ${house}: 0 lots found, skipping cache`);
    await _handleZeroLots(house, url);
  }

  // ── Stamp scrape provenance onto each raw lot ──
  const scrapedAt = new Date().toISOString();
  const scrapeMethod = deps.getLastScrapeEngine ? deps.getLastScrapeEngine() : null;
  for (const lot of rawLots) {
    if (!lot._scrapedAt) lot._scrapedAt = scrapedAt;
    if (!lot._scrapeMethod) lot._scrapeMethod = scrapeMethod;
  }

  return { rawLots };
}

// ── Generic Gemini fallback ──
// Render the catalogue (Firecrawl-rendering or Puppeteer or HTTP) and hand
// the resulting markdown/HTML to Gemini for lot extraction. Used only when
// the Firecrawl JSON extract path returned 0 lots.
async function _scrapeGeminiFallback({ house, url, scrapeUrl, rewritten }, deps, creditExhausted) {
  let rawLots = [];

  if (rewritten.preferPuppeteer) {
    // JS-rendered sites: render via Firecrawl/Puppeteer, then Gemini.
    if (deps.isFcCreditExhausted()) {
      console.log(`AUTO: Firecrawl credits exhausted, will use Puppeteer fallback for ${house}`);
    }
    const scrapeOpts = {};
    if (rewritten.waitFor) scrapeOpts.waitFor = rewritten.waitFor;
    if (rewritten.actions) scrapeOpts.actions = rewritten.actions;
    let firstResult;
    try {
      firstResult = await deps.scrapeRenderedPage(scrapeUrl, house, scrapeOpts);
    } catch (err) {
      console.log(`AUTO: ${house}: rendered scrape failed in fallback: ${err.message}`);
      return rawLots;
    }
    if (!creditExhausted && firstResult && firstResult.html) {
      const renderedPages = [{ page: 1, html: firstResult.html, markdown: firstResult.markdown }];
      rawLots = await deps.extractLotsWithAI(renderedPages, house, null, scrapeUrl) || [];
      console.log(`AUTO: ${house}: ${rawLots.length} lots via Gemini fallback (preferPuppeteer)`);
    } else if (creditExhausted) {
      console.log(`AUTO: ${house}: Gemini exhausted — no extraction possible in fallback`);
    }
  } else {
    // Static HTTP path: scrapeAllPages → Gemini, with a Puppeteer-rendered
    // last resort for sites that gate content behind JS.
    if (!creditExhausted) {
      const pages = await deps.scrapeAllPages(scrapeUrl, house);
      if (pages && pages.length > 0) {
        rawLots = await deps.extractLotsWithAI(pages, house, null, scrapeUrl) || [];
      }
    }
    if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
      try {
        const rendered = await deps.scrapeRenderedPage(url, house);
        if (rendered.html && !creditExhausted) {
          const renderedPages = [{ page: 1, html: rendered.html, markdown: rendered.markdown }];
          rawLots = await deps.extractLotsWithAI(renderedPages, house, null, scrapeUrl) || [];
        } else if (creditExhausted) {
          console.log(`AUTO: ${house}: Gemini exhausted — no extraction possible`);
        }
      } catch (err) {
        console.log(`AUTO: Rendered scraping fallback failed for ${house}: ${err.message}`);
      }
    }
  }

  return rawLots;
}

// ── 0-lot regression: alert + self-healing ──
async function _handleZeroLots(house, url) {
  try {
    const { data: prevSkill } = await supabase.from('house_skills').select('last_lot_count, dormant').eq('slug', house).maybeSingle();
    if (prevSkill && prevSkill.last_lot_count > 0) {
      // A dormant house (between-auctions / retired) dropping to 0 lots is the
      // expected transition out of a finished auction, not an extractor break —
      // record it as info so it doesn't fire the breakage alarm.
      const dormant = !!prevSkill.dormant;
      await supabase.from('pipeline_alerts').insert({
        event_type: 'extractor_regression',
        severity: dormant ? 'info' : 'error',
        house,
        message: `${HOUSE_DISPLAY_NAMES[house] || house} returned 0 lots (previously had ${prevSkill.last_lot_count})${dormant ? ' [dormant]' : ''}`
      });
      console.log(`ALERT: Extractor regression for ${house} (0 lots, was ${prevSkill.last_lot_count})`);

      console.log(`HEAL: Triggering self-healing for ${house} (was ${prevSkill.last_lot_count} lots, now 0)`);
      emitPipelineEvent({ module: 'scrape', house, action: 'self_heal_triggered', previousLots: prevSkill.last_lot_count });
    }
  } catch (alertErr) { console.warn('ALERT: Failed to record extractor regression:', alertErr.message); }
}
