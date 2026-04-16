import Anthropic from '@anthropic-ai/sdk';
import { scoreLot } from '../lib/scoring.js';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
const MAX_PAGES = 40;
const TIMEOUT = 25000;

// ═══════════════════════════════════════════════════════════════
// VERCEL SERVERLESS HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url, budget } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    // Step 1: Detect auction house
    const house = detectAuctionHouse(url);

    // Step 2: Scrape all pages
    const pages = await scrapeAllPages(url, house);

    // Step 3: Use Claude to extract lot data from HTML
    const client = new Anthropic({ apiKey });
    const rawLots = await extractLotsWithClaude(client, pages, house);

    // Step 4: Run scoring engine
    const analysed = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);

    // Step 5: Apply budget filter if provided
    let inBudget = analysed;
    if (budget) {
      const { deposit = 150000, stdPct = 25, tsPct = 10 } = budget;
      const stdMax = Math.round(deposit / (stdPct / 100));
      const tsMax = Math.round(deposit / (tsPct / 100));
      inBudget = analysed.filter(l => {
        if (!l.price) return true;
        return l.price <= (l.titleSplit ? tsMax : stdMax);
      });
    }

    return res.status(200).json({
      house,
      totalLots: analysed.length,
      inBudget: inBudget.length,
      titleSplits: analysed.filter(l => l.titleSplit).length,
      topPicks: analysed.filter(l => l.score >= 3).length,
      lots: analysed,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}

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
// SCRAPING — FETCH ALL PAGES
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

  // Fetch first page
  const html1 = await fetchPage(baseUrl);
  pages.push({ page: 1, html: html1 });

  // Detect total pages from first page HTML
  const totalPages = detectTotalPages(html1, baseUrl, house);

  // Fetch remaining pages
  for (let pg = 2; pg <= Math.min(totalPages, MAX_PAGES); pg++) {
    const pageUrl = buildPageUrl(baseUrl, pg, house);
    try {
      const html = await fetchPage(pageUrl);
      // Check if page has content (some sites return empty/redirect for pages beyond the end)
      if (html.length > 1000) {
        pages.push({ page: pg, html });
      } else {
        break;
      }
      // Polite delay
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      // 404 or timeout likely means we've passed the last page
      break;
    }
  }

  return pages;
}

function detectTotalPages(html, url, house) {
  // Look for pagination links
  const pageMatches = [...html.matchAll(/page[=-](\d+)/gi)];
  if (pageMatches.length > 0) {
    return Math.max(...pageMatches.map(m => parseInt(m[1])));
  }
  // Look for "Page X of Y" patterns
  const ofMatch = html.match(/page\s+\d+\s+of\s+(\d+)/i);
  if (ofMatch) return parseInt(ofMatch[1]);
  // Look for numbered pagination links
  const numMatches = [...html.matchAll(/<a[^>]*>\s*(\d{1,3})\s*<\/a>/g)];
  const nums = numMatches.map(m => parseInt(m[1])).filter(n => n >= 2 && n <= 100);
  if (nums.length) return Math.max(...nums);
  return 1;
}

function buildPageUrl(baseUrl, page, house) {
  // Different auction houses use different pagination patterns
  const clean = baseUrl.replace(/\/page[-=]\d+/i, '').replace(/[?&]page=\d+/i, '');
  switch (house) {
    case 'savills':
      return `${clean}/page-${page}`;
    case 'allsop':
      return `${clean}?page=${page}`;
    case 'sdl':
      return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'network':
      return `${clean}?page=${page}`;
    default:
      // Try the /page-N pattern first, fall back to ?page=N
      if (baseUrl.includes('/page-')) return `${clean}/page-${page}`;
      return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE EXTRACTION — UNIVERSAL LOT PARSING
// ═══════════════════════════════════════════════════════════════
async function extractLotsWithClaude(client, pages, house) {
  const allLots = [];
  const seenLots = new Set();

  // Process pages in batches of 3 to manage token costs
  const batchSize = 3;
  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);

    // Strip HTML to just the text-heavy parts to save tokens
    const strippedBatch = batch.map(p => ({
      page: p.page,
      content: stripHtml(p.html),
    }));

    const prompt = `You are extracting property auction lot data from a UK auction house catalogue (${house}).

Below are ${strippedBatch.length} page(s) of catalogue content. Extract EVERY auction lot you find.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (detail page URL if found, empty string if not)
- tenure: string or null — one of "Freehold", "Leasehold", "Share of Freehold", or null. Look for: freehold, leasehold, share of freehold, flying freehold, long leasehold, years remaining/unexpired. If not explicitly stated, infer from context (e.g. "125 year lease" = Leasehold, ground rent mentioned = Leasehold). Only return null if there is genuinely no indication.
- beds: number or null — number of bedrooms. Extract from descriptions like "3 bed", "three bedroom", "studio" (=0). For multi-unit properties, total beds across all units. null if not stated.
- bullets: array of strings (key features/description points - condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text. If a page has no lots, return an empty array.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Tenure is a PRIORITY field — always look for it in the description, legal pack summary, and property details
- Beds is a PRIORITY field — always look for bedroom count in the title, description, or property details. "2/3 bed" should return 3 (maximum). "Studio" = 0.
- Bullet points include things like: property type, condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
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
      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const lots = JSON.parse(jsonMatch[0]);
        for (const lot of lots) {
          if (lot.lot && !seenLots.has(lot.lot)) {
            seenLots.add(lot.lot);
            allLots.push({
              lot: lot.lot,
              address: lot.address || '',
              price: lot.price || null,
              priceText: lot.price ? `£${lot.price.toLocaleString()}` : 'TBA',
              url: lot.url || '',
              bullets: lot.bullets || [],
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
  // Remove scripts, styles, nav elements to save tokens
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

  // Truncate if very long (save API costs)
  if (text.length > 30000) text = text.substring(0, 30000);
  return text;
}

// ═══════════════════════════════════════════════════════════════
// ANALYSIS ENGINE — SCORING + TITLE SPLIT DETECTION
// ═══════════════════════════════════════════════════════════════
const analyseLot = scoreLot;
