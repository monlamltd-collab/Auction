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
  recognisePurplebricksGotoLotsFromMarkdown,
  recognisePropertysolversLotsFromMarkdown,
  recogniseAuctionHouseLondonLotsFromMarkdown,
  recogniseBtgEddisonsLotsFromMarkdown,
  recogniseCharlesDarrowLotsFromMarkdown,
  recogniseSdlAuctionsLotsFromMarkdown,
  recogniseCliveEmsonLotsFromMarkdown,
} from '../pipeline/firecrawl-extract.js';
import { HOUSE_ROOTS } from '../houses.js';
import { AUCTIONHOUSE_SENTINEL } from './recall-sentinels.js';

export const HOUSE_RECOGNISERS = {
  pattinson:     { maxPages: 84, recallSentinelPattern: /\/property\/(\d+)/g,                        recogniseFromMarkdown: recognisePattinsonLotsFromMarkdown },
  johnpye:       { maxPages: 1,  recallSentinelPattern: /\/(?:auctions|properties)\/([\w-]{10,})/g,  recogniseFromMarkdown: recogniseJohnPyeLotsFromMarkdown },
  mchughandco:   { maxPages: 1,  recallSentinelPattern: /\/lot\/(?:details|redirect)\/(\d+)/g,       recogniseFromMarkdown: recogniseMcHughLotsFromMarkdown },
  markjenkinson: { maxPages: 1,  recallSentinelPattern: /markjenkinson\.co\.uk\/property\/([a-z0-9_]+)/gi, recogniseFromMarkdown: recogniseMarkJenkinsonLotsFromMarkdown },
  maggsandallen: { maxPages: 1,  recallSentinelPattern: /\/property-details\/(\d+)\//g,              recogniseFromMarkdown: recogniseMaggsLotsFromMarkdown },
  hollismorgan:  { maxPages: 1,  recallSentinelPattern: /\/property-details\/(\d+)/g,                recogniseFromMarkdown: recogniseHollisMorganLotsFromMarkdown },
  nesbits:       { maxPages: 1,  recallSentinelPattern: /nesbits\.co\.uk\/property\/[a-z0-9-]+\/(\d+)/gi, recogniseFromMarkdown: recogniseNesbitsLotsFromMarkdown },
  bondwolfe:     { maxPages: 1,  recallSentinelPattern: /bondwolfe\.com\/auctions\/properties\/(\d+)-/gi, recogniseFromMarkdown: recogniseBondwolfeLotsFromMarkdown },
  // Purplebricks / GOTO Properties — EIG OAS, server-rendered. staticCatalogue:
  // ?pagesize=5000 ships all ~2,867 lots in ONE static fetch; a browser render
  // broke it (0 lots since mid-June → circuit open). See recognise…Goto above.
  purplebricksgoto: { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /purplebricks\.gotoproperties\.co\.uk\/lot\/details\/(\d+)/gi, recogniseFromMarkdown: recognisePurplebricksGotoLotsFromMarkdown },
  propertysolvers: { maxPages: 1, recallSentinelPattern: /auctions\.propertysolvers\.co\.uk\/auction-property-for-sale\/([a-z0-9-]+)\/?/gi, recogniseFromMarkdown: recognisePropertysolversLotsFromMarkdown },
  // Auction House London — rebuilt Next.js/EIG-AMS template; lots are
  // /lot/{address-slug}-{numericId}. Per-house (NOT the auctionhouse.co.uk
  // platform recogniser, which this domain is correctly excluded from below).
  auctionhouselondon: { maxPages: 1, recallSentinelPattern: /auctionhouselondon\.co\.uk\/lot\/[a-z0-9-]+-(\d+)/gi, recogniseFromMarkdown: recogniseAuctionHouseLondonLotsFromMarkdown },
  // BTG Eddisons — the `btgeddisons` slug (HOUSE_ROOTS.btgeddisons = btgeddisonspropertyauctions.com).
  // Rebuilt template recovered via the ?limit=500 single-page recogniser; lots are
  // /properties/{id}/for-auction-{location} (the id carries the -DDMMYY auction date).
  // staticCatalogue: the catalogue is fully server-rendered (?page=1&limit=500
  // ships every lot WITH inline "Guide Price: £X"). A browser render lets the
  // EIG widget re-hydrate the grid and drop the guide labels, so this slug is
  // fetched via plain HTTP and fed straight to the recogniser (lib/analysis.js).
  btgeddisons: { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /btgeddisonspropertyauctions\.com\/properties\/([a-z0-9_-]+?)\/for-auction/gi, recogniseFromMarkdown: recogniseBtgEddisonsLotsFromMarkdown },
  // Charles Darrow — independent Devon/Cornwall auctioneer on its own ASP.NET
  // site (NOT the BTG Eddisons network; de-conflated from `sdl`/`btgeddisons`
  // 2026-06-21). The /Auctions/ grid is AJAX-hydrated into #resultsControl, so
  // it needs a browser render (Crawlee) before turndown → recogniser. Lots are
  // /propertyInfo/{numericId}/for-sale/{type-slug}/{location}.
  charlesdarrow: { maxPages: 1, recallSentinelPattern: /charlesdarrow\.co\.uk\/propertyInfo\/(\d+)/gi, recogniseFromMarkdown: recogniseCharlesDarrowLotsFromMarkdown },
  // SDL Property Auctions — major UK auctioneer (now under the BTG Eddisons brand
  // but still trading sdlauctions.co.uk). Onboarded 2026-06-22 (plan 4). The
  // /search/ grid is AJAX-hydrated (WordPress theme `searchProperty()` POSTs to
  // /wp-content/themes/sdl-auctions/library/property-functions.php), so the page
  // needs a browser render (Crawlee → turndown) before the recogniser runs. Lots
  // are /property/{numericId}/{type}-for-auction-{town}/. Photos are on the SAME
  // property-world platform as BTG Eddisons.
  sdlauctions: { maxPages: 1, recallSentinelPattern: /sdlauctions\.co\.uk\/property\/(\d+)/gi, recogniseFromMarkdown: recogniseSdlAuctionsLotsFromMarkdown },
  // Clive Emson — JS-rendered SPA (rewriteUrl preferPuppeteer → Crawlee). The
  // single /properties/ page lists the whole current auction; each lot's detail
  // link IS a markdown <a> (/properties/{auc}/{lot}/), so Gemini under-extracts
  // and historically stored the per-lot "View on Google Maps" pin as lots.url —
  // the multi-image sweep then fetched a map and galleries stayed empty. The
  // recogniser anchors on the detail link, emits the clean URL, and lifts recall
  // to the full advertised count. Sentinel mirrors RECALL_SENTINELS.cliveemson.
  cliveemson: { maxPages: 1, recallSentinelPattern: /cliveemson\.co\.uk\/properties\/\d+\/(\d+)/gi, recogniseFromMarkdown: recogniseCliveEmsonLotsFromMarkdown },
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
