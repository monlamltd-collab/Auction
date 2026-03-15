# Features Research

*Research date: 2026-03-15 | Focus: UK property auction directory & investor tooling*

---

## Table Stakes (users expect these)

### 1. Complete, Current Listings with Outcome Data
Every serious auction aggregator shows upcoming lots AND past results with sold/unsold status and hammer prices. EIG (Essential Information Group) has tracked every UK auction result since 1991 (600,000+ lots). SDL, Auction House UK, Savills, and most houses publish results within days. **Bridgematch currently lacks sold/unsold tracking** -- this is table stakes for any auction directory investors will trust.

- Upcoming lots with guide price, address, property type, tenure, images
- Past auction results: sold price, unsold status, withdrawn status
- Unsold lot sections (SDL, Auction House, Clive Emson all have dedicated unsold lot pages -- these are high-value for investors seeking post-auction negotiation)
- Auction calendar with dates, venues, lot counts

### 2. Basic Property Data Per Lot
Investors expect at minimum:
- **Guide price** and price range
- **Property type** (house, flat, commercial, land, mixed-use)
- **Tenure** (freehold / leasehold / share of freehold)
- **Address** with postcode
- **Images** (multiple per lot -- single image or no image looks amateur)
- **Legal pack availability** (link or note)
- **EPC rating** -- increasingly important given 2025/26 MEES regulations; rental properties must meet minimum EPC standards. Most auction houses include this in listings
- **Council tax band** -- commonly shown on portals, easy to look up via VOA

### 3. Basic Filtering & Search
- Filter by location, price range, property type, auction house, auction date
- Keyword search
- PropertyAuctions.io offers this free with no subscription. EIG offers it behind a paywall. This is baseline.

### 4. Alerts / Notifications
- PropertyAuctions.io: free email alerts for new lots matching criteria
- EIG: "Auction Alerts" for properties matching saved criteria
- This is expected by active investors. Bridgematch doesn't have this yet (out of scope per PROJECT.md, but it's table stakes for engagement).

### 5. SDLT Calculator
- Widely available as a free tool (HomePortfolio, PropertyEngine, DealSheet AI all include it)
- Bridgematch already has this. Table stakes -- keep it free.

### 6. Mobile Access
- DealSheet AI is mobile-first (iOS app)
- Lendlord has iOS and Android apps
- PropMarker has a Chrome extension
- At minimum, the web app must be fully responsive. Bridgematch already is.

---

## Differentiators (competitive advantage)

### 1. AI-Powered Catalogue Screening (EXISTING -- PROTECT THIS)
Bridgematch's core moat: AI extraction + investment scoring of entire auction catalogues. No direct competitor does this at the same depth across 21+ houses:
- **EIG**: Aggregates lots but no AI analysis or scoring
- **PropertyAuctions.io**: Free directory, no analysis
- **Auction Radar**: Data in spreadsheets (£49/mo), no analysis -- just raw data delivery via email/Excel
- **DealSheet AI**: Analyses individual properties (paste URL or screenshot), but doesn't bulk-screen catalogues
- **PropMarker**: AI analysis of individual listings on Rightmove/Zoopla, but not auction catalogues

**Gap Bridgematch fills**: No one else bulk-screens an entire auction catalogue and surfaces the best investment deals with scored rankings. This is the key differentiator.

### 2. Deal Stacking Calculator with Live Lender Data (PLANNED -- HIGH VALUE)
This is the killer feature no competitor combines with auction data:

**What competitors offer (finance calculators):**
- **Brickflow**: Best-in-class bridging comparison. 80+ lenders, shows gross/net loan, LTV, monthly interest, arrangement fees, exit fees, True Monthly Cost (TMC). Inputs: property type, purchase price, location, condition, refurb costs, loan term, exit strategy. But Brickflow has NO auction integration -- user must manually enter deal details.
- **Broka**: Broker-focused ecosystem with real-time lender criteria matching (LTV, LTGDV, LTPP, LTC). No auction integration.
- **Commercial Trust / MFS / ABC Finance**: Simple auction finance calculators -- enter loan amount, term, rate, get monthly payments. No deal stacking.

