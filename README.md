# Bridgematch — UK Property Auction Directory

A free public auction directory and AI-powered deal analyser at [bridgematch.co.uk](https://bridgematch.co.uk). Lists upcoming auction dates across all major UK houses, with a built-in catalogue analyser that scores every lot, finds title splits, and filters to your budget.

## URLs

- `bridgematch.co.uk/auctions` — Upcoming auction dates directory
- `bridgematch.co.uk/analyse` — AI-powered catalogue analyser

## Architecture

```
Express server (server.js)
├── GET  /api/auctions     → Returns upcoming auction dates
├── POST /api/analyse       → Scrapes catalogue, Claude extracts, scores lots
├── GET  /auctions          → Serves index.html (directory tab)
├── GET  /analyse           → Serves index.html (analyser tab)
└── GET  /                  → Serves index.html
```

## Deploy to Railway (5 minutes)

### Prerequisites
- GitHub account
- Railway account (railway.app)
- Anthropic API key (console.anthropic.com)

### Steps

1. **Push to GitHub**
   ```bash
   cd auction-directory
   git init
   git add -A
   git commit -m "Initial commit"
   gh repo create bridgematch --private --push
   ```

2. **Connect to Railway**
   - Go to [railway.app/new](https://railway.app/new)
   - Select "Deploy from GitHub repo"
   - Pick your `bridgematch` repo
   - Railway auto-detects Node.js and runs `npm start`

3. **Add your API key**
   - In Railway dashboard → your service → Variables tab
   - Add: `ANTHROPIC_API_KEY` = `sk-ant-your-key-here`
   - Railway auto-redeploys

4. **Custom domain**
   - Settings → Networking → Custom Domain
   - Add `bridgematch.co.uk`
   - Update your DNS as Railway instructs (CNAME record)

5. **Done.** Your site is live at `bridgematch.co.uk`

## How It Works

### Auction Calendar
The `/api/auctions` endpoint returns upcoming auction dates. Currently this is a manually curated list — update it monthly or set up a scraper cron job.

### Catalogue Analyser
1. User pastes any auction catalogue URL
2. Frontend sends URL to `/api/analyse`
3. Server fetches all catalogue pages directly (no CORS issues)
4. Each page's HTML is stripped and sent to Claude (Sonnet) with extraction instructions
5. Claude returns structured lot data as JSON
6. Server runs the scoring engine (identical to the Python version):
   - Property type, bedrooms, tenure, condition detection
   - Title split detection (7 pattern types)
   - Opportunity scoring: modernisation, executor, receivership, dev potential, extension, £/sqft, yield
   - Risk scoring: sitting tenants, knotweed, flood, non-standard construction
   - Budget filtering with separate limits for standard vs title split deals
7. Results returned to frontend as structured JSON

### Supported Auction Houses
The Claude-powered parser works with any HTML structure. Tested/optimised for:
- Savills
- Allsop
- SDL Auctions
- Network Auctions
- Auction House UK
- Barnard Marcus
- Clive Emson
- Strettons
- Pugh

Pagination patterns are handled for each house.

## API Costs

Each catalogue analysis uses Claude Sonnet. Typical costs:
- 28-page Savills catalogue: ~10 API calls × ~4k tokens each ≈ $0.15
- Smaller catalogues (10 pages): ~$0.05
- Very small catalogues (1-3 pages): ~$0.02

At 10 analyses per day, expect ~$1.50/day or ~$45/month.

## Updating the Auction Calendar

Edit `api/auctions.js` to add/remove upcoming auctions. The data structure is:
```js
{
  house: 'Savills',           // Display name
  houseSlug: 'savills',       // URL-safe identifier
  logo: '🏛️',                // Emoji for card display
  date: '2026-03-24',         // Auction date (YYYY-MM-DD)
  title: '24 March 2026',     // Display title
  lots: 280,                  // Expected lot count (null if unknown)
  url: 'https://...',         // Direct catalogue URL
  location: 'Online',         // Venue/location
  type: 'Residential',        // Category
  status: 'upcoming',         // upcoming | past
}
```

### Future: Automated Calendar
To auto-populate the calendar, add a Vercel Cron Job that scrapes each house's website weekly. This would go in `api/cron/update-calendar.js`.

## Development

```bash
# Install dependencies
npm install

# Run locally
ANTHROPIC_API_KEY=sk-ant-xxx npm run dev

# Opens at http://localhost:3000
```

## Scoring System

| Signal                     | Score |
|---------------------------|-------|
| Needs modernisation       | +2.0  |
| Poor/derelict condition   | +2.5  |
| Executor/probate          | +1.5  |
| Receivership/distressed   | +2.0  |
| Development potential     | +2.0  |
| Extension/HMO potential   | +1.5  |
| Vacant (residential)      | +1.0  |
| Freehold house            | +0.5  |
| Low £/sqft (<£200)        | +2.0  |
| Good yield (6-8% GIY)    | +1.5  |
| High yield (>8% GIY)     | +2.5  |
| Quick completion          | +0.5  |
| Motivated seller          | +0.5  |
| Title split potential     | +1.0  |
| Sitting tenant            | -2.0  |
| Knotweed                  | -2.0  |
| Flying freehold           | -1.0  |
| Non-standard construction | -1.0  |
| Flood risk                | -1.0  |
| Contamination             | -1.0  |

## Next Steps

- [ ] Automated calendar scraping via cron
- [ ] Email alerts when new catalogues drop
- [ ] Blog/content section for SEO
- [ ] Land Registry comps integration
- [ ] EPC rating lookups
- [ ] Bridging Brain integration for fundability scoring
