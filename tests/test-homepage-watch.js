/**
 * Homepage watcher tests
 * ======================
 * Covers the pure decision matrix in lib/pipeline/homepage-watch.js. Every
 * branch of `decide()` plus the Telegram formatter. The cycle runner itself
 * (DB writes, fireAlert, healBrokenHouse) is exercised by mocking the deps.
 *
 * Run: node tests/test-homepage-watch.js
 */

import {
  decide,
  VERDICTS,
  formatSummaryForTelegram,
  runHomepageWatchCycle,
  buildActionableCardForDetail,
} from '../lib/pipeline/homepage-watch.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const CONFIGURED = 'https://www.savills.co.uk/auctions/upcoming';

// ── Test 1: changeStatus 'same' + URL match → record_only ─────────
console.log('Test 1: unchanged page → record_only');
{
  const d = decide({
    audit: { changeStatus: 'same', currentCatalogueUrl: CONFIGURED, siteStatus: 'active' },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same', consecutive_unchanged: 4 },
  });
  assert(d.verdict === VERDICTS.RECORD_ONLY, 'verdict = record_only');
  assert(d.shouldAlert === false, 'no alert');
  assert(d.shouldHeal === false, 'no heal');
}

// ── Test 2: First time we see this house → baseline ───────────────
console.log('\nTest 2: first run → baseline');
{
  const d = decide({
    audit: { changeStatus: 'new', currentCatalogueUrl: CONFIGURED, siteStatus: 'active' },
    configuredUrl: CONFIGURED,
    prev: null,
  });
  assert(d.verdict === VERDICTS.BASELINE, 'verdict = baseline');
  assert(d.shouldAlert === false, 'no alert on baseline');
  assert(d.shouldHeal === false, 'no heal on baseline');
}

// ── Test 3: Page changed but URL still matches → content_change ───
console.log('\nTest 3: page changed, URL still matches → content_change');
{
  const d = decide({
    audit: { changeStatus: 'changed', currentCatalogueUrl: CONFIGURED, siteStatus: 'active' },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same' },
  });
  assert(d.verdict === VERDICTS.CONTENT_CHANGE, 'verdict = content_change');
  assert(d.shouldAlert === false, 'no alert');
  assert(d.shouldHeal === false, 'no heal');
}

// ── Test 4: URL drift, same domain → heal ─────────────────────────
console.log('\nTest 4: URL drift, same domain → heal trigger');
{
  const d = decide({
    audit: {
      changeStatus: 'changed',
      currentCatalogueUrl: 'https://www.savills.co.uk/auctions/may-2026',
      siteStatus: 'active',
    },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same' },
  });
  assert(d.verdict === VERDICTS.URL_DRIFT_SAME_DOMAIN, 'verdict = url_drift_same_domain');
  assert(d.shouldAlert === true, 'alert fires');
  assert(d.shouldHeal === true, 'heal fires');
  assert(d.candidateUrl === 'https://www.savills.co.uk/auctions/may-2026', 'candidate URL passed through');
}

// ── Test 5: URL drift, NEW domain → alert only (merger) ───────────
console.log('\nTest 5: URL drift to new domain → merger alert (no heal)');
{
  const d = decide({
    audit: {
      changeStatus: 'changed',
      currentCatalogueUrl: 'https://www.parentgroup.com/auctions/savills',
      siteStatus: 'active',
    },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same' },
  });
  assert(d.verdict === VERDICTS.URL_DRIFT_NEW_DOMAIN, 'verdict = url_drift_new_domain');
  assert(d.shouldAlert === true, 'alert fires');
  assert(d.shouldHeal === false, 'NO heal — merger needs human');
}

// ── Test 6: site_status domain_parked → error alert ───────────────
console.log('\nTest 6: domain_parked → error alert');
{
  const d = decide({
    audit: { changeStatus: 'changed', currentCatalogueUrl: null, siteStatus: 'domain_parked' },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same' },
  });
  assert(d.verdict === VERDICTS.DOMAIN_PARKED, 'verdict = domain_parked');
  assert(d.shouldAlert === true, 'alert fires');
  assert(d.shouldHeal === false, 'no heal');
}

