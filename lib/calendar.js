// lib/calendar.js — Fallback auction calendar data + helpers
import { supabase } from './supabase.js';
import { normaliseUrl } from './utils.js';

export const FALLBACK_CALENDAR = [
    // ── SAVILLS ──
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-03-31', title: '31 March 2026', lots: null,
      url: 'https://auctions.savills.co.uk/auctions/31-march-2026-220',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-04-21', title: '21 April 2026', lots: null,
      url: 'https://auctions.savills.co.uk/auctions/21-april-2026-221',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-05-06', title: '6 May 2026', lots: null,
      url: 'https://auctions.savills.co.uk/auctions/6-may-2026-222',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── ALLSOP ──
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-25', dateEnd: '2026-03-26',
      title: '25 & 26 March 2026 — Residential', lots: null,
      url: 'https://www.allsop.co.uk/residential-auction-view-mar',
      location: 'Online (Live Stream)', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-24', title: '24 March 2026 — Commercial', lots: null,
      url: 'https://www.allsop.co.uk/commercial-auction-view',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-25', dateEnd: '2026-03-26',
      title: '25 & 26 March 2026 — Residential', lots: null,
      url: 'https://www.allsop.co.uk/residential-auction-view',
      location: 'Online (Live Stream)', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    // ── NETWORK AUCTIONS ──
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/next-auction/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-05-07', title: '7 May 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/future-auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-06-18', title: '18 June 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/future-auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    // ── BTG EDDISONS (formerly SDL Auctions) ──
    // BTG Eddisons runs rolling timed auctions — all current lots on /properties/
    {
      house: 'BTG Eddisons', houseSlug: 'sdl', logo: '⚡',
      date: '2026-03-25', title: 'Multi-Lot Timed Auction — March 2026', lots: null,
      url: 'https://www.btgeddisonspropertyauctions.com/properties/',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-03-24', title: '24 March 2026 — Timed', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1311/multi-lot-timed-auction-2026-03-24/',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-03-26', title: '26 March 2026 — Live Streamed', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1297/live-streamed-auction-2026-03-26/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── BOND WOLFE ──
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.bondwolfe.com/auction/3448/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-05-14', title: '14 May 2026', lots: null,
      url: 'https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-07-09', title: '9 July 2026', lots: null,
      url: 'https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── BARNARD MARCUS ──
    {
      house: 'Barnard Marcus', houseSlug: 'barnardmarcus', logo: '🏠',
      date: '2026-05-19', title: '19 May 2026', lots: null,
      url: 'https://www.barnardmarcusauctions.co.uk/auctions/19-may/',
      location: 'Grand Connaught Rooms, London WC2B', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── AUCTION HOUSE LONDON ──
    {
      house: 'Auction House London', houseSlug: 'auctionhouselondon', logo: '🔑',
      date: '2026-03-18', title: '18-19 March 2026', lots: null,
      url: 'https://auctionhouselondon.co.uk/current-auction/catalogue/18th-19th-march-2026',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House London', houseSlug: 'auctionhouselondon', logo: '🔑',
      date: '2026-03-18', dateEnd: '2026-03-19', title: '18 & 19 March 2026', lots: null,
      url: 'https://auctionhouselondon.co.uk/auction/march-18-19-2026',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── CLIVE EMSON ──
    {
      house: 'Clive Emson', houseSlug: 'cliveemson', logo: '🌿',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.cliveemson.co.uk/properties/',
      location: 'Online', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    // ── STRETTONS ──
    {
      house: 'Strettons', houseSlug: 'strettons', logo: '📋',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.strettons.co.uk/auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── ACUITUS ──
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-05-06', title: '6 May 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-06-11', title: '11 June 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── PROBATE AUCTION ──
    {
      house: 'Probate Auction', houseSlug: 'probateauction', logo: '⚖️',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://probate.auction/auctions/wednesday-25th-march-2026/',
      location: 'Online', type: 'Residential (Probate)', status: 'upcoming',
      catalogueReady: true,
    },
    // ── HOLLIS MORGAN (Bristol) ──
    {
      house: 'Hollis Morgan', houseSlug: 'hollismorgan', logo: '🏘️',
      date: '2026-04-22', title: '22 April 2026', lots: null,
      url: 'https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc',
      location: 'Online (Live Stream from Clifton, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── MAGGS & ALLEN (Bristol) ──
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-04-23', title: '23 April 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/?auction=1&orderby=lot_no&n=0&showsold=on&showstc=on',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-05-20', title: '20 May 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/?auction=1&orderby=lot_no&n=0&showsold=on&showstc=on',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── MCHUGH & CO ──
    // McHugh uses EIG OAS platform. /current-auction redirects to /future-auctions/{auctionId}.
    // Large page (1.5MB, 200+ lots), needs Puppeteer with extended timeout.
    {
      house: 'McHugh & Co', houseSlug: 'mchughandco', logo: '🏡',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://www.mchughandco.com/current-auction',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'McHugh & Co', houseSlug: 'mchughandco', logo: '🏡',
      date: '2026-05-13', title: '13 May 2026', lots: null,
      url: 'https://www.mchughandco.com/current-auction',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── AUCTION HOUSE UK (National franchise) ──
    {
      house: 'Auction House UK', houseSlug: 'auctionhouse', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026 (National Online)', lots: null,
      url: 'https://www.auctionhouse.co.uk/online',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── KNIGHT FRANK ──
    {
      house: 'Knight Frank', houseSlug: 'knightfrank', logo: '👑',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.knightfrankauctions.com/auction/3833/knight-frank-auctions-2026-03-19/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Knight Frank', houseSlug: 'knightfrank', logo: '👑',
      date: '2026-05-07', title: '7 May 2026', lots: null,
      url: 'https://www.knightfrankauctions.com/auction/3834/knight-frank-auctions-2026-05-07/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── PATTINSON ──
    {
      house: 'Pattinson', houseSlug: 'pattinson', logo: '🔷',
      date: '2026-03-25', title: 'March 2026 (North East)', lots: null,
      url: 'https://www.pattinson.co.uk/auction',
      location: 'Newcastle', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

    // ── BIDX1 ──
    {
      house: 'BidX1', houseSlug: 'bidx1', logo: '💻',
      date: '2026-03-19', title: 'March 2026 (Online)', lots: null,
      url: 'https://bidx1.com/en/united-kingdom',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── PHILLIP ARNOLD ──
    {
      house: 'Phillip Arnold', houseSlug: 'philliparnold', logo: '🔨',
      date: '2026-04-16', title: '16 April 2026', lots: null,
      url: 'https://www.philliparnoldauctions.co.uk/current-lots',
      location: 'London', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── EDWARD MELLOR ──
    {
      house: 'Edward Mellor', houseSlug: 'edwardmellor', logo: '🏘️',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://edwardmellor.co.uk/auctions/25mar2026',
      location: 'Manchester', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── PAUL FOSH ──
    {
      house: 'Paul Fosh', houseSlug: 'paulfosh', logo: '🏴',
      date: '2026-12-03', title: 'December 2026 Online Auction', lots: null,
      url: 'https://paulfosh.eigonlineauctions.com/search',
      location: 'Newport / National', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── COTTONS ──
    // Cottons uses EIG embed via current-auction.htm (not /current-auction/ WordPress page).
    // EIG tenant_id=26, auction embed ID=82e84b89-9423-459c-bbd9-7462f82e35e2.
    // Next auction: April 22, 2026 — catalogue not yet published.
    {
      house: 'Cottons', houseSlug: 'cottons', logo: '🏭',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.cottons.co.uk/current-auction/',
      location: 'Birmingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── DEDMAN GRAY ──
    {
      house: 'Dedman Gray', houseSlug: 'dedmangray', logo: '📋',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.dedmangray.co.uk/auction/?q=1&tid=432',
      location: 'Essex', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── BARNETT ROSS ──
    {
      house: 'Barnett Ross', houseSlug: 'barnettross', logo: '🔑',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.barnettross.co.uk/current.php',
      location: 'London', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── BRADLEY HALL ──
    {
      house: 'Bradley Hall', houseSlug: 'bradleyhall', logo: '🏠',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://auction.bradleyhall.co.uk/',
      location: 'Newcastle', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── CONNECT UK ──
    {
      house: 'Connect UK', houseSlug: 'connectuk', logo: '🔗',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://connectukgroup.co.uk/auctions/',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── AUCTION ESTATES ──
    {
      house: 'Auction Estates', houseSlug: 'auctionestates', logo: '🏢',
      date: '2026-04-23', title: '23 April 2026', lots: null,
      url: 'https://www.auctionestates.co.uk/view-properties',
      location: 'Nottingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── LANDWOOD ──
    {
      house: 'Landwood', houseSlug: 'landwood', logo: '🌲',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.landwoodpropertyauctions.com/',
      location: 'Manchester', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── LOVEITTS ──
    {
      house: 'Loveitts', houseSlug: 'loveitts', logo: '❤️',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.loveitts.co.uk/auction/',
      location: 'Coventry', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── HUNTERS ──
    {
      house: 'Hunters', houseSlug: 'hunters', logo: '🏠',
      date: '2026-03-16', title: 'Online Auction', lots: null,
      url: 'https://hunters.bambooauctions.com',
      location: 'National', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

    // ── NEW HOUSES ──
    // Countrywide Property Auctions
    {
      house: 'Countrywide Property Auctions', houseSlug: 'countrywide', logo: '🌍',
      date: '2026-04-02', title: '2 April 2026 — South West', lots: null,
      url: 'https://www.countrywidepropertyauctions.co.uk/search.php?auction_date=current',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Sutton Kersh
    {
      house: 'Sutton Kersh', houseSlug: 'suttonkersh', logo: '🏛️',
      date: '2026-04-02', title: '2 April 2026 — Liverpool', lots: null,
      url: 'https://www.suttonkersh.co.uk/properties/gallery/?section=auction&auctionPeriod=current',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Venmore Auctions
    {
      house: 'Venmore Auctions', houseSlug: 'venmore', logo: '🏛️',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://www.venmoreauctions.co.uk/Property-Search',
      location: 'Liverpool', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Town & Country Property Auctions
    {
      house: 'Town & Country Property Auctions', houseSlug: 'tcpa', logo: '🏡',
      date: '2026-03-25', title: '25 March 2026 — National', lots: null,
      url: 'https://www.townandcountrypropertyauctions.co.uk/search',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Future Property Auctions
    {
      house: 'Future Property Auctions', houseSlug: 'futureauctions', logo: '🔮',
      date: '2026-03-19', title: '19 March 2026 — Timed Online', lots: null,
      url: 'https://www.futurepropertyauctions.co.uk/catalogue_viewall.asp',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Kivells
    {
      house: 'Kivells', houseSlug: 'kivells', logo: '🐑',
      date: '2026-03-20', title: 'March 2026 — Devon & Cornwall', lots: null,
      url: 'https://www.kivells.com/residential-property/properties-for-auction',
      location: 'Devon & Cornwall', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    // First For Auctions
    {
      house: 'First For Auctions', houseSlug: 'firstforauctions', logo: '🥇',
      date: '2026-03-15', title: 'March 2026 — National', lots: null,
      url: 'https://online.firstforauctions.co.uk/search?view=Grid',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Harman Healy
    {
      house: 'Harman Healy', houseSlug: 'harmanhealy', logo: '🔨',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.harman-healy.co.uk/search/auction',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Seel & Co
    {
      house: 'Seel & Co', houseSlug: 'seelauctions', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://online.seelauctions.co.uk/search?view=Grid&showall=true',
      location: 'Cardiff', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Robinson & Hall
    {
      house: 'Robinson & Hall', houseSlug: 'robinsonhall', logo: '🏠',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://robinsonandhallauctions.co.uk/catalogues/',
      location: 'Bedford / Milton Keynes', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── NEW EIG HOUSES (March 2026 batch) ──
    {
      house: 'Astleys', houseSlug: 'astleys', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-25', title: 'March 2026 — Swansea', lots: null,
      url: 'https://astleys.eigonlineauctions.com/search',
      location: 'Swansea', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Henry Sykes Auctions', houseSlug: 'henrysykes', logo: '🔨',
      date: '2026-03-25', title: 'March 2026 — Online', lots: null,
      url: 'https://onlineauctions.henrysykes.co.uk/search',
      location: 'National (Franchise)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Clarke & Simpson', houseSlug: 'clarkesimpson', logo: '🔨',
      date: '2099-12-31', title: 'Current Catalogue', lots: null,
      url: 'https://clarke-simpson.eigonlineauctions.com/search',
      location: 'Suffolk', type: 'Residential & Land', status: 'always_on',
      catalogueReady: true,
    },
    {
      house: 'Durrants', houseSlug: 'durrants', logo: '🏡',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://durrants.com/property-auctions/next-property-auction',
      location: 'Norfolk / Suffolk', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Dawsons', houseSlug: 'dawsons', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-20', title: 'March 2026 — South Wales', lots: null,
      url: 'https://www.dawsonsproperty.co.uk/auctions.php',
      location: 'South Wales', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Goldings', houseSlug: 'goldings', logo: '🔨',
      date: '2026-05-06', title: '6 May 2026 — Ipswich', lots: null,
      url: 'https://www.goldingsauctions.co.uk/auctions/next-auction/',
      location: 'Ipswich / Suffolk', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Scotland', houseSlug: 'auctionhousescotland', logo: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/scotland/auction/search-results',
      location: 'Scotland', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Sussex & Hampshire', houseSlug: 'austingray', logo: '🏠',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/sussexandhampshire',
      location: 'Sussex & Hampshire', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── NEW HOUSES (March 2026 batch 2 — missing from original calendar) ──
    {
      house: 'Agents Property Auction', houseSlug: 'agentsproperty', logo: '🏠',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.agentspropertyauction.com/next-auction/',
      location: 'National', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Andrew Craig', houseSlug: 'andrewcraig', logo: '🏠',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.andrewcraig.co.uk/auction-property-for-sale',
      location: 'North East', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Butters John Bee', houseSlug: 'buttersjohnbee', logo: '🐝',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.buttersjohnbee.com/listings?auction=1&status=all',
      location: 'Staffordshire', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Brown & Co', houseSlug: 'brownco', logo: '🌾',
      date: '2026-03-17', title: '17 March 2026', lots: null,
      url: 'https://brownandco.eigonlineauctions.com/search',
      location: 'East Anglia', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Cheffins', houseSlug: 'cheffins', logo: '🔨',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.cheffins.co.uk/property-auctions/catalogue-view',
      location: 'Cambridge', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Cheffins Timed', houseSlug: 'cheffinstimed', logo: '⏱️',
      date: '2026-03-25', title: 'March 2026 — Timed', lots: null,
      url: 'https://timedpropertyauctions.cheffins.co.uk/search',
      location: 'Cambridge', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Feather Smailes & Scales', houseSlug: 'fssproperty', logo: '⚖️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.fssproperty.co.uk/search-auction/?bid=AUC&showsold=on&showstc=on',
      location: 'Yorkshire', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'iamsold', houseSlug: 'iamsold', logo: '💻',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.iamsold.co.uk/available-properties/',
      location: 'National', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

    // ── Auction House UK regional branches ──
    {
      house: 'Auction House East Anglia', houseSlug: 'auctionhouseeastanglia', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/eastanglia/auction/search-results',
      location: 'East Anglia', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House North West', houseSlug: 'auctionhousenorthwest', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/northwest/auction/search-results',
      location: 'North West', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House North East', houseSlug: 'auctionhousenortheast', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/northeast/auction/search-results',
      location: 'North East', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Wales', houseSlug: 'auctionhousewales', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/southwales/auction/search-results',
      location: 'Wales', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Birmingham', houseSlug: 'auctionhousebirmingham', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/birmingham/auction/search-results',
      location: 'Birmingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Kent', houseSlug: 'auctionhousekent', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/kent/auction/search-results',
      location: 'Kent', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
];

export async function getAuctionCalendar() {
  // Try Supabase first
  try {
    const now = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('*')
      .gte('date', now)
      .order('date', { ascending: true });

    if (!error && data && data.length > 0) {
      // Deduplicate: keep one entry per house+date+url (prefer catalogue_ready=true)
      const seen = new Map();
      for (const row of data) {
        const key = `${(row.house || '').toLowerCase()}|${row.date}|${normaliseUrl(row.url)}`;
        const existing = seen.get(key);
        if (!existing || (row.catalogue_ready && !existing.catalogue_ready)) {
          seen.set(key, row);
        }
      }
      return [...seen.values()].map(row => ({
        id: row.id,
        house: row.house,
        houseSlug: row.house_slug,
        logo: row.logo,
        date: row.date,
        dateEnd: row.date_end || undefined,
        title: row.title,
        lots: row.lots,
        url: row.url,
        location: row.location,
        type: row.type,
        status: row.status,
        catalogueReady: row.catalogue_ready,
      }));
    }
  } catch (e) {
    console.warn('Calendar DB read failed, using fallback:', e.message);
  }

  // Fallback to hardcoded
  const now = new Date().toISOString().slice(0, 10);
  return FALLBACK_CALENDAR
    .filter(a => a.date >= now || a.status === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getCalendarAuctions() {
  const today = new Date().toISOString().slice(0, 10);
  // Include last 7 days for past failed scrape auditing
  const lookback = new Date();
  lookback.setDate(lookback.getDate() - 7);
  const lookbackDate = lookback.toISOString().slice(0, 10);
  // Try Supabase first — include dated auctions (lookback) + always_on houses
  try {
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('house, url, date, catalogue_ready, status')
      .eq('catalogue_ready', true)
      .or(`date.gte.${lookbackDate},status.eq.always_on`)
      .order('date', { ascending: true });

    const alwaysOn = (data || []).filter(r => r.status === 'always_on').length;
    const dated = (data || []).filter(r => r.status !== 'always_on').length;
    console.log(`getCalendarAuctions: Supabase returned ${(data || []).length} rows (${alwaysOn} always_on, ${dated} dated), error=${error ? error.message : 'none'}`);
    if (!error && data && data.length > 0) {
      // Deduplicate by normalised URL — keep earliest date per URL
      const seen = new Map();
      for (const row of data) {
        const norm = normaliseUrl(row.url);
        if (!norm) continue;
        if (!seen.has(norm) || (row.date && (!seen.get(norm).date || row.date < seen.get(norm).date))) {
          seen.set(norm, row);
        }
      }
      const deduped = [...seen.values()];
      if (deduped.length < data.length) {
        console.log(`getCalendarAuctions: Deduplicated ${data.length} → ${deduped.length} rows by URL`);
      }
      return deduped.map(row => ({
        house: row.house,
        url: row.url,
        date: row.date,
        catalogueReady: row.catalogue_ready,
        status: row.status || 'upcoming',
      }));
    }
    console.log('getCalendarAuctions: Supabase returned 0 rows, falling through to fallback');
  } catch (e) {
    console.warn('Calendar DB read failed in getCalendarAuctions, using fallback:', e.message);
  }

  // Fallback to hardcoded (no always_on in fallback)
  const fallbackFiltered = FALLBACK_CALENDAR.filter(a => a.catalogueReady && a.date >= lookbackDate);
  console.log(`getCalendarAuctions: Using FALLBACK — ${FALLBACK_CALENDAR.filter(a => a.catalogueReady).length} catalogue-ready, ${fallbackFiltered.length} within lookback (${lookbackDate})`);
  return fallbackFiltered
    .map(a => ({
      house: a.house,
      url: a.url,
      date: a.date,
      catalogueReady: a.catalogueReady,
      status: 'upcoming',
    }));
}
