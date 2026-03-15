import Anthropic from '@anthropic-ai/sdk';

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
- bullets: array of strings (key features/description points - bedrooms, condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text. If a page has no lots, return an empty array.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Tenure is a PRIORITY field — always look for it in the description, legal pack summary, and property details
- Bullet points include things like: property type, bedrooms, condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
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
const W2N = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };

function analyseLot(raw) {
  const t = (raw.bullets.join(' ') + ' ' + raw.address).toLowerCase();
  const L = { ...raw, score: 0, opps: [], risks: [], dealType: 'Standard', propType: '', beds: null,
    tenure: '', condition: '', vacant: true, sqft: null, titleSplit: false, units: 0 };

  // Property type
  if (/flat|apartment|maisonette/.test(t)) L.propType = 'flat';
  else if (/bungalow/.test(t)) L.propType = 'bungalow';
  else if (/semi[- ]?detached|terraced?|terrace house|detached house|town\s?house|end of terrace|mid[- ]terrace/.test(t)) L.propType = 'house';
  else if (/\bhouse\b/.test(t)) L.propType = 'house';
  else if (/shop|office|commercial|retail|industrial|warehouse|investment|ground rent/.test(t)) L.propType = 'commercial';
  else if (/\bland\b|plot|site|church|hall|chapel/.test(t)) L.propType = 'land';
  else if (/garage|parking|lock.?up/.test(t)) L.propType = 'garage';
  else L.propType = 'other';

  // Bedrooms
  const bm = t.match(/(\w+)\s*[-\s]?bed/);
  if (bm) { const v = bm[1].toLowerCase(); L.beds = W2N[v] || (v.match(/^\d+$/) ? +v : null); }
  if (/studio/.test(t) && L.beds === null) L.beds = 0;

  // Tenure — prefer structured field from Gemini, then fall back to regex
  const rawTenure = (raw.tenure || '').trim().toLowerCase();
  if (/share.?of.?freehold/.test(rawTenure)) L.tenure = 'Share of Freehold';
  else if (/freehold/.test(rawTenure) && !/leasehold/.test(rawTenure)) L.tenure = 'Freehold';
  else if (/leasehold/.test(rawTenure)) L.tenure = 'Leasehold';

  if (!L.tenure) {
    if (/share of freehold|share\s+of\s+the\s+freehold/.test(t)) L.tenure = 'Share of Freehold';
    else if (/flying freehold/.test(t)) L.tenure = 'Freehold';
    else if (/\bfreehold\b/.test(t) && !/leasehold/.test(t)) L.tenure = 'Freehold';
    else if (/long\s+lease(?:hold)?|\bleasehold\b|\blease\s+remaining\b|\byears?\s+(?:remaining|unexpired|left)\b|\b\d+\s*(?:year|yr)\s*lease\b/.test(t)) L.tenure = 'Leasehold';
  }
  if (!L.tenure && L.propType === 'flat' && /\b\d{2,3}\s*(?:year|yr)s?\b/.test(t)) L.tenure = 'Leasehold';

  // Condition
  if (/modernis|refurbishment|renovation|updating|in need of/.test(t)) L.condition = 'needs work';
  else if (/good order|good decorative|well maintained|recently refurbished/.test(t)) L.condition = 'good';
  else if (/derelict|dilapidated|fire damage/.test(t)) L.condition = 'poor';

  // Occupancy
  if (/vacant/.test(t)) L.vacant = true;
  else if (/tenant|let to|tenanted|occupied|sitting tenant/.test(t)) L.vacant = false;

  // Flags
  const executor = /executor|probate|estate of|personal representative/.test(t);
  const receivership = /receiver|receivership|administrator|liquidator|lpa receiver/.test(t);
  const devP = /development potential|development opportunity|planning permission|pp granted|change of use|conversion potential|redevelopment|building plot/.test(t);
  const extP = /extension potential|scope to extend|subject to requi[st]i?te? consents|loft conversion|\bhmo\b|potential to extend/.test(t);

  // Sqft
  const sm = t.match(/([\d,]+)\s*sq\s*(?:ft|feet)/);
  if (sm) L.sqft = parseInt(sm[1].replace(/,/g, ''));

  // Title split detection
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

  // ── SCORING ──
  let s = 0;
  if (L.condition === 'needs work') { s += 2; L.opps.push('Needs modernisation'); }
  if (L.condition === 'poor') { s += 2.5; L.opps.push('Poor condition'); }
  if (executor) { s += 1.5; L.opps.push('Executor/probate'); }
  if (receivership) { s += 2; L.opps.push('Receivership'); }
  if (devP) { s += 2; L.opps.push('Development potential'); }
  if (extP) { s += 1.5; L.opps.push('Extension/HMO potential'); }
  if (L.vacant && ['house', 'bungalow', 'flat', 'land'].includes(L.propType)) { s += 1; L.opps.push('Vacant'); }
  if (L.tenure === 'Freehold' && ['house', 'bungalow'].includes(L.propType)) { s += 0.5; L.opps.push('Freehold'); }
  if (L.sqft && L.price) { const p = L.price / L.sqft; if (p < 200) { s += 2; L.opps.push(`£${Math.round(p)}/sqft`); } else if (p < 300) { s += 1; L.opps.push(`£${Math.round(p)}/sqft`); } }

  // Yield
  const rm = t.match(/(?:let\s+at|rent\s+of|income\s+of|producing)\s+£?([\d,]+)\s*(?:p\.?a|per\s*annum)/);
  if (rm && L.price) { const rent = parseInt(rm[1].replace(/,/g, '')); const gy = (rent / L.price) * 100;
    if (gy > 8) { s += 2.5; L.opps.push(`${gy.toFixed(1)}% GIY`); } else if (gy > 6) { s += 1.5; L.opps.push(`${gy.toFixed(1)}% GIY`); } }

  if (/(?:4|5|6)\s*week\s*completion|six week/.test(t)) { s += 0.5; L.opps.push('Quick completion'); }
  if (/by order of/.test(t) && !executor && !receivership) { s += 0.5; L.opps.push('Motivated seller'); }
  if (L.titleSplit) { s += 1; L.opps.push(`Title split (${L.units} units)`); }

  // Risks
  if (/sitting tenant/.test(t)) { s -= 2; L.risks.push('Sitting tenant'); }
  if (/knotweed/.test(t)) { s -= 2; L.risks.push('Knotweed'); }
  if (/flying freehold/.test(t)) { s -= 1; L.risks.push('Flying freehold'); }
  if (/non[- ]?standard|timber frame|prefab|prc/.test(t)) { s -= 1; L.risks.push('Non-std construction'); }
  if (/flood risk|flood zone/.test(t)) { s -= 1; L.risks.push('Flood risk'); }
  if (/asbestos|contamination/.test(t)) { s -= 1; L.risks.push('Contamination'); }
  if (/grade ii|listed/.test(t)) L.risks.push('Listed building');
  if (!L.price) L.risks.push('Guide TBA');

  // Deal type
  if (devP) L.dealType = 'Development';
  else if ((L.condition === 'needs work' || L.condition === 'poor') && extP) L.dealType = 'Refurb+Extend';
  else if (L.condition === 'needs work' || L.condition === 'poor') L.dealType = 'Refurb';
  else if (L.titleSplit) L.dealType = 'Title Split';
  else if (executor || receivership) L.dealType = 'Motivated';
  else L.dealType = 'Standard';

  L.score = Math.round(s * 10) / 10;
  return L;
}
