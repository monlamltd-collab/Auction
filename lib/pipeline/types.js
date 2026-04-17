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
  return stamped;
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