**What competitors offer (investment calculators):**
- **DealSheet AI** (£4.99/week or £79.99/year): ROI, gross yield, SDLT, Section 24 tax. Supports 7 strategies including "Auction". No finance cost integration.
- **PropertyEngine** (free basic, paid advanced): BRR, BTL, SDLT, mortgage repayment calculators. No bridging finance integration.
- **HomePortfolio** (free): Rental yield, BRRRR, flip, SDLT calculators. No finance integration.
- **Lendlord** (free basic, £12-36/mo premium): Deal analyser with rental yields, ROI, cashflow. Has in-house financing but not bridging-specific.
- **PropMarker** (£99.99/mo): AI deal scoring with ROI, yield, but no bridging finance cost integration.
- **Landlords Portal HMO calculator**: Purchase price, refurb, rental income, expenses -> yields and cashflow. No finance integration.

**The gap**: Nobody combines auction lot data + bridging finance costs (from real lender criteria) + investment returns in a single "does this deal stack?" output. Bridgematch's deal stacking calculator, pulling from the Bridgematch lender database (~50+ lenders), would be unique.

**Recommended inputs:**
- Auto-populated from lot data: purchase price, property type, location, condition
- User inputs: GDV (after works value), refurbishment costs, legal fees, expected monthly rental
- Auto-calculated: SDLT (investor rates), bridging finance costs (from Bridgematch lender data -- best rate, arrangement fee, exit fee for the specific deal), total acquisition cost

**Recommended outputs:**
- Total cost in (purchase + SDLT + legal + refurb + finance costs)
- Equity required (deposit + costs not covered by lender)
- Gross and net yield on purchase price
- ROI on cash invested
- Cash-on-cash return (annual cashflow / cash invested)
- Profit on flip (GDV - total cost in)
- Number of lenders who would fund this deal
- Best indicative rate and LTV

### 3. Enrichment Data Layered onto Auction Lots (PLANNED)
Most auction aggregators show only what the auction house publishes. Bridgematch can differentiate by enriching each lot with:

**Available via free/cheap APIs:**
- **EPC data**: MHCLG open data, free API. Shows energy rating, potential rating, floor area, heating type. Critical for rental strategy (MEES compliance)
- **Flood risk**: Environment Agency open data, free API. River, sea, surface water risk categories
- **Council tax band**: VOA lookup, free
- **Land Registry sold prices**: Already partially integrated. Street-level comps and price history
- **Planning applications**: Free via local authority APIs or Searchland

**Available via Firecrawl enrichment (credit cost):**
- **Zoopla/Rightmove rental estimates**: What similar properties rent for in the area
- **Recent sold prices**: Supplement Land Registry with portal data
- **Market context**: Average asking prices, time on market

**What investors say they want per lot** (synthesised from competitor feature sets):
1. Purchase price and guide price range
2. Comparable sold prices (within 0.5mi, last 2 years)
3. Estimated rental income (per month)
4. Gross yield calculation
5. EPC rating and floor area
6. Flood risk category
7. Council tax band
8. Planning history (any applications nearby)
9. Condition assessment / refurb estimate
10. Local area demographics and amenities

### 4. Unsold Lot Tracking & Post-Auction Opportunities
~25-29% of auction lots go unsold. These become negotiation opportunities. SDL, Auction House UK, and Clive Emson all maintain dedicated unsold lot pages. EIG tracks all unsold lots historically.

**Differentiator opportunity**: Bridgematch could flag unsold lots with "post-auction opportunity" tagging, show the failed guide price, and let investors see which lots didn't sell -- enabling below-guide-price approaches to auction houses. No aggregator currently combines unsold lot tracking with investment scoring.

