// lib/pipeline/healing.js — Self-healing for broken auction house URLs
// When a house returns 0 lots, attempts to find the new catalogue URL by (all
// non-Firecrawl):
//   A. Following server-side redirects from the old URL
//   B. Parsing /sitemap.xml for catalogue URLs
//   C. Nav-link heuristic on the homepage HTML (plain HTTP, escalating to a
//      Crawlee render when thin/blocked)
//   D. Gemini reads the homepage (via callAI) and proposes the catalogue URL
// then verifies the candidate returns content + lots and updates HOUSE_ROOTS +
// auction_calendar. Strategy E (a paid Firecrawl /v1/search web search) was
// removed 2026-06-19: hard relocations that A–D miss are handed off to Hermes's
// Dead House Recovery cron via a `relocation_needed` pipeline_alert.
//
// Has its own cooldown/backoff state (exponential: 1h → 24h → 48h → 96h, max 7d).
//
// Dependencies injected via `deps` to keep this module pure. `deps.aiExtract`
// defaults to a Gemini (callAI) structured extractor; `deps.agentExtract` is
// still honoured for legacy test stubs.

import { supabase } from '../supabase.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES, detectAuctionHouse } from '../houses.js';
import { normaliseUrl } from '../utils.js';
import { agentExtract as defaultAgentExtract } from '../scraper/firecrawl.js'; // KEPT: dead under CF-bypass gate, retained per owner directive (do not delete)
import { fetchPage } from '../scraper/http.js';
import { scrapeWithCrawlee, hasCrawlee } from '../scraper/crawlee.js';
import { callAI } from '../ai-provider.js';

// ── Non-FC page fetch: plain HTTP, escalate to Crawlee render when thin/blocked ──
// Returns '' on total failure (callers already handle empty HTML). Mirrors the
// http→crawlee fallback the engine router uses elsewhere.
async function _fetchHtmlNonFc(url) {
  let html = '';
  try {
    html = await fetchPage(url);
  } catch (e) {
    html = '';
  }
  // Thin/blocked → render via Crawlee (JS-rendered or anti-bot homepages).
  if ((!html || html.length < 500) && hasCrawlee()) {
    try {
      const r = await scrapeWithCrawlee(url);
      if (r?.html) html = r.html;
    } catch { /* leave html as-is */ }
  }
  return html || '';
}

// ── Non-FC structured extract: replaces FIRE-1 agentExtract ──
// Fetches the page(s), strips to text+links, and asks Gemini (via callAI) to fill
// the SAME schema the FIRE-1 prompt used, returned as plain JSON. Default for the
// deps.aiExtract seam; tests can still inject their own. Returns the parsed object
// or null. (Pattern proven in lib/pipeline/discovery.js::_askAIForCatalogues.)
async function defaultAiExtract(urls, prompt, schema, _options = {}) {
  const urlList = Array.isArray(urls) ? urls : [urls];
  // Gather content from each candidate URL (cap pages so a big candidate set
  // can't blow the token budget — FIRE-1 visited them; we read the first few).
  const blocks = [];
  for (const u of urlList.slice(0, 4)) {
    const html = await _fetchHtmlNonFc(u);
    if (!html) continue;
    const { stripped, hrefs } = _extractContentAndLinks(html);
    blocks.push(`URL: ${u}\nTEXT:\n${stripped.slice(0, 5000)}\nLINKS:\n${hrefs.slice(0, 40).join('\n')}`);
  }
  if (blocks.length === 0) return null;

  const fullPrompt = `${prompt}\n\nReturn ONLY a JSON object matching this schema (no prose, no markdown fences):\n${JSON.stringify(schema)}\n\n=== PAGE CONTENT ===\n${blocks.join('\n\n---\n\n')}`;
  let text;
  try {
    text = await callAI(fullPrompt, { tier: 'capable', maxTokens: 1500, taskType: 'healing' });
  } catch (e) {
    console.log(`HEAL: non-FC aiExtract callAI failed: ${e.message}`);
    return null;
  }
  try {
    let t = String(text || '').trim();
    if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const m = t.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : t);
  } catch { return null; }
}

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

