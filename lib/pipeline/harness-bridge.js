// lib/pipeline/harness-bridge.js — Connects modular pipeline events to the existing harness
// The harness (manager, regression-detector, etc.) currently gets coarse signals.
// This bridge translates rich modular events into targeted harness actions,
// and provides confidence-gated healing decisions (the agentic authority layer).

import { onPipelineEvent } from './types.js';

let _deps = null;

// ── Signal accumulator: records all events per house per cycle ──
const _houseSignals = new Map(); // house → event[]

/**
 * Wire modular pipeline events to existing harness modules.
 * This is the key experiment value: richer signals → better repair decisions.
 */
export function initHarnessBridge(deps) {
  _deps = deps;

  onPipelineEvent(async (event) => {
    try {
      // Always accumulate signals for confidence assessment
      recordSignal(event.house, event);
      await routeEventToHarness(event);
    } catch (err) {
      console.warn('Harness bridge error:', err.message);
    }
  });
}

async function routeEventToHarness(event) {
  switch (event.event) {
    // ── Scrape failures: differentiate URL vs infrastructure ──
    case 'scrape_all_tiers_failed':
      // All tiers failed → likely URL broken. Trigger URL healing directly.
      if (_deps.healBrokenHouse) {
        console.log(`HARNESS-BRIDGE: All scrape tiers failed for ${event.house} — triggering URL heal`);
        await _deps.fireAlert?.({
          type: 'scrape_failure',
          house: event.house,
          severity: 'error',
          message: `All scrape tiers failed for ${event.house}: ${event.lastError}`,
          meta: { stage: 'scrape', url: event.url },
        });
      }
      break;

    case 'scrape_thin_content':
      // Got HTML but it's empty/thin → anti-bot or URL redirect
      await _deps.fireAlert?.({
        type: 'scrape_thin_content',
        house: event.house,
        severity: 'warning',
        message: `Thin content (${event.htmlLength} chars) from ${event.method} for ${event.house}`,
        meta: { stage: 'scrape', method: event.method, htmlLength: event.htmlLength },
      });
      break;

    // ── Extract failures: pinpoint DOM vs AI ──
    case 'extract_dom_insufficient':
      // DOM found some lots but not enough → extractor partially broken
      if (event.lotCount > 0 && event.lotCount < event.threshold) {
        await _deps.fireAlert?.({
          type: 'extractor_partial_match',
          house: event.house,
          severity: 'warning',
          message: `DOM extractor for ${event.house} found ${event.lotCount} lots (need ${event.threshold}) — selector may need update`,
          meta: {
            stage: 'extract',
            domLotCount: event.lotCount,
            selector: event.selector,
            htmlLength: event.htmlLength,
          },
        });
      }
      break;

    case 'extract_dom_error':
      // DOM extractor threw an error → broken selector, not a URL problem
      await _deps.fireAlert?.({
        type: 'extractor_error',
        house: event.house,
        severity: 'error',
        message: `DOM extractor error for ${event.house}: ${event.error}`,
        meta: { stage: 'extract', error: event.error, selector: event.selector },
      });
      break;

    case 'extract_zero_lots':
      // No lots from any strategy
      await _deps.fireAlert?.({
        type: 'extract_zero_lots',
        house: event.house,
        severity: 'error',
        message: `Zero lots from all strategies for ${event.house} (DOM: ${event.domLotCount}, AI: ${event.aiLotCount})`,
        meta: {
          stage: 'extract',
          domLotCount: event.domLotCount,
          aiLotCount: event.aiLotCount,
          htmlLength: event.htmlLength,
        },
      });
      break;

    // ── Score/enrichment issues ──
    case 'score_lot_error':
      // Individual lot scoring failed — not a pipeline issue, data quality
      break;

    case 'image_backfill_complete':
      if (event.after > event.before) {
        console.log(`HARNESS-BRIDGE: Image backfill improved ${event.house}: ${event.before}→${event.after}/${event.total}`);
      }
      break;

    // ── Tier fallbacks: track for M5 (wasted calls) ──
    case 'scrape_tier_fallback':
      console.log(`HARNESS-BRIDGE: ${event.house} fell back from ${event.failedMethod} (${event.reason})`);
      break;
  }
}

// ══════════════════════════════════════════════════════════
// Confidence-gated healing decisions (agentic authority)
// ══════════════════════════════════════════════════════════

