// lib/houses.js — Auction house registry, detection, and URL rewriting
import { HEADERS } from './config.js';
import { scrapeWithCrawlee, hasCrawlee } from './scraper/crawlee.js';

// ── Module-level dependencies (injected from server.js via initHouses) ──
let FIRECRAWL_API_KEY = '';
let fcCreditExhausted = false;
let scrapeWithFirecrawl = null;

/**
 * Inject server-level dependencies that rewriteUrl needs.
 * Call once during startup, e.g.:
 *   initHouses({ FIRECRAWL_API_KEY, fcCreditExhausted: () => fcCreditExhausted, scrapeWithFirecrawl });
 *
 * fcCreditExhaustedFn should be a *getter* function because the value is mutable.
 */
export function initHouses({ firecrawlApiKey, getFcCreditExhausted, scrapeWithFirecrawlFn }) {
  FIRECRAWL_API_KEY = firecrawlApiKey || '';
  if (getFcCreditExhausted) {
    // Replace the module-level variable with a getter-backed proxy
    Object.defineProperty(module_state, 'fcCreditExhausted', { get: getFcCreditExhausted, configurable: true });
  }
  scrapeWithFirecrawl = scrapeWithFirecrawlFn || null;
}

// Internal state holder so we can use a getter for fcCreditExhausted
const module_state = { get fcCreditExhausted() { return fcCreditExhausted; } };

