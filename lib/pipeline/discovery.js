// lib/pipeline/discovery.js — Catalogue URL discovery
// Scans auction house homepages to find new catalogue URLs that aren't
// yet in the calendar (or next sales for houses already scheduled).
// Uses plain HTTP / Crawlee + Gemini extraction.
//
// Runs AFTER the scrape cycle (Step 4 in _doAutoAnalyseAll) so users see
// fresh lots before we spend credits on discovery.
//
// Task 4: eligibility is classification + horizon based — NOT "skip if any row".
// Dependencies injected via `deps` to keep this module testable.

import { supabase } from '../supabase.js';
import {
  HOUSE_ROOTS,
  HOUSE_DISPLAY_NAMES,
  RETIRED_HOUSES,
  AUCTION_DISCOVERY,
} from '../houses.js';
import { upsertUpcomingCatalogue, retirePastUpcomingRows } from './calendar-entries.js';
import { fetchPage } from '../scraper/http.js';
import { scrapeWithCrawlee, hasCrawlee } from '../scraper/crawlee.js';
import { healCandidateVerdict } from './healing.js';
import {
  evaluateDiscoveryEligibility,
  selectDiscoveryTargets,
  DEFAULT_DARK_BUDGET,
  DEFAULT_RECHECK_BUDGET,
  DEFAULT_RECHECK_DAYS,
} from './discovery-eligibility.js';
import { AH_PLATFORM_SLUGS } from './ah-resolver.js';
import { DEFAULT_HORIZON_DAYS } from './watcher-horizon.js';
import { getWatcherHandledSlugs } from './cycle-coordination.js';

let _consecutiveMisses = 0;

/**
 * @param {object} deps - Injected dependencies
 * @param {string|undefined} deps.FIRECRAWL_API_KEY
 * @param {function} deps.isFcCreditExhausted
 * @param {function} deps.scrapeWithFirecrawl
 * @param {function} deps.callAI
 * @param {object} deps.HEADERS - HTTP request headers
 * @param {boolean} [deps.dryRun]
 * @param {boolean} [deps.force]
 * @param {Set<string>|string[]} [deps.watcherHandledSlugs]
 * @param {string} [deps.todayIso]
 * @returns {Promise<{ discovered: number, errors: number, selected?: number, evaluated?: number, dryRun?: boolean, candidates?: object[] }>}
 */
