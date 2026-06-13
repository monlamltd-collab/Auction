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
// Fleet-robustness hardening (2026-06-11):
//   * Crawler death is survivable. If crawler.run() settles (Chromium
//     died, autoscaled pool crashed, keepAlive ended), every in-flight
//     bridge promise is rejected, a `crawlee_crawler_restart` alert is
//     fired, and the singleton is cleared so the NEXT render request
//     transparently launches a fresh crawler. Previously a dead crawler
//     hung every later scrapeWithCrawlee forever (the runbook's answer
//     was "restart the service").
//   * Every bridge promise has a hard timeout (CRAWLEE_REQUEST_TIMEOUT_MS,
//     default 300s). This bounds queue starvation under full-fleet load
//     (N houses sharing 3 crawler slots) and guarantees abandoned callers
//     (processAuction's Promise.race) can't leak `pending` entries.
//   * teardownCrawlee rejects (not silently clears) outstanding promises.
//
// What Crawlee adds over the bare puppeteer.js tier: zero-config
// human-like browser fingerprints (fingerprint-suite), TLS-fingerprint
// replication, session pooling, and proxy rotation — the hardening the
// fallback tier lacks. See docs/ENGINE-ROUTER.md.
// ═══════════════════════════════════════════════════════════════

import { HEADERS } from '../config.js';
import { fireAlert } from '../harness/alert-router.js';

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

// Houses whose catalogue appends lots via an in-page "Load more" button
// (admin-ajax) instead of ?page=N pagination — scrolling alone never reveals
// them. The render clicks the button to exhaustion so every lot is in the
// captured HTML. Keyed by hostname so it generalises across sibling sites on
// the same platform (e.g. other tjd/EIG-AMS WordPress auctioneers). Verified
// 2026-06-13: Bond Wolfe needs 7 clicks to surface all 88 lots.
const CLICK_TO_LOAD_SELECTORS = [
  { host: /(?:^|\.)bondwolfe\.com$/i, selector: '#tjdPropertyLoadMore' },
];
function clickToLoadSelectorFor(url) {
  try {
    const host = new URL(url).hostname;
    const entry = CLICK_TO_LOAD_SELECTORS.find(e => e.host.test(host));
    return entry ? entry.selector : null;
  } catch { return null; }
}

let crawler = null;
// Generation counter: identifies WHICH crawler instance a run()-settled
// callback belongs to, so a stale instance's death (or a teardown) can't
// clobber a newer crawler or double-reject its pending promises.
let _crawlerGen = 0;
// Maps a request uniqueKey (NOT the raw URL) to the { resolve, reject } of the
// caller awaiting it. Keying by URL collided when two callers requested the
// same URL concurrently (cron + on-demand) — the second overwrote the first,
// whose promise then never settled. PR #67 review F7.
const pending = new Map();
let _seq = 0;

// Per-request hard timeout. Covers two distinct hangs: (a) queue starvation —
// the request never reaches a crawler slot because the whole fleet shares
// maxConcurrency 3; (b) a request that dies without the requestHandler or
// failedRequestHandler ever settling the bridge (e.g. browser-pool crash mid
// navigation). 300s default = 2 attempts × 90s handler timeout + generous
// queue wait, still far under CRAWLEE_HOUSE_TIMEOUT_MS (600s).
function requestTimeoutMs() {
  return parseInt(process.env.CRAWLEE_REQUEST_TIMEOUT_MS || '300000');
}

export function hasCrawlee() {
  return !!PuppeteerCrawler;
}

// Reject and clear every pending bridge promise (crawler death / teardown).
function rejectAllPending(err) {
  for (const [key, slot] of [...pending]) {
    pending.delete(key);
    try { slot.reject(err); } catch { /* settled elsewhere */ }
  }
}

// A crawler instance's run() settled. For the CURRENT instance that means the
// engine is dead (Chromium crash, pool failure, unexpected keepAlive end):
// fail everything in flight loudly, clear the singleton so the next render
// launches a fresh crawler, and leave an audit trail in pipeline_alerts.
function _onCrawlerEnded(gen, err) {
  if (gen !== _crawlerGen) return; // superseded instance or explicit teardown
  const reason = err?.message || String(err || 'crawler.run() returned unexpectedly');
  const inflight = pending.size;
  console.warn(`Crawlee: crawler died (${reason}) — rejecting ${inflight} in-flight render(s); a fresh crawler will launch on the next request`);
  crawler = null;
  rejectAllPending(new Error(`Crawlee crawler died: ${reason}`));
  try {
    const p = fireAlert({
      type: 'crawlee_crawler_restart',
      severity: 'warning',
      house: null,
      message: `Crawlee crawler died (${reason}); ${inflight} in-flight render(s) failed. It will relaunch automatically on the next render request.`,
      meta: { reason, inflight },
    });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* observability must not break recovery */ }
}

