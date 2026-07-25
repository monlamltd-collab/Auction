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
// Config lives in `AUCTION_DISCOVERY` (lib/houses.js) plus platform-family
// auto-enrol (AH + EIG) via lib/pipeline/platform-discovery.js. Remaining
// Cat A/C houses stay on calendar-sync + healBrokenHouse (and AI discovery).

import { supabase } from '../supabase.js';
import {
  AUCTION_DISCOVERY,
  HOUSE_DISPLAY_NAMES,
  HOUSE_ROOTS,
  RETIRED_HOUSES,
  isEigWhitelabel,
} from '../houses.js';
import { HEADERS } from '../config.js';
import { log } from '../logging.js';
import { agentExtract as defaultAgentExtract } from '../scraper/firecrawl.js'; // KEPT: dead under CF-bypass gate, retained per owner directive
import { fetchPage } from '../scraper/http.js';
import { scrapeWithCrawlee, hasCrawlee } from '../scraper/crawlee.js';
import { callAI } from '../ai-provider.js';
import { upsertUpcomingCatalogue, retirePastUpcomingRows } from './calendar-entries.js';
import {
  getUpcomingHorizon,
  pickHorizonUpserts,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_MAX_UPSERTS,
} from './watcher-horizon.js';
import {
  resolveDiscoveryConfig,
  listWatchableSlugs,
  isAuctionWatcherExpandEnabled,
} from './platform-discovery.js';
import { AH_PLATFORM_SLUGS, fetchAhFutureDates } from './ah-resolver.js';
import { healCandidateVerdict } from './healing.js';

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
// Delegates to shared calendar-entries helper (Task 3). Unique constraint is
// still (url, date). When the AI tier can't pull a specific date, keep the
// legacy 30-day fallback so undated "current lots" links remain schedulable;
// the next watcher cycle overwrites with a real date when one appears.
async function upsertCalendarEntry(slug, entry, opts = {}) {
  const fallbackDate = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
  const res = await upsertUpcomingCatalogue(supabase, {
    slug,
    url: entry.url,
    date: entry.date || null,
    title: entry.title || (entry.date ? `${entry.date} Auction` : 'Upcoming Auction'),
    catalogueReady: entry.catalogueReady !== false,
    source: entry.source || 'auction-watcher',
    houseName: HOUSE_DISPLAY_NAMES[slug] || slug,
    allowDateFallback: true,
    fallbackDate,
    replaceSameHouseDate: true, // watcher may refresh URL for same date
    invalidateCache: true,
    dryRun: !!opts.dryRun,
  });
  if (!res.ok) {
    log.warn('auction-watcher upsert failed', {
      slug, url: entry.url, reason: res.reason, error: res.error,
    });
    return { ok: false, reason: res.reason, dryRun: !!opts.dryRun };
  }
  return { ok: true, action: res.action || 'upserted', dryRun: !!opts.dryRun, date: res.date || entry.date || null };
}

// ── Horizon health for one slug (Task 5) ─────────────────────────────
export async function fetchUpcomingHorizon(slug, opts = {}) {
  const today = opts.todayIso || new Date().toISOString().slice(0, 10);
  const horizonDays = opts.horizonDays ?? Number(process.env.WATCHER_HORIZON_DAYS || DEFAULT_HORIZON_DAYS);
  try {
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('url, date, catalogue_ready, status')
      .eq('house_slug', slug)
      .in('status', ['upcoming', 'always_on']);
    if (error) {
      // Fail open → refresh so we don't silently stop discovering
      return getUpcomingHorizon([], { todayIso: today, horizonDays });
    }
    return getUpcomingHorizon(data || [], { todayIso: today, horizonDays });
  } catch {
    return getUpcomingHorizon([], { todayIso: today, horizonDays });
  }
}

/** Resolve config: explicit AUCTION_DISCOVERY first, then AH/EIG families. */
export function resolveWatcherConfig(slug, opts = {}) {
  const expandEnabled = opts.expandEnabled ?? isAuctionWatcherExpandEnabled();
  const htmlFingerprints = opts.htmlFingerprints || null;
  return resolveDiscoveryConfig(slug, {
    explicit: AUCTION_DISCOVERY[slug] || null,
    ahSlugs: opts.ahSlugs || AH_PLATFORM_SLUGS,
    houseRoots: HOUSE_ROOTS,
    htmlFingerprints,
    expandEnabled,
  });
}