export async function discoverAndUpdateCalendar(deps = {}) {
  if (!process.env.GEMINI_API_KEY && !deps.callAI) {
    return { discovered: 0, errors: 0, skipped: true, reason: 'no_gemini' };
  }
  if (!supabase && !deps.dryRun) {
    return { discovered: 0, errors: 0, skipped: true, reason: 'no_supabase' };
  }

  const todayIso = deps.todayIso || new Date().toISOString().slice(0, 10);
  const dryRun = !!deps.dryRun;
  const horizonDays = Number(process.env.WATCHER_HORIZON_DAYS || DEFAULT_HORIZON_DAYS);
  const recheckDays = Number(process.env.DISCOVERY_RECHECK_DAYS || DEFAULT_RECHECK_DAYS);
  const darkBudget = Number(process.env.DISCOVERY_DARK_BUDGET || DEFAULT_DARK_BUDGET);
  const recheckBudget = Number(process.env.DISCOVERY_RECHECK_BUDGET || DEFAULT_RECHECK_BUDGET);

  // Soft retire past upcoming globally once per discovery pass (never always_on).
  try {
    await retirePastUpcomingRows(supabase, {
      todayIso,
      invalidateCache: !dryRun,
      dryRun,
    });
  } catch (e) {
    console.log(`AUTO-DISCOVER: retirePast failed: ${e.message}`);
  }

  // Load calendar spine for classification + horizon
  let calRows = [];
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('auction_calendar')
        .select('house_slug, status, date, url, catalogue_ready, updated_at')
        .in('status', ['upcoming', 'always_on', 'past']);
      if (error) throw error;
      calRows = data || [];
    } catch (e) {
      console.log(`AUTO-DISCOVER: calendar load failed: ${e.message}`);
      calRows = [];
    }
  }

  // Optional homepage-watch signals (no migration)
  let hwBySlug = new Map();
  if (supabase) {
    try {
      const { data } = await supabase
        .from('house_homepage_watch')
        .select('slug, last_next_auction_date, last_extracted_catalogue_url, updated_at');
      for (const r of data || []) {
        if (r?.slug) hwBySlug.set(r.slug, r);
      }
    } catch {
      hwBySlug = new Map();
    }
  }

  // Optional last discovery attempt from pipeline_alerts (no migration)
  let lastDiscoveryBySlug = new Map();
  if (supabase) {
    try {
      const since = new Date(Date.now() - 40 * 86400 * 1000).toISOString();
      const { data } = await supabase
        .from('pipeline_alerts')
        .select('house, created_at, event_type, message')
        .eq('event_type', 'discovery_attempt')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500);
      for (const r of data || []) {
        const s = r.house;
        if (s && !lastDiscoveryBySlug.has(s)) lastDiscoveryBySlug.set(s, r.created_at);
      }
    } catch {
      lastDiscoveryBySlug = new Map();
    }
  }

  const bySlug = new Map();
  for (const r of calRows) {
    const s = r.house_slug;
    if (!s) continue;
    if (!bySlug.has(s)) bySlug.set(s, []);
    bySlug.get(s).push(r);
  }

  const watcherHandled = deps.watcherHandledSlugs instanceof Set
    ? deps.watcherHandledSlugs
    : deps.watcherHandledSlugs
      ? new Set(deps.watcherHandledSlugs)
      : getWatcherHandledSlugs();

  const evaluations = [];
  for (const slug of Object.keys(HOUSE_ROOTS)) {
    if (RETIRED_HOUSES.has(slug)) {
      evaluations.push({
        slug,
        ...evaluateDiscoveryEligibility({
          slug,
          todayIso,
          horizonDays,
          recheckDays,
          classifyInput: { slug, retired: true },
        }),
      });
      continue;
    }
    const rows = bySlug.get(slug) || [];
    const hw = hwBySlug.get(slug) || null;
    if (AUCTION_DISCOVERY[slug]?.requireCandidateDateVerification) {
      // Strict rolling pages (McHugh) are owned by the watcher, which binds
      // live-lot evidence to the exact advertised date. Generic AI discovery
      // must not bypass that stronger proof.
      evaluations.push({ slug, eligible: false, reason: 'strict_watcher_owned', priority: 0, bucket: 'none' });
      continue;
    }
    const platformHints = {
      ah: AH_PLATFORM_SLUGS.has(slug),
      eig: !!(AUCTION_DISCOVERY[slug]?.platform === 'eig-whitelabel'),
    };

    const lastDiscoveryAttemptAt = lastDiscoveryBySlug.get(slug) || null;
    const lastSignalAt = lastDiscoveryAttemptAt || hw?.updated_at || null;
    const ev = evaluateDiscoveryEligibility({
      slug,
      todayIso,
      horizonDays,
      recheckDays,
      force: !!deps.force,
      handledByWatcherThisCycle: watcherHandled.has(slug),
      lastDiscoveryAt: lastSignalAt,
      calendarRows: rows,
      classifyInput: {
        slug,
        rootUrl: HOUSE_ROOTS[slug],
        calendarRows: rows,
        discoveryConfig: AUCTION_DISCOVERY[slug] || null,
        platformHints,
        homepageWatch: hw
          ? {
              last_next_auction_date: hw.last_next_auction_date,
              last_extracted_catalogue_url: hw.last_extracted_catalogue_url,
            }
          : null,
        retired: RETIRED_HOUSES.has(slug),
        todayIso,
      },
    });
    evaluations.push({ slug, lastDiscoveryAt: lastDiscoveryAttemptAt, ...ev });
  }

  const { selected, darkUsed, recheckUsed, eligibleCount } = selectDiscoveryTargets(evaluations, {
    darkBudget,
    recheckBudget,
  });

  console.log(
    `AUTO-DISCOVER: Eligible ${eligibleCount}/${evaluations.length} → selected ${selected.length}` +
    ` (darkBudget ${darkUsed}/${darkBudget}, recheck ${recheckUsed}/${recheckBudget})` +
    `${dryRun ? ' [dry-run]' : ''}`,
  );

  let discovered = 0;
  let errors = 0;
  const candidateLog = [];

  for (const target of selected) {
    const slug = target.slug;
    const rootUrl = HOUSE_ROOTS[slug];
    if (!rootUrl) continue;

    // Record attempt (lightweight, no schema change)
    if (!dryRun && supabase) {
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'discovery_attempt',
          severity: 'info',
          house: slug,
          message: `AI discovery attempt (${target.bucket})`,
        });
      } catch { /* non-fatal */ }
    }

    try {
      const html = await _fetchRootPage(rootUrl, slug, deps);
      if (!html) continue;

      const { stripped, hrefs } = _extractDiscoveryContent(html);
      if (hrefs.length === 0 && stripped.length < 200) continue;

      const catalogues = await _askAIForCatalogues(slug, rootUrl, stripped, hrefs, deps);
      if (!catalogues) continue;

      const found = await _upsertCatalogues(slug, catalogues, deps, candidateLog);
      discovered += found;

      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      errors++;
    }
  }

  console.log(
    `AUTO-DISCOVER: Complete — ${discovered} new catalogues found, ${errors} errors` +
    `${dryRun ? ' (dry-run)' : ''}`,
  );

  if (!dryRun) {
    await _recordAlerts(selected.length, discovered, errors);
  }

  return {
    discovered,
    errors,
    selected: selected.length,
    evaluated: evaluations.length,
    eligible: eligibleCount,
    darkUsed,
    recheckUsed,
    dryRun,
    candidates: dryRun ? candidateLog : undefined,
  };
}

