import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { rateLimit, requireAdmin } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../lib/houses.js';
import { HEADERS } from '../lib/config.js';
import { normaliseUrl } from '../lib/utils.js';
import { safeFetch } from '../lib/security.js';
import { FALLBACK_CALENDAR, getAuctionCalendar } from '../lib/calendar.js';
import { callAI } from '../lib/ai-provider.js';
import { healBrokenHouse, getHealingState, clearHealingCooldown } from '../lib/analysis.js';
import { resetAdaptiveBackoff } from '../lib/pipeline/scheduling.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// API: AUCTION CALENDAR
// ═══════════════════════════════════════════════════════════════

// Hardcoded fallback calendar — used when Supabase auction_calendar table is empty
// FALLBACK_CALENDAR, getAuctionCalendar, getCalendarAuctions moved to lib/calendar.js
router.get('/api/auctions', async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  try {
    const auctions = await getAuctionCalendar();
    res.json({ updated: new Date().toISOString(), count: auctions.length, auctions });
  } catch (e) {
    log.error('Calendar endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to load auction calendar' });
  }
});

// Admin: seed the Supabase calendar from hardcoded data
router.post('/api/admin/seed-calendar', rateLimit(60000, 20), requireAdmin, async (req, res) => {
  try {
    const rows = FALLBACK_CALENDAR.map(a => ({
      house: a.house, house_slug: a.houseSlug, logo: a.logo,
      date: a.date, date_end: a.dateEnd || null, title: a.title,
      lots: a.lots || null, url: a.url, location: a.location,
      type: a.type, status: a.status, catalogue_ready: a.catalogueReady,
    }));
    const { data, error } = await supabase.from('auction_calendar').upsert(rows, { onConflict: 'url,date' });
    if (error) throw error;
    res.json({ message: `Seeded ${rows.length} auction entries`, count: rows.length });
  } catch (e) {
    log.error('Calendar seed error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: add/update a single auction
router.post('/api/admin/calendar', requireAdmin, async (req, res) => {
  const { auction } = req.body || {};
  if (!auction || !auction.house || !auction.date || !auction.url) {
    return res.status(400).json({ error: 'Missing required fields: house, date, url' });
  }
  try {
    const row = {
      house: auction.house,
      house_slug: auction.houseSlug || auction.house.toLowerCase().replace(/[^a-z0-9]/g, ''),
      logo: auction.logo || '🔨',
      date: auction.date,
      date_end: auction.dateEnd || null,
      title: auction.title || auction.date,
      lots: auction.lots || null,
      url: auction.url,
      location: auction.location || 'Online',
      type: auction.type || 'Residential & Commercial',
      status: auction.status || 'upcoming',
      catalogue_ready: auction.catalogueReady !== undefined ? auction.catalogueReady : false,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('auction_calendar').upsert(row, { onConflict: 'url,date' });
    if (error) throw error;
    res.json({ message: 'Auction saved', auction: row });
  } catch (e) {
    log.error('Calendar save error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: deduplicate the calendar — remove duplicate rows keeping the best one per house+date+url
router.post('/api/admin/dedup-calendar', rateLimit(60000, 20), requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('auction_calendar').select('id, house, date, url, catalogue_ready');
    if (error) throw error;

    const groups = new Map();
    for (const row of (data || [])) {
      const key = `${(row.house || '').toLowerCase()}|${row.date}|${normaliseUrl(row.url)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const toDelete = [];
    for (const [, rows] of groups) {
      if (rows.length <= 1) continue;
      // Keep the one with catalogue_ready=true, or the first one
      rows.sort((a, b) => (b.catalogue_ready ? 1 : 0) - (a.catalogue_ready ? 1 : 0));
      for (let i = 1; i < rows.length; i++) toDelete.push(rows[i].id);
    }

    if (toDelete.length > 0) {
      for (const id of toDelete) {
        await supabase.from('auction_calendar').delete().eq('id', id);
      }
    }

    res.json({ message: `Removed ${toDelete.length} duplicate calendar entries`, removed: toDelete.length });
  } catch (e) {
    log.error('Calendar dedup error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: trigger self-healing for a specific house or view healing status
router.post('/api/admin/heal', rateLimit(60000, 20), requireAdmin, async (req, res) => {
  const { slug } = req.body || {};
  if (!slug) {
    // Return healing status for all houses
    const healingState = getHealingState();
    const status = {};
    for (const [s, state] of healingState) {
      status[s] = {
        lastAttempt: state.lastAttempt ? new Date(state.lastAttempt).toISOString() : null,
        attempts: state.attempts,
        onCooldown: state.cooldownUntil ? Date.now() < state.cooldownUntil : false,
        cooldownUntil: state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : null,
      };
    }
    return res.json({ healingState: status, totalTracked: healingState.size });
  }

  const rootUrl = HOUSE_ROOTS[slug];
  if (!rootUrl) return res.status(404).json({ error: `Unknown house slug: ${slug}` });

  // Clear cooldown to allow immediate retry
  clearHealingCooldown(slug);
  // A heal implies we don't trust the prior adaptive cadence — wipe
  // next_scrape_at and consecutive_same_count so the post-heal scrape
  // starts from a clean baseline (6h cadence, count=0).
  try { await resetAdaptiveBackoff(supabase, slug); } catch (e) { log.warn('Heal: resetAdaptiveBackoff failed (non-fatal)', { slug, error: e.message }); }

  try {
    const healedUrl = await healBrokenHouse(slug, rootUrl);
    if (healedUrl) {
      res.json({ healed: true, slug, oldUrl: rootUrl, newUrl: healedUrl });
    } else {
      res.json({ healed: false, slug, message: 'Healing did not find a new URL' });
    }
  } catch (e) {
    log.error('Admin heal error', { slug, error: e.message });
    res.status(500).json({ error: 'Healing failed', detail: e.message });
  }
});

// Admin: delete an auction by ID
router.delete('/api/admin/calendar/:id', rateLimit(60000, 20), requireAdmin, async (req, res) => {
  // allowed by RFC 7231 but proxies sometimes strip it; the header path is
  // also consistent with every other admin endpoint.
  try {
    const { error } = await supabase.from('auction_calendar').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Auction deleted' });
  } catch (e) {
    log.error('Calendar delete error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: DISCOVER CATALOGUES — find upcoming auction URLs from root pages
// ═══════════════════════════════════════════════════════════════
// Scrapes a house's root/listing page and uses Claude to extract catalogue links.
// This handles URL format changes (date slugs, query params, auction IDs) automatically.
router.post('/api/admin/discover-catalogues', requireAdmin, async (req, res) => {
  const { houses } = req.body || {};
  const targetHouses = houses || Object.keys(HOUSE_ROOTS);
  const results = [];

  for (const slug of targetHouses) {
    const rootUrl = HOUSE_ROOTS[slug];
    if (!rootUrl) { results.push({ house: slug, error: 'No root URL configured' }); continue; }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      // safeFetch validates the host + every redirect hop. rootUrl is normally
      // from the HOUSE_ROOTS registry, but self-healing can rewrite it from a
      // web-search result, so treat it as untrusted here (SSRF defence-in-depth).
      const resp = await safeFetch(rootUrl, { headers: HEADERS, signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) { results.push({ house: slug, error: `HTTP ${resp.status}` }); continue; }
      const html = await resp.text();

      // Strip HTML to reduce token usage, keep links and text
      const stripped = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 8000);

      // Also extract all hrefs for Claude to reference
      const hrefMatches = [...html.matchAll(/href="([^"]*(?:auction|lot|catalogue|sale|property)[^"]*)"/gi)];
      const hrefs = [...new Set(hrefMatches.map(m => m[1]))].slice(0, 50);

      const aiText = await callAI(`You are analysing an auction house's listing page to find links to upcoming/current auction catalogues.

House: ${HOUSE_DISPLAY_NAMES[slug] || slug}
Root URL: ${rootUrl}

Page text (truncated):
${stripped}

Links found on page:
${hrefs.join('\n')}

Extract ALL auction catalogue links you can find. For each, provide:
- url: The full URL (resolve relative URLs against ${rootUrl})
- title: The auction title/date as shown on page
- date: The auction date in YYYY-MM-DD format if you can determine it (null if unclear)
- catalogueReady: true if the catalogue appears to have lots listed, false if "coming soon"

Return ONLY valid JSON: {"catalogues": [{"url": "...", "title": "...", "date": "...", "catalogueReady": true}]}
If no catalogues found, return {"catalogues": []}`, { tier: 'capable', maxTokens: 2000, taskType: 'discovery' });

      let catalogues = [];
      try {
        let text = aiText.trim();
        if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        catalogues = JSON.parse(text).catalogues || [];
      } catch (e) {
        results.push({ house: slug, error: 'AI returned invalid JSON', raw: aiText.substring(0, 200) });
        continue;
      }

      results.push({
        house: slug,
        displayName: HOUSE_DISPLAY_NAMES[slug] || slug,
        rootUrl,
        catalogues,
      });
    } catch (e) {
      results.push({ house: slug, error: e.message });
    }
  }

  res.json({ discovered: results.length, results });
});

export default router;
