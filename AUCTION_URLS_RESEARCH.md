# Auction House Catalogue URL Research

**Date:** 2026-03-15
**Method:** Web research via fetching each house's website and identifying the lots/catalogue page
**Purpose:** Identify catalogue URLs for houses not yet in our system, plus verify existing ones

---

## Summary

- **40 houses researched**
- **8 ready to add** (active catalogues, directly scrapeable)
- **5 possible** (may need Puppeteer or have intermittent catalogues)
- **16 already in system** (verified)
- **6 defunct/absorbed**
- **5 not viable** (no persistent catalogue, blocked, or inactive)

---

## Ready to Add (Active catalogues, scrapeable)

| # | House | Catalogue URL | Lots | Confidence | Notes |
|---|-------|--------------|------|------------|-------|
| 1 | **Cheffins** | `https://www.cheffins.co.uk/property-auctions.htm` | ~10 | HIGH | Own platform. Catalogue URL is date-specific (e.g. `/catalogue-view,march-2026_576.htm`). Also has timed auctions at `timedpropertyauctions.cheffins.co.uk/search`. East Anglia. |
| 2 | **Butters John Bee** | `https://www.buttersjohnbee.com/listings?auction=1&status=all` | ~32 | HIGH | Own website with auction filter. Gallery/list/map views. Also publishes PDF catalogues. Uses EI Group for legal packs. |
| 3 | **Feather Smailes & Scales** | `https://www.fssproperty.co.uk/search-auction/` | ~5 | HIGH | Domain is `fssproperty.co.uk` (NOT feathersmailes.co.uk). Own platform. ~5 auctions/year. Harrogate, North Yorkshire. |
| 4 | **Brown & Co** | `https://www.brown-co.com/auctions/property-land` | ~11 | HIGH | Active listings. Runs online timed + livestream auctions. Modern JS-based CMS. Norfolk/Suffolk/East Anglia. |
| 5 | **Agents Property Auction** | `https://www.agentspropertyauction.com/next-auction/` | ~87 | HIGH | Domain is `.com` NOT `.co.uk`. WordPress site. North East England & Cumbria. Partner agent network. |
| 6 | **Andrew Craig** | `https://www.andrewcraig.co.uk/auction-property-for-sale` | ~35 | HIGH | Estate Apps platform. North East (South Shields, Hebburn, Jarrow, Sunderland). |
| 7 | **iamsold** | `https://www.iamsold.co.uk/available-properties/` | 100s | HIGH | National online auction platform. Property cards with starting bids, status, photos. Also powers other agents (Drivers & Norris, BOP, Clarke Gammon). |
| 8 | **EIG Property Auctions** | `https://www.eigpropertyauctions.co.uk/search` | 1000s | HIGH | Aggregator: "virtually every property auction in the UK" (600k+ historic lots). Filters for location, type, price, live streaming. |

---

## Possible to Add (May need work)

| # | House | Catalogue URL | Confidence | Notes |
|---|-------|--------------|------------|-------|
| 1 | **Symonds & Sampson** | `https://www.symondsandsampson.co.uk/auctions/search` | MEDIUM | Blocks automated fetches (403). Also has `auctions.symondsandsampson.co.uk`. Monthly auctions, 198 properties/year. Dorset/Devon/Somerset. May need Puppeteer. |
| 2 | **Greenslade Taylor Hunt** | `https://www.gth.net/properties/sales/tag-auction` | MEDIUM | Blocks automated fetches (403). Also has `/auctions/property-and-land-auction-sales-calendar`. Somerset/Devon. May need Puppeteer. |
| 3 | **Howkins & Harrison** | `https://www.howkinsandharrison.co.uk/online-auctions/` | MEDIUM | Property auctions via online portal. Also has `howkinsandharrison.auctionmarts.com`. Primarily machinery/farm dispersal. |
| 4 | **All Wales Auction** | `https://allwalesauction.com/latest-lots.php` | MEDIUM | PHP site. Lots hosted externally on TPP UK platform (`tppuk.com/live-auction`). |
| 5 | **Hobbs Parker** | `https://www.hobbsparker.co.uk/estate-agents/property-for-sale/?statusDescGroup=Auction` | MEDIUM | WordPress with Property Hive plugin. 0 results at time of check — may list lots closer to auction dates. Kent/Sussex. |

---

## Already In System (16 houses verified)

