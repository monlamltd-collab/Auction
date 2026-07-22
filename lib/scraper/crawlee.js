// ═══════════════════════════════════════════════════════════════
// lib/scraper/crawlee.js — Crawlee render tier (self-hosted, cheap).
//
// A render-only adapter that mirrors the scrapeRenderedPage contract
// ({ html, sourceURL }) so the engine router can route a house through
// Crawlee instead of Firecrawl. Extraction still happens upstream via
// the Gemini path — Crawlee renders, Gemini reads. On the handful of hosts
// listed in IN_PAGE_PAGINATORS the result also carries `inPageData`: compact
// records walked out of the site's own paged JSON endpoint from inside the
// cleared browser session (see that block for why it cannot be done outside).
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

import { HEADERS, renderConcurrency } from '../config.js';
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

// Houses whose catalogue loads its full lot set behind an in-page click —
// either a "Load more" button that appends pages (admin-ajax), or a page-size
// toggle that re-renders the whole book — which scrolling alone never reveals.
// The render clicks it before capturing HTML. Keyed by hostname so it
// generalises across sibling sites on the same platform.
//   selector  CSS selector for the clickable element (REQUIRED).
//   text      if set, pick the matching element whose trimmed text === this
//             (CSS can't match by text — SDL's options are 12/24/36/48/All).
//   once      true → click exactly once (a non-vanishing toggle). Default is
//             click-to-exhaustion (≤30×) for a button that disappears when done.
//   waitMs    pause after each click (default 900ms); use a longer value when a
//             single click triggers a large AJAX re-render.
// Verified 2026-06-13: Bond Wolfe needs 7 clicks to surface all 88 lots.
// Verified 2026-06-27: SDL Auctions /search/ defaults to 12 lots; one click on
// the "All" page-size link re-POSTs ajaxProp and injects the full ~186-lot book.
const CLICK_TO_LOAD_SELECTORS = [
  { host: /(?:^|\.)bondwolfe\.com$/i, selector: '#tjdPropertyLoadMore' },
  { host: /(?:^|\.)sdlauctions\.co\.uk$/i, selector: 'a.pageLimit', text: 'All', once: true, waitMs: 9000 },
];
export function clickToLoadEntryFor(url) {
  try {
    const host = new URL(url).hostname;
    return CLICK_TO_LOAD_SELECTORS.find(e => e.host.test(host)) || null;
  } catch { return null; }
}

// ── In-page JSON paginators (host-gated) ──────────────────────────────────
//
// A catalogue can be BOTH Cloudflare-protected — a datacenter fetch gets a 403
// "Just a moment" interstitial — AND paginated far beyond MAX_PUPPETEER_PAGES
// (Pattinson: 90 pages × 20 lots). Rendering every page is impossible on both
// counts: the page cap allows 15, and 90 sequential CF-solving renders would
// blow the render deadline anyway.
//
// The escape hatch: render the FIRST page once (which clears Cloudflare and
// leaves a warm session), then walk the site's OWN paged JSON endpoint from
// INSIDE that page context. The cf_clearance cookie is HttpOnly and bound to
// the browser's TLS/JS fingerprint, so it cannot be lifted out to a node
// fetch — the walk has to happen in-page. What comes back is compact records,
// NOT raw HTML: Pattinson's pages are ~1.5MB each and strip to only 1.32MB
// (the bulk is inline card markup, not script), so concatenating 90 of them
// would be ~117MB and OOM the worker. The JSON envelope is ~66KB/page.
//
// Host-keyed exactly like CLICK_TO_LOAD_SELECTORS above — a house that isn't
// listed here can never enter this branch, so the blast radius is one host.
// The MECHANICS are house-agnostic (walk a paged JSON envelope); only the
// endpoint/body/field-name CONFIG is per-host, mirroring how a click-to-load
// entry carries only a CSS selector.
//
//   endpoint     same-origin path of the paged JSON endpoint (REQUIRED)
//   method       HTTP verb (default 'POST')
//   body         request-body template; `pageParam` is overwritten per page
//   pageParam    key in `body` carrying the 1-based page number
//   envelope     dotted path from the JSON root to the paged envelope object
//   itemsKey     array field on the envelope holding this page's records
//   pageCountKey field on the envelope holding the authoritative page total
//   totalKey     field on the envelope holding the record total (audit only)
//   maxPages     hard cap so a pathological site can never spin forever
//   concurrency  pages fetched in parallel per batch
//   budgetMs     wall-clock budget for the whole walk (render-deadline guard)
//
// Verified live 2026-07-21: an in-page POST to Pattinson's own
// /api/property/list-search returns 200 with the full 20-item page in a
// cleared session, while the identical POST from node gets the CF 403. The
// endpoint REJECTS a partial body with HTTP 400, so the template below is the
// exact payload the site's own client sends (includeCommercial:false silently
// drops 403 lots — do not "tidy" these fields away).
const PATTINSON_LIST_SEARCH_BODY = Object.freeze({
  view: 'list', query: null, bbox: null, drawnArea: null, sort: 'Recent', p: 1, radius: 0,
  propertyTypes: [], parkingTypes: [], bedroomsFrom: 0, bedroomsTo: 9007199254740991,
  priceFrom: 0, priceTo: 9007199254740991, receptionsFrom: 0, receptionsTo: 9007199254740991,
  centralHeatingType: null, hasGarden: null, newBuild: null, isRetirementProperty: null,
  includeCommercial: true, includeAuctions: true, hasLand: null, requiresUpdating: null,
  requiresWork: null, includeUnderOffer: false, tenure: null, searchType: null,
  businessType: null, furnishRequirement: 'Any', areaId: null, searchId: null, st: 'auction',
});