### 5. Natural Language / AI Search (EXISTING)
Smart search with AI natural language queries across all lots. PropMarker has LENAH (AI assistant), DealSheet AI has AI summaries, but none apply NLP search across a multi-house auction catalogue. Keep and improve this.

---

## Anti-Features (things to deliberately NOT build)

### 1. Do NOT build a general property portal
Bridgematch is an auction tool, not a Rightmove competitor. Don't add non-auction listings, estate agent properties, or try to become a general property search engine. The value is in auction-specific data and the investor workflow.

### 2. Do NOT build an estate agent CRM / listing tool
Under the Hammer and iamsold serve the agent/seller side. Bridgematch serves the investor/buyer side. Don't build seller tools, agent dashboards, or listing management.

### 3. Do NOT build a full portfolio management system
Lendlord (£0-36/mo) already does portfolio management, tenant management, expense tracking, bank linking, tax reports. This is a different product category. Bridgematch's value ends at "find and fund the deal" -- not "manage the property."

### 4. Do NOT gate the directory data behind a paywall
EIG charges for access to basic auction listings -- this is widely criticised. PropertyAuctions.io is free and growing. Auction Radar charges £49/mo for spreadsheet data. Bridgematch's strategy of free directory data is correct -- it builds traffic and trust. Gate only AI analysis and deal stacking features (per project_tier_strategy.md).

### 5. Do NOT build a bidding platform
BidX1 and auction houses handle actual bidding. Don't try to intermediate the transaction. Bridgematch is research and analysis, not a marketplace.

### 6. Do NOT build a mortgage/BTL finance comparison tool
Brickflow owns the bridging comparison space (80+ lenders, £21bn in searches). Don't try to replicate their lender comparison breadth. Instead, use Bridgematch's proprietary lender database for "will this deal get funded?" signals, with masked lender names driving broker leads.

### 7. Do NOT show raw data dumps or spreadsheet exports as a core feature
Auction Radar's model (£49/mo for Excel spreadsheets) is a race to the bottom. Bridgematch should present insights, not data. The AI scoring and deal stacking are the value -- not CSV downloads.

---

## Competitor Analysis

### Direct Competitors (Auction Aggregators)

| Competitor | Model | Lots | AI? | Finance? | Price | Strengths | Weaknesses |
|---|---|---|---|---|---|---|---|
| **EIG** | Subscription | 850K+ historical, 38K/year | No | No | Undisclosed (paywall) | Definitive UK auction database since 1991; comps; auction alerts; 400+ houses | Paywalled; no analysis; dated UX; no investment scoring |
| **PropertyAuctions.io** | Free | Unknown (aggregator) | "AI-powered insights" (limited) | No | Free | Free; clean UX; alerts; daily updates | No investment analysis; no scoring; no enrichment data |
| **Auction Radar** | Subscription | 3,500+/month | No | No | £49/mo | Raw data in Excel; 10+ houses; sold price tracking | No analysis; spreadsheet-only; no web UI; limited house coverage |
| **Under the Hammer** | Agent network | Varies | No | No | Free to search | Transparent pricing; two sale methods | Seller-focused; not investor-oriented |

### Adjacent Competitors (AI Property Analysis)

| Competitor | Focus | AI Features | Auction? | Price | Strengths | Weaknesses |
|---|---|---|---|---|---|---|
| **DealSheet AI** | Deal analysis | URL/screenshot parsing; 7 strategies; risk assessment; SDLT | "Auction" strategy | £4.99/wk or £79.99/yr | Fast (12s); mobile-first; UK tax; PDF export | Single-property only; no catalogue screening; no finance integration |
| **PropMarker** | Deal sourcing | LENAH AI; floorplan reading; deal scoring; price prediction | No | £99.99/mo | Deep data (millions of points); Rightmove/Zoopla integration; Chrome extension | Expensive; no auction-specific features; no finance integration |
| **Lendlord** | Portfolio mgmt | AI assistant (5-unlimited msgs); deal analyser | No | Free / £12 / £36/mo | Free Chrome extension on Zoopla/Rightmove; portfolio tracking; bank linking | Not auction-focused; basic AI; no catalogue analysis |