// ═══════════════════════════════════════════════════════════════
// Each house's root/listing page where upcoming auction catalogue links can be found.
// Used by /api/discover-catalogues to auto-detect new auction URLs when they change.
export const HOUSE_ROOTS = {
  savills:            'https://auctions.savills.co.uk/upcoming-auctions', // Auto-discovers actual catalogue via rewriteUrl
  allsop:             'https://www.allsop.co.uk/auctions/residential-auctions/',
  btgeddisons:        'https://www.btgeddisonspropertyauctions.com/properties/',
  bondwolfe:          'https://www.bondwolfe.com/auctions/properties/',
  barnardmarcus:      'https://www.barnardmarcusauctions.co.uk/auctions/upcoming/',
  auctionhouselondon: 'https://auctionhouselondon.co.uk/current-auction',
  auctionhouse:       'https://www.auctionhouse.co.uk/online',
  cliveemson:         'https://www.cliveemson.co.uk/properties/',
  strettons:          'https://www.strettons.co.uk/auctions/current-catalogue/',
  acuitus:            'https://www.acuitus.co.uk/find-a-property/',
  hollismorgan:       'https://www.hollismorgan.co.uk/search-auction/',
  maggsandallen:      'https://www.maggsandallen.co.uk/search-auction/',
  mchughandco:        'https://www.mchughandco.com/current-auction',
  knightfrank:        'https://www.knightfrankauctions.com/',
  pattinson:          'https://www.pattinson.co.uk/auction/property-search',
  bidx1:              'https://bidx1.com/en/united-kingdom',
  philliparnold:      'https://www.philliparnoldauctions.co.uk/current-lots',
  edwardmellor:       'https://www.edwardmellor.co.uk/auction/',
  paulfosh:           'https://paulfosh.eigonlineauctions.com/search',
  cottons:            'https://www.cottons.co.uk/auction-archive/',
  dedmangray:         'https://www.dedmangray.co.uk/auction/',
  barnettross:        'https://www.barnettross.co.uk/current.php',
  bradleyhall:        'https://auction.bradleyhall.co.uk/',
  connectuk:          'https://connectukgroup.co.uk/for-sale/',
  auctionestates:     'https://www.auctionestates.co.uk/view-properties',
  landwood:           'https://www.landwoodpropertyauctions.com/future-auctions?showall=true',
  loveitts:           'https://www.eigpropertyauctions.co.uk/live-stream/auction/loveitts',
  hunters:            'https://hunters.bambooauctions.com',
  probateauction:     'https://probate.auction/auctions/',
  // ── New houses ──
  countrywide:        'https://www.propertyauctionsouthwest.co.uk/',
  venmore:            'https://www.venmoreauctions.co.uk/Property-Search',
  tcpa:               'https://www.townandcountrypropertyauctions.co.uk/search',
  futureauctions:     'https://www.futurepropertyauctions.co.uk/catalogue_viewall.asp',
  kivells:            'https://www.kivells.com/residential-property/properties-for-auction',
  firstforauctions:   'https://online.firstforauctions.co.uk/search?view=Grid',
  harmanhealy:        'https://www.harman-healy.co.uk/search',
  seelauctions:       'https://online.seelauctions.co.uk/search?view=Grid&showall=true',
  robinsonhall:       'https://robinsonandhallauctions.co.uk/auctions/available-lots/',
  // ── EIG batch (March 2026) ──
  astleys:            'https://astleys.eigonlineauctions.com/search',
  henrysykes:         'https://onlineauctions.henrysykes.co.uk/search',
  clarkesimpson:      'https://clarke-simpson.eigonlineauctions.com/search',
  durrants:           'https://durrants.com/property-auctions/next-property-auction',
  dawsons:            'https://www.dawsonsproperty.co.uk/auctions.php',
  goldings:           'https://www.goldingsauctions.co.uk/auctions/next-auction/',
  auctionhousescotland: 'https://www.auctionhouse.co.uk/scotland/auction/search-results',
  austingray:         'https://www.auctionhouse.co.uk/sussexandhampshire',
  // ── New houses (March 2026 batch 2) ──
  agentsproperty:     'https://www.agentspropertyauction.com/property-search/',
  andrewcraig:        'https://www.andrewcraig.co.uk/auction-property-for-sale',
  buttersjohnbee:     'https://buttersjohnbee.com/listings?viewType=gallery&sortby=dateListed-desc&saleOrRental=Sale&auction=1&status=all',
  brownco:            'https://brownandco.eigonlineauctions.com/search',
  cheffins:           'https://www.cheffins.co.uk/property-auctions/',
  cheffinstimed:      'https://www.cheffins.co.uk/property-auctions.htm',
  fssproperty:        'https://www.eigpropertyauctions.co.uk/live-stream/auction/feather-smailes-scales',
  iamsold:            'https://www.iamsold.co.uk/available-properties/',
  suttonkersh:        'https://www.suttonkersh.co.uk/properties/gallery/?section=auction&auctionPeriod=current',
  // ── Auction House UK regional branches (March 2026 batch 3) ──
  auctionhouseeastanglia: 'https://www.auctionhouse.co.uk/eastanglia/auction/search-results',
  auctionhousenorthwest:  'https://www.auctionhouse.co.uk/northwest/auction/search-results',
  auctionhousenortheast:  'https://www.auctionhouse.co.uk/northeast/auction/search-results',
  auctionhousewales:      'https://www.auctionhouse.co.uk/southwales/auction/search-results',
  auctionhousebirmingham: 'https://www.auctionhouse.co.uk/birmingham/auction/search-results',
  auctionhousekent:       'https://www.auctionhouse.co.uk/kent/auction/search-results',
  // ── Auction House UK regional branches (batch 4, March 2026) ──
  auctionhousedevon:      'https://www.auctionhouse.co.uk/devonandcornwall/auction/search-results',
  // auctionhouseeastmidlands retired 2026-04-24 — branch consolidated/closed,
  // /eastmidlands path now 404s. Slug + display name kept for historical lots.
  auctionhousewestmidlands: 'https://www.auctionhouse.co.uk/westmidlands/auction/search-results',
  auctionhouseessex:      'https://www.auctionhouse.co.uk/essex/auction/search-results',
  auctionhousemanchester: 'https://www.auctionhouse.co.uk/manchester/auction/search-results',
  // ── EIG platform houses (batch 4, March 2026) ──
  romanway:               'https://romanway.eigonlineauctions.com/search',
  hammerprice:            'https://hammerprice.eigonlineauctions.com/search',
  // ── Auction House UK regional branches (batch 5, March 2026) ──
  auctionhousesouthyorkshire:  'https://www.auctionhouse.co.uk/southyorkshire/auction/search-results',
  auctionhousewestyorkshire:   'https://www.auctionhouse.co.uk/westyorkshire/auction/search-results',
  auctionhouseteesvalley:      'https://www.auctionhouse.co.uk/teesvalley/auction/search-results',
  auctionhousehull:            'https://www.auctionhouse.co.uk/hullandeastyorkshire/auction/search-results',
  auctionhousecumbria:         'https://www.auctionhouse.co.uk/cumbria/auction/search-results',
  auctionhouselincolnshire:    'https://www.auctionhouse.co.uk/lincolnshire/auction/search-results',
  auctionhouseuklondon:        'https://www.auctionhouse.co.uk/london/auction/search-results',
  auctionhousebedsandbucks:    'https://www.auctionhouse.co.uk/bedsandbucks/auction/search-results',
  auctionhousenorthamptonshire:'https://www.auctionhouse.co.uk/northamptonshire/auction/search-results',
  auctionhouseoxfordshire:     'https://www.auctionhouse.co.uk/oxfordshire/auction/search-results',
  auctionhouseleicestershire:  'https://www.auctionhouse.co.uk/leicestershire/auction/search-results',
  auctionhousemidlands:        'https://www.auctionhouse.co.uk/midlands/auction/search-results',
  auctionhousecoventry:        'https://www.auctionhouse.co.uk/coventryandwarwickshire/auction/search-results',
  auctionhousenottsandderby:   'https://www.auctionhouse.co.uk/nottsandderby/auction/search-results',
  auctionhousechesterfield:    'https://www.auctionhouse.co.uk/chesterfieldandnorthderbyshire/auction/search-results',
  auctionhousestaffordshire:   'https://www.auctionhouse.co.uk/staffordshire/auction/search-results',
  auctionhousenorthwales:      'https://www.auctionhouse.co.uk/northwales/auction/search-results',
  auctionhousesouthwest:       'https://www.auctionhouse.co.uk/southwest/auction/search-results',
  auctionhousenorthernireland: 'https://www.auctionhouse.co.uk/northernireland/auction/search-results',
  auctionhousenational:        'https://www.auctionhouse.co.uk/national/auction/search-results',
  // ── EIG platform houses (batch 5, March 2026) ──
  sarahmains:             'https://www.auctionworks.co.uk/search',
  sageandco:              'https://sageandco.eigonlineauctions.com/search',
  auctiontrade:           'https://auctiontrade.eigonlineauctions.com/search',
  brggibson:              'https://brggibsonbelfastauctions.eigonlineauctions.com/search',
  higginsdrysdale:        'https://higginsdrysdale.eigonlineauctions.com/search',
  martinpole:             'https://martinpole.eigonlineauctions.com/search',
  jonespeckover:          'https://jonespeckover.eigonlineauctions.com/search',
  thepropertyauctionhouse:'https://thepropertyauctionhouse.eigonlineauctions.com/search',
  propertyauctionagent:   'https://propertyauctionagent.eigonlineauctions.com/search',
  lot9:                   'https://lot9.eigonlineauctions.com/search',
  auctionnorth:           'https://auction-north.eigonlineauctions.com/search',
  bowensonandwatson:      'https://bowensonandwatson.eigonlineauctions.com/search',
  sheldonbosley:          'https://online.sbkauctions.co.uk/search',
  nationalpropertyauctions:'https://nationalpropertyauctions.eigonlineauctions.com/search',
  // ── Regional/independent houses (batch 6, March 2026) ──
  underthehammer:         'https://www.underthehammer.com/for-auction/properties',
  lsk:                    'https://lacyscottandknight.bambooauctions.com/',
  // ── Tier 2: High-value targets (March 2026) ──
  foxandsons:             'https://www.foxandsonsauctions.co.uk/',
  bagshaws:               'https://www.bagshawsauctions.co.uk/',
  wilsons:                'https://www.wilsonsauctions.com/auctions/land-property-auctions',
  strakers:               'https://www.strakers.co.uk/property-auctions/',
  // John Pye DOES run property auctions — they live at /properties/ (the rest of
  // the site is industrial/vehicle/white-goods asset disposal, out of scope). The
  // 2026-05-30 retirement mistook the whole site for non-property; un-retired
  // 2026-06-27 and pointed at the property listing. Detail pages are /auctions/{slug}/.
  johnpye:                'https://www.johnpye.co.uk/properties/',
  // ── Batch 7: Tier 1 expansion (March 2026) ──
  symondsandsampson:      'https://auctions.symondsandsampson.co.uk/events/property-auction/symonds-and-sampson-property-auctions?eventdate=upcoming',
  stags:                  'https://stags.bambooauctions.com/',
  lsh:                    'https://propertyauctions.lsh.co.uk/',
  carterjonas:            'https://carterjonas.bambooauctions.com/',
  gth:                    'https://www.gth.net/properties/sales/tag-auction',
  halls:                  'https://www.hallsgb.com/property-search/?search_type=auction',
  walkersingleton:        'https://onlinesales.walkersingleton.co.uk/',
  driversnorris:          'https://www.iamsold.co.uk/estate-agent/drivers/',
  shonkibros:             'https://www.shonkibros.com/auctions/latest-auctions/view',
  robinjessop:            'https://www.robinjessop.co.uk/auctions',
  // ── Batch 7: Tier 2 expansion ──
  cleetompkinson:         'https://www.ctf-uk.com/properties/sales/tag-auction',
  mccartneys:             'https://www.mccartneys.co.uk/property-search/?department=property-land-auctions',
  bramleys:               'https://www.bramleys.com/search/?instruction_type=Sale&department=Auction',
  cooperandtanner:        'https://www.eigpropertyauctions.co.uk/live-stream/auction/cooper-tanner-auctions',
  brutonknowles:          'https://www.brutonknowles.co.uk/property-search/?department=auction',
  fisherGerman:           'https://www.fishergerman.co.uk/auctions',
  woolleyandwallis:       'https://www.woolleyandwallis.co.uk/property/auction/',
  hobbsparker:            'https://www.hobbsparker.co.uk/auctioneers/',
  // arnoldskeys — CONFIRMED: machinery auctions only, not property (re-verified 2026-04-05)
  // twgaze — REMOVED: antiques/chattels auctioneer, not property
  hairandson:             'https://www.hairandson.co.uk/auction',
  phillipssmithanddunn:   'https://www.phillipsland.com/auction',
  webbers:                'https://webbers.bambooauctions.com/',
  // ── Batch 7: EIG platform additions ──
  ahlondon:               'https://ahlondon.eigonlineauctions.com/search',
  starpropertyonline:     'https://star-property-online.eigonlineauctions.com/search',
  brggibsondublin:        'https://brggibsondublinauctions.eigonlineauctions.com/search',
  // ── Batch 8: Comprehensive UK coverage (March 2026) ──
  // National / Online
  propertysolvers:        'https://auctions.propertysolvers.co.uk/auction-property-for-sale/',
  pugh:                   'https://www.pugh-auctions.com/property-search?include-sold=off',
  // Mark Jenkinson runs multiple auctions in parallel, each at its own
  // /auction/{datestamp_token} URL. /property-search aggregates legacy
  // numeric-ID lots that show as "sold" — using the homepage as the root
  // so calendar-sync points at the discovery surface; the per-auction
  // URLs live in auction_calendar with their actual dates.
  markjenkinson:          'https://www.markjenkinson.co.uk/',
  regionalauctioneers:    'https://www.regionalpropertyauctioneers.co.uk/properties',
  // South East
  clarkegammon:           'https://www.clarkegammon.co.uk/auction/',
  nesbits:                'https://www.nesbits.co.uk/auctions/',
  pearsons:               'https://www.pearsons.com/properties/auctions',
  foxgrant:               'https://www.foxgrant.com/auctions/',
  // lextons — REMOVED: domain parked, redirects to /lander
  // South West
  bradleysdevon:          'https://www.bradleys-estate-agents.co.uk/properties/sales/tag-auction',
  taylerandfletcher:      'https://www.taylerandfletcher.co.uk/property-auctions/',
  luscombemaye:           'https://www.luscombemaye.com/auctions/',
  // lodgeandthomas — REMOVED: domain parked (GoDaddy), no longer active
  // bondoxboroughphillips — REMOVED: site unreachable (connection timeout)
  // Charles Darrow — INDEPENDENT Devon/Cornwall auctioneer on its own ASP.NET
  // site. (The earlier "acquired by BTG Eddisons, folded into sdl" note was
  // wrong — de-conflated 2026-06-21: charlesdarrow is its own house with its
  // own /propertyInfo/ catalogue and ImageServer.aspx photos.) The /Auctions/
  // grid is AJAX-loaded into #resultsControl, so it needs a browser render.
  charlesdarrow:          'https://www.charlesdarrow.co.uk/Auctions/',
  // Eastern England
  aldreds:                'https://www.aldreds.co.uk/auction/',
  // humberts — REMOVED: general estate agency, not an auction house
  // Wales
  allwalesauction:        'https://thepropertypeople.bambooauctions.com',
  // evansbros — REMOVED: 404 on auction URL, no property auction page found
  // herbertrthomasandco — REMOVED: site unreachable (connection timeout)
  johnfrancis:            'https://www.johnfrancis.co.uk/properties/sales/tag-auction',
  morrismarshall:         'https://www.morrismarshall.co.uk/search/?instruction_type=Auction',
  // Midlands
  // andrewgrant — REMOVED: estate agent only, no dedicated auction listings
  gherbertbanks:          'https://gherbertbanks.co.uk/online-auctions/',
  hawkesford:             'https://www.hawkesford.co.uk/auctions/',
  howkinsandharrison:     'https://www.howkinsandharrison.co.uk/auctions/',
  scargillmann:           'https://www.sdlauctions.co.uk/properties/',
  // North West
  mellerbraggins:         'https://www.mellerbraggins.com/auctions/',
  smithandsons:           'https://www.smithandsons.net/auctionproperties/1113347',
  wrightmarshall:         'https://www.iamsold.co.uk/estate-agent/wrightmarshall/',
  // North East / Cumbria / Lake District
  // hackneyandleigh — REMOVED: site down (ECONNREFUSED)
  // Scotland
  // onlinepropertyauctionsscotland — REMOVED: site down (ECONNREFUSED)
  // ── GOTO Properties platform (EIG-based, April 2026) ──
  purplebricksgoto:       'https://purplebricks.gotoproperties.co.uk/search?pagesize=48',
  // ── Verified EIG subdomains (April 2026) ──
  groundrentauctions:     'https://groundrentauctions.eigonlineauctions.com/search',
  benjaminstevens:        'https://online.benjaminstevensauctions.co.uk/search',
  // ── New houses from own websites (April 2026) ──
  auctionhammermidlands:  'https://auctionhammermidlands.co.uk/auction/',
  sharpesauctions:        'https://www.sharpesauctions.co.uk/current-traditional-auction.php',
  jjmorris:               'https://www.jjmorris.com/list-search-results/?auction=1&showstc=on',
  rendells:               'https://rendells.bambooauctions.com',
  pearsonferrier:         'https://pearsonferrier.co.uk/next-auctions/',
  // ── EIG houses from discovery (April 2026) ──
  '247propertyauctions':  'https://247auction.bambooauctions.com',
  rogerparry:             'https://rogerparry.eigonlineauctions.com/search',
  hmox:                   'https://auctions.hmox.co.uk/search',
  cotswoldpropertyauctions: 'https://www.cotswoldpropertyauctions.co.uk/search',
  // ── Own-website houses from discovery (April 2026) ──
  cityandruralpropertyauctions: 'https://cityandruralpropertyauctions.com/properties/',
  // ── William H Brown (Sequence platform, April 2026) ──
  williamhbrownnorwich:   'https://www.williamhbrownauctions-norwich.co.uk/Current_Auction.html',
  // ── propertyauctionaction.co.uk directory expansion (May 2026) ──
  // 25 UK auction houses sourced from the Property Auction Action directory.
  // Houses with UNREACHABLE / ambiguous catalogue URLs were skipped.
  // Self-healing will fire `extractor_regression` if any of these don't yield lots.
  bakerwynnewilson:       'https://bakerwynneandwilson.com/auctions/',
  bootandson:             'https://bootandson.co.uk/auctions',
  boultons:               'https://www.boultonsestateagents.co.uk/Services/Current-and-Previous-Auction-Properties',
  buryandhilton:          'https://buryandhilton.co.uk/property-auctions/',
  cloughandco:            'https://cloughco.com/for-sale/',
  earles:                 'https://earlesgroup.co.uk/auction-sales/',
  fidlertaylor:           'https://www.fidler-taylor.co.uk/property-auctions',
  grahamwatkins:          'https://www.grahamwatkins.co.uk/property-auctions/current-auction-properties',
  gwilymrichards:         'https://www.grichards.co.uk/land-property/auctions',
  lambertandfoster:       'https://www.lambertandfoster.co.uk/auctions-forthcoming-sale-dates/',
  leonards:               'https://www.leonards-property.co.uk/auctions-sales/property-auctions',
  morganbeddoe:           'https://morgan-beddoe.co.uk/',
  nicholasjames:          'https://nicholasjamesproperty.co.uk/property-search/auctions/',
  pennineways:            'https://pennine-ways.co.uk/land-sales-and-auctions/',
  phippsandpritchard:     'https://www.phippsandpritchard.co.uk/pages/property-and-land-for-auction',
  primepropertyauctions:  'https://primepropertyauctions.co.uk/properties/',
  screetons:              'https://www.screetons.co.uk/current-property-auction-catalogue',
  shobrook:               'https://www.shobrook.co.uk/property-auctions',
  wmsykes:                'https://wmsykes.co.uk/auctions/',
  yoowin:                 'https://auctions.yoowin.co.uk/search',
  // Medium confidence — caveats noted in display name comment
  andrewkelly:            'https://www.andrew-kelly.co.uk/property-auction-services',
  davidjames:             'https://www.charteredsurveyors.david-james.co.uk/auctions',
  opendoor:               'https://www.opendoorauctions.co.uk/properties-for-sale/',
  sequence:               'https://www.sequenceauctions.co.uk/Sequence-Current-Auctions.html',
  michaelpoole:           'https://michaelpoole.co.uk/auction-property-for-sale',

  // ── 8 houses sourced from propertyauctions.io sitemap (2026-05-06) ──
  // Strict-filter Tier 1: clean URL/lot patterns visible in catalogue scrape.
  // Hammertime is on EIG platform — auto-classifies via detectPlatformSentinel.
  // Other 7 are bespoke; sentinels live in lib/analysis.js RECALL_SENTINELS.
  hammertime:             'https://hammertime-property-auctions.eigonlineauctions.com/',
  auctiondepartment:      'https://auctiondepartment.com/',
  auctionproperty:        'https://auctionproperty.co.uk/',
  landmarkauctions:       'https://landmarkauctions.co.uk/',
  rocketauctions:         'https://www.rocketauctions.co.uk/',
  swiftauctions:          'https://www.swiftpropertyauctions.co.uk/',
  swpropertyauctions:     'https://swpropertyauctions.co.uk/',
  theauctioncompany:      'https://www.theauctioncompany.co.uk/',

  // ── 12 houses sourced from Firecrawl /v2/search (2026-05-06) ──
  // Discovered via scripts/discover-houses-search.mjs — search-driven
  // discovery independent of third-party directories. UK + auction-keyword
  // filter applied. Sentinels in lib/analysis.js RECALL_SENTINELS.
  firstchoiceauctions:        'https://firstchoicepropertyauctions.co.uk/',
  palaceauctions:             'https://palaceauctions.com/',
  belfastauctions:            'https://www.belfastauctions.com/',
  midulsterauctions:          'https://midulsterauctions.com/',
  braveheart:                 'https://braveheartauctions.co.uk/',
  whoobid:                    'https://www.whoobid.co.uk/',
  gogogone:                   'https://gogogone.com/',
  propertyauctionhouseswansea:'https://thepropertyauctionhouse.com/',
  auctionsni:                 'https://auctionsni.co.uk/',
  opagroup:                   'https://www.opagroup.co.uk/',
  nationalresidential:        'https://properties.national-residential.co.uk/auction',
  barneyestates:              'https://www.barneyestates.co.uk/commercial/',

  // ── SDL Property Auctions (de-conflation plan 4, onboarded 2026-06-22) ──
  // Major UK auctioneer, now trading under the BTG Eddisons brand but still
  // running its own catalogue at sdlauctions.co.uk. The /search/ grid is
  // AJAX-hydrated (WordPress theme `searchProperty()` POSTs to property-functions.php),
  // so it needs a browser render before the recogniser
  // (recogniseSdlAuctionsLotsFromMarkdown) runs. Lots are /property/{id}/{slug}/.
  // (Previously we were persisting FABRICATED lots under a mis-wired slug — see
  // RETIRED_HOUSES `scargillmann`; a separate migration purges those.)
  sdlauctions:                'https://www.sdlauctions.co.uk/search/',
};

