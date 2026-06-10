// lib/pipeline/homepage-watch.js
// ═══════════════════════════════════════════════════════════════
// DAILY HOMEPAGE WATCHER
// ═══════════════════════════════════════════════════════════════
//
// For every house in HOUSE_ROOTS, ask Firecrawl daily:
//   1. has the homepage changed since last visit? (changeTracking)
//   2. what does the homepage say is the current catalogue URL? (JSON schema)
//
// Decide an action from the result, persist to house_homepage_watch, and
// delegate to the existing infrastructure for execution:
//   - URL drift on the same domain → fireAlert + healBrokenHouse()
//   - URL drift to a different domain → fireAlert (merger — needs human)
//   - domain parked / not an auction house → fireAlert error
//   - persistent unreachable / no-catalogue → fireAlert warning
//
// This is an EARLY-DETECTION layer. It does not duplicate healing logic.
// Every action it triggers goes through code that's already battle-tested
// and has its own cooldown / dedup safety nets.

import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES, RETIRED_HOUSES } from '../houses.js';
import { extractHomepage } from '../scraper/firecrawl.js';
import { getBudget, withTier } from '../scraper/state.js';
import {
  AH_PLATFORM_SLUGS,
  AH_FUTURE_DATES_URL,
  fetchAhFutureDates,
} from './ah-resolver.js';

// ── Tunables ─────────────────────────────────────────────────────
const CONCURRENCY = 5;
const CONSECUTIVE_FAILURE_THRESHOLD = 3;       // alert after N consecutive null/unreachable
const CONSECUTIVE_NO_CATALOGUE_THRESHOLD = 3;  // alert after N consecutive null catalogue
const FETCH_TIMEOUT_MS = 90000;

// ── Decision verdicts (string union) ─────────────────────────────
// Pure values — `decide()` returns one of these and nothing else.
// Tested directly so tuning the matrix doesn't drift from the runner.
export const VERDICTS = Object.freeze({
  RECORD_ONLY:           'record_only',           // no change since last visit
  BASELINE:              'baseline',              // first time seeing this house
  CONTENT_CHANGE:        'content_change',        // page changed but URL still matches
  URL_DRIFT_SAME_DOMAIN: 'url_drift_same_domain', // → fire alert + heal
  URL_DRIFT_NEW_DOMAIN:  'url_drift_new_domain',  // → fire alert (merger)
  DOMAIN_PARKED:         'domain_parked',         // → fire alert error
  NOT_AN_AUCTION_HOUSE:  'not_an_auction_house',  // → fire alert error
  NO_CATALOGUE_FOUND:    'no_catalogue_found',    // → fire alert warning at threshold
  UNREACHABLE:           'unreachable',           // → fire alert warning at threshold
  AH_RESOLVER_UNAVAILABLE: 'ah_resolver_unavailable', // AH platform slug, future-dates fetch failed this cycle
});

// Pure helper — returns the [slug, configuredUrl] entries the watch cycle
// should iterate. Filters out RETIRED_HOUSES so the cycle doesn't burn
// FIRE-1 credits classifying parked/dead retired-slug homepages every other
// day. Exported for unit testing.
export function selectHousesForWatch(houseRoots, retiredHouses) {
  return Object.entries(houseRoots).filter(([slug]) => !retiredHouses.has(slug));
}