### Adjacent Competitors (Finance Comparison)

| Competitor | Focus | Lenders | Auction? | Price | Strengths | Weaknesses |
|---|---|---|---|---|---|---|
| **Brickflow** | Bridging/dev finance comparison | 80+ (200K+ data points) | No | Free to search (broker monetisation) | Best-in-class lender comparison; TMC calculation; DIP application | No auction integration; user must manually enter deal; no investment analysis |
| **Broka** | Broker ecosystem | Unknown | No | Unknown | Real-time lender matching; workflow tools; broker/lender/introducer connectivity | Broker-focused; no investor tools; no auction data |

### Data Enrichment Providers (potential integrations)

| Provider | Data | Price | API? | Notes |
|---|---|---|---|---|
| **PropertyData** | Comps, yields, EPC, council tax, planning, demographics | £14-60/mo | Yes | Credit-based; comprehensive UK property analytics |
| **PropEco** | EPC, flood risk, air quality, climate | Paid API | Yes | Per-property lookup; UK property-level risk data |
| **Land Registry** | Sold prices, title, ownership | Free (bulk) / per-query | Yes | Already integrated in Bridgematch |
| **MHCLG (EPC register)** | Energy Performance Certificates | Free | Yes | Open data; should integrate |
| **Environment Agency** | Flood risk (river, sea, surface water) | Free | Yes | Open Government Licence; should integrate |
| **VOA** | Council tax bands | Free | Lookup | Already partially integrated |
| **Searchland** | Planning, ownership, EPC, HMO | Paid API | Yes | Aggregator of multiple data sources |

---

## Key Findings Summary

### What's missing in the market (Bridgematch's opportunity)
1. **No one bulk-screens auction catalogues with AI** -- individual property analysis exists (DealSheet AI, PropMarker) but catalogue-level screening is unique to Bridgematch
2. **No one combines auction data with bridging finance feasibility** -- Brickflow has the lenders but no auction data; auction sites have lots but no finance data. Bridgematch can bridge this gap (literally)
3. **Enrichment data on auction lots is rare** -- most aggregators show only what the auction house publishes. Adding EPC, flood risk, comps, and rental estimates to each lot is a clear differentiator
4. **Post-auction unsold lot analysis doesn't exist** -- unsold lots are listed on individual house websites but no aggregator scores them for investment potential or flags the negotiation opportunity
5. **Deal stacking calculators don't pull live lender criteria** -- existing calculators use generic rates or manual input; none auto-populate finance costs from a real lender database

### Pricing benchmarks for subscription tiers
- Free: Directory + basic filters (PropertyAuctions.io model)
- £5-10/mo: AI analysis + basic enrichment (DealSheet AI is £4.99/wk)
- £10-15/mo: Full deal stacking + enrichment (current Bridgematch is £9.99/mo)
- £50-100/mo: Professional/portfolio tools (Auction Radar £49/mo, PropMarker £99.99/mo)

Bridgematch's current £9.99/mo premium tier is well-positioned -- cheaper than PropMarker and Auction Radar, more feature-rich than DealSheet AI for auction investors. The free tier (directory data, limited AI searches) follows the PropertyAuctions.io model of driving traffic through free access.

---

*Sources: EIG (eigpropertyauctions.co.uk), PropertyAuctions.io, Auction Radar (auctionradar.co.uk), DealSheet AI (dealsheetai.com), PropMarker (propmarker.co.uk), Brickflow (brickflow.com), Broka (broka.uk), PropertyData (propertydata.co.uk), Lendlord (lendlord.io), PropertyEngine (propertyengine.co.uk), HomePortfolio (homeportfolio.com), Under the Hammer (underthehammer.com), SDL Auctions (sdlauctions.co.uk), Landlords Portal (landlordsportal.co.uk), Environment Agency flood API, MHCLG EPC register, PropEco (propeco.io), Searchland (searchland.co.uk)*