/*
 * ── LIVE EXTRACTION TEST RESULTS (Plan 02-03, 2026-03-15) ──
 * All 15 new houses PASS with >0 lots. Total 3,315 lots (page 1), 99.6% images.
 *
 * agentsproperty:          84 lots,  84 imgs, 100% price — WordPress cards
 * andrewcraig:             24 lots,  24 imgs, 100% price — Estate Apps
 * buttersjohnbee:          12 lots,   0 imgs, 100% price — Rex v2 (images need Firecrawl)
 * cheffins:                10 lots,  10 imgs,  50% price — Own platform (catalogue-view)
 * cheffinstimed:           15 lots,  15 imgs,  60% price — EIG platform
 * fssproperty:              1 lots,   1 imgs, 100% price — Same CMS as Hollis Morgan
 * iamsold:                  5 lots,   5 imgs, 100% price — data-bkimage cards
 * brownco:                 50 lots,  50 imgs,  96% price — EIG platform
 * suttonkersh:             16 lots,  16 imgs,  94% price — start=N pagination (108 total)
 * auctionhouseeastanglia: 506 lots, 506 imgs,  88% price — AH UK branch
 * auctionhousenorthwest:  916 lots, 916 imgs,  81% price — AH UK branch
 * auctionhousenortheast:  722 lots, 722 imgs,  81% price — AH UK branch
 * auctionhousewales:      606 lots, 606 imgs,  72% price — AH UK branch
 * auctionhousebirmingham: 206 lots, 206 imgs,  62% price — AH UK branch
 * auctionhousekent:       142 lots, 142 imgs,  68% price — AH UK branch
 *
 * Blocked/inaccessible (not added): Symonds & Sampson, GTH, All Wales Auction
 */
// Now that HOUSE_ROOTS is defined, populate the image backfill set
export const PUPPETEER_IMAGE_HOUSES = new Set(Object.keys(HOUSE_ROOTS));

// Houses removed from active rotation. Entries stay in HOUSE_ROOTS /
// HOUSE_DISPLAY_NAMES so historical lots still render with their proper name;
// only the cron + calendar-sync skip them. Add a slug here when a house is
// confirmed dead (returns 0 lots / domain dead / merged into another house)
// rather than burning Firecrawl credits on it forever.
export const RETIRED_HOUSES = new Set([
  // ── Dead EIG subdomains (retired 2026-05-05 after audit) ──
  'groundrentauctions',
  'auctiontrade',
  'romanway',
  'hammerprice',
  'brggibson',
  'brggibsondublin',
  'nationalpropertyauctions',
  // ── Domain parked / no longer trades (retired 2026-05-08) ──
  // 59 stale lots from old scrapes were polluting the active pool with
  // 0% image coverage. HOUSE_ROOTS entry was previously removed but the
  // historical lots stayed in rotation. Adding to RETIRED_HOUSES stops
  // calendar-sync from re-creating an always_on entry and the harness
  // from spending credits trying to scrape it.
  'lodgeandthomas',
  // ── No UK property auction catalogue (retired 2026-05-09 after silent-house triage) ──
  // Both firms appeared in HOUSE_ROOTS but neither runs a regular online
  // residential property auction:
  //   - Woolley & Wallis: /auctions/upcoming-auctions/ is fine art / Asian
  //     art sale calendar; w-w.co.uk/property-auctions/ is service-page-only
  //     (just historical "Sold" entries, no live catalogue).
  //   - Morris Marshall & Poole: ?instruction_type=Auction returns "No
  //     Properties Found"; their auction activity is furniture-only on
  //     the-saleroom.com (out of scope for this directory).
  // Both were emitting daily zero_lots_no_heal alerts. Retiring stops the
  // alerts and stops the harness wasting Firecrawl credits.
  'woolleyandwallis',
  'morrismarshall',
  // ── No live auction catalogue (retired 2026-05-10 per image-recall scout) ──
  // See docs/2026-05-10-image-recall-investigation.md for full diagnosis.
  //   - Clarke Gammon: /auction/ returns HTTP 404; /property-auctions/ is
  //     service-info copy only ("we hold auctions throughout the year, contact
  //     Tony Jamieson"). The 10 historical lots in `lots` were private-sale
  //     featured-property cards from the homepage, not auction lots.
  //   - Tayler & Fletcher: /property-auctions/ is WordPress info copy with no
  //     live catalogue. All 9 historical lots had URLs containing literal
  //     placeholder tokens like %cfp_cp_url_city% (CMS templating engine never
  //     substituted). The lots were rentals/sales mis-classified as auction
  //     lots; circuit was already at health 18/100.
  'clarkegammon',
  'taylerandfletcher',
  // ── Dead / 404 (confirmed 2026-05-20 after 10 days) ──
  'hammertime',
  // ── Merged into BTG Eddisons (btgeddisons) (confirmed 2026-05-20) ──
  'network',
  // ── Mis-wired slug (retired 2026-06-21) ──
  // scargillmann was pointing at sdlauctions.co.uk which is SDL Auctions' own
  // house (plan 4). 0 real lots ever persisted under this slug.
  'scargillmann', // retired 2026-06-21 — was mis-wired to sdlauctions.co.uk; SDL Auctions is its own house (plan 4)

  // ── Not auction houses (retired 2026-05-30) ──
  // (johnpye un-retired 2026-06-27 — it DOES run property auctions at /properties/)
  'humberts',
  // ── Domain parked / redirects to /lander ──
  // Already retired via the rewriteUrl() block below (blocked:true) + HOUSE_ROOTS
  // removal; listed here 2026-06-27 so cron-skip and the dormant reconciliation
  // below treat it like every other retired house (previously its house_skills
  // row sat at dormant=false, masquerading as live).
  'lextons',
]);

// ═══════════════════════════════════════════════════════════════
// RETIREMENT STATE RECONCILIATION
// ═══════════════════════════════════════════════════════════════
// RETIRED_HOUSES (above) is the source of truth for which houses we no longer
// scrape. Retiring a house was historically code-only, so the matching
// house_skills row kept dormant=false / circuit_state='closed' /
// status='healthy' — a retired house looked perfectly live to every monitor:
// the /api/admin/extraction-liveness `!dormant` gate, the Hermes deterministic
// detection rules (gate: circuit_state='closed' AND dormant=false), and any
// "healthy house" count. reconcileRetiredHousesDormant() closes that gap on
// boot by stamping dormant=true on any retired slug the DB still thinks is
// live. Idempotent — only rows that actually need it are written — and future
// retirements self-heal on the next deploy.

// Pure: given house_skills rows, which retired slugs still need dormant=true.
// Extracted for unit testing without a DB.
export function _retiredSlugsNeedingDormant(skillRows, retiredSet = RETIRED_HOUSES) {
  return (skillRows || [])
    .filter(r => r && retiredSet.has(r.slug) && r.dormant !== true)
    .map(r => r.slug);
}

export async function reconcileRetiredHousesDormant(supabase) {
  if (!supabase) return { updated: [] };
  const slugs = [...RETIRED_HOUSES];
  const { data: rows, error } = await supabase
    .from('house_skills')
    .select('slug, dormant')
    .in('slug', slugs);
  if (error) {
    console.warn(`reconcileRetiredHousesDormant: select failed: ${error.message}`);
    return { updated: [], error: error.message };
  }
  const needing = _retiredSlugsNeedingDormant(rows);
  if (needing.length === 0) return { updated: [] };
  const { error: updErr } = await supabase
    .from('house_skills')
    .update({ dormant: true, dormant_since: new Date().toISOString() })
    .in('slug', needing);
  if (updErr) {
    console.warn(`reconcileRetiredHousesDormant: update failed: ${updErr.message}`);
    return { updated: [], error: updErr.message };
  }
  console.log(`reconcileRetiredHousesDormant: marked ${needing.length} retired house(s) dormant — ${needing.join(', ')}`);
  return { updated: needing };
}

