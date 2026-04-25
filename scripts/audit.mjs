#!/usr/bin/env node
/**
 * Auction Health Monitor
 * ======================
 * Comprehensive diagnostic for all auction house scrapers.
 * Checks extractors against live sites, compares to production cache,
 * detects broken selectors, site redesigns, and missing configuration.
 *
 * Usage:
 *   node scripts/audit.mjs                          # Full audit, all houses
 *   node scripts/audit.mjs --house venmore,kivells   # Specific houses only
 *   node scripts/audit.mjs --fast                    # HTTP probes only (no Puppeteer)
 *   node scripts/audit.mjs --discover                # Include new house discovery
 *   node scripts/audit.mjs --save                    # Save fingerprints + history
 *   node scripts/audit.mjs --json                    # Output machine-readable JSON
 *   node scripts/audit.mjs --concurrency 3           # Puppeteer page limit (default 5)
 *   node scripts/audit.mjs --validate                # Lot-count validation + image coverage only (fast)
 *   node scripts/audit.mjs --auto-disable            # Auto-disable broken extractors via admin API
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const AUDIT_DIR = join(__dirname, 'audit');
const PROD_API = 'https://auctions.bridgematch.co.uk/api/all-lots';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const param = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : null;
};

const FAST_MODE = flag('fast');
const DISCOVER_MODE = flag('discover');
const SAVE_MODE = flag('save');
const JSON_MODE = flag('json');
const VALIDATE_MODE = flag('validate');
const AUTO_DISABLE = flag('auto-disable');
const CONCURRENCY = parseInt(param('concurrency') || '5', 10);
const HOUSE_FILTER = param('house')?.split(',').map(h => h.trim().toLowerCase()) || null;
const ADMIN_API_BASE = param('api-base') || 'https://auctions.bridgematch.co.uk';

// ═══════════════════════════════════════════════════════════════
// PHASE 1: CONFIG EXTRACTION
// ═══════════════════════════════════════════════════════════════

async function extractConfig() {
  // After the Phase 3 module extraction, these constants live in lib/ rather
  // than being inline in server.js. Import them directly so config drift is
  // impossible — any change in production immediately reflects in the audit.
  const housesPath = 'file://' + join(PROJECT_ROOT, 'lib', 'houses.js').replace(/\\/g, '/');
  const extractorsPath = 'file://' + join(PROJECT_ROOT, 'lib', 'extractors', 'index.js').replace(/\\/g, '/');
  const universalPath = 'file://' + join(PROJECT_ROOT, 'lib', 'extractors', 'universal.js').replace(/\\/g, '/');
  const configPath = 'file://' + join(PROJECT_ROOT, 'lib', 'config.js').replace(/\\/g, '/');

  const housesMod = await import(housesPath);
  const extractorsMod = await import(extractorsPath);
  const universalMod = await import(universalPath);
  const configMod = await import(configPath);

  const HOUSE_ROOTS = housesMod.HOUSE_ROOTS;
  const DOM_EXTRACTORS = extractorsMod.DOM_EXTRACTORS;
  const UNIVERSAL_DOM_EXTRACTOR = universalMod.UNIVERSAL_DOM_EXTRACTOR;
  const CACHE_TIERS = configMod.CACHE_TIERS || null;
  const rewriteUrl = housesMod.rewriteUrl;
  // SKIP_PUPPETEER lives in lib/config.js (a supabase-free module) so the
  // audit never spins up Puppeteer for a house production has decided to skip,
  // without dragging in the runtime Supabase client.
  const SKIP_PUPPETEER = configMod.SKIP_PUPPETEER || [];

  if (!HOUSE_ROOTS) throw new Error('lib/houses.js does not export HOUSE_ROOTS');
  if (!DOM_EXTRACTORS) throw new Error('lib/extractors/index.js does not export DOM_EXTRACTORS');
  if (!UNIVERSAL_DOM_EXTRACTOR) throw new Error('lib/extractors/universal.js does not export UNIVERSAL_DOM_EXTRACTOR');
  if (typeof rewriteUrl !== 'function') throw new Error('lib/houses.js does not export rewriteUrl');

  return { HOUSE_ROOTS, DOM_EXTRACTORS, UNIVERSAL_DOM_EXTRACTOR, rewriteUrl, SKIP_PUPPETEER, CACHE_TIERS };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: HTTP PROBES
// ═══════════════════════════════════════════════════════════════

async function httpProbe(house, url) {
  const result = {
    house, url, status: null, finalUrl: null, redirected: false,
    responseTime: 0, bodySize: 0, cloudflare: false, botBlock: false, error: null,
    firecrawlRescued: false, // set by firecrawlRescue() if plain HTTP fails but FC succeeds
  };
  const start = Date.now();
  try {
    const controller = new AbortController();
    // 30s — bumped from 10s so the regional AH UK branches and other slow
    // sites don't false-positive. Real prod scrape (Firecrawl/Puppeteer)
    // has budgets well beyond this anyway.
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    result.status = res.status;
    result.responseTime = Date.now() - start;
    result.finalUrl = res.url;
    result.cloudflare = !!res.headers.get('cf-ray');

    // Detect cross-domain redirect
    try {
      const fromDomain = new URL(url).hostname.replace('www.', '');
      const toDomain = new URL(res.url).hostname.replace('www.', '');
      result.redirected = fromDomain !== toDomain;
    } catch {}

    const body = await res.text();
    result.bodySize = body.length;

    // Bot detection patterns
    if (body.includes('cf-browser-verification') || body.includes('challenge-platform') ||
        body.includes('Just a moment') || body.includes('Checking your browser') ||
        body.includes('Attention Required') ||
        (result.status === 403 && result.cloudflare)) {
      result.botBlock = true;
    }
  } catch (err) {
    result.error = err.name === 'AbortError' ? 'TIMEOUT' : err.message;
    result.responseTime = Date.now() - start;
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// FIRECRAWL RESCUE — re-probe via Firecrawl when plain HTTP fails
// ═══════════════════════════════════════════════════════════════
// Production uses Firecrawl for Cloudflare + slow-site bypass. Without
// this escalation, the audit systematically over-reports as BROKEN any
// house that blocks generic User-Agents — even though it scrapes fine in
// prod. Called only for houses flagged TIMEOUT/BLOCKED/5xx/403 — so the
// credit spend is bounded by the false-positive count.
async function firecrawlRescue(url) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { ok: false, reason: 'no FIRECRAWL_API_KEY env set' };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['rawHtml'], timeout: 30000 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, reason: `firecrawl ${res.status}` };
    const data = await res.json();
    const html = data?.data?.rawHtml || data?.data?.html || '';
    if (!html || html.length < 500) return { ok: false, reason: 'firecrawl returned empty body' };
    return { ok: true, bodySize: html.length };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'firecrawl timeout' : err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3: PUPPETEER PROBES
// ═══════════════════════════════════════════════════════════════

class Semaphore {
  constructor(max) { this.max = max; this.count = 0; this.queue = []; }
  async acquire() {
    if (this.count < this.max) { this.count++; return; }
    await new Promise(resolve => this.queue.push(resolve));
  }
  release() {
    this.count--;
    if (this.queue.length > 0) { this.count++; this.queue.shift()(); }
  }
}

async function puppeteerProbe(browser, house, url, extractorCode, universalCode, savedFingerprint, sem) {
  await sem.acquire();
  const result = {
    house,
    extractorLots: 0, universalLots: 0,
    extractorImgCount: 0,
    sampleLots: [], universalSampleLots: [],
    extractorError: null,
    reality: {
      priceCount: 0, postcodeCount: 0, propertyLinks: 0,
      imageCount: 0, paginationText: null, noResults: false, cookieWall: false,
    },
    fingerprint: null, driftScore: 0,
    imageResults: [],
  };

  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900 });

    // Block images/fonts/media for speed — but keep stylesheets for selector testing
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch { /* timeout OK — continue with what loaded */ }

    // Scroll for lazy-loaded content
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 400));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 1000));

    // ── a) DOM Extractor Test ──
    if (extractorCode) {
      try {
        const lotsData = await page.evaluate((code) => {
          const lots = eval(code);
          if (!Array.isArray(lots)) return { lots: [], total: 0, imgCount: 0 };
          const imgCount = lots.filter(l => l.imageUrl).length;
          const samples = lots.slice(0, 3).map(l => ({
            lot: l.lot, address: (l.address || '').substring(0, 80),
            price: l.price, hasImage: !!l.imageUrl, hasUrl: !!l.url,
          }));
          return { samples, total: lots.length, imgCount };
        }, extractorCode);
        result.extractorLots = lotsData.total;
        result.extractorImgCount = lotsData.imgCount;
        result.sampleLots = lotsData.samples;
      } catch (err) {
        result.extractorError = err.message?.substring(0, 200);
      }
    }

    // Run universal extractor independently
    try {
      const uData = await page.evaluate((code) => {
        const lots = eval(code);
        if (!Array.isArray(lots)) return { total: 0, samples: [] };
        const samples = lots.slice(0, 3).map(l => ({
          lot: l.lot, address: (l.address || '').substring(0, 80),
          price: l.price, hasImage: !!l.imageUrl, hasUrl: !!l.url,
        }));
        return { total: lots.length, samples };
      }, universalCode);
      result.universalLots = uData.total;
      result.universalSampleLots = uData.samples;
    } catch { /* universal extractor failure is non-critical */ }

    // ── b) Reality Check ──
    result.reality = await page.evaluate(() => {
      const text = document.body?.innerText || '';

      // Count £X,XXX price patterns (property-scale prices only)
      const prices = (text.match(/£[\d,]+/g) || []).filter(p => {
        const n = parseInt(p.replace(/[£,]/g, ''));
        return n >= 5000;
      });
      const priceCount = prices.length;

      // Count UK postcodes
      const postcodeCount = (text.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/gi) || []).length;

      // Count property-like links
      const propLinks = document.querySelectorAll(
        'a[href*="/property/"], a[href*="/lot/"], a[href*="property-details"], ' +
        'a[href*="/properties/"], a[href*="property_details"], a[href*="/auction/"]'
      );
      const propertyLinks = propLinks.length;

      // Count non-junk images
      const junk = /\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge|1x1|placeholder|no-image/i;
      const imgs = [...document.querySelectorAll('img[src], img[data-src], img[data-lazy-src]')].filter(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
        return src.length > 10 && !src.startsWith('data:') && !junk.test(src);
      });
      const imageCount = imgs.length;

      // Detect pagination
      let paginationText = null;
      const pagMatch = text.match(/Page\s+\d+\s+of\s+(\d+)/i) ||
                        text.match(/Showing\s+\d+[\s-]+\d+\s+of\s+(\d+)/i) ||
                        text.match(/(\d+)\s+results?\s+found/i) ||
                        text.match(/(\d+)\s+(?:lots?|properties)\s+(?:found|available)/i);
      if (pagMatch) paginationText = pagMatch[0];

      // Detect "no results" / "coming soon"
      const noResults = /no\s+(?:lots?|results?|properties)\s+(?:found|available|to display)|coming\s+soon|no\s+current\s+(?:auction|catalogue)|between\s+auctions/i.test(text);

      // Detect cookie/login walls blocking content
      const cookieWall = !!(
        document.querySelector('[class*="cookie"], [id*="cookie"], [class*="consent"], [class*="gdpr"]') &&
        text.length < 2000
      );

      return { priceCount, postcodeCount, propertyLinks, imageCount, paginationText, noResults, cookieWall };
    });

    // ── c) Structure Fingerprint ──
    result.fingerprint = await page.evaluate(() => {
      const classes = new Set();
      document.querySelectorAll('[class]').forEach(el => {
        const cn = (el.className || '').toString();
        cn.split(/\s+/).forEach(c => {
          if (/lot|property|card|listing|auction|result|item|catalogue|gallery/i.test(c)) {
            classes.add(c);
          }
        });
      });

      // Common lot-card selectors — count matches
      const selectorTests = [
        '.lot', '.property', '.card', '.listing',
        '[class*="lot"]', '[class*="property"]', '[class*="card"]',
        '[class*="listing"]', 'article', '.item',
        '[class*="auction"]', '[class*="gallery"]',
      ];
      const selectors = {};
      for (const sel of selectorTests) {
        try { selectors[sel] = document.querySelectorAll(sel).length; } catch { selectors[sel] = 0; }
      }

      return { classes: [...classes].sort(), selectors };
    });

    // Compute drift score against saved fingerprint
    if (savedFingerprint) {
      const oldClasses = new Set(savedFingerprint.classes || []);
      const newClasses = new Set(result.fingerprint.classes || []);
      const removed = [...oldClasses].filter(c => !newClasses.has(c)).length;
      const added = [...newClasses].filter(c => !oldClasses.has(c)).length;
      const total = Math.max(oldClasses.size, 1);

      let selectorDrift = 0;
      if (savedFingerprint.selectors) {
        for (const [sel, oldCount] of Object.entries(savedFingerprint.selectors)) {
          const newCount = result.fingerprint.selectors[sel] || 0;
          if (oldCount > 0 && newCount === 0) selectorDrift += 15;
          else if (oldCount > 0 && Math.abs(newCount - oldCount) > oldCount * 0.5) selectorDrift += 5;
        }
      }

      result.driftScore = Math.min(100, Math.round(
        (removed / total) * 60 + (added / total) * 20 + selectorDrift
      ));
    }

    // ── d) Image Validation ──
    if (extractorCode && result.extractorLots > 0) {
      try {
        const imgUrls = await page.evaluate((code) => {
          const lots = eval(code);
          if (!Array.isArray(lots)) return [];
          return lots.filter(l => l.imageUrl).slice(0, 5).map(l => {
            try { return new URL(l.imageUrl, location.href).href; } catch { return l.imageUrl; }
          });
        }, extractorCode);

        const imgChecks = imgUrls.map(async (imgUrl) => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(imgUrl, {
              method: 'HEAD',
              signal: controller.signal,
              headers: { 'User-Agent': USER_AGENT },
            });
            clearTimeout(timeout);
            return { url: imgUrl.substring(0, 100), status: res.status, ok: res.ok };
          } catch (err) {
            return { url: imgUrl.substring(0, 100), status: 0, ok: false, error: err.message?.substring(0, 50) };
          }
        });
        result.imageResults = await Promise.all(imgChecks);
      } catch { /* image validation failure non-critical */ }
    }

  } catch (err) {
    result.extractorError = result.extractorError || err.message?.substring(0, 200);
  } finally {
    if (page) await page.close().catch(() => {});
    sem.release();
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: PRODUCTION COMPARISON
// ═══════════════════════════════════════════════════════════════

async function fetchProductionData() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(PROD_API, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();

    const byHouse = {};
    for (const lot of (data.lots || [])) {
      const h = lot._house || 'unknown';
      if (!byHouse[h]) byHouse[h] = { count: 0, withImages: 0 };
      byHouse[h].count++;
      if (lot.imageUrl) byHouse[h].withImages++;
    }
    return { total: data.lots?.length || 0, byHouse };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 5: DISCOVERY (optional, --discover flag)
// ═══════════════════════════════════════════════════════════════

async function discoverNewHouses(browser, knownDomains) {
  const discoveries = [];
  const directories = [
    { url: 'https://www.eigpropertyauctions.co.uk/', name: 'EIG' },
    { url: 'https://www.propertyauctionaction.co.uk/auction-rooms/', name: 'PropertyAuctionAction' },
  ];

  for (const dir of directories) {
    let page;
    try {
      page = await browser.newPage();
      await page.setUserAgent(USER_AGENT);
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
      });

      try {
        await page.goto(dir.url, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch { /* timeout ok */ }

      const links = await page.evaluate((dirHost) => {
        return [...document.querySelectorAll('a[href]')]
          .map(a => a.href)
          .filter(h => h.startsWith('http') && !new URL(h).hostname.includes(dirHost));
      }, new URL(dir.url).hostname);

      const domains = new Set();
      for (const link of links) {
        try {
          const domain = new URL(link).hostname.replace('www.', '');
          if (!knownDomains.has(domain) && !domains.has(domain) &&
              domain.includes('.') && !domain.includes('google') &&
              !domain.includes('facebook') && !domain.includes('twitter') &&
              !domain.includes('linkedin') && !domain.includes('youtube')) {
            domains.add(domain);
          }
        } catch {}
      }

      for (const domain of domains) {
        discoveries.push({ domain, source: dir.name });
      }
    } catch {} finally {
      if (page) await page.close().catch(() => {});
    }
  }

  return discoveries;
}

// ═══════════════════════════════════════════════════════════════
// LOT-COUNT CROSS-VALIDATION
// ═══════════════════════════════════════════════════════════════

function extractStatedLotCount(httpResult) {
  if (!httpResult || httpResult.error || !httpResult.bodySize) return null;
  // We need the body text — re-fetch is expensive, so we parse from probe data
  // The httpProbe stores bodySize but not body text. We'll use puppeteer reality data if available.
  return null; // Placeholder — actual stated count comes from puppeteer reality check below
}

function extractStatedCountFromReality(reality) {
  if (!reality || !reality.paginationText) return null;
  // Extract numeric count from pagination text like "Showing 1-20 of 45" or "45 results found"
  const nums = reality.paginationText.match(/(\d+)/g);
  if (!nums || nums.length === 0) return null;
  // The largest number is typically the total count
  return Math.max(...nums.map(Number));
}

function lotCountValidation(results, prodData) {
  const validations = [];

  for (const r of results) {
    const entry = { house: r.house, statedCount: null, extractedCount: null, status: 'SKIP', ratio: null };

    // Try to get stated count from puppeteer reality check (pagination text)
    if (r.puppeteer?.reality) {
      entry.statedCount = extractStatedCountFromReality(r.puppeteer.reality);
    }

    // Also try additional patterns from the page text if puppeteer ran
    if (entry.statedCount === null && r.puppeteer?.reality?.priceCount >= 3) {
      // Use price count as a proxy for stated count when no pagination text
      entry.statedCount = r.puppeteer.reality.priceCount;
    }

    // Get extracted count from production data
    if (prodData?.byHouse?.[r.house]) {
      entry.extractedCount = prodData.byHouse[r.house].count;
    } else if (r.puppeteer?.extractorLots > 0) {
      entry.extractedCount = r.puppeteer.extractorLots;
    }

    if (entry.statedCount === null) {
      entry.status = 'SKIP';
      entry.detail = 'stated count unavailable';
    } else if (entry.extractedCount === null || entry.extractedCount === 0) {
      entry.status = 'SKIP';
      entry.detail = 'extracted count unavailable';
    } else {
      entry.ratio = entry.statedCount / entry.extractedCount;
      if (entry.ratio > 2.0) {
        entry.status = 'BROKEN';
        entry.detail = `${Math.round((entry.extractedCount / entry.statedCount) * 100)}% coverage`;
      } else if (entry.ratio > 1.3) {
        entry.status = 'MISMATCH';
        entry.detail = `${Math.round((entry.extractedCount / entry.statedCount) * 100)}% coverage`;
      } else {
        entry.status = 'OK';
      }
    }

    validations.push(entry);
  }

  return validations;
}

// ═══════════════════════════════════════════════════════════════
// IMAGE COVERAGE ANALYSIS
// ═══════════════════════════════════════════════════════════════

function imageCoverageAnalysis(prodData) {
  const coverage = [];
  if (!prodData?.byHouse) return coverage;

  for (const [house, data] of Object.entries(prodData.byHouse)) {
    const total = data.count;
    const withImages = data.withImages || 0;
    const pct = total > 0 ? Math.round((withImages / total) * 100) : 0;
    const status = pct >= 90 ? 'OK' : 'BELOW TARGET';

    coverage.push({
      house,
      lotsWithImages: withImages,
      totalLots: total,
      coverage: pct,
      status,
    });
  }

  // Sort by coverage ascending (worst first)
  coverage.sort((a, b) => a.coverage - b.coverage);
  return coverage;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DISABLE BROKEN EXTRACTORS
// ═══════════════════════════════════════════════════════════════

async function autoDisableBrokenHouses(brokenHouses, apiBase) {
  const results = [];
  for (const { house, reason } of brokenHouses) {
    try {
      const adminSecret = process.env.ADMIN_SECRET || '';
      const res = await fetch(`${apiBase}/api/admin/broken-extractors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify({ house, action: 'disable', reason }),
      });
      const data = await res.json();
      results.push({ house, success: res.ok, message: data.message || data.error });
    } catch (err) {
      results.push({ house, success: false, message: err.message });
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// PROBLEM DETECTION — Cross-Probe Intelligence
// ═══════════════════════════════════════════════════════════════

async function detectProblems(house, httpResult, puppeteerResult, prodData, config) {
  const issues = [];

  // Get rewriteUrl config for this house
  let rw = { preferPuppeteer: false, paginateAs: null, isApi: false };
  try {
    rw = await config.rewriteUrl(config.HOUSE_ROOTS[house], house);
  } catch {}

  const hasCustomExtractor = !!config.DOM_EXTRACTORS[house];

  // ── HTTP-level issues ──
  // If Firecrawl rescued this URL (set by the rescue pass before detectProblems
  // runs), downgrade BROKEN → WARNING: production uses Firecrawl so these
  // aren't real outages — just audit-tool false positives.
  const bSev = httpResult?.firecrawlRescued ? 'WARNING' : 'BROKEN';
  const bSuffix = httpResult?.firecrawlRescued ? ' (OK via Firecrawl)' : '';

  if (httpResult?.error === 'TIMEOUT') {
    issues.push({ type: 'TIMEOUT', severity: bSev, detail: `HTTP request timed out (30s)${bSuffix}` });
  } else if (httpResult?.error?.includes('ENOTFOUND') || httpResult?.error?.includes('getaddrinfo')) {
    // DNS failure is real — Firecrawl can't rescue this
    issues.push({ type: 'URL_DEAD', severity: 'BROKEN', detail: 'DNS resolution failed' });
  } else if (httpResult?.status === 404) {
    // 404 is real — Firecrawl would get 404 too
    issues.push({ type: 'URL_DEAD', severity: 'BROKEN', detail: 'HTTP 404 — page not found' });
  } else if (httpResult?.status >= 500) {
    issues.push({ type: 'SERVER_ERROR', severity: bSev, detail: `HTTP ${httpResult.status}${bSuffix}` });
  }

  if (httpResult?.botBlock) {
    issues.push({ type: 'BLOCKED', severity: bSev, detail: `Bot detection${httpResult.cloudflare ? ' (Cloudflare)' : ''} — ${httpResult.status || 'challenge page'}${bSuffix}` });
  } else if (httpResult?.status === 403 && httpResult?.cloudflare) {
    issues.push({ type: 'BLOCKED', severity: bSev, detail: `Cloudflare blocking (403)${bSuffix}` });
  }

  if (httpResult?.bodySize > 0 && httpResult?.bodySize < 500 && httpResult?.status === 200 && !httpResult?.botBlock) {
    issues.push({ type: 'EMPTY_RESPONSE', severity: 'WARNING', detail: `Response only ${httpResult.bodySize} bytes` });
  }

  // Cross-domain redirect
  if (httpResult?.redirected) {
    const toDomain = new URL(httpResult.finalUrl).hostname.replace('www.', '');
    issues.push({ type: 'DOMAIN_MOVED', severity: 'WARNING', detail: `Redirects to ${toDomain}` });
  }

  // Skip Puppeteer-level checks if we didn't run Puppeteer
  if (!puppeteerResult) return issues;

  // ── Extractor issues ──
  if (puppeteerResult.extractorError) {
    issues.push({ type: 'EXTRACTOR_ERROR', severity: 'BROKEN', detail: puppeteerResult.extractorError });
  }

  if (hasCustomExtractor && puppeteerResult.extractorLots === 0 && !puppeteerResult.extractorError &&
      puppeteerResult.reality.priceCount >= 5) {
    issues.push({ type: 'EXTRACTOR_BROKEN', severity: 'BROKEN',
      detail: `DOM extractor returns 0, but ${puppeteerResult.reality.priceCount} prices on page` });
  }

  if (!hasCustomExtractor && puppeteerResult.universalLots === 0 && puppeteerResult.reality.priceCount >= 5) {
    issues.push({ type: 'NO_EXTRACTOR', severity: 'WARNING',
      detail: `No custom extractor — universal finds 0 but ${puppeteerResult.reality.priceCount} prices on page` });
  }

  if (puppeteerResult.driftScore > 50 && puppeteerResult.extractorLots === 0) {
    issues.push({ type: 'SITE_REDESIGNED', severity: 'BROKEN',
      detail: `Structure drift ${puppeteerResult.driftScore}/100 + extractor returns 0` });
  }

  // ── Universal vs custom comparison ──
  if (puppeteerResult.universalLots > puppeteerResult.extractorLots * 2 &&
      puppeteerResult.universalLots > 5 && hasCustomExtractor) {
    issues.push({ type: 'UNIVERSAL_BETTER', severity: 'WARNING',
      detail: `Universal finds ${puppeteerResult.universalLots} vs custom ${puppeteerResult.extractorLots}` });
  }

  // ── Pagination detection ──
  if (puppeteerResult.reality.paginationText && !rw.paginateAs) {
    issues.push({ type: 'PAGINATION_MISSED', severity: 'WARNING',
      detail: `Page says "${puppeteerResult.reality.paginationText}" but no pagination config` });
  }

  // Pagination gap — estimated total >> extracted
  if (puppeteerResult.reality.paginationText) {
    const nums = puppeteerResult.reality.paginationText.match(/(\d+)/g);
    if (nums) {
      const estimatedTotal = Math.max(...nums.map(Number));
      if (estimatedTotal > puppeteerResult.extractorLots * 2 && estimatedTotal > 20) {
        issues.push({ type: 'PAGINATION_GAP', severity: 'WARNING',
          detail: `~${estimatedTotal} total lots estimated but only got ${puppeteerResult.extractorLots}` });
      }
    }
  }

  // ── Image coverage ──
  const imgCoverage = puppeteerResult.extractorLots > 0
    ? Math.round((puppeteerResult.extractorImgCount / puppeteerResult.extractorLots) * 100) : 0;
  if (puppeteerResult.extractorLots >= 3 && imgCoverage < 30) {
    issues.push({ type: 'LOW_IMAGES', severity: 'WARNING',
      detail: `Image coverage ${imgCoverage}% (${puppeteerResult.extractorImgCount}/${puppeteerResult.extractorLots})` });
  }

  // Broken images
  const brokenImages = puppeteerResult.imageResults.filter(r => !r.ok).length;
  if (brokenImages > 0 && puppeteerResult.imageResults.length > 0) {
    issues.push({ type: 'BROKEN_IMAGES', severity: 'WARNING',
      detail: `${brokenImages}/${puppeteerResult.imageResults.length} image URLs return errors` });
  }

  // ── Config issues ──
  if (!rw.preferPuppeteer && puppeteerResult.extractorLots > 0 &&
      httpResult?.bodySize < 2000 && httpResult?.status === 200 && !httpResult?.error) {
    issues.push({ type: 'NEEDS_PUPPETEER', severity: 'WARNING',
      detail: 'preferPuppeteer not set — HTTP body too small for static extraction' });
  }

  // ── No catalogue ──
  if (puppeteerResult.extractorLots === 0 && puppeteerResult.universalLots === 0 &&
      puppeteerResult.reality.priceCount === 0 && puppeteerResult.reality.noResults) {
    issues.push({ type: 'NO_CATALOGUE', severity: 'INFO', detail: 'No current auction catalogue' });
  }

  // ── Minor drift ──
  if (puppeteerResult.driftScore >= 20 && puppeteerResult.driftScore <= 50 &&
      puppeteerResult.extractorLots > 0) {
    issues.push({ type: 'MINOR_DRIFT', severity: 'INFO',
      detail: `Structure drift score ${puppeteerResult.driftScore}/100` });
  }

  // ── Production comparison ──
  if (prodData?.byHouse) {
    const cached = prodData.byHouse[house];
    if ((!cached || cached.count === 0) && puppeteerResult.extractorLots > 0) {
      issues.push({ type: 'MISSING_FROM_CACHE', severity: 'WARNING',
        detail: `${puppeteerResult.extractorLots} live lots but missing from production cache` });
    } else if (cached && puppeteerResult.extractorLots > 0) {
      const pctDrop = Math.round(((cached.count - puppeteerResult.extractorLots) / cached.count) * 100);
      if (pctDrop > 30) {
        issues.push({ type: 'CACHE_STALE', severity: 'WARNING',
          detail: `Cached ${cached.count} vs live ${puppeteerResult.extractorLots} (${pctDrop}% drift)` });
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════
// FINGERPRINT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function loadFingerprints() {
  const fp = join(AUDIT_DIR, 'fingerprints.json');
  if (existsSync(fp)) {
    try { return JSON.parse(readFileSync(fp, 'utf-8')); } catch { return {}; }
  }
  return {};
}

function saveFingerprints(fingerprints) {
  mkdirSync(AUDIT_DIR, { recursive: true });
  writeFileSync(join(AUDIT_DIR, 'fingerprints.json'), JSON.stringify(fingerprints, null, 2));
}

function saveAuditResults(data) {
  mkdirSync(AUDIT_DIR, { recursive: true });
  writeFileSync(join(AUDIT_DIR, 'last-audit.json'), JSON.stringify(data, null, 2));
}

// ═══════════════════════════════════════════════════════════════
// REPORT OUTPUT
// ═══════════════════════════════════════════════════════════════

function printReport(results, prodData, startTime, lotValidations, imgCoverage) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const totalLive = results.reduce((sum, r) => sum + (r.puppeteer?.extractorLots || 0), 0);
  const houseCount = results.length;
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().substring(0, 5);

  console.log('');
  console.log('\u2550'.repeat(59));
  console.log(`  AUCTION HEALTH MONITOR  \u2014  ${date}  ${time}`);
  console.log(`  ${houseCount} houses  |  ${elapsed}s  |  ${totalLive.toLocaleString()} live lots`);
  console.log('\u2550'.repeat(59));

  // Categorise
  const broken = results.filter(r => r.issues.some(i => i.severity === 'BROKEN'));
  const warnings = results.filter(r =>
    !r.issues.some(i => i.severity === 'BROKEN') && r.issues.some(i => i.severity === 'WARNING'));
  const healthy = results.filter(r =>
    !r.issues.some(i => i.severity === 'BROKEN') && !r.issues.some(i => i.severity === 'WARNING'));

  if (broken.length > 0) {
    console.log(`\n  BROKEN (${broken.length})`);
    console.log('  ' + '\u2500'.repeat(55));
    for (const r of broken) {
      const lots = r.puppeteer?.extractorLots ?? '?';
      const topIssue = r.issues.find(i => i.severity === 'BROKEN');
      console.log(`  ${r.house.padEnd(20)} ${String(lots).padStart(4)} lots   ${topIssue.detail}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n  WARNING (${warnings.length})`);
    console.log('  ' + '\u2500'.repeat(55));
    for (const r of warnings) {
      const lots = r.puppeteer?.extractorLots ?? '?';
      const topIssue = r.issues.find(i => i.severity === 'WARNING');
      console.log(`  ${r.house.padEnd(20)} ${String(lots).padStart(4)} lots   ${topIssue.detail}`);
    }
  }

  if (healthy.length > 0) {
    console.log(`\n  HEALTHY (${healthy.length})`);
    console.log('  ' + '\u2500'.repeat(55));
    for (const r of healthy) {
      const lots = r.puppeteer?.extractorLots ?? '?';
      let imgPct = '?';
      if (r.puppeteer && r.puppeteer.extractorLots > 0) {
        imgPct = Math.round((r.puppeteer.extractorImgCount / r.puppeteer.extractorLots) * 100) + '%';
      }
      // Check cache age from prodData
      let cacheInfo = '';
      if (prodData?.byHouse?.[r.house]) {
        cacheInfo = `  cache: ${prodData.byHouse[r.house].count} lots`;
      }
      const info = r.issues.find(i => i.severity === 'INFO');
      const extra = info ? `  ${info.detail}` : '';
      console.log(`  ${r.house.padEnd(20)} ${String(lots).padStart(4)} lots  | ${imgPct.padStart(4)} img${cacheInfo}${extra}`);
    }
  }

  // Production comparison summary
  if (prodData) {
    console.log(`\n  PRODUCTION COMPARISON`);
    console.log('  ' + '\u2500'.repeat(55));
    const cachedTotal = prodData.total;
    const delta = totalLive - cachedTotal;
    console.log(`  Live total: ${totalLive.toLocaleString()}  |  Cached total: ${cachedTotal.toLocaleString()}  |  Delta: ${delta > 0 ? '+' : ''}${delta}`);

    const missingFromCache = results.filter(r => {
      const cached = prodData.byHouse?.[r.house];
      return (!cached || cached.count === 0) && (r.puppeteer?.extractorLots > 0);
    }).map(r => r.house);
    if (missingFromCache.length > 0) {
      console.log(`  Missing from cache: ${missingFromCache.join(', ')}`);
    }
  }

  // Lot Count Validation section
  if (lotValidations && lotValidations.length > 0) {
    console.log(`\n  LOT COUNT VALIDATION`);
    console.log('  ' + '\u2500'.repeat(55));
    for (const v of lotValidations) {
      const stated = v.statedCount !== null ? String(v.statedCount) : '?';
      const extracted = v.extractedCount !== null ? String(v.extractedCount) : '?';
      let tag = '';
      if (v.status === 'OK') tag = '[OK]';
      else if (v.status === 'MISMATCH') tag = `[MISMATCH - ${v.detail}]`;
      else if (v.status === 'BROKEN') tag = `[BROKEN - ${v.detail}]`;
      else tag = `[SKIP]`;
      console.log(`  ${v.house.padEnd(20)} stated ${stated.padStart(4)}, extracted ${extracted.padStart(4)}  ${tag}`);
    }
  }

  // Image Coverage section
  if (imgCoverage && imgCoverage.length > 0) {
    console.log(`\n  IMAGE COVERAGE`);
    console.log('  ' + '\u2500'.repeat(55));
    for (const ic of imgCoverage) {
      const tag = ic.status === 'OK' ? '[OK]' : '[BELOW TARGET]';
      console.log(`  ${ic.house.padEnd(20)} ${String(ic.lotsWithImages).padStart(4)}/${String(ic.totalLots).padStart(4)} (${String(ic.coverage).padStart(3)}%)  ${tag}`);
    }
  }

  // Recommendations
  const recs = [];
  for (const r of broken) {
    const issue = r.issues.find(i => i.severity === 'BROKEN');
    recs.push({ priority: 'HIGH', text: `Fix ${r.house} \u2014 ${issue.detail}` });
  }
  for (const r of warnings) {
    for (const issue of r.issues.filter(i => i.severity === 'WARNING')) {
      const pri = ['EXTRACTOR_BROKEN', 'NEEDS_PUPPETEER', 'PAGINATION_MISSED', 'MISSING_FROM_CACHE'].includes(issue.type) ? 'HIGH'
        : ['BROKEN_IMAGES', 'LOW_IMAGES', 'DOMAIN_MOVED'].includes(issue.type) ? 'MED' : 'LOW';
      recs.push({ priority: pri, text: `${r.house}: ${issue.detail}` });
    }
  }

  if (recs.length > 0) {
    console.log(`\n  RECOMMENDATIONS`);
    console.log('  ' + '\u2500'.repeat(55));
    const sorted = [
      ...recs.filter(r => r.priority === 'HIGH'),
      ...recs.filter(r => r.priority === 'MED'),
      ...recs.filter(r => r.priority === 'LOW'),
    ];
    for (let i = 0; i < Math.min(sorted.length, 12); i++) {
      console.log(`  ${(i + 1).toString().padStart(2)}. [${sorted[i].priority.padEnd(4)}] ${sorted[i].text}`);
    }
    if (sorted.length > 12) console.log(`      ... and ${sorted.length - 12} more`);
  }

  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();

  // ── Phase 1: Config extraction ──
  if (!JSON_MODE) console.log('\n  Phase 1: Loading config from lib/...');
  const config = await extractConfig();
  const allHouses = Object.keys(config.HOUSE_ROOTS);
  const houses = HOUSE_FILTER
    ? HOUSE_FILTER.filter(h => { if (!config.HOUSE_ROOTS[h]) { console.log(`  WARN: Unknown house "${h}" — skipping`); return false; } return true; })
    : allHouses;

  if (!JSON_MODE) {
    console.log(`  Found ${allHouses.length} houses, ${Object.keys(config.DOM_EXTRACTORS).length} extractors`);
    if (HOUSE_FILTER) console.log(`  Filtering to: ${houses.join(', ')}`);
  }

  // Load saved fingerprints
  const savedFingerprints = loadFingerprints();

  // ── Phase 2: HTTP probes ──
  if (!JSON_MODE) console.log('\n  Phase 2: HTTP probes...');
  const httpResults = {};
  await Promise.all(houses.map(async (house) => {
    const url = config.HOUSE_ROOTS[house];
    httpResults[house] = await httpProbe(house, url);
  }));

  if (!JSON_MODE) {
    const ok = Object.values(httpResults).filter(r => r.status >= 200 && r.status < 400).length;
    const blocked = Object.values(httpResults).filter(r => r.botBlock || r.status === 403).length;
    const errs = Object.values(httpResults).filter(r => r.error).length;
    console.log(`  ${ok} OK, ${blocked} blocked, ${errs} errors  (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
  }

  // ── Phase 2.5: Firecrawl rescue for plain-HTTP failures ──
  // Production uses Firecrawl to bypass Cloudflare / slow sites. Re-probe
  // any house flagged BLOCKED / TIMEOUT / 5xx via Firecrawl and flag
  // firecrawlRescued=true so detectProblems() downgrades to a warning.
  // Bounded by the false-positive count — no spend on houses that pass HTTP.
  const rescueCandidates = Object.entries(httpResults).filter(([, r]) =>
    r.error === 'TIMEOUT' ||
    r.botBlock ||
    (r.status === 403 && r.cloudflare) ||
    (r.status >= 500 && r.status < 600)
  );
  if (rescueCandidates.length > 0 && process.env.FIRECRAWL_API_KEY) {
    if (!JSON_MODE) console.log(`\n  Phase 2.5: Firecrawl rescue for ${rescueCandidates.length} flagged houses...`);
    let rescued = 0;
    // Concurrency 3 to respect Firecrawl rate limits
    for (let i = 0; i < rescueCandidates.length; i += 3) {
      const batch = rescueCandidates.slice(i, i + 3);
      await Promise.all(batch.map(async ([house]) => {
        const url = config.HOUSE_ROOTS[house];
        const fc = await firecrawlRescue(url);
        if (fc.ok) {
          httpResults[house].firecrawlRescued = true;
          rescued++;
        }
      }));
      if (i + 3 < rescueCandidates.length) await new Promise(r => setTimeout(r, 500));
    }
    if (!JSON_MODE) console.log(`  ${rescued}/${rescueCandidates.length} rescued via Firecrawl (will report as WARNING, not BROKEN)`);
  } else if (rescueCandidates.length > 0 && !JSON_MODE) {
    console.log(`  Phase 2.5: skipped — FIRECRAWL_API_KEY not set; ${rescueCandidates.length} will still report as BROKEN`);
  }

  // ── Phase 3: Puppeteer probes ──
  let puppeteerResults = {};
  if (!FAST_MODE && !VALIDATE_MODE) {
    if (!JSON_MODE) console.log(`\n  Phase 3: Puppeteer probes (concurrency ${CONCURRENCY})...`);
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const sem = new Semaphore(CONCURRENCY);
    await Promise.all(houses.map(async (house) => {
      const url = config.HOUSE_ROOTS[house];
      const extractorCode = config.DOM_EXTRACTORS[house] || null;
      const savedFp = savedFingerprints[house] || null;
      puppeteerResults[house] = await puppeteerProbe(
        browser, house, url, extractorCode, config.UNIVERSAL_DOM_EXTRACTOR, savedFp, sem
      );
      if (!JSON_MODE) {
        const r = puppeteerResults[house];
        const status = r.extractorError ? 'ERR'
          : r.extractorLots > 0 ? `${r.extractorLots} lots`
          : `0 lots (univ: ${r.universalLots})`;
        process.stdout.write(`    ${house.padEnd(20)} ${status}\n`);
      }
    }));

    await browser.close();
    if (!JSON_MODE) console.log(`  Puppeteer phase complete (${((Date.now() - startTime) / 1000).toFixed(1)}s total)`);
  }

  // ── Phase 4: Production comparison ──
  if (!JSON_MODE) console.log('\n  Phase 4: Production comparison...');
  const prodData = await fetchProductionData();
  if (!JSON_MODE) {
    if (prodData) console.log(`  Production cache: ${prodData.total.toLocaleString()} lots across ${Object.keys(prodData.byHouse).length} houses`);
    else console.log('  Could not reach production API');
  }

  // ── Phase 5: Discovery (optional) ──
  let discoveries = [];
  if (DISCOVER_MODE && !FAST_MODE && !VALIDATE_MODE) {
    if (!JSON_MODE) console.log('\n  Phase 5: Discovering new auction houses...');
    const knownDomains = new Set(
      Object.values(config.HOUSE_ROOTS).map(url => {
        try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
      })
    );
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    discoveries = await discoverNewHouses(browser, knownDomains);
    await browser.close();
    if (!JSON_MODE) console.log(`  Found ${discoveries.length} potential new auction houses`);
  }

  // ── Detect problems (cross-probe intelligence) ──
  const results = await Promise.all(houses.map(async house => {
    const httpResult = httpResults[house] || null;
    const puppeteerResult = puppeteerResults[house] || null;
    const issues = await detectProblems(house, httpResult, puppeteerResult, prodData, config);
    return { house, http: httpResult, puppeteer: puppeteerResult, issues };
  }));

  // ── Lot-Count Cross-Validation ──
  if (!JSON_MODE) console.log('\n  Phase 6: Lot-count cross-validation...');
  const lotValidations = lotCountValidation(results, prodData);
  const mismatches = lotValidations.filter(v => v.status === 'MISMATCH' || v.status === 'BROKEN');
  if (!JSON_MODE) {
    const okCount = lotValidations.filter(v => v.status === 'OK').length;
    const skipCount = lotValidations.filter(v => v.status === 'SKIP').length;
    console.log(`  ${okCount} OK, ${mismatches.length} mismatches, ${skipCount} skipped`);
  }

  // ── Image Coverage Analysis ──
  if (!JSON_MODE) console.log('\n  Phase 7: Image coverage analysis...');
  const imgCoverage = imageCoverageAnalysis(prodData);
  const belowTarget = imgCoverage.filter(ic => ic.status === 'BELOW TARGET');
  if (!JSON_MODE) {
    console.log(`  ${imgCoverage.length} houses analysed, ${belowTarget.length} below 90% target`);
  }

  // ── Auto-disable broken extractors (if --auto-disable flag) ──
  let autoDisableResults = [];
  if (AUTO_DISABLE) {
    const brokenForDisable = [
      // From lot count validation with BROKEN status
      ...lotValidations.filter(v => v.status === 'BROKEN').map(v => ({
        house: v.house,
        reason: `Lot count mismatch: stated ${v.statedCount}, extracted ${v.extractedCount} (${v.detail})`,
      })),
      // From problem detection with EXTRACTOR_BROKEN type
      ...results.filter(r => r.issues.some(i => i.type === 'EXTRACTOR_BROKEN'))
        .map(r => ({
          house: r.house,
          reason: r.issues.find(i => i.type === 'EXTRACTOR_BROKEN').detail,
        })),
    ];

    // Deduplicate by house
    const seen = new Set();
    const uniqueBroken = brokenForDisable.filter(b => {
      if (seen.has(b.house)) return false;
      seen.add(b.house);
      return true;
    });

    if (uniqueBroken.length > 0) {
      if (!JSON_MODE) console.log(`\n  Auto-disabling ${uniqueBroken.length} broken extractors...`);
      autoDisableResults = await autoDisableBrokenHouses(uniqueBroken, ADMIN_API_BASE);
      if (!JSON_MODE) {
        for (const r of autoDisableResults) {
          console.log(`    ${r.house}: ${r.success ? 'DISABLED' : 'FAILED'} - ${r.message}`);
        }
      }
    } else {
      if (!JSON_MODE) console.log('\n  No broken extractors to auto-disable');
    }
  }

  // ── Output ──
  if (JSON_MODE) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      elapsed: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
      results: results.map(r => ({
        house: r.house,
        httpStatus: r.http?.status ?? null,
        httpFinalUrl: r.http?.finalUrl ?? null,
        extractorLots: r.puppeteer?.extractorLots ?? null,
        universalLots: r.puppeteer?.universalLots ?? null,
        imgCoverage: r.puppeteer && r.puppeteer.extractorLots > 0
          ? Math.round((r.puppeteer.extractorImgCount / r.puppeteer.extractorLots) * 100) : null,
        issues: r.issues,
      })),
      lotCountValidation: lotValidations,
      imageCoverage: imgCoverage,
      autoDisableResults: autoDisableResults.length > 0 ? autoDisableResults : undefined,
      production: prodData ? { total: prodData.total, houses: Object.keys(prodData.byHouse).length } : null,
      discoveries,
    }, null, 2));
  } else {
    printReport(results, prodData, startTime, lotValidations, imgCoverage);

    if (discoveries.length > 0) {
      console.log('  DISCOVERED AUCTION HOUSES');
      console.log('  ' + '\u2500'.repeat(55));
      for (const d of discoveries.slice(0, 15)) {
        console.log(`  ${d.domain.padEnd(40)} (via ${d.source})`);
      }
      if (discoveries.length > 15) console.log(`  ... and ${discoveries.length - 15} more`);
      console.log('');
    }
  }

  // ── Save fingerprints + history ──
  if (SAVE_MODE) {
    const newFingerprints = { ...savedFingerprints };
    for (const r of results) {
      if (r.puppeteer?.fingerprint) {
        newFingerprints[r.house] = r.puppeteer.fingerprint;
      }
    }
    saveFingerprints(newFingerprints);
    saveAuditResults({
      timestamp: new Date().toISOString(),
      results: results.map(r => ({
        house: r.house,
        extractorLots: r.puppeteer?.extractorLots ?? null,
        universalLots: r.puppeteer?.universalLots ?? null,
        httpStatus: r.http?.status ?? null,
        imgCoverage: r.puppeteer && r.puppeteer.extractorLots > 0
          ? Math.round((r.puppeteer.extractorImgCount / r.puppeteer.extractorLots) * 100) : null,
        issues: r.issues,
      })),
    });
    if (!JSON_MODE) console.log('  Fingerprints + results saved to scripts/audit/\n');
  }

  // Exit with error code if any houses are broken
  const brokenCount = results.filter(r => r.issues.some(i => i.severity === 'BROKEN')).length;
  if (brokenCount > 0) process.exit(1);
}

main().catch(err => { console.error('\n  FATAL:', err.message, err.stack); process.exit(1); });