// ── Test 7: site_status not_an_auction_house → error alert ────────
console.log('\nTest 7: not_an_auction_house → error alert');
{
  const d = decide({
    audit: { changeStatus: 'changed', currentCatalogueUrl: null, siteStatus: 'not_an_auction_house' },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same' },
  });
  assert(d.verdict === VERDICTS.NOT_AN_AUCTION_HOUSE, 'verdict = not_an_auction_house');
  assert(d.shouldAlert === true, 'alert fires');
}

// ── Test 8: No catalogue, 1st time → record only, no alert yet ────
console.log('\nTest 8: no catalogue, 1 of 3 → record only');
{
  const d = decide({
    audit: { changeStatus: 'changed', currentCatalogueUrl: null, siteStatus: 'no_current_auction' },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same', consecutive_no_catalogue: 0 },
  });
  assert(d.verdict === VERDICTS.NO_CATALOGUE_FOUND, 'verdict = no_catalogue_found');
  assert(d.consecutiveNoCatalogue === 1, 'counter incremented to 1');
  assert(d.shouldAlert === false, 'no alert at 1 consecutive');
}

// ── Test 9: No catalogue, 3rd consecutive → alert fires ───────────
console.log('\nTest 9: no catalogue, 3 of 3 → alert fires');
{
  const d = decide({
    audit: { changeStatus: 'changed', currentCatalogueUrl: null, siteStatus: 'no_current_auction' },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same', consecutive_no_catalogue: 2 },
  });
  assert(d.consecutiveNoCatalogue === 3, 'counter incremented to 3');
  assert(d.shouldAlert === true, 'alert fires at threshold');
  assert(d.shouldHeal === false, 'no heal — no candidate URL');
}

// ── Test 10: Fetch error, 1st time → record only, no alert yet ────
console.log('\nTest 10: fetch error, 1 of 3 → record only');
{
  const d = decide({
    audit: {},
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same', consecutive_unreachable: 0 },
    fetchError: 'Firecrawl 500: server error',
  });
  assert(d.verdict === VERDICTS.UNREACHABLE, 'verdict = unreachable');
  assert(d.consecutiveUnreachable === 1, 'counter incremented to 1');
  assert(d.shouldAlert === false, 'no alert yet');
}

// ── Test 11: Fetch error, 3rd consecutive → alert fires ───────────
console.log('\nTest 11: fetch error, 3 of 3 → alert fires');
{
  const d = decide({
    audit: {},
    configuredUrl: CONFIGURED,
    prev: { consecutive_unreachable: 2 },
    fetchError: 'timeout',
  });
  assert(d.consecutiveUnreachable === 3, 'counter incremented to 3');
  assert(d.shouldAlert === true, 'alert fires at threshold');
}

// ── Test 12: URL drift detection is case- and trailing-slash insensitive ─
console.log('\nTest 12: URL match is normalised (case, trailing slash, www.)');
{
  const cases = [
    ['https://www.savills.co.uk/auctions/upcoming', 'https://savills.co.uk/auctions/upcoming/'],
    ['HTTPS://Www.Savills.Co.UK/auctions/upcoming', 'https://www.savills.co.uk/auctions/upcoming'],
    ['https://www.savills.co.uk/auctions/upcoming/', 'https://www.savills.co.uk/auctions/upcoming'],
  ];
  for (const [a, b] of cases) {
    const d = decide({
      audit: { changeStatus: 'changed', currentCatalogueUrl: a, siteStatus: 'active' },
      configuredUrl: b,
      prev: { last_change_status: 'same' },
    });
    assert(d.verdict === VERDICTS.CONTENT_CHANGE, `${a} ≈ ${b} (treated as same URL)`);
  }
}

// ── Test 13: domain_parked beats everything else ──────────────────
console.log('\nTest 13: domain_parked wins over change-status checks');
{
  const d = decide({
    audit: {
      changeStatus: 'changed',
      currentCatalogueUrl: 'https://www.savills.co.uk/auctions/different',
      siteStatus: 'domain_parked',
    },
    configuredUrl: CONFIGURED,
    prev: { last_change_status: 'same' },
  });
  assert(d.verdict === VERDICTS.DOMAIN_PARKED, 'parked status takes precedence over drift');
}

// ═══════════════════════════════════════════════════════════════
// Telegram formatter
// ═══════════════════════════════════════════════════════════════

