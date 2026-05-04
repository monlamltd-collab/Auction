// ═══════════════════════════════════════════════════════════════
// lib/scraper/firecrawl.js — Firecrawl-tier scrape primitive plus
// the budget delegation surface that admin.js / cost-monitor reads.
//
// scrapeWithFirecrawl is the low-level call: rate-limited fetch with
// retry-on-5xx and credit/exhaustion bookkeeping via ResourceBudget.
// scrapePageWithFirecrawl (the multi-page wrapper that calls the
// three-tier orchestrator) lives with scrapeRenderedPage in
// rendering.js because both depend on the orchestrator's fallback.
// ═══════════════════════════════════════════════════════════════

import { getBudget, currentTier } from './state.js';
import { CATALOGUE_SCHEMA, DETAIL_SCHEMA } from './lot-schema.js';

// ── Budget delegation getters/setters — route through state.js's getBudget() ──
// Safe pre-init: return defaults if budget not yet wired (avoids NPE during module load).
export function getFirecrawlStatus() { return getBudget()?.getFirecrawlStatus() ?? { creditsUsed: 0, creditExhausted: false, exhaustedAt: 0, fallbackCount: 0, errorCount: 0, requestCount: 0, temporarilyDown: false, downAt: 0, consecutive5xx: 0, lastError: null, lastErrorAt: null, monthlyBudget: 0 }; }
export function getFcCreditsUsed() { return getBudget()?.getFcCreditsUsed() ?? 0; }
export function isFcCreditExhausted() { return getBudget()?.isFcCreditExhausted() ?? false; }
export function getFcExhaustedAt() { return getBudget()?.getFcExhaustedAt() ?? 0; }
export function isFcTemporarilyDown() { return getBudget()?.isFcTemporarilyDown() ?? false; }
export function getFcDownAt() { return getBudget()?.getFcDownAt() ?? 0; }
export function getFcConsecutive5xx() { return getBudget()?.getFcConsecutive5xx() ?? 0; }
export function getFcFallbackCount() { return getBudget()?.getFcFallbackCount() ?? 0; }
export function getFcErrorCount() { return getBudget()?.getFcErrorCount() ?? 0; }
export function getFcRequestCount() { return getBudget()?.getFcRequestCount() ?? 0; }
export function getFcLastError() { return getBudget()?.getFcLastError() ?? null; }
export function getFcLastErrorAt() { return getBudget()?.getFcLastErrorAt() ?? null; }
export function setFcCreditExhausted(v) { getBudget()?.setFcCreditExhausted(v); }
export function setFcExhaustedAt(v) { getBudget()?.setFcExhaustedAt(v); }
export function setFcCreditsUsed(v) { getBudget()?.setFcCreditsUsed(v); }
export function setFcTemporarilyDown(v) { getBudget()?.setFcTemporarilyDown(v); }
export function setFcDownAt(v) { getBudget()?.setFcDownAt(v); }
export function setFcConsecutive5xx(v) { getBudget()?.setFcConsecutive5xx(v); }

