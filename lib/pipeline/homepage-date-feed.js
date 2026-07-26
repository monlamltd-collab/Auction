// lib/pipeline/homepage-date-feed.js
// Task 7: turn homepage-watch next_auction_date + catalogue URL into scored
// next-sale candidates. High confidence → safe calendar upsert; medium → record.

import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES, RETIRED_HOUSES, AUCTION_DISCOVERY } from '../houses.js';
import { parseUkDate, isFutureIsoDate } from '../utils/auction-date-parse.js';
import { isRealCalendarDate, upsertUpcomingCatalogue } from './calendar-entries.js';
import { classifyHouseForDiscovery } from './house-class.js';
import { healCandidateVerdict, isJunkSearchUrl } from './healing.js';
import { setLastHomepageFeedSummary } from './cycle-coordination.js';

const LOT_URL_RE =
  /(\/lot\/details?\/|\/lot\/\d+(?:[/#?]|$)|\/property\/details?\/|\/properties\/\d+(?:[/#?]|$)|\/properties\/lot\/|lot[_-]?id=|property[_-]?id=)/i;

export const AUTO_UPSERT_MIN = 80;
export const MEDIUM_MIN = 50;

function sameDomain(a, b) {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, '').toLowerCase();
    const hb = new URL(b).hostname.replace(/^www\./, '').toLowerCase();
    return ha === hb;
  } catch {
    return false;
  }
}

/**
 * Score a homepage date+URL candidate (pure).
 *
 * @param {object} input
 */
export function scoreHomepageDateCandidate(input = {}) {
  const reasons = [];
  const slug = String(input.slug || '').toLowerCase();
  const todayIso = input.todayIso || new Date().toISOString().slice(0, 10);
  const rootUrl = input.rootUrl || HOUSE_ROOTS[slug] || null;
  const url = input.catalogueUrl ? String(input.catalogueUrl).trim() : null;
  const parsedDate =
    input.parsedDate ||
    (isRealCalendarDate(input.nextAuctionDateRaw)
      ? String(input.nextAuctionDateRaw).slice(0, 10)
      : parseUkDate(input.nextAuctionDateRaw));

  let confidence = 0;

  if (input.retired || RETIRED_HOUSES.has(slug)) {
    return done(slug, url, parsedDate, 0, ['retired'], 'skip');
  }

  if (!url || !/^https?:\/\//i.test(url)) {
    return done(slug, url, parsedDate, 0, ['missing_catalogue_url'], 'skip');
  }

  if (input.siteParked) {
    confidence -= 40;
    reasons.push('site_parked');
  }
  if (input.notAuctionHouse) {
    confidence -= 40;
    reasons.push('not_auction_house');
  }

  if (isJunkSearchUrl(url)) {
    confidence -= 30;
    reasons.push('junk_search_url');
  }

  if (LOT_URL_RE.test(url)) {
    confidence -= 50;
    reasons.push('lot_level_url');
  }

  // Same-domain with house root
  if (rootUrl && sameDomain(url, rootUrl)) {
    confidence += 40;
    reasons.push('same_domain_as_root');
  } else if (rootUrl) {
    reasons.push('cross_domain');
    // Cross-domain: never auto-upsert (mirror URL_DRIFT_NEW_DOMAIN human path)
    confidence -= 20;
  }

  if (parsedDate && isRealCalendarDate(parsedDate) && isFutureIsoDate(parsedDate, todayIso)) {
    confidence += 25;
    reasons.push('firm_future_date');
  } else if (parsedDate && isRealCalendarDate(parsedDate)) {
    confidence -= 25;
    reasons.push('past_or_invalid_relative_date');
  } else {
    reasons.push('no_parseable_future_date');
  }

  // Heal verdict when available
  if (input.healVerdict) {
    if (input.healVerdict.ok) {
      confidence += 20;
      reasons.push('heal_verdict_ok');
    } else {
      confidence -= 25;
      reasons.push(`heal_verdict_${input.healVerdict.reason || 'fail'}`);
    }
  }

  // Differs from existing stale calendar URL for same/nearest date
  const cal = Array.isArray(input.calendarRows) ? input.calendarRows : [];
  const existingUpcoming = cal.filter(
    (r) => r?.status === 'upcoming' && isRealCalendarDate(r.date) && String(r.date).slice(0, 10) >= todayIso,
  );
  if (url && existingUpcoming.length) {
    const sameDate = existingUpcoming.find(
      (r) => parsedDate && String(r.date).slice(0, 10) === parsedDate,
    );
    if (sameDate && sameDate.url && sameDate.url !== url) {
      confidence += 15;
      reasons.push('url_differs_from_calendar_same_date');
    } else if (!sameDate && parsedDate) {
      confidence += 10;
      reasons.push('new_future_date_vs_calendar');
    } else if (sameDate && sameDate.url === url) {
      reasons.push('already_on_calendar');
      // already present — still allow low-priority record
      confidence = Math.min(confidence, MEDIUM_MIN - 1);
    }
  } else if (parsedDate && url) {
    confidence += 10;
    reasons.push('fills_dark_calendar');
  }

  // Class filter: pure mmoa without rotating signals should not auto-write
  const houseClass = input.houseClass || null;
  const needsWatch = input.needsNextSaleWatch;
  if (houseClass === 'mmoa' && needsWatch === false) {
    confidence -= 15;
    reasons.push('pure_mmoa_conservatism');
  }
  if (houseClass === 'retired') {
    return done(slug, url, parsedDate, 0, ['retired_class'], 'skip');
  }

  // Clamp
  confidence = Math.max(0, Math.min(100, confidence));

  let action = 'record';
  if (confidence >= AUTO_UPSERT_MIN && rootUrl && sameDomain(url, rootUrl) && parsedDate && isFutureIsoDate(parsedDate, todayIso)) {
    action = 'auto_upsert';
  } else if (confidence >= MEDIUM_MIN && parsedDate && isFutureIsoDate(parsedDate, todayIso)) {
    action = 'ready_to_apply';
  } else if (confidence < MEDIUM_MIN) {
    action = 'record';
  }

  // Final hard stops
  if (!parsedDate || !isFutureIsoDate(parsedDate, todayIso)) action = 'skip';
  if (LOT_URL_RE.test(url) || isJunkSearchUrl(url)) action = 'skip';
  if (rootUrl && !sameDomain(url, rootUrl) && action === 'auto_upsert') action = 'ready_to_apply';

  return done(slug, url, parsedDate, confidence, reasons, action);
}

function done(slug, url, date, confidence, reasons, action) {
  return {
    slug,
    url,
    date: date || null,
    source: 'homepage-watch',
    confidence,
    reasons,
    action,
  };
}

/**
 * Build scored candidates from homepage_watch rows (+ optional calendar map).
 */
export function buildHomepageDateCandidates(rows, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const calBy = opts.calendarBySlug || {};
  const classBy = opts.classBySlug || {};
  const out = [];

  for (const row of rows || []) {
    const slug = row.slug || row.house_slug;
    if (!slug) continue;
    if (RETIRED_HOUSES.has(slug)) continue;

    const rootUrl = opts.houseRoots?.[slug] || HOUSE_ROOTS[slug] || null;
    const calendarRows = calBy[slug] || [];
    const cls = classBy[slug] || classifyHouseForDiscovery({
      slug,
      rootUrl,
      calendarRows,
      homepageWatch: {
        last_next_auction_date: row.last_next_auction_date || row.nextAuctionDate || null,
        last_extracted_catalogue_url: row.last_extracted_catalogue_url || row.currentCatalogueUrl || null,
      },
      todayIso,
      retired: false,
    });

    const scored = scoreHomepageDateCandidate({
      slug,
      rootUrl,
      catalogueUrl: row.last_extracted_catalogue_url || row.currentCatalogueUrl || null,
      nextAuctionDateRaw: row.last_next_auction_date || row.nextAuctionDate || null,
      calendarRows,
      houseClass: cls.class,
      needsNextSaleWatch: cls.needsNextSaleWatch,
      todayIso,
      siteParked: (row.last_site_status || row.siteStatus) === 'domain_parked',
      notAuctionHouse: (row.last_site_status || row.siteStatus) === 'not_an_auction_house',
      healVerdict: opts.healVerdicts?.[slug] || null,
    });
    if (AUCTION_DISCOVERY[slug]?.requireCandidateDateVerification) {
      // Keep the observation, but only the strict watcher may promote it after
      // proving both live lots and the exact candidate date on the page.
      scored.action = 'record';
      scored.reasons.push('strict_watcher_verification_required');
    }
    out.push({ ...scored, houseClass: cls.class });
  }
  return out;
}

function isHomepageDateFeedAutoEnabled(env = process.env) {
  // Default ON for ≥80 auto-upsert once Task 7 lands; kill-switch false if needed.
  const raw = env.HOMEPAGE_DATE_FEED_AUTO_UPSERT;
  if (raw == null || raw === '') return true;
  return String(raw).toLowerCase() !== 'false';
}

/**
 * Load homepage_watch + calendar, score, optionally upsert high-confidence.
 *
 * @param {object} supabase
 * @param {object} [opts]
 */
export async function runHomepageDateFeed(supabase, opts = {}) {
  const dryRun = !!opts.dryRun;
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const autoUpsert = opts.autoUpsert ?? isHomepageDateFeedAutoEnabled();
  const verifyHigh = opts.verifyHigh !== false; // fetch+heal for ≥80 paths by default

  const summary = {
    rows: 0,
    candidates: 0,
    autoUpserted: 0,
    readyToApply: 0,
    recorded: 0,
    skipped: 0,
    errors: 0,
    dryRun,
    autoUpsert,
    items: [],
  };

  if (!supabase && !opts.rows) {
    summary.error = 'no_supabase';
    setLastHomepageFeedSummary(summary);
    return summary;
  }

  let rows = opts.rows || null;
  if (!rows && supabase) {
    try {
      const { data, error } = await supabase
        .from('house_homepage_watch')
        .select(
          'slug, last_extracted_catalogue_url, last_next_auction_date, last_site_status, last_verdict',
        );
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      summary.error = e.message;
      setLastHomepageFeedSummary(summary);
      return summary;
    }
  }

  summary.rows = (rows || []).length;

  // Optional calendar map
  let calBy = opts.calendarBySlug || {};
  if (!opts.calendarBySlug && supabase) {
    try {
      const { data } = await supabase
        .from('auction_calendar')
        .select('house_slug, status, date, url, catalogue_ready')
        .in('status', ['upcoming', 'always_on']);
      calBy = {};
      for (const r of data || []) {
        if (!r.house_slug) continue;
        if (!calBy[r.house_slug]) calBy[r.house_slug] = [];
        calBy[r.house_slug].push(r);
      }
    } catch {
      calBy = {};
    }
  }

  const scored = buildHomepageDateCandidates(rows, {
    todayIso,
    calendarBySlug: calBy,
    houseRoots: opts.houseRoots,
  });
  summary.candidates = scored.length;

  for (const c of scored) {
    try {
      if (c.action === 'skip') {
        summary.skipped += 1;
        continue;
      }

      let candidate = c;
      // Optional soft verify before auto upsert
      if (
        candidate.action === 'auto_upsert' &&
        verifyHigh &&
        typeof opts.fetchHtml === 'function'
      ) {
        try {
          const html = await opts.fetchHtml(candidate.url);
          const verdict = healCandidateVerdict(candidate.url, html || '', candidate.slug);
          candidate = scoreHomepageDateCandidate({
            slug: candidate.slug,
            rootUrl: HOUSE_ROOTS[candidate.slug],
            catalogueUrl: candidate.url,
            parsedDate: candidate.date,
            calendarRows: calBy[candidate.slug] || [],
            houseClass: candidate.houseClass,
            needsNextSaleWatch: candidate.houseClass !== 'mmoa',
            todayIso,
            healVerdict: verdict,
          });
        } catch {
          /* keep unscored verdict */
        }
      }

      if (candidate.action === 'auto_upsert' && autoUpsert) {
        const res = await upsertUpcomingCatalogue(supabase, {
          slug: candidate.slug,
          url: candidate.url,
          date: candidate.date,
          title: `${candidate.date} Auction`,
          catalogueReady: true,
          source: 'homepage-date-feed',
          houseName: HOUSE_DISPLAY_NAMES[candidate.slug] || candidate.slug,
          allowDateFallback: false,
          replaceSameHouseDate: true,
          invalidateCache: !dryRun,
          dryRun,
        });
        if (res.ok) {
          summary.autoUpserted += 1;
          summary.items.push({ ...candidate, write: res.action });
        } else {
          summary.errors += 1;
          summary.items.push({ ...candidate, write: 'failed', reason: res.reason });
        }
        continue;
      }

      if (candidate.action === 'ready_to_apply') {
        summary.readyToApply += 1;
        summary.items.push(candidate);
        if (!dryRun && supabase && opts.recordMedium !== false) {
          try {
            await supabase.from('pipeline_alerts').insert({
              event_type: 'homepage_date_candidate',
              severity: 'info',
              house: candidate.slug,
              message: `Homepage date feed ready_to_apply conf=${candidate.confidence} ${candidate.date} ${candidate.url}`,
            });
          } catch { /* non-fatal */ }
        }
        continue;
      }

      summary.recorded += 1;
      if (summary.items.length < 50) summary.items.push(candidate);
    } catch (e) {
      summary.errors += 1;
    }
  }

  // Trim items for log callers
  if (!opts.includeAllItems) {
    summary.items = summary.items.filter(
      (i) => i.action === 'auto_upsert' || i.action === 'ready_to_apply' || i.write,
    ).slice(0, 40);
  }

  setLastHomepageFeedSummary(summary);
  return summary;
}

export { isHomepageDateFeedAutoEnabled };
