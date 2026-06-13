# Visual Audit — 2026-06-13

Scanned **20,278** rows in **14700ms** across **63** houses with findings.

**Findings:** 50 error · 11 warn · 24 info

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"beatrice street, ashington","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (41 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":41,"examples":[{"address":"land on the south side of oxford lane grove, wantage, oxfordshire, ox12 7ly","count":3},{"address":"7e, 7f, 9 & 9a high street, barnet, hertfordshire, en5 5ue","count":3},{"address":"a portfolio of eleven plots of land and roadways","count":5}]}`
- **[warn] identical_price_wall** — Identical-price wall: 110/189 (58%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":110,"total":189,"ratio":0.582}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"market lane, dunston, ne11","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 78/78 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":78,"total":78,"ratio":1}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 48/50 (96%) lots have empty bullets
  - `{"empty":48,"total":50,"ratio":0.96}`
- **[info] image_domain_mismatch** — Image domain mismatch: 49/50 (98%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":49,"total":50,"ratio":0.98}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":3}]}`

## auctionhousechesterfield

- **[info] image_domain_mismatch** — Image domain mismatch: 15/15 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":15,"total":15,"ratio":1}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":3}]}`

## auctionhousedevon

- **[info] image_domain_mismatch** — Image domain mismatch: 95/102 (93%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":95,"total":102,"ratio":0.931}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"rockys bar and restaurant, king george v playing field, chequers lane, papworth everard, cambridgeshire cb23 3qq","count":3},{"address":"39 stonegate, spalding, lincolnshire pe11 2ph","count":3},{"address":"103 gloucester street, norwich, norfolk nr2 2dy","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the railings, albemarle back road, scarborough, north yorkshire, yo11 1ya","count":3}]}`

## auctionhousekent

- **[info] bullet_starvation** — Bullet starvation: 59/77 (77%) lots have empty bullets
  - `{"empty":59,"total":77,"ratio":0.766}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 59 addresses appear ≥3 times each (182 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":59,"total_dupe_rows":182,"examples":[{"address":"7 secunda way, hempsted, gloucester, gloucestershire, gl2 5ga","count":3},{"address":"unit 6a-6b south middleton base, greenwell road, aberdeen, ab12 3ax","count":3},{"address":"flat 3 market place, evesham, worcestershire, wr11 4rw","count":3}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"flat 25, renaissance house, millbrook street, stockport, sk1 3tn","count":4},{"address":"apartment 12, box apartments, 1 marriott street, stockport, sk1 3pj","count":3},{"address":"flat 16, 32 nile street, sunderland, tyne and wear, sr1 1ey","count":3}]}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 9/13 (69%) lots missing image_url
  - `{"missing":9,"total":13,"ratio":0.692}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (46 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":46,"examples":[{"address":"2g union lane, ellon, aberdeenshire ab41 9ds","count":3},{"address":"plots 2 & 3 braidwood road, braidwood, carluke, lanarkshire ml8 5ny","count":3},{"address":"114 hilltown, dundee, angus dd3 7bg","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 153/201 (76%) lots have empty bullets
  - `{"empty":153,"total":201,"ratio":0.761}`
- **[info] image_domain_mismatch** — Image domain mismatch: 198/201 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":198,"total":201,"ratio":0.985}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 28 addresses appear ≥3 times each (84 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":28,"total_dupe_rows":84,"examples":[{"address":"82 harley road, harlesden, london, nw10 8ax","count":3},{"address":"land adjacent to 35 ockham drive, orpington, kent, br5 3dt","count":3},{"address":"land to the east of arthur street, crook, county durham, dl15 9du","count":3}]}`

## auctionhousewestyorkshire

- **[info] image_domain_mismatch** — Image domain mismatch: 55/58 (95%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":55,"total":58,"ratio":0.948}`

## auctionnorth