// ═══════════════════════════════════════════════════════════════
// Pure decision function — given an audit result + previous state,
// return a verdict. No I/O. Heavily covered by unit tests.
// ═══════════════════════════════════════════════════════════════
export function decide({ audit, configuredUrl, prev, fetchError }) {
  if (fetchError) {
    const consecutive = (prev?.consecutive_unreachable || 0) + 1;
    return {
      verdict: VERDICTS.UNREACHABLE,
      consecutiveUnreachable: consecutive,
      shouldAlert: consecutive >= CONSECUTIVE_FAILURE_THRESHOLD,
      shouldHeal: false,
    };
  }

  const status = audit.siteStatus;
  if (status === 'domain_parked') {
    return { verdict: VERDICTS.DOMAIN_PARKED, shouldAlert: true, shouldHeal: false };
  }
  if (status === 'not_an_auction_house') {
    return { verdict: VERDICTS.NOT_AN_AUCTION_HOUSE, shouldAlert: true, shouldHeal: false };
  }

  const change = audit.changeStatus;
  if (change === 'new' || prev == null) {
    // First time — record baseline. No action even if catalogue is null;
    // we have no history to compare against yet.
    return { verdict: VERDICTS.BASELINE, shouldAlert: false, shouldHeal: false };
  }

  // No catalogue extracted today.
  if (!audit.currentCatalogueUrl) {
    const consecutive = (prev?.consecutive_no_catalogue || 0) + 1;
    return {
      verdict: VERDICTS.NO_CATALOGUE_FOUND,
      consecutiveNoCatalogue: consecutive,
      shouldAlert: consecutive >= CONSECUTIVE_NO_CATALOGUE_THRESHOLD,
      shouldHeal: false,
    };
  }

  // Catalogue extracted. Compare to configured.
  const sameUrl = sameish(audit.currentCatalogueUrl, configuredUrl);
  if (sameUrl) {
    if (change === 'changed') return { verdict: VERDICTS.CONTENT_CHANGE, shouldAlert: false, shouldHeal: false };
    return { verdict: VERDICTS.RECORD_ONLY, shouldAlert: false, shouldHeal: false };
  }

  // Drift detected. Same domain → auto-heal. Different domain → alert only
  // (merger detection is a human decision per the auction-self-healing skill).
  const sameDomain = haveSameDomain(audit.currentCatalogueUrl, configuredUrl);
  if (sameDomain) {
    return {
      verdict: VERDICTS.URL_DRIFT_SAME_DOMAIN,
      shouldAlert: true,
      shouldHeal: true,
      candidateUrl: audit.currentCatalogueUrl,
    };
  }
  return {
    verdict: VERDICTS.URL_DRIFT_NEW_DOMAIN,
    shouldAlert: true,
    shouldHeal: false,
    candidateUrl: audit.currentCatalogueUrl,
  };
}

function sameish(a, b) {
  if (!a || !b) return false;
  return normalise(a) === normalise(b);
}

function normalise(u) {
  return String(u || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .replace(/\/index\.(html?|php)$/, '');
}

function haveSameDomain(a, b) {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, '');
    const hb = new URL(b).hostname.replace(/^www\./, '');
    return ha === hb;
  } catch { return false; }
}

function homepageOf(url) {
  try {
    const u = new URL(url);
    return u.origin + '/';
  } catch { return url; }
}

// ═══════════════════════════════════════════════════════════════
// Per-house audit — fetch + decide. No DB writes; that's the cycle's job.
//
// AH platform short-circuit: regional siblings share auctionhouse.co.uk, so
// the generic homepageOf() path strips to the national root and Firecrawl
// always returns /national as "the catalogue" — a structural false positive
// for every regional slug. opts.ahMap (built once per cycle from future-
// auction-dates) supplies the canonical regional URL instead; if the slug
// isn't in the map the configured URL is treated as authoritative (no upcoming
// auction listed), and if ahMap is null (resolver failed) the slug is skipped
// rather than misclassified.
// ═══════════════════════════════════════════════════════════════
export async function auditHouseHomepage(slug, configuredUrl, opts = {}) {
  if (AH_PLATFORM_SLUGS.has(slug)) {
    return auditAhPlatformHouse(slug, configuredUrl, opts);
  }
  const homepage = homepageOf(configuredUrl);
  const t0 = Date.now();
  let audit, fetchError;
  try {
    audit = await withTier('homepage-watch', () => extractHomepage(homepage, {
      changeTracking: true,
      fcTimeout: FETCH_TIMEOUT_MS,
    }));
  } catch (err) {
    fetchError = err.message || String(err);
    audit = null;
  }
  const decision = decide({
    audit: audit || {},
    configuredUrl,
    prev: opts.prev || null,
    fetchError,
  });
  return {
    slug,
    homepage,
    configuredUrl,
    audit,
    decision,
    fetchError,
    elapsedMs: Date.now() - t0,
  };
}