// ═══════════════════════════════════════════════════════════════
// AUCTION HOUSE DETECTION
// ═══════════════════════════════════════════════════════════════
export function detectAuctionHouse(url) {
  const u = url.toLowerCase();
  if (u.includes('savills')) return 'savills';
  if (u.includes('allsop')) return 'allsop';
  if (u.includes('networkauctions')) return 'btgeddisons';
  if (u.includes('btgeddisonspropertyauctions') || u.includes('btgeddisons')) return 'btgeddisons';
  if (u.includes('pugh-auctions')) return 'pugh';
  if (u.includes('sdlauctions')) return 'sdlauctions';
  if (u.includes('bondwolfe')) return 'bondwolfe';
  if (u.includes('barnardmarcusauctions') || u.includes('barnardmarcus')) return 'barnardmarcus';
  if (u.includes('auctionhouselondon')) return 'auctionhouselondon';
  if (u.includes('auctionhouse.co.uk/scotland')) return 'auctionhousescotland';
  if (u.includes('auctionhouse.co.uk/sussexandhampshire') || u.includes('sussexandhampshire')) return 'austingray';
  if (u.includes('auctionhouse.co.uk/eastanglia')) return 'auctionhouseeastanglia';
  if (u.includes('auctionhouse.co.uk/northwest')) return 'auctionhousenorthwest';
  if (u.includes('auctionhouse.co.uk/northeast')) return 'auctionhousenortheast';
  if (u.includes('auctionhouse.co.uk/southwales') || u.includes('auctionhouse.co.uk/wales')) return 'auctionhousewales';
  if (u.includes('auctionhouse.co.uk/birmingham')) return 'auctionhousebirmingham';
  if (u.includes('auctionhouse.co.uk/kent')) return 'auctionhousekent';
  if (u.includes('auctionhouse.co.uk/devonandcornwall')) return 'auctionhousedevon';
  if (u.includes('auctionhouse.co.uk/eastmidlands')) return 'auctionhouseeastmidlands';
  if (u.includes('auctionhouse.co.uk/westmidlands')) return 'auctionhousewestmidlands';
  if (u.includes('auctionhouse.co.uk/essex')) return 'auctionhouseessex';
  if (u.includes('auctionhouse.co.uk/manchester')) return 'auctionhousemanchester';
  // ── Auction House UK regional branches (must come BEFORE generic catch-all) ──
  if (u.includes('auctionhouse.co.uk/southyorkshire')) return 'auctionhousesouthyorkshire';
  if (u.includes('auctionhouse.co.uk/westyorkshire')) return 'auctionhousewestyorkshire';
  if (u.includes('auctionhouse.co.uk/teesvalley')) return 'auctionhouseteesvalley';
  if (u.includes('auctionhouse.co.uk/hullandeastyorkshire')) return 'auctionhousehull';
  if (u.includes('auctionhouse.co.uk/cumbria')) return 'auctionhousecumbria';
  if (u.includes('auctionhouse.co.uk/lincolnshire')) return 'auctionhouselincolnshire';
  if (u.includes('auctionhouse.co.uk/london')) return 'auctionhouseuklondon';
  if (u.includes('auctionhouse.co.uk/bedsandbucks')) return 'auctionhousebedsandbucks';
  if (u.includes('auctionhouse.co.uk/northamptonshire')) return 'auctionhousenorthamptonshire';
  if (u.includes('auctionhouse.co.uk/oxfordshire')) return 'auctionhouseoxfordshire';
  if (u.includes('auctionhouse.co.uk/leicestershire')) return 'auctionhouseleicestershire';
  if (u.includes('auctionhouse.co.uk/midlands')) return 'auctionhousemidlands';
  if (u.includes('auctionhouse.co.uk/coventryandwarwickshire')) return 'auctionhousecoventry';
  if (u.includes('auctionhouse.co.uk/nottsandderby')) return 'auctionhousenottsandderby';
  if (u.includes('auctionhouse.co.uk/chesterfieldandnorthderbyshire')) return 'auctionhousechesterfield';
  if (u.includes('auctionhouse.co.uk/staffordshire')) return 'auctionhousestaffordshire';
  if (u.includes('auctionhouse.co.uk/northwales')) return 'auctionhousenorthwales';
  if (u.includes('auctionhouse.co.uk/southwest')) return 'auctionhousesouthwest';
  if (u.includes('auctionhouse.co.uk/northernireland')) return 'auctionhousenorthernireland';
  if (u.includes('auctionhouse.co.uk/national')) return 'auctionhousenational';
  if (u.includes('auctionhouse.co.uk') || u.includes('auctionhouse.uk.net')) return 'auctionhouse';
  if (u.includes('cliveemson')) return 'cliveemson';
  if (u.includes('strettons')) return 'strettons';
  if (u.includes('acuitus')) return 'acuitus';
  if (u.includes('hollismorgan')) return 'hollismorgan';
  if (u.includes('maggsandallen')) return 'maggsandallen';
  if (u.includes('mchughandco')) return 'mchughandco';
  if (u.includes('knightfrankauctions')) return 'knightfrank';
  if (u.includes('pattinson.co.uk')) return 'pattinson';
  if (u.includes('bidx1.com')) return 'bidx1';
  if (u.includes('philliparnoldauctions')) return 'philliparnold';
  if (u.includes('edwardmellor')) return 'edwardmellor';
  if (u.includes('paulfosh') || u.includes('paulfosh.eigonlineauctions')) return 'paulfosh';
  if (u.includes('cottons.co.uk')) return 'cottons';
  if (u.includes('dedmangray')) return 'dedmangray';
  if (u.includes('barnettross')) return 'barnettross';
  if (u.includes('bradleyhall')) return 'bradleyhall';
  if (u.includes('connectukauctions') || u.includes('connectukgroup')) return 'connectuk';
  if (u.includes('auctionestates')) return 'auctionestates';
  if (u.includes('landwoodpropertyauctions') || u.includes('landwoodgroup')) return 'landwood';
  if (u.includes('loveitts')) return 'loveitts';
  // ── Bamboo Auctions SaaS subdomains ──
  // Bamboo hosts each auction house at <slug>.bambooauctions.com. The generic
  // hunters/bambooauctions.com fallback used to win this race for every house,
  // so stags.bambooauctions.com was being scraped and upserted as 'hunters'
  // (which then hit hunters' open circuit breaker → total silence).
  // Specific subdomain checks must run BEFORE the generic fallback.
  if (u.includes('stags.bambooauctions')) return 'stags';
  if (u.includes('carterjonas.bambooauctions')) return 'carterjonas';
  if (u.includes('lacyscottandknight.bambooauctions')) return 'lsk';
  if (u.includes('thepropertypeople.bambooauctions')) return 'allwalesauction';
  if (u.includes('rendells.bambooauctions')) return 'rendells';
  if (u.includes('247auction.bambooauctions')) return '247propertyauctions';
  if (u.includes('webbers.bambooauctions')) return 'webbers';   // else the generic bambooauctions.com catch-all below mis-routes webbers → hunters (cf. the stags incident)
  if (u.includes('hunters.com') || u.includes('bambooauctions.com')) return 'hunters';
  if (u.includes('probate.auction') || u.includes('timedauctions.probate.auction')) return 'probateauction';
  if (u.includes('auctionhouselondon')) return 'auctionhouselondon';
  if (u.includes('pughauctions') || u.includes('pugh')) return 'pugh';
  // ── New houses ──
  if (u.includes('suttonkersh')) return 'suttonkersh';
  if (u.includes('countrywidepropertyauctions')) return 'countrywide';
  if (u.includes('propertyauctionsouthwest')) return 'countrywide';
  if (u.includes('venmoreauctions')) return 'venmore';
  if (u.includes('townandcountrypropertyauctions') || u.includes('tcpa')) return 'tcpa';
  if (u.includes('futurepropertyauctions')) return 'futureauctions';
  if (u.includes('kivells.com')) return 'kivells';
  if (u.includes('firstforauctions') || u.includes('online.firstforauctions')) return 'firstforauctions';
  if (u.includes('harman-healy') || u.includes('harmanhealy')) return 'harmanhealy';
  if (u.includes('seelauctions') || u.includes('seelandco')) return 'seelauctions';
  if (u.includes('robinsonandhallauctions') || u.includes('robinsonandhall')) return 'robinsonhall';
  // ── EIG batch (March 2026) ──
  if (u.includes('astleys.eigonlineauctions') || u.includes('astleys.net')) return 'astleys';
  if (u.includes('henrysykes.co.uk') || u.includes('onlineauctions.henrysykes')) return 'henrysykes';
  if (u.includes('clarke-simpson.eigonlineauctions') || u.includes('clarkeandsimpson')) return 'clarkesimpson';
  if (u.includes('durrants.com') || u.includes('auctions.durrants')) return 'durrants';
  if (u.includes('dawsonsproperty')) return 'dawsons';
  if (u.includes('goldingsauctions')) return 'goldings';
  // ── New houses (March 2026 batch 2) ──
  if (u.includes('agentspropertyauction.com')) return 'agentsproperty';
  if (u.includes('andrewcraig.co.uk')) return 'andrewcraig';
  if (u.includes('buttersjohnbee.com')) return 'buttersjohnbee';
  if (u.includes('brown-co.com') || u.includes('brownandco.eigonlineauctions')) return 'brownco';
  if (u.includes('timedpropertyauctions.cheffins')) return 'cheffinstimed';
  if (u.includes('cheffins.co.uk/property-auctions.htm')) return 'cheffinstimed';
  if (u.includes('cheffins.co.uk')) return 'cheffins';
  if (u.includes('fssproperty.co.uk')) return 'fssproperty';
  if (u.includes('eigpropertyauctions.co.uk/live-stream/auction/feather-smailes-scales')) return 'fssproperty';
  if (u.includes('iamsold.co.uk')) return 'iamsold';
  if (u.includes('romanway.eigonlineauctions')) return 'romanway';
  if (u.includes('hammerprice.eigonlineauctions')) return 'hammerprice';
  // ── Regional/independent houses (batch 6, March 2026) ──
  if (u.includes('underthehammer.com')) return 'underthehammer';
  if (u.includes('lacyscottandknight.bambooauctions') || u.includes('lsk.co.uk')) return 'lsk';
  // ── Tier 2/3 houses (March 2026) ──
  if (u.includes('foxandsonsauctions.co.uk')) return 'foxandsons';
  if (u.includes('bagshawsauctions.co.uk')) return 'bagshaws';
  if (u.includes('wilsonsauctions.com')) return 'wilsons';
  if (u.includes('strakers.co.uk')) return 'strakers';
  if (u.includes('johnpye.co.uk')) return 'johnpye';
  // ── EIG batch 5 houses ──
  if (u.includes('sarah-mains.eigonlineauctions')) return 'sarahmains';
  if (u.includes('sageandco.eigonlineauctions')) return 'sageandco';
  if (u.includes('auctiontrade.eigonlineauctions')) return 'auctiontrade';
  if (u.includes('brggibsonbelfastauctions.eigonlineauctions')) return 'brggibson';
  if (u.includes('higginsdrysdale.eigonlineauctions')) return 'higginsdrysdale';
  if (u.includes('martinpole.eigonlineauctions')) return 'martinpole';
  if (u.includes('jonespeckover.eigonlineauctions')) return 'jonespeckover';
  if (u.includes('thepropertyauctionhouse.eigonlineauctions')) return 'thepropertyauctionhouse';
  if (u.includes('propertyauctionagent.eigonlineauctions')) return 'propertyauctionagent';
  if (u.includes('lot9.eigonlineauctions')) return 'lot9';
  if (u.includes('auction-north.eigonlineauctions')) return 'auctionnorth';
  if (u.includes('bowensonandwatson.eigonlineauctions')) return 'bowensonandwatson';
  if (u.includes('sheldonbosleyknight') || u.includes('sbkauctions')) return 'sheldonbosley';
  if (u.includes('nationalpropertyauctions.eigonlineauctions')) return 'nationalpropertyauctions';
  // ── Batch 7: Tier 1 expansion ──
  if (u.includes('auctions.symondsandsampson')) return 'symondsandsampson';
  if (u.includes('stags.co.uk')) return 'stags';
  if (u.includes('propertyauctions.lsh.co.uk')) return 'lsh';
  if (u.includes('carterjonas.co.uk')) return 'carterjonas';
  if (u.includes('gth.net')) return 'gth';
  if (u.includes('hallsgb.com')) return 'halls';
  if (u.includes('walkersingleton')) return 'walkersingleton';
  if (u.includes('drivers.co.uk')) return 'driversnorris';
  if (u.includes('shonkibros.com')) return 'shonkibros';
  if (u.includes('robinjessop.co.uk')) return 'robinjessop';
  // ── Batch 7: Tier 2 expansion ──
  if (u.includes('ctf-uk.com')) return 'cleetompkinson';
  if (u.includes('mccartneys.co.uk')) return 'mccartneys';
  if (u.includes('bramleys.com')) return 'bramleys';
  if (u.includes('cooperandtanner.co.uk')) return 'cooperandtanner';
  if (u.includes('brutonknowles.co.uk')) return 'brutonknowles';
  if (u.includes('fishergerman.co.uk')) return 'fisherGerman';
  if (u.includes('woolleyandwallis.co.uk')) return 'woolleyandwallis';
  if (u.includes('hobbsparker.co.uk')) return 'hobbsparker';
  if (u.includes('arnoldskeys.com')) return 'arnoldskeys';
  if (u.includes('twgaze.co.uk')) return 'twgaze';
  if (u.includes('hairandson.co.uk')) return 'hairandson';
  if (u.includes('phillipsland.com')) return 'phillipssmithanddunn';
  if (u.includes('webbers.co.uk')) return 'webbers';
  // ── Batch 7: EIG additions ──
  if (u.includes('ahlondon.eigonlineauctions')) return 'ahlondon';
  if (u.includes('star-property-online.eigonlineauctions')) return 'starpropertyonline';
  if (u.includes('brggibsondublinauctions.eigonlineauctions')) return 'brggibsondublin';
  // ── Batch 8: Comprehensive UK coverage ──
  if (u.includes('propertysolvers.co.uk')) return 'propertysolvers';
  if (u.includes('markjenkinson.co.uk')) return 'markjenkinson';
  if (u.includes('regionalpropertyauctioneers.co.uk')) return 'regionalauctioneers';
  if (u.includes('clarkegammon.co.uk')) return 'clarkegammon';
  if (u.includes('nesbits.co.uk')) return 'nesbits';
  if (u.includes('pearsons.com')) return 'pearsons';
  if (u.includes('foxgrant.com')) return 'foxgrant';
  if (u.includes('lextons.com')) return 'lextons';
  if (u.includes('bradleys-estate-agents.co.uk')) return 'bradleysdevon';
  if (u.includes('taylerandfletcher.co.uk')) return 'taylerandfletcher';
  if (u.includes('luscombemaye.com')) return 'luscombemaye';
  if (u.includes('lodgeandthomas.com')) return 'lodgeandthomas';
  if (u.includes('bondoxboroughphillips.co.uk')) return 'bondoxboroughphillips';
  // charlesdarrow.co.uk and charlesdarrowauctions.com — Charles Darrow was
  // acquired by BTG Eddisons. Now routed to their own slug (plan 3 onboarding);
  // canonicaliseHouseSlug rejects unregistered slugs until plan 3 lands.
  if (u.includes('charlesdarrow.co.uk') || u.includes('charlesdarrowauctions.com')) return 'charlesdarrow';
  if (u.includes('aldreds.co.uk')) return 'aldreds';
  // humberts detection removed — estate agent, not auction house
  if (u.includes('allwalesauction.com')) return 'allwalesauction';
  if (u.includes('evansbros.co.uk')) return 'evansbros';
  if (u.includes('herbertrthomasandco.co.uk')) return 'herbertrthomasandco';
  if (u.includes('johnfrancis.co.uk')) return 'johnfrancis';
  if (u.includes('morrismarshall.co.uk')) return 'morrismarshall';
  if (u.includes('andrewgrant.com')) return 'andrewgrant';
  if (u.includes('gherbertbanks.co.uk')) return 'gherbertbanks';
  if (u.includes('hawkesford.co.uk')) return 'hawkesford';
  if (u.includes('howkinsandharrison.co.uk')) return 'howkinsandharrison';
  if (u.includes('scargillmann.co.uk')) return 'scargillmann';
  if (u.includes('mellerbraggins.com')) return 'mellerbraggins';
  if (u.includes('smithandsons.net')) return 'smithandsons';
  if (u.includes('wrightmarshall.co.uk')) return 'wrightmarshall';
  if (u.includes('hackneyandleigh.co.uk')) return 'hackneyandleigh';
  if (u.includes('onlinepropertyauctionsscotland.co.uk')) return 'onlinepropertyauctionsscotland';
  // ── GOTO Properties platform (EIG-based) ──
  if (u.includes('purplebricks.gotoproperties')) return 'purplebricksgoto';
  if (u.includes('gotoproperties.co.uk')) return 'gotoproperties';
  if (u.includes('groundrentauctions.eigonlineauctions')) return 'groundrentauctions';
  if (u.includes('benjaminstevensauctions')) return 'benjaminstevens';
  // ── New houses from own websites (April 2026) ──
  if (u.includes('auctionhammermidlands')) return 'auctionhammermidlands';
  if (u.includes('sharpesauctions')) return 'sharpesauctions';
  if (u.includes('jjmorris.com')) return 'jjmorris';
  if (u.includes('rendells.bambooauctions') || u.includes('rendells.co.uk')) return 'rendells';
  if (u.includes('pearsonferrier.co.uk')) return 'pearsonferrier';
  // ── EIG houses from discovery (April 2026) ──
  if (u.includes('247auction.bambooauctions') || u.includes('247propertyauctions')) return '247propertyauctions';
  if (u.includes('rogerparry.eigonlineauctions') || u.includes('rogerparry.net')) return 'rogerparry';
  if (u.includes('auctions.hmox.co.uk') || u.includes('hmox.co.uk')) return 'hmox';
  if (u.includes('cotswoldpropertyauctions.co.uk')) return 'cotswoldpropertyauctions';
  if (u.includes('cityandruralpropertyauctions.com')) return 'cityandruralpropertyauctions';
  // ── William H Brown (Sequence platform, April 2026) ──
  if (u.includes('williamhbrownauctions-norwich')) return 'williamhbrownnorwich';
  // (Auction House UK branch patterns moved above generic catch-all)
  // ── EIG platform catch-all ──
  if (u.includes('.eigonlineauctions.com') || u.includes('eigpropertyauctions')) return 'eigplatform';
  // ── Bamboo Auctions catch-all ──
  if (u.includes('bambooauctions.com')) return 'hunters';
  // ── Auctionworks catch-all ──
  if (u.includes('auctionworks.co.uk')) return 'sarahmains';
  return 'unknown';
}

