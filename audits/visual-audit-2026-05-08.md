# Visual Audit — 2026-05-08

Scanned **13,235** rows in **7689ms** across **56** houses with findings.

**Findings:** 25 error · 18 warn · 40 info

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

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"6 enfield road, blackpool, lancashire, fy1 2rb","count":3},{"address":"national online auction bidding now open! click to view lots","count":3}]}`

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

- **[info] bullet_starvation** — Bullet starvation: 13/14 (93%) lots have empty bullets
  - `{"empty":13,"total":14,"ratio":0.929}`
- **[info] image_domain_mismatch** — Image domain mismatch: 13/14 (93%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":13,"total":14,"ratio":0.929}`

## auctionhouseeastanglia

- **[info] bullet_starvation** — Bullet starvation: 87/97 (90%) lots have empty bullets
  - `{"empty":87,"total":97,"ratio":0.897}`
- **[info] image_domain_mismatch** — Image domain mismatch: 96/97 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":96,"total":97,"ratio":0.99}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[info] bullet_starvation** — Bullet starvation: 15/15 (100%) lots have empty bullets
  - `{"empty":15,"total":15,"ratio":1}`

## auctionhousekent

- **[info] bullet_starvation** — Bullet starvation: 64/74 (86%) lots have empty bullets
  - `{"empty":64,"total":74,"ratio":0.865}`

## auctionhouselincolnshire

- **[info] bullet_starvation** — Bullet starvation: 12/13 (92%) lots have empty bullets
  - `{"empty":12,"total":13,"ratio":0.923}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":28,"examples":[{"address":"sold prior to auction, for an undisclosed amount","count":14},{"address":"postponed","count":4},{"address":"sold prior for","count":6}]}`

## auctionhousenortheast

- **[info] bullet_starvation** — Bullet starvation: 33/37 (89%) lots have empty bullets
  - `{"empty":33,"total":37,"ratio":0.892}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"national online auction bidding now open! click to view lots","count":3}]}`

## auctionhousenorthwest

- **[info] bullet_starvation** — Bullet starvation: 123/123 (100%) lots have empty bullets
  - `{"empty":123,"total":123,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 122/123 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":122,"total":123,"ratio":0.992}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at ladysbridge cottages, banff, banffshire ab45 2jr","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 88/108 (81%) lots have empty bullets
  - `{"empty":88,"total":108,"ratio":0.815}`
- **[info] image_domain_mismatch** — Image domain mismatch: 108/108 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":108,"total":108,"ratio":1}`

## auctionhousesouthwest

- **[info] bullet_starvation** — Bullet starvation: 38/42 (90%) lots have empty bullets
  - `{"empty":38,"total":42,"ratio":0.905}`
- **[info] image_domain_mismatch** — Image domain mismatch: 42/42 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":42,"total":42,"ratio":1}`

## auctionhouseuklondon

- **[info] bullet_starvation** — Bullet starvation: 383/393 (97%) lots have empty bullets
  - `{"empty":383,"total":393,"ratio":0.975}`
- **[info] image_domain_mismatch** — Image domain mismatch: 382/393 (97%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":382,"total":393,"ratio":0.972}`

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
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 8/8 (100%) lots use host 'drivers.co.uk' — could be a logo/placeholder
  - `{"host":"drivers.co.uk","count":8,"total":8,"ratio":1}`

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

## shonkibros

- **[info] bullet_starvation** — Bullet starvation: 31/31 (100%) lots have empty bullets
  - `{"empty":31,"total":31,"ratio":1}`

## strettons

- **[info] bullet_starvation** — Bullet starvation: 52/63 (83%) lots have empty bullets
  - `{"empty":52,"total":63,"ratio":0.825}`

## suttonkersh

- **[info] stale_lot_wall** — Stale lot wall: 23/34 (68%) lots are past auction date >7d but still marked available
  - `{"stale":23,"total":34,"ratio":0.676,"cutoff":"2026-05-01T06:28:40.368Z"}`

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

- **[error] duplicate_address_wall** — Duplicate-address wall: 156 addresses appear ≥3 times each (544 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":156,"total_dupe_rows":544,"examples":[{"address":"8 coedwig terrace, penmon, beaumaris, anglesey, ll58 8sl","count":4},{"address":"trem y dyffryn, llanbedr-y-cennin, conwy, gwynedd, ll32 8un","count":4},{"address":"8 llwyn onn, rhos on sea, colwyn bay, conwy, ll28 4bz","count":4}]}`

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


