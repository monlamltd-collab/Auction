// lib/pipeline/saved-search-alerts.js
// ═══════════════════════════════════════════════════════════════
// SAVED-SEARCH EMAIL ALERTS (Pro feature)
// ═══════════════════════════════════════════════════════════════
//
// For every saved_search where notify_email = true AND the owner is a
// Pro subscriber, find lots seen since last_notified_at that match the
// saved filter set, and send the user a digest email with deep links.
//
// Runs daily 08:00 UK via a server.js cron tier. Skips searches with
// zero matches (so a quiet stretch doesn't reset last_notified_at and
// suddenly flood the user when one match finally appears).
//
// Pure functions live above the impure cycle runner so the matcher can
// be unit-tested without touching DB or Resend.

import { dbRowToLot } from '../types/lot.js';

// ═══════════════════════════════════════════════════════════════
// Pure matcher — given a frontend-shaped lot and the filter spec from
// saved_searches.filters JSONB, returns true if the lot satisfies the
// filters. Mirrors the subset of frontend filters that make sense in a
// digest context. (Skipped: sort, postcode radius, smart-search query —
// those are display/discovery, not "did this match".)
// ═══════════════════════════════════════════════════════════════
export function matchLotAgainstFilters(lot, filters) {
  if (!lot || !filters) return false;

  // Price band — both bounds optional; null/'' = no constraint that side
  const min = parseInt(filters.minPrice, 10);
  const max = parseInt(filters.maxPrice, 10);
  if (Number.isFinite(min) && (lot.price == null || lot.price < min)) return false;
  if (Number.isFinite(max) && (lot.price == null || lot.price > max)) return false;

  // POA exclusion — if 'yes', filter out lots with no price
  if (filters.excludePOA === 'yes' && (lot.price == null || lot.price === 0)) return false;

  // Beds — filter is "N+", e.g. "3" means 3 or more
  const minBeds = parseInt(filters.beds, 10);
  if (Number.isFinite(minBeds)) {
    if (lot.beds == null || lot.beds < minBeds) return false;
  }

  // Property type — substring match against propType (case-insensitive)
  if (filters.type) {
    const want = String(filters.type).toLowerCase();
    const got = String(lot.propType || '').toLowerCase();
    if (!got.includes(want)) return false;
  }

  // Status — status filters use specific tokens; default 'all' = any
  const status = filters.status;
  if (status && status !== 'all' && status !== 'everything') {
    const lotStatus = String(lot.status || 'available').toLowerCase();
    if (status === 'available' && lotStatus !== 'available') return false;
    if (status === 'unsold' && lotStatus !== 'unsold' && lotStatus !== 'no_bid' && lotStatus !== 'not_sold') return false;
    if (status === 'sold' && lotStatus !== 'sold') return false;
    if (status === 'stc' && lotStatus !== 'stc' && lotStatus !== 'sale_agreed') return false;
    if (status === 'withdrawn' && lotStatus !== 'withdrawn') return false;
    // recently_unsold + everything: rely on caller to scope the query window
  }

  // Tenure — Freehold / Leasehold / Share of Freehold (exact)
  if (filters.tenure) {
    if (String(lot.tenure || '').toLowerCase() !== String(filters.tenure).toLowerCase()) return false;
  }

  // Region — substring match on address (light, not perfect, fine for digest)
  if (filters.location) {
    const want = String(filters.location).toLowerCase();
    const haystack = (String(lot.address || '') + ' ' + String(lot._searchText || '')).toLowerCase();
    if (!haystack.includes(want)) return false;
  }

  // Town — substring match on address
  if (filters.town) {
    const want = String(filters.town).toLowerCase().trim();
    if (want && !String(lot.address || '').toLowerCase().includes(want)) return false;
  }

  // Postcode prefix (e.g. "BS" matches BS1 1AB, BS6 5RT)
  if (filters.postcode) {
    const want = String(filters.postcode).toUpperCase().replace(/\s+/g, '');
    if (want) {
      const got = String(lot.postcode || '').toUpperCase().replace(/\s+/g, '');
      if (!got.startsWith(want)) return false;
    }
  }

  // Condition — substring match
  if (filters.condition) {
    const want = String(filters.condition).toLowerCase();
    const got = String(lot.condition || '').toLowerCase();
    if (!got.includes(want)) return false;
  }

  // Deal type — substring match
  if (filters.deal) {
    const want = String(filters.deal).toLowerCase();
    const got = String(lot.dealType || '').toLowerCase();
    if (!got.includes(want)) return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════
// Pure email-body renderer — text-mode for now (Resend will accept it
// as an HTML body too via inline minimal markup). Returns { subject, html }.
// ═══════════════════════════════════════════════════════════════
const SITE = 'https://auctions.bridgematch.co.uk';

export function renderAlertEmail({ searchName, matches }) {
  const n = matches.length;
  const subject = `${n} new lot${n === 1 ? '' : 's'} match your saved search "${searchName}"`;

  const cards = matches.slice(0, 10).map(lot => {
    const price = lot.price ? '£' + Number(lot.price).toLocaleString('en-GB') : (lot.priceText || 'Guide TBA');
    const score = lot.score != null ? ` · Score ${Number(lot.score).toFixed(1)}/10` : '';
    const propType = lot.propType ? ` · ${lot.propType}` : '';
    const url = lot.id ? `${SITE}/lot/${lot.id}` : SITE;
    const img = lot.imageUrl
      ? `<img src="${escapeHtml(lot.imageUrl)}" alt="" style="width:100%;max-width:520px;border-radius:8px;margin:0 0 8px"/>`
      : '';
    const addr = escapeHtml(lot.address || 'Auction lot');
    return [
      `<div style="margin:0 0 24px;padding:0 0 24px;border-bottom:1px solid #e4dfd6">`,
      img,
      `<div style="font-family:'Source Serif 4',Georgia,serif;font-size:18px;color:#1a2a3a;margin:0 0 6px">${addr}</div>`,
      `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f8a5f;font-weight:600;margin:0 0 4px">${escapeHtml(price)}</div>`,
      `<div style="font-family:Arial,sans-serif;font-size:13px;color:#6b7c8d;margin:0 0 12px">${escapeHtml(String(lot._house || '').toUpperCase())}${propType}${score}</div>`,
      `<a href="${escapeHtml(url)}" style="display:inline-block;font-family:Arial,sans-serif;font-size:14px;font-weight:600;background:#c0392b;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">Open this lot →</a>`,
      `</div>`,
    ].join('\n');
  }).join('\n');

  const more = n > 10
    ? `<p style="font-family:Arial,sans-serif;font-size:14px;color:#6b7c8d;margin:0 0 16px">…and ${n - 10} more matches. <a href="${SITE}" style="color:#c0392b">See all on Auction Brain →</a></p>`
    : '';

  const html = [
    `<!doctype html><html><body style="background:#faf8f4;margin:0;padding:24px;font-family:Arial,sans-serif;color:#1a1714">`,
    `<div style="max-width:560px;margin:0 auto;background:#fff;padding:32px 24px;border-radius:12px">`,
    `<div style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;margin:0 0 4px"><span style="color:#1a1714">Auction</span><span style="color:#c0392b">Brain</span></div>`,
    `<h1 style="font-family:'Source Serif 4',Georgia,serif;font-size:22px;line-height:1.3;color:#1a2a3a;margin:16px 0 8px">${n} new ${n === 1 ? 'lot matches' : 'lots match'} your saved search</h1>`,
    `<p style="font-family:Arial,sans-serif;font-size:15px;color:#6b7c8d;margin:0 0 24px">"${escapeHtml(searchName)}"</p>`,
    cards,
    more,
    `<p style="font-family:Arial,sans-serif;font-size:13px;color:#8a847a;margin:24px 0 0">You're getting this because you saved this search and turned on email alerts. <a href="${SITE}" style="color:#c0392b">Manage your alerts</a>.</p>`,
    `</div></body></html>`,
  ].join('\n');

  return { subject, html };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════
// Cycle runner — the impure orchestration. deps lets the caller inject
// the email sender so the module stays testable.
//
//   deps.sendEmail({ to, subject, html })  → Promise<{ ok }>
//   deps.log                                 structured logger
// ═══════════════════════════════════════════════════════════════
const RECENT_LOT_WINDOW_DAYS = 14;
const MAX_LOTS_PER_QUERY = 500;
const SAVED_LOT_FIELDS = 'id, house, lot_number, url, address, postcode, price, price_text, prop_type, beds, tenure, condition, status, image_url, score, deal_type, last_seen_at, search_text';

export async function runSavedSearchAlertsCycle(supabase, deps = {}) {
  const enabled = (process.env.SAVED_SEARCH_ALERTS_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    deps.log?.info?.('saved-search-alerts: SAVED_SEARCH_ALERTS_ENABLED=false — skipping');
    return { skipped: true, reason: 'disabled' };
  }

  // Pull all enabled saved searches with their owner. Two-step query —
  // PostgREST's relational shorthand (`users (...)`) avoids a manual join.
  const { data: searches, error: sErr } = await supabase
    .from('saved_searches')
    .select('id, user_id, name, filters, created_at, last_notified_at, users(email, tier, supabase_auth_id)')
    .eq('notify_email', true)
    .limit(1000);

  if (sErr) {
    deps.log?.error?.('saved-search-alerts: fetch failed', { err: sErr.message });
    return { skipped: false, error: sErr.message };
  }

  const summary = { total: searches?.length || 0, eligible: 0, sent: 0, skipped: 0, errors: 0 };

  for (const s of searches || []) {
    const owner = s.users || {};
    if (owner.tier !== 'premium') {
      // Soft-skip non-Pro owners. Their toggle stays on, but cron never
      // sends until they upgrade again. No need to flip the flag.
      summary.skipped++;
      continue;
    }
    if (!owner.email) { summary.skipped++; continue; }
    summary.eligible++;

    const since = s.last_notified_at
      ? new Date(s.last_notified_at).toISOString()
      : new Date(Date.now() - RECENT_LOT_WINDOW_DAYS * 86400000).toISOString();

    // Fetch candidate lots — recent + status-eligible. We over-fetch
    // and filter in JS via matchLotAgainstFilters, avoiding any
    // server-side filter-translation logic. Capped to keep the
    // payload small even for new-flag-just-flipped users.
    const { data: lotRows, error: lErr } = await supabase
      .from('lots')
      .select(SAVED_LOT_FIELDS)
      .gte('last_seen_at', since)
      .neq('status', 'sold')
      .neq('status', 'withdrawn')
      .order('last_seen_at', { ascending: false })
      .limit(MAX_LOTS_PER_QUERY);

    if (lErr) {
      summary.errors++;
      deps.log?.warn?.('saved-search-alerts: lots fetch failed', { searchId: s.id, err: lErr.message });
      continue;
    }

    const matches = (lotRows || [])
      .map(dbRowToLot)
      .filter(lot => matchLotAgainstFilters(lot, s.filters || {}));

    if (matches.length === 0) {
      // No matches — leave last_notified_at alone so the next run still
      // has the same window. User gets nothing in their inbox.
      continue;
    }

    const { subject, html } = renderAlertEmail({ searchName: s.name, matches });

    let sendOk = false;
    try {
      const r = await deps.sendEmail?.({ to: owner.email, subject, html });
      sendOk = !!(r && r.ok !== false);
    } catch (e) {
      deps.log?.warn?.('saved-search-alerts: send failed', { searchId: s.id, err: e.message });
    }

    if (sendOk) {
      summary.sent++;
      const { error: updErr } = await supabase
        .from('saved_searches')
        .update({ last_notified_at: new Date().toISOString() })
        .eq('id', s.id);
      if (updErr) deps.log?.warn?.('saved-search-alerts: last_notified_at update failed', { searchId: s.id, err: updErr.message });
    } else {
      summary.errors++;
    }
  }

  deps.log?.info?.('saved-search-alerts: cycle complete', summary);
  return { skipped: false, summary };
}
