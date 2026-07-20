// lib/pipeline/discovery.js — Catalogue URL discovery
// Scans auction house homepages to find new catalogue URLs that aren't
// yet in the calendar. Uses Firecrawl (primary) or plain HTTP to fetch
// each house's root page, then asks Gemini to extract catalogue links.
//
// Runs AFTER the scrape cycle (Step 4 in _doAutoAnalyseAll) so users see
// fresh lots before we spend credits on discovery.
//
// Dependencies injected via `deps` to keep this module pure.

import { supabase } from '../supabase.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../houses.js';
import { normaliseUrl } from '../utils.js';
import { fetchPage } from '../scraper/http.js';
import { scrapeWithCrawlee, hasCrawlee } from '../scraper/crawlee.js';
import { healCandidateVerdict } from './healing.js';

let _consecutiveMisses = 0;

/**
 * @param {object} deps - Injected dependencies
 * @param {string|undefined} deps.FIRECRAWL_API_KEY
 * @param {function} deps.isFcCreditExhausted
 * @param {function} deps.scrapeWithFirecrawl
 * @param {function} deps.callAI
 * @param {object} deps.HEADERS - HTTP request headers
 * @returns {Promise<{ discovered: number, errors: number }>}
 */
export async function discoverAndUpdateCalendar(deps) {
  if (!supabase || !process.env.GEMINI_API_KEY) return { discovered: 0, errors: 0 };

  // Only discover for houses that DON'T already have a calendar entry.
  const { data: existingCalendar } = await supabase
    .from('auction_calendar')
    .select('house_slug')
    .gte('date', new Date().toISOString().slice(0, 10));
  const alreadyInCalendar = new Set((existingCalendar || []).map(r => r.house_slug).filter(Boolean));

  const slugs = Object.keys(HOUSE_ROOTS).filter(s => !alreadyInCalendar.has(s));
  console.log(`AUTO-DISCOVER: Checking ${slugs.length} house root pages for new catalogues (${alreadyInCalendar.size} already in calendar, skipped)`);

  let discovered = 0, errors = 0;

  for (const slug of slugs) {
    const rootUrl = HOUSE_ROOTS[slug];
    try {
      // ── Fetch root page ──
      const html = await _fetchRootPage(rootUrl, slug, deps);
      if (!html) continue;

      // ── Extract text + links for AI ──
      const { stripped, hrefs } = _extractDiscoveryContent(html);
      if (hrefs.length === 0 && stripped.length < 200) continue;

      // ── Ask AI to find catalogue URLs ──
      const catalogues = await _askAIForCatalogues(slug, rootUrl, stripped, hrefs, deps);
      if (!catalogues) continue;

      // ── Upsert discovered catalogues ──
      const found = await _upsertCatalogues(slug, catalogues, deps);
      discovered += found;

      // Brief pause between houses
      await new Promise(r => setTimeout(r, 1000));

    } catch (e) {
      errors++;
      // Silent — don't let one house's failure stop the rest
    }
  }

  console.log(`AUTO-DISCOVER: Complete — ${discovered} new catalogues found, ${errors} errors`);

  // ── Pipeline alerting ──
  await _recordAlerts(slugs.length, discovered, errors);

  return { discovered, errors };
}

// ── Fetch root page: plain HTTP → Crawlee render (for JS homepages) ──
// Firecrawl removed (CF-bypass-only): the FC branch threw under the gate and the
// plain-fetch fallback returned thin JS shells, so discovery found 0 links on
// rendered homepages. fetchPage covers static homepages; scrapeWithCrawlee
// renders the JS-hydrated ones. Gemini link extraction downstream is unchanged.
async function _fetchRootPage(rootUrl, slug, deps) {
  let html = '';
  try {
    html = await fetchPage(rootUrl);
  } catch (httpErr) {
    console.log(`AUTO-DISCOVER: plain fetch failed for ${slug}: ${httpErr.message}`);
  }
  if ((!html || html.length < 1000) && hasCrawlee()) {
    try {
      const rendered = await scrapeWithCrawlee(rootUrl);
      if (rendered?.html && rendered.html.length > (html ? html.length : 0)) {
        html = rendered.html;
      }
    } catch (crErr) {
      console.log(`AUTO-DISCOVER: Crawlee render failed for ${slug}: ${crErr.message}`);
    }
  }
  return html || null;
}

// ── Extract text + auction-related links ──
function _extractDiscoveryContent(html) {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 6000);

  const hrefMatches = [...html.matchAll(/href="([^"]*(?:auction|lot|catalogue|sale|propert)[^"]*)"/gi)];
  const hrefs = [...new Set(hrefMatches.map(m => m[1]))].slice(0, 40);

  return { stripped, hrefs };
}