export const HOUSE_DISPLAY_NAMES = {
  savills: 'Savills', allsop: 'Allsop', btgeddisons: 'BTG Eddisons',
  bondwolfe: 'Bond Wolfe', barnardmarcus: 'Barnard Marcus',
  auctionhouselondon: 'Auction House London', auctionhouse: 'Auction House UK',
  cliveemson: 'Clive Emson', strettons: 'Strettons', acuitus: 'Acuitus',
  hollismorgan: 'Hollis Morgan', maggsandallen: 'Maggs & Allen', mchughandco: 'McHugh & Co',
  knightfrank: 'Knight Frank', pattinson: 'Pattinson', bidx1: 'BidX1',
  philliparnold: 'Phillip Arnold', edwardmellor: 'Edward Mellor', paulfosh: 'Paul Fosh',
  cottons: 'Cottons', dedmangray: 'Dedman Gray', barnettross: 'Barnett Ross',
  bradleyhall: 'Bradley Hall', connectuk: 'Connect UK', auctionestates: 'Auction Estates',
  landwood: 'Landwood', loveitts: 'Loveitts', hunters: 'Hunters',
  probateauction: 'Probate Auction',
  countrywide: 'Countrywide Property Auctions', venmore: 'Venmore Auctions',
  tcpa: 'Town & Country Property Auctions', futureauctions: 'Future Property Auctions',
  kivells: 'Kivells', firstforauctions: 'First For Auctions',
  suttonkersh: 'Sutton Kersh', harmanhealy: 'Harman Healy',
  seelauctions: 'Seel & Co', robinsonhall: 'Robinson & Hall',
  astleys: 'Astleys', henrysykes: 'Henry Sykes Auctions', clarkesimpson: 'Clarke & Simpson',
  durrants: 'Durrants', dawsons: 'Dawsons', goldings: 'Goldings',
  auctionhousescotland: 'Auction House Scotland', austingray: 'Auction House Sussex & Hampshire',
  auctionhouseeastanglia: 'Auction House East Anglia', auctionhousenorthwest: 'Auction House North West',
  auctionhousenortheast: 'Auction House North East', auctionhousewales: 'Auction House Wales',
  auctionhousebirmingham: 'Auction House Birmingham', auctionhousekent: 'Auction House Kent',
  agentsproperty: 'Agents Property Auction', andrewcraig: 'Andrew Craig',
  buttersjohnbee: 'Butters John Bee', brownco: 'Brown & Co',
  cheffins: 'Cheffins', cheffinstimed: 'Cheffins Timed', fssproperty: 'Feather Smailes & Scales',
  iamsold: 'iamsold',
  // ── Batch 4 (March 2026) ──
  auctionhousedevon: 'Auction House Devon & Cornwall',
  auctionhouseeastmidlands: 'Auction House East Midlands',
  auctionhousewestmidlands: 'Auction House West Midlands',
  auctionhouseessex: 'Auction House Essex',
  auctionhousemanchester: 'Auction House Manchester',
  romanway: 'Roman Way Auctions',
  hammerprice: 'Hammer Price Auctions',
  // ── Batch 5 (March 2026) ──
  auctionhousesouthyorkshire: 'Auction House South Yorkshire',
  auctionhousewestyorkshire: 'Auction House West Yorkshire',
  auctionhouseteesvalley: 'Auction House North Yorkshire & Tees Valley',
  auctionhousehull: 'Auction House Hull & East Yorkshire',
  auctionhousecumbria: 'Auction House Cumbria',
  auctionhouselincolnshire: 'Auction House Lincolnshire',
  auctionhouseuklondon: 'Auction House UK London',
  auctionhousebedsandbucks: 'Auction House Beds & Bucks',
  auctionhousenorthamptonshire: 'Auction House Northamptonshire',
  auctionhouseoxfordshire: 'Auction House Oxfordshire',
  auctionhouseleicestershire: 'Auction House Leicestershire',
  auctionhousemidlands: 'Auction House Midlands',
  auctionhousecoventry: 'Auction House Coventry & Warwickshire',
  auctionhousenottsandderby: 'Auction House Notts & Derby',
  auctionhousechesterfield: 'Auction House Chesterfield & N Derbyshire',
  auctionhousestaffordshire: 'Auction House Cheshire, Staffs & Shropshire',
  auctionhousenorthwales: 'Auction House North Wales',
  auctionhousesouthwest: 'Auction House South West',
  auctionhousenorthernireland: 'Auction House Northern Ireland',
  auctionhousenational: 'Auction House National',
  sarahmains: 'Sarah Mains / Auction Works',
  sageandco: 'Sage & Co Auctions',
  auctiontrade: 'Auction Trade',
  brggibson: 'BRG Gibson Belfast',
  higginsdrysdale: 'Higgins Drysdale',
  martinpole: 'Martin Pole Auctions',
  jonespeckover: 'Jones Peckover',
  thepropertyauctionhouse: 'The Property Auction House',
  propertyauctionagent: 'Property Auction Agent',
  lot9: 'Lot9 Auctions',
  auctionnorth: 'Auction North',
  bowensonandwatson: 'Bowen Son & Watson',
  sheldonbosley: 'Sheldon Bosley Knight',
  nationalpropertyauctions: 'National Property Auctions',
  // ── Regional/independent houses (batch 6, March 2026) ──
  underthehammer: 'Under The Hammer',
  lsk: 'Lacy Scott & Knight',
  foxandsons: 'Fox & Sons Auctions',
  bagshaws: 'Bagshaws Auctions',
  wilsons: 'Wilsons Auctions',
  strakers: 'Strakers',
  johnpye: 'John Pye',
  // ── Batch 7 (March 2026) ──
  symondsandsampson: 'Symonds & Sampson',
  stags: 'Stags',
  lsh: 'Lambert Smith Hampton',
  carterjonas: 'Carter Jonas',
  gth: 'Greenslade Taylor Hunt',
  halls: 'Halls',
  walkersingleton: 'Walker Singleton',
  driversnorris: 'Drivers & Norris',
  shonkibros: 'Shonki Brothers',
  robinjessop: 'Robin Jessop',
  cleetompkinson: 'Clee Tompkinson & Francis',
  mccartneys: 'McCartneys',
  bramleys: 'Bramleys',
  cooperandtanner: 'Cooper & Tanner',
  brutonknowles: 'Bruton Knowles',
  fisherGerman: 'Fisher German',
  woolleyandwallis: 'Woolley & Wallis',
  hobbsparker: 'Hobbs Parker',
  arnoldskeys: 'Arnolds Keys',
  twgaze: 'TW Gaze',
  hairandson: 'Hair & Son',
  phillipssmithanddunn: 'Phillips Smith & Dunn',
  webbers: 'Webbers',
  ahlondon: 'Auction House London EIG',
  starpropertyonline: 'Star Property Online',
  brggibsondublin: 'BRG Gibson Dublin',
  // ── Batch 8 (March 2026) ──
  propertysolvers: 'Property Solvers', pugh: 'Pugh Auctions',
  markjenkinson: 'Mark Jenkinson', regionalauctioneers: 'Regional Property Auctioneers',
  clarkegammon: 'Clarke Gammon', nesbits: 'Nesbits', pearsons: 'Pearsons',
  foxgrant: 'Fox Grant', lextons: 'Lextons',
  bradleysdevon: 'Bradleys', taylerandfletcher: 'Tayler & Fletcher',
  charlesdarrow: 'Charles Darrow',
  sdlauctions: 'SDL Auctions',
  luscombemaye: 'Luscombe Maye', lodgeandthomas: 'Lodge & Thomas',
  bondoxboroughphillips: 'Bond Oxborough Phillips',
  aldreds: 'Aldreds',
  // humberts retired — not an auction house
  allwalesauction: 'All Wales Auction', evansbros: 'Evans Bros',
  herbertrthomasandco: 'Herbert R Thomas', johnfrancis: 'John Francis',
  morrismarshall: 'Morris Marshall & Poole',
  andrewgrant: 'Andrew Grant', gherbertbanks: 'G Herbert Banks',
  hawkesford: 'Hawkesford', howkinsandharrison: 'Howkins & Harrison',
  scargillmann: 'Scargill Mann',
  mellerbraggins: 'Meller Braggins', smithandsons: 'Smith & Sons',
  wrightmarshall: 'Wright Marshall',
  hackneyandleigh: 'Hackney & Leigh',
  onlinepropertyauctionsscotland: 'Online Property Auctions Scotland',
  // ── GOTO Properties platform (April 2026) ──
  purplebricksgoto: 'Purplebricks (GOTO Properties)',
  // ── Verified EIG subdomains (April 2026) ──
  groundrentauctions: 'Ground Rent Auctions',
  benjaminstevens: 'Benjamin Stevens Auctions',
  // ── New houses from own websites (April 2026) ──
  auctionhammermidlands: 'Auction Hammer Midlands',
  sharpesauctions: 'Sharpes Auctions',
  jjmorris: 'JJ Morris',
  rendells: 'Rendells',
  pearsonferrier: 'Pearson Ferrier',
  // ── Discovery batch (April 2026) ──
  '247propertyauctions': '247 Property Auctions',
  rogerparry: 'Roger Parry & Partners',
  hmox: 'HMO X Auctions',
  cotswoldpropertyauctions: 'Cotswold Property Auctions',
  cityandruralpropertyauctions: 'City & Rural Property Auctions',
  williamhbrownnorwich: 'William H Brown (Norwich)',
  // ── propertyauctionaction.co.uk directory expansion (May 2026) ──
  bakerwynnewilson: 'Baker Wynne and Wilson',
  bootandson: 'Boot and Son',
  boultons: 'Boultons',
  buryandhilton: 'Bury and Hilton',
  cloughandco: 'Clough & Co',
  earles: 'Earles',
  fidlertaylor: 'Fidler Taylor and Co',
  grahamwatkins: 'Graham Watkins & Co',
  gwilymrichards: 'Gwilym Richards & Co',
  lambertandfoster: 'Lambert & Foster',
  leonards: 'Leonards',
  morganbeddoe: 'Morgan Beddoe',
  nicholasjames: 'Nicholas James Property',
  pennineways: 'Pennine Ways',
  phippsandpritchard: 'Phipps & Pritchard',
  primepropertyauctions: 'Prime Property Auctions',
  screetons: 'Screetons',
  shobrook: 'Shobrook & Co',
  wmsykes: 'Wm. Sykes & Son',
  yoowin: 'YooWin Property Auctions',
  andrewkelly: 'Andrew Kelly & Associates',
  davidjames: 'David James',           // iamSold partner — lots route via iamsold.co.uk
  opendoor: 'Open Door Property',      // 301-redirects to .co.uk.com — may need URL fix
  sequence: 'Sequence Auctions',       // Connells Group; partners with Barnard Marcus
  michaelpoole: 'Michael Poole',       // anti-bot 403 to plain WebFetch — needs Firecrawl

  // ── 8 houses sourced from propertyauctions.io sitemap (2026-05-06) ──
  hammertime: 'Hammertime Property Auctions',  // EIG platform whitelabel
  auctiondepartment: 'The Auction Department',
  auctionproperty: 'Auction Property',
  landmarkauctions: 'Landmark Auctions',
  rocketauctions: 'Rocket Auctions',
  swiftauctions: 'Swift Property Auctions',
  swpropertyauctions: 'SW Property Auctions',  // South-West region
  theauctioncompany: 'The Auction Company',

  // ── 12 houses sourced from Firecrawl /v2/search (2026-05-06) ──
  firstchoiceauctions: 'First Choice Property Auctions',  // Scotland
  palaceauctions: 'Palace Property Auctions',             // London
  belfastauctions: 'Belfast Auctions',                     // NI
  midulsterauctions: 'Mid Ulster Auctions',                // NI
  braveheart: 'Braveheart Auctions',                       // Scotland
  whoobid: 'Whoobid Property Auctioneers',                 // UK national
  gogogone: 'Go Go Gone',                                  // NI
  propertyauctionhouseswansea: 'The Property Auction House (Swansea)',
  auctionsni: 'Auctions NI',                               // NI
  opagroup: 'Online Property Auction Group',               // UK national
  nationalresidential: 'National Residential',             // UK national
  barneyestates: 'Barney Estates',                         // UK commercial
};

