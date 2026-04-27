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