console.log('\nTest 14: formatSummaryForTelegram — quiet day');
{
  const out = formatSummaryForTelegram({
    total: 150, unchanged: 148, contentChange: 2, baseline: 0,
    drift: 0, healed: 0, healFailed: 0, merger: 0, parked: 0,
    notAuctionHouse: 0, noCatalogue: 0, unreachable: 0, alerts: 0, errors: 0,
  }, [], false);
  assert(out.includes('Houses checked: <b>150</b>'), 'header line present');
  assert(out.includes('148 unchanged'), 'unchanged count rendered');
  assert(!out.includes('🔀'), 'no drift bullet on quiet day');
}

console.log('\nTest 15: formatSummaryForTelegram — first-run badge');
{
  const out = formatSummaryForTelegram({
    total: 150, unchanged: 0, contentChange: 0, baseline: 150,
    drift: 0, healed: 0, healFailed: 0, merger: 0, parked: 0,
    notAuctionHouse: 0, noCatalogue: 0, unreachable: 0, alerts: 0, errors: 0,
  }, [], true);
  assert(out.includes('first run'), 'first-run badge in header');
  assert(out.includes('150 baseline'), 'all baseline on first run');
}

console.log('\nTest 16: formatSummaryForTelegram — actionable cycle with per-verdict detail blocks');
{
  const out = formatSummaryForTelegram({
    total: 150, unchanged: 140, contentChange: 5, baseline: 0,
    drift: 2, healed: 1, healFailed: 1, merger: 1, parked: 1,
    notAuctionHouse: 0, noCatalogue: 1, unreachable: 1, alerts: 5, errors: 0,
  }, [
    { verdict: VERDICTS.URL_DRIFT_SAME_DOMAIN, slug: 'savills', displayName: 'Savills',
      from: 'https://savills.co.uk/old', to: 'https://savills.co.uk/new', notes: '' },
    { verdict: VERDICTS.URL_DRIFT_NEW_DOMAIN, slug: 'pattinson', displayName: 'Pattinson',
      from: 'https://pattinson.co.uk/x', to: 'https://parent.com/p', notes: 'redirected to parent group' },
    { verdict: VERDICTS.DOMAIN_PARKED, slug: 'scargill', displayName: 'Scargill Mann',
      homepage: 'https://scargill.co.uk', notes: 'Domain for sale: contact GoDaddy' },
    { verdict: VERDICTS.NO_CATALOGUE_FOUND, slug: 'bramleys', displayName: 'Bramleys',
      consecutive: 4, notes: '', siteStatus: 'no_current_auction' },
    { verdict: VERDICTS.UNREACHABLE, slug: 'sutton', displayName: 'Sutton Kersh',
      consecutive: 5, fetchError: 'timeout after 90s' },
  ], false);
  assert(out.includes('🔀 2 URL drift'), 'drift bullet rendered');
  assert(out.includes('🩹 1 healed'), 'healed bullet rendered');
  assert(out.includes('⚠ 1 heal failed'), 'heal-failed bullet rendered');
  assert(out.includes('🏷 1 possible merger'), 'merger bullet rendered');
  assert(out.includes('💀 1 parked'), 'parked bullet rendered');
  // Per-verdict detail block headers
  assert(out.includes('<b>URL drift (same-domain):</b>'), 'same-domain section header');
  assert(out.includes('<b>Possible merger (new domain):</b>'), 'new-domain section header');
  assert(out.includes('<b>Parked / dead:</b>'), 'parked section header');
  assert(out.includes('<b>No catalogue (3+ cycles):</b>'), 'no-catalogue section header');
  assert(out.includes('<b>Unreachable (3+ cycles):</b>'), 'unreachable section header');
  // Display names with slug in brackets
  assert(out.includes('Savills [savills]'), 'savills display name + slug');
  assert(out.includes('Pattinson [pattinson]'), 'pattinson display name + slug');
  assert(out.includes('Scargill Mann [scargill]'), 'scargill display name + slug');
  // Context lines
  assert(out.includes('Domain for sale: contact GoDaddy'), 'parked notes surfaced');
  assert(out.includes('redirected to parent group'), 'merger notes surfaced');
  assert(out.includes('Bramleys [bramleys] (4 cycles)'), 'no-catalogue consecutive count');
  assert(out.includes('Sutton Kersh [sutton] (5 cycles)'), 'unreachable consecutive count');
  assert(out.includes('timeout after 90s'), 'unreachable error surfaced');
}

