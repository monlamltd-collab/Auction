// lib/pipeline/experiment.js — A/B experiment runner
// Routes houses to modular (treatment) or legacy (control) pipeline.
// Logs structured metrics to Supabase experiment_log table.

import { scrape, scrapePages, initModularScraper } from './scraper.js';
import { extract, initModularExtractor } from './extractor.js';
import { score, initModularScorer } from './scorer.js';
import { onPipelineEvent } from './types.js';

let _supabase = null;
let _experimentEnabled = false;
let _treatmentHouses = new Set();
let _cycleTs = null;

// Event log buffer — flushed to Supabase after each house completes
let _eventBuffer = [];

// ── Configuration ──

const CONFIG = {
  enabled: (process.env.EXPERIMENT_ENABLED || 'false') === 'true',
  treatmentHouses: (process.env.EXPERIMENT_TREATMENT_HOUSES || '').split(',').filter(Boolean),
};

/**
 * Initialize the experiment with all dependencies.
 * Wire up modular pipeline modules to use existing infrastructure.
 */
export function initExperiment(deps) {
  _supabase = deps.supabase;
  _experimentEnabled = CONFIG.enabled;
  _treatmentHouses = new Set(CONFIG.treatmentHouses);

  if (!_experimentEnabled) return;

  console.log(`EXPERIMENT: Enabled with ${_treatmentHouses.size} treatment houses: ${[..._treatmentHouses].join(', ')}`);

  // Initialize modular pipeline modules with shared deps
  initModularScraper({
    FIRECRAWL_API_KEY: deps.FIRECRAWL_API_KEY,
    isFcCreditExhausted: deps.isFcCreditExhausted,
    FIRECRAWL_SKIP: deps.FIRECRAWL_SKIP,
    scrapeWithFirecrawl: deps.scrapeWithFirecrawl,
    scrapeRenderedPage: deps.scrapeRenderedPage,
    puppeteer: deps.puppeteer,
    fetchPage: deps.fetchPage,
    detectTotalPages: deps.detectTotalPages,
    buildPageUrl: deps.buildPageUrl,
  });

  initModularExtractor({
    extractWithJSDOM: deps.extractWithJSDOM,
    getLastExtractorUsed: deps.getLastExtractorUsed,
    extractLotsWithAI: deps.extractLotsWithAI,
    isCreditExhausted: deps.isCreditExhausted,
  });

  initModularScorer({
    analyseLot: deps.analyseLot,
    enrichLots: deps.enrichLots,
    enrichLotsFromLotPages: deps.enrichLotsFromLotPages,
    enrichLotsWithFundability: deps.enrichLotsWithFundability,
    backfillImagesWithFirecrawl: deps.backfillImagesWithFirecrawl,
    backfillImagesWithPuppeteer: deps.backfillImagesWithPuppeteer,
    FIRECRAWL_API_KEY: deps.FIRECRAWL_API_KEY,
    isFcCreditExhausted: deps.isFcCreditExhausted,
    puppeteer: deps.puppeteer,
  });

  // Subscribe to pipeline events for the experiment log
  onPipelineEvent((event) => {
    _eventBuffer.push(event);
  });
}

/**
 * Check if a house should use the modular pipeline.
 */
export function isTreatmentHouse(slug) {
  return _experimentEnabled && _treatmentHouses.has(slug);
}

/**
 * Mark the start of an analysis cycle (called from autoAnalyseAll).
 */
export function startExperimentCycle() {
  _cycleTs = new Date().toISOString();
  _eventBuffer = [];
}

/**
 * Run the modular pipeline for a treatment house.
 * Returns lots in the same format as the legacy pipeline.
 *
 * @param {string} url - Catalogue URL
 * @param {string} house - House slug
 * @param {object} rewritten - Result of rewriteUrl()
 * @returns {object[]} - Scored, enriched lots
 */
