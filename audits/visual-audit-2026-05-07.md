# Visual Audit — 2026-05-07

Scanned **14,068** rows in **12438ms** across **62** houses with findings.

**Findings:** 610 error · 19 warn · 38 info

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":38,"examples":[{"address":"land at langney rise, eastbourne, east sussex, bn23 7nl","count":3},{"address":"plot 2, land at woodlands way, southwater, horsham, west sussex, rh13 9hz","count":3},{"address":"land at willow wood road, meopham, gravesend, kent, da13 0qt","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 131/183 (72%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":131,"total":183,"ratio":0.716}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"market lane, dunston, ne11","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 71/71 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":71,"total":71,"ratio":1}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 33/34 (97%) lots have empty bullets
  - `{"empty":33,"total":34,"ratio":0.971}`
- **[info] image_domain_mismatch** — Image domain mismatch: 34/34 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":34,"total":34,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":22,"examples":[{"address":"35 orient court gresley close, telford, shropshire, tf7 5tu","count":3},{"address":"national online auction bidding now open! click to view lots","count":4},{"address":"apartment 3 delamere place, runcorn, cheshire, wa7 4ne","count":3}]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338960' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338960","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337667' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337667","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337108' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337108","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338633' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338633","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339248' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthernireland) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339248","houses":["auctionhouse","auctionhousenational","auctionhousenorthernireland"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341985' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341985","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340345' exists under 3 houses (auctionhouse, auctionhousenational, austingray) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340345","houses":["auctionhouse","auctionhousenational","austingray"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337374' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337374","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342939' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342939","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340049' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340049","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339612' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339612","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342607' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342607","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342218' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342218","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337836' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337836","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342219' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342219","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341954' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341954","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/336757' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/336757","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340552' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340552","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335703' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335703","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336349' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336349","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343354' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343354","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/343640' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/343640","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342961' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342961","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339833' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339833","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/344650' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/344650","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339557' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339557","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341953' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341953","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342510' exists under 2 houses (auctionhouse, auctionhouseteesvalley) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342510","houses":["auctionhouse","auctionhouseteesvalley"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338099' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338099","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336998' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336998","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/330695' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/330695","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339805' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339805","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342746' exists under 3 houses (auctionhouse, auctionhousekent, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342746","houses":["auctionhouse","auctionhousekent","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336584' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336584","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343152' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343152","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340013' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340013","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336922' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336922","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/328094' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/328094","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335370' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335370","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335984' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335984","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337967' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337967","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335916' exists under 3 houses (auctionhouse, auctionhousekent, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335916","houses":["auctionhouse","auctionhousekent","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/326752' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/326752","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339717' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339717","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342027' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342027","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341846' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341846","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/online/auction/2026/4/28' exists under 2 houses (auctionhouse, auctionhousenorthwales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/online/auction/2026/4/28","houses":["auctionhouse","auctionhousenorthwales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342210' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342210","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/343089' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/343089","houses":["auctionhouse","auctionhousewales"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342693' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342693","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/wales/auction/2026/4/22' exists under 4 houses (auctionhouse, auctionhouseeastmidlands, auctionhousenorthwales, auctionhousewestmidlands) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/wales/auction/2026/4/22","houses":["auctionhouse","auctionhouseeastmidlands","auctionhousenorthwales","auctionhousewestmidlands"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/343597' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/343597","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343538' exists under 2 houses (auctionhouse, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343538","houses":["auctionhouse","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335924' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335924","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339871' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339871","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342623' exists under 2 houses (auctionhouse, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342623","houses":["auctionhouse","auctionhouseessex"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342217' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342217","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341726' exists under 2 houses (auctionhouse, auctionhousedevon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341726","houses":["auctionhouse","auctionhousedevon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341327' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341327","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342895' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342895","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342768' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342768","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342602' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342602","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342903' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342903","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342550' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342550","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342457' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342457","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342342' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342342","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342341' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342341","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341100' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341100","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342229' exists under 2 houses (auctionhouse, auctionhousebirmingham) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342229","houses":["auctionhouse","auctionhousebirmingham"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342854' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342854","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342010' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342010","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/343375' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/343375","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339008' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339008","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336769' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336769","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/344655' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/344655","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337676' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337676","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/328791' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/328791","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/328153' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/328153","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/324275' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/324275","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336980' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336980","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342938' exists under 2 houses (auctionhouse, auctionhouseteesvalley) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342938","houses":["auctionhouse","auctionhouseteesvalley"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343301' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343301","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338138' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338138","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341727' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341727","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337001' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337001","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/344727' exists under 2 houses (auctionhouse, auctionhousebirmingham) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/344727","houses":["auctionhouse","auctionhousebirmingham"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342728' exists under 2 houses (auctionhouse, auctionhousehull) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342728","houses":["auctionhouse","auctionhousehull"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343445' exists under 2 houses (auctionhouse, auctionhouseteesvalley) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343445","houses":["auctionhouse","auctionhouseteesvalley"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337567' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337567","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341357' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341357","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340792' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthernireland) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340792","houses":["auctionhouse","auctionhousenational","auctionhousenorthernireland"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343427' exists under 3 houses (auctionhouse, auctionhousekent, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343427","houses":["auctionhouse","auctionhousekent","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339465' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339465","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337128' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337128","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342898' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342898","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341245' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341245","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339444' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339444","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342282' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342282","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337944' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337944","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342283' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342283","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342618' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342618","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342708' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342708","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/344385' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/344385","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342687' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342687","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337574' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337574","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342459' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342459","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338315' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338315","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340587' exists under 2 houses (auctionhouse, auctionhousebirmingham) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340587","houses":["auctionhouse","auctionhousebirmingham"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336253' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336253","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337455' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337455","houses":["auctionhouse","auctionhousenational","auctionhousenorthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336773' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336773","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343035' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343035","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339053' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339053","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343535' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343535","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343566' exists under 2 houses (auctionhouse, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343566","houses":["auctionhouse","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342842' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342842","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342030' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342030","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/344466' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/344466","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337466' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337466","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343443' exists under 2 houses (auctionhouse, auctionhousebirmingham) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343443","houses":["auctionhouse","auctionhousebirmingham"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343338' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343338","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343328' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343328","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343280' exists under 2 houses (auctionhouse, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343280","houses":["auctionhouse","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338131' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338131","houses":["auctionhouse","auctionhousenational","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337993' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337993","houses":["auctionhouse","auctionhousenational","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342994' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342994","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337909' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337909","houses":["auctionhouse","auctionhousenational","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/344391' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/344391","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343855' exists under 2 houses (auctionhouse, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343855","houses":["auctionhouse","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342162' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342162","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339844' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339844","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343447' exists under 2 houses (auctionhouse, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343447","houses":["auctionhouse","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341457' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341457","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342818' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342818","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343179' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343179","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336788' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336788","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336930' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336930","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342478' exists under 2 houses (auctionhouse, auctionhousebirmingham) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342478","houses":["auctionhouse","auctionhousebirmingham"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341977' exists under 2 houses (auctionhouse, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341977","houses":["auctionhouse","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338794' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338794","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/online/auction/2026/4/14' exists under 2 houses (auctionhouse, auctionhousenorthwales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/online/auction/2026/4/14","houses":["auctionhouse","auctionhousenorthwales"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/328910' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/328910","houses":["auctionhouse","auctionhousekent"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343982' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343982","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/344647' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/344647","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/330694' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/330694","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340975' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340975","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340517' exists under 3 houses (auctionhouse, auctionhousenational, austingray) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340517","houses":["auctionhouse","auctionhousenational","austingray"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342445' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342445","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342222' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342222","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341955' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341955","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/327582' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/327582","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/329058' exists under 2 houses (auctionhouse, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/329058","houses":["auctionhouse","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336493' exists under 3 houses (auctionhouse, auctionhousemanchester, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336493","houses":["auctionhouse","auctionhousemanchester","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/324061' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/324061","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335840' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335840","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338937' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338937","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342905' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342905","houses":["auctionhouse","auctionhousewales"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342878' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342878","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337462' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337462","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337668' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/337668","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/338036' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/338036","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339627' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/339627","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341893' exists under 2 houses (auctionhouse, auctionhouselincolnshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341893","houses":["auctionhouse","auctionhouselincolnshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340403' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340403","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341378' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341378","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341407' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341407","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342727' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342727","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342418' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342418","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/323617' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/323617","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/325308' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/325308","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/323738' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/323738","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/323737' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/323737","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340807' exists under 2 houses (auctionhouse, auctionhousebirmingham) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340807","houses":["auctionhouse","auctionhousebirmingham"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/343629' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/343629","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/343159' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/343159","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343797' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343797","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342926' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342926","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/331714' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/331714","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337698' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337698","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/323032' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/323032","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341944' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341944","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343720' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343720","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340559' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340559","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337823' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337823","houses":["auctionhouse","auctionhousenational","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343569' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343569","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343314' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343314","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343452' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343452","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343155' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343155","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338997' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338997","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343187' exists under 2 houses (auctionhouse, austingray) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343187","houses":["auctionhouse","austingray"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336498' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336498","houses":["auctionhouse","auctionhousenational","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343332' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343332","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336959' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336959","houses":["auctionhouse","auctionhousenational","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342858' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342858","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/339694' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/339694","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337182' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337182","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340141' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340141","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/343486' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/343486","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337444' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337444","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339001' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339001","houses":["auctionhouse","auctionhousenational","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335744' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335744","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343560' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343560","houses":["auctionhouse","auctionhousestaffordshire"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335263' exists under 2 houses (auctionhouse, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335263","houses":["auctionhouse","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/331265' exists under 2 houses (auctionhouse, auctionhousecumbria) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/331265","houses":["auctionhouse","auctionhousecumbria"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342284' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342284","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/329939' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/329939","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/330596' exists under 2 houses (auctionhouse, auctionhousecumbria) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/330596","houses":["auctionhouse","auctionhousecumbria"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342485' exists under 2 houses (auctionhouse, auctionhouseteesvalley) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342485","houses":["auctionhouse","auctionhouseteesvalley"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/323937' exists under 2 houses (auctionhouse, auctionhouseteesvalley) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/323937","houses":["auctionhouse","auctionhouseteesvalley"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/327601' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/327601","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337763' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337763","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342281' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342281","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/334394' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/334394","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335832' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335832","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342916' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342916","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342279' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342279","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337296' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337296","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339492' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339492","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340723' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340723","houses":["auctionhouse","auctionhousekent"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339206' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339206","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342945' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenorthernireland) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342945","houses":["auctionhouse","auctionhousenational","auctionhousenorthernireland"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/324690' exists under 2 houses (auctionhouse, auctionhousekent) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/324690","houses":["auctionhouse","auctionhousekent"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339642' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339642","houses":["auctionhouse","auctionhousenational","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336107' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336107","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342862' exists under 2 houses (auctionhouse, auctionhousestaffordshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342862","houses":["auctionhouse","auctionhousestaffordshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/344640' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/344640","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/344171' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/344171","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343703' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343703","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/343709' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/343709","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/332161' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/332161","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/332230' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/332230","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338598' exists under 3 houses (auctionhouse, auctionhouseeastanglia, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338598","houses":["auctionhouse","auctionhouseeastanglia","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340984' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340984","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342706' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342706","houses":["auctionhouse","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342819' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342819","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341203' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341203","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340847' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340847","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/322220' exists under 2 houses (auctionhouse, auctionhousemanchester) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/322220","houses":["auctionhouse","auctionhousemanchester"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337094' exists under 4 houses (auctionhouse, auctionhousedevon, auctionhousenational, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337094","houses":["auctionhouse","auctionhousedevon","auctionhousenational","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338974' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338974","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342373' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342373","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341040' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341040","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/337441' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/337441","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341740' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341740","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/341367' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/341367","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336390' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336390","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342814' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342814","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337948' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337948","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/337968' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/337968","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342278' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342278","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338785' exists under 3 houses (auctionhouse, auctionhousenational, auctionhouseteesvalley) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338785","houses":["auctionhouse","auctionhousenational","auctionhouseteesvalley"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342967' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342967","houses":["auctionhouse","auctionhousewales"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342277' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342277","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338869' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338869","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335781' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335781","houses":["auctionhouse","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/340119' exists under 3 houses (auctionhouse, auctionhouselincolnshire, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/340119","houses":["auctionhouse","auctionhouselincolnshire","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339771' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339771","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/329542' exists under 2 houses (auctionhouse, auctionhousecumbria) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/329542","houses":["auctionhouse","auctionhousecumbria"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339055' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339055","houses":["auctionhouse","auctionhousenational","auctionhousenortheast"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/330185' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/330185","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342816' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342816","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://wales.auctionhouse.co.uk/lot/redirect/342815' exists under 2 houses (auctionhouse, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://wales.auctionhouse.co.uk/lot/redirect/342815","houses":["auctionhouse","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342343' exists under 2 houses (auctionhouse, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342343","houses":["auctionhouse","auctionhousenational"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342280' exists under 2 houses (auctionhouse, auctionhouseuklondon) — detectAuctionHouse() may be misrouting
  - `{"url":"https://ahlondon-uk.eigonlineauctions.com/lot/redirect/342280","houses":["auctionhouse","auctionhouseuklondon"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342705' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousenottsandderby) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342705","houses":["auctionhouse","auctionhousenational","auctionhousenottsandderby"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/324469' exists under 2 houses (auctionhouse, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/324469","houses":["auctionhouse","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/338910' exists under 4 houses (auctionhouse, auctionhouseeastanglia, auctionhouseessex, auctionhousenational) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/338910","houses":["auctionhouse","auctionhouseeastanglia","auctionhouseessex","auctionhousenational"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/329212' exists under 2 houses (auctionhouse, auctionhouseteesvalley) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/329212","houses":["auctionhouse","auctionhouseteesvalley"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/342698' exists under 2 houses (auctionhouse, auctionhousenortheast) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/342698","houses":["auctionhouse","auctionhousenortheast"]}`
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
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/339481' exists under 3 houses (auctionhouse, auctionhousenational, auctionhousesouthyorkshire) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/339481","houses":["auctionhouse","auctionhousenational","auctionhousesouthyorkshire"]}`
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

## auctionhousechesterfield

- **[info] image_domain_mismatch** — Image domain mismatch: 8/8 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":8,"total":8,"ratio":1}`

## auctionhousecoventry

- **[info] image_domain_mismatch** — Image domain mismatch: 22/22 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":22,"total":22,"ratio":1}`

## auctionhousecumbria

- **[info] bullet_starvation** — Bullet starvation: 56/57 (98%) lots have empty bullets
  - `{"empty":56,"total":57,"ratio":0.982}`

## auctionhousedevon

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146343' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146343","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148008' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148008","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147819' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147819","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148081' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148081","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148064' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148064","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146117' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146117","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148151' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148151","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147709' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147709","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147916' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147916","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148020' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148020","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147843' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147843","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148074' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148074","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147874' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147874","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147889' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147889","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147853' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147853","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148039' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148039","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147970' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147970","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147959' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147959","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148003' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148003","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148082' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148082","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148012' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148012","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147917' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147917","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148097' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148097","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148076' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148076","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148303' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148303","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147918' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147918","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147903' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147903","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148059' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148059","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147710' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147710","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148053' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148053","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147974' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147974","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147814' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147814","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147898' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147898","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147919' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147919","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147812' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147812","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146108' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146108","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148030' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148030","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147992' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147992","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148037' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148037","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147332' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147332","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/148006' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/148006","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147868' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147868","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/147817' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/147817","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146334' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146334","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/southwest/auction/lot/146425' exists under 2 houses (auctionhousedevon, auctionhousesouthwest) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/southwest/auction/lot/146425","houses":["auctionhousedevon","auctionhousesouthwest"]}`
- **[info] bullet_starvation** — Bullet starvation: 64/66 (97%) lots have empty bullets
  - `{"empty":64,"total":66,"ratio":0.97}`

## auctionhouseeastanglia

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/eastanglia/auction/lot/147129' exists under 2 houses (auctionhouseeastanglia, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/eastanglia/auction/lot/147129","houses":["auctionhouseeastanglia","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/eastanglia/auction/lot/146488' exists under 2 houses (auctionhouseeastanglia, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/eastanglia/auction/lot/146488","houses":["auctionhouseeastanglia","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/eastanglia/auction/lot/146404' exists under 2 houses (auctionhouseeastanglia, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/eastanglia/auction/lot/146404","houses":["auctionhouseeastanglia","auctionhouseessex"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.auctionhouse.co.uk/eastanglia/auction/lot/145540' exists under 2 houses (auctionhouseeastanglia, auctionhouseessex) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.auctionhouse.co.uk/eastanglia/auction/lot/145540","houses":["auctionhouseeastanglia","auctionhouseessex"]}`
- **[info] bullet_starvation** — Bullet starvation: 106/116 (91%) lots have empty bullets
  - `{"empty":106,"total":116,"ratio":0.914}`

## auctionhouseeastmidlands

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://liveauctions.eigroup.co.uk/auction/gotoauction/roh' exists under 2 houses (auctionhouseeastmidlands, auctionhousewestmidlands) — detectAuctionHouse() may be misrouting
  - `{"url":"https://liveauctions.eigroup.co.uk/auction/gotoauction/roh","houses":["auctionhouseeastmidlands","auctionhousewestmidlands"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://bidding.eigpropertyauctions.co.uk/auction/auctioneer/20' exists under 2 houses (auctionhouseeastmidlands, auctionhousewestmidlands) — detectAuctionHouse() may be misrouting
  - `{"url":"https://bidding.eigpropertyauctions.co.uk/auction/auctioneer/20","houses":["auctionhouseeastmidlands","auctionhousewestmidlands"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://liveauctions.eigroup.co.uk/auction/gotoauction/bab' exists under 2 houses (auctionhouseeastmidlands, auctionhousewestmidlands) — detectAuctionHouse() may be misrouting
  - `{"url":"https://liveauctions.eigroup.co.uk/auction/gotoauction/bab","houses":["auctionhouseeastmidlands","auctionhousewestmidlands"]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[info] bullet_starvation** — Bullet starvation: 19/19 (100%) lots have empty bullets
  - `{"empty":19,"total":19,"ratio":1}`

## auctionhousekent

- **[info] bullet_starvation** — Bullet starvation: 64/74 (86%) lots have empty bullets
  - `{"empty":64,"total":74,"ratio":0.865}`

## auctionhouselincolnshire

- **[info] bullet_starvation** — Bullet starvation: 50/56 (89%) lots have empty bullets
  - `{"empty":50,"total":56,"ratio":0.893}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":28,"examples":[{"address":"sold prior to auction, for an undisclosed amount","count":14},{"address":"postponed","count":4},{"address":"sold prior for","count":6}]}`

## auctionhousenational

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/336811' exists under 2 houses (auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/336811","houses":["auctionhousenational","auctionhousewales"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://online.auctionhouse.co.uk/lot/redirect/335807' exists under 2 houses (auctionhousenational, auctionhousewales) — detectAuctionHouse() may be misrouting
  - `{"url":"https://online.auctionhouse.co.uk/lot/redirect/335807","houses":["auctionhousenational","auctionhousewales"]}`
- **[info] bullet_starvation** — Bullet starvation: 295/317 (93%) lots have empty bullets
  - `{"empty":295,"total":317,"ratio":0.931}`

## auctionhousenortheast

- **[info] bullet_starvation** — Bullet starvation: 56/65 (86%) lots have empty bullets
  - `{"empty":56,"total":65,"ratio":0.862}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":6,"examples":[{"address":"national online auction bidding now open! click to view lots","count":6}]}`

## auctionhousenorthwest

- **[info] bullet_starvation** — Bullet starvation: 131/131 (100%) lots have empty bullets
  - `{"empty":131,"total":131,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 122/131 (93%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":122,"total":131,"ratio":0.931}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at ladysbridge cottages, banff, banffshire ab45 2jr","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 88/108 (81%) lots have empty bullets
  - `{"empty":88,"total":108,"ratio":0.815}`
- **[info] image_domain_mismatch** — Image domain mismatch: 108/108 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":108,"total":108,"ratio":1}`

## auctionhousesouthwest

- **[info] bullet_starvation** — Bullet starvation: 58/63 (92%) lots have empty bullets
  - `{"empty":58,"total":63,"ratio":0.921}`

## auctionhousesouthyorkshire

- **[info] bullet_starvation** — Bullet starvation: 47/47 (100%) lots have empty bullets
  - `{"empty":47,"total":47,"ratio":1}`

## auctionhouseuklondon

- **[info] bullet_starvation** — Bullet starvation: 416/427 (97%) lots have empty bullets
  - `{"empty":416,"total":427,"ratio":0.974}`

## auctionhousewales

- **[info] bullet_starvation** — Bullet starvation: 57/76 (75%) lots have empty bullets
  - `{"empty":57,"total":76,"ratio":0.75}`

## auctionhousewestyorkshire

- **[info] bullet_starvation** — Bullet starvation: 54/55 (98%) lots have empty bullets
  - `{"empty":54,"total":55,"ratio":0.982}`
- **[info] image_domain_mismatch** — Image domain mismatch: 54/55 (98%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":54,"total":55,"ratio":0.982}`

## auctionnorth

- **[warn] identical_price_wall** — Identical-price wall: 4/5 (80%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":4,"total":5,"ratio":0.8}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"1 regents close, hayes, middlesex, ub4 8jy","count":3}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 31/31 (100%) lots have empty bullets
  - `{"empty":31,"total":31,"ratio":1}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":10,"examples":[{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":6},{"address":"fraser street, stoke on trent st6 2dp","count":4}]}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"for sale by auction29th april 2026","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 13/13 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":13,"total":13,"ratio":1}`

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
- **[info] bullet_starvation** — Bullet starvation: 301/302 (100%) lots have empty bullets
  - `{"empty":301,"total":302,"ratio":0.997}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## futureauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 211/214 (99%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":211,"total":214,"ratio":0.986}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 75 addresses appear ≥3 times each (403 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":75,"total_dupe_rows":403,"examples":[{"address":"one bedroom lower ground floor flat","count":3},{"address":"a four bedroom detached house","count":7},{"address":"three bedroom detached house","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 748/1117 (67%) lots share price £1500 — extractor likely picking up hero/banner price
  - `{"price":1500,"count":748,"total":1117,"ratio":0.67}`

## higginsdrysdale

- **[warn] identical_price_wall** — Identical-price wall: 24/39 (62%) lots share price £1900 — extractor likely picking up hero/banner price
  - `{"price":1900,"count":24,"total":39,"ratio":0.615}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"ashford market, kent","count":5},{"address":"ashford market, ashford, kent","count":4}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 9/9 (100%) lots have no price + no price_text
  - `{"tba":9,"total":9,"ratio":1}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 60 addresses appear ≥3 times each (224 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":60,"total_dupe_rows":224,"examples":[{"address":"whitehall road, whitehall, bs5 9bj","count":4},{"address":"anstey street, easton, bs5 6dg","count":3},{"address":"argyle street, gorse hill, sn2 8ar","count":3}]}`

## hunters

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/rose-cottage-moreleigh-road-harbertonford-totnes-devon-tq9-7ts-5545811' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/rose-cottage-moreleigh-road-harbertonford-totnes-devon-tq9-7ts-5545811","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/10-bank-lane-victoria-street-totnes-tq9-5eh-8257413' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/10-bank-lane-victoria-street-totnes-tq9-5eh-8257413","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/2001-acres-of-land-at-uppacott-moretonhampstead-4167774' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/2001-acres-of-land-at-uppacott-moretonhampstead-4167774","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/bridford-mills-gospel-hall-1270730' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/bridford-mills-gospel-hall-1270730","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/myrtle-cottage-eastdown-blackawton-totnes-devon-tq9-7ap-6668071' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/myrtle-cottage-eastdown-blackawton-totnes-devon-tq9-7ap-6668071","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/east-hill-bungalow-1847768' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/east-hill-bungalow-1847768","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/buckleys-harraton-9392784' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/buckleys-harraton-9392784","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/drayford-unit-30-quay-road-newton-abbot-tq12-2bu-4772894' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/drayford-unit-30-quay-road-newton-abbot-tq12-2bu-4772894","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://lacyscottandknight.bambooauctions.com/property/1-2-black-cottage-tye-lane-bramford-ipswich-suffolk-ip8-4la-2923673' exists under 2 houses (hunters, lsk) — detectAuctionHouse() may be misrouting
  - `{"url":"https://lacyscottandknight.bambooauctions.com/property/1-2-black-cottage-tye-lane-bramford-ipswich-suffolk-ip8-4la-2923673","houses":["hunters","lsk"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/the-old-chapel-yonder-street-ottery-st-mary-ex11-1hh-4841718' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/the-old-chapel-yonder-street-ottery-st-mary-ex11-1hh-4841718","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/eastacombe-chapel-tawstock-5832358' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/eastacombe-chapel-tawstock-5832358","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/lynwood-shaugh-prior-plymouth-devon-pl7-5hb-9664056' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/lynwood-shaugh-prior-plymouth-devon-pl7-5hb-9664056","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/land-adjoining-treeby-aish-tq10-9jh-8184032' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/land-adjoining-treeby-aish-tq10-9jh-8184032","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/detached-stone-built-chapel-5969200' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/detached-stone-built-chapel-5969200","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/land-lying-to-the-north-of-commons-hill-christow-exeter-ex6-7pg-4076144' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/land-lying-to-the-north-of-commons-hill-christow-exeter-ex6-7pg-4076144","houses":["hunters","rendells"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://rendells.bambooauctions.com/property/17-acres-of-agricultural-land-whiddon-down-okehampton-ex20-9968951' exists under 2 houses (hunters, rendells) — detectAuctionHouse() may be misrouting
  - `{"url":"https://rendells.bambooauctions.com/property/17-acres-of-agricultural-land-whiddon-down-okehampton-ex20-9968951","houses":["hunters","rendells"]}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (34 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":34,"examples":[{"address":"bolventor, launceston, cornwall pl15","count":4},{"address":"st. ive, liskeard, cornwall pl14","count":4},{"address":"woodacott, holsworthy, devon ex22","count":4}]}`

## landwood

- **[warn] image_coverage_low** — Image coverage low: 93/136 (68%) lots missing image_url
  - `{"missing":93,"total":136,"ratio":0.684}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 59/59 (100%) lots missing image_url
  - `{"missing":59,"total":59,"ratio":1}`

## lot9

- **[warn] identical_price_wall** — Identical-price wall: 12/16 (75%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":12,"total":16,"ratio":0.75}`

## luscombemaye

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://example.com/lot2' exists under 2 houses (luscombemaye, probateauction) — detectAuctionHouse() may be misrouting
  - `{"url":"https://example.com/lot2","houses":["luscombemaye","probateauction"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://example.com/lot1' exists under 2 houses (luscombemaye, probateauction) — detectAuctionHouse() may be misrouting
  - `{"url":"https://example.com/lot1","houses":["luscombemaye","probateauction"]}`
- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://example.com/lot3' exists under 2 houses (luscombemaye, probateauction) — detectAuctionHouse() may be misrouting
  - `{"url":"https://example.com/lot3","houses":["luscombemaye","probateauction"]}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"crai, brecon, powys, ld3 8ys","count":3},{"address":"foxglove close, stourport-on-severn, worcestershire, dy13 9bn","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 84/88 (95%) lots have empty bullets
  - `{"empty":84,"total":88,"ratio":0.955}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"3-5 station road, reading, berkshire, rg1 1ld","count":3},{"address":"3 bed semi-detached house","count":3},{"address":"richings way, iver , iver, buckinghamshire, sl0 9da","count":3}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 60 addresses appear ≥3 times each (205 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":60,"total_dupe_rows":205,"examples":[{"address":"51 high street, clydach, abertawe, swansea, sa6 5lh","count":3},{"address":"the rose & crown, 21-22 bethel street, neath, west glamorgan, sa11 2hq","count":4},{"address":"55 brynhyfryd terrace, ferndale, mid glamorgan, cf43 4la","count":3}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 52/53 (98%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":52,"total":53,"ratio":0.981}`

## philliparnold

- **[warn] image_coverage_low** — Image coverage low: 12/12 (100%) lots missing image_url
  - `{"missing":12,"total":12,"ratio":1}`

## propertyauctionagent

- **[info] bullet_starvation** — Bullet starvation: 7/8 (88%) lots have empty bullets
  - `{"empty":7,"total":8,"ratio":0.875}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"land at rowena street, bolton, lancashire bl3 2pw","count":3},{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":3},{"address":"35 springcliffe, bradford, west yorkshire bd8 8qp","count":3}]}`

## scargillmann

- **[error] cross_house_url_leak** — Cross-house URL leak: 'https://www.sdlauctions.co.uk/properties/' exists under 2 houses (scargillmann, sdl) — detectAuctionHouse() may be misrouting
  - `{"url":"https://www.sdlauctions.co.uk/properties/","houses":["scargillmann","sdl"]}`

## shonkibros

- **[info] bullet_starvation** — Bullet starvation: 31/31 (100%) lots have empty bullets
  - `{"empty":31,"total":31,"ratio":1}`

## strettons

- **[info] bullet_starvation** — Bullet starvation: 52/63 (83%) lots have empty bullets
  - `{"empty":52,"total":63,"ratio":0.825}`

## suttonkersh

- **[info] stale_lot_wall** — Stale lot wall: 23/34 (68%) lots are past auction date >7d but still marked available
  - `{"stale":23,"total":34,"ratio":0.676,"cutoff":"2026-04-30T07:38:07.397Z"}`

## symondsandsampson

- **[warn] town_only_addresses** — Town-only addresses: 13/13 (100%) lots have ≤2-word, no-comma addresses — extractor may be targeting branch/event cards
  - `{"town_only":13,"total":13,"ratio":1}`
- **[warn] identical_price_wall** — Identical-price wall: 13/13 (100%) lots share price £100000 — extractor likely picking up hero/banner price
  - `{"price":100000,"count":13,"total":13,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 13/13 (100%) lots missing image_url
  - `{"missing":13,"total":13,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 13/13 (100%) lots have empty bullets
  - `{"empty":13,"total":13,"ratio":1}`

## taylerandfletcher

- **[warn] town_only_addresses** — Town-only addresses: 7/8 (88%) lots have ≤2-word, no-comma addresses — extractor may be targeting branch/event cards
  - `{"town_only":7,"total":8,"ratio":0.875}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 7/8 (88%) lots have no price + no price_text
  - `{"tba":7,"total":8,"ratio":0.875}`
- **[warn] image_coverage_low** — Image coverage low: 7/8 (88%) lots missing image_url
  - `{"missing":7,"total":8,"ratio":0.875}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 157 addresses appear ≥3 times each (547 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":157,"total_dupe_rows":547,"examples":[{"address":"8 coedwig terrace, penmon, beaumaris, anglesey, ll58 8sl","count":4},{"address":"trem y dyffryn, llanbedr-y-cennin, conwy, gwynedd, ll32 8un","count":4},{"address":"8 llwyn onn, rhos on sea, colwyn bay, conwy, ll28 4bz","count":4}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":67,"examples":[{"address":"apt. 62 east float quay dock road, birkenhead, ch41 1dn","count":4},{"address":"unit 12 emirates house stopgate lane, walton, merseyside, l9 6an","count":3},{"address":"40a grange road, west kirby, merseyside, ch48 4ef","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 61/81 (75%) lots have empty bullets
  - `{"empty":61,"total":81,"ratio":0.753}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"wetherby, west yorkshire","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 14/14 (100%) lots share price £5000 — extractor likely picking up hero/banner price
  - `{"price":5000,"count":14,"total":14,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 8/14 (57%) lots missing image_url
  - `{"missing":8,"total":14,"ratio":0.571}`

## wilsons

- **[info] bullet_starvation** — Bullet starvation: 17/18 (94%) lots have empty bullets
  - `{"empty":17,"total":18,"ratio":0.944}`