async function getCrawler() {
  if (!PuppeteerCrawler) throw new Error('Crawlee not available');
  if (crawler) return crawler;

  // In-memory, non-persistent storage: Railway's filesystem is ephemeral and
  // we never want one scrape's queue surviving into the next.
  const config = Configuration ? new Configuration({ persistStorage: false }) : undefined;

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
      const slot = pending.get(request.uniqueKey);
      try {
        await page.setUserAgent(HEADERS['User-Agent']);
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(request.url, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.evaluate(async () => {
          for (let i = 0; i < 8; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 600)); }
          window.scrollTo(0, 0);
        });
        // Exhaust an in-page "Load more" button (e.g. Bond Wolfe) so every lot
        // is in the DOM before we capture HTML. Bounded (30 clicks) so a runaway
        // button can't blow the 90s handler timeout.
        const loadMoreSel = clickToLoadSelectorFor(request.url);
        if (loadMoreSel) {
          await page.evaluate(async (sel) => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            for (let i = 0; i < 30; i++) {
              const b = document.querySelector(sel);
              if (!b || b.offsetParent === null || getComputedStyle(b).display === 'none') break;
              b.click();
              await sleep(900);
            }
          }, loadMoreSel);
        }
        await page.evaluate((s) => { try { eval(s); } catch {} }, LAZY_IMAGE_SCRIPT);
        await new Promise(r => setTimeout(r, 500));
        const html = await page.content();
        const sourceURL = page.url();
        slot?.resolve({ html, sourceURL });
      } catch (err) {
        slot?.reject(err);
      } finally {
        pending.delete(request.uniqueKey);
      }
    },
    failedRequestHandler({ request }, err) {
      const slot = pending.get(request.uniqueKey);
      slot?.reject(err || new Error(`Crawlee failed for ${request.url}`));
      pending.delete(request.uniqueKey);
    },
  }, config);

  // keepAlive crawler runs in the background; do not await it. If it ever
  // settles — resolve OR reject — the engine is gone: recover via the death
  // handler instead of letting every later scrapeWithCrawlee hang.
  const gen = ++_crawlerGen;
  crawler.run().then(
    () => _onCrawlerEnded(gen, null),
    (e) => _onCrawlerEnded(gen, e),
  );
  return crawler;
}

// Render one URL and return { html, sourceURL }. Mirrors the shape the other
// rendering tiers return so callers are engine-agnostic. opts.timeoutMs
// overrides the CRAWLEE_REQUEST_TIMEOUT_MS bridge timeout (tests, probes).
export async function scrapeWithCrawlee(url, opts = {}) {
  if (!PuppeteerCrawler) throw new Error('Crawlee not available');
  const c = await getCrawler();
  const uniqueKey = `${url}#${Date.now()}#${++_seq}`;
  const ms = opts.timeoutMs || requestTimeoutMs();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Only reject if WE still own the slot — the handler may have settled
      // and deleted it in the same tick.
      if (pending.delete(uniqueKey)) {
        reject(new Error(`Crawlee render timed out after ${Math.round(ms / 1000)}s (queue saturated or page hung): ${url}`));
      }
    }, ms);
    // NOTE: deliberately NOT unref'd — it is always cleared when the promise
    // settles, and an unref'd timer would let the process exit before a
    // genuinely-starved request gets its rejection.
    pending.set(uniqueKey, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    c.addRequests([{ url, uniqueKey }]).catch(err => {
      clearTimeout(timer);
      pending.delete(uniqueKey);
      reject(err);
    });
  });
}

// Graceful shutdown for server teardown / tests. Outstanding renders are
// REJECTED (not silently dropped) so callers fail fast instead of hanging.
export async function teardownCrawlee() {
  _crawlerGen++; // invalidate this instance's death handler — teardown is deliberate
  const c = crawler;
  crawler = null;
  rejectAllPending(new Error('Crawlee crawler torn down'));
  if (c) {
    try { await c.teardown(); } catch { /* ignore */ }
  }
}

// ── Test seams (hand-rolled test suite; no mocking framework) ──
// Inject a fake crawler class so the bridge / death-recovery / timeout logic
// is testable without Chromium. Returns a restore function.
export function __setCrawleeImplForTest({ crawlerClass = null, configurationClass = null } = {}) {
  const prev = { PuppeteerCrawler, Configuration };
  PuppeteerCrawler = crawlerClass;
  Configuration = configurationClass;
  crawler = null;
  _crawlerGen++;
  pending.clear();
  return () => {
    PuppeteerCrawler = prev.PuppeteerCrawler;
    Configuration = prev.Configuration;
    crawler = null;
    _crawlerGen++;
    pending.clear();
  };
}
export function __pendingCountForTest() { return pending.size; }