export function getHouseDisplayName(slug, url) {
  if (HOUSE_DISPLAY_NAMES[slug]) return HOUSE_DISPLAY_NAMES[slug];
  if (slug === 'unknown' && url) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      return hostname.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } catch { /* fall through */ }
  }
  return 'Auction';
}

// ═══════════════════════════════════════════════════════════════
// SLUG NORMALISATION
// ═══════════════════════════════════════════════════════════════
// Used by canonicaliseHouseSlug below as a defensive last line before
// persist — see lib/pipeline/persist-lots.js. Lowercase + non-alphanumeric
// stripped on both sides so "Venmore Auctions" → "venmoreauctions" matches
// HOUSE_DISPLAY_NAMES values like "Venmore Auctions".
const _normaliseHouseKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const _DISPLAY_TO_SLUG = new Map();
for (const [slug, display] of Object.entries(HOUSE_DISPLAY_NAMES)) {
  _DISPLAY_TO_SLUG.set(_normaliseHouseKey(display), slug);
}

// Legacy / alternate display names that don't reverse-resolve through
// HOUSE_DISPLAY_NAMES — e.g. "SDL Auctions" was the old name for what's now
// "BTG Eddisons" (slug `sdl`). Add new aliases here when the display name
// in production differs from HOUSE_DISPLAY_NAMES (e.g. via FALLBACK_CALENDAR
// in lib/calendar.js or HOUSE_NAME_MIGRATIONS in lib/analysis.js).
const _LEGACY_HOUSE_NAME_ALIASES = {
  'sdl': 'btgeddisons',        // legacy slug — BTG Eddisons was historically the 'sdl' slug
  'btgeddisons': 'btgeddisons', // explicit (display 'BTG Eddisons' also resolves via _DISPLAY_TO_SLUG)
  // NB: do NOT map 'sdlauctions'/'SDL Auctions' here — SDL Auctions is a SEPARATE house
  // (slug 'sdlauctions', onboarded in plan 4); aliasing it to btgeddisons would re-conflate.
};

/**
 * Canonicalise any house identifier into its slug form.
 * Returns the slug if recognisable, else null (caller should log + skip).
 *
 *   canonicaliseHouseSlug('venmore')          → 'venmore'
 *   canonicaliseHouseSlug('Venmore Auctions') → 'venmore'
 *   canonicaliseHouseSlug('VENMORE')          → 'venmore'
 *   canonicaliseHouseSlug('sdl')              → 'btgeddisons'  (legacy slug alias)
 *   canonicaliseHouseSlug('made up name')     → null
 */
export function canonicaliseHouseSlug(input) {
  if (!input) return null;
  const lower = String(input).toLowerCase();
  if (HOUSE_ROOTS[lower] || HOUSE_DISPLAY_NAMES[lower]) return lower;
  const normalised = _normaliseHouseKey(input);
  if (HOUSE_ROOTS[normalised] || HOUSE_DISPLAY_NAMES[normalised]) return normalised;
  if (_LEGACY_HOUSE_NAME_ALIASES[normalised]) return _LEGACY_HOUSE_NAME_ALIASES[normalised];
  const fromDisplay = _DISPLAY_TO_SLUG.get(normalised);
  if (fromDisplay) return fromDisplay;
  return null;
}

// ═══════════════════════════════════════════════════════════════
// EXTRACTION_PROFILE — per-house catalogue richness + deep-fetch policy
// ═══════════════════════════════════════════════════════════════
// Declares how much to trust each catalogue page and when to hydrate from
// the individual lot detail page.
//
//   catalogue: 'rich'   — full data on the catalogue card (e.g. Allsop API)
//              'medium' — most fields present (e.g. Savills, Bond Wolfe)
//              'shell'  — sparse cards (lot URL + maybe price); detail page
//                         is the source of truth (e.g. Maggs & Allen,
//                         Hollis Morgan, FSS Property)
//
//   policy:    'never-deep'  — never fetch the lot detail page
//              'gap-fill'    — fetch only when a key field is missing (default)
//              'always-deep' — fetch every lot, every cycle (overwrite junk)
//
//   overwriteFields: when policy is 'always-deep', listed fields are replaced
//                    with detail-page values even if catalogue had a value.
//                    Other fields remain gap-fill (don't clobber good data).
//
//   maxPerCycle: cap on number of lots to deep-fetch per autoAnalyseAll run.
//                Protects Firecrawl budget on shell houses with huge catalogues.
//
// Default for any unconfigured house: { catalogue: 'medium', policy: 'gap-fill' }
// (preserves current behaviour — no surprise regressions).

export const EXTRACTION_PROFILE = {
  // ── Shell catalogues — detail page is canonical ──
  // 2026-05-11: dropped 'bullets' from overwriteFields. The markdown recogniser
  // (lib/pipeline/firecrawl-extract.js::recogniseMaggsLotsFromMarkdown) now
  // produces 5–7 structured bullets per lot at catalogue time. The detail-page
  // enrichment used to null those out and replace with the single-paragraph
  // description, which lost the structure. Image URLs are still overwritten
  // because the catalogue cards don't carry per-lot images.
  maggsandallen: { catalogue: 'shell', policy: 'always-deep', overwriteFields: ['imageUrl'], maxPerCycle: 80 },
  // Same rationale for Hollis Morgan: recogniseHollisMorganLotsFromMarkdown
  // captures structured bullets at catalogue time, so don't let detail-page
  // enrichment clobber them. Wired 2026-05-11 after a probe confirmed Hollis
  // uses its own CMS shape (not EIG white-label).
  hollismorgan:  { catalogue: 'shell', policy: 'always-deep', overwriteFields: ['imageUrl'], maxPerCycle: 80 },
  // fssproperty: HOUSE_ROOTS points at a broken live-stream URL with no lots.
  // Demoted from always-deep → gap-fill (default) until healed — the 80
  // detail-page fetches per cycle were burning ~80 Firecrawl credits/night
  // on a catalogue that's returning zero lots anyway. Restore to always-deep
  // (with overwriteFields ['imageUrl', 'bullets']) once auction-self-healing
  // recovers the live catalogue URL.
  fssproperty:   { catalogue: 'shell', policy: 'gap-fill' },

  // ── Rich catalogues — API gives everything; never-deep saves credits ──
  allsop: { catalogue: 'rich', policy: 'never-deep' },
};

const _DEFAULT_PROFILE = Object.freeze({ catalogue: 'medium', policy: 'gap-fill' });

export function getProfile(slug) {
  return EXTRACTION_PROFILE[slug] || _DEFAULT_PROFILE;
}

// ═══════════════════════════════════════════════════════════════
// AUCTION_DISCOVERY — per-auction URL discovery config (Cat B houses)
// ═══════════════════════════════════════════════════════════════
// For houses where the catalogue URL changes per auction event. The
// auction-watcher (lib/pipeline/auction-watcher.js) consults this on each
// overnight cycle to find the current upcoming auction URL and upsert it
// into auction_calendar BEFORE autoAnalyseAll scrapes.
//
// Fields:
//   homepage     — page to scrape for auction links (defaults to HOUSE_ROOTS[slug])
//   linkPattern  — regex with ONE capture group (the auction ID). If present,
//                  Tier 1 (free plain-HTTP fetch + regex) runs first. If absent
//                  or returns nothing future-dated, Tier 2 (AI) runs.
//   buildUrl     — function(auctionId) → canonical catalogue URL. If absent,
//                  uses the raw matched URL.
//
// Houses NOT listed here are treated as Cat A or Cat C (static root URL
// or always-on rolling stock) and are handled by the existing calendar-sync
// + healBrokenHouse flow. No active discovery runs for them.
//
// Adding a new Cat B house: start with just `homepage` — Tier 2 AI will
// do the work. Add linkPattern/buildUrl later as an optimisation if the
// AI call becomes a hot path.

export const AUCTION_DISCOVERY = {
  // ── EIG white-label CMS — Maggs & Allen, Hollis Morgan etc. ──
  // These houses use the EIG white-label platform. Maggs & Allen publishes
  // per-event month-slug URLs (/search-auction-may/, /search-auction-jun/)
  // in addition to a static ?auction=N landing. Hollis Morgan uses a static
  // ?bid=N URL whose content swaps over between events.
  // The watcher reads upcoming auction links from auctionsIndexPath (rendered
  // via Firecrawl when plain HTTP misses JS-rendered links) and upserts the
  // event-specific URLs into auction_calendar so autoAnalyseAll scrapes them.
  maggsandallen: {
    homepage: 'https://www.maggsandallen.co.uk/',
    auctionsIndexPath: '/auctions/',
    platform: 'eig-whitelabel',
    // Group 1: month slug from /search-auction-may/
    // Group 2: numeric ID from /search-auction/?auction=N
    // Month-slug URLs are preferred — they target a single event without mixing in
    // sold lots from previous auctions (which the static ?auction=1 URL includes).
    linkPattern: /\/search-auction(?:-([a-z]{2,10})\/|\/?[?]auction=(\d+))/g,
    buildUrl: (id) => {
      if (/^\d+$/.test(id)) {
        return `https://www.maggsandallen.co.uk/search-auction/?auction=${id}&orderby=lot_no&n=0&showsold=on&showstc=on`;
      }
      // Month slug (e.g. 'may', 'jun') — dedicated per-event page
      return `https://www.maggsandallen.co.uk/search-auction-${id}/`;
    },
  },
  hollismorgan: {
    homepage: 'https://www.hollismorgan.co.uk/',
    auctionsIndexPath: '/auctions/auction-dates.html',
    platform: 'eig-whitelabel',
    linkPattern: /\/search-auction\/\?bid=(\d+)/g,
    // extra_2!=501,502 is Hollis's own server-side filter that excludes
    // already-archived auction categories. Preserved as `%21` (URL-encoded `!`).
    buildUrl: (id) => `https://www.hollismorgan.co.uk/search-auction/?bid=${id}&showstc=on&orderby=lot_no+asc&extra_2%21=501,502`,
  },
  buttersjohnbee: {
    homepage: 'https://www.buttersjohnbee.com/properties-for-auction',
  },

  // ── Date-stamped query string ?auction_date=YYYY-MM-DD (Countrywide) ──
  // Domain migrated 2026-05-05 to propertyauctionsouthwest.co.uk; URL pattern
  // preserved on the assumption it's the same CMS. If discovery returns 0 hits,
  // probe the new homepage and update linkPattern + buildUrl accordingly.
  countrywide: {
    homepage: 'https://www.propertyauctionsouthwest.co.uk/',
    linkPattern: /\?auction_date=(\d{4}-\d{2}-\d{2})/g,
    buildUrl: (date) => `https://www.propertyauctionsouthwest.co.uk/properties/?auction_date=${date}`,
  },

  // ── Path-based per-auction ID (Bond Wolfe, Sutton Kersh) ──
  bondwolfe: {
    homepage: 'https://www.bondwolfe.com/property-auctions/',
  },
  suttonkersh: {
    homepage: 'https://www.suttonkersh.co.uk/',
  },

  // ── Path-slug auction IDs (Savills, Knight Frank) ──
  savills: {
    homepage: 'https://auctions.savills.co.uk/upcoming-auctions',
    // rewriteUrl already auto-discovers from this page; watcher adds calendar persistence
  },
  knightfrank: {
    homepage: 'https://www.knightfrankauctions.com/',
  },

  // ── Multiple catalogue pages per event (Allsop residential + commercial) ──
  allsop: {
    homepage: 'https://www.allsop.co.uk/',
    // rewriteUrl already maps to the JSON API — watcher just ensures calendar
    // carries current upcoming entry for UI display
  },

  // ── Varying paths (AH London) ──
  auctionhouselondon: {
    homepage: 'https://www.auctionhouselondon.co.uk/',
  },

  // charlesdarrow — REMOVED 2026-04-25: acquired by BTG Eddisons; lots route
  // through the sdl slug now.
};

export function getDiscoveryConfig(slug) {
  return AUCTION_DISCOVERY[slug] || null;
}

// Recognises the EIG Property Auctions white-label CMS used by Hollis Morgan,
// Maggs & Allen, FSS Property and similar regional auctioneers. The
// fingerprint is robust because both the templates loaded from
// auctioneertemplates.eigroup.co.uk and the live-stream URLs are unmistakably
// EIG-owned. Used by the auction watcher to apply the eig-whitelabel
// discovery strategy without needing to hard-code every house slug.
export function isEigWhitelabel(html) {
  if (!html) return false;
  return /auctioneertemplates\.eigroup\.co\.uk|eigpropertyauctions\.co\.uk\/live-stream/i.test(html);
}