export async function scrapeWithFirecrawl(url, options = {}) {
  if (!getBudget().fcKey) throw new Error('FIRECRAWL_API_KEY not set');
  if (!getBudget().canUseFirecrawl()) {
    if (getBudget().isFcCreditExhausted()) throw new Error('Firecrawl credits exhausted');
    throw new Error('Firecrawl temporarily down');
  }

  const formats = options.formats || ['markdown', 'rawHtml'];
  const body = {
    url,
    formats,
  };
  if (options.waitFor) body.waitFor = options.waitFor;
  if (options.actions) body.actions = options.actions;

  const doFetch = async () => {
    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getBudget().fcKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (resp.status === 402 || resp.status === 429) {
      getBudget().recordFcError(resp.status, new Error(`Firecrawl ${resp.status}: credits/rate exhausted`));
      throw new Error(`Firecrawl ${resp.status}: credits/rate exhausted`);
    }

    if (resp.status >= 500) {
      getBudget().recordFcError(resp.status, new Error(`Firecrawl ${resp.status}: server error`));
      throw new Error(`Firecrawl ${resp.status}: server error`);
    }

    if (!resp.ok) throw new Error(`Firecrawl ${resp.status}: ${await resp.text().catch(() => 'unknown')}`);

    getBudget().recordFcSuccess();
    const data = await resp.json();
    if (!data.success) throw new Error(`Firecrawl returned success=false: ${data.error || 'unknown'}`);

    getBudget().recordFcRequest(currentTier());
    return {
      html: data.data?.rawHtml || data.data?.html || '',
      markdown: data.data?.markdown || '',
      sourceURL: data.data?.metadata?.sourceURL || url,
      images: data.data?.images || [],
    };
  };

  // 1 retry on 5xx/timeout with 2s backoff
  try {
    return await getBudget().rateLimitedFc(doFetch);
  } catch (err) {
    if (/5\d\d|timeout|abort/i.test(err.message)) {
      console.log(`Firecrawl: retrying after error: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        return await getBudget().rateLimitedFc(doFetch);
      } catch (retryErr) {
        getBudget().recordFcError(0, retryErr);
        throw retryErr;
      }
    }
    getBudget().recordFcError(0, err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// Firecrawl-native extraction — JSON schema mode
// ═══════════════════════════════════════════════════════════════

export async function extractCatalogue(url, options = {}) {
  if (!getBudget().fcKey) throw new Error('FIRECRAWL_API_KEY not set');
  if (!getBudget().canUseFirecrawl()) throw new Error('Firecrawl unavailable');

  const formats = [{ type: 'json', schema: CATALOGUE_SCHEMA }, 'markdown'];
  if (options.includeHtml) formats.push('rawHtml');
  if (options.changeTracking) formats.push({ type: 'changeTracking', modes: ['git-diff'] });

  const body = { url, formats };
  if (options.waitFor) body.waitFor = options.waitFor;

  const doFetch = async () => {
    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getBudget().fcKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout || 130000),
    });

    if (resp.status === 402 || resp.status === 429) {
      getBudget().recordFcError(resp.status, new Error(`Firecrawl ${resp.status}`));
      throw new Error(`Firecrawl ${resp.status}: credits/rate exhausted`);
    }
    if (!resp.ok) throw new Error(`Firecrawl ${resp.status}: ${await resp.text().catch(() => '')}`);

    getBudget().recordFcSuccess();
    getBudget().recordFcRequest(currentTier());
    const data = await resp.json();
    if (!data.success) throw new Error(`Firecrawl extract failed: ${data.error || 'unknown'}`);
    return data;
  };

  let data;
  try {
    data = await doFetch();
  } catch (err) {
    if (/fetch failed|socket|timeout|abort|5\d\d/i.test(err.message)) {
      await new Promise(r => setTimeout(r, 2000));
      data = await doFetch();
    } else {
      throw err;
    }
  }

  return {
    lots: data.data?.json?.lots || [],
    auctionDate: data.data?.json?.auction_date || null,
    totalLots: data.data?.json?.total_lots || null,
    changeStatus: data.data?.changeTracking?.changeStatus || null,
    previousScrapeAt: data.data?.changeTracking?.previousScrapeAt || null,
    html: data.data?.rawHtml || '',
  };
}

export async function extractDetail(url, options = {}) {
  if (!getBudget().fcKey) throw new Error('FIRECRAWL_API_KEY not set');
  if (!getBudget().canUseFirecrawl()) throw new Error('Firecrawl unavailable');

  const body = {
    url,
    formats: [{ type: 'json', schema: DETAIL_SCHEMA }],
  };

  const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getBudget().fcKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 60000),
  });

  if (!resp.ok) throw new Error(`Firecrawl ${resp.status}`);

  getBudget().recordFcSuccess();
  getBudget().recordFcRequest(currentTier());
  const data = await resp.json();
  if (!data.success) throw new Error(`Firecrawl detail extract failed: ${data.error || 'unknown'}`);

  return data.data?.json || {};
}

export async function batchExtractCatalogues(urls, options = {}) {
  if (!getBudget().fcKey) throw new Error('FIRECRAWL_API_KEY not set');
  if (!getBudget().canUseFirecrawl()) throw new Error('Firecrawl unavailable');

  const formats = [{ type: 'json', schema: CATALOGUE_SCHEMA }];
  if (options.changeTracking) formats.push({ type: 'changeTracking', modes: ['git-diff'] });

  const body = {
    urls,
    formats,
    ignoreInvalidURLs: true,
  };
  if (options.webhook) body.webhook = options.webhook;

  const resp = await fetch('https://api.firecrawl.dev/v2/batch/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getBudget().fcKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) throw new Error(`Firecrawl batch ${resp.status}: ${await resp.text().catch(() => '')}`);

  const data = await resp.json();
  if (!data.success) throw new Error(`Firecrawl batch failed: ${data.error || 'unknown'}`);

  return { jobId: data.id, totalUrls: urls.length };
}

export async function pollBatchJob(jobId) {
  if (!getBudget().fcKey) throw new Error('FIRECRAWL_API_KEY not set');

  const resp = await fetch(`https://api.firecrawl.dev/v2/batch/scrape/${jobId}`, {
    headers: { 'Authorization': `Bearer ${getBudget().fcKey}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) throw new Error(`Firecrawl poll ${resp.status}`);
  const data = await resp.json();

  return {
    status: data.status,
    completed: data.completed || 0,
    total: data.total || 0,
    results: (data.data || []).map(d => ({
      url: d.metadata?.sourceURL || '',
      lots: d.json?.lots || [],
      auctionDate: d.json?.auction_date || null,
      changeStatus: d.changeTracking?.changeStatus || null,
    })),
  };
}

export async function mapSiteUrls(url, search) {
  if (!getBudget().fcKey) throw new Error('FIRECRAWL_API_KEY not set');

  const resp = await fetch('https://api.firecrawl.dev/v2/map', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getBudget().fcKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, search }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) throw new Error(`Firecrawl map ${resp.status}`);
  const data = await resp.json();
  if (!data.success) throw new Error(`Firecrawl map failed: ${data.error || 'unknown'}`);

  return data.links || [];
}

export async function agentExtract(urls, prompt, schema, options = {}) {
  if (!getBudget().fcKey) throw new Error('FIRECRAWL_API_KEY not set');
  if (!getBudget().canUseFirecrawl()) throw new Error('Firecrawl unavailable');

  const body = {
    urls: Array.isArray(urls) ? urls : [urls],
    prompt,
    schema,
    agent: { model: options.model || 'FIRE-1' },
  };

  // Start the async extract job
  const resp = await fetch('https://api.firecrawl.dev/v2/extract', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getBudget().fcKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (resp.status === 402 || resp.status === 429) {
    // Don't poison the global budget state — agent rate limits are separate from scrape credits
    throw new Error(`Firecrawl agent ${resp.status}: rate limited`);
  }
  if (!resp.ok) throw new Error(`Firecrawl agent ${resp.status}: ${await resp.text().catch(() => '')}`);

  const startData = await resp.json();
  if (!startData.success) throw new Error(`Firecrawl agent start failed: ${startData.error || 'unknown'}`);

  const jobId = startData.id;
  if (!jobId) throw new Error('Firecrawl agent: no job ID returned');

  // Poll until completed
  const timeout = options.timeout || 300000;
  const deadline = Date.now() + timeout;
  const pollInterval = 5000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));

    const pollResp = await fetch(`https://api.firecrawl.dev/v2/extract/${jobId}`, {
      headers: { 'Authorization': `Bearer ${getBudget().fcKey}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();

    if (pollData.status === 'completed') {
      getBudget().recordFcSuccess();
      getBudget().recordFcRequest(currentTier());
      return pollData.data || {};
    }
    if (pollData.status === 'failed' || pollData.status === 'cancelled') {
      throw new Error(`Firecrawl agent ${pollData.status}: ${pollData.error || 'unknown'}`);
    }
  }

  throw new Error('Firecrawl agent: timed out waiting for results');
}