/**
 * Soft-verify AI candidates with healCandidateVerdict when HTML is cheap.
 * Non-AI tiers (regex/probe/AH schedule) skip this — they already admit
 * known patterns / platform dates.
 */
async function filterAiCandidates(slug, entries) {
  const out = [];
  for (const e of entries) {
    if (!e?.url) continue;
    if (e.source !== 'ai') {
      out.push(e);
      continue;
    }
    try {
      const html = await _fetchHtmlNonFc(e.url);
      const verdict = healCandidateVerdict(e.url, html || '', slug);
      if (!verdict.ok) {
        log.info('auction-watcher AI candidate rejected', { slug, url: e.url, reason: verdict.reason });
        continue;
      }
      out.push(e);
    } catch {
      // If fetch fails, keep candidate — better to attempt calendar write than drop
      out.push(e);
    }
  }
  return out;
}

// ── Watch one house ─────────────────────────────────────────────────
export async function watchOne(slug, opts = {}) {
  if (RETIRED_HOUSES.has(slug)) {
    return { slug, skipped: true, reason: 'retired' };
  }

  let config = opts.config || resolveWatcherConfig(slug, opts);
  // Late EIG fingerprint only when family expand is on and no config yet
  if (!config && (opts.expandEnabled ?? isAuctionWatcherExpandEnabled())) {
    const root = HOUSE_ROOTS[slug];
    if (root) {
      try {
        const html = await _fetchHtmlNonFc(root);
        if (isEigWhitelabel(html)) {
          config = resolveWatcherConfig(slug, {
            ...opts,
            htmlFingerprints: { eig: true },
          });
        }
      } catch { /* no fingerprint */ }
    }
  }
  if (!config) return { slug, skipped: true, reason: 'not Cat B / no family config' };

  // Retire past upcoming rows before deciding skip/refresh (never always_on).
  try {
    await retirePastUpcomingRows(supabase, {
      slug,
      invalidateCache: true,
      dryRun: !!opts.dryRun,
    });
  } catch (e) {
    log.warn('auction-watcher retirePast failed', { slug, error: e.message });
  }

  const horizon = await fetchUpcomingHorizon(slug, opts);
  // Skip only when horizon is healthy (unless force)
  if (!opts.force && !horizon.needsRefresh) {
    return {
      slug,
      skipped: true,
      reason: 'healthy_horizon',
      horizon,
      configSource: config.source || 'explicit',
    };
  }

  // AH family: high-confidence platform future-dates feed (optional map from parent)
  let entries = [];
  let tier = null;
  const ahMap = opts.ahFutureDates instanceof Map ? opts.ahFutureDates : null;
  if (config.platform === 'auctionhouse-uk' && ahMap?.has(slug)) {
    const url = ahMap.get(slug);
    // Extract date from path if present: /region/auction/YYYY/MM/DD
    let date = null;
    const dm = String(url).match(/\/auction\/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (dm) {
      date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
    }
    if (url && (!date || isFuture(date))) {
      entries = [{ url, date, title: null, source: 'ah-future-dates', catalogueReady: true }];
      tier = 'ah-future-dates';
    }
  }

  // Tier 1 — regex (when linkPattern present)
  if (entries.length === 0) {
    entries = await discoverViaPattern(slug, config);
    tier = entries.length > 0 ? 'regex' : null;
  }

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
      entries = await filterAiCandidates(slug, aiEntries);
      tier = 'ai';
    }
  }

  if (entries.length === 0) {
    if (_fireAlert && !opts.dryRun) {
      await _fireAlert({
        type: 'auction_watcher_miss',
        severity: 'warning',
        house: slug,
        message: `Auction watcher found no upcoming catalogue URL for ${slug}`,
      }).catch(() => {});
    }
    return { slug, found: 0, tier: null, horizon, configSource: config.source || 'explicit' };
  }

  // Upsert up to K future entries (soonest first). NEVER accept past-dated.
  // Seen live historically: Bond Wolfe, Sutton Kersh, Allsop, AH London returned 2024 links.
  const maxUpserts = opts.maxUpserts ?? Number(process.env.WATCHER_MAX_UPSERTS || DEFAULT_MAX_UPSERTS);
  const picks = pickHorizonUpserts(entries, {
    todayIso: opts.todayIso || new Date().toISOString().slice(0, 10),
    max: maxUpserts,
    isFutureFn: isFuture,
  });
  if (picks.length === 0) {
    if (_fireAlert && !opts.dryRun) {
      await _fireAlert({
        type: 'auction_watcher_only_past',
        severity: 'warning',
        house: slug,
        message: `Auction watcher only found past-dated catalogues for ${slug} — needs manual seed or homepage check`,
        meta: { rejectedDates: entries.map(e => e.date).filter(Boolean).slice(0, 3) },
      }).catch(() => {});
    }
    return {
      slug,
      found: entries.length,
      tier,
      rejected: 'all past-dated',
      horizon,
      configSource: config.source || 'explicit',
    };
  }

  const upsertResults = [];
  let upsertedCount = 0;
  for (const picked of picks) {
    const res = await upsertCalendarEntry(slug, picked, opts);
    upsertResults.push({ url: picked.url, date: picked.date || null, ...res });
    if (res.ok) upsertedCount += 1;
  }
  const picked = picks[0];
  const ok = upsertedCount > 0;

  log.info('auction-watcher discovered', {
    slug,
    tier,
    url: picked.url,
    date: picked.date,
    upserted: ok,
    upsertedCount,
    candidates: picks.length,
    configSource: config.source || 'explicit',
    dryRun: !!opts.dryRun,
  });
  return {
    slug,
    found: entries.length,
    tier,
    picked,
    picks,
    upserted: ok,
    upsertedCount,
    upsertResults,
    horizon,
    configSource: config.source || 'explicit',
  };
}