const IN_PAGE_PAGINATORS = [
  {
    host: /(?:^|\.)pattinson\.co\.uk$/i,
    endpoint: '/api/property/list-search',
    method: 'POST',
    body: PATTINSON_LIST_SEARCH_BODY,
    pageParam: 'p',
    envelope: 'properties.results',
    itemsKey: 'items',
    pageCountKey: 'pageCount',
    totalKey: 'totalItemCount',
    maxPages: 150,      // 3,000 records — far beyond the ~1,800-lot live book
    concurrency: 3,
    budgetMs: 55000,    // leaves headroom inside requestHandlerTimeoutSecs (90)
  },
];

/** The in-page paginator config for a URL's host, or null. Never throws. */
export function inPagePaginatorFor(url) {
  try {
    const host = new URL(url).hostname;
    return IN_PAGE_PAGINATORS.find(e => e.host.test(host)) || null;
  } catch { return null; }
}

/**
 * Walk a paged JSON endpoint and return its records.
 *
 * Runs in PAGE CONTEXT via page.evaluate (puppeteer serialises the source), so
 * it must reference nothing outside its own body. Exported so the pagination,
 * early-stop, dedup and budget logic are unit-testable against a stubbed
 * `fetch` without launching Chromium.
 *
 * Never throws: a failure is reported on the returned `error`/`stopped` fields
 * alongside whatever records were already collected, so the caller can decide
 * between "partial" and "broken" rather than losing the run.
 *
 * @param {object} cfg - an IN_PAGE_PAGINATORS entry (host is ignored here)
 * @returns {Promise<{items: Array, pageCount: number|null, total: number|null,
 *   fetched: number, stopped: string, error: string|null, elapsedMs: number}>}
 */
