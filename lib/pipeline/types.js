// lib/pipeline/types.js — Typed errors and events for the modular pipeline
// Each module emits structured events the harness can inspect.

// ── Error types: one per pipeline stage ──

export class ScrapeError extends Error {
  constructor(message, { house, url, method, statusCode, inner } = {}) {
    super(message);
    this.name = 'ScrapeError';
    this.stage = 'scrape';
    this.house = house;
    this.url = url;
    this.method = method;       // 'firecrawl' | 'puppeteer' | 'http'
    this.statusCode = statusCode;
    this.inner = inner;
  }
}

export class ExtractError extends Error {
  constructor(message, { house, strategy, selector, lotCount, inner } = {}) {
    super(message);
    this.name = 'ExtractError';
    this.stage = 'extract';
    this.house = house;
    this.strategy = strategy;   // 'dom' | 'ai' | 'dom+ai'
    this.selector = selector;   // which selector failed (if DOM)
    this.lotCount = lotCount;
    this.inner = inner;
  }
}

export class ScoreError extends Error {
  constructor(message, { house, lotIndex, field, inner } = {}) {
    super(message);
    this.name = 'ScoreError';
    this.stage = 'score';
    this.house = house;
    this.lotIndex = lotIndex;
    this.field = field;
    this.inner = inner;
  }
}

// ── Pipeline event emitter ──

const _listeners = [];

export function onPipelineEvent(fn) {
  _listeners.push(fn);
  return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); };
}

export function emitPipelineEvent(event) {
  const stamped = { ...event, timestamp: Date.now() };
  for (const fn of _listeners) {
    try { fn(stamped); } catch (e) { console.warn('Pipeline event listener error:', e.message); }
  }
  // Bridge to pipeline_events table: persist for observability views.
  // Deferred import to avoid circular dependency at module init time.
  import('./pipeline-events.js').then(mod => {
    const { PIPELINE_EVENT_TYPES: TYPES, buildPipelineEvent, insertPipelineEvents } = mod;
    const row = bridgeInMemoryEvent(stamped, TYPES);
    if (row) insertPipelineEvents([row]);
  }).catch(() => {}); // silent fail — event log is best-effort
  return stamped;
}

/**
 * Map an in-memory pipeline event to a pipeline_events row.
 * Returns null for events that don't map to a known pipeline_events type.
 */
function bridgeInMemoryEvent(event, TYPES) {
  const { module: mod, house, action, timestamp, ...rest } = event;
  const source = mod || 'unknown';

  // Map module+action to event_type
  let eventType = null;
  if (mod === 'probe' && action === 'skip_no_cache')    eventType = TYPES.SCRAPE_FAILED;
  if (mod === 'probe' && action === 'probe_failed')     eventType = TYPES.SCRAPE_FAILED;
  if (mod === 'probe' && action === 'hash_hit')         eventType = TYPES.SCRAPE_SEEN;
  if (mod === 'probe' && action === 'hash_changed')     eventType = TYPES.SCRAPE_SEEN;
  if (mod === 'scrape' && action === 'self_heal_triggered') eventType = TYPES.SCRAPE_SEEN;
  if (mod === 'scrape' && action === 'scrape_failed')   eventType = TYPES.SCRAPE_FAILED;
  if (mod === 'scrape' && action === 'scrape_ok')       eventType = TYPES.SCRAPE_PERSISTED;
  if (mod === 'extract' && action === 'extract_ok')     eventType = TYPES.SCRAPE_PERSISTED;
  if (mod === 'extract' && action === 'extract_failed') eventType = TYPES.SCRAPE_FAILED;

  if (!eventType) return null;

  return buildPipelineEvent({
    source: `bridge:${source}.${action}`,
    eventType,
    eventData: { house, action, ...rest }
  });
}

// ── Event factory helpers ──

export function scrapeEvent(house, data) {
  return emitPipelineEvent({ module: 'scrape', house, ...data });
}

export function extractEvent(house, data) {
  return emitPipelineEvent({ module: 'extract', house, ...data });
}

export function scoreEvent(house, data) {
  return emitPipelineEvent({ module: 'score', house, ...data });
}
