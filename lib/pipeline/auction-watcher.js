// lib/pipeline/auction-watcher.js — Proactive per-auction URL discovery
//
// For Category B houses (catalogue URL changes per event, e.g. Maggs & Allen's
// `/search-auction/?auction=N`, SDL date-stamped paths), this watcher runs
// before the main scrape each overnight cycle and discovers the current
// upcoming auction's URL, upserting it into `auction_calendar`.
//
// Three-tier discovery ladder:
//   1. Pattern match — per-house regex against the plain-HTTP homepage (free)
//   2. AI fallback   — Firecrawl FIRE-1 agent navigates the homepage and
//                      returns up to 3 future auction catalogue URLs
//   3. Skip          — if both fail, leave calendar as-is and fire an alert
//
// Config lives in `AUCTION_DISCOVERY` (lib/houses.js). Houses not listed
// there are assumed Category A/C and skipped — they're handled by the
// existing calendar-sync + healBrokenHouse flow.

import { supabase } from '../supabase.js';
import { AUCTION_DISCOVERY, HOUSE_DISPLAY_NAMES, HOUSE_ROOTS } from '../houses.js';
import { HEADERS } from '../config.js';
import { log } from '../logging.js';
import { agentExtract as defaultAgentExtract } from '../scraper/firecrawl.js'; // KEPT: dead under CF-bypass gate, retained per owner directive
import { _invalidateCalendarCache } from './persist-lots.js';
import { fetchPage } from '../scraper/http.js';
import { scrapeWithCrawlee, hasCrawlee } from '../scraper/crawlee.js';
import { callAI } from '../ai-provider.js';

// Injected deps (wired by initWatcher)
let _scrapeWithFirecrawl = null; // KEPT for back-compat; no longer the path reached for the index-page escalation
let _aiExtract = null;
let _fireAlert = null;
let _budget = null;

export function initWatcher({ scrapeWithFirecrawl, agentExtract, aiExtract, fireAlert, budget }) {
  _scrapeWithFirecrawl = scrapeWithFirecrawl;
  // Seam preserved: prefer explicit aiExtract, then legacy agentExtract stub, then the non-FC Gemini default.
  _aiExtract = aiExtract || agentExtract || defaultAiExtract;
  _fireAlert = fireAlert;
  _budget = budget;
}

// ── Non-FC page fetch (HTTP → Crawlee escalation) ──
async function _fetchHtmlNonFc(url) {
  let html = '';
  try { html = await fetchPage(url); } catch { html = ''; }
  if ((!html || html.length < 500) && hasCrawlee()) {
    try { const r = await scrapeWithCrawlee(url); if (r?.html) html = r.html; } catch { /* keep html */ }
  }
  return html || '';
}

// ── Non-FC structured extract (replaces FIRE-1 agentExtract) ──
// Fetches the homepage, strips to text, asks Gemini (callAI) to fill DISCOVER_SCHEMA.
async function defaultAiExtract(urls, prompt, schema, _options = {}) {
  const url = Array.isArray(urls) ? urls[0] : urls;
  const html = await _fetchHtmlNonFc(url);
  if (!html) return null;
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 8000);
  const hrefs = [...new Set([...html.matchAll(/href="([^"]+)"/gi)].map(m => m[1]))]
    .filter(h => !h.startsWith('#') && !h.startsWith('javascript:') && !h.startsWith('mailto:'))
    .slice(0, 60);
  const fullPrompt = `${prompt}\n\nReturn ONLY a JSON object matching this schema (no prose, no markdown fences):\n${JSON.stringify(schema)}\n\n=== PAGE TEXT ===\n${stripped}\n\n=== LINKS ===\n${hrefs.join('\n')}`;
  let text;
  try {
    text = await callAI(fullPrompt, { tier: 'capable', maxTokens: 2000, taskType: 'auction-watcher' });
  } catch (e) {
    log.warn('auction-watcher non-FC aiExtract callAI failed', { url, error: e.message });
    return null;
  }
  try {
    let t = String(text || '').trim();
    if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const m = t.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : t);
  } catch { return null; }
}