// AH-platform-specific audit. Reads from the resolver map (built once per
// cycle by runHomepageWatchCycle). The returned audit looks identical in shape
// to a Firecrawl-derived one so the downstream decide()/persistResult/
// applyDecision plumbing is reused unchanged.
function auditAhPlatformHouse(slug, configuredUrl, opts) {
  const ahMap = opts.ahMap;
  // Resolver failed entirely — record without firing alerts. We'd rather be
  // silent for one cycle than spam /national false positives.
  if (!ahMap) {
    return {
      slug,
      homepage: AH_FUTURE_DATES_URL,
      configuredUrl,
      audit: {
        changeStatus: 'same',
        currentCatalogueUrl: configuredUrl,
        siteStatus: 'active',
        markdown: '',
        notes: 'ah-resolver unavailable this cycle',
      },
      decision: {
        verdict: VERDICTS.AH_RESOLVER_UNAVAILABLE,
        shouldAlert: false,
        shouldHeal: false,
      },
      fetchError: null,
      elapsedMs: 0,
    };
  }
  const resolved = ahMap.get(slug);
  const audit = {
    changeStatus: 'same',
    currentCatalogueUrl: resolved || configuredUrl,
    siteStatus: 'active',
    markdown: '',
    notes: resolved ? '' : 'no upcoming auction in future-auction-dates',
  };
  const decision = decide({
    audit,
    configuredUrl,
    prev: opts.prev || null,
    fetchError: null,
  });
  return {
    slug,
    homepage: AH_FUTURE_DATES_URL,
    configuredUrl,
    audit,
    decision,
    fetchError: null,
    elapsedMs: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// Cycle runner — iterates all houses, persists to house_homepage_watch,
// triggers fireAlert + healBrokenHouse where the decision matrix says so.
//
// `deps` lets the caller inject the integration points so this module is
// testable and the import graph stays cycle-free:
//   - fireAlert(payload)               from lib/harness/alert-router.js
//   - healBrokenHouse(slug, oldUrl)    from lib/analysis.js (the 2-arg
//                                      production wrapper that supplies
//                                      its own scraping deps)
//   - sendTelegram(html)               optional first-cycle / actionable summary
//   - log                              structured logger
// ═══════════════════════════════════════════════════════════════
export async function runHomepageWatchCycle(supabase, deps = {}) {
  const enabled = (process.env.HOMEPAGE_WATCH_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    deps.log?.info?.('homepage-watch: HOMEPAGE_WATCH_ENABLED=false — skipping cycle');
    return { skipped: true, reason: 'disabled' };
  }
  if (!getBudget().canUseFirecrawl()) {
    const reason = getBudget().whyBlocked() || 'firecrawl-unavailable';
    deps.log?.warn?.('homepage-watch: deferring cycle — firecrawl unavailable', { reason });
    return { skipped: true, reason };
  }

  const { data: prevRows } = await supabase.from('house_homepage_watch').select('*');
  const prevByslug = new Map((prevRows || []).map(r => [r.slug, r]));
  const isFirstRun = (prevRows || []).length === 0;

  // Retired slugs stay in HOUSE_ROOTS so historical lots still render with
  // their proper display name, but the watcher must skip them — checking a
  // retired domain typically returns a parked page or 404 that the drift
  // matrix classifies as URL_DRIFT_NEW_DOMAIN, which then fires a FIRE-1
  // classifyNewDomainDrift call (~23 credits) every other day for nothing.
  const houses = selectHousesForWatch(HOUSE_ROOTS, RETIRED_HOUSES);
  const skipped = Object.keys(HOUSE_ROOTS).length - houses.length;
  deps.log?.info?.(`homepage-watch: starting cycle (${houses.length} houses, ${skipped} retired skipped, concurrency=${CONCURRENCY}, firstRun=${isFirstRun})`);

  // Fetch the AH future-auction-dates resolver once up front. Returns
  // Map<slug, catalogueUrl> for the regional siblings, or null if Firecrawl
  // failed / the page returned nothing parseable — in which case AH platform
  // slugs are skipped this cycle (see auditAhPlatformHouse).
  const ahMap = await fetchAhFutureDates();
  if (ahMap) {
    deps.log?.info?.(`homepage-watch: AH resolver mapped ${ahMap.size} regional slugs`);
  } else {
    deps.log?.warn?.('homepage-watch: AH resolver unavailable — AH platform slugs will be skipped this cycle');
  }

  const summary = {
    total: houses.length,
    unchanged: 0,
    contentChange: 0,
    baseline: 0,
    drift: 0,
    healed: 0,
    healFailed: 0,
    merger: 0,
    parked: 0,
    notAuctionHouse: 0,
    noCatalogue: 0,
    unreachable: 0,
    ahResolverUnavailable: 0,
    alerts: 0,
    errors: 0,
  };
  const details = [];

  // Concurrency-bounded worker pool — same shape as audit-houses.mjs.
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < houses.length) {
      const i = idx++;
      const [slug, configuredUrl] = houses[i];
      const prev = prevByslug.get(slug) || null;
      try {
        const result = await auditHouseHomepage(slug, configuredUrl, { prev, ahMap });
        await persistResult(supabase, slug, configuredUrl, result, prev);
        await applyDecision(result, prev, deps, summary, details);
      } catch (err) {
        summary.errors++;
        deps.log?.error?.('homepage-watch: per-house error', { slug, err: err.message });
      }
    }
  });
  await Promise.all(workers);

  // First-cycle Telegram digest, OR digest when actionable things happened.
  // Note: the per-action alerts already fired via fireAlert (which dedups).
  // This message is the at-a-glance summary so Simon doesn't have to log in.
  const actionable = summary.healed + summary.healFailed + summary.merger + summary.parked + summary.notAuctionHouse + summary.alerts;
  if ((isFirstRun || actionable > 0) && deps.sendTelegram) {
    try { await deps.sendTelegram(formatSummaryForTelegram(summary, details, isFirstRun)); }
    catch (err) { deps.log?.warn?.('homepage-watch: telegram digest failed', { err: err.message }); }
  }

  // Send one actionable card per detail that needs a human decision. The
  // summary above gives the overview; the cards below let Simon take action
  // from his phone via inline-keyboard callbacks (see routes/telegram-webhook.js).
  if (actionable > 0 && deps.sendActionableCard) {
    let sent = 0;
    for (const d of details) {
      const card = buildActionableCardForDetail(d);
      if (!card) continue;
      try {
        const sendResult = await deps.sendActionableCard(card.message, card.buttons);
        sent++;
        // Store the Telegram message_id on the alert so a reply to this card
        // (with a verified URL) can be matched back to it.
        if (sendResult?.messageId && d.alertId) {
          try {
            await supabase.from('pipeline_alerts')
              .update({ telegram_message_id: sendResult.messageId })
              .eq('id', d.alertId);
          } catch (err) {
            deps.log?.warn?.('homepage-watch: message_id store failed', { slug: d.slug, err: err.message });
          }
        }
      } catch (err) {
        deps.log?.warn?.('homepage-watch: card send failed', { slug: d.slug, err: err.message });
      }
      if (sent >= MAX_CARDS_PER_CYCLE) break;
    }
    if (sent > 0) deps.log?.info?.(`homepage-watch: sent ${sent} actionable cards`);
  }

  deps.log?.info?.('homepage-watch: cycle complete', summary);
  return { skipped: false, summary, details, isFirstRun };
}