console.log('\nTest 17: formatSummaryForTelegram — per-section detail capped at 10');
{
  const drifts = Array.from({ length: 14 }, (_, i) => ({
    verdict: VERDICTS.URL_DRIFT_SAME_DOMAIN,
    slug: `house${i}`, displayName: `House ${i}`,
    from: 'https://x', to: 'https://y', notes: '',
  }));
  const out = formatSummaryForTelegram({
    total: 150, drift: 14, healed: 0, healFailed: 14, merger: 0, parked: 0,
    notAuctionHouse: 0, noCatalogue: 0, unreachable: 0, alerts: 14, errors: 0,
    unchanged: 0, contentChange: 0, baseline: 0,
  }, drifts, false);
  assert(out.includes('… and 4 more'), 'overflow indicator present');
  assert(out.includes('house0'), 'first drift listed');
  assert(!out.includes('house10'), 'drift after 10 not listed');
}

// ═══════════════════════════════════════════════════════════════
// runHomepageWatchCycle integration with mocked deps
// ═══════════════════════════════════════════════════════════════

function makeMockSupabase(prevRows = []) {
  const upserts = [];
  return {
    _upserts: upserts,
    from(table) {
      const ctx = { table, filters: [] };
      const chain = {
        select: () => chain,
        eq: (col, val) => { ctx.filters.push({ col, val }); return chain; },
        upsert: async (row, opts) => {
          if (table === 'house_homepage_watch') upserts.push(row);
          return { error: null };
        },
        async then(resolve) {
          if (table === 'house_homepage_watch' && !ctx.upserted) {
            resolve({ data: prevRows, error: null });
          } else {
            resolve({ data: null, error: null });
          }
        },
      };
      return chain;
    },
  };
}

console.log('\nTest 18: runHomepageWatchCycle — disabled flag short-circuits');
{
  const prev = process.env.HOMEPAGE_WATCH_ENABLED;
  process.env.HOMEPAGE_WATCH_ENABLED = 'false';
  try {
    const sb = makeMockSupabase([]);
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const result = await runHomepageWatchCycle(sb, { log });
    assert(result.skipped === true, 'cycle marked skipped');
    assert(result.reason === 'disabled', 'reason = disabled');
    assert(sb._upserts.length === 0, 'no DB writes when disabled');
  } finally {
    if (prev === undefined) delete process.env.HOMEPAGE_WATCH_ENABLED;
    else process.env.HOMEPAGE_WATCH_ENABLED = prev;
  }
}

// ═══════════════════════════════════════════════════════════════
// buildActionableCardForDetail — per-detail card + button vocabulary
// ═══════════════════════════════════════════════════════════════

console.log('\nTest 19: buildActionableCardForDetail — returns null when no alertId');
{
  const card = buildActionableCardForDetail({ verdict: VERDICTS.DOMAIN_PARKED, slug: 'x', displayName: 'X' });
  assert(card === null, 'no alertId → no card (can\'t reference an alert that wasn\'t persisted)');
}

console.log('\nTest 20: buildActionableCardForDetail — auto-healed drifts get no card');
{
  const card = buildActionableCardForDetail({
    verdict: VERDICTS.URL_DRIFT_SAME_DOMAIN, slug: 'x', displayName: 'X',
    alertId: 'abc-123', healOutcome: 'healed', from: 'https://x/old', to: 'https://x/new', notes: '',
  });
  assert(card === null, 'healed drift → no card needed');
}

console.log('\nTest 21: buildActionableCardForDetail — failed drift gets Apply/Re-heal/Snooze/Dismiss');
{
  const card = buildActionableCardForDetail({
    verdict: VERDICTS.URL_DRIFT_SAME_DOMAIN, slug: 'savills', displayName: 'Savills',
    alertId: 'abc-123', healOutcome: 'failed',
    from: 'https://savills.co.uk/old', to: 'https://savills.co.uk/new', notes: '',
  });
  assert(card !== null, 'card returned');
  assert(card.message.includes('Savills'), 'displays house name');
  const labels = card.buttons.flat().map(b => b.label).join(' ');
  assert(/Apply/.test(labels) && /Re-heal/.test(labels) && /Snooze/.test(labels) && /Dismiss/.test(labels),
    'has Apply + Re-heal + Snooze + Dismiss buttons');
  const cbs = card.buttons.flat().map(b => b.callback_data);
  assert(cbs.includes('accept:abc-123'), 'accept callback has alertId');
  assert(cbs.includes('snooze:abc-123'), 'snooze callback has alertId');
}

