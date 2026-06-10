// lib/resource-budget.js — Centralised resource state for Firecrawl, Gemini, and Puppeteer
// Replaces scattered let-variables and getter/setter exports across scraper.js and analysis.js.
// Single source of truth for "can I use this resource?" and "what happened when I tried?"

export class ResourceBudget {
  constructor({ firecrawlApiKey, monthlyBudget, dailyBudget, skipHouses, minGapMs } = {}) {
    this.fcKey = firecrawlApiKey || process.env.FIRECRAWL_API_KEY || '';
    // Default monthly cap = 95000, sized to sit just under the Standard plan
    // (100k credits/month, refresh on the 14th). Set FIRECRAWL_MONTHLY_BUDGET
    // env var to override (lower = throttle earlier; higher only makes sense
    // if the plan has been upgraded).
    this.monthlyBudget = monthlyBudget || parseInt(process.env.FIRECRAWL_MONTHLY_BUDGET || '95000');
    // Daily ceiling guards against campaign-style runaway. Empirically the
    // 2026-04 migration spikes burned 9-11k credits/day for several days
    // before flagging — at 8000/day that pattern would trip the cap on day
    // one and force a manual review. Set FIRECRAWL_DAILY_BUDGET env var
    // to override.
    this.dailyBudget = dailyBudget || parseInt(process.env.FIRECRAWL_DAILY_BUDGET || '8000');
    this.skipSet = new Set(
      (skipHouses || process.env.FIRECRAWL_SKIP_HOUSES || '').split(',').filter(Boolean)
    );
    this.minGap = minGapMs || parseInt(process.env.FIRECRAWL_MIN_GAP_MS || '300');
    // FIRE-1 agent calls (Firecrawl /v2/extract with model='FIRE-1') consume
    // more credits than a basic /scrape because the agent autonomously visits
    // multiple pages. Empirical default = 5×; tune via env var once real spend
    // data lands. Affects the credit accounting only — does not throttle the
    // call itself.
    this.fire1CreditMult = parseInt(process.env.FIRECRAWL_FIRE1_CREDIT_MULT || '5');

    // /v2/scrape with `formats: [{type:'json', schema:...}]` runs an LLM
    // extraction pass server-side and Firecrawl bills it materially higher
    // than a basic markdown/rawHtml scrape. Internal accounting previously
    // booked 1 credit per call regardless of format — the 80%/95% threshold
    // alerts in this file never fired in May 2026 despite the Firecrawl
    // dashboard showing 4–7k credits/day. Conservative default = 5×; revisit
    // once we have a fresh internal-vs-dashboard reconciliation.
    this.jsonExtractCreditMult = parseInt(process.env.FIRECRAWL_JSON_EXTRACT_MULT || '5');

    // Each action / wait sent to /v2/scrape adds roughly one credit on
    // Firecrawl's side (server-rendered page-fetch + browser steps). Internal
    // accounting tracks this so heavy action sequences (image-backfill,
    // scroll-and-execute loops) don't slip through as 1-credit calls.
    this.actionCreditCost = parseInt(process.env.FIRECRAWL_ACTION_CREDIT_COST || '1');

    // Day-of-month the Firecrawl plan refreshes (1-28). Standard plan refreshes
    // on the 14th. Default 0 = "use UTC month boundary" (legacy behaviour),
    // which is wrong-by-a-fortnight for the Standard plan and silently breaks
    // the 80%/95% threshold alerts as the internal counter rolls over before
    // the real plan refresh. Set FIRECRAWL_PLAN_REFRESH_DAY=14 to align.
    const refreshDayRaw = parseInt(process.env.FIRECRAWL_PLAN_REFRESH_DAY || '0', 10);
    this.planRefreshDay = (refreshDayRaw >= 1 && refreshDayRaw <= 28) ? refreshDayRaw : 0;

    // Firecrawl state (was 11 let variables in scraper.js lines 45-55)
    this._fc = {
      creditsUsed: 0,
      // Sum of completed cycles' spend (observability only — never gates).
      lifetimeCreditsUsed: 0,
      // Daily accounting — resets at UTC midnight via _autoReset().
      creditsUsedToday: 0,
      dayStartedAt: this._utcDayKey(),
      // Monthly accounting — used to clear the threshold flags below at the
      // plan-refresh boundary. Format: 'YYYY-MM' (UTC month) or 'YYYY-MM-DD'
      // (plan cycle, when FIRECRAWL_PLAN_REFRESH_DAY is set).
      monthStartedAt: this._planCycleKey(),
      monthlyCapHit: false,
      dailyCapHit: false,
      // Tiered budget alerts — fire once per month at each threshold so we
      // hear about runaway spend before the hard cap is hit. Cleared in
      // _autoReset() at month rollover.
      thresholdAlert80Hit: false,
      thresholdAlert95Hit: false,
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

    // Alert hook — wired by server.js to lib/harness/alert-router.js::fireAlert.
    // Indirection avoids a circular import (resource-budget → alert-router →
    // resource-budget would loop). Stays a no-op until the hook is registered.
    this._alertHook = null;

    // Pipeline-events hook — wired by server.js to
    // lib/pipeline/pipeline-events.js::emitPipelineEvent. Same indirection
    // rationale as _alertHook. Stays a no-op until the hook is registered,
    // so unit tests that don't wire it pay no cost and see no I/O.
    this._eventHook = null;

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
    return !!this.fcKey
      && !this._fc.exhausted
      && !this._isDown()
      && !this._isOverMonthlyCap()
      && !this._isOverDailyCap();
  }

  // Why blocked? Returns a short reason string for logging/alerts.
  whyBlocked() {
    if (!this.fcKey) return 'no-api-key';
    if (this._fc.exhausted) return 'plan-exhausted-by-api';
    if (this._isDown()) return 'temporarily-down';
    if (this._isOverMonthlyCap()) return `monthly-cap-${this._fc.creditsUsed}/${this.monthlyBudget}`;
    if (this._isOverDailyCap()) return `daily-cap-${this._fc.creditsUsedToday}/${this.dailyBudget}`;
    return null;
  }

  _isOverMonthlyCap() {
    return this.monthlyBudget > 0 && this._fc.creditsUsed >= this.monthlyBudget;
  }

  _isOverDailyCap() {
    const staticCap = this.dailyBudget > 0 ? this.dailyBudget : Infinity;
    const cap = Math.min(staticCap, this._dynamicDailyAllowance());
    return cap !== Infinity && this._fc.creditsUsedToday >= cap;
  }

  // ── Dynamic daily pacing ──
  // The flat FIRECRAWL_DAILY_BUDGET (default 8000) never tripped while the
  // 95k monthly budget drained in a fortnight (~7k/day < 8k). Pace each
  // day's allowance against what is actually LEFT in the billing cycle,
  // with 25% burst headroom and a 250-credit floor so a nearly-empty cycle
  // still allows minimal probing (the monthly cap stays the hard stop).
  _cycleDaysRemaining(now = new Date()) {
    const key = this._fc.monthStartedAt; // 'YYYY-MM' or 'YYYY-MM-DD'
    let next;
    if (/^\d{4}-\d{2}$/.test(key)) {
      const [y, m] = key.split('-').map(Number);
      next = Date.UTC(y, m, 1); // first of the following month (m is 1-based)
    } else {
      const [y, m, d] = key.split('-').map(Number);
      next = Date.UTC(y, m, d); // same refresh day, next month (m is 1-based)
    }
    return Math.max(1, Math.ceil((next - now.getTime()) / 86400000));
  }

  _dynamicDailyAllowance(now = new Date()) {
    if (!(this.monthlyBudget > 0)) return Infinity;
    const remaining = this.monthlyBudget - this._fc.creditsUsed;
    if (remaining <= 0) return 0;
    return Math.max(250, Math.floor((remaining / this._cycleDaysRemaining(now)) * 1.25));
  }

  // ISO timestamp of the current billing-cycle start — used by hydration.
  _cycleStartIso() {
    const key = this._fc.monthStartedAt;
    return /^\d{4}-\d{2}$/.test(key) ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`;
  }

  // Rehydrate cycle + today spend from pipeline_events (each 'firecrawl_call'
  // row carries weight = booked credits). The in-memory counters die on every
  // deploy/restart — without this, the monthly cap compared the real plan
  // against a freshly-zeroed counter and the 80/95/100% alerts never fired
  // (root cause of the May–June 2026 blown budget). Best-effort: needs the
  // fc_cycle_spend() SQL function; on failure, logs and keeps zeroed counters.
  async hydrateFcSpend(supabaseClient) {
    if (!supabaseClient) return null;
    const [cycle, today] = await Promise.all([
      supabaseClient.rpc('fc_cycle_spend', { since: this._cycleStartIso() }),
      supabaseClient.rpc('fc_cycle_spend', { since: `${this._utcDayKey()}T00:00:00Z` }),
    ]);
    if (cycle.error || today.error) throw new Error((cycle.error || today.error).message);
    const cycleCredits = Math.max(0, Math.floor(Number(cycle.data) || 0));
    const todayCredits = Math.max(0, Math.floor(Number(today.data) || 0));
    // max() so a hydration race with live booking can't shrink recorded spend.
    this._fc.creditsUsed = Math.max(this._fc.creditsUsed, cycleCredits);
    this._fc.creditsUsedToday = Math.max(this._fc.creditsUsedToday, todayCredits);
    return { cycleCredits, todayCredits };
  }

  _utcDayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  _utcMonthKey() {
    return new Date().toISOString().slice(0, 7);
  }

  // Plan-cycle key — identifies which billing cycle "now" falls into. With
  // planRefreshDay=0 (default), behaves identically to _utcMonthKey() so
  // existing tests and behaviour are unchanged. With planRefreshDay=N (e.g.
  // 14 for the Firecrawl Standard plan), the cycle key advances on day N
  // instead of day 1 — so the internal monthly counter and threshold alerts
  // align with the plan's real refresh schedule.
  _planCycleKey() {
    if (!this.planRefreshDay) return this._utcMonthKey();
    const now = new Date();
    const day = now.getUTCDate();
    let cycleYear = now.getUTCFullYear();
    let cycleMonth = now.getUTCMonth(); // 0-based
    if (day < this.planRefreshDay) {
      // Still inside the cycle that started in the previous month.
      cycleMonth -= 1;
      if (cycleMonth < 0) { cycleMonth = 11; cycleYear -= 1; }
    }
    const mm = String(cycleMonth + 1).padStart(2, '0');
    const dd = String(this.planRefreshDay).padStart(2, '0');
    return `${cycleYear}-${mm}-${dd}`;
  }

  // Register the alert hook. Called once during server startup, after
  // initAlerts(supabase) has prepared the alert router.
  setAlertHook(fn) {
    this._alertHook = typeof fn === 'function' ? fn : null;
  }

  _fireAlert(payload) {
    if (this._alertHook) {
      try { this._alertHook(payload); } catch (e) {
        console.warn('ResourceBudget: alert hook threw —', e?.message || e);
      }
    }
  }

  // Register the pipeline-events hook. Called once during server startup,
  // wired to lib/pipeline/pipeline-events.js::emitPipelineEvent so each
  // booked Firecrawl call lands as a 'firecrawl_call' row in pipeline_events.
  // Best-effort: hook errors are swallowed — observability is a side channel,
  // never load-bearing for scrape correctness.
  setEventHook(fn) {
    this._eventHook = typeof fn === 'function' ? fn : null;
  }

  _fireEvent(payload) {
    if (!this._eventHook) return;
    try {
      const res = this._eventHook(payload);
      // Tolerate async hooks — swallow rejections so the budget call
      // never sees them. emitPipelineEvent() returns a Promise.
      if (res && typeof res.catch === 'function') {
        res.catch(e => console.warn('ResourceBudget: event hook rejected —', e?.message || e));
      }
    } catch (e) {
      console.warn('ResourceBudget: event hook threw —', e?.message || e);
    }
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

  recordFcRequest(tier = 'unknown', weight = 1, eventMeta = null) {
    // Roll daily counter at UTC midnight before booking the new request.
    const today = this._utcDayKey();
    if (today !== this._fc.dayStartedAt) {
      this._fc.dayStartedAt = today;
      this._fc.creditsUsedToday = 0;
      this._fc.dailyCapHit = false;
    }
    // Roll monthly counter / clear threshold flags at the plan-refresh
    // boundary (or UTC month boundary if FIRECRAWL_PLAN_REFRESH_DAY unset).
    const cycle = this._planCycleKey();
    if (cycle !== this._fc.monthStartedAt) {
      this._fc.monthStartedAt = cycle;
      this._fc.monthlyCapHit = false;
      this._fc.thresholdAlert80Hit = false;
      this._fc.thresholdAlert95Hit = false;
      // New billing cycle: bank the finished cycle into lifetime and zero the
      // per-cycle counters. (Before 2026-06-10 creditsUsed was never reset,
      // which latched _isOverMonthlyCap() until the next deploy — and each
      // deploy zeroed it, so the cap never reflected real cycle spend.)
      this._fc.lifetimeCreditsUsed += this._fc.creditsUsed;
      this._fc.creditsUsed = 0;
      for (const k of Object.keys(this._fc.creditsByTier)) this._fc.creditsByTier[k] = 0;
    }
    const w = Math.max(1, Math.floor(weight));
    this._fc.requestCount++;
    this._fc.creditsUsed += w;
    this._fc.creditsUsedToday += w;
    if (this._fc.creditsByTier[tier] == null) this._fc.creditsByTier[tier] = 0;
    this._fc.creditsByTier[tier] += w;

    // First-trip logging — emits exactly once per day / per cycle so logs
    // don't get spammed.
    if (this._isOverDailyCap() && !this._fc.dailyCapHit) {
      this._fc.dailyCapHit = true;
      console.warn(`ResourceBudget: Firecrawl DAILY cap hit — ${this._fc.creditsUsedToday}/${this.dailyBudget}. Falling back to Puppeteer/HTTP for the rest of today.`);
    }

    // Tiered monthly budget alerts — 80% (warning), 95% (error). Each fires
    // exactly once per calendar month so the operator hears about runaway
    // spend before the hard cap is reached. Hard cap (100%) is logged below
    // and additionally fires an error-level alert.
    if (this.monthlyBudget > 0) {
      const used = this._fc.creditsUsed;
      const cap = this.monthlyBudget;
      if (!this._fc.thresholdAlert80Hit && used >= Math.floor(cap * 0.8)) {
        this._fc.thresholdAlert80Hit = true;
        this._fireAlert({
          type: 'firecrawl_budget_threshold',
          severity: 'warning',
          house: null,
          message: `Firecrawl monthly spend at 80% (${used}/${cap})`,
          meta: { creditsUsed: used, monthlyBudget: cap, threshold: 80 },
        });
      }
      if (!this._fc.thresholdAlert95Hit && used >= Math.floor(cap * 0.95)) {
        this._fc.thresholdAlert95Hit = true;
        this._fireAlert({
          type: 'firecrawl_budget_threshold',
          severity: 'error',
          house: null,
          message: `Firecrawl monthly spend at 95% (${used}/${cap})`,
          meta: { creditsUsed: used, monthlyBudget: cap, threshold: 95 },
        });
      }
    }

    if (this._isOverMonthlyCap() && !this._fc.monthlyCapHit) {
      this._fc.monthlyCapHit = true;
      console.warn(`ResourceBudget: Firecrawl MONTHLY cap hit — ${this._fc.creditsUsed}/${this.monthlyBudget}. Falling back until next billing cycle.`);
      this._fireAlert({
        type: 'firecrawl_budget_threshold',
        severity: 'error',
        house: null,
        message: `Firecrawl monthly cap hit (${this._fc.creditsUsed}/${this.monthlyBudget}) — falling back to Puppeteer/HTTP until billing cycle reset`,
        meta: { creditsUsed: this._fc.creditsUsed, monthlyBudget: this.monthlyBudget, threshold: 100 },
      });
    }

    // Per-call telemetry — emit one 'firecrawl_call' row per booked request
    // when the caller supplies an eventMeta with at minimum an `endpoint`.
    // Callers that don't pass eventMeta (legacy and unit-test paths) pay
    // zero cost — _fireEvent short-circuits when no hook is wired.
    if (eventMeta && eventMeta.endpoint) {
      const url = eventMeta.url != null ? String(eventMeta.url).slice(0, 256) : null;
      this._fireEvent({
        source: 'resource-budget.recordFcRequest',
        eventType: 'firecrawl_call',
        eventData: {
          endpoint: String(eventMeta.endpoint),
          caller: eventMeta.caller ? String(eventMeta.caller) : 'unknown',
          outcome: eventMeta.outcome ? String(eventMeta.outcome) : 'success',
          weight: w,
          tier: String(tier),
          url,
          elapsedMs: typeof eventMeta.elapsedMs === 'number' ? eventMeta.elapsedMs : 0,
        },
      });
    }
  }

  // Records a Firecrawl FIRE-1 agent call. Credits are multiplied by
  // fire1CreditMult (default 5×) so the monthly budget reflects real spend.
  recordFcAgentRequest(tier = 'unknown', eventMeta = null) {
    this.recordFcRequest(tier, this.fire1CreditMult, eventMeta);
  }

  // Records a Firecrawl /v2/map call. The map endpoint is billed at 1 credit
  // per call. Previously mapSiteUrls() in lib/scraper/firecrawl.js issued
  // these without ever calling into the budget — a silent drain that left
  // BUDGET-FC log lines out of sync with the dashboard.
  recordFcMapRequest(tier = 'unknown', eventMeta = null) {
    this.recordFcRequest(tier, 1, eventMeta);
  }

  // Records a Firecrawl /v1/search query. Search is billed at ~1 credit per
  // query — previously these calls (issued by lib/pipeline/healing.js
  // _webSearchForCatalogue) were not booked into the local counter, leaving a
  // silent drain that never showed up in BUDGET-FC log lines.
  recordFcSearchRequest(tier = 'unknown') {
    this.recordFcRequest(tier, 1);
  }

  // Compute weighted credit cost for one /v2/scrape call.
  //   - JSON-extract scrapes bill higher (LLM extraction server-side).
  //   - Each browser action / wait adds an additional credit.
  //   - changeTracking 'same' short-circuits server-side; Firecrawl bills
  //     it as a basic scrape regardless of requested formats, so callers
  //     should pass jsonExtract=false for that outcome.
  computeScrapeWeight({ jsonExtract = false, actionCount = 0 } = {}) {
    const base = jsonExtract ? this.jsonExtractCreditMult : 1;
    const actions = Math.max(0, actionCount | 0) * this.actionCreditCost;
    return base + actions;
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
        creditsUsedToday: this._fc.creditsUsedToday,
        dayStartedAt: this._fc.dayStartedAt,
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
        dailyBudget: this.dailyBudget,
        lifetimeCreditsUsed: this._fc.lifetimeCreditsUsed,
        planRefreshDay: this.planRefreshDay,
        monthStartedAt: this._fc.monthStartedAt,
        dynamicDailyAllowance: Number.isFinite(this._dynamicDailyAllowance()) ? this._dynamicDailyAllowance() : null,
        monthlyCapHit: this._fc.monthlyCapHit,
        dailyCapHit: this._fc.dailyCapHit,
        jsonExtractCreditMult: this.jsonExtractCreditMult,
        actionCreditCost: this.actionCreditCost,
        fire1CreditMult: this.fire1CreditMult,
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
    // Daily counter rollover at UTC midnight (covers quiet days where
    // recordFcRequest doesn't fire to do its own rollover check).
    const today = this._utcDayKey();
    if (today !== this._fc.dayStartedAt) {
      this._fc.dayStartedAt = today;
      this._fc.creditsUsedToday = 0;
      this._fc.dailyCapHit = false;
    }
    // Plan-cycle rollover (matches the daily pattern above).
    const cycle = this._planCycleKey();
    if (cycle !== this._fc.monthStartedAt) {
      this._fc.monthStartedAt = cycle;
      this._fc.monthlyCapHit = false;
      this._fc.thresholdAlert80Hit = false;
      this._fc.thresholdAlert95Hit = false;
      this._fc.lifetimeCreditsUsed += this._fc.creditsUsed;
      this._fc.creditsUsed = 0;
      for (const k of Object.keys(this._fc.creditsByTier)) this._fc.creditsByTier[k] = 0;
    }
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