// ── Junk URL filter (social / video / PDF surfaces) ──
// Pure helper that rejects non-catalogue URLs. Retained + unit-tested after the
// Strategy E web-search removal; kept as a reusable candidate-URL guard.
const JUNK_SEARCH_URL_RE = /(?:facebook\.com|fb\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|linkedin\.com|instagram\.com|tiktok\.com|reddit\.com|pinterest\.|wikipedia\.org|paperturn-view\.com|issuu\.com|scribd\.com|slideshare\.net)|\.pdf(?:\?|#|$)/i;
export function isJunkSearchUrl(url) {
  if (!url || typeof url !== 'string') return true;
  return JUNK_SEARCH_URL_RE.test(url);
}

// ── FIRE-1 call dedup ──
// Records every URL (or sorted URL list) handed to agentExtract along with
// the timestamp. A repeat call with the same key within FIRE1_DEDUP_WINDOW_MS
// is short-circuited — each heal cycle was firing the same FIRE-1 agentExtract
// against the same homepage URL multiple times within seconds (see audit
// 5.13). Process-local Map; cleared opportunistically when it grows.
const FIRE1_DEDUP_WINDOW_MS = 30 * 60 * 1000;
const _fire1CalledAt = new Map();
function _fire1DedupKey(urlOrUrls) {
  if (Array.isArray(urlOrUrls)) return urlOrUrls.slice().sort().join('|');
  return String(urlOrUrls || '');
}
export function _fire1RecentlyCalled(urlOrUrls, now = Date.now()) {
  const key = _fire1DedupKey(urlOrUrls);
  const last = _fire1CalledAt.get(key);
  return !!(last && now - last < FIRE1_DEDUP_WINDOW_MS);
}
export function _fire1MarkCalled(urlOrUrls, now = Date.now()) {
  const key = _fire1DedupKey(urlOrUrls);
  _fire1CalledAt.set(key, now);
  if (_fire1CalledAt.size > 200) {
    const cutoff = now - FIRE1_DEDUP_WINDOW_MS;
    for (const [k, t] of _fire1CalledAt) if (t < cutoff) _fire1CalledAt.delete(k);
  }
}
export function _resetFire1DedupForTests() { _fire1CalledAt.clear(); }

// ── In-memory healing state ──
// Lifetime cap: give up after N failed heals to stop indefinite credit burn on
// permanently-dead houses. Reset via SQL: UPDATE house_skills SET
// healing_attempts=0, healing_cooldown_until=NULL WHERE slug=...
const MAX_HEAL_ATTEMPTS = 8;
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
 * @param {string|undefined} [deps.FIRECRAWL_API_KEY] - DEPRECATED/unused; the FC web-search fallback (Strategy E) was removed. No longer read.
 * @param {function} [deps.scrapeWithFirecrawl] - DEPRECATED/unused after non-FC migration; kept for back-compat, no longer called
 * @param {function} [deps.aiExtract] - non-FC structured extractor (defaults to Gemini via callAI); deps.agentExtract still honoured for legacy test stubs
 * @param {object} [deps.HEADERS] - HTTP request headers (now sourced from config.js via fetchPage; retained for compatibility)
 * @returns {Promise<string|null>} The healed URL, or null
 */
export async function healBrokenHouse(slug, oldUrl, deps) {
  // No Firecrawl anywhere in healing now — the core heal runs on HTTP/Crawlee +
  // Gemini, and the FC web-search fallback (Strategy E) was removed entirely
  // (relocation rediscovery is handed off to Hermes via the relocation_needed
  // alert). Only Supabase is required.
  if (!supabase) return null;

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

  // Lifetime cap — stop auto-healing permanently-dead houses. The cooldown
  // ladder caps at 7d but `attempts` only resets on success, so a never-
  // healable house otherwise re-attempts forever at ~15-30 credits each.
  // One alert when first crossed; silent skip thereafter.
  if (attempts > MAX_HEAL_ATTEMPTS) {
    console.log(`HEAL: ${slug} exceeded MAX_HEAL_ATTEMPTS (${MAX_HEAL_ATTEMPTS}) — skipping, needs manual review`);
    if (attempts === MAX_HEAL_ATTEMPTS + 1) {
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'healing_abandoned',
          severity: 'error',
          house: slug,
          message: `Self-healing abandoned for ${HOUSE_DISPLAY_NAMES[slug] || slug} after ${MAX_HEAL_ATTEMPTS} failed attempts — needs manual review. Old URL: ${oldUrl}`,
          meta: { old_url: oldUrl, max_attempts: MAX_HEAL_ATTEMPTS, attempts },
        });
      } catch { /* silent */ }
    }
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    await _persistHealingState(slug, {
      lastAttempt: Date.now(),
      attempts: MAX_HEAL_ATTEMPTS + 1,  // sentinel: pinned past the cap
      cooldownUntil: Date.now() + SEVEN_DAYS_MS,
    });
    return null;
  }

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

    // ═══════════════════════════════════════════════════════════════
    // STRATEGY LADDER — try cheap strategies first; short-circuit on
    // first verified hit. Each strategy's candidate is verified via
    // Firecrawl scrape before commit, so we never adopt a junk URL.
    // ═══════════════════════════════════════════════════════════════

    // Strategy A: follow server-side redirects from the old URL.
    {
      const r = await _strategyFollowRedirect(oldUrl, deps);
      if (r) {
        const healed = await _tryCommitStrategyResult(slug, oldUrl, r, 'redirect-follow', deps);
        if (healed) return healed;
      }
    }

    // ── Scrape homepage (Firecrawl → plain HTTP fallback) ──
    // Needed for Strategy C, the merger check, and Strategy D (FIRE-1).
    const { html, markdown } = await _scrapeHomepage(homepageUrl, rootUrl, slug, deps);
    if (!html) {
      // Try sitemap before giving up — it doesn't need the homepage HTML.
      const r = await _strategyParseSitemap(rootUrl, deps);
      if (r) {
        const healed = await _tryCommitStrategyResult(slug, oldUrl, r, 'sitemap', deps);
        if (healed) return healed;
      }
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

    // Strategy B: parse /sitemap.xml.
    {
      const r = await _strategyParseSitemap(rootUrl, deps);
      if (r) {
        const healed = await _tryCommitStrategyResult(slug, oldUrl, r, 'sitemap', deps);
        if (healed) return healed;
      }
    }

    // Strategy C: nav-link heuristic on the homepage HTML we already have.
    {
      const r = _strategyNavLink(hrefs, rootUrl);
      if (r) {
        const healed = await _tryCommitStrategyResult(slug, oldUrl, r, 'nav-link', deps);
        if (healed) return healed;
      }
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

    // ── Strategy D: ask FIRE-1 to find the new catalogue URL ──
    let strategy = 'fire1-homepage';
    const result = await _askAIForNewUrl(slug, oldUrl, homepageUrl, deps);
    if (!result) {
      await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    if (!result.newUrl || result.confidence === 'none') {
      // A–D exhausted (redirect / sitemap / nav-link / Gemini-on-homepage all
      // missed). Hard relocations — a new domain, platform migration, or brand
      // consolidation — are handed off to Hermes's Dead House Recovery cron
      // (browser verification + web search + self-learning), not a paid inline
      // web search. Fire a dedicated `relocation_needed` alert with the
      // rediscovery context; Hermes polls these via /api/admin/alerts.
      console.log(`HEAL: A–D found no catalogue URL for ${slug} — handing off to Hermes (relocation_needed)`);
      await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'relocation_needed',
          severity: 'warning',
          house: slug,
          message: `${HOUSE_DISPLAY_NAMES[slug] || slug} went to 0 lots and in-app healing (redirect / sitemap / nav-link / homepage-AI) could not find the new catalogue URL — likely relocated, migrated platform, or consolidated. Needs rediscovery. Old URL: ${oldUrl}`,
          meta: {
            old_url: oldUrl,
            homepage_url: homepageUrl,
            strategies_tried: ['redirect-follow', 'sitemap', 'nav-link', 'homepage-ai'],
            handoff: 'hermes-dead-house-recovery',
            // Hermes (Dead House Recovery cron, deepseek-v4-pro) investigates this
            // alert and emits a structured "Dead House Recovery Report" to Telegram
            // — it does NOT edit lib/houses.js itself. Simon relays that report to
            // Claude Code, which performs the houses.js / recogniser recode.
            handoff_output: 'recovery-report-for-claude-code',
          },
        });
      } catch { /* non-fatal */ }
      return null;
    }

    // ── Validate the new URL ──
    // Strip hash fragments before comparison — SPAs like Town & Country and
    // Clarke & Simpson serialise null state to the URL hash (e.g. /search#null);
    // the fragment is browser-only and must not be committed as the catalogue URL.
    const rawUrl = result.newUrl.trim();
    const newUrl = rawUrl.includes('#') ? rawUrl.split('#')[0] : rawUrl;
    if (newUrl !== rawUrl) console.log(`HEAL: stripped hash fragment for ${slug}: ${rawUrl} → ${newUrl}`);
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
    await _commitHeal(slug, oldUrl, newUrl, result.confidence, result.reason, strategy);

    // Reset healing state on success
    await _persistHealingState(slug, { lastAttempt: Date.now(), attempts: 0, cooldownUntil: 0 });

    return newUrl;

  } catch (err) {
    console.error(`HEAL: Unexpected error healing ${slug}:`, err.message);
    await _persistHealingState(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// HEAL STRATEGY LADDER
// ═══════════════════════════════════════════════════════════════
//
// Three cheap strategies (A, B, C) run BEFORE the FIRE-1 agent (D) and the
// search-fallback (E). The goal is to recover from the common cases without
// burning Firecrawl agent credits or waiting for AI navigation:
//
//   A) Redirect-follow on the old URL  — catches server-side 301/302 rotations
//   B) Sitemap parse                   — catches well-maintained sites with /sitemap.xml
//   C) Nav-link heuristic              — catches sites whose homepage has a "Current Auction" link
//
// Each strategy returns { newUrl, confidence, reason } or null. The caller
// verifies the candidate with _verifyNewUrl before committing.

// Keywords that mark a URL as catalogue-y, in rough priority order. Used by
// both the sitemap and nav-link heuristics to score candidate URLs.
const CATALOGUE_KEYWORDS = /(catalogue|catalog|lots|current|upcoming|auction|properties)/gi;

function _scoreCatalogueUrl(u) {
  // More keyword hits = higher score; ties broken by shorter URL (closer to root).
  return (String(u).match(CATALOGUE_KEYWORDS) || []).length;
}

function _pickBestCandidate(urls) {
  const scored = urls
    .map(u => ({ u, score: _scoreCatalogueUrl(u) }))
    .filter(x => x.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.u.length - b.u.length));
  return scored[0]?.u || null;
}

// ── Strategy A: follow redirects from the old URL ──
async function _strategyFollowRedirect(oldUrl, deps) {
  try {
    const resp = await fetch(oldUrl, {
      method: 'GET',                       // HEAD is unreliable across CDNs (often 405)
      redirect: 'follow',
      headers: deps.HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const finalUrl = resp.url;
    if (!finalUrl || normaliseUrl(finalUrl) === normaliseUrl(oldUrl)) return null;
    return { newUrl: finalUrl, confidence: 'high', reason: `Server redirected ${oldUrl} → ${finalUrl}` };
  } catch { return null; }
}

// ── Strategy B: parse sitemap.xml for catalogue URLs ──
async function _strategyParseSitemap(rootUrl, deps) {
  try {
    const root = new URL(rootUrl);
    const sitemapUrl = `${root.protocol}//${root.hostname}/sitemap.xml`;
    const resp = await fetch(sitemapUrl, {
      headers: deps.HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const xml = await resp.text();
    // Collect all <loc> URLs from this sitemap (handles both urlset and sitemapindex).
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1].trim());
    // If this is a sitemap index, fetch nested sitemaps too — but cap at 3 to bound work.
    let urls = locs.filter(u => !/\.xml(\?|$)/i.test(u));
    const nested = locs.filter(u => /\.xml(\?|$)/i.test(u)).slice(0, 3);
    for (const nestedUrl of nested) {
      try {
        const r = await fetch(nestedUrl, { headers: deps.HEADERS, signal: AbortSignal.timeout(10000) });
        if (!r.ok) continue;
        const x = await r.text();
        urls.push(...[...x.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1].trim()));
      } catch { /* skip this nested sitemap */ }
    }
    // Constrain to the same hostname to avoid wandering off into externals.
    urls = urls.filter(u => { try { return new URL(u).hostname === root.hostname; } catch { return false; } });
    const best = _pickBestCandidate(urls);
    if (!best) return null;
    return { newUrl: best, confidence: 'medium', reason: `Found in ${sitemapUrl} via keyword filter` };
  } catch { return null; }
}

// ── Strategy C: heuristic scan of homepage nav links ──
// Takes the already-extracted hrefs from _scrapeHomepage — no extra fetch.
function _strategyNavLink(hrefs, rootUrl) {
  if (!hrefs || hrefs.length === 0) return null;
  let root;
  try { root = new URL(rootUrl); } catch { return null; }
  // Resolve relative URLs and keep only same-hostname links.
  const absolute = hrefs
    .map(h => { try { return new URL(h, rootUrl).toString(); } catch { return null; } })
    .filter(u => u && (() => { try { return new URL(u).hostname === root.hostname; } catch { return false; } })());
  const best = _pickBestCandidate(absolute);
  if (!best) return null;
  return { newUrl: best, confidence: 'low', reason: 'Found in homepage nav links via keyword filter' };
}

// ── Scrape homepage + root URL ──
async function _scrapeHomepage(homepageUrl, rootUrl, slug, deps) {
  // Non-FC: plain HTTP, escalate to Crawlee render when thin/blocked. The
  // merger-signal check still runs over stripped HTML text below; markdown is
  // no longer produced (FC-only), so callers must tolerate markdown=''.
  let html = await _fetchHtmlNonFc(homepageUrl);
  console.log(`HEAL: scraped ${homepageUrl} (${(html || '').length} chars HTML, non-FC)`);
  if (!html) return { html: null, markdown: '' };

  // Also try the root URL directly if different from homepage.
  let rootHtml = '';
  if (rootUrl !== homepageUrl && rootUrl !== homepageUrl + '/') {
    rootHtml = await _fetchHtmlNonFc(rootUrl);
    if (rootHtml) console.log(`HEAL: Also scraped root URL ${rootUrl} (${rootHtml.length} chars, non-FC)`);
  }

  return { html: html + '\n' + rootHtml, markdown: '' };
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
  // Non-FC default; deps.aiExtract seam preserved for tests (was deps.agentExtract).
  const aiExtract = deps.aiExtract || deps.agentExtract || defaultAiExtract;
  const houseName = HOUSE_DISPLAY_NAMES[slug] || slug;

  const prompt = `You are fixing a broken UK property auction scraper for ${houseName}.

Old catalogue URL (broken/empty): ${oldUrl}

Starting from this homepage, navigate the site as needed to find the CURRENT upcoming property auction catalogue page — the page that bidders click to browse all lots in the next auction. Prefer pages with words like "catalogue", "lots", "properties", "auction", "current", "upcoming", "search". Avoid past/archived auctions, news, blog, about, and contact pages.

Return your finding via the structured schema. Set confidence='none' and newUrl=null if no current catalogue page exists.`;

  if (_fire1RecentlyCalled(homepageUrl)) {
    console.log(`HEAL: FIRE-1 askForNewUrl skipped for ${slug} — same URL called within dedup window`);
    return null;
  }
  _fire1MarkCalled(homepageUrl);

  try {
    const data = await aiExtract(homepageUrl, prompt, NEW_URL_SCHEMA, { timeout: AGENT_TIMEOUT_MS });
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
    const verifyHtml = await _fetchHtmlNonFc(newUrl);
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

// Strategy E (Firecrawl /v1/search web-search fallback) removed 2026-06-19.
// It was the last Firecrawl spend in the pipeline. Hard relocations that A–D
// miss are now handed off to Hermes's Dead House Recovery cron via the
// `relocation_needed` alert (see healBrokenHouse above) — it has browser
// verification + web search + self-learning, with no Firecrawl credit cost.

// ── Merger detection: FIRE-1 navigates the homepage to identify a new owner ──
async function _detectMerger(slug, homepageUrl, deps) {
  const aiExtract = deps.aiExtract || deps.agentExtract || defaultAiExtract;
  const houseName = HOUSE_DISPLAY_NAMES[slug] || slug;

  const prompt = `A UK auction house's website (${houseName}) appears to announce that the business has been acquired, merged with, or is now part of another company.

Navigate the homepage — including footer notices, banners, redirect pages, and "about us" content — and determine whether this auction house is now part of a different business. Look for phrases like:
- "We're now part of X"
- "Visit our new website Y"
- "Our auctions are now run by X"
- "We've been acquired by X"
- "Has joined forces with X"

Return the new owner's name and URL via the structured schema. If no merger is evident (or the signal is ambiguous), set newOwnerName=null and newOwnerUrl=null and explain why in the reason field.`;

  if (_fire1RecentlyCalled(homepageUrl)) {
    console.log(`HEAL: FIRE-1 detectMerger skipped for ${slug} — same URL called within dedup window`);
    return null;
  }
  _fire1MarkCalled(homepageUrl);

  try {
    const data = await aiExtract(homepageUrl, prompt, MERGER_SCHEMA, { timeout: AGENT_TIMEOUT_MS });
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
// Exported so a human-verified Telegram reply (lib/pipeline/telegram-actions.js)
// can commit a merger when the supplied URL belongs to a tracked sibling.
export async function _commitMerger(slug, mergedIntoSlug, newOwnerUrl, reason) {
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

// ── Try a strategy result: validate, verify, commit. Returns the healed URL or null. ──
async function _tryCommitStrategyResult(slug, oldUrl, result, strategy, deps) {
  if (!result?.newUrl) return null;
  const newUrl = result.newUrl.trim();
  if (normaliseUrl(newUrl) === normaliseUrl(oldUrl)) {
    console.log(`HEAL[${strategy}]: candidate matches old URL, skipping (${slug})`);
    return null;
  }
  console.log(`HEAL[${strategy}]: candidate for ${slug} → ${newUrl} (${result.confidence}) — verifying`);
  const verified = await _verifyNewUrl(newUrl, slug, deps);
  if (!verified) {
    console.log(`HEAL[${strategy}]: candidate failed verification (${slug})`);
    return null;
  }
  await _commitHeal(slug, oldUrl, newUrl, result.confidence, result.reason, strategy);
  await _persistHealingState(slug, { lastAttempt: Date.now(), attempts: 0, cooldownUntil: 0 });
  return newUrl;
}

// ── Commit the heal: update HOUSE_ROOTS, calendar, alerts ──
async function _commitHeal(slug, oldUrl, newUrl, confidence, reason, strategy = 'unknown') {
  console.log(`HEAL: ✓ Found new URL for ${slug} via ${strategy}: ${newUrl} (confidence: ${confidence}, reason: ${reason})`);

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
      message: `Self-healed ${HOUSE_DISPLAY_NAMES[slug] || slug} via ${strategy}: ${oldUrl} → ${newUrl} (confidence: ${confidence})`,
      meta: { strategy, confidence, reason, old_url: oldUrl, new_url: newUrl },
    });
  } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════
// NEW-DOMAIN DRIFT CLASSIFIER (Item 2)
// ═══════════════════════════════════════════════════════════════
//
// When homepage-watch sees a URL drift to a DIFFERENT hostname, the cycle
// currently fires a "house_merger_suspected" alert and waits for a human to
// decide. Most of those drifts are actually one of:
//
//   1. Same business, moved to a new domain (e.g. parent group's hosted
//      platform) → safe to auto-accept
//   2. Acquired by a parent group we already track → should deprecate the
//      old slug and route lots through the parent
//   3. Acquired by an unknown business → human review (current behaviour)
//   4. Unrelated link / false positive → dismiss
//
// This function asks FIRE-1 to visit the candidate URL and classify it.
// We don't auto-act on the result — it only enriches the Telegram card so
// Simon can tap Accept / Snooze / Dismiss with full context.

const DRIFT_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    classification: {
      type: 'string',
      enum: ['same_business', 'merger_to_known', 'merger_to_unknown', 'unrelated'],
      description: 'How this candidate URL relates to the original auction house: same business at a new URL, merged into a known parent, merged into an unknown parent, or unrelated.',
    },
    new_owner_name: {
      type: ['string', 'null'],
      description: 'Name of the parent/acquiring business, if visible. Null otherwise.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', description: 'One-sentence explanation quoting what was seen on the page.' },
  },
  required: ['classification', 'confidence', 'reason'],
};

/**
 * Visit `candidateUrl` with FIRE-1 and classify it relative to `houseName`.
 * Returns null on error or if FIRE-1 is unavailable — caller falls back to
 * the existing "needs human" path.
 */
export async function classifyNewDomainDrift({ houseName, originalDomain, candidateUrl, deps = {} }) {
  // Non-FC: no FIRECRAWL_API_KEY gate needed — Gemini (callAI) does the classification.
  const aiExtract = deps.aiExtract || deps.agentExtract || defaultAiExtract;

  const prompt = `You are auditing a UK property auction house's website change.

Auction house: ${houseName}
Original domain: ${originalDomain}
Candidate URL (on a DIFFERENT domain): ${candidateUrl}

Visit the candidate URL and determine the relationship:
- "same_business": this is still ${houseName}, just operating at a new domain (e.g. moved to a hosted platform)
- "merger_to_known": ${houseName} has been acquired by / merged into a parent business — identify the parent's name
- "merger_to_unknown": there's a merger / acquisition but the new owner isn't obvious
- "unrelated": the candidate URL has nothing to do with ${houseName} (likely false positive — homepage just happened to link there)

Be conservative. If you can't tell, prefer "merger_to_unknown" over guessing "same_business".`;

  if (_fire1RecentlyCalled(candidateUrl)) {
    console.log(`HEAL: FIRE-1 classifyNewDomainDrift skipped — same candidate URL called within dedup window`);
    return null;
  }
  _fire1MarkCalled(candidateUrl);

  try {
    const data = await aiExtract(candidateUrl, prompt, DRIFT_CLASSIFICATION_SCHEMA, { timeout: AGENT_TIMEOUT_MS });
    if (!data || typeof data !== 'object') return null;
    const parsed = (data.classification !== undefined) ? data : (data.data || data.result || {});
    if (!parsed.classification) return null;
    return {
      classification: parsed.classification,
      newOwnerName: parsed.new_owner_name || null,
      confidence: parsed.confidence || 'low',
      reason: parsed.reason || '',
    };
  } catch (err) {
    console.log(`HEAL: classifyNewDomainDrift failed: ${err.message}`);
    return null;
  }
}

// Internal exports for tests.
export const _internal = {
  _strategyFollowRedirect,
  _strategyParseSitemap,
  _strategyNavLink,
  _pickBestCandidate,
  _scoreCatalogueUrl,
};