console.log('\nTest 22: buildActionableCardForDetail — new-domain (merger) card');
{
  const card = buildActionableCardForDetail({
    verdict: VERDICTS.URL_DRIFT_NEW_DOMAIN, slug: 'pattinson', displayName: 'Pattinson',
    alertId: 'm1', from: 'https://pattinson.co.uk/x', to: 'https://parent.com/p', notes: 'redirected',
  });
  assert(card !== null, 'card returned');
  assert(card.message.includes('Possible merger'), 'merger framing');
  const cbs = card.buttons.flat().map(b => b.callback_data);
  assert(cbs.includes('accept:m1'), 'accept available for new-domain too');
  assert(!cbs.some(c => c.startsWith('rerun:')), 'no re-heal — new-domain needs human, not retry');
}

console.log('\nTest 23: buildActionableCardForDetail — parked card has Snooze + Dismiss only');
{
  const card = buildActionableCardForDetail({
    verdict: VERDICTS.DOMAIN_PARKED, slug: 'dead', displayName: 'Dead House',
    alertId: 'p1', notes: 'Domain for sale: contact GoDaddy', homepage: 'https://dead.co/',
  });
  assert(card !== null, 'card returned');
  const cbs = card.buttons.flat().map(b => b.callback_data);
  assert(cbs.includes('snooze:p1') && cbs.includes('dismiss:p1'), 'snooze + dismiss present');
  assert(!cbs.some(c => c.startsWith('accept:')), 'no accept — no candidate URL to apply');
}

console.log('\nTest 24a: buildActionableCardForDetail — merger card surfaces FIRE-1 classification when present');
{
  const card = buildActionableCardForDetail({
    verdict: VERDICTS.URL_DRIFT_NEW_DOMAIN, slug: 'pattinson', displayName: 'Pattinson',
    alertId: 'm2', from: 'https://pattinson.co.uk/x', to: 'https://parent.com/p', notes: '',
    classification: {
      classification: 'merger_to_known',
      newOwnerName: 'Allsop',
      confidence: 'high',
      reason: 'Page footer reads "Now part of Allsop Group"',
    },
  });
  assert(card !== null, 'card returned');
  assert(/FIRE-1 verdict/.test(card.message), 'classification verdict labelled');
  assert(/Merged into known parent/.test(card.message), 'human-readable classification rendered');
  assert(/Allsop/.test(card.message), 'new owner name surfaced');
  assert(/Now part of Allsop Group/.test(card.message), 'FIRE-1 reason quoted');
}

console.log('\nTest 24b: buildActionableCardForDetail — merger card without classification renders normally');
{
  const card = buildActionableCardForDetail({
    verdict: VERDICTS.URL_DRIFT_NEW_DOMAIN, slug: 'x', displayName: 'X House',
    alertId: 'm3', from: 'https://x.co/a', to: 'https://y.co/b', notes: '',
    classification: null,
  });
  assert(card !== null, 'card returned');
  assert(!/FIRE-1 verdict/.test(card.message), 'no verdict line when classification absent');
}

console.log('\nTest 24: buildActionableCardForDetail — no-catalogue + unreachable cards have Re-heal');
{
  const noCat = buildActionableCardForDetail({
    verdict: VERDICTS.NO_CATALOGUE_FOUND, slug: 'bramleys', displayName: 'Bramleys',
    alertId: 'nc1', consecutive: 4, notes: '', siteStatus: 'no_current_auction',
  });
  const unreach = buildActionableCardForDetail({
    verdict: VERDICTS.UNREACHABLE, slug: 'sutton', displayName: 'Sutton Kersh',
    alertId: 'u1', consecutive: 5, fetchError: 'timeout',
  });
  assert(noCat.buttons.flat().map(b => b.callback_data).includes('rerun:nc1'), 'no-catalogue has rerun');
  assert(unreach.buttons.flat().map(b => b.callback_data).includes('rerun:u1'), 'unreachable has rerun');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
