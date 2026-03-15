# Auction House Catalogue URL Research

**Date:** 2026-03-15
**Method:** Web research via fetching each house's website and identifying the lots/catalogue page
**Purpose:** Identify catalogue URLs for houses not yet in our system, plus verify existing ones

---

## Summary

- **40 houses researched**
- **~25 genuinely new houses** (not already in system or absorbed into existing ones)
- **6 defunct/absorbed:** Andrews & Robertson (now BidX1), Graham Penny (now BTG Eddisons), Andrew Grant (parked domain), Drivers Norris (now iamsold), Bamboo Auctions (B2B platform only), Hackney & Leigh (ad-hoc only)
- **Key platforms:** EIG dominates (~12 houses), iamsold (~4 houses), Bamboo/Proptech (B2B only)

---

## New Houses (not yet in system)

| # | House | Catalogue URL | Volume | Confidence | Notes |
|---|-------|--------------|--------|------------|-------|
| 1 | Cheffins | https://www.cheffins.co.uk/property-auctions/catalogue-view,march-2026_576.htm | Small | HIGH | URL changes per auction (month/year suffix). Also has timed auctions at timedpropertyauctions.cheffins.co.uk/search. East Anglia focus. |
| 2 | Countrywide Property Auctions | https://www.countrywidepropertyauctions.co.uk/search.php | Large | HIGH | Operates via sub-brands: Sutton Kersh (Liverpool, ~108 lots) and Property Auction South West (Exeter, ~24 lots). Already in system as `countrywide` slug. |
| 3 | Butters John Bee | https://buttersjohnbee.com/listings?viewType=gallery&sortby=dateListed-desc&saleOrRental=Sale&auction=1&status=available_under_contract | Small | HIGH | EIG platform. ~16 lots. |
| 4 | Carter Jonas | https://www.carterjonas.co.uk/property-auctions | Small | MEDIUM | Requires account to bid/view legal docs. Low volume. |
| 5 | Fisher German | https://www.fishergerman.co.uk/current-auctions | Medium | MEDIUM | Returns 403 to bots. Strong in commercial, land & rural. Online auctions with 4-week listings. |
| 6 | Howkins & Harrison | https://howkinsandharrison.co.uk/auctions/ | Small | LOW | Primarily farm/machinery dispersals. Property auctions via EIG. Very low property volume. |
| 7 | Feather Smailes & Scales | https://www.fssproperty.co.uk/auction/online-auctions.html | Small | HIGH | Note: domain is fssproperty.co.uk (not feathersmailes.co.uk). ~28 lots/year. Harrogate, North Yorkshire. |
| 8 | Arnolds Keys | https://www.arnoldskeys.com/auctions-2/ | Small | LOW | Currently inactive — "no date for next auction". Norfolk-based. |
| 9 | Brown & Co | https://www.brown-co.com/auctions/property-land/online-auctions | Small-Medium | HIGH | Timed auctions with rolling catalogue. ~16 lots. Norfolk/Suffolk/East Anglia. |
| 10 | Hobbs Parker | https://www.hobbsparker.co.uk/estate-agents/property-for-sale/?statusDescGroup=Auction | Small | MEDIUM | Kent/Sussex. 0 lots at time of check — may be between auctions. Historical PDF catalogues. |
| 11 | Clarke & Simpson | https://clarke-simpson.eigonlineauctions.com/search | Small | HIGH | EIG platform. ~3 active lots. Suffolk-based. |
| 12 | Austin Gray | https://www.auctionhouse.co.uk/sussexandhampshire | Medium | HIGH | Operates as Auction House Sussex & Hampshire (part of Auction House UK network). Lots on auctionhouse.co.uk, not austingray.co.uk. |
| 13 | Durrants | https://durrants.com/property-auctions/ | Small | HIGH | EIG platform. Norfolk/Suffolk. ~9 lots/year. Monthly online sales. |
| 14 | Goldings | https://www.goldingsauctions.co.uk/auctions/ | Small-Medium | HIGH | Note: domain is goldingsauctions.co.uk (not goldings.co.uk). Ipswich-based. ~15 lots per auction. |
| 15 | Clarke Gammon | https://www.clarkegammon.co.uk/property-auctions/ | Small | LOW | No online catalogue visible. Lots may require contacting office. |
| 16 | All Wales Auction | https://www.tppuk.com/live-auction | MEDIUM | Medium | Lots hosted on TPPUK (The Property Portal UK) platform. Own site at allwalesauction.com has /catalogue.php but redirects to TPPUK. |
| 17 | Dawsons | https://www.dawsonsproperty.co.uk/auctions-grid.php | Small | HIGH | EIG platform. ~8 lots. South Wales. |
| 18 | Agents Property Auction | https://www.agentspropertyauction.com/property-search/ | Large | HIGH | Note: .co.uk domain is dead, actual site is .com. ~146 lots. North East & Cumbria. Partner agent network. |
| 19 | Andrew Craig | https://www.andrewcraig.co.uk/auction-property-for-sale | Medium | HIGH | Custom platform. ~35 lots. |
| 20 | Henry Sykes Auctions | https://onlineauctions.henrysykes.co.uk/search | Small | HIGH | Note: henrysykes.com is wrong site (designer portfolio). Actual domain is henrysykes.co.uk. EIG platform. ~39 lots. Franchise model. |
| 21 | Astleys | https://astleys.eigonlineauctions.com/search | Small | HIGH | Note: astleys.co.uk is an industrial supplies company. Actual site is astleys.net. EIG platform. ~28 lots. Swansea. |
| 22 | Symonds & Sampson | https://www.symondsandsampson.co.uk/auctions/search | Medium | MEDIUM | Returns 403 to bots. Also has auction subdomain: auctions.symondsandsampson.co.uk. EIG live stream. South West. |
| 23 | Bond Oxborough Phillips | https://bopproperty.iamsold.co.uk/ | Small | HIGH | bopauctions.co.uk is dead. Uses iamsold platform. Main site is bopproperty.com. North Devon/Cornwall. |
| 24 | Greenslade Taylor Hunt | https://www.gth.net/properties/sales/tag-auction | Medium | MEDIUM | Returns 403 to bots. EIG platform for live-stream auctions. Also has agricultural auctions at gth.auctionmarts.com. South West. |
| 25 | Auction House Scotland | https://www.auctionhouse.co.uk/scotland | Medium | HIGH | Part of Auction House UK network. EIG platform. ~67 lots. Covers all Scotland. |

