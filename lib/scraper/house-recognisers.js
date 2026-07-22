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
  recogniseEdwardMellorLotsFromMarkdown,
  resolveEdwardMellorCatalogueUrl,
  recognisePropertysolversLotsFromMarkdown,
  recogniseAuctionHouseLondonLotsFromMarkdown,
  recogniseBtgEddisonsLotsFromMarkdown,
  recogniseCharlesDarrowLotsFromMarkdown,
  recogniseSdlAuctionsLotsFromMarkdown,
  recogniseCliveEmsonLotsFromMarkdown,
  recogniseEigOasLotsFromMarkdown,
  recogniseSuttonKershLotsFromMarkdown,
  recogniseBambooLotsFromMarkdown,
  recogniseFutureAuctionsLotsFromMarkdown,
  recogniseSavillsLotsFromMarkdown,
  resolveSavillsCatalogueUrl,
  recogniseSequenceBranchLotsFromMarkdown,
} from '../pipeline/firecrawl-extract.js';
import { HOUSE_ROOTS } from '../houses.js';
import { AUCTIONHOUSE_SENTINEL, EIG_SENTINEL_SRC } from './recall-sentinels.js';

export const HOUSE_RECOGNISERS = {
  pattinson:     { maxPages: 84, recallSentinelPattern: /\/property\/(\d+)/g,                        recogniseFromMarkdown: recognisePattinsonLotsFromMarkdown },
  // John Pye — Avada/Fusion post-card grid at /properties/, fully server-rendered
  // (staticCatalogue: one plain-HTTP fetch ships all cards; no browser render, no
  // AI extractor). Lots are /auctions/{slug}/. The old sentinel counted the five
  // /properties/{category} nav tiles as lots AND missed short numeric lot slugs
  // (`10040-2`), so recall read wrong in both directions; it now matches the real
  // lot-URL form only and skips the "…-to-rent-…" lettings card the recogniser
  // deliberately drops. Verified against the live page 2026-07-21.
  johnpye:       { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /johnpye\.co\.uk\/auctions\/(?![a-z0-9-]*-to-rent\b)([a-z0-9][a-z0-9-]*)\/?/gi, recogniseFromMarkdown: recogniseJohnPyeLotsFromMarkdown },
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
  // Sutton Kersh — `?perPage=all` (forced in rewriteUrl) ships the whole current
  // auction SSR in one fetch; the recogniser parses all 97 lots deterministically
  // (incl. SOLD-prior / withdrawn status), removing the AI-quota dependency that
  // left the house dark. Verified 97/97 against the live page 2026-07-10.
  // Future Property Auctions — classic ASP SSR, rolling timed-online catalogue of
  // 749 entries paginated by ?offset=N in steps of 21. No recogniser before, so it
  // depended on the quota-dead AI extractor and went dark. 36 pages x ~25KB.
  futureauctions: { maxPages: 40, staticCatalogue: true, staticPaginate: { param: 'offset', step: 21, from: 0 }, recallSentinelPattern: /property_details\.asp\?id=(\d+)/gi, recogniseFromMarkdown: recogniseFutureAuctionsLotsFromMarkdown },
  suttonkersh: { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /suttonkersh\.co\.uk\/properties\/lot\/(\d+)/gi, recogniseFromMarkdown: recogniseSuttonKershLotsFromMarkdown },
  // Savills — two-tier Joomla site, fully server-rendered. resolveCatalogueUrl
  // reads the /upcoming-auctions CALENDAR and returns a page target per upcoming
  // sale (the dated auction id rotates every sale, so a pinned calendar row
  // rots; and later sales already carry live lots, so "soonest only" would ship
  // a partial). Page size is a PATH segment — /page-{n}/quantity-100 — sized
  // from the calendar's own property count. staticCatalogue: the catalogue is
  // fully SSR, so plain HTTP feeds the recogniser directly and the house no
  // longer depends on the AI extractor that left it dark at 0 live lots.
  savills: { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /\/auctions\/[\w-]+\/[\w-]+-(\d{4,6})(?=$|[/?#)\s"'\]])/gi, resolveCatalogueUrl: resolveSavillsCatalogueUrl, recogniseFromMarkdown: recogniseSavillsLotsFromMarkdown },
  // ── Sequence / Connells branches — ONE shared hand-built static XHTML template ──
  // Bagshaws Residential, Fox & Sons and William H Brown (Norwich) each publish
  // their OWN regional slice of the group's national sale on a byte-for-byte
  // identical page (no CMS, no JS); every lot links out to
  // barnardmarcusauctions.co.uk/auctions/{DD-month-YYYY}/{id}/. Lot-id namespaces
  // are disjoint per branch and disjoint from barnardmarcus's own London sale
  // (verified 2026-07-22 — zero URL overlap in `lots`), so these are three real
  // catalogues, not duplicate brand-fronts.
  //
  // staticCatalogue: one plain-HTTP fetch carries every card with photo, guide and
  // status badge — no render, no AI. All three previously leaned on the AI
  // extractor (`ai_only_freshness_rot`) and went dark. Sentinels mirror the
  // RECALL_SENTINELS entries for each slug exactly.
  // Survivor-verified against the live pages 2026-07-22: 23/23, 21/21, 19/19.
  bagshaws:             { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi, recogniseFromMarkdown: recogniseSequenceBranchLotsFromMarkdown },
  foxandsons:           { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi, recogniseFromMarkdown: recogniseSequenceBranchLotsFromMarkdown },
  williamhbrownnorwich: { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi, recogniseFromMarkdown: recogniseSequenceBranchLotsFromMarkdown },
  // Edward Mellor — two-tier WordPress site, plain HTTP (NOT Cloudflare, despite
  // a stale "captcha" note). The /auctions/ landing lists auction DATES only;
  // resolveCatalogueUrl drills to the soonest upcoming dated page /auctions/{date}
  // which holds the /property-for-sale/{id} lot cards. staticCatalogue: the dated
  // page is fully server-rendered (a browser render is unnecessary), so it's
  // fetched via plain HTTP and fed straight to the recogniser (lib/analysis.js).
  edwardmellor: { maxPages: 1, staticCatalogue: true, recallSentinelPattern: /\/property-for-sale\/(\d+)/g, resolveCatalogueUrl: resolveEdwardMellorCatalogueUrl, recogniseFromMarkdown: recogniseEdwardMellorLotsFromMarkdown },
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
// The ~32 auctionhouse.co.uk franchise sites render their WHOLE catalogue
// server-side (London: 762 lots in one 759KB page), so a plain HTTP fetch already
// carries every card, its photo and its sold/withdrawn badge. Marking the platform
// `staticCatalogue` bypasses the browser render (which was silently failing on some
// branches — auctionhousebirmingham had been hard-blocked as "persistently 0 lots"
// while a static fetch returns 94) and makes the recogniser authoritative, removing
// the AI-extractor dependency that goes quota-dead most of each month. Verified
// 2026-07-10: 100% recall + 100% distinct images on birmingham/london/eastanglia/
// northwest/scotland/devon/national. A branch that genuinely has no catalogue
// (northwales) yields 0 lots and falls through to the engine router, so it degrades
// rather than breaking.
const AUCTIONHOUSE_PLATFORM = {
  maxPages: 1,
  staticCatalogue: true,
  recallSentinelPattern: AUCTIONHOUSE_SENTINEL,
  recogniseFromMarkdown: recogniseAuctionHouseLotsFromMarkdown,
};

// ── EIG OAS platform — shared current-auction recogniser ──────────────────────
// The ~25 EIG "Online Auction System" houses share one recogniser
// (recogniseEigOasLotsFromMarkdown) driven by the paginated static-catalogue path
// in lib/analysis.js (staticCatalogue + paginateStatic): it walks ?pagesize&page,
// keeps ONLY live lots (drops ended/past-dated), and stops at the live↔ended
// boundary — so it never fetches the archive and never ships an ended lot as live.
//
// Gated to a verified ALLOWLIST rather than every EIG domain: a house is added
// only after it's confirmed static-fetchable and its live count checked against
// the site (the recogniser was proven on tcpa/landwood/sageandco/paulfosh
// 2026-07-08). Houses whose /search needs a browser render, or whose catalogue
// URL isn't the OAS search page, are onboarded in the verification sweep. Extend
// by adding the slug here once verified. staticPageSize 200 keeps big houses to a
// few page fetches (tcpa ~276 live → 2 pages).
const EIG_OAS_HOUSES = new Set([
  // Verified static-fetchable + recogniser-correct against the live site
  // (2026-07-08/09 sweep, forced ?view=List). Active houses:
  'tcpa', 'sageandco', 'landwood', 'clarkesimpson', 'brownco', 'higginsdrysdale',
  'thepropertyauctionhouse', 'propertyauctionagent', 'ahlondon', 'sarahmains',
  'harmanhealy', 'hmox', 'firstforauctions',
  // Currently dormant (between auctions → 0 live, page-1 all-ended confirmed);
  // safe to register — the recogniser never leaks ended lots and picks up the
  // next auction automatically. Kept explicit so the sweep stays auditable.
  'paulfosh', 'seelauctions', 'astleys', 'martinpole', 'jonespeckover', 'lot9',
  'auctionnorth', 'bowensonandwatson', 'starpropertyonline', 'rogerparry',
  'sheldonbosley', 'benjaminstevens', 'henrysykes',
]);

function eigPlatformBundle() {
  // Fresh bundle (and fresh sentinel RegExp) per call so no /g lastIndex leaks
  // across houses — mirrors detectPlatformSentinel's clone discipline.
  return {
    maxPages: 40,
    staticPageSize: 200,
    staticCatalogue: true,
    paginateStatic: true,
    recallSentinelPattern: new RegExp(EIG_SENTINEL_SRC, 'g'),
    recogniseFromMarkdown: recogniseEigOasLotsFromMarkdown,
  };
}

// The recogniser bundle for a slug from a shared PLATFORM, or null. Keyed off
// HOUSE_ROOTS so all franchise sites are covered without per-slug entries.
// NB auctionhouselondon.co.uk (a separate company) does NOT contain the
// 'auctionhouse.co.uk' substring, so it is correctly excluded.
// ── Bamboo Auctions platform ({house}.bambooauctions.com) ────────────────────
// Next.js SSR — a plain HTTP fetch returns every card, so no browser render is
// needed. None of the ~11 Bamboo houses had a recogniser, so they all depended on
// the AI extractor (quota-dead most of the month) and several went dark. The shared
// recogniser also parses the SOLD badge deterministically: most Bamboo cards are
// sold-prior (howkinsandharrison 18/20, rendells 13/14), and the AI extractor smears
// those as `available`. Keyed off HOUSE_ROOTS, so retargeting a house onto its Bamboo
// subdomain is all that's needed to onboard it.
function bambooPlatformBundle() {
  return {
    maxPages: 1,
    staticCatalogue: true,
    recallSentinelPattern: /\/property\/([a-z0-9_-]{6,})/gi,
    recogniseFromMarkdown: recogniseBambooLotsFromMarkdown,
  };
}

export function resolvePlatformRecogniser(slug) {
  if (EIG_OAS_HOUSES.has(slug)) return eigPlatformBundle();
  const root = HOUSE_ROOTS[slug] || '';
  if (root.includes('auctionhouse.co.uk')) return AUCTIONHOUSE_PLATFORM;
  if (root.includes('bambooauctions.com')) return bambooPlatformBundle();
  return null;
}

// { recogniseFromMarkdown, recallSentinelPattern, maxPages } for a slug, or null.
// Per-house entry wins; otherwise a shared platform recogniser; otherwise null.
export function houseRecogniser(slug) {
  return HOUSE_RECOGNISERS[slug] || resolvePlatformRecogniser(slug) || null;
}
