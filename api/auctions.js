// ═══════════════════════════════════════════════════════════════
// AUCTION CALENDAR API
// Returns upcoming auction dates across major UK auction houses
// In production, this would scrape/cache from each house's website
// For now, serves a curated list that's easy to update
// ═══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  // In a production version, this would scrape auction house websites
  // or use their APIs/RSS feeds. For now, a manually curated list.
  // Update this monthly or set up a cron job to scrape automatically.

  const auctions = [
    // ── SAVILLS ──
    {
      house: 'Savills',
      houseSlug: 'savills',
      logo: '🏛️',
      date: '2026-02-24',
      dateEnd: '2026-02-25',
      title: '24 & 25 February 2026',
      lots: 280,
      url: 'https://auctions.savills.co.uk/auctions/24--25-february-2026-218',
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'upcoming',
    },
    {
      house: 'Savills',
      houseSlug: 'savills',
      logo: '🏛️',
      date: '2026-03-24',
      dateEnd: '2026-03-25',
      title: '24 & 25 March 2026',
      lots: null,
      url: 'https://auctions.savills.co.uk',
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'upcoming',
    },
    // ── ALLSOP ──
    {
      house: 'Allsop',
      houseSlug: 'allsop',
      logo: '🔨',
      date: '2026-02-18',
      title: '18 February 2026 - Residential',
      lots: 200,
      url: 'https://www.allsop.co.uk/auction-calendar/',
      location: 'Online',
      type: 'Residential',
      status: 'upcoming',
    },
    {
      house: 'Allsop',
      houseSlug: 'allsop',
      logo: '🔨',
      date: '2026-03-11',
      title: '11 March 2026 - Commercial',
      lots: null,
      url: 'https://www.allsop.co.uk/auction-calendar/',
      location: 'Online',
      type: 'Commercial',
      status: 'upcoming',
    },
    // ── SDL AUCTIONS ──
    {
      house: 'SDL Auctions',
      houseSlug: 'sdl',
      logo: '⚡',
      date: '2026-02-27',
      title: '27 February 2026 - National',
      lots: 150,
      url: 'https://www.sdlauctions.co.uk/property-auctions/upcoming/',
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'upcoming',
    },
    {
      house: 'SDL Auctions',
      houseSlug: 'sdl',
      logo: '⚡',
      date: '2026-03-26',
      title: '26 March 2026 - National',
      lots: null,
      url: 'https://www.sdlauctions.co.uk/property-auctions/upcoming/',
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'upcoming',
    },
    // ── NETWORK AUCTIONS ──
    {
      house: 'Network Auctions',
      houseSlug: 'network',
      logo: '🌐',
      date: '2026-03-05',
      title: '5 March 2026',
      lots: 80,
      url: 'https://www.networkauctions.co.uk',
      location: 'Online',
      type: 'Residential',
      status: 'upcoming',
    },
    // ── AUCTION HOUSE UK ──
    {
      house: 'Auction House',
      houseSlug: 'auctionhouse',
      logo: '🏠',
      date: '2026-02-26',
      title: '26 February 2026 - London',
      lots: 120,
      url: 'https://www.auctionhouse.co.uk/auction/results',
      location: 'London',
      type: 'Residential',
      status: 'upcoming',
    },
    {
      house: 'Auction House',
      houseSlug: 'auctionhouse',
      logo: '🏠',
      date: '2026-03-12',
      title: '12 March 2026 - North West',
      lots: null,
      url: 'https://www.auctionhouse.co.uk/auction/results',
      location: 'Manchester',
      type: 'Residential',
      status: 'upcoming',
    },
    // ── BARNARD MARCUS / COUNTRYWIDE ──
    {
      house: 'Barnard Marcus',
      houseSlug: 'barnardmarcus',
      logo: '🏘️',
      date: '2026-03-03',
      title: '3 March 2026',
      lots: 90,
      url: 'https://www.barnardmarcusauctions.co.uk',
      location: 'London',
      type: 'Residential',
      status: 'upcoming',
    },
    // ── CLIVE EMSON ──
    {
      house: 'Clive Emson',
      houseSlug: 'cliveemson',
      logo: '🔑',
      date: '2026-03-18',
      title: '18 March 2026',
      lots: null,
      url: 'https://www.cliveemson.co.uk',
      location: 'South East',
      type: 'Residential & Land',
      status: 'upcoming',
    },
    // ── STRETTONS ──
    {
      house: 'Strettons',
      houseSlug: 'strettons',
      logo: '📋',
      date: '2026-03-10',
      title: '10 March 2026',
      lots: null,
      url: 'https://www.strettons.co.uk',
      location: 'London',
      type: 'Residential & Commercial',
      status: 'upcoming',
    },
    // ── PUGH ──
    {
      house: 'Pugh',
      houseSlug: 'pugh',
      logo: '🏗️',
      date: '2026-02-20',
      title: '20 February 2026',
      lots: 100,
      url: 'https://www.pughauctions.com',
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'upcoming',
    },
  ];

  // Sort by date, filter to upcoming only
  const now = new Date().toISOString().slice(0, 10);
  const upcoming = auctions
    .filter(a => a.date >= now || a.status === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));

  return res.status(200).json({
    updated: new Date().toISOString(),
    count: upcoming.length,
    auctions: upcoming,
  });
}
