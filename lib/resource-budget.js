// lib/resource-budget.js — Centralised resource state for Firecrawl, Gemini, and Puppeteer
// Replaces scattered let-variables and getter/setter exports across scraper.js and analysis.js.
// Single source of truth for "can I use this resource?" and "what happened when I tried?"

export class ResourceBudget {
  constructor({ firecrawlApiKey, monthlyBudget, skipHouses, minGapMs } = {}) {
    this.fcKey = firecrawlApiKey || process.env.FIRECRAWL_API_KEY || '';
    this.monthlyBudget = monthlyBudget || parseInt(process.env.FIRECRAWL_MONTHLY_BUDGET || '200000');
    this.skipSet = new Set(
      (skipHouses || process.env.FIRECRAWL_SKIP_HOUSES || '').split(',').filter(Boolean)
    );
    this.minGap = minGapMs || parseInt(process.env.FIRECRAWL_MIN_GAP_MS || '300');

    // Firecrawl state (was 11 let variables in scraper.js lines 45-55)
    this._fc = {
      creditsUsed: 0,
      exhausted: false,
      exhaustedAt: 0,
      fallbackCount: 0,
      errorCount: 0,
      requestCount: 0,
      temporarilyDown: false,
      downAt: 0,
      consecutive5xx: 0,
      lastError: null,
      lastErrorAt: null,
      lastCallAt: 0,
      // Per-tier credit accounting — see recordFcRequest(tier).
      // Tiers: 'full' (overnight catalogue scrape), 'free-enrichment' (should
      // never have spend), 'status-drift' (hourly daytime sample),
      // 'on-demand' (/api/lot user requests), 'healing' (auto-recovery),
      // 'unknown' (legacy callers that don't pass a tier yet).
      creditsByTier: { full: 0, 'free-enrichment': 0, 'status-drift': 0, 'on-demand': 0, healing: 0, unknown: 0 },
    };

    // Gemini state (was creditExhausted/creditExhaustedAt in analysis.js lines 27-28)
    this._gemini = {
      exhausted: false,
      exhaustedAt: 0,
      callCount: 0,
    };

    // Puppeteer availability
    this.puppeteer = null;

    // Auto-reset timers (consolidates setInterval from analysis.js lines 30-47
    // and the manual checks in scraper.js)
    this._resetTimer = setInterval(() => this._autoReset(), 300000);
  }

  // ══════════════════════════════════════════════════════════
  // Query methods — what the pipeline asks before acting
  // ══════════════════════════════════════════════════════════

  canUseFirecrawl() {
    return !!this.fcKey && !this._fc.exhausted && !this._isDown();
  }

  canUseGemini() {
    return !this._gemini.exhausted;
  }

  isSkipped(house) {
    return this.skipSet.has(house);
  }

  hasPuppeteer() {
    return !!this.puppeteer;
  }

  // ══════════════════════════════════════════════════════════
  // Firecrawl outcome recording — called after each request
  // ══════════════════════════════════════════════════════════

  recordFcRequest(tier = 'unknown') {
    this._fc.requestCount++;
    this._fc.creditsUsed++;
    if (this._fc.creditsByTier[tier] == null) this._fc.creditsByTier[tier] = 0;
    this._fc.creditsByTier[tier]++;
  }

  getCreditsByTier() {
    return { ...this._fc.creditsByTier };
  }

  recordFcError(statusCode, err) {
    this._fc.errorCount++;
    this._fc.lastError = err?.message || String(err);
    this._fc.lastErrorAt = new Date().toISOString();

    if (statusCode === 402 || statusCode === 429) {
      this._fc.exhausted = true;
      this._fc.exhaustedAt = Date.now();
      console.log('ResourceBudget: Firecrawl credit/rate limit hit — switching to fallback');
    }

    if (statusCode >= 500) {
      this._fc.consecutive5xx++;
      if (this._fc.consecutive5xx >= 3) {
        this._fc.temporarilyDown = true;
        this._fc.downAt = Date.now();
        console.log('ResourceBudget: Firecrawl 3 consecutive 5xx — marking temporarily down for 10min');
      }
    }
  }

  recordFcSuccess() {
    this._fc.consecutive5xx = 0;
  }

  recordFcFallback() {
    this._fc.fallbackCount++;
  }

  // ══════════════════════════════════════════════════════════
  // Gemini outcome recording
  // ══════════════════════════════════════════════════════════

  recordGeminiCall() {
    this._gemini.callCount++;
  }

  recordGeminiExhausted() {
    this._gemini.exhausted = true;
    this._gemini.exhaustedAt = Date.now();
    console.log('ResourceBudget: Gemini credit exhaustion flagged');
  }

  clearGeminiExhausted() {
    this._gemini.exhausted = false;
    this._gemini.exhaustedAt = 0;
  }

  // ══════════════════════════════════════════════════════════
  // Rate limiter (was firecrawlRateLimited in scraper.js)
  // ══════════════════════════════════════════════════════════

  async rateLimitedFc(fn) {
    const now = Date.now();
    const earliest = this._fc.lastCallAt + this.minGap;
    const wait = Math.max(0, earliest - now);
    this._fc.lastCallAt = now + wait;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    return fn();
  }