// JSON schema FIRE-1 fills for upcoming-auction discovery.
const DISCOVER_SCHEMA = {
  type: 'object',
  properties: {
    auctions: {
      type: 'array',
      description: 'Up to 3 future property auction catalogue URLs, soonest first. Empty array if none.',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL of the catalogue page' },
          date: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD of the auction, or null if unknown. Must be today or later.' },
          title: { type: ['string', 'null'], description: 'Short human-readable title, e.g. "May 2026 Auction"' },
        },
        required: ['url'],
      },
    },
  },
  required: ['auctions'],
};

const WATCHER_AGENT_TIMEOUT_MS = 90000;

// ── Capture-group extraction ────────────────────────────────────────
// linkPattern may have alternating groups (e.g. month-slug OR numeric ID).
// This helper returns the first non-undefined capture group value.
function extractMatchId(m) {
  for (let i = 1; i < m.length; i++) {
    if (m[i] !== undefined) return m[i];
  }
  return null;
}

// ── Month-name → 1-12 ─────────────────────────────────────────────
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseUkDate(text) {
  if (!text) return null;
  // e.g. "Wednesday 14th May 2026", "14 May 2026", "14-May-2026", "14/05/2026"
  const m1 = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (m1) {
    const day = parseInt(m1[1], 10);
    const mo = MONTHS[m1[2].slice(0, 3).toLowerCase()];
    const yr = parseInt(m1[3], 10);
    if (mo && day >= 1 && day <= 31) return `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const m2 = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (m2) {
    const day = parseInt(m2[1], 10);
    const mo = parseInt(m2[2], 10);
    const yr = parseInt(m2[3], 10);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) return `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function isFuture(isoDate) {
  if (!isoDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return isoDate >= today;
}

// ── Tier 1 — Pattern match on plain-HTTP homepage ───────────────────
// Returns [{ url, date, source: 'regex' }] sorted ascending by date.
async function discoverViaPattern(slug, config) {
  const homepage = config.homepage || HOUSE_ROOTS[slug];
  if (!homepage || !config.linkPattern) return [];

  let html = '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(homepage, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    html = await resp.text();
  } catch {
    return [];
  }

  // Ensure the pattern has the /g flag so matchAll works
  const flags = config.linkPattern.flags.includes('g') ? config.linkPattern.flags : config.linkPattern.flags + 'g';
  const pattern = new RegExp(config.linkPattern.source, flags);

  const found = [];
  const seen = new Set();

  for (const m of html.matchAll(pattern)) {
    const auctionId = extractMatchId(m);
    if (!auctionId || seen.has(auctionId)) continue;
    seen.add(auctionId);

    // Try to find a nearby date in the surrounding DOM context (±400 chars around the match)
    const ctxStart = Math.max(0, m.index - 400);
    const ctxEnd = Math.min(html.length, m.index + 400);
    const ctx = html.slice(ctxStart, ctxEnd).replace(/<[^>]+>/g, ' ');
    const date = parseUkDate(ctx);

    const url = config.buildUrl ? config.buildUrl(auctionId) : m[0];
    found.push({ url, date, auctionId, source: 'regex' });
  }

  // Sort by date ascending (future dates first), undated last
  found.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  });

  return found;
}