// ── Ask Gemini to extract catalogue links ──
async function _askAIForCatalogues(slug, rootUrl, stripped, hrefs, deps) {
  const aiText = await deps.callAI(`Extract auction catalogue links from this auction house page.

House: ${HOUSE_DISPLAY_NAMES[slug] || slug}
Root URL: ${rootUrl}

Page text (truncated):
${stripped}

Links found:
${hrefs.join('\n')}

For each UPCOMING or CURRENT auction with lots to view, provide:
- url: Full URL (resolve relative URLs against ${rootUrl})
- title: Auction title/date
- date: YYYY-MM-DD if determinable, null otherwise
- catalogueReady: true if lots appear listed

Return ONLY: {"catalogues": [{"url":"...","title":"...","date":"...","catalogueReady":true}]}
No catalogues? Return {"catalogues": []}`, { tier: 'capable', maxTokens: 1500, taskType: 'discovery' });

  try {
    let text = aiText.trim();
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(text).catalogues || [];
  } catch { return null; }
}

// ── Upsert discovered catalogues into calendar ──
const LOT_URL_PATTERNS = [
  /\/lot\/details?\//i, /\/lot\/\d+(?:[/#?]|$)/i,
  /\/property\/details?\//i, /\/properties\/\d+(?:[/#?]|$)/i,
  /\/properties\/lot\//i, /lot[_-]?id=/i, /property[_-]?id=/i,
];

async function _upsertCatalogues(slug, catalogues, deps = {}) {
  let found = 0;

  for (const cat of catalogues) {
    if (!cat.url) continue;
    if (LOT_URL_PATTERNS.some(p => p.test(cat.url))) {
      console.log(`AUTO-DISCOVER: Skipping lot-level URL: ${cat.url}`);
      continue;
    }

    // Product-integrity guard (shared with the self-healer): only insert a
    // candidate that is a real, live catalogue advertising lots — never a
    // news/blog/guide page, a bare homepage, or a single lot page. This closes
    // the same hole #196 documented for the healer but for the discovery path.
    const candHtml = await _fetchRootPage(cat.url, slug, deps).catch(() => '');
    const verdict = healCandidateVerdict(cat.url, candHtml || '', slug);
    if (!verdict.ok) {
      console.log(`AUTO-DISCOVER: Skipping non-catalogue candidate for ${slug} — ${verdict.reason} (${cat.url})`);
      continue;
    }

    // Check if this URL is already in the calendar
    const { data: existingUrl } = await supabase
      .from('auction_calendar')
      .select('id')
      .eq('url', cat.url)
      .maybeSingle();
    if (existingUrl) continue;

    // Check if this house+date combo already has an entry
    if (cat.date) {
      const { data: existingDate } = await supabase
        .from('auction_calendar')
        .select('id')
        .eq('house_slug', slug)
        .eq('date', cat.date)
        .limit(1);
      if (existingDate && existingDate.length > 0) continue;
    }

    // Insert new calendar entry
    const { error } = await supabase.from('auction_calendar').insert({
      house: HOUSE_DISPLAY_NAMES[slug] || slug,
      house_slug: slug,
      logo: '🔨',
      date: cat.date || new Date().toISOString().split('T')[0],
      title: cat.title || 'Upcoming',
      url: cat.url,
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'upcoming',
      catalogue_ready: cat.catalogueReady || false,
      updated_at: new Date().toISOString(),
    });

    if (!error) {
      found++;
      console.log(`AUTO-DISCOVER: ✓ New catalogue found — ${HOUSE_DISPLAY_NAMES[slug]}: ${cat.title} (${cat.url})`);
    }
  }

  return found;
}

// ── Pipeline alerting: discovery failures and consecutive misses ──
async function _recordAlerts(totalHouses, discovered, errors) {
  if (errors > 0) {
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'discovery_miss',
        severity: 'warning',
        house: null,
        message: `Calendar discovery had ${errors} errors out of ${totalHouses} houses`
      });
    } catch (alertErr) { console.warn('ALERT: Failed to record discovery errors:', alertErr.message); }
  }

  if (discovered === 0) {
    _consecutiveMisses++;
    if (_consecutiveMisses >= 3) {
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'discovery_miss',
          severity: 'warning',
          house: null,
          message: `${_consecutiveMisses} consecutive discovery runs found 0 new catalogues`
        });
      } catch (alertErr) { console.warn('ALERT: Failed to record consecutive miss:', alertErr.message); }
    }
  } else {
    _consecutiveMisses = 0;
  }
}