export async function collectPagedJson(cfg) {
  const startedAt = Date.now();
  const out = { items: [], pageCount: null, total: null, fetched: 0, stopped: '', error: null, elapsedMs: 0 };
  const seen = new Set();
  const budgetMs = cfg.budgetMs || 55000;
  const maxPages = cfg.maxPages || 50;
  const concurrency = Math.max(1, cfg.concurrency || 1);

  const readEnvelope = (json) => {
    let node = json;
    for (const key of String(cfg.envelope || '').split('.').filter(Boolean)) {
      if (node == null || typeof node !== 'object') return null;
      node = node[key];
    }
    return (node && typeof node === 'object') ? node : null;
  };

  const fetchPageN = async (n) => {
    const res = await fetch(cfg.endpoint, {
      method: cfg.method || 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...cfg.body, [cfg.pageParam]: n }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${cfg.pageParam}=${n}`);
    const env = readEnvelope(await res.json());
    if (!env) throw new Error(`no envelope at "${cfg.envelope}" on ${cfg.pageParam}=${n}`);
    return env;
  };

  // Absorb one page's records; returns how many were NEW. Dedup is by the
  // record's own id so an unstable sort (a re-ranked page between requests)
  // can never double-count, and a server that clamps an over-range page to the
  // last one can never loop forever.
  const absorb = (env) => {
    const batch = Array.isArray(env[cfg.itemsKey]) ? env[cfg.itemsKey] : [];
    let added = 0;
    for (const item of batch) {
      const id = item && item.id != null ? String(item.id) : null;
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.items.push(item);
      added++;
    }
    return { size: batch.length, added };
  };

  try {
    // Page 1 first: it carries the authoritative page count, so the rest of
    // the walk is bounded by the SOURCE rather than by blind probing.
    const first = await fetchPageN(1);
    out.fetched = 1;
    if (typeof first[cfg.pageCountKey] === 'number') out.pageCount = first[cfg.pageCountKey];
    if (typeof first[cfg.totalKey] === 'number') out.total = first[cfg.totalKey];
    const firstBatch = absorb(first);
    if (firstBatch.size === 0) { out.stopped = 'empty_first_page'; return out; }

    const last = Math.min(out.pageCount || maxPages, maxPages);
    for (let page = 2; page <= last;) {
      if (Date.now() - startedAt > budgetMs) { out.stopped = 'budget'; break; }
      const batchPages = [];
      for (let k = 0; k < concurrency && page <= last; k++, page++) batchPages.push(page);
      const envs = await Promise.all(batchPages.map(fetchPageN));
      out.fetched += envs.length;
      let addedInBatch = 0, sizeInBatch = 0;
      for (const env of envs) {
        const r = absorb(env);
        addedInBatch += r.added;
        sizeInBatch += r.size;
      }
      // Early stop: a batch that returned no records at all is past the end of
      // the catalogue; a batch that returned records but no NEW ids means the
      // server is repeating a page (dedup saturation) — either way, stop.
      if (sizeInBatch === 0) { out.stopped = 'empty_page'; break; }
      if (addedInBatch === 0) { out.stopped = 'no_new_ids'; break; }
    }
    if (!out.stopped) out.stopped = 'page_count';
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
    out.stopped = out.stopped || 'error';
  }
  out.elapsedMs = Date.now() - startedAt;
  return out;
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
// Memory telemetry: one compact line every N renders so Railway logs show the
// actual headroom the raised render ceiling (renderConcurrency) is running
// with — the evidence for tuning CRAWLEE_MAX_CONCURRENCY up or down.
let _renderCount = 0;
const MEM_LOG_EVERY = 25;

// Per-request hard timeout. Covers two distinct hangs: (a) queue starvation —
// the request never reaches a crawler slot because the whole fleet shares
// one bounded pool (renderConcurrency(), config.js); (b) a request that dies without the requestHandler or
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

  const maxConcurrency = renderConcurrency();
  console.log(`Crawlee: launching crawler — render ceiling ${maxConcurrency} (CRAWLEE_MAX_CONCURRENCY), memory budget ${process.env.CRAWLEE_MEMORY_MBYTES || 'auto (cgroup-detected)'} MB; AutoscaledPool governs actual concurrency beneath the ceiling`);

  crawler = new PuppeteerCrawler({
    keepAlive: true,                 // long-lived; serves requests as they arrive
    // Shared ceiling with the puppeteer.js fallback gate — see
    // renderConcurrency() in lib/config.js (Phase 3: was hard-coded 3).
    maxConcurrency,
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
        // Host-gated in-page JSON paginator (see IN_PAGE_PAGINATORS). The
        // render's only job on these hosts is to clear Cloudflare and hand the
        // walk a warm session — every lot then arrives as compact JSON, so the
        // lazy-image scroll below is pure cost and is skipped.
        const paginator = inPagePaginatorFor(request.url);
        let inPageData = null;
        if (paginator) {
          try {
            inPageData = await page.evaluate(collectPagedJson, paginator);
            console.log(`Crawlee: in-page paginator ${new URL(request.url).hostname} → ${inPageData.items.length} records from ${inPageData.fetched}/${inPageData.pageCount ?? '?'} pages in ${inPageData.elapsedMs}ms (stopped: ${inPageData.stopped}${inPageData.error ? `, error: ${inPageData.error}` : ''})`);
          } catch (err) {
            // Never fail the render over the paginator — the caller decides
            // what an empty/partial walk means (silent failures are banned).
            inPageData = { items: [], pageCount: null, total: null, fetched: 0, stopped: 'evaluate_failed', error: err.message, elapsedMs: 0 };
            console.warn(`Crawlee: in-page paginator failed for ${request.url}: ${err.message}`);
          }
        } else {
          await page.evaluate(async () => {
            for (let i = 0; i < 8; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 600)); }
            window.scrollTo(0, 0);
          });
        }
        // Exhaust an in-page "Load more" button (e.g. Bond Wolfe) so every lot
        // is in the DOM before we capture HTML. Bounded (30 clicks) so a runaway
        // button can't blow the 90s handler timeout.
        const loadMore = clickToLoadEntryFor(request.url);
        if (loadMore) {
          await page.evaluate(async (entry) => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const pick = () => {
              const els = [...document.querySelectorAll(entry.selector)];
              return entry.text ? els.find(e => (e.textContent || '').trim() === entry.text) : els[0];
            };
            const maxClicks = entry.once ? 1 : 30;
            for (let i = 0; i < maxClicks; i++) {
              const b = pick();
              if (!b || b.offsetParent === null || getComputedStyle(b).display === 'none') break;
              b.click();
              await sleep(entry.waitMs || 900);
            }
          }, loadMore);
        }
        await page.evaluate((s) => { try { eval(s); } catch {} }, LAZY_IMAGE_SCRIPT);
        await new Promise(r => setTimeout(r, 500));
        const html = await page.content();
        const sourceURL = page.url();
        slot?.resolve({ html, sourceURL, inPageData });
      } catch (err) {
        slot?.reject(err);
      } finally {
        pending.delete(request.uniqueKey);
        if (++_renderCount % MEM_LOG_EVERY === 0) {
          const mu = process.memoryUsage();
          console.log(`Crawlee: mem after ${_renderCount} renders — rss=${Math.round(mu.rss / 1048576)}MB heapUsed=${Math.round(mu.heapUsed / 1048576)}MB pending=${pending.size} ceiling=${renderConcurrency()}`);
        }
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