/**
 * Assess how confident we are that URL healing will fix a house's issues.
 * Based on accumulated signals from the current cycle.
 *
 * @param {string} house - House slug
 * @returns {{ confidence: number, signals: object[], recommendation: string }}
 */
export function assessHealingConfidence(house) {
  const signals = _houseSignals.get(house) || [];

  const hasUrlFailure = signals.some(s => s.event === 'scrape_all_tiers_failed');
  const hasThinContent = signals.some(s => s.event === 'scrape_thin_content');
  const hasDomPartial = signals.some(s => s.event === 'extract_dom_insufficient');
  const hasZeroLots = signals.some(s => s.event === 'extract_zero_lots');
  const hasDomError = signals.some(s => s.event === 'extract_dom_error');

  let confidence = 0;

  // Scrape completely failed → URL is probably dead → high confidence healing helps
  if (hasUrlFailure) {
    confidence = 0.9;
  }
  // Thin content → anti-bot or redirect → medium-high, healing might find alt URL
  else if (hasThinContent) {
    confidence = 0.7;
  }
  // Zero lots but scrape succeeded → extractor broken, not URL → medium
  // URL healing won't fix a selector issue, but might find a page with different structure
  else if (hasZeroLots && !hasUrlFailure) {
    confidence = 0.4;
  }
  // DOM found some lots but not enough → selector partially works → low confidence for URL healing
  else if (hasDomPartial && !hasZeroLots) {
    confidence = 0.2;
  }
  // DOM error without zero lots → selector threw, but AI recovered → very low
  else if (hasDomError && !hasZeroLots) {
    confidence = 0.15;
  }

  return {
    confidence,
    signals: signals.map(s => ({ event: s.event, timestamp: s.timestamp })),
    recommendation: confidenceToAction(confidence),
  };
}

function confidenceToAction(confidence) {
  if (confidence >= 0.8) return 'auto_heal';       // Just do it
  if (confidence >= 0.5) return 'heal_and_alert';   // Do it, tell Simon
  if (confidence >= 0.3) return 'suggest';           // Log suggestion, don't act
  return 'monitor';                                  // Not enough signal yet
}

/**
 * Execute healing based on confidence assessment.
 * High confidence → auto-heal. Low confidence → escalate or monitor.
 *
 * @param {string} house - House slug
 * @returns {Promise<object|null>} Healing result, or null if not acted on
 */
export async function executeHealing(house) {
  const { confidence, recommendation } = assessHealingConfidence(house);

  switch (recommendation) {
    case 'auto_heal':
      console.log(`HEALTH: Auto-healing ${house} (confidence ${confidence.toFixed(2)})`);
      return _deps.healBrokenHouse?.(house);

    case 'heal_and_alert': {
      console.log(`HEALTH: Healing ${house} with alert (confidence ${confidence.toFixed(2)})`);
      const result = await _deps.healBrokenHouse?.(house);
      await _deps.fireAlert?.({
        type: 'auto_healed',
        house,
        severity: 'info',
        message: `Auto-healed ${house} (confidence ${confidence.toFixed(2)})`,
        meta: { confidence, result },
      });
      return result;
    }

    case 'suggest':
      await _deps.fireAlert?.({
        type: 'healing_suggested',
        house,
        severity: 'warning',
        message: `${house} may need healing (confidence ${confidence.toFixed(2)}) — review recommended`,
        meta: { confidence },
      });
      return null;

    case 'monitor':
    default:
      return null;
  }
}

// ══════════════════════════════════════════════════════════
// Signal management
// ══════════════════════════════════════════════════════════

function recordSignal(house, event) {
  if (!house) return;
  if (!_houseSignals.has(house)) _houseSignals.set(house, []);
  _houseSignals.get(house).push(event);
}

/**
 * Clear accumulated signals. Call at the start/end of each experiment cycle.
 */
export function resetCycleSignals() {
  _houseSignals.clear();
}

/**
 * Get accumulated signals for a house (for debugging/admin).
 */
export function getHouseSignals(house) {
  return _houseSignals.get(house) || [];
}

/**
 * Get all houses with accumulated signals (for cycle summary).
 */
export function getAllSignals() {
  const result = {};
  for (const [house, signals] of _houseSignals) {
    result[house] = signals.length;
  }
  return result;
}