// ═══════════════════════════════════════════════════════════════
// URL REWRITING (map user-friendly URLs to data endpoints)
// ═══════════════════════════════════════════════════════════════
// The DB trigger trg_normalise_calendar_url strips `www.` and trailing
// slashes from every auction_calendar URL — but these hosts only serve their
// catalogue on the www host (Maggs' bare host renders a lot-less stub) and
// 404/stub the slashless /search-auction path; detail hrefs inherit the
// request host, which cascaded into the 2026-06-13 incident. Re-canonicalise
// at scrape time — the one layer the trigger can't reach.
const WWW_CANONICAL_HOSTS = {
  hollismorgan: 'www.hollismorgan.co.uk',
  maggsandallen: 'www.maggsandallen.co.uk',
  // charlesdarrow.co.uk (bare host) is DEAD — DNS/connection fails (curl 000);
  // only www.charlesdarrow.co.uk resolves. The auction_calendar www-stripping
  // trigger leaves the bare host, so the rescrape hit a dead URL → 0 lots.
  // sdlauctions.co.uk redirects bare→www, but pin it too so Crawlee lands on the
  // canonical host directly. (2026-06-23 — Charles Darrow / SDL Auctions onboarding)
  charlesdarrow: 'www.charlesdarrow.co.uk',
  sdlauctions: 'www.sdlauctions.co.uk',
  // cliveemson.co.uk (bare host) serves a CN-invalid TLS cert, so the Crawlee/
  // Puppeteer render rejects it (net::ERR_CERT_COMMON_NAME_INVALID) → 0 lots;
  // only www.cliveemson.co.uk is valid. The www-stripping calendar trigger
  // leaves the bare host, so re-canonicalise here. Same fix as CD / SDL above
  // (2026-06-28 — surfaced once the recogniser+circuit-bypass let it render).
  cliveemson: 'www.cliveemson.co.uk',
};

export function canonicaliseHouseHost(url, house) {
  const host = WWW_CANONICAL_HOSTS[house];
  if (!host || !url) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(host.replace(/^www\./, ''))) return url;
    parsed.host = host;
    if (/\/search-auction$/i.test(parsed.pathname)) parsed.pathname += '/';
    return parsed.href;
  } catch { return url; }
}