- **[warn] identical_price_wall** — Identical-price wall: 10/18 (56%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":10,"total":18,"ratio":0.556}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"1 regents close, hayes, middlesex, ub4 8jy","count":3},{"address":"flat 6, 192 church road, hove, bn3 2dj","count":3}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 32/33 (97%) lots have empty bullets
  - `{"empty":32,"total":33,"ratio":0.97}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"bushey, hertfordshire","count":3}]}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":13,"examples":[{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":6},{"address":"fraser street, stoke on trent st6 2dp","count":4},{"address":"lavender close, stoke-on-trent","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 40/76 (53%) lots missing image_url
  - `{"missing":40,"total":76,"ratio":0.526}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"for sale by auction29th april 2026","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 14/14 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":14,"total":14,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":35,"examples":[{"address":"bexhill-on-sea - east sussex","count":3},{"address":"freehold parcel of land","count":3},{"address":"newport - isle of wight","count":4}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 8/8 (100%) lots use host 'drivers.co.uk' — could be a logo/placeholder
  - `{"host":"drivers.co.uk","count":8,"total":8,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"meadow lane, disley, cheshire, sk12","count":3},{"address":"clough road, droylsden, greater manchester, m43","count":4},{"address":"zodiac drive, stoke on trent, staffordshire, st6","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 290/324 (90%) lots have empty bullets
  - `{"empty":290,"total":324,"ratio":0.895}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":38,"examples":[{"address":"4 stafford street, first floor flat, aberdeen","count":4},{"address":"old blairbeg, lamlash, isle of arran","count":3},{"address":"22 barfillan drive, flat 3-1, craigton","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 439/439 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":439,"total":439,"ratio":1}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"vole road, mark, highbridge, somerset, ta9","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":35,"examples":[{"address":"studio flat","count":4},{"address":"a spacious 3 double bedroom duplex apartment","count":3},{"address":"46 pleasant road, southend-on-sea, essex, ss1 2hj","count":4}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":10,"examples":[{"address":"ashford market, kent","count":7},{"address":"ashford market, ashford","count":3}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 44 addresses appear ≥3 times each (154 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":44,"total_dupe_rows":154,"examples":[{"address":"603, gloucester road, horfield, bristol, bs7 0bj","count":3},{"address":"567, gloucester road, horfield, bristol, bs7 0bw","count":3},{"address":"3, fountain buildings, bath, ba1 5du","count":10}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 15/16 (94%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":15,"total":16,"ratio":0.938}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"chesterfield","count":7}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'johnpye' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"johnpye"}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 79/110 (72%) lots have no price + no price_text
  - `{"tba":79,"total":110,"ratio":0.718}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":33,"examples":[{"address":"molinnis road, bugle, st. austell, cornwall pl26","count":4},{"address":"woodacott, holsworthy, devon ex22","count":4},{"address":"stratton road, bude, cornwall ex23","count":4}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"160 brewery road, london, se18 1nf","count":4},{"address":"21 strand-on-the-green, london, w4 3ph","count":3},{"address":"2 warren lane, dartington hall, totnes, devon, tq9 6eg","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 39/73 (53%) lots missing image_url
  - `{"missing":39,"total":73,"ratio":0.534}`

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

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":4},{"address":"ty cenin, dyffryn ardudwy, merionethshire, ll44 2dg","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 23/33 (70%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":23,"total":33,"ratio":0.697}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 19/24 (79%) lots have empty bullets
  - `{"empty":19,"total":24,"ratio":0.792}`

## markjenkinson

- **[info] bullet_starvation** — Bullet starvation: 313/367 (85%) lots have empty bullets
  - `{"empty":313,"total":367,"ratio":0.853}`

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

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"brayford wharf east, lincoln, lincolnshire, ln5 7bg","count":3},{"address":"breakspear road north, harefield, uxbridge, middlesex, ub9 6lz","count":3},{"address":"3-5 station road, reading, berkshire, rg1 1ld","count":3}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 65 addresses appear ≥3 times each (221 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":65,"total_dupe_rows":221,"examples":[{"address":"penrallt cottage, cenarth, newcastle emlyn, dyfed, sa38 9la","count":3},{"address":"31 commercial street, newport, gwent, np20 1hj","count":3},{"address":"land at coronation terrace, senghenydd, caerphilly, cf83 4hq","count":3}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 57/60 (95%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":57,"total":60,"ratio":0.95}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (51 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":51,"examples":[{"address":"unit 4a, carters square, uttoxeter, staffordshire st14 7fn","count":3},{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":4},{"address":"land between 39 & 41 the crescent, harlington, middlesex ub3 5na","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"land at holme park close, ince, lancashire wn3 4lz","count":3},{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":3},{"address":"35 springcliffe, bradford, west yorkshire bd8 8qp","count":3}]}`

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

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":47,"examples":[{"address":"12a byron studios, byron street bradford, bd3 0au","count":4},{"address":"flat 1, 1 griffe head road wyke, bradford, bd12 8qp","count":4},{"address":"439 - 441 thornton road bradford, bd13 3nn","count":4}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"not available","count":8}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the knot barn, 1 station road, padstow, cornwall, pl28 8db","count":3}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"123 example street, liverpool, l1 2ab","count":3}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the digby memorial church hall, digby road, sherborne, dorset dt9 3nl","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 9/9 (100%) lots share price £100000 — extractor likely picking up hero/banner price
  - `{"price":100000,"count":9,"total":9,"ratio":1}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 165 addresses appear ≥3 times each (581 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":165,"total_dupe_rows":581,"examples":[{"address":"31 ffordd gwilym, meliden, prestatyn, ll19 8le","count":6},{"address":"sypsies, butchers cross, mayfield, east sussex, tn20 6jn","count":3},{"address":"8 mountain view, menai bridge, gwynedd, ll59 5en","count":4}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"land rear of 8 brynawelon road, cwmllynfell, swansea, west glamorgan, sa9 2wg","count":3},{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (73 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":73,"examples":[{"address":"6 broadbelt street, liverpool, l4 5ql","count":3},{"address":"apartment 504 37 strand street, liverpool, l1 8nd","count":4},{"address":"95 alexandra road, crosby, merseyside, l23 7te","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 81/101 (80%) lots have empty bullets
  - `{"empty":81,"total":101,"ratio":0.802}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"wetherby, west yorkshire","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 37/38 (97%) lots have empty bullets
  - `{"empty":37,"total":38,"ratio":0.974}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/38 (97%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":37,"total":38,"ratio":0.974}`


