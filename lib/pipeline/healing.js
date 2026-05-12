// lib/pipeline/healing.js — Self-healing for broken auction house URLs
// When a house returns 0 lots, attempts to find the new catalogue URL by:
//   1. Scraping the house homepage (Firecrawl → plain HTTP fallback) for merger signals
//   2. Asking Firecrawl's FIRE-1 agent to navigate the site and find the current catalogue URL
//   3. If homepage analysis fails, web search fallback (Firecrawl /search + FIRE-1 ranker)
//   4. Verifying the candidate URL returns content + lots
//   5. Updating HOUSE_ROOTS + auction_calendar
//
// Has its own cooldown/backoff state (exponential: 1h → 24h → 48h → 96h, max 7d).
//
// Dependencies injected via `deps` to keep this module pure. `deps.agentExtract`
// defaults to the real Firecrawl FIRE-1 helper; tests can stub it.

import { supabase } from '../supabase.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES, detectAuctionHouse } from '../houses.js';
import { normaliseUrl } from '../utils.js';
import { agentExtract as defaultAgentExtract } from '../scraper/firecrawl.js';

// JSON schemas FIRE-1 fills when finding URLs / detecting mergers.
const NEW_URL_SCHEMA = {
  type: 'object',
  properties: {
    newUrl: { type: ['string', 'null'], description: 'Absolute URL of the current upcoming property auction catalogue page, or null if none found' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'], description: 'Confidence that this is the correct catalogue URL' },
    reason: { type: 'string', description: 'One-sentence explanation of how the URL was identified' },
  },
  required: ['newUrl', 'confidence', 'reason'],
};

const MERGER_SCHEMA = {
  type: 'object',
  properties: {
    newOwnerName: { type: ['string', 'null'], description: 'Name of the business that now runs these auctions, or null if no merger detected' },
    newOwnerUrl: { type: ['string', 'null'], description: 'URL of the new owner / parent business, or null if no merger detected' },
    reason: { type: 'string', description: 'Quote the merger announcement text from the page, or explain why no merger was detected' },
  },
  required: ['newOwnerName', 'newOwnerUrl', 'reason'],
};

// FIRE-1 timeout: agent can take 30s for autonomous navigation; 90s budget is generous.
const AGENT_TIMEOUT_MS = 90000;

// Phrases that signal an auction house has been acquired / merged into
// another business — when these appear on the homepage we should treat
// the broken URL as a merger event, not a URL-rotation event, and check
// whether the new owner is already a tracked house.
const MERGER_PHRASES = [
  /\bwe(?:'re| are) now part of\b/i,
  /\bnow part of\b/i,
  /\bhas been acquired by\b/i,
  /\bwe(?:'ve| have) (?:been )?acquired by\b/i,
  /\b(?:we(?:'ve| have)? )?merged with\b/i,
  /\bauctions? (?:are )?now run by\b/i,
  /\bauctions? (?:have )?moved to\b/i,
  /\bjoined\s+forces\s+with\b/i,
  /\b(?:visit|see)\s+our\s+new\s+(?:website|site|auctions?)\b/i,
];

function _hasMergerSignal(text) {
  if (!text) return false;
  return MERGER_PHRASES.some(re => re.test(text));
}

// ── In-memory healing state ──
const _healingState = new Map(); // slug → { lastAttempt, attempts, cooldownUntil }

async function _persistHealingState(slug, state) {
  _healingState.set(slug, state);
  try {
    await supabase.from('house_skills').update({
      healing_cooldown_until: state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : null,
      healing_attempts: state.attempts || 0,
    }).eq('slug', slug);
  } catch { /* non-fatal */ }
}

export function getHealingState() { return _healingState; }
export function clearHealingCooldown(slug) { _healingState.delete(slug); }

/**
 * @param {string} slug - House slug
 * @param {string} oldUrl - The broken catalogue URL
 * @param {object} deps - Injected dependencies
 * @param {string|undefined} deps.FIRECRAWL_API_KEY
 * @param {function} deps.scrapeWithFirecrawl
 * @param {function} [deps.agentExtract] - Firecrawl FIRE-1 agent (defaults to lib/scraper/firecrawl.js export)
 * @param {object} deps.HEADERS - HTTP request headers
 * @returns {Promise<string|null>} The healed URL, or null
 */
export async function healBrokenHouse(slug, oldUrl, deps) {
  if (!supabase || !deps.FIRECRAWL_API_KEY) return null;

  // Cooldown: don't retry healing for the same house within backoff period
  let state = _healingState.get(slug);
  // If in-memory cooldown is empty (e.g. after restart), check DB
  if (!state) {
    try {
      const { data: skill } = await supabase.from('house_skills')
        .select('healing_cooldown_until, healing_attempts')
        .eq('slug', slug)
        .maybeSingle();
      if (skill && skill.healing_cooldown_until && new Date(skill.healing_cooldown_until) > new Date()) {
        console.log(`HEAL: Skipping ${slug} — DB cooldown until ${skill.healing_cooldown_until}`);
        _healingState.set(slug, { lastAttempt: Date.now(), attempts: skill.healing_attempts || 0, cooldownUntil: new Date(skill.healing_cooldown_until).getTime() });
        return null;
      }
      if (skill) {
        state = { lastAttempt: Date.now(), attempts: skill.healing_attempts || 0, cooldownUntil: 0 };
      }
    } catch { /* proceed if DB check fails */ }
  }
  if (state && state.cooldownUntil && Date.now() < state.cooldownUntil) {
    console.log(`HEAL: Skipping ${slug} — on cooldown until ${new Date(state.cooldownUntil).toISOString()}`);
    return null;
  }

  const attempts = (state?.attempts || 0) + 1;
  // Cooldown schedule:
  //   1st failed heal → 1h    (URL likely just rolled — high-confidence fast retry)
  //   2nd            → 24h    (slower — heal genuinely couldn't find it)
  //   3rd            → 48h
  //   4th            → 96h
  //   5th+           → 7d (cap)
  //
  // Previously every failed heal applied 24h × 2^(attempts-1), so a fresh
  // 404 on a previously-working URL waited 24h before retry. Cache expires
  // after 7d, so two failed heals = guaranteed disappearance from frontend.
  // Tightening the first-attempt cooldown means rolled URLs recover within
  // the next cron cycle (~1h) instead of the next day. The exponential
  // backoff still kicks in for genuinely-broken houses to avoid burning
  // Firecrawl + Gemini credits.
  const cooldownMs = attempts === 1
    ? 60 * 60 * 1000
    : Math.min(24 * 60 * 60 * 1000 * Math.pow(2, attempts - 2), 7 * 24 * 60 * 60 * 1000);

  console.log(`HEAL: Attempting to heal ${slug} (attempt ${attempts}, old URL: ${oldUrl})`);

  try {
    const rootUrl = HOUSE_ROOTS[slug];
    if (!rootUrl) {
      console.log(`HEAL: No HOUSE_ROOTS entry for ${slug}`);
      return null;
    }

    const parsedUrl = new URL(rootUrl);
    const homepageUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

    // ── Scrape homepage (Firecrawl → plain HTTP fallback) ──
    const { html, markdown } = await _scrapeHomepage(homepageUrl, rootUrl, slug, deps);
    if (!html) {
      await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    // ── Extract text + links for AI analysis ──
    const { stripped, hrefs } = _extractContentAndLinks(html);
    if (hrefs.length === 0 && stripped.length < 200) {
      console.log(`HEAL: Insufficient content from ${slug} homepage`);
      await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    // ── Merger detection: if the homepage explicitly says "we're now part
    // of X / visit our new website Y", and Y resolves to an existing
    // tracked slug, treat this as a merger and stop scraping the old slug
    // rather than blindly inventing a new URL (which would just duplicate
    // lots of the parent house). ──
    if (_hasMergerSignal(stripped) || _hasMergerSignal(markdown || '')) {
      console.log(`HEAL: Merger signal detected on ${slug} homepage — running merger check`);
      const merger = await _detectMerger(slug, homepageUrl, deps);
      if (merger && merger.newOwnerUrl) {
        const mergedIntoSlug = detectAuctionHouse(merger.newOwnerUrl);
        if (mergedIntoSlug && mergedIntoSlug !== slug) {
          await _commitMerger(slug, mergedIntoSlug, merger.newOwnerUrl, merger.reason);
          await _persistHealingState(slug, { lastAttempt: Date.now(), attempts: 0, cooldownUntil: 0 });
          return null; // healed by deprecation, not URL replacement
        }
        if (!mergedIntoSlug) {
          // New owner detected but not a slug we track — log for human review
          // rather than auto-creating a slug, then fall through to normal heal.
          try {
            await supabase.from('pipeline_alerts').insert({
              event_type: 'merger_detected_unknown',
              severity: 'warning',
              house: slug,
              message: `${HOUSE_DISPLAY_NAMES[slug] || slug} appears to have merged into "${merger.newOwnerName || 'unknown'}" (${merger.newOwnerUrl}), which is not currently tracked. Manual review needed: either add as a new house or deprecate the old slug.`,
            });
          } catch { /* silent */ }
        }
      }
    }

    // ── Ask FIRE-1 to find the new catalogue URL ──
    const result = await _askAIForNewUrl(slug, oldUrl, homepageUrl, deps);
    if (!result) {
      await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    if (!result.newUrl || result.confidence === 'none') {
      console.log(`HEAL: Homepage analysis found nothing for ${slug} — trying web search fallback`);

      // ── Web search fallback: Google-style query via Firecrawl search API ──
      const searchResult = await _webSearchForCatalogue(slug, oldUrl, homepageUrl, deps);
      if (searchResult && searchResult.newUrl && searchResult.confidence !== 'none') {
        // Replace the failed homepage result with the search result
        Object.assign(result, searchResult);
        console.log(`HEAL: Web search found candidate for ${slug}: ${result.newUrl} (${result.confidence})`);
      } else {
        await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
        try {
          await supabase.from('pipeline_alerts').insert({
            event_type: 'healing_failed',
            severity: 'warning',
            house: slug,
            message: `Self-healing failed for ${HOUSE_DISPLAY_NAMES[slug] || slug}: homepage + web search found no catalogue URL. Old URL: ${oldUrl}`,
          });
        } catch { /* silent */ }
        return null;
      }
    }

    // ── Validate the new URL ──
    const newUrl = result.newUrl.trim();
    const normOld = normaliseUrl(oldUrl);
    const normNew = normaliseUrl(newUrl);
    if (normOld === normNew) {
      console.log(`HEAL: AI returned the same URL for ${slug} — no change needed`);
      await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    // ── Verify the new URL is reachable and contains content ──
    const verified = await _verifyNewUrl(newUrl, slug, deps);
    if (!verified) {
      await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    // ── Commit the heal ──
    await _commitHeal(slug, oldUrl, newUrl, result.confidence, result.reason);

    // Reset healing state on success
    await _persistHealingState(slug, { lastAttempt: Date.now(), attempts: 0, cooldownUntil: 0 });

    return newUrl;

  } catch (err) {
    console.error(`HEAL: Unexpected error healing ${slug}:`, err.message);
    await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
    return null;
  }
}

// ── Scrape homepage + root URL ──
async function _scrapeHomepage(homepageUrl, rootUrl, slug, deps) {
  let html, markdown;
  try {
    const fcResult = await deps.scrapeWithFirecrawl(homepageUrl, {
      formats: ['rawHtml', 'markdown'],
    });
    html = fcResult.html;
    markdown = fcResult.markdown;
    console.log(`HEAL: Firecrawl scraped ${homepageUrl} (${(html || '').length} chars HTML, ${(markdown || '').length} chars markdown)`);
  } catch (fcErr) {
    console.log(`HEAL: Firecrawl failed for ${homepageUrl}: ${fcErr.message}`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(homepageUrl, { headers: deps.HEADERS, signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) html = await resp.text();
    } catch { /* silent */ }
    if (!html) return { html: null, markdown: null };
  }

  // Also try scraping the root URL directly if different from homepage
  let rootHtml = '';
  if (rootUrl !== homepageUrl && rootUrl !== homepageUrl + '/') {
    try {
      const fcRoot = await deps.scrapeWithFirecrawl(rootUrl, { formats: ['rawHtml'] });
      rootHtml = fcRoot.html || '';
      console.log(`HEAL: Also scraped root URL ${rootUrl} (${rootHtml.length} chars)`);
    } catch { /* silent — homepage was the priority */ }
  }

  return { html: html + '\n' + rootHtml, markdown };
}

// ── Extract text content + links from HTML ──
function _extractContentAndLinks(html) {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 8000);

  const hrefMatches = [...html.matchAll(/href="([^"]+)"/gi)];
  const hrefs = [...new Set(hrefMatches.map(m => m[1]))]
    .filter(h => !h.startsWith('#') && !h.startsWith('javascript:') && !h.startsWith('mailto:'))
    .slice(0, 60);

  return { stripped, hrefs };
}

// ── Ask Firecrawl FIRE-1 to find the new catalogue URL ──
async function _askAIForNewUrl(slug, oldUrl, homepageUrl, deps) {
  const agentExtract = deps.agentExtract || defaultAgentExtract;
  const houseName = HOUSE_DISPLAY_NAMES[slug] || slug;

  const prompt = `You are fixing a broken UK property auction scraper for ${houseName}.

Old catalogue URL (broken/empty): ${oldUrl}

Starting from this homepage, navigate the site as needed to find the CURRENT upcoming property auction catalogue page — the page that bidders click to browse all lots in the next auction. Prefer pages with words like "catalogue", "lots", "properties", "auction", "current", "upcoming", "search". Avoid past/archived auctions, news, blog, about, and contact pages.

Return your finding via the structured schema. Set confidence='none' and newUrl=null if no current catalogue page exists.`;

  try {
    const data = await agentExtract(homepageUrl, prompt, NEW_URL_SCHEMA, { timeout: AGENT_TIMEOUT_MS });
    if (!data || typeof data !== 'object') return null;
    // FIRE-1 may return the schema directly or wrap it under a known key; tolerate both.
    const result = (data.newUrl !== undefined || data.confidence !== undefined) ? data : (data.data || data.result || {});
    if (typeof result.confidence !== 'string') return null;
    return {
      newUrl: result.newUrl || null,
      confidence: result.confidence,
      reason: result.reason || '',
    };
  } catch (err) {
    console.log(`HEAL: FIRE-1 askForNewUrl failed for ${slug}: ${err.message}`);
    return null;
  }
}

// ── Verify candidate URL is reachable and has content ──
async function _verifyNewUrl(newUrl, slug, deps) {
  try {
    const verifyResult = await deps.scrapeWithFirecrawl(newUrl, { formats: ['rawHtml'] });
    const verifyHtml = verifyResult.html || '';
    if (verifyHtml.length < 500) {
      console.log(`HEAL: New URL ${newUrl} returned very little content (${verifyHtml.length} chars) — skipping`);
      return false;
    }
    // Verification: rawHtml is non-trivial → URL is alive. Lot-count
    // verification removed 2026-05-08 with the DOM-extractor retirement;
    // Firecrawl JSON extract on the next pipeline cycle is the real test.
    return true;
  } catch (verifyErr) {
    console.log(`HEAL: New URL ${newUrl} is not reachable: ${verifyErr.message}`);
    return false;
  }
}

// ── Web search fallback: find catalogue URL via Firecrawl /search + FIRE-1 ranker ──
async function _webSearchForCatalogue(slug, oldUrl, homepageUrl, deps) {
  if (!deps.FIRECRAWL_API_KEY) return null;

  const agentExtract = deps.agentExtract || defaultAgentExtract;
  const houseName = HOUSE_DISPLAY_NAMES[slug] || slug;
  const domain = new URL(homepageUrl).hostname;

  // Try multiple search queries — site-scoped first, then broader
  const queries = [
    `"${houseName}" auction lots site:${domain}`,
    `"${houseName}" auction catalogue properties site:${domain}`,
    `"${houseName}" property auction current lots`,
  ];

  for (const query of queries) {
    try {
      console.log(`HEAL: Web search: "${query}"`);
      const resp = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${deps.FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 5 }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        console.log(`HEAL: Search API returned ${resp.status} — skipping`);
        continue;
      }

      const data = await resp.json();
      const results = data.data || data.results || [];
      if (results.length === 0) {
        console.log(`HEAL: No search results for "${query}"`);
        continue;
      }

      // Collect candidate URLs from search results (cap at 5 to bound FIRE-1 cost).
      const candidateUrls = results
        .map(r => r.url)
        .filter(u => typeof u === 'string' && /^https?:\/\//i.test(u))
        .slice(0, 5);

      if (candidateUrls.length === 0) continue;

      console.log(`HEAL: Got ${candidateUrls.length} candidate URLs for "${query}" — handing to FIRE-1`);

      // Hand the candidate URLs to FIRE-1 — let it visit each and pick the catalogue.
      const prompt = `You are fixing a broken UK property auction scraper for ${houseName}.

Old broken catalogue URL: ${oldUrl}
Official domain: ${domain}

Web search returned these candidate URLs. Visit each as needed and identify which one is the CURRENT property auction catalogue/lots page for ${houseName} (the page that bidders use to browse all lots in the next auction).

Prefer URLs on ${domain}. Reject news, blog, about, contact, terms, reviews, and generic homepages. Reject past/archived auctions.

Return your finding via the structured schema. If none of the candidates is a current catalogue page, return newUrl=null and confidence='none'.`;

      try {
        const agentData = await agentExtract(candidateUrls, prompt, NEW_URL_SCHEMA, { timeout: AGENT_TIMEOUT_MS });
        if (!agentData || typeof agentData !== 'object') continue;
        const parsed = (agentData.newUrl !== undefined || agentData.confidence !== undefined) ? agentData : (agentData.data || agentData.result || {});
        if (parsed.newUrl && parsed.confidence && parsed.confidence !== 'none') {
          return {
            newUrl: parsed.newUrl,
            confidence: parsed.confidence,
            reason: parsed.reason || '',
          };
        }
      } catch (agentErr) {
        console.log(`HEAL: FIRE-1 search-ranker failed for "${query}": ${agentErr.message}`);
      }
    } catch (err) {
      console.log(`HEAL: Search failed for "${query}": ${err.message}`);
    }
  }

  return null;
}

// ── Merger detection: FIRE-1 navigates the homepage to identify a new owner ──
async function _detectMerger(slug, homepageUrl, deps) {
  const agentExtract = deps.agentExtract || defaultAgentExtract;
  const houseName = HOUSE_DISPLAY_NAMES[slug] || slug;

  const prompt = `A UK auction house's website (${houseName}) appears to announce that the business has been acquired, merged with, or is now part of another company.

Navigate the homepage — including footer notices, banners, redirect pages, and "about us" content — and determine whether this auction house is now part of a different business. Look for phrases like:
- "We're now part of X"
- "Visit our new website Y"
- "Our auctions are now run by X"
- "We've been acquired by X"
- "Has joined forces with X"

Return the new owner's name and URL via the structured schema. If no merger is evident (or the signal is ambiguous), set newOwnerName=null and newOwnerUrl=null and explain why in the reason field.`;

  try {
    const data = await agentExtract(homepageUrl, prompt, MERGER_SCHEMA, { timeout: AGENT_TIMEOUT_MS });
    if (!data || typeof data !== 'object') return null;
    const parsed = (data.newOwnerName !== undefined || data.newOwnerUrl !== undefined) ? data : (data.data || data.result || {});
    if (parsed.newOwnerUrl) {
      return {
        newOwnerName: parsed.newOwnerName || null,
        newOwnerUrl: parsed.newOwnerUrl,
        reason: parsed.reason || '',
      };
    }
    return null;
  } catch (err) {
    console.log(`HEAL: FIRE-1 merger detection failed for ${slug}: ${err.message}`);
    return null;
  }
}

// ── Commit a merger: deprecate the old slug rather than replace its URL ──
async function _commitMerger(slug, mergedIntoSlug, newOwnerUrl, reason) {
  const oldName = HOUSE_DISPLAY_NAMES[slug] || slug;
  const newName = HOUSE_DISPLAY_NAMES[mergedIntoSlug] || mergedIntoSlug;
  console.log(`HEAL: ✓ MERGER detected — ${oldName} (${slug}) → ${newName} (${mergedIntoSlug}) at ${newOwnerUrl}`);

  // Drop the old slug from in-memory HOUSE_ROOTS so the next pipeline tick
  // stops scraping it. (Permanent removal lives in lib/houses.js — this
  // alert tells a human to commit that change.)
  delete HOUSE_ROOTS[slug];

  // Mark all calendar entries for the old slug as merged
  try {
    await supabase
      .from('auction_calendar')
      .update({ status: 'merged', updated_at: new Date().toISOString() })
      .eq('house_slug', slug);
  } catch { /* silent */ }

  // Surface a high-priority alert so a human can permanently remove the slug
  try {
    await supabase.from('pipeline_alerts').insert({
      event_type: 'house_merged',
      severity: 'warning',
      house: slug,
      message: `MERGER: ${oldName} has been acquired by / is now part of ${newName} (${newOwnerUrl}). Lots already flow through the '${mergedIntoSlug}' slug. The '${slug}' slug has been removed from in-memory HOUSE_ROOTS for this run; remove it permanently from lib/houses.js and clear stale lots/cache rows. Reason from page: "${(reason || '').substring(0, 200)}"`,
      meta: { merged_into: mergedIntoSlug, new_owner_url: newOwnerUrl },
    });
  } catch { /* silent */ }
}

// ── Commit the heal: update HOUSE_ROOTS, calendar, alerts ──
async function _commitHeal(slug, oldUrl, newUrl, confidence, reason) {
  console.log(`HEAL: ✓ Found new URL for ${slug}: ${newUrl} (confidence: ${confidence}, reason: ${reason})`);

  // Update in-memory HOUSE_ROOTS
  HOUSE_ROOTS[slug] = newUrl;

  // Update the calendar entry
  const { error: updateErr } = await supabase
    .from('auction_calendar')
    .update({ url: newUrl, updated_at: new Date().toISOString() })
    .eq('house_slug', slug)
    .eq('url', oldUrl);

  if (updateErr) {
    // If no exact URL match, insert a new entry
    await supabase.from('auction_calendar').insert({
      house: HOUSE_DISPLAY_NAMES[slug] || slug,
      house_slug: slug,
      logo: '🔨',
      date: new Date().toISOString().split('T')[0],
      title: 'Current Catalogue',
      url: newUrl,
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'upcoming',
      catalogue_ready: true,
      updated_at: new Date().toISOString(),
    });
  }

  // Record the successful heal
  try {
    await supabase.from('pipeline_alerts').insert({
      event_type: 'url_healed',
      severity: 'info',
      house: slug,
      message: `Self-healed ${HOUSE_DISPLAY_NAMES[slug] || slug}: ${oldUrl} → ${newUrl} (confidence: ${confidence})`,
    });
  } catch { /* silent */ }
}
