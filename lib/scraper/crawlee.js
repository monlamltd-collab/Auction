// ═══════════════════════════════════════════════════════════════
// lib/scraper/crawlee.js — Crawlee render tier (self-hosted, cheap).
//
// A render-only adapter that mirrors the scrapeRenderedPage contract
// ({ html, sourceURL }) so the engine router can route a house through
// Crawlee instead of Firecrawl. Extraction still happens upstream via
// the Gemini path — Crawlee renders, Gemini reads.
//
// Crawlee is imported conditionally (like puppeteer.js) so the server
// boots even when the dependency isn't installed. Until `npm install
// crawlee` lands and CRAWLEE_HOUSES is set, hasCrawlee() returns false
// and the router never picks this engine — it stays fully dormant.
//
// Why a singleton keepAlive crawler + promise bridge: Crawlee is
// queue-driven, but the pipeline wants request/response. We run one
// long-lived PuppeteerCrawler (keepAlive: true) with in-memory storage
// (persistStorage: false — Railway's disk is ephemeral) and bridge each
// addRequests() to a promise resolved inside the requestHandler. This is
// the documented Express-integration pattern.
//
// What Crawlee adds over the bare puppeteer.js tier: zero-config
// human-like browser fingerprints (fingerprint-suite), TLS-fingerprint
// replication, session pooling, and proxy rotation — the hardening the
// fallback tier lacks. See docs/ENGINE-ROUTER.md.
// ═══════════════════════════════════════════════════════════════

import { HEADERS } from '../config.js';

// Conditional import — absent dependency must not crash module load.
let PuppeteerCrawler = null;
let Configuration = null;
try {
  const mod = await import('crawlee');
  PuppeteerCrawler = mod.PuppeteerCrawler;
  Configuration = mod.Configuration;
} catch { /* crawlee not installed — adapter stays dormant */ }

// The lazy-image materialisation script shared with the Firecrawl path in
// rendering.js: swap data-src/data-lazy-src/data-original onto src so the
// rendered HTML carries real image URLs.
const LAZY_IMAGE_SCRIPT = `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });`;

let crawler = null;
// Maps a URL to the { resolve, reject } of the caller awaiting it.
const pending = new Map();

export function hasCrawlee() {
  return !!PuppeteerCrawler;
}

async function getCrawler() {
  if (!PuppeteerCrawler) throw new Error('Crawlee not available');
  if (crawler) return crawler;

  // In-memory, non-persistent storage: Railway's filesystem is ephemeral and
  // we never want one scrape's queue surviving into the next.
  const config = new Configuration({ persistStorage: false });

  crawler = new PuppeteerCrawler({
    keepAlive: true,                 // long-lived; serves requests as they arrive
    maxConcurrency: 3,               // match the puppeteer.js tier's gate
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: 90,
    headless: true,
    launchContext: {
      launchOptions: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote',
          // Dev-container escape hatch: egress proxies that MITM TLS present a
          // CA Chrome doesn't trust (ERR_CERT_AUTHORITY_INVALID). NEVER set in
          // production — it disables certificate validation.
          ...(process.env.CRAWLEE_IGNORE_CERT_ERRORS === 'true' ? ['--ignore-certificate-errors'] : []),
        ],
      },
    },
    async requestHandler({ page, request }) {
      const slot = pending.get(request.url);
      try {
        await page.setUserAgent(HEADERS['User-Agent']);
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(request.url, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.evaluate(async () => {
          for (let i = 0; i < 8; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 600)); }
          window.scrollTo(0, 0);
        });
        await page.evaluate((s) => { try { eval(s); } catch {} }, LAZY_IMAGE_SCRIPT);
        await new Promise(r => setTimeout(r, 500));
        const html = await page.content();
        const sourceURL = page.url();
        slot?.resolve({ html, sourceURL });
      } catch (err) {
        slot?.reject(err);
      } finally {
        pending.delete(request.url);
      }
    },
    failedRequestHandler({ request }, err) {
      const slot = pending.get(request.url);
      slot?.reject(err || new Error(`Crawlee failed for ${request.url}`));
      pending.delete(request.url);
    },
  }, config);

  // keepAlive crawler runs in the background; do not await it.
  crawler.run().catch(e => console.warn('Crawlee: crawler.run() ended —', e?.message || e));
  return crawler;
}

// Render one URL and return { html, sourceURL }. Mirrors the shape the other
// rendering tiers return so callers are engine-agnostic.
export async function scrapeWithCrawlee(url) {
  if (!PuppeteerCrawler) throw new Error('Crawlee not available');
  const c = await getCrawler();
  return new Promise((resolve, reject) => {
    pending.set(url, { resolve, reject });
    c.addRequests([{ url, uniqueKey: `${url}#${Date.now()}` }]).catch(err => {
      pending.delete(url);
      reject(err);
    });
  });
}

// Graceful shutdown for server teardown / tests.
export async function teardownCrawlee() {
  if (crawler) {
    try { await crawler.teardown(); } catch { /* ignore */ }
    crawler = null;
  }
  pending.clear();
}