// Cap on cards per cycle so a big drift event doesn't spam Telegram with 50+
// notifications. Anything beyond this is still in pipeline_alerts and will
// be picked up by the next backlog digest.
const MAX_CARDS_PER_CYCLE = 15;

// Hint appended to URL-fixable cards — tells Simon he can reply with the
// correct catalogue URL (handled by routes/telegram-webhook.js).
const VERIFIED_URL_HINT = '💬 Reply to this message with the correct catalogue URL.';

// ═══════════════════════════════════════════════════════════════
// Persistence — single upsert per house into house_homepage_watch.
// Keeps consecutive_* counters fresh based on this cycle's verdict.
// ═══════════════════════════════════════════════════════════════
async function persistResult(supabase, slug, configuredUrl, result, prev) {
  const { audit, decision, homepage, fetchError } = result;
  const consecUnreachable = decision.consecutiveUnreachable
    ?? (fetchError ? (prev?.consecutive_unreachable || 0) + 1 : 0);
  const consecNoCatalogue = decision.consecutiveNoCatalogue
    ?? (decision.verdict === VERDICTS.NO_CATALOGUE_FOUND ? (prev?.consecutive_no_catalogue || 0) + 1 : 0);

  const row = {
    slug,
    homepage_url: homepage,
    last_checked_at: new Date().toISOString(),
    last_change_status: audit?.changeStatus || (fetchError ? 'fetch_failed' : null),
    last_previous_scrape_at: audit?.previousScrapeAt || prev?.last_previous_scrape_at || null,
    last_extracted_catalogue_url: audit?.currentCatalogueUrl || null,
    last_next_auction_date: audit?.nextAuctionDate || null,
    last_site_status: audit?.siteStatus || (fetchError ? 'fetch_failed' : null),
    last_diff_excerpt: (audit?.markdown || '').slice(0, 500),
    consecutive_unreachable: consecUnreachable,
    consecutive_no_catalogue: consecNoCatalogue,
    consecutive_unchanged: audit?.changeStatus === 'same' ? (prev?.consecutive_unchanged || 0) + 1 : 0,
    last_verdict: decision.verdict,
  };
  // Idempotent upsert keyed on slug PRIMARY KEY. created_at default fires only on INSERT.
  await supabase.from('house_homepage_watch').upsert(row, { onConflict: 'slug' });
}

