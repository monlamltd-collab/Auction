// ═══════════════════════════════════════════════════════════════
// lib/scraper/recall-sentinels.js — per-house recall sentinels.
//
// The recall sentinel is the system's structural-change detector: a regex
// (one capture group = lot id) counting how many distinct lot ids a house's
// rendered catalogue ADVERTISES vs how many the extractor actually returned.
// When a house redesigns its presentation and the extractor quietly drops
// lots, recall falls and a recall_diagnostic alert fires — without it, a
// partial loss is silent and the catalogue rots. Every house must resolve to
// a sentinel; the documented exceptions live in KNOWN_SENTINEL_GAPS and are
// enforced by tests/test-sentinel-coverage.js.
//
// Lifted out of lib/analysis.js (2026-06-12) so the coverage audit, the cron
// path, the on-demand path, and the ops scripts all share ONE map instead of
// mirroring the platform-detection logic.
//
// Resolution order (resolveRecallSentinel):
//   1. Per-house override (HOUSE_OVERRIDES / HOUSE_RECOGNISERS pattern)
//   2. Explicit entry in RECALL_SENTINELS (bespoke patterns + whitelabel platforms)
//   3. Auto-detection from HOUSE_ROOTS URL via detectPlatformSentinel()
//   4. null (no sentinel — must be listed in KNOWN_SENTINEL_GAPS)
// ═══════════════════════════════════════════════════════════════

import { HOUSE_ROOTS } from '../houses.js';

// Auction House UK franchise (auctionhouse.co.uk/{region}) — a lot links as
// EITHER /{region}/auction/lot/{id} OR online…/lot/redirect/{id} on the same
// page (London 2026-06-13: 593 + 255 = 848). The old EIG-only sentinel matched
// just the /lot/redirect form, so recall read ~30% when it was really ~100%.
export const AUCTIONHOUSE_SENTINEL = /\/(?:auction\/lot|lot\/(?:details|redirect))\/(\d+)/g;

