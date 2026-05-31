# Visual Audit — 2026-05-31

Scanned **17,612** rows in **12541ms** across **66** houses with findings.

**Findings:** 46 error · 9 warn · 33 info

## acuitus

- **[info] stale_lot_wall** — Stale lot wall: 37/64 (58%) lots are past auction date >7d but still marked available
  - `{"stale":37,"total":64,"ratio":0.578,"cutoff":"2026-05-24T08:08:51.731Z"}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"beatrice street, ashington","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (41 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":41,"examples":[{"address":"land and roadways at kennedy close, petts wood, orpington, kent, br5 1hp","count":3},{"address":"land on the south side of oxford lane grove, wantage, oxfordshire, ox12 7ly","count":3},{"address":"land at langney rise, eastbourne, east sussex, bn23 7nl","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 110/187 (59%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":110,"total":187,"ratio":0.588}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"market lane, dunston, ne11","count":3}]}`
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

- **[info] image_domain_mismatch** — Image domain mismatch: 15/15 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":15,"total":15,"ratio":1}`

## auctionhousedevon

- **[info] bullet_starvation** — Bullet starvation: 37/44 (84%) lots have empty bullets
  - `{"empty":37,"total":44,"ratio":0.841}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"103 gloucester street, norwich, norfolk nr2 2dy","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhousekent

- **[info] bullet_starvation** — Bullet starvation: 59/78 (76%) lots have empty bullets
  - `{"empty":59,"total":78,"ratio":0.756}`

## auctionhouselincolnshire

- **[info] bullet_starvation** — Bullet starvation: 54/66 (82%) lots have empty bullets
  - `{"empty":54,"total":66,"ratio":0.818}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":14,"examples":[{"address":"withdrawn","count":4},{"address":"postponed","count":4},{"address":"sold prior for","count":6}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"apartment 12, box apartments, 1 marriott street, stockport, sk1 3pj","count":3},{"address":"flat 25, renaissance house, millbrook street, stockport, sk1 3tn","count":4},{"address":"flat 16, 32 nile street, sunderland, tyne and wear, sr1 1ey","count":3}]}`

## auctionhousenortheast

- **[info] bullet_starvation** — Bullet starvation: 55/65 (85%) lots have empty bullets
  - `{"empty":55,"total":65,"ratio":0.846}`

## auctionhousenorthwest

- **[info] bullet_starvation** — Bullet starvation: 113/149 (76%) lots have empty bullets
  - `{"empty":113,"total":149,"ratio":0.758}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (46 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":46,"examples":[{"address":"2g union lane, ellon, aberdeenshire ab41 9ds","count":3},{"address":"plots 2 & 3 braidwood road, braidwood, carluke, lanarkshire ml8 5ny","count":3},{"address":"114 hilltown, dundee, angus dd3 7bg","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 153/202 (76%) lots have empty bullets
  - `{"empty":153,"total":202,"ratio":0.757}`
- **[info] image_domain_mismatch** — Image domain mismatch: 198/202 (98%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":198,"total":202,"ratio":0.98}`

## auctionhousesouthwest

- **[info] bullet_starvation** — Bullet starvation: 96/104 (92%) lots have empty bullets
  - `{"empty":96,"total":104,"ratio":0.923}`

## auctionhouseuklondon

- **[info] bullet_starvation** — Bullet starvation: 394/446 (88%) lots have empty bullets
  - `{"empty":394,"total":446,"ratio":0.883}`
- **[info] image_domain_mismatch** — Image domain mismatch: 413/446 (93%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":413,"total":446,"ratio":0.926}`

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
  - `{"stale":8,"total":8,"ratio":1,"cutoff":"2026-05-24T08:08:51.731Z"}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":10,"examples":[{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":6},{"address":"fraser street, stoke on trent st6 2dp","count":4}]}`

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
- **[info] bullet_starvation** — Bullet starvation: 290/323 (90%) lots have empty bullets
  - `{"empty":290,"total":323,"ratio":0.898}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":38,"examples":[{"address":"old blairbeg, lamlash, isle of arran","count":3},{"address":"95 catto drive (gff, store and garden), peterhead","count":3},{"address":"caledonia house, longford avenue, kilwinning","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 422/422 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":422,"total":422,"ratio":1}`

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
  - `{"unique_dupes":7,"total_dupe_rows":31,"examples":[{"address":"bell hill, stapleton, bs16 1bq","count":3},{"address":"osborne villas, kingsdown, bs2 8bp","count":11},{"address":"3, fountain buildings, bath, ba1 5du","count":5}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 15/15 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":15,"total":15,"ratio":1}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"chesterfield","count":7}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'johnpye' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"johnpye"}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 79/110 (72%) lots have no price + no price_text
  - `{"tba":79,"total":110,"ratio":0.718}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":33,"examples":[{"address":"bolventor, launceston, cornwall pl15","count":4},{"address":"woodacott, holsworthy, devon ex22","count":4},{"address":"victoria road, camelford, cornwall pl32","count":3}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"160 brewery road, london, se18 1nf","count":3}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"apartment 1604 viadux, 42 great bridgewater street, manchester, lancashire, m1 5lj","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 93/160 (58%) lots missing image_url
  - `{"missing":93,"total":160,"ratio":0.581}`

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

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 19/24 (79%) lots have empty bullets
  - `{"empty":19,"total":24,"ratio":0.792}`

## markjenkinson

- **[info] bullet_starvation** — Bullet starvation: 268/323 (83%) lots have empty bullets
  - `{"empty":268,"total":323,"ratio":0.83}`
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

- **[error] duplicate_address_wall** — Duplicate-address wall: 66 addresses appear ≥3 times each (224 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":66,"total_dupe_rows":224,"examples":[{"address":"51 high street, clydach, abertawe, swansea, sa6 5lh","count":3},{"address":"shop at 45 hyde road, paignton, devon, tq4 5bp","count":3},{"address":"156 bute street, treherbert, treorchy, cf42 5pe","count":3}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 57/60 (95%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":57,"total":60,"ratio":0.95}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":3},{"address":"land off cog lane / fielden street, burnley, lancashire bb11 5ar","count":3},{"address":"35 springcliffe, bradford, west yorkshire bd8 8qp","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat 4 laidlaw house, 15 medawar drive, london, nw7 1ss","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":8}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"123 example street, london, e1 1aa","count":3},{"address":"456 elm street, manchester, m1 2ab","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"49 byron halls, byron street, bradford, bd3 0ar","count":4}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"not available","count":8}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the knot barn, 1 station road, padstow, cornwall, pl28 8db","count":3}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the digby memorial church hall, digby road, sherborne, dorset dt9 3nl","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 9/9 (100%) lots share price £100000 — extractor likely picking up hero/banner price
  - `{"price":100000,"count":9,"total":9,"ratio":1}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 165 addresses appear ≥3 times each (581 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":165,"total_dupe_rows":581,"examples":[{"address":"420 city point, great homer street, liverpool, liverpool, l5 3le","count":3},{"address":"9 park street, shifnal, shropshire, tf11 9ba","count":5},{"address":"359a bensham lane, thornton heath, surrey, cr7 7er","count":3}]}`

## twgaze

- **[error] retired_slug_straggler** — Retired slug straggler: 'twgaze' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"twgaze"}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":67,"examples":[{"address":"6 broadbelt street, liverpool, l4 5ql","count":3},{"address":"apartment 504 37 strand street, liverpool, l1 8nd","count":3},{"address":"apartment 5 11 sir thomas street, liverpool, l1 6bw","count":3}]}`
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