// ── Fetch root page: plain HTTP → Crawlee render (for JS homepages) ──
async function _fetchRootPage(rootUrl, slug, deps) {
  let html = '';
  try {
    html = await fetchPage(rootUrl);
  } catch (httpErr) {
    console.log(`AUTO-DISCOVER: plain fetch failed for ${slug}: ${httpErr.message}`);
  }
  if ((!html || html.length < 1000) && hasCrawlee()) {
    try {
      const rendered = await scrapeWithCrawlee(rootUrl);
      if (rendered?.html && rendered.html.length > (html ? html.length : 0)) {
        html = rendered.html;
      }
    } catch (crErr) {
      console.log(`AUTO-DISCOVER: Crawlee render failed for ${slug}: ${crErr.message}`);
    }
  }
  return html || null;
}

// ── Extract text + auction-related links ──
function _extractDiscoveryContent(html) {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 6000);

  const hrefMatches = [...html.matchAll(/href="([^"]*(?:auction|lot|catalogue|sale|propert)[^"]*)"/gi)];
  const hrefs = [...new Set(hrefMatches.map((m) => m[1]))].slice(0, 40);

  return { stripped, hrefs };
}

// ── Ask Gemini to extract catalogue links ──
async function _askAIForCatalogues(slug, rootUrl, stripped, hrefs, deps) {
  if (!deps.callAI) return null;
  const today = new Date().toISOString().slice(0, 10);
  const aiText = await deps.callAI(
    `Extract auction catalogue links from this auction house page.

House: ${HOUSE_DISPLAY_NAMES[slug] || slug}
Root URL: ${rootUrl}
TODAY: ${today}

Page text (truncated):
${stripped}

Links found:
${hrefs.join('\n')}

For each UPCOMING or CURRENT auction with lots to view, provide:
- url: Full URL (resolve relative URLs against ${rootUrl})
- title: Auction title/date
- date: YYYY-MM-DD if determinable, null otherwise (must be >= ${today} when known)
- catalogueReady: true if lots appear listed

Prefer distinct future sale dates (up to 3), soonest first — include the next sale even if the house is already known.
Return ONLY: {"catalogues":[{"url":"...","title":"...","date":"...","catalogueReady":true}]}
No catalogues? Return {"catalogues": []}`,
    { tier: 'capable', maxTokens: 1500, taskType: 'discovery' },
  );

  try {
    let text = String(aiText || '').trim();
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(text).catalogues || [];
  } catch {
    return null;
  }
}

