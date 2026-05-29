# Visual Audit — 2026-05-29

Scanned **17,279** rows in **11657ms** across **65** houses with findings.

**Findings:** 44 error · 10 warn · 33 info

## acuitus

- **[info] stale_lot_wall** — Stale lot wall: 37/64 (58%) lots are past auction date >7d but still marked available
  - `{"stale":37,"total":64,"ratio":0.578,"cutoff":"2026-05-22T08:36:53.100Z"}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"beatrice street, ashington","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (41 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":41,"examples":[{"address":"land and roadways at kennedy close, petts wood, orpington, kent, br5 1hp","count":3},{"address":"land on the south side of oxford lane grove, wantage, oxfordshire, ox12 7ly","count":3},{"address":"land at langney rise, eastbourne, east sussex, bn23 7nl","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 110/187 (59%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":110,"total":187,"ratio":0.588}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"market lane, dunston, ne11","count":3},{"address":"tuscan road, thorney close, sr3","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 78/78 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":78,"total":78,"ratio":1}`

## andrewgrant

- **[error] retired_slug_straggler** — Retired slug straggler: 'andrewgrant' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"andrewgrant"}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 48/49 (98%) lots have empty bullets
  - `{"empty":48,"total":49,"ratio":0.98}`
- **[info] image_domain_mismatch** — Image domain mismatch: 49/49 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":49,"total":49,"ratio":1}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":3}]}`

## auctionhousechesterfield

- **[info] image_domain_mismatch** — Image domain mismatch: 14/14 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":14,"total":14,"ratio":1}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"103 gloucester street, norwich, norfolk nr2 2dy","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhousekent

- **[info] bullet_starvation** — Bullet starvation: 63/79 (80%) lots have empty bullets
  - `{"empty":63,"total":79,"ratio":0.797}`

## auctionhouselincolnshire

- **[info] bullet_starvation** — Bullet starvation: 57/69 (83%) lots have empty bullets
  - `{"empty":57,"total":69,"ratio":0.826}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":14,"examples":[{"address":"withdrawn","count":4},{"address":"postponed","count":4},{"address":"sold prior for","count":6}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"apartment 12, box apartments, 1 marriott street, stockport, sk1 3pj","count":3},{"address":"flat 16, 32 nile street, sunderland, tyne and wear, sr1 1ey","count":3},{"address":"flat 25, renaissance house, millbrook street, stockport, sk1 3tn","count":4}]}`

## auctionhousenortheast

- **[info] bullet_starvation** — Bullet starvation: 55/65 (85%) lots have empty bullets
  - `{"empty":55,"total":65,"ratio":0.846}`

## auctionhousenorthwest

- **[info] bullet_starvation** — Bullet starvation: 113/149 (76%) lots have empty bullets
  - `{"empty":113,"total":149,"ratio":0.758}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (46 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":46,"examples":[{"address":"2 cnoc mhor, balvicar, oban, argyll pa34 4tg","count":3},{"address":"207 high street, cowdenbeath, fife ky4 9qf","count":3},{"address":"bruce hall, hall wynd, perth, errol ph2 7ql","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 132/181 (73%) lots have empty bullets
  - `{"empty":132,"total":181,"ratio":0.729}`
- **[info] image_domain_mismatch** — Image domain mismatch: 178/181 (98%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":178,"total":181,"ratio":0.983}`

## auctionhousesouthwest

- **[info] bullet_starvation** — Bullet starvation: 42/50 (84%) lots have empty bullets
  - `{"empty":42,"total":50,"ratio":0.84}`

## auctionhouseuklondon

- **[info] bullet_starvation** — Bullet starvation: 387/439 (88%) lots have empty bullets
  - `{"empty":387,"total":439,"ratio":0.882}`