export async function runModularPipeline(url, house, rewritten) {
  const pipelineStart = Date.now();
  const metrics = {
    house,
    scrape: null,
    extract: null,
    score: null,
    aiCallsWasted: 0,
    totalDurationMs: 0,
  };

  try {
    // ── Stage 1: Scrape ──
    const scrapeStart = Date.now();
    const scrapeResult = await scrape(rewritten.baseUrl, house, {
      waitFor: rewritten.waitFor,
      actions: rewritten.actions,
    });
    metrics.scrape = {
      method: scrapeResult.method,
      htmlLength: scrapeResult.html.length,
      imageCount: scrapeResult.images.length,
      hash: scrapeResult.hash,
      durationMs: Date.now() - scrapeStart,
    };

    // ── Stage 2: Extract ──
    const extractStart = Date.now();
    const extractResult = await extract(
      scrapeResult.html,
      house,
      rewritten.baseUrl,
      scrapeResult.images,
    );
    metrics.extract = {
      lotCount: extractResult.lots.length,
      strategy: extractResult.strategy,
      domLotCount: extractResult.domLotCount,
      aiLotCount: extractResult.aiLotCount,
      selectorMatched: extractResult.selectorMatched,
      fieldCoverage: extractResult.fieldCoverage,
      durationMs: Date.now() - extractStart,
    };

    // ── Stage 3: Score + Enrich ──
    const scoreStart = Date.now();
    const scoreResult = await score(extractResult.lots, house, url);
    metrics.score = {
      lotCount: scoreResult.lots.length,
      avgScore: scoreResult.avgScore,
      fieldCoverage: scoreResult.fieldCoverage,
      enrichmentResults: scoreResult.enrichmentResults,
      durationMs: Date.now() - scoreStart,
    };

    metrics.totalDurationMs = Date.now() - pipelineStart;

    // Log experiment metrics
    await logExperimentMetrics('treatment', house, metrics);

    return scoreResult.lots;

  } catch (err) {
    metrics.totalDurationMs = Date.now() - pipelineStart;

    // Log the failure with stage information
    await logExperimentMetric('treatment', house, 'pipeline_error', 1, {
      stage: err.stage || 'unknown',
      error: err.message,
      ...metrics,
    });

    // Count wasted AI calls from the event buffer
    const wastedAI = _eventBuffer.filter(e =>
      e.house === house && (
        e.event === 'extract_ai_error' ||
        e.event === 'extract_zero_lots'
      )
    ).length;

    if (wastedAI > 0) {
      await logExperimentMetric('treatment', house, 'wasted_ai_calls', wastedAI, {
        events: _eventBuffer.filter(e => e.house === house).map(e => e.event),
      });
    }

    throw err;
  }
}

// ── Logging helpers ──

async function logExperimentMetrics(group, house, metrics) {
  const rows = [];

  if (metrics.scrape) {
    rows.push({ metric: 'scrape_duration_ms', value: metrics.scrape.durationMs, metadata: metrics.scrape });
    rows.push({ metric: 'scrape_html_length', value: metrics.scrape.htmlLength, metadata: { method: metrics.scrape.method } });
  }

  if (metrics.extract) {
    rows.push({ metric: 'lot_count', value: metrics.extract.lotCount, metadata: metrics.extract });
    rows.push({ metric: 'extract_strategy', value: metrics.extract.strategy === 'dom' ? 1 : metrics.extract.strategy === 'ai' ? 2 : 3, metadata: { strategy: metrics.extract.strategy } });
    for (const [field, pct] of Object.entries(metrics.extract.fieldCoverage || {})) {
      rows.push({ metric: `field_coverage_${field}`, value: pct, metadata: {} });
    }
  }

  if (metrics.score) {
    rows.push({ metric: 'avg_score', value: metrics.score.avgScore, metadata: metrics.score });
    rows.push({ metric: 'image_coverage', value: metrics.score.fieldCoverage?.imageUrl || 0, metadata: metrics.score.enrichmentResults });
  }

  rows.push({ metric: 'total_duration_ms', value: metrics.totalDurationMs, metadata: {} });

  // Batch insert
  const toInsert = rows.map(r => ({
    group_name: group,
    house_slug: house,
    cycle_ts: _cycleTs,
    metric: r.metric,
    value: r.value,
    metadata: r.metadata,
  }));

  try {
    await _supabase.from('experiment_log').insert(toInsert);
  } catch (err) {
    console.warn('EXPERIMENT: Failed to log metrics:', err.message);
  }
}

async function logExperimentMetric(group, house, metric, value, metadata = {}) {
  try {
    await _supabase.from('experiment_log').insert({
      group_name: group,
      house_slug: house,
      cycle_ts: _cycleTs,
      metric,
      value,
      metadata,
    });
  } catch (err) {
    console.warn('EXPERIMENT: Failed to log metric:', err.message);
  }
}

