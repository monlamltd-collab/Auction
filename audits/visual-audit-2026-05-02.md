# Visual Audit — 2026-05-02

Scanned **11,773** rows in **9738ms** across **70** houses with findings.

**Findings:** 485 error · 19 warn · 49 info

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (34 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":34,"examples":[{"address":"land at langney rise, eastbourne, east sussex, bn23 7nl","count":3},{"address":"plot 2, land at woodlands way, southwater, horsham, west sussex, rh13 9hz","count":3},{"address":"land at willow wood road, meopham, gravesend, kent, da13 0qt","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 129/181 (71%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":129,"total":181,"ratio":0.713}`

## allwalesauction

- **[info] image_domain_mismatch** — Image domain mismatch: 20/20 (100%) lots use host 'thepropertypeople.bambooauctions.com' — could be a logo/placeholder
  - `{"host":"thepropertypeople.bambooauctions.com","count":20,"total":20,"ratio":1}`

## andrewcraig

- **[info] image_domain_mismatch** — Image domain mismatch: 69/69 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":69,"total":69,"ratio":1}`

## auction house east midlands

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://liveauctions.eigroup.co.uk/auction/gotoauction/bab' exists under 4 houses (auction house east midlands, auction house west midlands, auctionhouseeastmidlands, auctionhousewestmidlands) — detectAuctionHouse() may be misrouting
  - `{"url":"https://liveauctions.eigroup.co.uk/auction/gotoauction/bab","houses":["auction house east midlands","auction house west midlands","auctionhouseeastmidlands","auctionhousewestmidlands"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://liveauctions.eigroup.co.uk/auction/gotoauction/roh' exists under 4 houses (auction house east midlands, auction house west midlands, auctionhouseeastmidlands, auctionhousewestmidlands) — detectAuctionHouse() may be misrouting
  - `{"url":"https://liveauctions.eigroup.co.uk/auction/gotoauction/roh","houses":["auction house east midlands","auction house west midlands","auctionhouseeastmidlands","auctionhousewestmidlands"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://bidding.eigpropertyauctions.co.uk/auction/auctioneer/20' exists under 4 houses (auction house east midlands, auction house west midlands, auctionhouseeastmidlands, auctionhousewestmidlands) — detectAuctionHouse() may be misrouting
  - `{"url":"https://bidding.eigpropertyauctions.co.uk/auction/auctioneer/20","houses":["auction house east midlands","auction house west midlands","auctionhouseeastmidlands","auctionhousewestmidlands"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/wales/auction/2026/4/22' exists under 6 houses (auction house east midlands, auction house west midlands, auctionhouse, auctionhouseeastmidlands, auctionhousenorthwales, auctionhousewestmidlands) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/wales/auction/2026/4/22","houses":["auction house east midlands","auction house west midlands","auctionhouse","auctionhouseeastmidlands","auctionhousenorthwales","auctionhousewestmidlands"]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'auction house east midlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auction house east midlands"}`

## auction house west midlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auction house west midlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auction house west midlands"}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 33/34 (97%) lots have empty bullets
  - `{"empty":33,"total":34,"ratio":0.971}`
- **[info] image_domain_mismatch** — Image domain mismatch: 34/34 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":34,"total":34,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":22,"examples":[{"address":"35 orient court gresley close, telford, shropshire, tf7 5tu","count":3},{"address":"national online auction bidding now open! click to view lots","count":4},{"address":"apartment 3 delamere place, runcorn, cheshire, wa7 4ne","count":3}]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337667' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337667","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337108' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337108","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338633' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338633","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339248' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthernireland) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339248","houses":["auctionhouse","auctionhousenational","auctionhousenorthernireland"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337374' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337374","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340049' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340049","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339612' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339612","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337836' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337836","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336757' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336757","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335703' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335703","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336349' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336349","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339833' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339833","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339557' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339557","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338099' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338099","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336998' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336998","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339805' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339805","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336584' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336584","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340013' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340013","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336922' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336922","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335370' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335370","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335984' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335984","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337967' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337967","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335916' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335916","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339717' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339717","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/online/auction/2026/4/28' exists under 2 houses (auctionhouse, auctionhousenorthwales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/online/auction/2026/4/28","houses":["auctionhouse","auctionhousenorthwales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338960' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338960","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335397' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335397","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337408' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337408","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337828' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337828","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336891' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336891","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336979' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336979","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338615' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338615","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336374' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336374","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342485' exists under 2 houses (auctionhouse, auctionhouseteesvalley) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342485","houses":["auctionhouse","auctionhouseteesvalley"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335924' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335924","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336977' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336977","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337691' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337691","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337173' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337173","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337504' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337504","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339479' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339479","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339895' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339895","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339011' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339011","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339304' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339304","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336737' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336737","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336368' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336368","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338323' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338323","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342010' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342010","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339008' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339008","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336769' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336769","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337676' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337676","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336980' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336980","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338138' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338138","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337001' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337001","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339871' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339871","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339311' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339311","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340102' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340102","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339239' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339239","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339779' exists under 3 houses (auctionhouse, auctionhousenational, austingray) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339779","houses":["auctionhouse","auctionhousenational","austingray"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336589' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336589","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338896' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338896","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337567' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337567","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340792' exists under 2 houses (auctionhouse, auctionhousenorthernireland) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340792","houses":["auctionhouse","auctionhousenorthernireland"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339465' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339465","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337128' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337128","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339444' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339444","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337944' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337944","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337574' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337574","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338315' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338315","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336253' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336253","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337455' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337455","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336773' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336773","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339053' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339053","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337466' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337466","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338131' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338131","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337993' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337993","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337909' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337909","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339844' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339844","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336788' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336788","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336930' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336930","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339295' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339295","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338094' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338094","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337222' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337222","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340144' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340144","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/330466' exists under 2 houses (auctionhouse, auctionhousemanchester) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/330466","houses":["auctionhouse","auctionhousemanchester"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336957' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336957","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339529' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339529","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336926' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336926","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337486' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337486","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336929' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336929","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339861' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339861","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340534' exists under 2 houses (auctionhouse, auctionhouseleicestershire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340534","houses":["auctionhouse","auctionhouseleicestershire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336974' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336974","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338794' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338794","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337039' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337039","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339596' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339596","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/338903' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/338903","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339303' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339303","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337955' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337955","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336770' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336770","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337672' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337672","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339884' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339884","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339741' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339741","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336890' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336890","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335823' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335823","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339581' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339581","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339268' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339268","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339209' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339209","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337448' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337448","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336834' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336834","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338641' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338641","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336985' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336985","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336949' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336949","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336567' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336567","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336249' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336249","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336358' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336358","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/340019' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/340019","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336493' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336493","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335840' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335840","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338937' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338937","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336939' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336939","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336751' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336751","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338017' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338017","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340120' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340120","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339305' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339305","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337462' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337462","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337668' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337668","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/338036' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/338036","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339627' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339627","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337698' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337698","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337823' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337823","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338997' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338997","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336959' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336959","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339694' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339694","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337182' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337182","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337444' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337444","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339001' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339001","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335744' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335744","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339480' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339480","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/338872' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/338872","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338077' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338077","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336403' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336403","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336366' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336366","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336569' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336569","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/338084' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/338084","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337588' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337588","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336370' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336370","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337591' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337591","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335623' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335623","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339502' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339502","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336457' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336457","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337144' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337144","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/334607' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/334607","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336498' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336498","houses":["auctionhouse","auctionhousenational","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337328' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337328","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338259' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338259","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337606' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337606","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337082' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337082","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336829' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336829","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337763' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337763","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/334394' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/334394","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335832' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335832","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342916' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342916","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337296' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337296","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339492' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339492","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339206' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339206","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/322219' exists under 2 houses (auctionhouse, auctionhousemanchester) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/322219","houses":["auctionhouse","auctionhousemanchester"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336138' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336138","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339515' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339515","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337877' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337877","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339035' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339035","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336107' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336107","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/332161' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/332161","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/332230' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/332230","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338598' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338598","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/322220' exists under 2 houses (auctionhouse, auctionhousemanchester) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/322220","houses":["auctionhouse","auctionhousemanchester"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337094' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337094","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338974' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338974","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337441' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337441","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336390' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336390","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337948' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337948","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337968' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337968","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339881' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339881","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338674' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338674","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339732' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339732","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339540' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339540","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339470' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339470","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339317' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339317","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339309' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339309","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/335830' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/335830","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338882' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338882","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337379' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337379","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/322218' exists under 2 houses (auctionhouse, auctionhousemanchester) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/322218","houses":["auctionhouse","auctionhousemanchester"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337856' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337856","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337826' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337826","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/online/auction/2026/4/14' exists under 2 houses (auctionhouse, auctionhousenorthwales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/online/auction/2026/4/14","houses":["auctionhouse","auctionhousenorthwales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337600' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337600","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337596' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337596","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336587' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336587","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/335811' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/335811","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340045' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340045","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338166' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338166","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339763' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339763","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338104' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338104","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335962' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335962","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337549' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337549","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337746' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337746","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336803' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336803","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338841' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338841","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336194' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336194","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339674' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339674","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336260' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336260","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338869' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338869","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335781' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335781","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340119' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340119","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339642' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339642","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339771' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339771","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339055' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339055","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/330185' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/330185","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339463' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339463","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337059' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337059","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/338116' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/338116","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335842' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335842","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337327' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337327","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335680' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335680","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336525' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336525","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/335627' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/335627","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/338132' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/338132","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338924' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338924","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336156' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336156","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337326' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337326","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338071' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338071","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/336858' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/336858","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/333805' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/333805","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337603' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337603","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338878' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338878","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337464' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337464","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339054' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339054","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/335535' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/335535","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339972' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339972","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337769' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337769","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336202' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336202","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336972' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336972","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339244' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339244","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339975' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339975","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/330996' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/330996","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/334830' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/334830","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336892' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336892","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336133' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336133","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336377' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336377","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336924' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336924","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337940' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337940","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337454' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337454","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337233' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337233","houses":["auctionhouse","auctionhousenational","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337529' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337529","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/334864' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/334864","houses":["auctionhouse","auctionhousenational","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337300' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337300","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336921' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336921","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337184' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337184","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336201' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336201","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335119' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335119","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336491' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336491","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339636' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339636","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/334107' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/334107","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340112' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340112","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339961' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339961","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339639' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339639","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336264' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336264","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340145' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340145","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339005' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339005","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336870' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336870","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337729' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337729","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337437' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337437","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338994' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338994","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336889' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336889","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336373' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336373","houses":["auctionhouse","auctionhousenational","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336068' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336068","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336061' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336061","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337534' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337534","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338910' exists under 4 houses (auctionhouse, auctionhouseeastanglia, auctionhouseessex, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338910","houses":["auctionhouse","auctionhouseeastanglia","auctionhouseessex","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339481' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339481","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338785' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338785","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339922' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339922","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335925' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335925","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335975' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335975","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339562' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339562","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335601' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335601","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335557' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335557","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335881' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335881","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336472' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336472","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336380' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336380","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338694' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338694","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337587' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337587","houses":["auctionhouse","auctionhousenational","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337420' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337420","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337392' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337392","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336893' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336893","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336731' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336731","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336540' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336540","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336537' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336537","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336246' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336246","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335892' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335892","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336167' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336167","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336208' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336208","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336925' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336925","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337046' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337046","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337505' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337505","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337516' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337516","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339442' exists under 3 houses (auctionhouse, auctionhousenational, austingray) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339442","houses":["auctionhouse","auctionhousenational","austingray"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339834' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339834","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340017' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340017","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338130' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338130","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339707' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339707","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340140' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340140","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339933' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339933","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339848' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339848","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339572' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339572","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337008' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337008","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336956' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336956","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336928' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336928","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337859' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337859","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337962' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337962","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339927' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339927","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/338520' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/338520","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/338333' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/338333","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339831' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339831","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337989' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337989","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/326932' exists under 2 houses (auctionhouse, auctionhousemanchester) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/326932","houses":["auctionhouse","auctionhousemanchester"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336150' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336150","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/335810' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/335810","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336495' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336495","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339165' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339165","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336456' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336456","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337521' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337521","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336821' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336821","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/338907' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/338907","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/336915' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/336915","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337939' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337939","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/331020' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/331020","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/330972' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/330972","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339273' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339273","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337666' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337666","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339621' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339621","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339624' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339624","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339626' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339626","houses":["auctionhouse","auctionhouseuklondon"]}`

## auctionhousedevon

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147819' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147819","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146343' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146343","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146117' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146117","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146108' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146108","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147332' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147332","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147817' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147817","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147710' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147710","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146334' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146334","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146425' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146425","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[info] bullet_starvation** — Bullet starvation: 24/24 (100%) lots have empty bullets
  - `{"empty":24,"total":24,"ratio":1}`

## auctionhouseeastanglia

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/eastanglia/auction/lot/147129' exists under 2 houses (auctionhouseeastanglia, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/eastanglia/auction/lot/147129","houses":["auctionhouseeastanglia","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/eastanglia/auction/lot/146488' exists under 2 houses (auctionhouseeastanglia, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/eastanglia/auction/lot/146488","houses":["auctionhouseeastanglia","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/eastanglia/auction/lot/146404' exists under 2 houses (auctionhouseeastanglia, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/eastanglia/auction/lot/146404","houses":["auctionhouseeastanglia","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/eastanglia/auction/lot/145540' exists under 2 houses (auctionhouseeastanglia, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/eastanglia/auction/lot/145540","houses":["auctionhouseeastanglia","auctionhouseessex"]}`
- **[info] bullet_starvation** — Bullet starvation: 102/102 (100%) lots have empty bullets
  - `{"empty":102,"total":102,"ratio":1}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[info] bullet_starvation** — Bullet starvation: 6/6 (100%) lots have empty bullets
  - `{"empty":6,"total":6,"ratio":1}`

## auctionhouselincolnshire

- **[info] bullet_starvation** — Bullet starvation: 40/40 (100%) lots have empty bullets
  - `{"empty":40,"total":40,"ratio":1}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":28,"examples":[{"address":"sold prior to auction, for an undisclosed amount","count":14},{"address":"postponed","count":4},{"address":"sold prior for","count":6}]}`

## auctionhousenational

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336811' exists under 2 houses (auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336811","houses":["auctionhousenational","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335807' exists under 2 houses (auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335807","houses":["auctionhousenational","auctionhousewales"]}`
- **[info] bullet_starvation** — Bullet starvation: 269/269 (100%) lots have empty bullets
  - `{"empty":269,"total":269,"ratio":1}`

## auctionhousenortheast

- **[info] bullet_starvation** — Bullet starvation: 39/39 (100%) lots have empty bullets
  - `{"empty":39,"total":39,"ratio":1}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"national online auction bidding now open! click to view lots","count":5}]}`
- **[info] bullet_starvation** — Bullet starvation: 6/6 (100%) lots have empty bullets
  - `{"empty":6,"total":6,"ratio":1}`

## auctionhousenorthwest

- **[info] bullet_starvation** — Bullet starvation: 115/115 (100%) lots have empty bullets
  - `{"empty":115,"total":115,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 106/115 (92%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":106,"total":115,"ratio":0.922}`

## auctionhousenottsandderby

- **[info] bullet_starvation** — Bullet starvation: 19/19 (100%) lots have empty bullets
  - `{"empty":19,"total":19,"ratio":1}`

## auctionhousescotland

- **[info] bullet_starvation** — Bullet starvation: 59/59 (100%) lots have empty bullets
  - `{"empty":59,"total":59,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 59/59 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":59,"total":59,"ratio":1}`

## auctionhousesouthwest

- **[info] bullet_starvation** — Bullet starvation: 24/24 (100%) lots have empty bullets
  - `{"empty":24,"total":24,"ratio":1}`

## auctionhousesouthyorkshire

- **[info] bullet_starvation** — Bullet starvation: 47/47 (100%) lots have empty bullets
  - `{"empty":47,"total":47,"ratio":1}`

## auctionhouseuklondon

- **[info] bullet_starvation** — Bullet starvation: 417/417 (100%) lots have empty bullets
  - `{"empty":417,"total":417,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 382/417 (92%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":382,"total":417,"ratio":0.916}`

## auctionhousewales

- **[info] bullet_starvation** — Bullet starvation: 56/56 (100%) lots have empty bullets
  - `{"empty":56,"total":56,"ratio":1}`

## auctionnorth

- **[warn] identical_price_wall** — Identical-price wall: 4/5 (80%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":4,"total":5,"ratio":0.8}`

## austingray

- **[info] bullet_starvation** — Bullet starvation: 52/52 (100%) lots have empty bullets
  - `{"empty":52,"total":52,"ratio":1}`

## barnardmarcus

- **[info] bullet_starvation** — Bullet starvation: 17/20 (85%) lots have empty bullets
  - `{"empty":17,"total":20,"ratio":0.85}`

## bradleysdevon

- **[warn] town_only_addresses** — Town-only addresses: 9/11 (82%) lots have ≤2-word, no-comma addresses — extractor may be targeting branch/event cards
  - `{"town_only":9,"total":11,"ratio":0.818}`

## brownco

- **[info] bullet_starvation** — Bullet starvation: 9/12 (75%) lots have empty bullets
  - `{"empty":9,"total":12,"ratio":0.75}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":6,"examples":[{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":6}]}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"for sale by auction29th april 2026","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 7/8 (88%) lots have empty bullets
  - `{"empty":7,"total":8,"ratio":0.875}`
- **[info] image_domain_mismatch** — Image domain mismatch: 8/8 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":8,"total":8,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"freehold parcel of land","count":3}]}`

## countrywide

- **[info] image_domain_mismatch** — Image domain mismatch: 104/105 (99%) lots use host 'www.suttonkersh.co.uk' — could be a logo/placeholder
  - `{"host":"www.suttonkersh.co.uk","count":104,"total":105,"ratio":0.99}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 8/8 (100%) lots missing image_url
  - `{"missing":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":33,"examples":[{"address":"virtual viewing","count":22},{"address":"clough road, droylsden, greater manchester, m43","count":4},{"address":"meadow lane, disley, cheshire, sk12","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 300/301 (100%) lots have empty bullets
  - `{"empty":300,"total":301,"ratio":0.997}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## foxandsons

- **[info] bullet_starvation** — Bullet starvation: 17/17 (100%) lots have empty bullets
  - `{"empty":17,"total":17,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 16/17 (94%) lots use host 'www.barnardmarcusauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.barnardmarcusauctions.co.uk","count":16,"total":17,"ratio":0.941}`

## futureauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 180/183 (98%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":180,"total":183,"ratio":0.984}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 75 addresses appear ≥3 times each (403 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":75,"total_dupe_rows":403,"examples":[{"address":"one bedroom lower ground floor flat","count":3},{"address":"a two bedroom split level flat","count":7},{"address":"a one bedroom ground floor flat","count":10}]}`
- **[warn] identical_price_wall** — Identical-price wall: 748/1117 (67%) lots share price £1500 — extractor likely picking up hero/banner price
  - `{"price":1500,"count":748,"total":1117,"ratio":0.67}`

## higginsdrysdale

- **[warn] identical_price_wall** — Identical-price wall: 17/30 (57%) lots share price £1900 — extractor likely picking up hero/banner price
  - `{"price":1900,"count":17,"total":30,"ratio":0.567}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 63 addresses appear ≥3 times each (231 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":63,"total_dupe_rows":231,"examples":[{"address":"whitehall road, whitehall, bs5 9bj","count":3},{"address":"anstey street, easton, bs5 6dg","count":3},{"address":"argyle street, gorse hill, sn2 8ar","count":3}]}`

## hunters

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://lacyscottandknight.bambooauctions.com/property/1-2-black-cottage-tye-lane-bramford-ipswich-suffolk-ip8-4la-2923673' exists under 2 houses (hunters, lsk) — detectAuctionHouse() may be misrouting
  - `{"url":"https://lacyscottandknight.bambooauctions.com/property/1-2-black-cottage-tye-lane-bramford-ipswich-suffolk-ip8-4la-2923673","houses":["hunters","lsk"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/myrtle-cottage-eastdown-blackawton-totnes-devon-tq9-7ap-6668071' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/myrtle-cottage-eastdown-blackawton-totnes-devon-tq9-7ap-6668071","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/2001-acres-of-land-at-uppacott-moretonhampstead-4167774' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/2001-acres-of-land-at-uppacott-moretonhampstead-4167774","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/bridford-mills-gospel-hall-1270730' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/bridford-mills-gospel-hall-1270730","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/detached-stone-built-chapel-5969200' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/detached-stone-built-chapel-5969200","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/buckleys-harraton-9392784' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/buckleys-harraton-9392784","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/land-lying-to-the-north-of-commons-hill-christow-exeter-ex6-7pg-4076144' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/land-lying-to-the-north-of-commons-hill-christow-exeter-ex6-7pg-4076144","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/the-old-chapel-yonder-street-ottery-st-mary-ex11-1hh-4841718' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/the-old-chapel-yonder-street-ottery-st-mary-ex11-1hh-4841718","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/eastacombe-chapel-tawstock-5832358' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/eastacombe-chapel-tawstock-5832358","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/lynwood-shaugh-prior-plymouth-devon-pl7-5hb-9664056' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/lynwood-shaugh-prior-plymouth-devon-pl7-5hb-9664056","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/rose-cottage-moreleigh-road-harbertonford-totnes-devon-tq9-7ts-5545811' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/rose-cottage-moreleigh-road-harbertonford-totnes-devon-tq9-7ts-5545811","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/10-bank-lane-victoria-street-totnes-tq9-5eh-8257413' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/10-bank-lane-victoria-street-totnes-tq9-5eh-8257413","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/east-hill-bungalow-1847768' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/east-hill-bungalow-1847768","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/land-adjoining-treeby-aish-tq10-9jh-8184032' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/land-adjoining-treeby-aish-tq10-9jh-8184032","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/17-acres-of-agricultural-land-whiddon-down-okehampton-ex20-9968951' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/17-acres-of-agricultural-land-whiddon-down-okehampton-ex20-9968951","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/drayford-unit-30-quay-road-newton-abbot-tq12-2bu-4772894' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/drayford-unit-30-quay-road-newton-abbot-tq12-2bu-4772894","houses":["hunters","rendells"]}`

## john francis

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/sales/tag-jf-new-homes' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/sales/tag-jf-new-homes","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/21590844/sales' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/21590844/sales","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/21326929/sales' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/21326929/sales","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/lettings/tag-house/most-recent-first' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/lettings/tag-house/most-recent-first","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/21634618/sales' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/21634618/sales","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/20686759/sales' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/20686759/sales","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/21437744/sales' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/21437744/sales","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/sales/most-recent-first' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/sales/most-recent-first","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/sales/tag-commercial-sales/status-all' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/sales/tag-commercial-sales/status-all","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/19215127/sales' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/19215127/sales","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/20926381/sales' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/20926381/sales","houses":["john francis","johnfrancis"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.johnfrancis.co.uk/properties/21401541/sales' exists under 2 houses (john francis, johnfrancis) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.johnfrancis.co.uk/properties/21401541/sales","houses":["john francis","johnfrancis"]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'john francis' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"john francis"}`

## jonespeckover

- **[warn] identical_price_wall** — Identical-price wall: 4/7 (57%) lots share price £20000 — extractor likely picking up hero/banner price
  - `{"price":20000,"count":4,"total":7,"ratio":0.571}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (36 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":36,"examples":[{"address":"victoria road, camelford, cornwall pl32","count":4},{"address":"st. ive, liskeard, cornwall pl14","count":4},{"address":"bolventor, launceston, cornwall pl15","count":4}]}`

## knightfrank

- **[info] bullet_starvation** — Bullet starvation: 23/23 (100%) lots have empty bullets
  - `{"empty":23,"total":23,"ratio":1}`

## landwood

- **[warn] image_coverage_low** — Image coverage low: 93/134 (69%) lots missing image_url
  - `{"missing":93,"total":134,"ratio":0.694}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 59/59 (100%) lots missing image_url
  - `{"missing":59,"total":59,"ratio":1}`

## lot9

- **[warn] identical_price_wall** — Identical-price wall: 12/16 (75%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":12,"total":16,"ratio":0.75}`

## lsh

- **[info] bullet_starvation** — Bullet starvation: 22/23 (96%) lots have empty bullets
  - `{"empty":22,"total":23,"ratio":0.957}`

## maggsandallen

- **[warn] image_coverage_low** — Image coverage low: 22/40 (55%) lots missing image_url
  - `{"missing":22,"total":40,"ratio":0.55}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"crai, brecon, powys, ld3 8ys","count":3},{"address":"foxglove close, stourport-on-severn, worcestershire, dy13 9bn","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 84/88 (95%) lots have empty bullets
  - `{"empty":84,"total":88,"ratio":0.955}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 60 addresses appear ≥3 times each (205 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":60,"total_dupe_rows":205,"examples":[{"address":"1 glyn terrace, tredegar, np22 4hx","count":4},{"address":"51 high street, clydach, abertawe, swansea, sa6 5lh","count":3},{"address":"glanavon house, snatchwood road, abersychan, pontypool, gwent, np4 7bt","count":5}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 50/51 (98%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":50,"total":51,"ratio":0.98}`

## philliparnold

- **[warn] image_coverage_low** — Image coverage low: 12/12 (100%) lots missing image_url
  - `{"missing":12,"total":12,"ratio":1}`

## propertyauctionagent

- **[info] bullet_starvation** — Bullet starvation: 7/8 (88%) lots have empty bullets
  - `{"empty":7,"total":8,"ratio":0.875}`

## purplebricksgoto

- **[info] bullet_starvation** — Bullet starvation: 154/154 (100%) lots have empty bullets
  - `{"empty":154,"total":154,"ratio":1}`

## sageandco

- **[info] bullet_starvation** — Bullet starvation: 13/14 (93%) lots have empty bullets
  - `{"empty":13,"total":14,"ratio":0.929}`

## sdl

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50280/semi-detached-house-for-auction-nottingham/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50280/semi-detached-house-for-auction-nottingham/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50201/cottage-for-auction-ashbourne/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50201/cottage-for-auction-ashbourne/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50202/terraced-house-for-auction-loughborough/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50202/terraced-house-for-auction-loughborough/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50190/flat-for-auction-littlehampton/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50190/flat-for-auction-littlehampton/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50242/terraced-house-for-auction-derby/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50242/terraced-house-for-auction-derby/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50279/bungalow-for-auction-appleby-in-westmorland/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50279/bungalow-for-auction-appleby-in-westmorland/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50269/cottage-for-auction-hitchin/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50269/cottage-for-auction-hitchin/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50281/detached-house-for-auction-nottingham/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50281/detached-house-for-auction-nottingham/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50231/commercial-property-for-auction-ripley/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50231/commercial-property-for-auction-ripley/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50238/commercial-property-for-auction-walsall/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50238/commercial-property-for-auction-walsall/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50284/hotel-for-auction-fairbourne/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50284/hotel-for-auction-fairbourne/","houses":["sdl","sdl auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/property/50232/mixed-use-for-auction-huddersfield/' exists under 2 houses (sdl, sdl auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/property/50232/mixed-use-for-auction-huddersfield/","houses":["sdl","sdl auctions"]}`

## sdl auctions

- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl auctions' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl auctions"}`
- **[info] image_domain_mismatch** — Image domain mismatch: 12/12 (100%) lots use host 'sdl-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"sdl-hub.property-world.co.uk","count":12,"total":12,"ratio":1}`

## sharpesauctions

- **[info] bullet_starvation** — Bullet starvation: 23/23 (100%) lots have empty bullets
  - `{"empty":23,"total":23,"ratio":1}`

## shonkibros

- **[info] bullet_starvation** — Bullet starvation: 14/14 (100%) lots have empty bullets
  - `{"empty":14,"total":14,"ratio":1}`

## strettons

- **[info] bullet_starvation** — Bullet starvation: 59/60 (98%) lots have empty bullets
  - `{"empty":59,"total":60,"ratio":0.983}`

## suttonkersh

- **[info] stale_lot_wall** — Stale lot wall: 23/34 (68%) lots are past auction date >7d but still marked available
  - `{"stale":23,"total":34,"ratio":0.676,"cutoff":"2026-04-25T06:57:37.456Z"}`

## symondsandsampson

- **[warn] town_only_addresses** — Town-only addresses: 13/13 (100%) lots have ≤2-word, no-comma addresses — extractor may be targeting branch/event cards
  - `{"town_only":13,"total":13,"ratio":1}`
- **[warn] identical_price_wall** — Identical-price wall: 13/13 (100%) lots share price £100000 — extractor likely picking up hero/banner price
  - `{"price":100000,"count":13,"total":13,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 13/13 (100%) lots missing image_url
  - `{"missing":13,"total":13,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 13/13 (100%) lots have empty bullets
  - `{"empty":13,"total":13,"ratio":1}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 157 addresses appear ≥3 times each (549 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":157,"total_dupe_rows":549,"examples":[{"address":"8 coedwig terrace, penmon, beaumaris, anglesey, ll58 8sl","count":4},{"address":"trem y dyffryn, llanbedr-y-cennin, conwy, gwynedd, ll32 8un","count":4},{"address":"8 llwyn onn, rhos on sea, colwyn bay, conwy, ll28 4bz","count":4}]}`

## thepropertyauctionhouse

- **[info] bullet_starvation** — Bullet starvation: 33/36 (92%) lots have empty bullets
  - `{"empty":33,"total":36,"ratio":0.917}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":67,"examples":[{"address":"apt. 10 justine mansions 4 riding street, liverpool, l3 5np","count":4},{"address":"apt.19 9 hatton garden, liverpool, l3 2fe","count":4},{"address":"95 alexandra road, crosby, merseyside, l23 7te","count":3}]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011984' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011984","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1012009' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1012009","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011978' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011978","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=37%20Brookland%20Road%20West,%20Liverpool,%20L13%203BG' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=37%20Brookland%20Road%20West,%20Liverpool,%20L13%203BG","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=1' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=1","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=2' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=2","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011989' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011989","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=10' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=10","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011995' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011995","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=27a%20Egremont%20Promenade,%20Wallasey,%20CH44%208BG' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=27a%20Egremont%20Promenade,%20Wallasey,%20CH44%208BG","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=Unit%2012%20Emirates%20House%20Stopgate%20Lane,%20Walton,%20Merseyside,%20L9%206AN' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=Unit%2012%20Emirates%20House%20Stopgate%20Lane,%20Walton,%20Merseyside,%20L9%206AN","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=40A%20Grange%20Road,%20West%20Kirby,%20Merseyside,%20CH48%204EF' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=40A%20Grange%20Road,%20West%20Kirby,%20Merseyside,%20CH48%204EF","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1012021' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1012021","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1012047' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1012047","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=46%20Ash%20Grove,%20Wavertree,%20Merseyside,%20L15%201ET' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=46%20Ash%20Grove,%20Wavertree,%20Merseyside,%20L15%201ET","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=185%20Westminster%20Road,%20Liverpool,%20L4%204LR' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=185%20Westminster%20Road,%20Liverpool,%20L4%204LR","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011927' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011927","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011946' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011946","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011950' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011950","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011960' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011960","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011895' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011895","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=3' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=3","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=16' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=16","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=4' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=4","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=5' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=5","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=8' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=8","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=11' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=11","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=12' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=12","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=13' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=13","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=17' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=17","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=145%20Walton%20Village,%20Liverpool,%20L4%206TG' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=145%20Walton%20Village,%20Liverpool,%20L4%206TG","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=19%20Spellow%20Lane,%20Liverpool,%20L4%204DE' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=19%20Spellow%20Lane,%20Liverpool,%20L4%204DE","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=6%20Broadbelt%20Street,%20Liverpool,%20L4%205QL' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=6%20Broadbelt%20Street,%20Liverpool,%20L4%205QL","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=6' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=6","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=7' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=7","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=15' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=15","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=9' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=9","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=20' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=20","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=95%20Alexandra%20Road,%20Crosby,%20Merseyside,%20L23%207TE' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=95%20Alexandra%20Road,%20Crosby,%20Merseyside,%20L23%207TE","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=19' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=19","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=8%20Anson%20Street,%20Liverpool,%20L3%205NY' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=8%20Anson%20Street,%20Liverpool,%20L3%205NY","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011935' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011935","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1012014' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1012014","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011897' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011897","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011904' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011904","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011919' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011919","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=6%20Woodend,%20Pensby,%20CH61%208RU' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=6%20Woodend,%20Pensby,%20CH61%208RU","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011968' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011968","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011908' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=L1011908","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=18' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=18","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apartment%20504%2037%20Strand%20Street,%20Liverpool,%20L1%208ND' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apartment%20504%2037%20Strand%20Street,%20Liverpool,%20L1%208ND","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apartment%204,%2010B%20Moss%20Street,%20Liverpool,%20L6%201HD' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apartment%204,%2010B%20Moss%20Street,%20Liverpool,%20L6%201HD","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apt.%2010%20Justine%20Mansions%204%20Riding%20Street,%20Liverpool,%20L3%205NP' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apt.%2010%20Justine%20Mansions%204%20Riding%20Street,%20Liverpool,%20L3%205NP","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=14' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=14","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apartment%205%2011%20Sir%20Thomas%20Street,%20Liverpool,%20L1%206BW' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apartment%205%2011%20Sir%20Thomas%20Street,%20Liverpool,%20L1%206BW","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=15%20Spellow%20Lane,%20Liverpool,%20L4%204DE' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=15%20Spellow%20Lane,%20Liverpool,%20L4%204DE","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=60%20Moss%20Lane,%20Orrell%20Park,%20Merseyside,%20L9%208AN' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=60%20Moss%20Lane,%20Orrell%20Park,%20Merseyside,%20L9%208AN","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apt.19%209%20Hatton%20Garden,%20Liverpool,%20L3%202FE' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=Apt.19%209%20Hatton%20Garden,%20Liverpool,%20L3%202FE","houses":["venmore","venmore auctions"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.venmoreauctions.co.uk/Property-Details?property_reference=48%20Ash%20Grove,%20Wavertree,%20Merseyside,%20L15%201ET' exists under 2 houses (venmore, venmore auctions) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.venmoreauctions.co.uk/Property-Details?property_reference=48%20Ash%20Grove,%20Wavertree,%20Merseyside,%20L15%201ET","houses":["venmore","venmore auctions"]}`
- **[info] bullet_starvation** — Bullet starvation: 61/81 (75%) lots have empty bullets
  - `{"empty":61,"total":81,"ratio":0.753}`

## venmore auctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"40a grange road, west kirby, merseyside, ch48 4ef","count":3},{"address":"8 anson street, liverpool, l3 5ny","count":3},{"address":"60 moss lane, orrell park, merseyside, l9 8an","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'venmore auctions' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"venmore auctions"}`
- **[info] bullet_starvation** — Bullet starvation: 59/59 (100%) lots have empty bullets
  - `{"empty":59,"total":59,"ratio":1}`

## walkersingleton

- **[warn] identical_price_wall** — Identical-price wall: 9/9 (100%) lots share price £5000 — extractor likely picking up hero/banner price
  - `{"price":5000,"count":9,"total":9,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 9/9 (100%) lots missing image_url
  - `{"missing":9,"total":9,"ratio":1}`

## webbers

- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`