- **[info] image_domain_mismatch** — Image domain mismatch: 409/439 (93%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":409,"total":439,"ratio":0.932}`

## auctionhousewales

- **[info] bullet_starvation** — Bullet starvation: 50/70 (71%) lots have empty bullets
  - `{"empty":50,"total":70,"ratio":0.714}`

## auctionhousewestyorkshire

- **[info] image_domain_mismatch** — Image domain mismatch: 55/58 (95%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":55,"total":58,"ratio":0.948}`

## auctionnorth

- **[warn] identical_price_wall** — Identical-price wall: 10/18 (56%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":10,"total":18,"ratio":0.556}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"flat 6, 192 church road, hove, bn3 2dj","count":3},{"address":"1 regents close, hayes, middlesex, ub4 8jy","count":3}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 32/32 (100%) lots have empty bullets
  - `{"empty":32,"total":32,"ratio":1}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"bushey, hertfordshire","count":3}]}`

## bondwolfe

- **[info] stale_lot_wall** — Stale lot wall: 8/8 (100%) lots are past auction date >7d but still marked available
  - `{"stale":8,"total":8,"ratio":1,"cutoff":"2026-05-22T08:36:53.100Z"}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":10,"examples":[{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":6},{"address":"fraser street, stoke on trent st6 2dp","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 37/73 (51%) lots missing image_url
  - `{"missing":37,"total":73,"ratio":0.507}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"for sale by auction29th april 2026","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 14/14 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":14,"total":14,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":35,"examples":[{"address":"penzance - cornwall","count":3},{"address":"ventnor - isle of wight","count":3},{"address":"dover - kent","count":5}]}`

## dawsons

- **[warn] image_coverage_low** — Image coverage low: 9/15 (60%) lots missing image_url
  - `{"missing":9,"total":15,"ratio":0.6}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 8/8 (100%) lots use host 'drivers.co.uk' — could be a logo/placeholder
  - `{"host":"drivers.co.uk","count":8,"total":8,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"clough road, droylsden, greater manchester, m43","count":4},{"address":"meadow lane, disley, cheshire, sk12","count":3},{"address":"zodiac drive, stoke on trent, staffordshire, st6","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 293/321 (91%) lots have empty bullets
  - `{"empty":293,"total":321,"ratio":0.913}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## foxgrant

- **[info] image_domain_mismatch** — Image domain mismatch: 5/5 (100%) lots use host 'example.com' — could be a logo/placeholder
  - `{"host":"example.com","count":5,"total":5,"ratio":1}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":35,"examples":[{"address":"old blairbeg, lamlash, isle of arran","count":3},{"address":"95 catto drive (gff, store and garden), peterhead","count":3},{"address":"565 great western road, first floor, aberdeen","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 401/401 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":401,"total":401,"ratio":1}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"vole road, mark, highbridge, somerset, ta9","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":35,"examples":[{"address":"gff 17 quadrant road, thornton heath, surrey, cr7 7db","count":3},{"address":"a split level two bedroom maisonette with glorious sea views over poole harbour","count":3},{"address":"a spacious 3 double bedroom duplex apartment","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":12,"examples":[{"address":"ashford market, kent","count":7},{"address":"ashford market, ashford, kent","count":5}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":31,"examples":[{"address":"bell hill, stapleton, bs16 1bq","count":3},{"address":"3, fountain buildings, bath, ba1 5du","count":5},{"address":"osborne villas, kingsdown, bs2 8bp","count":11}]}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 15/15 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":15,"total":15,"ratio":1}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"chesterfield","count":7}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 79/110 (72%) lots have no price + no price_text
  - `{"tba":79,"total":110,"ratio":0.718}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":33,"examples":[{"address":"bolventor, launceston, cornwall pl15","count":4},{"address":"woodacott, holsworthy, devon ex22","count":4},{"address":"victoria road, camelford, cornwall pl32","count":3}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"160 brewery road, london, se18 1nf","count":4},{"address":"land at great treadam farm, abergavenny, monmouthshire, np7 8ta","count":4}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"apartment 1604 viadux, 42 great bridgewater street, manchester, lancashire, m1 5lj","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 93/151 (62%) lots missing image_url
  - `{"missing":93,"total":151,"ratio":0.616}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 59/59 (100%) lots missing image_url
  - `{"missing":59,"total":59,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":5},{"address":"ty cenin, dyffryn ardudwy, merionethshire, ll44 2dg","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 18/33 (55%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":18,"total":33,"ratio":0.545}`

## markjenkinson

- **[info] bullet_starvation** — Bullet starvation: 269/323 (83%) lots have empty bullets
  - `{"empty":269,"total":323,"ratio":0.833}`
- **[info] image_domain_mismatch** — Image domain mismatch: 303/323 (94%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":303,"total":323,"ratio":0.938}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"foxglove close, stourport-on-severn, worcestershire, dy13 9bn","count":4},{"address":"crai, brecon, powys, ld3 8ys","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 84/95 (88%) lots have empty bullets
  - `{"empty":84,"total":95,"ratio":0.884}`

## network

- **[error] retired_slug_straggler** — Retired slug straggler: 'network' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"network"}`
- **[info] image_domain_mismatch** — Image domain mismatch: 206/206 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":206,"total":206,"ratio":1}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"3-5 station road, reading, berkshire, rg1 1ld","count":3},{"address":"breakspear road north, harefield, uxbridge, ub9 6lz","count":3},{"address":"3 bed semi-detached house","count":3}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 60 addresses appear ≥3 times each (205 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":60,"total_dupe_rows":205,"examples":[{"address":"51 high street, clydach, abertawe, swansea, sa6 5lh","count":3},{"address":"156 bute street, treherbert, treorchy, cf42 5pe","count":3},{"address":"the rose & crown, 21-22 bethel street, neath, west glamorgan, sa11 2hq","count":4}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 57/60 (95%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":57,"total":60,"ratio":0.95}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"35 springcliffe, bradford, west yorkshire bd8 8qp","count":3},{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat 4 laidlaw house, 15 medawar drive, london, nw7 1ss","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":8}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"456 elm street, manchester, m1 2ab","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":31,"examples":[{"address":"flat 1, 1 griffe head road wyke, bradford, bd12 8qp","count":3},{"address":"6, bordale avenue manchester, m9 4lq","count":3},{"address":"317 collonnade sunbridge road bradford, bd1 2hq","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"not available","count":8}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the digby memorial church hall, digby road, sherborne, dorset dt9 3nl","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 9/9 (100%) lots share price £100000 — extractor likely picking up hero/banner price
  - `{"price":100000,"count":9,"total":9,"ratio":1}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 165 addresses appear ≥3 times each (580 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":165,"total_dupe_rows":580,"examples":[{"address":"420 city point, great homer street, liverpool, liverpool, l5 3le","count":3},{"address":"9 park street, shifnal, shropshire, tf11 9ba","count":5},{"address":"359a bensham lane, thornton heath, surrey, cr7 7er","count":3}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":3},{"address":"land rear of 8 brynawelon road, cwmllynfell, swansea, west glamorgan, sa9 2wg","count":3}]}`

## twgaze

- **[error] retired_slug_straggler** — Retired slug straggler: 'twgaze' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"twgaze"}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":67,"examples":[{"address":"apartment 504 37 strand street, liverpool, l1 8nd","count":3},{"address":"apartment 5 11 sir thomas street, liverpool, l1 6bw","count":3},{"address":"apartment 4, 10b moss street, liverpool, l6 1hd","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 61/81 (75%) lots have empty bullets
  - `{"empty":61,"total":81,"ratio":0.753}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"wetherby, west yorkshire","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 37/37 (100%) lots have empty bullets
  - `{"empty":37,"total":37,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/37 (100%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":37,"total":37,"ratio":1}`