// ═══════════════════════════════════════════════════════════════
// Decision execution — fires alerts and triggers heals based on verdict.
// Every external interaction (fireAlert, healBrokenHouse) is delegated;
// this function never invents new behaviour.
// ═══════════════════════════════════════════════════════════════
async function applyDecision(result, prev, deps, summary, details) {
  const { slug, configuredUrl, decision, audit, fetchError } = result;
  const v = decision.verdict;
  const displayName = HOUSE_DISPLAY_NAMES[slug] || slug;

  if (v === VERDICTS.RECORD_ONLY)        { summary.unchanged++; return; }
  if (v === VERDICTS.CONTENT_CHANGE)     { summary.contentChange++; return; }
  if (v === VERDICTS.BASELINE)           { summary.baseline++; return; }
  if (v === VERDICTS.AH_RESOLVER_UNAVAILABLE) { summary.ahResolverUnavailable++; return; }

  if (v === VERDICTS.URL_DRIFT_SAME_DOMAIN) {
    summary.drift++;
    summary.alerts++;
    const detail = {
      verdict: v, slug, displayName,
      from: configuredUrl, to: decision.candidateUrl,
      notes: audit?.notes || '',
      healOutcome: 'pending',
    };
    details.push(detail);
    if (deps.fireAlert) {
      const r = await deps.fireAlert({
        type: 'house_url_drift_detected',
        severity: 'warning',
        house: slug,
        message: `Homepage now points at a different catalogue URL: ${decision.candidateUrl}`,
        meta: { from: configuredUrl, to: decision.candidateUrl, sameDomain: true, candidate_url: decision.candidateUrl },
      });
      detail.alertId = r?.alertId || null;
    }
    if (decision.shouldHeal && deps.healBrokenHouse) {
      try {
        const healed = await deps.healBrokenHouse(slug, configuredUrl);
        if (healed) { summary.healed++; detail.healOutcome = 'healed'; }
        else        { summary.healFailed++; detail.healOutcome = 'failed'; }
      } catch (err) {
        summary.healFailed++;
        detail.healOutcome = 'failed';
        deps.log?.warn?.('homepage-watch: heal call threw', { slug, err: err.message });
      }
    } else {
      detail.healOutcome = 'skipped';
    }
    return;
  }

  if (v === VERDICTS.URL_DRIFT_NEW_DOMAIN) {
    summary.merger++;
    summary.alerts++;

    // Item 2: ask FIRE-1 to classify the candidate URL — same business at
    // a new domain? merger? unrelated? Result is rendered on the Telegram
    // card so Simon can tap Accept/Snooze/Dismiss with full context. Best-
    // effort: null result falls back to the un-classified path.
    let classification = null;
    if (deps.classifyNewDomainDrift) {
      try {
        let originalDomain = '';
        try { originalDomain = new URL(configuredUrl).hostname; } catch { /* ignore */ }
        classification = await deps.classifyNewDomainDrift({
          houseName: displayName,
          originalDomain,
          candidateUrl: decision.candidateUrl,
        });
      } catch (err) {
        deps.log?.warn?.('homepage-watch: classifyNewDomainDrift threw', { slug, err: err.message });
      }
    }

    const detail = {
      verdict: v, slug, displayName,
      from: configuredUrl, to: decision.candidateUrl,
      notes: audit?.notes || '',
      classification,
    };
    details.push(detail);
    if (deps.fireAlert) {
      const classTag = classification ? ` [${classification.classification}, ${classification.confidence}]` : '';
      const r = await deps.fireAlert({
        type: 'house_merger_suspected',
        severity: 'warning',
        house: slug,
        message: `Homepage links to a catalogue on a different domain${classTag} — possible merger or rebrand: ${decision.candidateUrl}`,
        meta: {
          from: configuredUrl,
          to: decision.candidateUrl,
          sameDomain: false,
          candidate_url: decision.candidateUrl,
          classification: classification || null,
        },
      });
      detail.alertId = r?.alertId || null;
    }
    return;
  }

  if (v === VERDICTS.DOMAIN_PARKED) {
    summary.parked++;
    summary.alerts++;
    const detail = {
      verdict: v, slug, displayName,
      homepage: result.homepage, notes: audit?.notes || '',
    };
    details.push(detail);
    if (deps.fireAlert) {
      const r = await deps.fireAlert({
        type: 'house_domain_parked',
        severity: 'error',
        house: slug,
        message: `Homepage looks parked / dead. ${audit?.notes || ''}`.trim(),
        meta: { homepage: result.homepage, notes: audit?.notes || '' },
      });
      detail.alertId = r?.alertId || null;
    }
    return;
  }

  if (v === VERDICTS.NOT_AN_AUCTION_HOUSE) {
    summary.notAuctionHouse++;
    summary.alerts++;
    const detail = {
      verdict: v, slug, displayName,
      homepage: result.homepage, notes: audit?.notes || '',
    };
    details.push(detail);
    if (deps.fireAlert) {
      const r = await deps.fireAlert({
        type: 'house_no_longer_auction',
        severity: 'error',
        house: slug,
        message: `Homepage no longer about property auctions. ${audit?.notes || ''}`.trim(),
        meta: { homepage: result.homepage, notes: audit?.notes || '' },
      });
      detail.alertId = r?.alertId || null;
    }
    return;
  }

  if (v === VERDICTS.NO_CATALOGUE_FOUND) {
    summary.noCatalogue++;
    let detail = null;
    if (decision.shouldAlert) {
      detail = {
        verdict: v, slug, displayName,
        consecutive: decision.consecutiveNoCatalogue,
        notes: audit?.notes || '',
        siteStatus: audit?.siteStatus || '',
      };
      details.push(detail);
    }
    if (decision.shouldAlert && deps.fireAlert) {
      summary.alerts++;
      const r = await deps.fireAlert({
        type: 'house_no_catalogue_found',
        severity: 'warning',
        house: slug,
        message: `Homepage has no catalogue link for ${decision.consecutiveNoCatalogue} consecutive checks`,
        meta: { homepage: result.homepage, consecutive: decision.consecutiveNoCatalogue },
      });
      if (detail) detail.alertId = r?.alertId || null;
    }
    return;
  }

  if (v === VERDICTS.UNREACHABLE) {
    summary.unreachable++;
    let detail = null;
    if (decision.shouldAlert) {
      detail = {
        verdict: v, slug, displayName,
        consecutive: decision.consecutiveUnreachable,
        fetchError: fetchError || '',
      };
      details.push(detail);
    }
    if (decision.shouldAlert && deps.fireAlert) {
      summary.alerts++;
      const r = await deps.fireAlert({
        type: 'house_homepage_unreachable',
        severity: 'warning',
        house: slug,
        message: `Homepage fetch has failed ${decision.consecutiveUnreachable} consecutive cycles`,
        meta: { homepage: result.homepage, consecutive: decision.consecutiveUnreachable, lastError: fetchError },
      });
      if (detail) detail.alertId = r?.alertId || null;
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// Telegram summary — pure formatter so it's safe for tests.
// ═══════════════════════════════════════════════════════════════
export function formatSummaryForTelegram(summary, details = [], isFirstRun = false) {
  const lines = [
    `<b>🛰  Homepage watch — ${isFirstRun ? 'first run' : 'daily summary'}</b>`,
    `Houses checked: <b>${summary.total}</b> (${summary.unchanged} unchanged, ${summary.contentChange} content-change, ${summary.baseline} baseline)`,
  ];
  const interesting = [];
  if (summary.drift)            interesting.push(`🔀 ${summary.drift} URL drift (same-domain)`);
  if (summary.healed)           interesting.push(`🩹 ${summary.healed} healed`);
  if (summary.healFailed)       interesting.push(`⚠ ${summary.healFailed} heal failed`);
  if (summary.merger)           interesting.push(`🏷 ${summary.merger} possible merger (new domain)`);
  if (summary.parked)           interesting.push(`💀 ${summary.parked} parked`);
  if (summary.notAuctionHouse)  interesting.push(`❓ ${summary.notAuctionHouse} no longer auction`);
  if (summary.noCatalogue)      interesting.push(`📭 ${summary.noCatalogue} no catalogue`);
  if (summary.unreachable)      interesting.push(`📡 ${summary.unreachable} unreachable`);
  if (summary.errors)           interesting.push(`❌ ${summary.errors} per-house errors`);
  if (interesting.length) lines.push('', ...interesting);

  // Per-verdict detail blocks. Each block shows up to DETAIL_CAP entries with
  // the house's display name + the most useful context for that verdict, so
  // Simon can scan-and-decide without leaving Telegram.
  const byVerdict = new Map();
  for (const d of details) {
    if (!byVerdict.has(d.verdict)) byVerdict.set(d.verdict, []);
    byVerdict.get(d.verdict).push(d);
  }

  const renderers = [
    [VERDICTS.URL_DRIFT_SAME_DOMAIN, 'URL drift (same-domain)', renderDriftLine],
    [VERDICTS.URL_DRIFT_NEW_DOMAIN,  'Possible merger (new domain)', renderDriftLine],
    [VERDICTS.DOMAIN_PARKED,         'Parked / dead', renderParkedLine],
    [VERDICTS.NOT_AN_AUCTION_HOUSE,  'No longer an auction house', renderParkedLine],
    [VERDICTS.NO_CATALOGUE_FOUND,    'No catalogue (3+ cycles)', renderNoCatalogueLine],
    [VERDICTS.UNREACHABLE,           'Unreachable (3+ cycles)', renderUnreachableLine],
  ];
  for (const [verdict, title, render] of renderers) {
    const items = byVerdict.get(verdict);
    if (!items?.length) continue;
    lines.push('', `<b>${title}:</b>`);
    for (const item of items.slice(0, DETAIL_CAP)) lines.push(...render(item));
    if (items.length > DETAIL_CAP) lines.push(`… and ${items.length - DETAIL_CAP} more`);
  }

  return lines.join('\n');
}

const DETAIL_CAP = 10;

function renderDriftLine(d) {
  const out = [`• ${escapeHtml(d.displayName)} [${d.slug}] → ${escapeHtml(d.to)}`];
  if (d.notes) out.push(`  "${escapeHtml(d.notes)}"`);
  return out;
}

function renderParkedLine(d) {
  return [`• ${escapeHtml(d.displayName)} [${d.slug}] — ${escapeHtml(d.notes || 'no detail from extractor')}`];
}

function renderNoCatalogueLine(d) {
  const tail = d.notes || d.siteStatus || 'no catalogue link found';
  return [`• ${escapeHtml(d.displayName)} [${d.slug}] (${d.consecutive} cycles) — ${escapeHtml(tail)}`];
}

function renderUnreachableLine(d) {
  const tail = d.fetchError || 'fetch failed (no error captured)';
  return [`• ${escapeHtml(d.displayName)} [${d.slug}] (${d.consecutive} cycles) — last error: ${escapeHtml(tail)}`];
}

// ═══════════════════════════════════════════════════════════════
// Actionable card builder — per-detail Telegram message + buttons.
// Returns null if this detail doesn't need a human decision (e.g. an
// auto-healed drift). Buttons reference the alertId so the webhook
// handler at routes/telegram-webhook.js can look up + act on the alert.
// ═══════════════════════════════════════════════════════════════
export function buildActionableCardForDetail(d) {
  if (!d || !d.alertId) return null;
  switch (d.verdict) {
    case VERDICTS.URL_DRIFT_SAME_DOMAIN: {
      // Auto-healed drifts don't need a card — the heal already applied the URL.
      if (d.healOutcome === 'healed') return null;
      const lines = [
        `<b>⚠ Heal failed — ${escapeHtml(d.displayName)}</b>`,
        `Old: ${escapeHtml(d.from)}`,
        `Candidate: ${escapeHtml(d.to)}`,
      ];
      if (d.notes) lines.push(`<i>${escapeHtml(d.notes)}</i>`);
      lines.push(VERIFIED_URL_HINT);
      return {
        message: lines.join('\n'),
        buttons: [[
          { label: '✅ Apply candidate', callback_data: `accept:${d.alertId}` },
          { label: '↻ Re-heal', callback_data: `rerun:${d.alertId}` },
        ], [
          { label: '⏸ Snooze 7d', callback_data: `snooze:${d.alertId}` },
          { label: '✗ Dismiss', callback_data: `dismiss:${d.alertId}` },
        ]],
      };
    }
    case VERDICTS.URL_DRIFT_NEW_DOMAIN: {
      const lines = [
        `<b>🏷 Possible merger — ${escapeHtml(d.displayName)}</b>`,
        `Was: ${escapeHtml(d.from)}`,
        `Now: ${escapeHtml(d.to)}`,
      ];
      if (d.notes) lines.push(`<i>${escapeHtml(d.notes)}</i>`);
      // Surface FIRE-1's classification verdict so Simon can decide quickly.
      if (d.classification) {
        const c = d.classification;
        const labelMap = {
          same_business:      '✓ Same business at new domain',
          merger_to_known:    '🏷 Merged into known parent',
          merger_to_unknown:  '🏷 Merged into unknown parent',
          unrelated:          '✗ Unrelated (likely false positive)',
        };
        const tag = labelMap[c.classification] || c.classification;
        lines.push(`<b>FIRE-1 verdict:</b> ${tag} (${escapeHtml(c.confidence)})`);
        if (c.newOwnerName) lines.push(`<b>New owner:</b> ${escapeHtml(c.newOwnerName)}`);
        if (c.reason)       lines.push(`<i>"${escapeHtml(c.reason)}"</i>`);
      }
      lines.push(VERIFIED_URL_HINT);
      return {
        message: lines.join('\n'),
        buttons: [[
          { label: '✅ Accept new URL', callback_data: `accept:${d.alertId}` },
        ], [
          { label: '⏸ Snooze 7d', callback_data: `snooze:${d.alertId}` },
          { label: '✗ Dismiss', callback_data: `dismiss:${d.alertId}` },
        ]],
      };
    }
    case VERDICTS.DOMAIN_PARKED:
    case VERDICTS.NOT_AN_AUCTION_HOUSE: {
      const title = d.verdict === VERDICTS.DOMAIN_PARKED ? '💀 Parked / dead' : '❓ No longer auction';
      const lines = [
        `<b>${title} — ${escapeHtml(d.displayName)}</b>`,
        `Page: ${escapeHtml(d.notes || 'no detail from extractor')}`,
      ];
      return {
        message: lines.join('\n'),
        buttons: [[
          { label: '⏸ Snooze 7d', callback_data: `snooze:${d.alertId}` },
          { label: '✗ Dismiss', callback_data: `dismiss:${d.alertId}` },
        ]],
      };
    }
    case VERDICTS.NO_CATALOGUE_FOUND: {
      const lines = [
        `<b>📭 No catalogue — ${escapeHtml(d.displayName)}</b>`,
        `${d.consecutive} consecutive cycles. ${escapeHtml(d.siteStatus || d.notes || '')}`.trim(),
      ];
      lines.push(VERIFIED_URL_HINT);
      return {
        message: lines.join('\n'),
        buttons: [[
          { label: '↻ Re-check now', callback_data: `rerun:${d.alertId}` },
          { label: '⏸ Snooze 7d', callback_data: `snooze:${d.alertId}` },
          { label: '✗ Dismiss', callback_data: `dismiss:${d.alertId}` },
        ]],
      };
    }
    case VERDICTS.UNREACHABLE: {
      const lines = [
        `<b>📡 Unreachable — ${escapeHtml(d.displayName)}</b>`,
        `${d.consecutive} consecutive cycles. Last error: ${escapeHtml(d.fetchError || 'unknown')}`,
      ];
      return {
        message: lines.join('\n'),
        buttons: [[
          { label: '↻ Re-check now', callback_data: `rerun:${d.alertId}` },
          { label: '⏸ Snooze 7d', callback_data: `snooze:${d.alertId}` },
          { label: '✗ Dismiss', callback_data: `dismiss:${d.alertId}` },
        ]],
      };
    }
    default:
      return null;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