// ── Tier 1.5 — Probe-and-verify (EIG white-label specific) ──────────
// For EIG white-label houses (Hollis Morgan, Maggs & Allen, …) the regex
// often surfaces multiple candidate URLs and the homepage HTML doesn't
// reliably carry the auction date next to the link. So we:
//   1. Pull candidates from the homepage AND the auctionsIndexPath page
//   2. Probe each candidate URL with plain HTTP and read the auction date
//      out of the page header (e.g. "NEXT AUCTION: <span>20 May 2026</span>")
//   3. Return only entries with a verified future date
async function discoverViaProbe(slug, config) {
  const homepage = config.homepage || HOUSE_ROOTS[slug];
  if (!homepage || !config.linkPattern) return [];

  // Wrap fetch with a hard 15s timeout. The try/finally ensures the abort
  // timer is cleared even when fetch throws — otherwise the timer fires later
  // and tries to abort an already-completed (or already-failed) request.
  async function timedFetch(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    } finally {
      clearTimeout(timeout);
    }
  }

  // Build the URL list — homepage links plus optional auctionsIndexPath links.
  // Tries plain HTTP first; escalates to Firecrawl for the index page when the
  // site uses JS rendering (common on EIG white-label) and plain HTTP yields nothing.
  const candidateIds = new Set();
  const flags = config.linkPattern.flags.includes('g') ? config.linkPattern.flags : config.linkPattern.flags + 'g';
  const re = new RegExp(config.linkPattern.source, flags);

  function harvestHtml(html) {
    for (const m of html.matchAll(re)) {
      const id = extractMatchId(m);
      if (id) candidateIds.add(id);
    }
  }

  async function harvest(url) {
    try {
      const resp = await timedFetch(url);
      if (!resp.ok) return;
      harvestHtml(await resp.text());
    } catch {}
  }

  await harvest(homepage);

  let idxUrl = null;
  if (config.auctionsIndexPath) {
    try { idxUrl = new URL(config.auctionsIndexPath, homepage).href; } catch { idxUrl = null; }
    if (idxUrl) {
      const beforeIdx = candidateIds.size;
      await harvest(idxUrl);
      // Escalate to a Crawlee render (non-FC) when plain HTTP found nothing new
      // from the index page — EIG white-label and similar JS-rendered sites don't
      // expose auction links in static HTML.
      if (candidateIds.size === beforeIdx && hasCrawlee()) {
        try {
          const result = await scrapeWithCrawlee(idxUrl);
          if (result?.html) harvestHtml(result.html);
        } catch {}
      }
    }
  }

  if (candidateIds.size === 0) return [];

  // Probe each candidate URL — read the auction date from the page itself.
  // Throttle to 250ms between requests to avoid hammering the auction site
  // when the candidate set grows (a runaway homepage could surface dozens).
  const PROBE_GAP_MS = 250;
  const probed = [];
  let firstProbe = true;
  for (const id of candidateIds) {
    if (!firstProbe) await new Promise(r => setTimeout(r, PROBE_GAP_MS));
    firstProbe = false;
    const url = config.buildUrl ? config.buildUrl(id) : null;
    if (!url) continue;
    let pageHtml = '';
    try {
      const resp = await timedFetch(url);
      if (!resp.ok) continue;
      pageHtml = await resp.text();
    } catch { continue; }

    // Strip tags so parseUkDate can reach the text. Look near phrases that
    // EIG white-label templates use to label the upcoming auction.
    const stripped = pageHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    let date = null;
    // Prefer text that's explicitly labelled "Next Auction" / "Auction Date"
    const labelled = stripped.match(/(?:Next\s+Auction|Auction\s+Date|Auction\s*:)[^A-Za-z0-9]{1,40}([^.<]{4,80})/i);
    if (labelled) date = parseUkDate(labelled[1]);
    if (!date) date = parseUkDate(stripped.slice(0, 4000));

    probed.push({ url, date, auctionId: id, source: 'probe' });
  }

  // Sort: dated-future first, dated-past last, dateless in the middle
  probed.sort((a, b) => {
    const af = a.date && isFuture(a.date) ? 0 : a.date ? 2 : 1;
    const bf = b.date && isFuture(b.date) ? 0 : b.date ? 2 : 1;
    if (af !== bf) return af - bf;
    if (a.date && b.date) return a.date < b.date ? -1 : 1;
    return 0;
  });

  return probed;
}