  // ══════════════════════════════════════════════════════════
  // Status — for /api/cost-monitor and admin endpoints
  // Backward-compatible with getFirecrawlStatus() shape
  // ══════════════════════════════════════════════════════════

  getStatus() {
    return {
      firecrawl: {
        creditsUsed: this._fc.creditsUsed,
        creditsByTier: { ...this._fc.creditsByTier },
        creditExhausted: this._fc.exhausted,
        exhaustedAt: this._fc.exhaustedAt,
        fallbackCount: this._fc.fallbackCount,
        errorCount: this._fc.errorCount,
        requestCount: this._fc.requestCount,
        temporarilyDown: this._fc.temporarilyDown,
        downAt: this._fc.downAt,
        consecutive5xx: this._fc.consecutive5xx,
        lastError: this._fc.lastError,
        lastErrorAt: this._fc.lastErrorAt,
        monthlyBudget: this.monthlyBudget,
      },
      gemini: {
        exhausted: this._gemini.exhausted,
        exhaustedAt: this._gemini.exhaustedAt,
        callCount: this._gemini.callCount,
      },
      puppeteerAvailable: !!this.puppeteer,
    };
  }

  // Backward compat: same shape as old getFirecrawlStatus()
  getFirecrawlStatus() {
    return this.getStatus().firecrawl;
  }

  // ══════════════════════════════════════════════════════════
  // Direct state access — for legacy code during migration
  // These mirror the old getter/setter exports from scraper.js
  // and allow incremental adoption without rewriting all callers at once.
  // ══════════════════════════════════════════════════════════

  isFcCreditExhausted() { return this._fc.exhausted; }
  getFcExhaustedAt() { return this._fc.exhaustedAt; }
  isFcTemporarilyDown() { return this._fc.temporarilyDown; }
  getFcDownAt() { return this._fc.downAt; }
  getFcConsecutive5xx() { return this._fc.consecutive5xx; }
  getFcCreditsUsed() { return this._fc.creditsUsed; }
  getFcFallbackCount() { return this._fc.fallbackCount; }
  getFcErrorCount() { return this._fc.errorCount; }
  getFcRequestCount() { return this._fc.requestCount; }
  getFcLastError() { return this._fc.lastError; }
  getFcLastErrorAt() { return this._fc.lastErrorAt; }

  setFcCreditExhausted(v) { this._fc.exhausted = v; }
  setFcExhaustedAt(v) { this._fc.exhaustedAt = v; }
  setFcCreditsUsed(v) { this._fc.creditsUsed = v; }
  setFcTemporarilyDown(v) { this._fc.temporarilyDown = v; }
  setFcDownAt(v) { this._fc.downAt = v; }
  setFcConsecutive5xx(v) { this._fc.consecutive5xx = v; }

  // Gemini legacy compat
  getCreditExhausted() { return this._gemini.exhausted; }
  setCreditExhausted(v) { this._gemini.exhausted = v; if (!v) this._gemini.exhaustedAt = 0; }
  getCreditExhaustedAt() { return this._gemini.exhaustedAt; }
  setCreditExhaustedAt(v) { this._gemini.exhaustedAt = v; }

  // ══════════════════════════════════════════════════════════
  // Puppeteer init (called after dynamic import resolves)
  // ══════════════════════════════════════════════════════════

  setPuppeteer(p) {
    this.puppeteer = p;
  }

  // ══════════════════════════════════════════════════════════
  // Auto-reset timers (consolidates analysis.js setInterval
  // and the manual checks scattered through the codebase)
  // ══════════════════════════════════════════════════════════

  _isDown() {
    return this._fc.temporarilyDown && Date.now() - this._fc.downAt < 600000;
  }

  _autoReset() {
    // Firecrawl exhaustion: clear after 1 hour
    if (this._fc.exhausted && Date.now() - this._fc.exhaustedAt > 3600000) {
      this._fc.exhausted = false;
      this._fc.exhaustedAt = 0;
      console.log('ResourceBudget: Firecrawl credit exhaustion flag auto-cleared (1h TTL)');
    }
    // Firecrawl temporarily down: clear after 10 minutes
    if (this._fc.temporarilyDown && Date.now() - this._fc.downAt > 600000) {
      this._fc.temporarilyDown = false;
      this._fc.downAt = 0;
      this._fc.consecutive5xx = 0;
      console.log('ResourceBudget: Firecrawl temporarily-down flag auto-cleared (10min TTL)');
    }
    // Gemini exhaustion: clear after 1 hour
    if (this._gemini.exhausted && Date.now() - this._gemini.exhaustedAt > 3600000) {
      this._gemini.exhausted = false;
      this._gemini.exhaustedAt = 0;
      console.log('ResourceBudget: Gemini credit exhaustion flag auto-cleared (1h TTL)');
    }
  }

  // Cleanup for tests or shutdown
  destroy() {
    if (this._resetTimer) {
      clearInterval(this._resetTimer);
      this._resetTimer = null;
    }
  }
}
