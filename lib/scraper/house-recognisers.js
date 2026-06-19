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
  recogniseAuctionHouseLotsFromMarkdown,
  recogniseNesbitsLotsFromMarkdown,
  recogniseBondwolfeLotsFromMarkdown,
  recognisePropertysolversLotsFromMarkdown,
  recogniseAuctionHouseLondonLotsFromMarkdown,
  recogniseBtgEddisonsLotsFromMarkdown,
} from '../pipeline/firecrawl-extract.js';
import { HOUSE_ROOTS } from '../houses.js';
import { AUCTIONHOUSE_SENTINEL } from './recall-sentinels.js';

export const HOUSE_RECOGNISERS = {
  pattinson:     { maxPages: 84, recallSentinelPattern: /\/property\/(\d+)/g,                        recogniseFromMarkdown: recognisePattinsonLotsFromMarkdown },
  johnpye:       { maxPages: 1,  recallSentinelPattern: /\/auctions\/([\w-]{10,})/g,                 recogniseFromMarkdown: recogniseJohnPyeLotsFromMarkdown },
  mchughandco:   { maxPages: 1,  recallSentinelPattern: /\/lot\/(?:details|redirect)\/(\d+)/g,       recogniseFromMarkdown: recogniseMcHughLotsFromMarkdown },
  markjenkinson: { maxPages: 1,  recallSentinelPattern: /markjenkinson\.co\.uk\/property\/([a-z0-9_]+)/gi, recogniseFromMarkdown: recogniseMarkJenkinsonLotsFromMarkdown },
  maggsandallen: { maxPages: 1,  recallSentinelPattern: /\/property-details\/(\d+)\//g,              recogniseFromMarkdown: recogniseMaggsLotsFromMarkdown },
  hollismorgan:  { maxPages: 1,  recallSentinelPattern: /\/property-details\/(\d+)/g,                recogniseFromMarkdown: recogniseHollisMorganLotsFromMarkdown },
  nesbits:       { maxPages: 1,  recallSentinelPattern: /nesbits\.co\.uk\/property\/[a-z0-9-]+\/(\d+)/gi, recogniseFromMarkdown: recogniseNesbitsLotsFromMarkdown },
  bondwolfe:     { maxPages: 1,  recallSentinelPattern: /bondwolfe\.com\/auctions\/properties\/(\d+)-/gi, recogniseFromMarkdown: recogniseBondwolfeLotsFromMarkdown },
  propertysolvers: { maxPages: 1, recallSentinelPattern: /auctions\.propertysolvers\.co\.uk\/auction-property-for-sale\/([a-z0-9-]+)\/?/gi, recogniseFromMarkdown: recognisePropertysolversLotsFromMarkdown },
  // Auction House London — rebuilt Next.js/EIG-AMS template; lots are
  // /lot/{address-slug}-{numericId}. Per-house (NOT the auctionhouse.co.uk
  // platform recogniser, which this domain is correctly excluded from below).
  auctionhouselondon: { maxPages: 1, recallSentinelPattern: /auctionhouselondon\.co\.uk\/lot\/[a-z0-9-]+-(\d+)/gi, recogniseFromMarkdown: recogniseAuctionHouseLondonLotsFromMarkdown },
  // BTG Eddisons / SDL network — the `sdl` slug (HOUSE_ROOTS.sdl = btgeddisonspropertyauctions.com).
  // Rebuilt template recovered via the ?limit=500 single-page recogniser; lots are
  // /properties/{id}/for-auction-{location} (the id carries the -DDMMYY auction date).
  // staticCatalogue: the catalogue is fully server-rendered (?page=1&limit=500
  // ships every lot WITH inline "Guide Price: £X"). A browser render lets the
  // EIG widget re-hydrate the grid and drop the guide labels, so this slug is
  // fetched via plain HTTP and fed straight to the recogniser (lib/analysis.js).
  sdl: { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /btgeddisonspropertyauctions\.com\/properties\/([a-z0-9_-]+?)\/for-auction/gi, recogniseFromMarkdown: recogniseBtgEddisonsLotsFromMarkdown },
};

// Platform-level recognisers — one template shared across many houses, resolved
// by HOUSE_ROOTS domain so we don't list every franchise site individually.
// The Auction House UK franchise (~33 auctionhouse.co.uk/{region} sites) renders
// its whole catalogue on one search-results page; the deterministic recogniser
// gets every lot where Gemini only managed a token-limited slice.
const AUCTIONHOUSE_PLATFORM = {
  maxPages: 1,
  recallSentinelPattern: AUCTIONHOUSE_SENTINEL,
  recogniseFromMarkdown: recogniseAuctionHouseLotsFromMarkdown,
};

// The recogniser bundle for a slug from a shared PLATFORM, or null. Keyed off
// HOUSE_ROOTS so all franchise sites are covered without per-slug entries.
// NB auctionhouselondon.co.uk (a separate company) does NOT contain the
// 'auctionhouse.co.uk' substring, so it is correctly excluded.
export function resolvePlatformRecogniser(slug) {
  const root = HOUSE_ROOTS[slug] || '';
  if (root.includes('auctionhouse.co.uk')) return AUCTIONHOUSE_PLATFORM;
  return null;
}

// { recogniseFromMarkdown, recallSentinelPattern, maxPages } for a slug, or null.
// Per-house entry wins; otherwise a shared platform recogniser; otherwise null.
export function houseRecogniser(slug) {
  return HOUSE_RECOGNISERS[slug] || resolvePlatformRecogniser(slug) || null;
}