export async function rewriteUrl(url, house) {
  const u = url.toLowerCase();

  if (house === 'savills') {
    // Savills: auctions.savills.co.uk/auctions/{slug} — server-rendered, paginated
    if (u.includes('auctions.savills.co.uk/auctions/')) {
      return { baseUrl: url, isApi: false, paginateAs: 'savills_pages', preferPuppeteer: true };
    }
    // Generic URL (e.g. /upcoming-auctions) — auto-discover the nearest catalogue
    try {
      const resp = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (resp.ok) {
        const html = await resp.text();
        // Find links to specific auction catalogue pages
        const catalogueLinks = [...html.matchAll(/href="(https:\/\/auctions\.savills\.co\.uk\/auctions\/[^"]+)"/gi)];
        if (catalogueLinks.length > 0) {
          const catalogueUrl = catalogueLinks[0][1];
          console.log(`Savills: auto-discovered catalogue ${catalogueUrl} from ${url}`);
          return { baseUrl: catalogueUrl, isApi: false, paginateAs: 'savills_pages', preferPuppeteer: true };
        }
      }
    } catch (e) { console.log('Savills discovery failed:', e.message); }
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'allsop') {
    // Allsop: rewrite catalogue pages to their JSON API
    if (u.includes('residential-auction') || u.includes('lot_type=residential') || u.includes('/insights/') || u.includes('auction-catalogue')) {
      return {
        baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=residential&page=1&react',
        isApi: true,
        paginateAs: 'allsop_api'
      };
    }
    if (u.includes('commercial-auction') || u.includes('lot_type=commercial')) {
      return {
        baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=commercial&page=1&react',
        isApi: true,
        paginateAs: 'allsop_api'
      };
    }
    // If it's the property-search API URL already, use it directly
    if (u.includes('/api/property-search')) {
      return { baseUrl: url, isApi: true, paginateAs: 'allsop_api' };
    }
    // Default: ANY other allsop URL (stale calendar rows like
    // /auctions/future-auction-dates, the homepage, /find-a-property, etc.)
    // → residential catalogue API. Without this default a stale dates-page
    // calendar row fell THROUGH this block and was scraped as raw HTML →
    // JSON.parse failed → 0 lots → probe=error stall (root cause found
    // 2026-06-14; allsop showed 0 of ~431 live lots). The residential
    // endpoint returns the full available book.
    return {
      baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=residential&page=1&react',
      isApi: true,
      paginateAs: 'allsop_api'
    };
  }

  if (house === 'symondsandsampson') {
    // Cloudflare-blocked house — only Firecrawl `proxy:'stealth'` passes CF from
    // our datacenter IP. The bespoke two-tier scraper (lib/scraper/symondsandsampson.js)
    // resolves the soonest upcoming event from the stable events page, then scrapes
    // its lots. baseUrl = the stable events page (event slugs change monthly).
    return {
      baseUrl: 'https://auctions.symondsandsampson.co.uk/events/property-auction/symonds-and-sampson-property-auctions?eventdate=upcoming',
      isApi: false,
      paginateAs: 'symondsandsampson_stealth',
    };
  }

  if (house === 'propertysolvers') {
    // Catalogue lives on the auctions. subdomain WITH a trailing slash —
    // auctions.propertysolvers.co.uk/auction-property-for-sale/ serves all
    // ~123 lots in static HTML. A stale calendar row missing the trailing
    // slash redirected/404'd → 0 lots → probe=error stall (2026-06-14).
    // Force the canonical URL so any propertysolvers row resolves correctly.
    return { baseUrl: 'https://auctions.propertysolvers.co.uk/auction-property-for-sale/', isApi: false, paginateAs: null };
  }

  if (house === 'btgeddisons') {
    // btgeddisons = the BTG Eddisons catalogue (formerly the 'sdl' slug).
    // BTG rebuilt its listing template (structure_drift 2026-06-14 → 0 lots since
    // ~31 May; the old sdl_pages + AI path matched nothing). The new page is
    // server-rendered + paginated (~448 lots, ~9/page), but ?page=1&limit=500
    // returns the WHOLE catalogue in ONE fetch — so force that canonical URL for
    // ANY btgeddisons row and let recogniseBtgEddisonsLotsFromMarkdown parse it
    // (single page, no ?page=N walk). Server HTML, so no Puppeteer needed. 2026-06-14.
    return {
      baseUrl: 'https://www.btgeddisonspropertyauctions.com/properties?page=1&limit=500',
      isApi: false,
      paginateAs: null,
      preferPuppeteer: false,
    };
  }

  if (house === 'pugh') {
    // Pugh: server-rendered Laravel, paginated with ?page=N, 20 lots/page
    // Use preferPuppeteer path so DOM extractor is tried first (avoids Gemini waste)
    // scrapeRenderedPage will fall back to plain HTTP since it's server-rendered
    return { baseUrl: url, isApi: false, paginateAs: 'pugh_pages', preferPuppeteer: true };
  }

  if (house === 'bondwolfe') {
    // Bond Wolfe: the lot listing lives at /auctions/properties/ (JS "Load more"
    // via admin-ajax, behind Cloudflare). Calendar rows sometimes point at
    // marketing landing pages (/property-auctions-west-midlands/...) that carry
    // no lots, so ALWAYS retarget to the canonical listing — the Crawlee render
    // clicks "Load more" to exhaustion there. Needs a rendered browser.
    return { baseUrl: 'https://www.bondwolfe.com/auctions/properties/', isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'webbers') {
    // webbers runs on the Bamboo SaaS subdomain. Calendar/cache rows still hold the
    // old www.webbers.co.uk/online-auctions URL (which only EMBEDS the Bamboo catalogue
    // — no /property/ links of its own), so the rescrape/calendar path scrapes 0.
    // ALWAYS retarget to the Bamboo catalogue (auto-detected platform → extraction +
    // recall sentinel work there). Pairs with the HOUSE_ROOTS + detectAuctionHouse
    // changes in #117 (which only fixed the cron-via-HOUSE_ROOTS path). 2026-06-14.
    return { baseUrl: 'https://webbers.bambooauctions.com/', isApi: false, paginateAs: null };
  }

  if (house === 'pattinson') {
    // Pattinson: React SPA, needs Puppeteer to render. DOM extractor handles bid cards.
    // Falls back to Claude automatically if DOM extraction returns <3 lots.
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'barnardmarcus') {
    // Barnard Marcus: HOUSE_ROOTS points at the rolling /auctions/upcoming/
    // catalogue, which auto-rolls to the live sale (the date-specific pages like
    // /auctions/19-may-2026/ go stale once a sale passes — a stale dated calendar
    // row dropped this house out of scheduling entirely for 3 weeks, 2026-06-17).
    // Any '/auctions/' URL flows straight through. The homepage-discovery branch
    // below is a fallback for when only the bare homepage is passed in.
    if (!u.includes('/auctions/')) {
      try {
        const resp = await fetch('https://www.barnardmarcusauctions.co.uk/', { headers: HEADERS, redirect: 'follow' });
        if (resp.ok) {
          const html = await resp.text();
          const m = html.match(/href="(https:\/\/www\.barnardmarcusauctions\.co\.uk\/auctions\/[\w-]+\/)"/i);
          if (m) return { baseUrl: m[1], isApi: false, paginateAs: null, preferPuppeteer: false };
        }
      } catch (e) { /* fall through to stored URL */ }
    }
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false };
  }

  if (house === 'auctionhouselondon') {
    // Always scrape the rolling /current-auction catalogue. A stale calendar row
    // can pin a specific past-auction URL (e.g. /auction/jun-10-2026) → 0 live
    // lots once that sale passes; /current-auction auto-rolls to the next sale
    // (the deterministic recogniser handles the dense ~96-lot page). 2026-06-14.
    return { baseUrl: 'https://auctionhouselondon.co.uk/current-auction', isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'cliveemson') {
    // Force the www host — the bare cliveemson.co.uk cert is CN-invalid and the
    // Puppeteer render rejects it (see WWW_CANONICAL_HOSTS).
    return { baseUrl: canonicaliseHouseHost(url, house), isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'strettons') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false };
  }

  if (house === 'auctionhouse') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'acuitus') {
    // Acuitus: /find-a-property/ — may need Puppeteer
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'hollismorgan') {
    if (u.includes('bid=')) {
      return { baseUrl: canonicaliseHouseHost(url, house), isApi: false, paginateAs: 'query_page', preferPuppeteer: false };
    }
    try {
      const eigCfg = AUCTION_DISCOVERY.hollismorgan;
      const resp = await fetch(eigCfg.homepage + eigCfg.auctionsIndexPath, { headers: HEADERS, redirect: 'follow' });
      if (resp.ok) {
        const html = await resp.text();
        const bids = [...html.matchAll(eigCfg.linkPattern)].map(m => parseInt(m[1]));
        if (bids.length > 0) {
          const latestBid = Math.max(...bids);
          const discovered = eigCfg.buildUrl(latestBid);
          console.log(`AUTO: hollismorgan discovered bid=${latestBid} → ${discovered}`);
          return { baseUrl: discovered, isApi: false, paginateAs: 'query_page', preferPuppeteer: false };
        }
      }
    } catch (e) { /* fall through to bare URL */ }
    const baseUrl = HOUSE_ROOTS.hollismorgan + '?orderby=lot_no+asc';
    return { baseUrl, isApi: false, paginateAs: 'query_page', preferPuppeteer: false };
  }

  if (house === 'maggsandallen') {
    // Use the URL as-is — calendar or user provides the correct ?auction= param.
    // Falls back to root listing page if no specific auction URL given.
    const baseUrl = u.includes('search-auction') ? canonicaliseHouseHost(url, house) : (HOUSE_ROOTS.maggsandallen + '?orderby=lot_no&n=0');
    return { baseUrl, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'mchughandco') {
    // McHugh & Co: /pages/auctions or /Auctions/LotList.aspx — may need Puppeteer
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'probateauction') {
    // Probate Auction: WordPress with Swiper galleries, property-list-card containers
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'knightfrank') {
    // Knight Frank: date-specific auction pages. Auto-discover from /forthcoming-auctions/
    if (!u.includes('/auction/')) {
      try {
        const resp = await fetch('https://www.knightfrankauctions.com/forthcoming-auctions/', { headers: HEADERS, redirect: 'follow' });
        if (resp.ok) {
          const html = await resp.text();
          const m = html.match(/href="(https:\/\/www\.knightfrankauctions\.com\/auction\/\d+\/[^"]+)"/i);
          if (m) return { baseUrl: m[1], isApi: false, paginateAs: null, preferPuppeteer: false };
        }
      } catch (e) { /* fall through */ }
    }
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false };
  }

  // buttersjohnbee removed — PDF-only catalogues

  // ── New houses ──
  // Strakers: /property-auctions is a marketing LANDING page with zero lots
  // (verified 2026-06-13 — only valuation CTAs). The actual auction lots live
  // at /property-auctions/for-sale/ (guide prices, lot cards). Retarget so the
  // scraper hits the lot listing, not the brochure. JS-rendered → Puppeteer.
  if (house === 'strakers') {
    if (!u.includes('/for-sale')) {
      return { baseUrl: 'https://www.strakers.co.uk/property-auctions/for-sale/', isApi: false, paginateAs: null, preferPuppeteer: true };
    }
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Countrywide: two regional catalogues (SK=Liverpool, SW=South West), paginated with ?page=N
  if (house === 'countrywide') {
    return { baseUrl: url, isApi: false, paginateAs: 'countrywide_pages', preferPuppeteer: false };
  }
  // Sutton Kersh: static HTML gallery with start=N pagination
  if (house === 'suttonkersh') {
    return { baseUrl: url, isApi: false, paginateAs: 'suttonkersh_pages', preferPuppeteer: false };
  }
  // Venmore: static HTML, pagination via ?pageNum=N
  if (house === 'venmore') {
    return { baseUrl: url, isApi: false, paginateAs: null };
  }
  // TCPA: EIG platform, static HTML, pagination via ?page=N
  if (house === 'tcpa') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Future Property Auctions: ASP, static HTML, pagination via ?offset=N
  if (house === 'futureauctions') {
    return { baseUrl: url, isApi: false, paginateAs: null };
  }
  // Kivells: static HTML, pagination via ?pagenum=N
  if (house === 'kivells') {
    return { baseUrl: url, isApi: false, paginateAs: null };
  }
  // First For Auctions: EIG platform, needs Puppeteer
  if (house === 'firstforauctions') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Harman Healy: EIG platform, needs Puppeteer
  if (house === 'harmanhealy') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Seel & Co: EIG platform, needs Puppeteer. showall=true loads all lots
  if (house === 'seelauctions') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Paul Fosh: EIG online auctions platform, needs Puppeteer
  if (house === 'paulfosh') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Cottons: EIG embed via current-auction.htm, needs Puppeteer to render the JS embed
  if (house === 'cottons') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Dedman Gray: EIG embed (tenant 33), JS-rendered table layout, needs Puppeteer
  if (house === 'dedmangray') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Landwood: EIG OAS platform (tenant 188), /current-auction redirects to /future-auctions/
  if (house === 'landwood') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Robinson & Hall: WordPress/Elementor, needs Puppeteer
  if (house === 'robinsonhall') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // ── New EIG houses (March 2026 batch) ──
  if (house === 'astleys') {
    return { baseUrl: 'https://astleys.eigonlineauctions.com/search', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'henrysykes') {
    return { baseUrl: 'https://onlineauctions.henrysykes.co.uk/search', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'clarkesimpson') {
    return { baseUrl: 'https://clarke-simpson.eigonlineauctions.com/search', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'durrants') {
    return { baseUrl: 'https://durrants.com/property-auctions/next-property-auction', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'dawsons') {
    return { baseUrl: 'https://www.dawsonsproperty.co.uk/auctions.php', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'goldings') {
    return { baseUrl: 'https://www.goldingsauctions.co.uk/auctions/next-auction/', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Auction House UK branches
  if (house === 'auctionhousescotland') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/scotland/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'austingray') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/sussexandhampshire', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Auction House UK batch 4 branches
  if (house === 'auctionhousedevon') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/devonandcornwall/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'auctionhouseeastmidlands') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/eastmidlands/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'auctionhousewestmidlands') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/westmidlands/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'auctionhouseessex') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/essex/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'auctionhousemanchester') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/manchester/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // Symonds & Sampson: WebDadi two-tier — events page lists auctions (one per branch),
  // each links to a lot listing where the actual property lots live. The events page
  // ALSO uses FeaturedGrid cards for the events themselves, so we cannot short-circuit
  // on FeaturedGrid presence — we must require /property/ hrefs to be confident the
  // page has actual lots vs. a list of auction events to drill into.
  if (house === 'symondsandsampson') {
    const eventsUrl = HOUSE_ROOTS.symondsandsampson || url;
    const origin = new URL(eventsUrl).origin;
    // Broader event-link regex set — covers /event/, /events/, /auction/, /properties/ shapes
    const eventPatterns = [
      /href="(\/event\/[^"]*auction[^"]*)"/gi,
      /href="(\/events\/[^"]*auction[^"]*)"/gi,
      /href="(\/event\/property[^"]*)"/gi,
      /href="(\/events?\/property-auction\/[^"#?]+)"/gi,
      /href="(\/auction\/[^"#?]+)"/gi,
      /href="(\/properties\/[^"#?]+)"/gi,
    ];
    // A page is "lot-bearing" only if it has /property/ hrefs (individual lot links)
    const hasLotLinks = (html) => /href="[^"]*\/property\/[^"#?]+/i.test(html || '');

    const discoverFromHtml = (html) => {
      if (!html) return null;
      // If the page has /property/ links, treat it as the lot-bearing page directly
      if (hasLotLinks(html)) return { baseUrl: eventsUrl, direct: true };
      // Otherwise hunt for an event-detail link to drill into
      for (const pattern of eventPatterns) {
        const matches = [...html.matchAll(pattern)];
        if (matches.length > 0) {
          // De-dup, exclude the events listing itself, and prefer the first event detail page
          const candidates = [...new Set(matches.map(m => m[1]))]
            .filter(p => !p.includes('eventdate=upcoming'))
            .filter(p => p !== new URL(eventsUrl).pathname + (new URL(eventsUrl).search || ''));
          if (candidates.length > 0) return { baseUrl: origin + candidates[0], direct: false };
        }
      }
      return null;
    };

    // Try plain HTTP first
    let discovered = null;
    try {
      const resp = await fetch(eventsUrl, { headers: HEADERS, redirect: 'follow' });
      if (resp.ok) discovered = discoverFromHtml(await resp.text());
    } catch (e) { console.log('Symonds plain HTTP discovery failed:', e.message); }

    // Crawlee render fallback for JS-rendered events pages (non-FC). Plain HTTP
    // above handles server-rendered events pages; this covers the JS-hydrated
    // case that previously needed Firecrawl. Stealth LOT scraping still goes
    // through symondsandsampson.js — this is discovery only.
    if (!discovered && hasCrawlee()) {
      try {
        const rendered = await scrapeWithCrawlee(eventsUrl);
        discovered = discoverFromHtml(rendered.html);
      } catch (e) { console.log('Symonds Crawlee discovery failed:', e.message); }
    }

    if (discovered) {
      console.log(`Symonds: ${discovered.direct ? 'using events URL directly (has /property/ links)' : 'drilled into event detail ' + discovered.baseUrl}`);
      return { baseUrl: discovered.baseUrl, isApi: false, paginateAs: null, preferPuppeteer: true };
    }
    // Last resort — mark as blocked rather than scrape the wrong page (which produces
    // 13 placeholder lots from event-card branches). Better to show 0 + alert than 13 fakes.
    console.log('Symonds: no lot-bearing page found; marking blocked to avoid scraping events page as lots');
    return { baseUrl: eventsUrl, isApi: false, paginateAs: null, preferPuppeteer: true, blocked: true };
  }

  // GTH: Homeflow SPA — needs JS rendering + extended wait for SPA hydration.
  // Homeflow loads property cards via AJAX after page load. Standard scroll+wait actions aren't enough.
  // Custom actions: long initial wait for SPA hydration, then poll for property cards, then scroll for images.
  // Note: cleetompkinson was removed 2026-04-25 — its page is server-rendered Ctesius (.propertyTeaser),
  // plain HTTP is sufficient and faster.
  // Note: stags removed 2026-04-25 — migrated from Homeflow to Bamboo Auctions (stags.bambooauctions.com).
  // The old stags.co.uk/pages/auction-properties page is now a "Dummy" CMS placeholder. Catalogue
  // moved to the SaaS subdomain — handled by the bamboo platform extractor (carterjonas: same migration).
  if (house === 'gth') {
    const homeflowActions = [
      { type: 'wait', milliseconds: 5000 },
      // Trigger any deferred search by scrolling into view — Homeflow often lazy-inits on scroll
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 3000 },
      // Poll for property cards to appear (Homeflow AJAX may take a while)
      { type: 'executeJavascript', script: `
        await new Promise(resolve => {
          let attempts = 0;
          const check = () => {
            const cards = document.querySelectorAll('.property-results-list li, .property-card, [class*="PropertyCard"], [class*="property-result"]');
            if (cards.length > 0 || attempts++ > 20) return resolve();
            setTimeout(check, 500);
          };
          check();
        });
      ` },
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 1500 },
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 1500 },
      // Force lazy-loaded images
      { type: 'executeJavascript', script: `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });` },
      { type: 'scroll', direction: 'up' },
      { type: 'scroll', direction: 'up' },
      { type: 'scroll', direction: 'up' },
    ];
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true, waitFor: 12000, actions: homeflowActions };
  }

  // Robin Jessop: StackProtect reCAPTCHA v3 blocks all automated requests.
  // Firecrawl and Puppeteer both fail. Skip to save credits — revisit if StackProtect is removed.
  if (house === 'robinjessop') {
    console.log(`${house}: skipped — StackProtect reCAPTCHA blocks all automated scraping`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true, waitFor: 8000, blocked: true };
  }

  // Halls (Shrewsbury): the 2026-04-25 audit found an HTTP 401 wall on the
  // old /property-auction/ URL. The new /property-search/?search_type=auction
  // catalogue (set 2026-05-09) returns HTTP 200 publicly — verified by plain
  // curl + Firecrawl probe. Treating halls as a normal Firecrawl-rendered
  // house. Revisit if a future blocking pattern reappears on the new URL.
  if (house === 'lextons') {
    // RETIRED: lextons.com domain parked / redirects to /lander. Previously
    // produced 31 lots all sharing one Brighton-pier hero image (hero bleed),
    // and case-duplicated rows under both 'lextons' and 'Lextons' slugs.
    // Block here so any straggler URL routed by detectAuctionHouse() short-
    // circuits before scrape. Data purged 2026-04-25.
    console.log(`${house}: skipped — slug retired (domain parked)`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }

  // ── Blocked houses (2026-05-30): self-healing exhausted all 5 strategies
  // or URL found but still returns 0 lots. Blocking saves Firecrawl credits
  // until a human-supplied new URL or manual fix.
  if (house === 'scargillmann') {
    console.log(`${house}: skipped — healing exhausted (no catalogue URL found)`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }
  if (house === 'brggibson') {
    console.log(`${house}: skipped — healing exhausted (no catalogue URL found)`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }
  if (house === 'brggibsondublin') {
    console.log(`${house}: skipped — healing exhausted (no catalogue URL found)`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }
  if (house === 'romanway') {
    console.log(`${house}: skipped — healing exhausted (no catalogue URL found)`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }
  if (house === 'auctionhousebirmingham') {
    console.log(`${house}: skipped — URL found but persistently returns 0 lots (was 28)`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }
  if (house === 'starpropertyonline') {
    console.log(`${house}: skipped — URL found but persistently returns 0 lots (was 16)`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }

  // aldreds: infinite redirect loop (2026-05-30) — /auction/ → /?view=article... → loops
  if (house === 'aldreds') {
    console.log(`${house}: skipped — infinite redirect loop on catalogue URL`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }

  // hackneyandleigh: SSL handshake failure (2026-05-30) — site unreachable
  if (house === 'hackneyandleigh') {
    console.log(`${house}: skipped — SSL handshake failure (site unreachable)`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false, blocked: true };
  }

  // Hunters: Bamboo Auctions React SPA, needs Puppeteer
  if (house === 'hunters') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // GOTO Properties / Purplebricks: EIG platform, server-rendered, paginated (?page=N, 48/page)
  if (house === 'purplebricksgoto') {
    return { baseUrl: url, isApi: false, paginateAs: 'pugh_pages', preferPuppeteer: false };
  }

  // Unknown houses: prefer Puppeteer since most modern auction sites are JS-rendered
  if (house === 'unknown') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // Known houses without specific rewrite rules — static HTML works for these
  return { baseUrl: url, isApi: false, paginateAs: null };
}
