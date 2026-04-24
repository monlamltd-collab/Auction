# House Classification for Auction Watcher

Generated: 2026-04-24

## Summary

- **Cat A (static)**: 67 houses — no action needed
- **Cat B (per-auction dynamic)**: 13 houses — these need the watcher to discover URLs
- **Cat C (always-on rolling stock)**: 92 houses — no action needed
- **Total: 172 UK auction houses**

---

## Category B: Per-Auction Dynamic URLs (Priority for Watcher)

These 13 houses change their catalogue URLs per auction event. The auction-watcher module must discover and track the changing URLs.

| Slug | Display Name | URL Pattern | Notes |
|---|---|---|---|
| allsop | Allsop | separate paths per type | `/residential-auction-view-*` vs `/commercial-auction-view` |
| auctionhouselondon | Auction House London | `/catalogue/...` or `/auction/...` | Multiple URL variants per event |
| bondwolfe | Bond Wolfe | `/auction/N/` per event | Discrete auction IDs |
| buttersjohnbee | Butters John Bee | `?auction=N` | Query-string parameter |
| countrywide | Countrywide | `?auction_date=YYYY-MM-DD` | Date-based auction selection |
| dedmangray | Dedman Gray | `?q=1&tid=NNN` per event | Query params change per auction |
| hollismorgan | Hollis Morgan | `?bid=N` | Query-string bid/auction parameter |
| knightfrank | Knight Frank | `/auction/N/...` | Discrete auction URLs with IDs |
| loveitts | Loveitts | `/auction/` (varies) | Different URL per event |
| maggsandallen | Maggs & Allen | `?auction=N` | Query-string parameter (e.g., `?auction=1` → `?auction=48`) |
| network | Network Auctions | `/next-auction/` or `/future-auctions/` | Root shows only next; calendar may link to future |
| savills | Savills | `/auctions/SLUG-NNN` | Slug-based pages (e.g., `/31-march-2026-220`) |
| suttonkersh | Sutton Kersh | discrete events | Multiple distinct auctions |

---

## Category A: Static Root URLs (67 houses)

Root URL stable; always shows current/next upcoming auction. No discovery watcher needed.

acuitus, agentsproperty, aldreds, andrewcraig, astleys, auctionestates, auctionhouse, auctionhousebirmingham, auctionhouseeastanglia, auctionhousekent, auctionhousenortheast, auctionhousenorthwest, auctionhousescotland, auctionhousewales, austingray, barnardmarcus, barnettross, bradleyhall, brownco, charlesdarrow, cheffins, cheffinstimed, clarkegammon, clarkesimpson, cliveemson, connectuk, cottons, dawsons, durrants, edwardmellor, firstforauctions, foxgrant, fssproperty, futureauctions, gherbertbanks, goldings, hairandson, halls, harmanhealy, hawkesford, henrysykes, hobbsparker, howkinsandharrison, humberts, hunters, iamsold, johnpye, kivells, landwood, luscombemaye, mchughandco, mellerbraggins, paulfosh, philliparnold, phillipssmithanddunn, probateauction, regionalauctioneers, robinjessop, robinsonhall, seelauctions, stags, strettons, taylerandfletcher, tcpa, walkersingleton, webbers, woolleyandwallis

---

## Category C: Always-On Rolling Stock (92 houses)

No discrete auction events; continuous inventory. Root URL always correct. Includes EIG platform, online-only, timed auction streams, and Auction House UK national + 25 regional branches.

**Auction House UK National + 25 Regions:**
auctionhousebedsandbucks, auctionhousechesterfield, auctionhousecoventry, auctionhousecumbria, auctionhousedevon, auctionhouseeastmidlands, auctionhouseessex, auctionhousehull, auctionhouseleicestershire, auctionhouselincolnshire, auctionhousemanchester, auctionhousemidlands, auctionhousenational, auctionhousenorthamptonshire, auctionhousenorthernireland, auctionhousenorthwales, auctionhousenottsandderby, auctionhouseoxfordshire, auctionhousesouthwest, auctionhousesouthyorkshire, auctionhousestaffordshire, auctionhouseteesvalley, auctionhouseuklondon, auctionhousewestmidlands, auctionhousewestyorkshire

**EIG Platform Houses:**
ahlondon, auctionnorth, auctiontrade, benjaminstevens, bowensonandwatson, brggibson, brggibsondublin, cooperandtanner, groundrentauctions, hammerprice, higginsdrysdale, jonespeckover, lot9, martinpole, nationalpropertyauctions, propertyauctionagent, romanway, sageandco, sarahmains, starpropertyonline, thepropertyauctionhouse

**Online-Only & Timed:**
bidx1, pattinson, sdl, 247propertyauctions, allwalesauction, lsk, rendells

**Mixed/Independent:**
auctionhammermidlands, bagshaws, bradleysdevon, bramleys, brutonknowles, carterjonas, cityandruralpropertyauctions, cleetompkinson, cotswoldpropertyauctions, driversnorris, foxandsons, gth, hmox, jjmorris, johnfrancis, lsh, markjenkinson, mccartneys, morrismarshall, nesbits, pearsonferrier, pearsons, propertysolvers, pugh, purplebricksgoto, rogerparry, scargillmann, sharpesauctions, sheldonbosley, shonkibros, smithandsons, strakers, symondsandsampson, underthehammer, venmore, williamhbrownleeds, williamhbrownnorwich, wilsons, wrightmarshall

---

## Methodology

Classification uses priority logic:

1. **Always-on sentinel**: Mark `status: 'always_on'` in FALLBACK_CALENDAR → Cat C
2. **Special cases**: Known from CLAUDE.md or houses.js comments → Cat B or C
3. **URL parameters**: `?auction=`, `?bid=`, `?auction_date=` in root → Cat B
4. **Calendar variance**: Multiple different URLs in FALLBACK_CALENDAR → Cat B
5. **Calendar vs root mismatch**: Calendar URL differs and indicates per-event → Cat B
6. **Default**: All others → Cat A

---

## Integration Notes

- **Cat B priority**: Implement discovery for each house's URL pattern (query-string, path ID, date-stamped, etc.)
- **Cat A & C**: Simple root URL polling sufficient; no active discovery needed

Last updated: 2026-04-24