// ── Tier 2 — AI fallback (Firecrawl FIRE-1 agent navigates the homepage) ──
async function discoverViaAI(slug, config) {
  if (!_aiExtract) return [];
  // Non-FC Tier 2: no Firecrawl-budget gate — Gemini (callAI) has its own budget
  // (AI_DAILY_BUDGET) and provider cascade. Previously this returned [] whenever
  // Firecrawl was unavailable, which under the CF-bypass gate was ALWAYS.

  const homepage = config.homepage || HOUSE_ROOTS[slug];
  if (!homepage) return [];

  const displayName = HOUSE_DISPLAY_NAMES[slug] || slug;
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `${displayName} is a UK property auction house. TODAY IS ${today}.

Starting from this homepage, navigate the site as needed and find up to 3 FUTURE auction catalogue URLs — the pages bidders click to see all lots for an auction that HASN'T YET HAPPENED.

For each, return:
  - url: absolute URL of the catalogue page
  - date: ISO date (YYYY-MM-DD) of the auction, must be >= ${today}, or null if genuinely unknown
  - title: short human-readable title (e.g. "May 2026 Auction"), or null

IGNORE past/archived auctions (dates before ${today}). DO NOT return past auctions under any circumstances. If no future auction is listed, return an empty array.

Return the array of auctions soonest-first via the structured schema.`;

  let data;
  try {
    data = await _aiExtract(homepage, prompt, DISCOVER_SCHEMA, { timeout: WATCHER_AGENT_TIMEOUT_MS });
  } catch (e) {
    log.warn('auction-watcher Tier 2 FIRE-1 call failed', { slug, error: e.message });
    return [];
  }
  if (!data || typeof data !== 'object') return [];

  // FIRE-1 may return the schema object directly or wrap it under data/result.
  const wrapper = (Array.isArray(data.auctions)) ? data : (data.data || data.result || {});
  const auctions = Array.isArray(wrapper.auctions) ? wrapper.auctions : [];
  if (auctions.length === 0) return [];

  const out = [];
  for (const entry of auctions) {
    if (!entry?.url) continue;
    let url = entry.url;
    if (!/^https?:\/\//i.test(url)) {
      try { url = new URL(url, homepage).href; } catch { continue; }
    }
    out.push({
      url,
      date: entry.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : null,
      title: entry.title || null,
      source: 'ai',
    });
  }
  return out;
}

// ── Persist discovered auction into auction_calendar ────────────────
// The table's unique constraint is (url, date). Postgres treats NULL != NULL
// so a null date breaks upsert conflict resolution. When the AI tier can't
// pull a specific date, default to 30 days out — the watcher's next cycle
// will overwrite with a real date if one appears on the homepage later.
async function upsertCalendarEntry(slug, entry) {
  const fallbackDate = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
  const row = {
    house: HOUSE_DISPLAY_NAMES[slug] || slug,
    house_slug: slug,
    logo: '🔨',
    date: entry.date || fallbackDate,
    title: entry.title || (entry.date ? `${entry.date} Auction` : 'Upcoming Auction'),
    url: entry.url,
    location: 'UK',
    type: 'Residential & Commercial',
    status: 'upcoming',
    catalogue_ready: true,
    updated_at: new Date().toISOString(),
  };
  try {
    const { error } = await supabase.from('auction_calendar').upsert(row, { onConflict: 'url,date' });
    if (error) throw error;
    // Drop the persist-lots URL→date cache so the new entry is visible
    // on the next upsert without waiting out the 5-min TTL.
    _invalidateCalendarCache();
    return true;
  } catch (e) {
    log.warn('auction-watcher upsert failed', { slug, url: entry.url, error: e.message });
    return false;
  }
}

// ── Check whether we already have a fresh upcoming entry ────────────
async function hasFreshUpcomingEntry(slug) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('url, date, catalogue_ready')
      .eq('house_slug', slug)
      .eq('status', 'upcoming')
      .gte('date', today)
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return !!data?.url;
  } catch {
    return false;
  }
}

