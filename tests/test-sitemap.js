// tests/test-sitemap.js — Defends the dynamic sitemap (SEO Phase 1, 2026-07-03).
// The old static public/sitemap.xml was regenerated on the WORKER container
// while the WEB container served a 5-URL stub — Google never saw a lot URL.
// These tests pin the pure builders in lib/sitemap.js: entry composition
// (live + sold-archive cohorts, dedup, cap) and XML shape.
import {
  buildSitemapEntries, renderSitemapXml, STATIC_URLS, MAX_LOT_URLS, SITE_ORIGIN,
} from '../lib/sitemap.js';
import { renderNotFoundHtml } from '../routes/lots-render.js';

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else { console.log(`✗ ${label}`); fail++; }
};

const live = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', last_seen_at: '2026-07-01T10:00:00Z' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', last_seen_at: null },
];
const sold = [
  { id: 'bbbbbbbb-0000-0000-0000-000000000001', last_seen_at: '2026-05-10T10:00:00Z' },
  // same id as a live row — must not appear twice
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', last_seen_at: '2026-05-01T10:00:00Z' },
];

const entries = buildSitemapEntries({ liveRows: live, soldRows: sold });

check('static URLs lead the sitemap', entries[0].loc === '/' && entries.length >= STATIC_URLS.length);
check('live lot present with priority 0.6/daily',
  entries.some(e => e.loc === '/lot/aaaaaaaa-0000-0000-0000-000000000001' && e.priority === '0.6' && e.changefreq === 'daily'));
check('sold lot present with priority 0.4/monthly (archive stays indexable)',
  entries.some(e => e.loc === '/lot/bbbbbbbb-0000-0000-0000-000000000001' && e.priority === '0.4' && e.changefreq === 'monthly'));
check('id shared between cohorts appears exactly once',
  entries.filter(e => e.loc === '/lot/aaaaaaaa-0000-0000-0000-000000000001').length === 1);
check('null last_seen_at falls back to today (no empty lastmod)',
  entries.find(e => e.loc === '/lot/aaaaaaaa-0000-0000-0000-000000000002').lastmod.length === 10);

// Cap: live rows always win over the sold archive.
{
  const manyLive = Array.from({ length: MAX_LOT_URLS }, (_, i) => ({ id: `live-${i}`, last_seen_at: null }));
  const capped = buildSitemapEntries({ liveRows: manyLive, soldRows: sold });
  check('cap enforced at MAX_LOT_URLS lot entries', capped.length === STATIC_URLS.length + MAX_LOT_URLS);
  check('sold archive is what the cap squeezes out', !capped.some(e => e.loc.startsWith('/lot/bbbbbbbb')));
}

const xml = renderSitemapXml(entries);
check('xml declares urlset namespace', xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
check('xml locs are absolute on the canonical origin', xml.includes(`<loc>${SITE_ORIGIN}/lot/aaaaaaaa-0000-0000-0000-000000000001</loc>`));
check('xml carries lastmod', xml.includes('<lastmod>2026-07-01</lastmod>'));
check('xml is well-formed at the edges', xml.startsWith('<?xml version="1.0"') && xml.trimEnd().endsWith('</urlset>'));

// The shared 404 page (true 404s replace the soft-404 SPA catch-all).
{
  const html = renderNotFoundHtml();
  check('404 page is noindex', html.includes('name="robots" content="noindex"'));
  check('404 page links home', html.includes('href="/"'));
  const lotHtml = renderNotFoundHtml({ heading: 'Lot not found', message: 'x <script>' });
  check('404 heading customisable + escaped', lotHtml.includes('Lot not found') && !lotHtml.includes('<script>x') && lotHtml.includes('&lt;script&gt;'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