/**
 * Log control group metrics (called from the legacy pipeline path).
 * Minimal instrumentation — just the outcome metrics for comparison.
 */
export async function logControlMetrics(house, { lotCount, imageCoverage, fieldCoverage, durationMs, aiCalls }) {
  if (!_experimentEnabled || !_supabase) return;

  const rows = [
    { metric: 'lot_count', value: lotCount, metadata: {} },
    { metric: 'image_coverage', value: imageCoverage, metadata: {} },
    { metric: 'total_duration_ms', value: durationMs, metadata: {} },
  ];

  if (aiCalls != null) {
    rows.push({ metric: 'ai_calls', value: aiCalls, metadata: {} });
  }

  if (fieldCoverage) {
    for (const [field, pct] of Object.entries(fieldCoverage)) {
      rows.push({ metric: `field_coverage_${field}`, value: pct, metadata: {} });
    }
  }

  const toInsert = rows.map(r => ({
    group_name: 'control',
    house_slug: house,
    cycle_ts: _cycleTs,
    metric: r.metric,
    value: r.value,
    metadata: r.metadata,
  }));

  try {
    await _supabase.from('experiment_log').insert(toInsert);
  } catch (err) {
    console.warn('EXPERIMENT: Failed to log control metrics:', err.message);
  }
}

/**
 * Flush remaining events and produce cycle summary.
 */
export async function endExperimentCycle() {
  if (!_experimentEnabled || !_supabase) return;

  // Count pipeline events per house
  const houseCounts = {};
  for (const e of _eventBuffer) {
    const key = `${e.house}:${e.event}`;
    houseCounts[key] = (houseCounts[key] || 0) + 1;
  }

  // Log cycle summary
  try {
    await _supabase.from('experiment_log').insert({
      group_name: 'meta',
      house_slug: '_cycle',
      cycle_ts: _cycleTs,
      metric: 'cycle_event_summary',
      value: _eventBuffer.length,
      metadata: houseCounts,
    });
  } catch (err) {
    console.warn('EXPERIMENT: Failed to log cycle summary:', err.message);
  }

  _eventBuffer = [];
}

// ── Fault injection (for controlled testing) ──

const _injectedFaults = new Map(); // house → { type, config }

/**
 * Inject a fault for testing. Used by admin API.
 * Types: 'selector_break', 'url_404', 'field_strip'
 */
export function injectFault(house, type, config = {}) {
  _injectedFaults.set(house, { type, config, injectedAt: Date.now() });
  console.log(`EXPERIMENT: Fault injected for ${house}: ${type}`);
}

export function clearFault(house) {
  _injectedFaults.delete(house);
}

export function getInjectedFault(house) {
  return _injectedFaults.get(house) || null;
}

/**
 * Apply injected faults to pipeline stages.
 * Called by the modular pipeline before each stage.
 */
export function applyFault(house, stage, data) {
  const fault = _injectedFaults.get(house);
  if (!fault) return data;

  if (stage === 'extract' && fault.type === 'selector_break') {
    // Simulate broken DOM extractor: return empty lots from DOM
    console.log(`EXPERIMENT FAULT: Simulating selector break for ${house}`);
    return { ...data, lots: [], domLotCount: 0 };
  }

  if (stage === 'scrape' && fault.type === 'url_404') {
    // Simulate broken URL
    console.log(`EXPERIMENT FAULT: Simulating 404 for ${house}`);
    return null; // Will trigger ScrapeError
  }

  if (stage === 'extract' && fault.type === 'field_strip') {
    // Strip a specific field from most lots
    const field = fault.config.field || 'beds';
    const stripRate = fault.config.rate || 0.8;
    console.log(`EXPERIMENT FAULT: Stripping ${field} from ${Math.round(stripRate * 100)}% of ${house} lots`);
    const modified = data.lots.map((lot, i) => {
      if (i / data.lots.length < stripRate) {
        const copy = { ...lot };
        delete copy[field];
        return copy;
      }
      return lot;
    });
    return { ...data, lots: modified };
  }

  return data;
}

export { CONFIG as EXPERIMENT_CONFIG };
