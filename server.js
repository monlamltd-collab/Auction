import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ═══════════════════════════════════════════════════════════════
// SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const RATE_LIMIT = 5;
const CACHE_DAYS = 7;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
const MAX_PAGES = 40;
const TIMEOUT = 25000;

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

// ═══════════════════════════════════════════════════════════════
// STATIC FILES
// ═══════════════════════════════════════════════════════════════
app.use('/public', express.static(join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// API: USER SIGNUP
// ═══════════════════════════════════════════════════════════════
app.post('/api/signup', async (req, res) => {
  const { email, name } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', existing.id);
      return res.json({ user: existing, returning: true });
    }

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ email: email.toLowerCase().trim(), name: name || null })
      .select('id, email, name')
      .single();

    if (error) throw error;
    return res.json({ user: newUser, returning: false });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: AUCTION CALENDAR
// ═══════════════════════════════════════════════════════════════
app.get('/api/auctions', (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  const auctions = [
    // ── SAVILLS ──
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-02-24', dateEnd: '2026-02-25',
      title: '24 & 25 February 2026', lots: 322,
      url: 'https://auctions.savills.co.uk/auctions/24--25-february-2026-218',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-03-17', title: '17 March 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-03-31', title: '31 March 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-04-21', title: '21 April 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-05-06', title: '6 May 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── ALLSOP ──
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-02-25', dateEnd: '2026-02-26',
      title: '25 & 26 February 2026 — Residential', lots: 325,
      url: 'https://www.allsop.co.uk/residential-auction-view',
      location: 'Online (Live Stream)', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-24', title: '24 March 2026 — Commercial', lots: null,
      url: 'https://www.allsop.co.uk/commercial-auction-view',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-25', dateEnd: '2026-03-26',
      title: '25 & 26 March 2026 — Residential', lots: null,
      url: 'https://www.allsop.co.uk/residential-auction-view',
      location: 'Online (Live Stream)', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    // ── NETWORK AUCTIONS ──
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-05-07', title: '7 May 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-06-18', title: '18 June 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    // ── SDL AUCTIONS ──
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-02-26', title: '26 February 2026 — National', lots: null,
      url: 'https://www.sdlauctions.co.uk/property-auctions/upcoming-auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── BOND WOLFE ──
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-05-14', title: '14 May 2026', lots: null,
      url: 'https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
  ];

  const now = new Date().toISOString().slice(0, 10);
  const upcoming = auctions
    .filter(a => a.date >= now || a.status === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({ updated: new Date().toISOString(), count: upcoming.length, auctions: upcoming });
});

// ═══════════════════════════════════════════════════════════════
// API: ANALYSE CATALOGUE
// ═══════════════════════════════════════════════════════════════
app.post('/api/analyse', async (req, res) => {
  const { url, budget, email } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  // ── Check user is signed up ──
  if (!email) return res.status(401).json({ error: 'signup_required', message: 'Please sign up to use the analyser' });

  const { data: user } = await supabase
    .from('users')
    .select('id, analyses_count')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (!user) return res.status(401).json({ error: 'signup_required', message: 'Please sign up first' });

  // ── Rate limiting ──
  const ip = getClientIP(req);
  const today = new Date().toISOString().slice(0, 10);

  const { data: rateRow } = await supabase
    .from('rate_limits')
    .select('requests')
    .eq('ip', ip)
    .eq('date', today)
    .single();

  if (rateRow && rateRow.requests >= RATE_LIMIT) {
    return res.status(429).json({
      error: 'rate_limited',
      message: `Daily limit reached (${RATE_LIMIT} analyses per day). Try again tomorrow.`
    });
  }

  // ── Check cache ──
  const normalisedUrl = url.trim().replace(/\/+$/, '').toLowerCase();
  const { data: cached } = await supabase
    .from('cached_analyses')
    .select('*')
    .eq('url', normalisedUrl)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    console.log(`Cache hit for ${normalisedUrl}`);
    return res.json({
      house: cached.house,
      totalLots: cached.total_lots,
      titleSplits: cached.title_splits,
      topPicks: cached.top_picks,
      lots: cached.lots,
      cached: true,
    });
  }

  // ── Increment rate counter (only for fresh analyses, not cached) ──
  if (rateRow) {
    await supabase.from('rate_limits').update({ requests: rateRow.requests + 1 }).eq('ip', ip).eq('date', today);
  } else {
    await supabase.from('rate_limits').insert({ ip, date: today, requests: 1 });
  }

  // ── Fresh analysis ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const house = detectAuctionHouse(url);
    const rewritten = rewriteUrl(url, house);
    const scrapeUrl = rewritten.baseUrl;
    
    console.log(`House: ${house}, URL: ${scrapeUrl}, isApi: ${rewritten.isApi}`);

    // Validate URL first (use original URL for validation, rewritten for scraping)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const testResp = await fetch(url, { headers: HEADERS, signal: controller.signal });
      clearTimeout(timeout);
      if (!testResp.ok) {
        return res.status(400).json({
          error: 'url_error',
          message: `That URL returned an error (${testResp.status}). It may not be a catalogue page, or the catalogue hasn't been published yet.`
        });
      }
    } catch (e) {
      return res.status(400).json({ error: 'url_unreachable', message: "Couldn't reach that URL. Check it's a valid catalogue page." });
    }

    let pages;
    if (rewritten.paginateAs === 'allsop_api') {
      // Allsop API: paginate through JSON endpoint
      pages = await scrapeAllsopApi(rewritten.baseUrl);
    } else {
      pages = await scrapeAllPages(scrapeUrl, house);
    }
    
    if (pages.length === 0) {
      return res.status(400).json({ error: 'no_content', message: "Couldn't find any content on that page." });
    }

    const client = new Anthropic({ apiKey });
    let rawLots = await extractLotsWithClaude(client, pages, house);

    // ── Puppeteer fallback for JS-rendered sites (skip if we used API) ──
    if (rawLots.length === 0 && !rewritten.isApi) {
      console.log(`No lots from static HTML, trying Puppeteer for ${house}...`);
      const puppeteerPages = await scrapeWithPuppeteer(url, house);
      if (puppeteerPages.length > 0) {
        console.log(`Puppeteer got ${puppeteerPages.length} page(s), sending to Claude...`);
        rawLots = await extractLotsWithClaude(client, puppeteerPages, house);
        console.log(`Claude extracted ${rawLots.length} lots from Puppeteer content`);
      }
    }

    if (rawLots.length === 0) {
      return res.status(400).json({ error: 'no_lots', message: "Couldn't find any auction lots. Make sure you're linking to the catalogue page, not the auction house homepage." });
    }

    const analysed = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);

    // ── Cache results ──
    const expiresAt = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('cached_analyses').upsert({
      url: normalisedUrl,
      house,
      total_lots: analysed.length,
      title_splits: analysed.filter(l => l.titleSplit).length,
      top_picks: analysed.filter(l => l.score >= 3).length,
      lots: analysed,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    }, { onConflict: 'url' });

    // ── Update user count ──
    await supabase.from('users')
      .update({ analyses_count: (user.analyses_count || 0) + 1 })
      .eq('id', user.id);

    return res.json({
      house,
      totalLots: analysed.length,
      titleSplits: analysed.filter(l => l.titleSplit).length,
      topPicks: analysed.filter(l => l.score >= 3).length,
      lots: analysed,
      cached: false,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL
// ═══════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// ═══════════════════════════════════════════════════════════════
// AUCTION HOUSE DETECTION
// ═══════════════════════════════════════════════════════════════
function detectAuctionHouse(url) {
  const u = url.toLowerCase();
  if (u.includes('savills')) return 'savills';
  if (u.includes('allsop')) return 'allsop';
  if (u.includes('sdlauctions') || u.includes('sdl')) return 'sdl';
  if (u.includes('networkauctions')) return 'network';
  if (u.includes('auctionhouse')) return 'auctionhouse';
  if (u.includes('barnardmarcus') || u.includes('countrywide')) return 'barnardmarcus';
  if (u.includes('cliveemson')) return 'cliveemson';
  if (u.includes('strettons')) return 'strettons';
  if (u.includes('pughauctions') || u.includes('pugh')) return 'pugh';
  return 'unknown';
}

// ═══════════════════════════════════════════════════════════════
// URL REWRITING (map user-friendly URLs to data endpoints)
// ═══════════════════════════════════════════════════════════════
function rewriteUrl(url, house) {
  const u = url.toLowerCase();

  if (house === 'allsop') {
    // Allsop: rewrite catalogue pages to their JSON API
    if (u.includes('residential-auction') || u.includes('lot_type=residential')) {
      return { 
        baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=residential&page=1&react',
        isApi: true,
        paginateAs: 'allsop_api'
      };
    }
    if (u.includes('commercial-auction') || u.includes('lot_type=commercial')) {
      return {
        baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=commercial&page=1&react',
        isApi: true,
        paginateAs: 'allsop_api'
      };
    }
    // If it's the property-search API URL already, use it directly
    if (u.includes('/api/property-search')) {
      return { baseUrl: url, isApi: true, paginateAs: 'allsop_api' };
    }
  }

  // No rewrite needed
  return { baseUrl: url, isApi: false, paginateAs: null };
}

// ═══════════════════════════════════════════════════════════════
// SCRAPING
// ═══════════════════════════════════════════════════════════════
async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapeAllPages(baseUrl, house) {
  const pages = [];
  const html1 = await fetchPage(baseUrl);
  pages.push({ page: 1, html: html1 });
  const totalPages = detectTotalPages(html1, baseUrl, house);
  for (let pg = 2; pg <= Math.min(totalPages, MAX_PAGES); pg++) {
    const pageUrl = buildPageUrl(baseUrl, pg, house);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length > 1000) { pages.push({ page: pg, html }); }
      else { break; }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { break; }
  }
  return pages;
}

// Allsop JSON API pagination
async function scrapeAllsopApi(baseUrl) {
  const pages = [];
  for (let pg = 1; pg <= MAX_PAGES; pg++) {
    const pageUrl = baseUrl.replace(/page=\d+/, `page=${pg}`);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length < 100 || html.includes('"data":[]') || html.includes('"template":"404"')) {
        console.log(`Allsop API: page ${pg} empty, stopping`);
        break;
      }
      pages.push({ page: pg, html });
      console.log(`Allsop API: got ${html.length} chars from page ${pg}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`Allsop API: page ${pg} failed: ${e.message}`);
      break;
    }
  }
  return pages;
}

function detectTotalPages(html, url, house) {
  const pageMatches = [...html.matchAll(/page[=-](\d+)/gi)];
  if (pageMatches.length > 0) return Math.max(...pageMatches.map(m => parseInt(m[1])));
  const ofMatch = html.match(/page\s+\d+\s+of\s+(\d+)/i);
  if (ofMatch) return parseInt(ofMatch[1]);
  const numMatches = [...html.matchAll(/<a[^>]*>\s*(\d{1,3})\s*<\/a>/g)];
  const nums = numMatches.map(m => parseInt(m[1])).filter(n => n >= 2 && n <= 100);
  if (nums.length) return Math.max(...nums);
  return 1;
}

function buildPageUrl(baseUrl, page, house) {
  const clean = baseUrl.replace(/\/page[-=]\d+/i, '').replace(/[?&]page=\d+/i, '');
  switch (house) {
    case 'savills': return `${clean}/page-${page}`;
    case 'allsop': return `${clean}?page=${page}`;
    case 'sdl': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'network': return `${clean}?page=${page}`;
    default:
      if (baseUrl.includes('/page-')) return `${clean}/page-${page}`;
      return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUPPETEER SCRAPING (for JS-rendered sites)
// ═══════════════════════════════════════════════════════════════
let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  browserInstance = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
    ],
  });
  return browserInstance;
}

async function scrapeWithPuppeteer(url, house) {
  const pages = [];
  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });

    // Block images/fonts/media to speed up loading
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) req.abort();
      else req.continue();
    });

    console.log(`Puppeteer: loading ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Wait a bit more for dynamic content to render
    await new Promise(r => setTimeout(r, 3000));

    // Scroll down to trigger lazy loading
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });

    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    pages.push({ page: 1, html });
    console.log(`Puppeteer: got ${html.length} chars from page 1`);

    // Check for pagination and scrape more pages
    const totalPages = detectTotalPages(html, url, house);
    for (let pg = 2; pg <= Math.min(totalPages, MAX_PAGES); pg++) {
      try {
        const pageUrl = buildPageUrl(url, pg, house);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // Scroll to trigger lazy loading
        await page.evaluate(async () => {
          for (let i = 0; i < 3; i++) {
            window.scrollBy(0, window.innerHeight);
            await new Promise(r => setTimeout(r, 600));
          }
        });
        await new Promise(r => setTimeout(r, 1500));

        const pgHtml = await page.content();
        if (pgHtml.length > 2000) {
          pages.push({ page: pg, html: pgHtml });
          console.log(`Puppeteer: got ${pgHtml.length} chars from page ${pg}`);
        } else { break; }
      } catch (e) {
        console.log(`Puppeteer: page ${pg} failed: ${e.message}`);
        break;
      }
    }

    await page.close();
  } catch (err) {
    console.error(`Puppeteer scrape failed: ${err.message}`);
  }
  return pages;
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE EXTRACTION
// ═══════════════════════════════════════════════════════════════
async function extractLotsWithClaude(client, pages, house) {
  const allLots = [];
  const seenLots = new Set();
  const batchSize = 3;
  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);
    const strippedBatch = batch.map(p => ({ page: p.page, content: stripHtml(p.html) }));
    const prompt = `You are extracting property auction lot data from a UK auction house catalogue (${house}).

Below are ${strippedBatch.length} page(s) of catalogue content. Extract EVERY auction lot you find.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (detail page URL if found, empty string if not)
- bullets: array of strings (key features/description points - tenure, bedrooms, condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text. If a page has no lots, return an empty array.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Bullet points include things like: property type, bedrooms, tenure (freehold/leasehold), condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land

${strippedBatch.map(p => `=== PAGE ${p.page} ===\n${p.content}`).join('\n\n')}

Return ONLY the JSON array:`;
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content.map(c => c.text || '').join('');
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const lots = JSON.parse(jsonMatch[0]);
        for (const lot of lots) {
          if (lot.lot && !seenLots.has(lot.lot)) {
            seenLots.add(lot.lot);
            allLots.push({
              lot: lot.lot, address: lot.address || '',
              price: lot.price || null,
              priceText: lot.price ? `£${lot.price.toLocaleString()}` : 'TBA',
              url: lot.url || '', bullets: lot.bullets || [],
            });
          }
        }
      }
    } catch (err) {
      console.error(`Claude extraction failed for batch starting at page ${batch[0].page}:`, err.message);
    }
  }
  return allLots;
}

