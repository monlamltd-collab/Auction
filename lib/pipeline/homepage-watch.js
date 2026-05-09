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

import { HOUSE_ROOTS } from '../houses.js';
import { extractHomepage } from '../scraper/firecrawl.js';
import { getBudget, withTier } from '../scraper/state.js';

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
});

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
// ═══════════════════════════════════════════════════════════════
export async function auditHouseHomepage(slug, configuredUrl, opts = {}) {
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

  const houses = Object.entries(HOUSE_ROOTS);
  deps.log?.info?.(`homepage-watch: starting cycle (${houses.length} houses, concurrency=${CONCURRENCY}, firstRun=${isFirstRun})`);

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
    alerts: 0,
    errors: 0,
  };
  const driftDetails = [];

  // Concurrency-bounded worker pool — same shape as audit-houses.mjs.
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < houses.length) {
      const i = idx++;
      const [slug, configuredUrl] = houses[i];
      const prev = prevByslug.get(slug) || null;
      try {
        const result = await auditHouseHomepage(slug, configuredUrl, { prev });
        await persistResult(supabase, slug, configuredUrl, result, prev);
        await applyDecision(result, prev, deps, summary, driftDetails);
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
    try { await deps.sendTelegram(formatSummaryForTelegram(summary, driftDetails, isFirstRun)); }
    catch (err) { deps.log?.warn?.('homepage-watch: telegram digest failed', { err: err.message }); }
  }

  deps.log?.info?.('homepage-watch: cycle complete', summary);
  return { skipped: false, summary, driftDetails, isFirstRun };
}

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
async function applyDecision(result, prev, deps, summary, driftDetails) {
  const { slug, configuredUrl, decision, audit, fetchError } = result;
  const v = decision.verdict;

  if (v === VERDICTS.RECORD_ONLY)        { summary.unchanged++; return; }
  if (v === VERDICTS.CONTENT_CHANGE)     { summary.contentChange++; return; }
  if (v === VERDICTS.BASELINE)           { summary.baseline++; return; }

  if (v === VERDICTS.URL_DRIFT_SAME_DOMAIN) {
    summary.drift++;
    summary.alerts++;
    driftDetails.push({ slug, from: configuredUrl, to: decision.candidateUrl, kind: 'same-domain' });
    if (deps.fireAlert) {
      await deps.fireAlert({
        type: 'house_url_drift_detected',
        severity: 'warning',
        house: slug,
        message: `Homepage now points at a different catalogue URL: ${decision.candidateUrl}`,
        meta: { from: configuredUrl, to: decision.candidateUrl, sameDomain: true },
      });
    }
    if (decision.shouldHeal && deps.healBrokenHouse) {
      try {
        const healed = await deps.healBrokenHouse(slug, configuredUrl);
        if (healed) summary.healed++; else summary.healFailed++;
      } catch (err) {
        summary.healFailed++;
        deps.log?.warn?.('homepage-watch: heal call threw', { slug, err: err.message });
      }
    }
    return;
  }

  if (v === VERDICTS.URL_DRIFT_NEW_DOMAIN) {
    summary.merger++;
    summary.alerts++;
    driftDetails.push({ slug, from: configuredUrl, to: decision.candidateUrl, kind: 'new-domain' });
    if (deps.fireAlert) {
      await deps.fireAlert({
        type: 'house_merger_suspected',
        severity: 'warning',
        house: slug,
        message: `Homepage links to a catalogue on a different domain — possible merger or rebrand: ${decision.candidateUrl}`,
        meta: { from: configuredUrl, to: decision.candidateUrl, sameDomain: false },
      });
    }
    return;
  }

  if (v === VERDICTS.DOMAIN_PARKED) {
    summary.parked++;
    summary.alerts++;
    if (deps.fireAlert) {
      await deps.fireAlert({
        type: 'house_domain_parked',
        severity: 'error',
        house: slug,
        message: `Homepage looks parked / dead. ${audit?.notes || ''}`.trim(),
        meta: { homepage: result.homepage, notes: audit?.notes || '' },
      });
    }
    return;
  }

  if (v === VERDICTS.NOT_AN_AUCTION_HOUSE) {
    summary.notAuctionHouse++;
    summary.alerts++;
    if (deps.fireAlert) {
      await deps.fireAlert({
        type: 'house_no_longer_auction',
        severity: 'error',
        house: slug,
        message: `Homepage no longer about property auctions. ${audit?.notes || ''}`.trim(),
        meta: { homepage: result.homepage, notes: audit?.notes || '' },
      });
    }
    return;
  }

  if (v === VERDICTS.NO_CATALOGUE_FOUND) {
    summary.noCatalogue++;
    if (decision.shouldAlert && deps.fireAlert) {
      summary.alerts++;
      await deps.fireAlert({
        type: 'house_no_catalogue_found',
        severity: 'warning',
        house: slug,
        message: `Homepage has no catalogue link for ${decision.consecutiveNoCatalogue} consecutive checks`,
        meta: { homepage: result.homepage, consecutive: decision.consecutiveNoCatalogue },
      });
    }
    return;
  }

  if (v === VERDICTS.UNREACHABLE) {
    summary.unreachable++;
    if (decision.shouldAlert && deps.fireAlert) {
      summary.alerts++;
      await deps.fireAlert({
        type: 'house_homepage_unreachable',
        severity: 'warning',
        house: slug,
        message: `Homepage fetch has failed ${decision.consecutiveUnreachable} consecutive cycles`,
        meta: { homepage: result.homepage, consecutive: decision.consecutiveUnreachable, lastError: fetchError },
      });
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// Telegram summary — pure formatter so it's safe for tests.
// ═══════════════════════════════════════════════════════════════
export function formatSummaryForTelegram(summary, driftDetails = [], isFirstRun = false) {
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
  if (driftDetails.length) {
    lines.push('', '<b>Drift detail:</b>');
    for (const d of driftDetails.slice(0, 10)) {
      lines.push(`• ${d.slug} [${d.kind}] → ${escapeHtml(d.to)}`);
    }
    if (driftDetails.length > 10) lines.push(`… and ${driftDetails.length - 10} more`);
  }
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