export const RECALL_SENTINELS = {
  // EIG-platform sites — /lot/details/{id} or /lot/redirect/{id}
  // Whitelabel EIG (custom domains) need explicit entries; the *.eigonlineauctions.com
  // and *.eigpropertyauctions.co.uk variants are auto-detected by detectPlatformSentinel().
  paulfosh: /\/lot\/(?:details|redirect)\/(\d+)/g,
  harmanhealy: /\/lot\/(?:details|redirect)\/(\d+)/g,
  tcpa: /\/lot\/(?:details|redirect)\/(\d+)/g,
  firstforauctions: /\/lot\/(?:details|redirect)\/(\d+)/g,
  purplebricksgoto: /\/lot\/(?:details|redirect)\/(\d+)/g,
  // auctionhouse / auctionhouseuklondon / auctionhousenational and the other ~30
  // auctionhouse.co.uk franchise sites resolve via detectPlatformSentinel() →
  // AUCTIONHOUSE_SENTINEL (both lot-URL forms). No per-region entry needed.
  // Whitelabel EIG verified via lots.url sample (2026-05-05) — same /lot/details/{id} format:
  seelauctions:             /\/lot\/(?:details|redirect)\/(\d+)/g, // online.seelauctions.co.uk
  sheldonbosley:            /\/lot\/(?:details|redirect)\/(\d+)/g, // online.sbkauctions.co.uk
  benjaminstevens:          /\/lot\/(?:details|redirect)\/(\d+)/g, // online.benjaminstevensauctions.co.uk
  hmox:                     /\/lot\/(?:details|redirect)\/(\d+)/g, // auctions.hmox.co.uk
  henrysykes:               /\/lot\/(?:details|redirect)\/(\d+)/g, // onlineauctions.henrysykes.co.uk
  sarahmains:               /\/lot\/(?:details|redirect)\/(\d+)/g, // www.auctionworks.co.uk
  cotswoldpropertyauctions: /\/lot\/(?:details|redirect)\/(\d+)/g, // cotswoldpropertyauctions.co.uk — pattern inferred (no lots in DB yet)
  // Hollis Morgan — /property-details/{id}/...
  hollismorgan: /\/property-details\/(\d+)/g,
  // Pugh — slug-style ID: /property/{slug}
  pugh: /\/property\/([a-z0-9_-]{12,})/gi,
  // Edward Mellor — /property-for-sale/{id}
  edwardmellor: /\/property-for-sale\/(\d+)/g,
  // Future Property Auctions — query string ID. Two slugs in DB (legacy + current).
  futureauctions: /property_details\.asp\?id=(\d+)/gi,
  'future property auctions': /property_details\.asp\?id=(\d+)/gi,
  // Savills — /auctions/{date-id}/{slug-{lot-id}}
  savills: /\/auctions\/[\w-]+\/[\w-]+-(\d{4,6})(?=$|[\/?#])/gi,
  // SDL deliberately omitted — federated white-label network, no single regex
  // covers charlesdarrow.co.uk, btgeddisonspropertyauctions.com, etc.

  // Network (BTG Eddisons live-stream catalogue) —
  // /properties/{lot-id-with-suffix}/for-auction-{location}
  network: /btgeddisonspropertyauctions\.com\/properties\/([\w-]+?)(?:-\d+)?\/for-auction/gi,

  // ── Bespoke houses (added 2026-05-05, regexes derived from lots.url samples) ──
  // Numeric ID at end of path
  andrewcraig:               /\/property\/[a-z0-9-]+\/(\d{5,})/gi,
  auctionestates:            /\/property\/[a-z0-9-]+-(\d{5,})(?:[/?#]|$)/gi,
  bradleyhall:               /\/lot\/details\/(\d+)/gi,
  bradleysdevon:             /\/properties\/(\d{6,})\/sales/gi,
  cleetompkinson:            /\/properties\/(\d{6,})\/sales/gi,
  connectuk:                 /\/property-details\/sales\/[a-z0-9-]+\/(\d+)/gi,
  gth:                       /gth\.net\/properties\/(\d{6,})\/sales/gi,
  johnfrancis:               /johnfrancis\.co\.uk\/properties\/(\d{6,})\/sales/gi,
  knightfrank:               /knightfrankauctions\.com\/property\/(\d+)/gi,
  landwood:                  /landwoodpropertyauctions\.com\/lot\/details\/(\d+)/gi,
  lsh:                       /propertyauctions\.lsh\.co\.uk\/lot\/details\/(\d+)/gi,
  maggsandallen:             /maggsandallen\.co\.uk\/property-details\/(\d+)/gi,
  mccartneys:                /mccartneys\.co\.uk\/property-details\/(\d+)/gi,
  nesbits:                   /nesbits\.co\.uk\/property\/[a-z0-9-]+\/(\d+)/gi,
  robinjessop:               /\/lot\/details\/(\d+)/gi,
  shonkibros:                /shonkibros\.com\/auctions\/lot\/details\/\d+\/(\d+)/gi,
  suttonkersh:               /suttonkersh\.co\.uk\/properties\/lot\/(\d+)/gi,
  walkersingleton:           /onlinesales\.walkersingleton\.co\.uk\/auctions\/info\/id\/(\d+)/gi,
  cheffins:                  /cheffins\.co\.uk\/property-auctions\/lot-view,[a-z0-9-]+_(\d+)\.htm/gi,
  cheffinstimed:             /\/lot\/details\/(\d+)/gi,
  goldings:                  /goldingsauctions\.co\.uk\/lot\/([a-z0-9-]+)/gi,

  // Slug-only paths
  agentsproperty:            /agentspropertyauction\.com\/property\/([a-z0-9-]+)\/?/gi,
  auctionhammermidlands:     /auctionhammermidlands\.co\.uk\/property\/([a-z0-9-]+)\/?/gi,
  cityandruralpropertyauctions: /cityandruralpropertyauctions\.com\/property\/([a-z0-9-]+)\/?/gi,
  dawsons:                   /dawsonsproperty\.co\.uk\/auction\/([a-z0-9-]+)/gi,
  durrants:                  /durrants\.com\/property\/([a-z0-9-]+)\/?/gi,
  jjmorris:                  /jjmorris\.com\/properties\/sale\/[a-z-]+\/[a-z-]+\/([a-z0-9-]+)\/?/gi,
  pearsonferrier:            /pearsonferrier\.co\.uk\/property\/([a-z0-9-]+)\/?/gi,
  philliparnold:             /philliparnoldauctions\.co\.uk\/auction\/property\/([a-z0-9-]+)\/?/gi,
  probateauction:            /probate\.auction\/properties\/([a-z0-9-]+)\/?/gi,
  propertysolvers:           /auctions\.propertysolvers\.co\.uk\/auction-property-for-sale\/([a-z0-9-]+)\/?/gi,
  robinsonhall:              /robinsonandhallauctions\.co\.uk\/property\/([a-z0-9-]+)\/?/gi,
  strettons:                 /strettons\.co\.uk\/auction-property-for-sale\/([a-z0-9-]+-[a-f0-9]{20,})/gi,
  underthehammer:            /underthehammer\.com\/for-auction\/([a-z0-9-]+)(?:[/?#]|$)/gi,
  symondsandsampson:         /auctions\.symondsandsampson\.co\.uk\/property\/[a-z-]+\/([a-z0-9-]+)/gi,
  brutonknowles:             /brutonknowles\.co\.uk\/property\/([a-z0-9-]+)\/?/gi,

  // Query-string IDs
  barnettross:               /barnettross\.co\.uk\/property\.php\?id=(\d+)/gi,
  cottons:                   /cottons\.co\.uk\/current-auction\.htm\?lid=(\d+)/gi,
  countrywide:               /countrywidepropertyauctions\.co\.uk\/property_details\.php\?[^"\s)]*id=(\d+)/gi,
  sharpesauctions:           /sharpesauctions\.co\.uk\/product-details\.php\?viewid=(\d+)/gi,
  venmore:                   /venmoreauctions\.co\.uk\/Property-Details\?property_reference=([A-Z0-9]+)/gi,

  // Reference-code IDs
  buttersjohnbee:            /buttersjohnbee\.com\/listings\/[a-z_]+_sale-([A-Za-z0-9]+)/gi,
  iamsold:                   /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi,
  kivells:                   /kivells\.com\/properties\/([A-Z]{3}\d{6})/gi,
  pearsons:                  /pearsons\.com\/auctions\/[a-z0-9-]+\/([A-Z]+_\d+)/gi,

  // iamSold platform — lots always route through iamsold.co.uk regardless of
  // the estate-agent's own domain (same 32-char hex UUID format as iamsold).
  driversnorris:              /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi,
  wrightmarshall:             /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi,
  davidjames:                 /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi,

  // SDL / BTG Eddisons network — same path structure as 'network' above but
  // sdlauctions.co.uk is the SDL-branded subdomain for scargillmann.
  sdl:                        /btgeddisonspropertyauctions\.com\/properties\/([\w-]+?)(?:-\d+)?\/for-auction/gi,
  scargillmann:               /sdlauctions\.co\.uk\/properties\/([\w-]+?)(?:-\d+)?\/for-auction/gi,

  // Allsop platform (barnardmarcus hosts foxandsons + bagshaws lots too)
  barnardmarcus:             /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi,
  foxandsons:                /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi,
  bagshaws:                  /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi,

  // Major houses — patterns inferred from extractor selectors (no DB samples yet)
  acuitus:                   /acuitus\.co\.uk\/property\/([a-z0-9-]+)/gi,
  allsop:                    /allsop\.co\.uk\/(?:residential|commercial)\/lot\/(\d+)/gi,
  bondwolfe:                 /bondwolfe\.com\/auctions\/properties\/(\d+)-/gi,
  bidx1:                     /bidx1\.com\/[a-z]{2}\/property\/([a-z0-9-]+)/gi,
  // McHugh runs on the EIG platform but on their own domain — the standard
  // EIG /lot/details/{N} pattern applies. Earlier bespoke pattern
  // (/auction-property|lot/{slug}) never matched the real URLs.
  mchughandco:               /\/lot\/(?:details|redirect)\/(\d+)/g,

  // ── 8 houses sourced from propertyauctions.io sitemap (2026-05-06, Tier 1) ──
  // Hammertime is on EIG platform — sentinel auto-applies via detectPlatformSentinel(),
  // but listed explicitly for uniformity per the "every house gets a sentinel" rule.
  hammertime:                /\/lot\/(?:details|redirect)\/(\d+)/g,
  // Clean patterns — verified from sample lot URLs in discovery research
  swpropertyauctions:        /swpropertyauctions\.co\.uk\/lot\/details\/(\d+)/gi,
  theauctioncompany:         /theauctioncompany\.co\.uk\/lot\/details\/(\d+)/gi,
  // Mixed sample (auction-event + lot pages) — covers both
  auctionproperty:           /auctionproperty\.co\.uk\/(?:property|auction)\/([a-z0-9-]+)/gi,
  // Fallback patterns — discovery script's catalogueUrl was the homepage so
  // exact lot URL not yet observed. Generic keyword-match regex catches
  // /lot/, /property/, /auction/, /listing/ paths with an ID/slug. Will
  // surface real recall once first scrape lands; refine then.
  auctiondepartment:         /auctiondepartment\.com\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
  landmarkauctions:          /landmarkauctions\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
  rocketauctions:            /rocketauctions\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
  swiftauctions:             /swiftpropertyauctions\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,

  // ── 12 houses sourced from Firecrawl /v2/search (2026-05-06) ──
  // Clean patterns observed in lot URLs:
  braveheart:                /braveheartauctions\.co\.uk\/product\/([a-z0-9-]+)/gi,
  gogogone:                  /gogogone\.com\/auction\/(\d+)/gi,
  opagroup:                  /opagroup\.co\.uk\/lot\/details\/(\d+)/gi,
  barneyestates:             /barneyestates\.co\.uk\/property\/([a-z0-9-]+)/gi,
  // Specific multi-segment lot URL structures (manually crafted):
  midulsterauctions:         /online\.midulsterauctions\.com\/lot-details\/index\/catalog\/\d+\/lot\/(\d+)/gi,
  belfastauctions:           /belfastauctions\.com\/catalogue\/lot\/[A-F0-9]+\/[A-F0-9]+\/([a-z0-9-]+)/gi,
  // Fallback patterns — homepage scan didn't reveal lot URL pattern;
  // refine after first recall_diagnostic alert lands:
  firstchoiceauctions:       /firstchoicepropertyauctions\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
  palaceauctions:            /palaceauctions\.com\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
  whoobid:                   /whoobid\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
  propertyauctionhouseswansea: /thepropertyauctionhouse\.com\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
  auctionsni:                /auctionsni\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,
  nationalresidential:       /national-residential\.co\.uk\/(?:lot|property|auction|listing)s?\/(\d+|[a-z0-9-]{6,})/gi,

  // ── Bespoke houses — patterns sourced from live lot URLs (research 2026-05-22) ──

  // Numeric/path ID patterns:
  aldreds:              /aldreds\.co\.uk\/properties-for-sale\/property\/(\d+[\w-]*)/gi,
  bramleys:             /bramleys\.com\/property-details\/(\d+)/gi,
  cliveemson:           /cliveemson\.co\.uk\/properties\/\d+\/(\d+)/gi,
  earles:               /earlesgroup\.co\.uk\/property-details\/(\d+)/gi,
  grahamwatkins:        /grahamwatkins\.(?:co\.uk|com)\/property\/(\d+)/gi,
  hairandson:           /hairandson\.co\.uk\/lot-details\?lot=(\d+)/gi,
  leonards:             /leonards-property\.co\.uk\/property\.php\?id=(\d+)/gi,
  mellerbraggins:       /mellerbraggins\.com\/property\/[\w-]+\/(\d+)/gi,
  phippsandpritchard:   /phippsandpritchard\.co\.uk\/properties\/(\d+)/gi,
  screetons:            /screetons\.co\.uk\/property\/[\w-]+\/(\d+)/gi,
  taylerandfletcher:    /taylerandfletcher\.co\.uk\/for-sale\/[\w-]+\/[\w-]+\/[\w-]+\/(\d+)/gi,
  webbers:              /webbers\.co\.uk\/property-for-sale\/[\w-]+\/(\d+)/gi,
  wilsons:              /wilsonsauctions\.com\/auctions\/[\w-]+\/lots\/(\d+)/gi,
  woolleyandwallis:     /woolleyandwallis\.co\.uk\/departments\/[\w-]+\/[\w]+\/view-lot\/(\d+)/gi,
  yoowin:               /yoowin\.co\.uk\/lot\/details\/(\d+)/gi,

  // Slug-only paths:
  auctionhouselondon:   /auctionhouselondon\.co\.uk\/lot\/([\w-]+-\d+)/gi,
  bakerwynnewilson:     /bakerwynneandwilson\.com\/property\/([\w-]+)/gi,
  clarkegammon:         /clarkegammon\.co\.uk\/property\/([\w-]+)/gi,
  cloughandco:          /cloughco\.com\/property\/([\w-]+)/gi,
  gherbertbanks:        /gherbertbanks\.co\.uk\/property\/([\w-]+)/gi,
  halls:                /hallsgb\.com\/property_post_item\/([\w-]+)/gi,
  humberts:             /humberts\.com\/property\/([\w-]+)/gi,
  morganbeddoe:         /morgan-beddoe\.co\.uk\/property\/([\w-]+)/gi,
  nicholasjames:        /nicholasjamesproperty\.co\.uk\/property\/([\w-]+)/gi,
  opendoor:             /opendoorauctions\.co\.uk\/properties-for-sale\/([\w-]+)/gi,
  pennineways:          /pennine-ways\.co\.uk\/property\/([\w-]+)/gi,
  phillipssmithanddunn: /phillipsland\.com\/property\/([\w-]+)/gi,
  primepropertyauctions: /primepropertyauctions\.co\.uk\/property\/([\w-]+)/gi,
  smithandsons:         /smithandsons\.net\/auctionproperties\/([\w-]+)/gi,
  wmsykes:              /wmsykes\.co\.uk\/property\/([\w-]+)/gi,

  // Hash/special ID paths:
  strakers:             /strakers\.co\.uk\/(?:auction-)?property-for-sale\/[\w-]+-([0-9a-f]{24})/gi,

  // gwilymrichards lists via Knight Frank Auctions — same host as 'knightfrank' above
  gwilymrichards:       /knightfrankauctions\.com\/property\/(\d+)/gi,

  // ── Universal-coverage sweep (2026-06-12) — the 19 remaining blind spots ──
  // Patterns verified from production lots.url samples where real lots exist;
  // domain-scoped keyword fallbacks otherwise (the established convention —
  // refine after the first recall_diagnostic lands).

  // Verified from lots.url samples:
  hawkesford:           /hawkesford\.co\.uk\/property\/([\w-]+)/gi,
  howkinsandharrison:   /howkinsandharrison\.co\.uk\/auction\/(\d+)/gi,
  // fisherGerman lots live on their Bamboo subdomain (HOUSE_ROOTS points at
  // fishergerman.co.uk so platform auto-detection misses it).
  fisherGerman:         /fishergerman\.bambooauctions\.com\/property\/([a-z0-9_-]{6,})/gi,
  // williamhbrownnorwich + sequence route lots through the Sequence network's
  // barnardmarcusauctions.co.uk platform (verified from lots.url 2026-06-12).
  williamhbrownnorwich: /barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi,
  sequence:             /(?:barnardmarcus|sequence)auctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi,
  // dedmangray is an EIG embed (tenant 33) — lots link via ?lid= or /lot/details/.
  dedmangray:           /(?:[?&]lid=|\/lot\/(?:details|redirect)\/)(\d+)/g,

  // Domain-scoped keyword fallbacks (no real lot URLs in DB yet — the only
  // rows for several of these were fabricated example.com lots, quarantined
  // 2026-06-12). Refine when the first genuine scrape lands:
  hobbsparker:          /hobbsparker\.co\.uk\/(?:propert(?:y|ies)|lot)[a-z-]*\/([a-z0-9-]{6,})/gi,
  regionalauctioneers:  /regionalpropertyauctioneers\.co\.uk\/(?:propert(?:y|ies)|lot)[a-z-]*\/([a-z0-9-]{6,})/gi,
  foxgrant:             /foxgrant\.com\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
  luscombemaye:         /luscombemaye\.com\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
  morrismarshall:       /morrismarshall\.co\.uk\/(?:propert(?:y|ies)|lot|details)[a-z-]*\/([a-z0-9-]{6,})/gi,
  bootandson:           /bootandson\.co\.uk\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
  boultons:             /boultonsestateagents\.co\.uk\/(?:propert(?:y|ies)|lot|details)[a-z-]*\/([a-z0-9-]{6,})/gi,
  buryandhilton:        /buryandhilton\.co\.uk\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
  fidlertaylor:         /fidler-taylor\.co\.uk\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
  lambertandfoster:     /lambertandfoster\.co\.uk\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
  shobrook:             /shobrook\.co\.uk\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
  andrewkelly:          /andrew-kelly\.co\.uk\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
  michaelpoole:         /michaelpoole\.co\.uk\/(?:propert(?:y|ies)|lot|auction)[a-z-]*\/([a-z0-9-]{6,})/gi,
};

// Platform-level sentinel auto-detection. EIG, Auction House UK, and Bamboo
// each share a stable lot URL format across all houses on the platform — so
// any house whose HOUSE_ROOTS URL is on one of these domains gets the right
// pattern automatically, no per-house entry needed. Whitelabel sites on
// custom domains (e.g. harman-healy.co.uk runs on EIG) need an explicit
// RECALL_SENTINELS entry above.
export function detectPlatformSentinel(slug) {
  const rootUrl = HOUSE_ROOTS[slug] || '';
  // Auction House UK franchise — both lot-URL forms (see AUCTIONHOUSE_SENTINEL).
  // Fresh clone so callers never share this module-level regex's lastIndex.
  if (rootUrl.includes('auctionhouse.co.uk')) {
    return new RegExp(AUCTIONHOUSE_SENTINEL.source, AUCTIONHOUSE_SENTINEL.flags);
  }
  // EIG platform: /lot/details/{id} or /lot/redirect/{id}
  if (rootUrl.includes('eigonlineauctions.com') ||
      rootUrl.includes('eigpropertyauctions.co.uk')) {
    return /\/lot\/(?:details|redirect)\/(\d+)/g;
  }
  // Bamboo Auctions: /property/{slug-id}
  if (rootUrl.includes('bambooauctions.com')) {
    return /\/property\/([a-z0-9_-]{6,})/gi;
  }
  // iamSold network: estate agents whose auctions route through iamsold.co.uk
  if (rootUrl.includes('iamsold.co.uk')) {
    return /iamsold\.co\.uk\/property\/([a-f0-9]{32})/gi;
  }
  return null;
}

// Documented exceptions to the "every house has a sentinel" rule — the
// pressure valve for tests/test-sentinel-coverage.js, which fails if a house
// is neither resolvable nor listed here. Currently empty (universal coverage
// as of 2026-06-12); add `slug: 'reason'` when a house genuinely has no lot
// URL to count (e.g. a JSON-API or PDF-only catalogue).
export const KNOWN_SENTINEL_GAPS = {};

/**
 * The sentinel for a house, walking the documented resolution ladder.
 * @param {string} slug
 * @param {RegExp|null} [override] - per-house override (HOUSE_OVERRIDES / HOUSE_RECOGNISERS)
 * @returns {RegExp|null}
 */
export function resolveRecallSentinel(slug, override = null) {
  return override || RECALL_SENTINELS[slug] || detectPlatformSentinel(slug) || null;
}

// ── Sentinel-id counting (shared) ──────────────────────────────────────────
// Distinct advertised lot-ids in rendered content — the recall denominator and
// the fingerprint's lot-count signal. Strips <script>/<style> so sentinel hits
// inside inline JSON/analytics don't inflate the count, and tolerates a
// sentinel without the global flag. One implementation for the production
// recall path (crawlee-extract), the structure fingerprint, and the A/B script
// (previously three near-identical copies that could drift).

/** Distinct capture-group-1 ids matched by `pattern` in one text blob. */
export function sentinelIdsFromText(text, pattern) {
  const ids = new Set();
  if (!pattern || !text) return ids;
  const src = String(text)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const re = pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, pattern.flags + 'g');
  for (const m of src.matchAll(re)) { if (m[1]) ids.add(m[1]); }
  return ids;
}

/** Count of distinct sentinel ids across rendered pages (markdown preferred
 *  when a recogniser produced it — matches the Firecrawl markdown denominator). */
export function countSentinelIds(pages, pattern, { preferMarkdown = false } = {}) {
  if (!pattern) return 0;
  const ids = new Set();
  for (const p of (pages || [])) {
    const text = (preferMarkdown && p.markdown) ? p.markdown : (p.html || '');
    for (const id of sentinelIdsFromText(text, pattern)) ids.add(id);
  }
  return ids.size;
}
