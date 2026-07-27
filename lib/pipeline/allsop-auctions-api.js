// lib/pipeline/allsop-auctions-api.js
// Pure parse + optional fetch for Allsop next-sale calendar spine.
// Source of truth: https://www.allsop.co.uk/api/auctions/current-and-past
// Catalogue scrape URLs stay the property-search APIs (rewriteUrl already maps).

export const ALLSOP_AUCTIONS_API_URL = 'https://www.allsop.co.uk/api/auctions/current-and-past';

export const ALLSOP_RESIDENTIAL_CATALOGUE_URL =
  'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=residential&page=1&react';

export const ALLSOP_COMMERCIAL_CATALOGUE_URL =
  'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=commercial&page=1&react';

/**
 * Allsop stores UK midnights as previous-day 23:00Z during BST.
 * Convert auction timestamp → Europe/London calendar date (YYYY-MM-DD).
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function allsopAuctionDateToUkIso(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function pushAuctionCandidate(bucket, item, kind) {
  if (!item || typeof item !== 'object') return;
  bucket.push({ item, kind: kind === 'commercial' ? 'commercial' : 'residential' });
}

/**
 * Build watcher calendar entries from the Allsop auctions API JSON.
 * Ready only when lots_published or early_lots is true — never invent readiness.
 *
 * @param {object} payload
 * @param {{ todayIso?: string }} [opts]
 * @returns {Array<{url:string,date:string,title:string,source:string,catalogueReady:boolean}>}
 */
export function entriesFromAllsopAuctionsPayload(payload, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const candidates = [];
  const data = payload && typeof payload === 'object' ? payload.data : null;

  if (data && typeof data === 'object') {
    pushAuctionCandidate(candidates, data.next_residential_auction, 'residential');
    pushAuctionCandidate(candidates, data.next_commercial_auction, 'commercial');
  }

  for (const [key, kind] of [
    ['futureResi', 'residential'],
    ['futureComm', 'commercial'],
  ]) {
    const v = payload?.[key];
    if (!v) continue;
    if (Array.isArray(v)) {
      for (const item of v) pushAuctionCandidate(candidates, item, kind);
    } else if (typeof v === 'object') {
      pushAuctionCandidate(candidates, v, kind);
    }
  }

  const out = [];
  const seen = new Set();
  for (const { item, kind } of candidates) {
    const date = allsopAuctionDateToUkIso(item.allsop_auctiondate);
    if (!date || date < todayIso) continue;
    const url = kind === 'commercial'
      ? ALLSOP_COMMERCIAL_CATALOGUE_URL
      : ALLSOP_RESIDENTIAL_CATALOGUE_URL;
    const dedupe = `${url}|${date}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const ready = item.lots_published === true || item.early_lots === true;
    const title = item.allsop_name
      ? String(item.allsop_name)
      : `Allsop ${kind} ${date}`;

    out.push({
      url,
      date,
      title,
      source: 'allsop-auctions-api',
      catalogueReady: ready,
      auctionType: kind,
      auctionRef: item.allsop_auctionreference || null,
    });
  }

  out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

/**
 * Fetch + parse Allsop auctions API. Returns [] on any failure (fail closed).
 * @param {{ fetchImpl?: typeof fetch, todayIso?: string, headers?: object }} [opts]
 */
export async function discoverAllsopAuctionEntries(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let resp;
    try {
      resp = await fetchImpl(ALLSOP_AUCTIONS_API_URL, {
        headers: opts.headers || {
          'User-Agent': 'AuctionBrainBot/1.0 (+https://auctions.bridgematch.co.uk)',
          Accept: 'application/json',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp?.ok) return [];
    const payload = await resp.json();
    return entriesFromAllsopAuctionsPayload(payload, { todayIso: opts.todayIso });
  } catch {
    return [];
  }
}