// ── Watch all configured + family-expanded houses ───────────────────
// Concurrency: 3 at a time to avoid hammering sites.
export async function watchAuctionCalendar(opts = {}) {
  const expandEnabled = opts.expandEnabled ?? isAuctionWatcherExpandEnabled();
  const slugs = opts.slugs || listWatchableSlugs({
    explicitMap: AUCTION_DISCOVERY,
    ahSlugs: AH_PLATFORM_SLUGS,
    houseRoots: HOUSE_ROOTS,
    retired: RETIRED_HOUSES,
    expandEnabled,
  });
  if (slugs.length === 0) {
    log.info('auction-watcher: no houses configured, nothing to do');
    return { slugs: 0, results: [] };
  }

  // Fetch AH platform schedule once per cycle (high confidence).
  let ahFutureDates = opts.ahFutureDates || null;
  if (!ahFutureDates && expandEnabled) {
    try {
      ahFutureDates = await fetchAhFutureDates(opts.ahFetchOpts || {});
    } catch {
      ahFutureDates = null;
    }
  }

  log.info(
    `auction-watcher: checking ${slugs.length} houses` +
    `${expandEnabled ? ' (family expand on)' : ' (explicit only)'}` +
    `${opts.force ? ' (forced)' : ''}` +
    `${opts.dryRun ? ' (dry-run)' : ''}`,
  );

  const results = [];
  const concurrency = opts.concurrency || 3;
  for (let i = 0; i < slugs.length; i += concurrency) {
    const batch = slugs.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((s) => watchOne(s, { ...opts, expandEnabled, ahFutureDates })),
    );
    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    }
    // Small gap between batches
    if (i + concurrency < slugs.length) await new Promise(r => setTimeout(r, 500));
  }

  const updated = results.filter(r => r.upserted).length;
  const missed = results.filter(r => r.found === 0).length;
  const skipped = results.filter(r => r.skipped).length;
  log.info(`auction-watcher: done — ${updated} updated, ${missed} missed, ${skipped} skipped`);
  return {
    slugs: slugs.length,
    updated,
    missed,
    skipped,
    expandEnabled,
    ahMapSize: ahFutureDates instanceof Map ? ahFutureDates.size : 0,
    results,
  };
}
