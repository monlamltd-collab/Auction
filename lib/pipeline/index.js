// lib/pipeline/index.js — Public API for the modular pipeline experiment

export { ScrapeError, ExtractError, ScoreError, onPipelineEvent } from './types.js';
export { probe } from './probe.js';
export { scrape, scrapePages, initModularScraper } from './scraper.js';
export { extract, initModularExtractor } from './extractor.js';
export { scoreLots, score, initModularScorer } from './scorer.js';
export { EnrichmentService } from './enrichment.js';
export {
  initExperiment,
  isTreatmentHouse,
  startExperimentCycle,
  runModularPipeline,
  logControlMetrics,
  endExperimentCycle,
  injectFault,
  clearFault,
  getInjectedFault,
  EXPERIMENT_CONFIG,
} from './experiment.js';
export {
  initHarnessBridge,
  assessHealingConfidence,
  executeHealing,
  resetCycleSignals,
  getHouseSignals,
  getAllSignals,
} from './harness-bridge.js';
export { scrapeStage } from './scrape-stage.js';
export { enrichStage } from './enrich-stage.js';
export { persistStage } from './persist-stage.js';
export { cacheEnrichStage } from './cache-enrich-stage.js';
export { healBrokenHouse, getHealingState, clearHealingCooldown } from './healing.js';
export { discoverAndUpdateCalendar } from './discovery.js';
export { updateHouseSkill } from './house-skills.js';
export { saveDailySnapshot } from './analytics.js';