| House | Slug | Status | Notes |
|---|---|---|---|
| Countrywide / Sutton Kersh | `countrywide` | Correct | Also covers Property Auction South West |
| Knight Frank Auctions | `knightfrank` | Correct | `knightfrank.co.uk` is info-only, actual catalogue at `knightfrankauctions.com` |
| Clarke & Simpson | `clarkesimpson` | Correct | EIG platform |
| Austin Gray | `austingray` | Correct | Auction House UK network (Sussex & Hampshire) |
| Durrants | `durrants` | Correct | EIG platform |
| Future Property Auctions | `futureauctions` | Correct | Domain is `futurepropertyauctions.co.uk` (not `futureproperty.co.uk`) |
| Goldings | `goldings` | Correct | Domain is `goldingsauctions.co.uk` (not `goldings.co.uk`) |
| Harman Healy | `harmanhealy` | Correct | EIG platform |
| Dawsons | `dawsons` | Correct | EIG platform |
| Town & Country | `tcpa` | Correct | `tcpa.co.uk` redirects to `townandcountrypropertyauctions.co.uk` |
| Henry Sykes | `henrysykes` | Correct | Domain is `henrysykes.co.uk` (not `henrysykes.com`) |
| Astleys | `astleys` | Correct | Domain is `astleys.net` (not `astleys.co.uk`) |
| Pattinson | `pattinson` | Correct | Returns 403 to bots, needs Puppeteer |
| BTG Eddisons | `sdl` | Correct | ~378 lots. Graham Penny was absorbed into this. |
| Barnett Ross | `barnettross` | Check | System has `/lotlist.php`, may also need `/current-online-auctions.php` |
| Auction House Scotland | `auctionhousescotland` | Correct | Auction House UK network |

---

## Defunct / Absorbed / Not Viable

| House | Status | Details |
|---|---|---|
| **Graham Penny** | Absorbed into **BTG Eddisons** | `grahampenny.com` is parked. Acquired by SDL Group in 2016, now BTG Eddisons. |
| **Andrews & Robertson** | Absorbed into **BidX1** | Domain defunct. Acquired by BidX1 in 2018. |
| **Drivers & Norris** | Uses **iamsold** platform | `driversnorris.co.uk` is down. Actual site is `drivers.co.uk`. |
| **Bond Oxborough Phillips** | Uses **iamsold** platform | `bopauctions.co.uk` is down. Actual site is `bopproperty.com`. |
| **Bamboo Auctions** | Pivoted to **B2B proptech** | `bambooauctions.com` redirects to `bambooproptech.com`. No consumer catalogue. |
| **Carter Jonas** | No visible catalogue | Service info page only. May require login. Low volume. |
| **Fisher German** | Blocks all access (403) | Runs exclusively online auctions. Strong in commercial/land/rural. |
| **Hackney & Leigh** | Ad-hoc only | No regular auctions. Informational page only. Lake District. |
| **Clarke Gammon** | Uses iamsold, 0 lots | `clarkegammon.co.uk` (not `clarkeandgammon.co.uk`). May list sporadically. |
| **Arnolds Keys** | Inactive | "No date for next auction." Norfolk. |
| **Andrew Grant** | Domain parked | `andrewgrant.co.uk` is for sale. `andrewgrant.com` has 0 lots. |

---

## Platform Networks

| Platform | Houses Using It |
|---|---|
| **EIG** | Brown & Co, Clarke & Simpson, Durrants, Dawsons, Feather Smailes & Scales, Goldings, Henry Sykes, Astleys, Howkins & Harrison, Town & Country, Greenslade Taylor Hunt, Symonds & Sampson, Harman Healy, Knight Frank, Paul Fosh, Seel Auctions, First for Auctions, Robinson & Hall |
| **iamsold** | Clarke Gammon, Drivers & Norris, Bond Oxborough Phillips, iamsold (aggregator) |
| **Auction House UK** | Austin Gray (Sussex & Hampshire), Auction House Scotland, Auction House London |
| **TPP UK** | All Wales Auction |

---

## Domain Corrections

| Provided Domain | Actual Working Domain |
|---|---|
| driversnorris.co.uk | drivers.co.uk (iamsold) |
| feathersmailes.co.uk | fssproperty.co.uk |
| goldings.co.uk | goldingsauctions.co.uk |
| futureproperty.co.uk | futurepropertyauctions.co.uk |
| harmanhealy.co.uk | harman-healy.co.uk |
| astleys.co.uk | astleys.net |
| henrysykes.com | henrysykes.co.uk |
| andrewgrant.co.uk | andrewgrant.com |
| bopauctions.co.uk | bopproperty.com |
| agentspropertyauction.co.uk | agentspropertyauction.com |
| clarkeandgammon.co.uk | clarkegammon.co.uk |
