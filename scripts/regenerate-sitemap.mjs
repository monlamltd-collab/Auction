#!/usr/bin/env node
/**
 * Regenerate sitemap.xml
 * ======================
 * Builds public/sitemap.xml with the static landing URLs plus one entry per
 * upcoming-or-recent lot. Run nightly via the server cron in scheduleTick()
 * so search engines see fresh URLs as auctions cycle through.
 *
 * Window:
 *   - all available lots whose auction_date >= today, OR
 *   - lots seen in the last 7 days (covers freshly-scraped lots that don't
 *     yet have a parsed auction_date).
 *
 * Usage:
 *   node scripts/regenerate-sitemap.mjs            # write to public/sitemap.xml
 *   node scripts/regenerate-sitemap.mjs --dry      # print URL count, don't write
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in env.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry');

const SITE_ORIGIN = 'https://auctions.bridgematch.co.uk';
const STATIC_URLS = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/check', changefreq: 'weekly', priority: '0.9' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { loc: '/terms', changefreq: 'yearly', priority: '0.3' },
];
const MAX_LOT_URLS = 40000;

export async function regenerateSitemap({ dry = false } = {}) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } },
  );

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('lots')
    .select('id, last_seen_at, auction_date, status')
    .or(`auction_date.gte.${today},last_seen_at.gte.${sevenDaysAgo}`)
    .neq('status', 'sold')
    .neq('status', 'withdrawn')
    .order('last_seen_at', { ascending: false })
    .limit(MAX_LOT_URLS);

  if (error) {
    console.error('regenerateSitemap: query failed:', error.message);
    process.exitCode = 1;
    return { wrote: false, reason: error.message };
  }

  const rows = data || [];
  const lotEntries = rows.map(r => ({
    loc: `/lot/${r.id}`,
    changefreq: 'daily',
    priority: '0.6',
    lastmod: (r.last_seen_at || '').slice(0, 10) || today,
  }));

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...STATIC_URLS.map(entryToXml),
    ...lotEntries.map(entryToXml),
    '</urlset>',
    '',
  ].join('\n');

  console.log(`regenerateSitemap: ${STATIC_URLS.length} static + ${lotEntries.length} lot URLs`);

  if (dry) {
    return { wrote: false, reason: 'dry-run', urlCount: STATIC_URLS.length + lotEntries.length };
  }

  const target = join(__dirname, '..', 'public', 'sitemap.xml');
  writeFileSync(target, xml);
  console.log(`regenerateSitemap: wrote ${xml.length} bytes to ${target}`);
  return { wrote: true, urlCount: STATIC_URLS.length + lotEntries.length, bytes: xml.length };
}

function entryToXml(entry) {
  const parts = [
    `  <url>`,
    `    <loc>${SITE_ORIGIN}${entry.loc}</loc>`,
  ];
  if (entry.lastmod) parts.push(`    <lastmod>${entry.lastmod}</lastmod>`);
  if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  if (entry.priority) parts.push(`    <priority>${entry.priority}</priority>`);
  parts.push(`  </url>`);
  return parts.join('\n');
}

// CLI entry — only run when executed directly, not when imported by server.js.
const isDirectInvocation = process.argv[1] && (
  process.argv[1].endsWith('regenerate-sitemap.mjs') ||
  process.argv[1].endsWith('regenerate-sitemap')
);
if (isDirectInvocation) {
  regenerateSitemap({ dry: DRY }).catch(err => {
    console.error('regenerateSitemap: crashed:', err.message);
    process.exit(1);
  });
}
