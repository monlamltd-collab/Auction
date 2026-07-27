// lib/pipeline/loveitts-auctions.js
// Pure parse + optional fetch for Loveitts (Auction House Coventry & Warwickshire
// franchise on loveitts.co.uk) next-sale calendar spine.
//
// Live source of truth (verified 2026-07-27):
//   https://www.loveitts.co.uk/auctions/  — <option value="YYYY-MM-DD HH:MM:SS">
//   https://www.loveitts.co.uk/auctions/upcoming-auctions — sale cards + data-date
//
// Catalogue scrape stays on the main /auctions/ grid (rewriteUrl pins it). We do
// NOT use the EIG live-stream embed as a catalogue — it has no lot cards and
// previously seeded always_on + 2099 junk rows.

export const LOVEITTS_CATALOGUE_URL = 'https://www.loveitts.co.uk/auctions/';
export const LOVEITTS_UPCOMING_URL = 'https://www.loveitts.co.uk/auctions/upcoming-auctions';
export const LOVEITTS_LIVE_STREAM_URL =
  'https://www.eigpropertyauctions.co.uk/live-stream/auction/loveitts';

const OPTION_DATE_RE =
  /<option[^>]*\bvalue=["'](\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)["'][^>]*>/gi;
const DATA_DATE_RE = /\bdata-date=["'](\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)["']/gi;
const HIDDEN_AUCTION_DATE_RE =
  /name=["']auction_date["'][^>]*value=["'](\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)["']/gi;
const SALE_CARD_RE =
  /href=["'](\/auctions\/upcoming-auctions\/(\d+))["'][\s\S]{0,1200}?Date:\s*[^<]{0,80}?(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+(20\d{2})/gi;

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * @param {string|null|undefined} y
 * @param {string|number|null|undefined} m
 * @param {string|number|null|undefined} d
 * @returns {string|null} YYYY-MM-DD
 */
export function toIsoDate(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * @param {string|null|undefined} raw  e.g. 2026-07-28 11:00:00
 * @returns {string|null}
 */
export function loveittsTimestampToIsoDate(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return toIsoDate(m[1], m[2], m[3]);
}

function pushDate(bucket, iso, meta = {}) {
  if (!iso) return;
  if (!bucket.has(iso)) {
    bucket.set(iso, {
      date: iso,
      saleIds: new Set(),
      times: new Set(),
      sources: new Set(),
    });
  }
  const row = bucket.get(iso);
  if (meta.saleId) row.saleIds.add(String(meta.saleId));
  if (meta.time) row.times.add(String(meta.time));
  if (meta.source) row.sources.add(String(meta.source));
}

/**
 * Collect future auction dates from Loveitts HTML (catalogue and/or upcoming page).
 * @param {string} html
 * @param {{ todayIso?: string }} [opts]
 * @returns {Map<string, {date:string,saleIds:Set,times:Set,sources:Set}>}
 */
export function collectLoveittsAuctionDates(html, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const bucket = new Map();
  if (!html) return bucket;

  const absorbTs = (datePart, timePart, source) => {
    const iso = loveittsTimestampToIsoDate(datePart);
    if (!iso || iso < todayIso) return;
    pushDate(bucket, iso, { time: timePart || null, source });
  };

  for (const re of [OPTION_DATE_RE, DATA_DATE_RE, HIDDEN_AUCTION_DATE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      absorbTs(m[1], m[2], re === OPTION_DATE_RE ? 'option' : re === DATA_DATE_RE ? 'data-date' : 'hidden');
    }
  }

  SALE_CARD_RE.lastIndex = 0;
  let cm;
  while ((cm = SALE_CARD_RE.exec(html)) !== null) {
    const mon = MONTHS[String(cm[4] || '').toLowerCase()];
    const iso = toIsoDate(cm[5], mon, cm[3]);
    if (!iso || iso < todayIso) continue;
    pushDate(bucket, iso, { saleId: cm[2], source: 'sale-card' });
  }

  return bucket;
}

/**
 * Build watcher calendar entries from one or more Loveitts HTML pages.
 * Same catalogue URL for every dated row (unique key is url+date); scraper
 * rewriteUrl pins HOUSE_ROOTS.loveitts regardless of stale calendar hosts.
 *
 * @param {string|string[]} htmlOrList
 * @param {{ todayIso?: string, catalogueUrl?: string }} [opts]
 * @returns {Array<{url:string,date:string,title:string,source:string,catalogueReady:boolean,saleIds?:string[]}>}
 */
export function entriesFromLoveittsHtml(htmlOrList, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const catalogueUrl = opts.catalogueUrl || LOVEITTS_CATALOGUE_URL;
  const pages = Array.isArray(htmlOrList) ? htmlOrList : [htmlOrList];
  const bucket = new Map();
  for (const html of pages) {
    const part = collectLoveittsAuctionDates(html, { todayIso });
    for (const [iso, row] of part) {
      if (!bucket.has(iso)) {
        bucket.set(iso, row);
      } else {
        const dest = bucket.get(iso);
        for (const id of row.saleIds) dest.saleIds.add(id);
        for (const t of row.times) dest.times.add(t);
        for (const s of row.sources) dest.sources.add(s);
      }
    }
  }

  const out = [];
  for (const row of bucket.values()) {
    const saleIds = [...row.saleIds].sort();
    // Dates advertised on the live catalogue select/options are published.
    const ready = row.sources.has('option') || row.sources.has('data-date') || saleIds.length > 0;
    out.push({
      url: catalogueUrl,
      date: row.date,
      title: saleIds.length
        ? `Loveitts ${row.date} (#${saleIds.join(',')})`
        : `Loveitts ${row.date}`,
      source: 'loveitts-auctions-html',
      catalogueReady: ready,
      saleIds: saleIds.length ? saleIds : undefined,
    });
  }
  out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

/**
 * Fetch Loveitts catalogue + upcoming pages and return calendar entries.
 * Fail closed → [].
 * @param {{ fetchImpl?: typeof fetch, todayIso?: string, headers?: object, catalogueUrl?: string }} [opts]
 */
export async function discoverLoveittsAuctionEntries(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return [];
  const headers = opts.headers || {
    'User-Agent': 'AuctionBrainBot/1.0 (+https://auctions.bridgematch.co.uk)',
    Accept: 'text/html,application/xhtml+xml',
  };
  const urls = [LOVEITTS_CATALOGUE_URL, LOVEITTS_UPCOMING_URL];
  const pages = [];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let resp;
      try {
        resp = await fetchImpl(url, { headers, redirect: 'follow', signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!resp?.ok) continue;
      const html = await resp.text();
      if (html && html.length > 200) pages.push(html);
    } catch {
      /* try next page */
    }
  }
  if (!pages.length) return [];
  return entriesFromLoveittsHtml(pages, {
    todayIso: opts.todayIso,
    catalogueUrl: opts.catalogueUrl || LOVEITTS_CATALOGUE_URL,
  });
}
