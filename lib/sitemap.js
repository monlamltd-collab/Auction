// lib/sitemap.js — dynamic sitemap.xml (SEO Phase 1, 2026-07-03)
//
// Replaces scripts/regenerate-sitemap.mjs + the static public/sitemap.xml.
// The old design ran on the WORKER (nightly cron) and wrote a local file,
// while the WEB container served the 5-URL repo copy — Railway containers
// don't share a filesystem, so Google never saw a single lot URL. The web
// process now builds the sitemap straight from Supabase, cached in-process
// for an hour.
//
// Two cohorts:
//   * LIVE lots  — available/upcoming (auction_date >= today, or seen in the
//     last 7 days for lots without a parsed date). priority 0.6, daily.
//   * SOLD lots  — the archive. "What did X sell for at auction" pages are
//     compounding SEO content, so sold lots STAY indexable (priority 0.4,
//     monthly). Withdrawn lots are excluded — nothing to say about them.
//
// Pure helpers (buildSitemapEntries / renderSitemapXml) are exported for
// tests; getSitemapXml is the cached I/O wrapper the route uses.

export const SITE_ORIGIN = 'https://auctions.bridgematch.co.uk';

export const STATIC_URLS = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/check', changefreq: 'weekly', priority: '0.9' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { loc: '/terms', changefreq: 'yearly', priority: '0.3' },
];

// Google's hard cap is 50k URLs per sitemap file; stay under it with room.
export const MAX_LOT_URLS = 40000;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
let _cache = { xml: null, builtAt: 0 };

export function buildSitemapEntries({ liveRows = [], soldRows = [] } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const entries = [...STATIC_URLS];
  const push = (r, priority, changefreq) => {
    if (!r?.id || seen.has(r.id)) return;
    seen.add(r.id);
    entries.push({
      loc: `/lot/${r.id}`,
      changefreq,
      priority,
      lastmod: (r.last_seen_at || '').slice(0, 10) || today,
    });
  };
  // Live first — if the cap bites, it bites the oldest archive entries.
  for (const r of liveRows) {
    if (entries.length - STATIC_URLS.length >= MAX_LOT_URLS) break;
    push(r, '0.6', 'daily');
  }
  for (const r of soldRows) {
    if (entries.length - STATIC_URLS.length >= MAX_LOT_URLS) break;
    push(r, '0.4', 'monthly');
  }
  return entries;
}

export function renderSitemapXml(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(entryToXml),
    '</urlset>',
    '',
  ].join('\n');
}

function entryToXml(entry) {
  const parts = [
    '  <url>',
    `    <loc>${SITE_ORIGIN}${entry.loc}</loc>`,
  ];
  if (entry.lastmod) parts.push(`    <lastmod>${entry.lastmod}</lastmod>`);
  if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  if (entry.priority) parts.push(`    <priority>${entry.priority}</priority>`);
  parts.push('  </url>');
  return parts.join('\n');
}

// PostgREST caps every response at its max-rows setting (1,000 by default)
// no matter what .limit() asks for — the initial deploy served exactly
// 2,000 lot URLs (1,000 per cohort) of the ~23k real ones. Page with
// .range() instead; ordering must be deterministic (last_seen_at DESC with
// id as tiebreaker) or pages overlap — the visual-audit lesson.
const PAGE_SIZE = 1000;
async function fetchAllRows(buildQuery, cap) {
  const rows = [];
  let from = 0;
  while (rows.length < cap) {
    const { data, error } = await buildQuery()
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { rows: rows.slice(0, cap), error: null };
}

/**
 * Cached sitemap for the /sitemap.xml route. Returns the last good XML on
 * query failure (stale beats a 500 for a crawler), null only when there has
 * never been a successful build.
 */
export async function getSitemapXml(supabase, { force = false } = {}) {
  if (!force && _cache.xml && Date.now() - _cache.builtAt < CACHE_TTL_MS) {
    return _cache.xml;
  }
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [live, sold] = await Promise.all([
    fetchAllRows(() => supabase
      .from('lots')
      .select('id, last_seen_at')
      .or(`auction_date.gte.${today},last_seen_at.gte.${sevenDaysAgo}`)
      .neq('status', 'sold')
      .neq('status', 'withdrawn'), MAX_LOT_URLS),
    fetchAllRows(() => supabase
      .from('lots')
      .select('id, last_seen_at')
      .eq('status', 'sold'), MAX_LOT_URLS),
  ]);

  if (live.error || sold.error) {
    console.warn(`SITEMAP: query failed (${live.error?.message || sold.error?.message}) — serving ${_cache.xml ? 'stale cache' : 'nothing'}`);
    return _cache.xml;
  }

  const xml = renderSitemapXml(buildSitemapEntries({
    liveRows: live.rows,
    soldRows: sold.rows,
  }));
  _cache = { xml, builtAt: Date.now() };
  return xml;
}

// Test seam — reset the cache between test cases.
export function _resetSitemapCache() {
  _cache = { xml: null, builtAt: 0 };
}