// ── Watch one house ─────────────────────────────────────────────────
export async function watchOne(slug, opts = {}) {
  const config = AUCTION_DISCOVERY[slug];
  if (!config) return { slug, skipped: true, reason: 'not Cat B' };

  // Skip if we already have a fresh future-dated entry and this isn't a forced run
  if (!opts.force && await hasFreshUpcomingEntry(slug)) {
    return { slug, skipped: true, reason: 'already has upcoming entry' };
  }

  // Tier 1 — regex
  let entries = await discoverViaPattern(slug, config);
  let tier = entries.length > 0 ? 'regex' : null;

  // Tier 1.5 — probe-and-verify (EIG white-label houses).
  // The bare regex tier is unreliable for EIG white-label sites because the
  // homepage often surfaces *both* archived and upcoming-auction links and
  // the nearest date in the surrounding HTML maps to the wrong one. The probe
  // tier visits each candidate URL and reads the auction date from the page
  // itself, then keeps only future-dated entries.
  const wantsProbe = config.platform === 'eig-whitelabel';
  const tier1HasFuture = entries.some(e => isFuture(e.date));
  if (wantsProbe && !tier1HasFuture) {
    const probed = await discoverViaProbe(slug, config);
    if (probed.length > 0) {
      entries = probed;
      tier = 'probe';
    }
  }

  // Tier 2 — AI (only if earlier tiers returned nothing with a future date)
  const hasFuture = entries.some(e => isFuture(e.date));
  if (!hasFuture && !opts.skipAi) {
    const aiEntries = await discoverViaAI(slug, config);
    if (aiEntries.length > 0) {
      entries = aiEntries;
      tier = 'ai';
    }
  }

  if (entries.length === 0) {
    if (_fireAlert) {
      await _fireAlert({
        type: 'auction_watcher_miss',
        severity: 'warning',
        house: slug,
        message: `Auction watcher found no upcoming catalogue URL for ${slug}`,
      }).catch(() => {});
    }
    return { slug, found: 0, tier: null };
  }

  // Upsert the best candidate — either dated-and-future, or dateless (likely
  // a "current lots" link that doesn't carry a specific date). NEVER accept
  // a past-dated entry — those are archived auctions and pollute the
  // calendar with two-year-old URLs. Seen live during testing: Bond Wolfe,
  // Sutton Kersh, Allsop, AH London, Charles Darrow all returned 2024 links.
  const acceptable = entries.filter(e => !e.date || isFuture(e.date));
  if (acceptable.length === 0) {
    if (_fireAlert) {
      await _fireAlert({
        type: 'auction_watcher_only_past',
        severity: 'warning',
        house: slug,
        message: `Auction watcher only found past-dated catalogues for ${slug} — needs manual seed or homepage check`,
        meta: { rejectedDates: entries.map(e => e.date).filter(Boolean).slice(0, 3) },
      }).catch(() => {});
    }
    return { slug, found: entries.length, tier, rejected: 'all past-dated' };
  }
  // Prefer dated-future; fall back to dateless. Within each group, soonest first.
  const dated = acceptable.filter(e => e.date);
  const undated = acceptable.filter(e => !e.date);
  const picked = dated[0] || undated[0];
  const ok = await upsertCalendarEntry(slug, picked);

  log.info('auction-watcher discovered', {
    slug, tier, url: picked.url, date: picked.date, upserted: ok,
  });
  return { slug, found: entries.length, tier, picked, upserted: ok };
}

// ── Watch all configured Cat B houses ───────────────────────────────
// Concurrency: 3 at a time to avoid hammering sites.
export async function watchAuctionCalendar(opts = {}) {
  const slugs = Object.keys(AUCTION_DISCOVERY);
  if (slugs.length === 0) {
    log.info('auction-watcher: no Cat B houses configured, nothing to do');
    return { slugs: 0, results: [] };
  }
  log.info(`auction-watcher: checking ${slugs.length} Cat B houses${opts.force ? ' (forced)' : ''}`);

  const results = [];
  const concurrency = opts.concurrency || 3;
  for (let i = 0; i < slugs.length; i += concurrency) {
    const batch = slugs.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(s => watchOne(s, opts)));
    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    }
    // Small gap between batches
    if (i + concurrency < slugs.length) await new Promise(r => setTimeout(r, 500));
  }

  const updated = results.filter(r => r.upserted).length;
  const missed = results.filter(r => r.found === 0).length;
  log.info(`auction-watcher: done — ${updated} updated, ${missed} missed, ${results.length - updated - missed} skipped`);
  return { slugs: slugs.length, updated, missed, results };
}