---

## Already In System (verification)

| House | Current System URL | Verified URL | Status | Notes |
|-------|-------------------|-------------|--------|-------|
| Knight Frank Auctions | knightfrankauctions.com | https://www.knightfrankauctions.com/ | Correct | knightfrank.co.uk/residential/services/property-auctions is info-only, links to knightfrankauctions.com. EIG platform. |
| Pattinson | pattinson.co.uk/auction/property-search | https://www.pattinson.co.uk/auction/property-search | Correct | Returns 403 to bots. 1500+ lots. Proprietary platform. White-label subdomains for partners. |
| BTG Eddisons | btgeddisonspropertyauctions.com/properties/ | https://www.btgeddisonspropertyauctions.com/properties | Correct | ~378 lots. EIG-related. |
| Barnett Ross | barnettross.co.uk/current.php | https://www.barnettross.co.uk/current-online-auctions.php | Check | System has /current.php, actual page may be /current-online-auctions.php. Also has /lotlist.php. |
| Town & Country | townandcountrypropertyauctions.co.uk/search | https://www.townandcountrypropertyauctions.co.uk/search | Correct | tcpa.co.uk redirects here. EIG platform. |
| Harman Healy | harman-healy.co.uk/search | https://harman-healy.co.uk/current-auction | Check | System has /search, but /current-auction may be more specific. EIG platform. ~4 lots currently. |
| Countrywide / Sutton Kersh | countrywidepropertyauctions.co.uk/search.php | https://www.countrywidepropertyauctions.co.uk/search.php | Correct | Already in system. |
| Future Property Auctions | futurepropertyauctions.co.uk/catalogue_viewall.asp | https://www.futurepropertyauctions.co.uk/catalogue_viewall.asp | Correct | Note: futureproperty.co.uk has SSL issues. Correct domain is futurepropertyauctions.co.uk. Scotland's largest. 300+ lots. |

---

## Defunct / Absorbed / Not Viable

| House | Status | Details |
|-------|--------|---------|
| Andrews & Robertson | Absorbed into BidX1 | Domain defunct. Acquired by BidX1 in 2018. All lots now on bidx1.com. |
| Graham Penny | Absorbed into BTG Eddisons | Domain parked on GoDaddy. Acquired by SDL Group in 2016, now BTG Eddisons. |
| Andrew Grant | Domain parked | andrewgrant.co.uk is for sale on GoDaddy. andrewgrant.com uses iamsold but 0 lots currently. |
| Drivers & Norris | Now on iamsold | driversnorris.co.uk is down. Actual site is drivers.co.uk. Auctions via iamsold platform. |
| Bamboo Auctions | B2B platform only | Rebranded to Bamboo Proptech (bambooproptech.com). B2B SaaS for estate agents, not a direct auction house. |
| Hackney & Leigh | Ad-hoc only | No regular auctions or active catalogue. Lake District/Cumbria. Auctions are occasional. |

---

## Platform Networks

| Platform | Houses Using It |
|----------|----------------|
| **EIG** | Butters John Bee, Clarke & Simpson, Durrants, Dawsons, Henry Sykes, Astleys, Howkins & Harrison, Town & Country, Auction House Scotland, Greenslade Taylor Hunt, Symonds & Sampson, Harman Healy, Knight Frank |
| **iamsold** | Drivers & Norris, Andrew Grant, Bond Oxborough Phillips, iamsold (aggregator at iamsold.co.uk/available-properties/) |
| **Auction House UK** | Austin Gray (Sussex & Hampshire), Auction House Scotland |
| **TPPUK** | All Wales Auction |

---

## Domain Corrections

Several provided domains were wrong or inactive:

| Provided Domain | Actual Working Domain |
|----------------|----------------------|
| driversnorris.co.uk | drivers.co.uk (iamsold) |
| feathersmailes.co.uk | fssproperty.co.uk |
| goldings.co.uk | goldingsauctions.co.uk |
| futureproperty.co.uk | futurepropertyauctions.co.uk |
| harmanhealy.co.uk | harman-healy.co.uk |
| astleys.co.uk | astleys.net |
| henrysykes.com | henrysykes.co.uk |
| andrewgrant.co.uk | andrewgrant.com |
| bopauctions.co.uk | bopproperty.com / bopproperty.iamsold.co.uk |
| agentspropertyauction.co.uk | agentspropertyauction.com |