function stripHtml(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > 60000) text = text.substring(0, 60000);
  return text;
}

// ═══════════════════════════════════════════════════════════════
// ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════
const W2N = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };

function analyseLot(raw) {
  const t = (raw.bullets.join(' ') + ' ' + raw.address).toLowerCase();
  const L = { ...raw, score: 0, opps: [], risks: [], dealType: 'Standard', propType: '', beds: null,
    tenure: '', condition: '', vacant: true, sqft: null, titleSplit: false, units: 0 };

  if (/flat|apartment|maisonette/.test(t)) L.propType = 'flat';
  else if (/bungalow/.test(t)) L.propType = 'bungalow';
  else if (/semi[- ]?detached|terraced?|terrace house|detached house|town\s?house|end of terrace|mid[- ]terrace/.test(t)) L.propType = 'house';
  else if (/\bhouse\b/.test(t)) L.propType = 'house';
  else if (/shop|office|commercial|retail|industrial|warehouse|investment|ground rent/.test(t)) L.propType = 'commercial';
  else if (/\bland\b|plot|site|church|hall|chapel/.test(t)) L.propType = 'land';
  else if (/garage|parking|lock.?up/.test(t)) L.propType = 'garage';
  else L.propType = 'other';

  const bm = t.match(/(\w+)\s*[-\s]?bed/);
  if (bm) { const v = bm[1].toLowerCase(); L.beds = W2N[v] || (v.match(/^\d+$/) ? +v : null); }
  if (/studio/.test(t) && L.beds === null) L.beds = 0;

  if (/share of freehold/.test(t)) L.tenure = 'Share of Freehold';
  else if (/freehold/.test(t) && !/leasehold/.test(t)) L.tenure = 'Freehold';
  else if (/leasehold/.test(t)) L.tenure = 'Leasehold';

  if (/modernis|refurbishment|renovation|updating|in need of/.test(t)) L.condition = 'needs work';
  else if (/good order|good decorative|well maintained|recently refurbished/.test(t)) L.condition = 'good';
  else if (/derelict|dilapidated|fire damage/.test(t)) L.condition = 'poor';

  if (/vacant/.test(t)) L.vacant = true;
  else if (/tenant|let to|tenanted|occupied|sitting tenant/.test(t)) L.vacant = false;

  const executor = /executor|probate|estate of|personal representative/.test(t);
  const receivership = /receiver|receivership|administrator|liquidator|lpa receiver/.test(t);
  const devP = /development potential|development opportunity|planning permission|pp granted|change of use|conversion potential|redevelopment|building plot/.test(t);
  const extP = /extension potential|scope to extend|subject to requi[st]i?te? consents|loft conversion|\bhmo\b|potential to extend/.test(t);

  const sm = t.match(/([\d,]+)\s*sq\s*(?:ft|feet)/);
  if (sm) L.sqft = parseInt(sm[1].replace(/,/g, ''));

  let uc = 0;
  const um = t.match(/(\d+)\s*(?:x\s*)?(?:self[- ]contained\s+)?(?:flat|apartment|unit)/); if (um) uc = Math.max(uc, +um[1]);
  const bk = t.match(/block\s+of\s+(\d+)/); if (bk) uc = Math.max(uc, +bk[1]);
  const mx = [...t.matchAll(/(\d+)\s*x\s*(?:one|two|three|1|2|3)\s*[-\s]?bed/g)];
  if (mx.length) uc = Math.max(uc, mx.reduce((s, m) => s + +m[1], 0));
  const fr = raw.address.toLowerCase().match(/flats?\s*([a-z])\s*[-–&]\s*([a-z])/);
  if (fr) uc = Math.max(uc, fr[2].charCodeAt(0) - fr[1].charCodeAt(0) + 1);
  const ar = raw.address.match(/^(\d+)\s*[-–]\s*(\d+)\s/);
  if (ar) { const d = +ar[2] - +ar[1] + 1; if (d >= 2 && d <= 20) uc = Math.max(uc, d); }
  if (/gff|fff|sff|tff/.test(raw.address.toLowerCase())) uc = Math.max(uc, 2);
  const apt = t.match(/(\d+)\s*(?:self[- ]contained\s+)?apartments/); if (apt) uc = Math.max(uc, +apt[1]);
  const isFH = /freehold/.test(t), hasFlats = /flats|apartments|self[- ]contained|arranged as/.test(t);
  const indivSales = /individual flat sales|individual sales/.test(t);
  if (uc >= 2 || ((isFH && hasFlats) || indivSales)) { L.titleSplit = true; L.units = uc || 2; }

  let s = 0;
  if (L.condition === 'needs work') { s += 2; L.opps.push('Needs modernisation'); }
  if (L.condition === 'poor') { s += 2.5; L.opps.push('Poor condition'); }
  if (executor) { s += 1.5; L.opps.push('Executor/probate'); }
  if (receivership) { s += 2; L.opps.push('Receivership'); }
  if (devP) { s += 2; L.opps.push('Development potential'); }
  if (extP) { s += 1.5; L.opps.push('Extension/HMO potential'); }
  if (L.vacant && ['house', 'bungalow', 'flat', 'land'].includes(L.propType)) { s += 1; L.opps.push('Vacant'); }
  if (L.tenure === 'Freehold' && ['house', 'bungalow'].includes(L.propType)) { s += 0.5; L.opps.push('Freehold'); }
  if (L.sqft && L.price) {
    const p = L.price / L.sqft;
    if (p < 200) { s += 2; L.opps.push(`£${Math.round(p)}/sqft`); }
    else if (p < 300) { s += 1; L.opps.push(`£${Math.round(p)}/sqft`); }
  }

  const rm = t.match(/(?:let\s+at|rent\s+of|income\s+of|producing)\s+£?([\d,]+)\s*(?:p\.?a|per\s*annum)/);
  if (rm && L.price) {
    const rent = parseInt(rm[1].replace(/,/g, '')); const gy = (rent / L.price) * 100;
    if (gy > 8) { s += 2.5; L.opps.push(`${gy.toFixed(1)}% GIY`); }
    else if (gy > 6) { s += 1.5; L.opps.push(`${gy.toFixed(1)}% GIY`); }
  }

  if (/(?:4|5|6)\s*week\s*completion|six week/.test(t)) { s += 0.5; L.opps.push('Quick completion'); }
  if (/by order of/.test(t) && !executor && !receivership) { s += 0.5; L.opps.push('Motivated seller'); }
  if (L.titleSplit) { s += 1; L.opps.push(`Title split (${L.units} units)`); }

  if (/sitting tenant/.test(t)) { s -= 2; L.risks.push('Sitting tenant'); }
  if (/knotweed/.test(t)) { s -= 2; L.risks.push('Knotweed'); }
  if (/flying freehold/.test(t)) { s -= 1; L.risks.push('Flying freehold'); }
  if (/non[- ]?standard|timber frame|prefab|prc/.test(t)) { s -= 1; L.risks.push('Non-std construction'); }
  if (/flood risk|flood zone/.test(t)) { s -= 1; L.risks.push('Flood risk'); }
  if (/asbestos|contamination/.test(t)) { s -= 1; L.risks.push('Contamination'); }
  if (/grade ii|listed/.test(t)) L.risks.push('Listed building');
  if (!L.price) L.risks.push('Guide TBA');

  if (devP) L.dealType = 'Development';
  else if ((L.condition === 'needs work' || L.condition === 'poor') && extP) L.dealType = 'Refurb+Extend';
  else if (L.condition === 'needs work' || L.condition === 'poor') L.dealType = 'Refurb';
  else if (L.titleSplit) L.dealType = 'Title Split';
  else if (executor || receivership) L.dealType = 'Motivated';
  else L.dealType = 'Standard';

  L.score = Math.round(s * 10) / 10;
  return L;
}

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`Bridgematch running on port ${PORT}`);
  if (!process.env.SUPABASE_URL) console.warn('⚠️  SUPABASE_URL not set');
  if (!process.env.SUPABASE_SERVICE_KEY) console.warn('⚠️  SUPABASE_SERVICE_KEY not set');
  if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY not set');
});