// ── Upsert discovered catalogues into calendar ──
const LOT_URL_PATTERNS = [
  /\/lot\/details?\//i,
  /\/lot\/\d+(?:[/#?]|$)/i,
  /\/property\/details?\//i,
  /\/properties\/\d+(?:[/#?]|$)/i,
  /\/properties\/lot\//i,
  /lot[_-]?id=/i,
  /property[_-]?id=/i,
];

async function _upsertCatalogues(slug, catalogues, deps = {}, candidateLog = null) {
  let found = 0;
  const dryRun = !!deps.dryRun;
  const todayIso = deps.todayIso || new Date().toISOString().slice(0, 10);

  for (const cat of catalogues) {
    if (!cat.url) continue;
    if (LOT_URL_PATTERNS.some((p) => p.test(cat.url))) {
      console.log(`AUTO-DISCOVER: Skipping lot-level URL: ${cat.url}`);
      continue;
    }

    // Reject known-past dated candidates
    if (cat.date && String(cat.date).slice(0, 10) < todayIso) {
      console.log(`AUTO-DISCOVER: Skipping past-dated candidate for ${slug}: ${cat.date} (${cat.url})`);
      continue;
    }

    // Product-integrity guard (shared with the self-healer)
    const candHtml = await _fetchRootPage(cat.url, slug, deps).catch(() => '');
    const verdict = healCandidateVerdict(cat.url, candHtml || '', slug);
    if (!verdict.ok) {
      console.log(
        `AUTO-DISCOVER: Skipping non-catalogue candidate for ${slug} — ${verdict.reason} (${cat.url})`,
      );
      continue;
    }

    const res = await upsertUpcomingCatalogue(supabase, {
      slug,
      url: cat.url,
      date: cat.date || null,
      title: cat.title || 'Upcoming',
      catalogueReady: cat.catalogueReady || false,
      source: 'auto-discover',
      houseName: HOUSE_DISPLAY_NAMES[slug] || slug,
      allowDateFallback: false,
      replaceSameHouseDate: false,
      location: 'Online',
      invalidateCache: !dryRun,
      dryRun,
    });

    if (candidateLog) {
      candidateLog.push({
        slug,
        url: cat.url,
        date: cat.date || null,
        ok: res.ok,
        action: res.action,
        reason: res.reason || null,
      });
    }

    if (res.ok && (res.action === 'upserted' || res.action === 'dry_run')) {
      found++;
      console.log(
        `AUTO-DISCOVER: ✓ ${dryRun ? 'Would insert' : 'New catalogue found'} — ${HOUSE_DISPLAY_NAMES[slug]}: ${cat.title} (${cat.url})`,
      );
    } else if (!res.ok && res.reason === 'missing_or_invalid_date') {
      console.log(`AUTO-DISCOVER: Skipping undated candidate for ${slug} — ${cat.url}`);
    } else if (!res.ok && res.reason !== 'house_date_exists_different_url') {
      if (res.error) {
        console.log(`AUTO-DISCOVER: upsert failed for ${slug}: ${res.reason} ${res.error}`);
      }
    }
  }

  return found;
}

// ── Pipeline alerting: discovery failures and consecutive misses ──
async function _recordAlerts(totalHouses, discovered, errors) {
  if (!supabase) return;
  if (errors > 0) {
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'discovery_miss',
        severity: 'warning',
        house: null,
        message: `Calendar discovery had ${errors} errors out of ${totalHouses} houses`,
      });
    } catch (alertErr) {
      console.warn('ALERT: Failed to record discovery errors:', alertErr.message);
    }
  }

  if (discovered === 0) {
    _consecutiveMisses++;
    if (_consecutiveMisses >= 3) {
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'discovery_miss',
          severity: 'warning',
          house: null,
          message: `${_consecutiveMisses} consecutive discovery runs found 0 new catalogues`,
        });
      } catch (alertErr) {
        console.warn('ALERT: Failed to record consecutive miss:', alertErr.message);
      }
    }
  } else {
    _consecutiveMisses = 0;
  }
}
