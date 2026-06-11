// ═══════════════════════════════════════════════════════════════
// lib/scraper/house-recognisers.js — Per-house markdown recognisers.
//
// Single source of truth for the recogniser + recall sentinel + page cap of
// the houses whose dense catalogues need markdown recognition to hit full
// recall (Pattinson, John Pye, McHugh, Mark Jenkinson, Maggs, Hollis Morgan).
//
// Consumed by:
//   • lib/analysis.js (cron) — spread into HOUSE_OVERRIDES, which adds the
//     per-house extras (paginateAs, changeTracking, validatePage1).
//   • routes/analyse.js (on-demand) — so a promoted recogniser house keeps
//     full recall on the user-facing path too (Crawlee turndown bridge).
//
// Keeping this in one place stops the sentinel patterns drifting between the
// two call paths. The recogniser functions themselves still live in
// firecrawl-extract.js (where the Firecrawl markdown path also uses them).
// ═══════════════════════════════════════════════════════════════

import {
  recognisePattinsonLotsFromMarkdown,
  recogniseJohnPyeLotsFromMarkdown,
  recogniseMcHughLotsFromMarkdown,
  recogniseMarkJenkinsonLotsFromMarkdown,
  recogniseMaggsLotsFromMarkdown,
  recogniseHollisMorganLotsFromMarkdown,
} from '../pipeline/firecrawl-extract.js';

export const HOUSE_RECOGNISERS = {
  pattinson:     { maxPages: 84, recallSentinelPattern: /\/property\/(\d+)/g,                        recogniseFromMarkdown: recognisePattinsonLotsFromMarkdown },
  johnpye:       { maxPages: 1,  recallSentinelPattern: /\/auctions\/([\w-]{10,})/g,                 recogniseFromMarkdown: recogniseJohnPyeLotsFromMarkdown },
  mchughandco:   { maxPages: 1,  recallSentinelPattern: /\/lot\/(?:details|redirect)\/(\d+)/g,       recogniseFromMarkdown: recogniseMcHughLotsFromMarkdown },
  markjenkinson: { maxPages: 1,  recallSentinelPattern: /markjenkinson\.co\.uk\/property\/([a-z0-9_]+)/gi, recogniseFromMarkdown: recogniseMarkJenkinsonLotsFromMarkdown },
  maggsandallen: { maxPages: 1,  recallSentinelPattern: /\/property-details\/(\d+)\//g,              recogniseFromMarkdown: recogniseMaggsLotsFromMarkdown },
  hollismorgan:  { maxPages: 1,  recallSentinelPattern: /\/property-details\/(\d+)/g,                recogniseFromMarkdown: recogniseHollisMorganLotsFromMarkdown },
};

// { recogniseFromMarkdown, recallSentinelPattern, maxPages } for a slug, or null.
export function houseRecogniser(slug) {
  return HOUSE_RECOGNISERS[slug] || null;
}
