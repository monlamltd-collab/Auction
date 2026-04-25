// lib/pipeline/healing.js — Self-healing for broken auction house URLs
// When a house returns 0 lots, attempts to find the new catalogue URL by:
//   1. Scraping the house homepage (Firecrawl → plain HTTP fallback)
//   2. Asking Gemini to identify the new catalogue URL from links + content
//   3. If homepage analysis fails, web search fallback (Google-style query via Firecrawl)
//   4. Verifying the candidate URL returns content + lots
//   5. Updating HOUSE_ROOTS + auction_calendar
//
// Has its own cooldown/backoff state (exponential: 24h → 48h → 96h, max 7d).
//
// Dependencies injected via `deps` to keep this module pure.

import { supabase } from '../supabase.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES, detectAuctionHouse } from '../houses.js';
import { normaliseUrl } from '../utils.js';

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
 * @param {function} deps.callAI
 * @param {function} deps.extractWithJSDOM
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
  // Exponential backoff: 24h, 48h, 96h after each failed attempt (max 7 days)
  const cooldownMs = Math.min(24 * 60 * 60 * 1000 * Math.pow(2, attempts - 1), 7 * 24 * 60 * 60 * 1000);

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
      const merger = await _detectMerger(slug, stripped, hrefs, markdown, deps);
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

    // ── Ask Gemini to find the new catalogue URL ──
    const result = await _askAIForNewUrl(slug, oldUrl, homepageUrl, stripped, hrefs, markdown, deps);
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

// ── Ask Gemini to identify the new catalogue URL ──
async function _askAIForNewUrl(slug, oldUrl, homepageUrl, stripped, hrefs, markdown, deps) {
  const aiText = await deps.callAI(`You are helping fix a broken auction house scraper. The catalogue URL for this auction house has stopped returning lots.

House: ${HOUSE_DISPLAY_NAMES[slug] || slug}
Old catalogue URL (now broken/empty): ${oldUrl}
Homepage: ${homepageUrl}

Here is the text content from the house's website:
${stripped}

Here are all links found on the page:
${hrefs.join('\n')}

${markdown ? `\nMarkdown content:\n${(markdown || '').substring(0, 4000)}` : ''}

TASK: Find the CURRENT catalogue/lots page URL for this auction house. The old URL "${oldUrl}" is no longer working. Look for:
- Links containing words like "catalogue", "lots", "properties", "auction", "current", "upcoming", "search"
- Links that match the pattern of the old URL but with updated paths/dates
- The main page where auction lots are listed for browsing

Return ONLY valid JSON: {"newUrl": "https://...", "confidence": "high|medium|low", "reason": "brief explanation"}
If you cannot find a catalogue URL, return: {"newUrl": null, "confidence": "none", "reason": "explanation"}`, {
    tier: 'capable',
    maxTokens: 500,
    taskType: 'healing',
  });

  try {
    let text = aiText.trim();
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(text);
  } catch {
    console.log(`HEAL: Failed to parse AI response for ${slug}`);
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
    if (deps.extractWithJSDOM) {
      const testLots = deps.extractWithJSDOM(verifyHtml, slug, newUrl);
      if (testLots && testLots.length > 0) {
        console.log(`HEAL: Verification passed — DOM extracted ${testLots.length} lots from ${newUrl}`);
      } else {
        console.log(`HEAL: DOM extraction found 0 lots on ${newUrl} — may need Gemini fallback (proceeding with caution)`);
      }
    }
    return true;
  } catch (verifyErr) {
    console.log(`HEAL: New URL ${newUrl} is not reachable: ${verifyErr.message}`);
    return false;
  }
}

// ── Web search fallback: find catalogue URL via Google-style search ──
async function _webSearchForCatalogue(slug, oldUrl, homepageUrl, deps) {
  if (!deps.FIRECRAWL_API_KEY) return null;

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

      // Build a summary of search results for AI to evaluate
      const resultSummary = results.map((r, i) =>
        `${i + 1}. ${r.title || '(no title)'}\n   URL: ${r.url}\n   ${(r.description || r.snippet || '').substring(0, 200)}`
      ).join('\n\n');

      console.log(`HEAL: Got ${results.length} search results for "${query}"`);

      // Ask AI to pick the best catalogue URL from search results
      const aiText = await deps.callAI(`You are helping fix a broken auction house scraper.

House: ${houseName}
Old broken URL: ${oldUrl}
Domain: ${domain}

Web search results for this auction house:

${resultSummary}

TASK: Which search result is the auction catalogue/lots page for ${houseName}?
Look for URLs containing: lots, properties, catalogue, auction, current, search, available
Avoid: news, blog, about, contact, terms, reviews, generic homepage

Return ONLY valid JSON: {"newUrl": "https://...", "confidence": "high|medium|low", "reason": "brief explanation"}
If none of the results are a catalogue page, return: {"newUrl": null, "confidence": "none", "reason": "explanation"}`, {
        tier: 'capable',
        maxTokens: 500,
        taskType: 'healing',
      });

      try {
        let text = aiText.trim();
        if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        const parsed = JSON.parse(text);
        if (parsed.newUrl && parsed.confidence !== 'none') {
          return parsed;
        }
      } catch {
        console.log(`HEAL: Failed to parse AI search response for ${slug}`);
      }
    } catch (err) {
      console.log(`HEAL: Search failed for "${query}": ${err.message}`);
    }
  }

  return null;
}

// ── Merger detection: ask AI to identify the new owner from merger phrases ──
async function _detectMerger(slug, stripped, hrefs, markdown, deps) {
  const houseName = HOUSE_DISPLAY_NAMES[slug] || slug;
  const aiText = await deps.callAI(`A UK auction house's website appears to announce that the business has been acquired by, merged with, or is now part of another company. Identify the NEW OWNER.

House: ${houseName}

Page text:
${stripped}

Page links:
${hrefs.join('\n')}

${markdown ? `\nMarkdown excerpt:\n${(markdown || '').substring(0, 3000)}` : ''}

TASK: Find the auction business that ${houseName} is now part of. Look for phrases like:
- "We're now part of X"
- "Visit our new website Y"
- "Our auctions are now run by X"
- "We've been acquired by X"

Return ONLY valid JSON: {"newOwnerName": "...", "newOwnerUrl": "https://...", "reason": "quote the announcement"}
If no merger announcement is present (or it's ambiguous), return: {"newOwnerName": null, "newOwnerUrl": null, "reason": "..."}`, {
    tier: 'capable',
    maxTokens: 400,
    taskType: 'merger_detection',
  });

  try {
    let text = aiText.trim();
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(text);
    if (parsed.newOwnerUrl) return parsed;
    return null;
  } catch {
    console.log(`HEAL: Failed to parse merger detection response for ${slug}`);
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
