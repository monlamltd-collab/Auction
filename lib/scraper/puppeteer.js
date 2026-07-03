// ═══════════════════════════════════════════════════════════════
// lib/scraper/puppeteer.js — Headless-Chrome scrape tier.
//
// Owns the singleton browser pool (one Chromium instance, recycled
// every BROWSER_MAX_USES pages) and the bounded concurrency gate
// around acquirePage. Puppeteer is imported conditionally so the
// server still boots on platforms without Chromium.
//
// Renders pages and returns raw HTML — extraction happens upstream
// via Firecrawl JSON extract or Gemini fallback. The legacy
// extractWithDOM helper that ran DOM extractors inside the page
// context was retired 2026-05-08 with the rest of the JSDOM system.
// ═══════════════════════════════════════════════════════════════

import { HEADERS, MAX_PUPPETEER_PAGES, renderConcurrency } from '../config.js';
import { detectTotalPages, buildPageUrl } from './pagination.js';

let puppeteer = null;
try { puppeteer = (await import('puppeteer')).default; } catch {}

// ── Browser singleton + bounded page concurrency ──
let browserInstance = null;
let browserUseCount = 0;
const BROWSER_MAX_USES = 10;
// Shared ceiling with the Crawlee fleet — renderConcurrency() (lib/config.js),
// env CRAWLEE_MAX_CONCURRENCY. Was a hard-coded 3 (Phase 3, 2026-07-02).
let activePagesCount = 0;

export async function acquirePage() {
  if (!puppeteer) throw new Error('Puppeteer not available');
  // Wait for a slot if at max concurrency
  while (activePagesCount >= renderConcurrency()) {
    await new Promise(r => setTimeout(r, 500));
  }
  activePagesCount++;
  let browser, page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
  } catch (err) {
    activePagesCount = Math.max(0, activePagesCount - 1);
    throw new Error(`Puppeteer page creation failed: ${err.message}`);
  }
  const origClose = page.close.bind(page);
  page.close = async () => { activePagesCount = Math.max(0, activePagesCount - 1); return origClose(); };
  return page;
}

export async function getBrowser() {
  if (!puppeteer) throw new Error('Puppeteer not available');
  // Restart browser after N uses to prevent memory bloat
  if (browserInstance && browserUseCount >= BROWSER_MAX_USES) {
    console.log(`Puppeteer: recycling browser after ${browserUseCount} uses`);
    try { await browserInstance.close(); } catch (e) { /* ignore */ }
    browserInstance = null;
    browserUseCount = 0;
  }
  if (browserInstance && browserInstance.isConnected()) {
    browserUseCount++;
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  });
  browserUseCount = 1;
  return browserInstance;
}

export async function scrapeWithPuppeteer(url, house) {
  const pages = [];
  try {
    const page = await acquirePage();
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
    const puppeteerPageCap = Math.min(totalPages, MAX_PUPPETEER_PAGES);
    for (let pg = 2; pg <= puppeteerPageCap; pg++) {
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
    if (totalPages > MAX_PUPPETEER_PAGES) console.log(`${house} pagination cap reached at ${MAX_PUPPETEER_PAGES} pages`);

    await page.close();
  } catch (err) {
    console.error(`Puppeteer scrape failed: ${err.message}`);
  }
  return pages;
}

// extractWithDOM was retired 2026-05-08. Catalogue extraction now lives
// in lib/pipeline/firecrawl-extract.js (Firecrawl JSON extract). Puppeteer's
// role here is rendering only — return raw HTML and let downstream extract.

// Export puppeteer reference for server.js to check availability
export function hasPuppeteer() { return !!puppeteer; }
export { puppeteer };
