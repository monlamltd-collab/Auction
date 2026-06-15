# Visual Audit — 2026-06-15

Scanned **25,399** rows in **15377ms** across **75** houses with findings.

**Findings:** 64 error · 13 warn · 21 info

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"beatrice street, ashington","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (57 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":57,"examples":[{"address":"a portfolio of eleven plots of land and roadways","count":5},{"address":"land on the south side of oxford lane grove, wantage, oxfordshire, ox12 7ly","count":3},{"address":"land adjacent to 2-8 exmoor rise, ashford, kent, tn24 8qr","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 119/198 (60%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":119,"total":198,"ratio":0.601}`

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

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":3}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":28,"examples":[{"address":"67 moresby parks road, moresby parks, whitehaven, cumbria ca28 8xd","count":3},{"address":"24 beech street, barrow-in-furness, cumbria la14 5eb","count":3},{"address":"flat 1, jubilee apartments, kendal, cumbria la9 4lr","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"rockys bar and restaurant, king george v playing field, chequers lane, papworth everard, cambridgeshire cb23 3qq","count":3},{"address":"103 gloucester street, norwich, norfolk nr2 2dy","count":4}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 18/19 (95%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":18,"total":19,"ratio":0.947}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the railings, albemarle back road, scarborough, north yorkshire, yo11 1ya","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (43 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":43,"examples":[{"address":"flat 3 griffin works, accrington, lancashire, bb5 2hr","count":3},{"address":"flat 1 & flat 2 griffin works, accrington, lancashire, bb5 2hr","count":3},{"address":"17 bairstow street, blackpool, lancashire, fy1 5bn","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 775/959 (81%) lots have no price + no price_text
  - `{"tba":775,"total":959,"ratio":0.808}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 59 addresses appear ≥3 times each (193 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":59,"total_dupe_rows":193,"examples":[{"address":"103 church street, broadstairs, kent, ct10 2tx","count":3},{"address":"unit 6a-6b south middleton base, greenwell road, aberdeen, ab12 3ax","count":3},{"address":"45 cundalls road, ware, hertfordshire, sg12 7dh","count":4}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"flat 25, renaissance house, millbrook street, stockport, sk1 3tn","count":4},{"address":"apartment 12, box apartments, 1 marriott street, stockport, sk1 3pj","count":3},{"address":"flat 16, 32 nile street, sunderland, tyne and wear, sr1 1ey","count":3}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"10 the leys, roade, northampton, northamptonshire nn7 2nr","count":3},{"address":"8 oak close, hartwell, northampton, northamptonshire nn7 2jx","count":3}]}`

## auctionhousenortheast

- **[warn] guide_tba_wall** — Guide-TBA wall: 317/450 (70%) lots have no price + no price_text
  - `{"tba":317,"total":450,"ratio":0.704}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 9/13 (69%) lots missing image_url
  - `{"missing":9,"total":13,"ratio":0.692}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"88 sherbourne road, blackpool, lancashire fy1 2pq","count":3},{"address":"apartment 305, the litmus building, 195 huntingdon street, nottingham, nottinghamshire ng1 3nt","count":3},{"address":"apartment 6, fearnley mill drive, huddersfield, west yorkshire hd5 0rd","count":3}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 31 addresses appear ≥3 times each (106 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":31,"total_dupe_rows":106,"examples":[{"address":"2g union lane, ellon, aberdeenshire ab41 9ds","count":3},{"address":"plots 2 & 3 braidwood road, braidwood, carluke, lanarkshire ml8 5ny","count":4},{"address":"114 hilltown, dundee, angus dd3 7bg","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 256/260 (98%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":256,"total":260,"ratio":0.985}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":47,"examples":[{"address":"plots 51 and 52, land denby line, garden lane, doncaster, south yorkshire, dn5 7sn","count":4},{"address":"31 co-operative street goldthorpe, rotherham, south yorkshire, s63 9hn","count":3},{"address":"plot 8 land adjoining armetriding reaches, chorley, lancashire, pr7 6gy","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1467/1582 (93%) lots have no price + no price_text
  - `{"tba":1467,"total":1582,"ratio":0.927}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"93 broadway east, redcar, north yorkshire ts10 5dt","count":4},{"address":"100l westgate, guisborough, north yorkshire ts14 6ap","count":3}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 28 addresses appear ≥3 times each (84 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":28,"total_dupe_rows":84,"examples":[{"address":"10 town hall street, grimsby, north east lincolnshire, dn31 1hn","count":3},{"address":"82 harley road, harlesden, london, nw10 8ax","count":3},{"address":"flat 26 columbus house, the compass, southampton, hampshire, so14 5bq","count":3}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"1 regents close, hayes, middlesex, ub4 8jy","count":3},{"address":"flat 3, 40 tivoli crescent, brighton, bn1 5nd","count":3},{"address":"flat 6, 192 church road, hove, bn3 2dj","count":4}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 32/33 (97%) lots have empty bullets
  - `{"empty":32,"total":33,"ratio":0.97}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"bushey, hertfordshire","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"birkby lodge road, huddersfield","count":3}]}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":13,"examples":[{"address":"lavender close, stoke-on-trent","count":3},{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":6},{"address":"fraser street, stoke on trent st6 2dp","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 44/86 (51%) lots missing image_url
  - `{"missing":44,"total":86,"ratio":0.512}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"for sale by auction29th april 2026","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 14/14 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":14,"total":14,"ratio":1}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"carlton terrace, swansea, city and county of swansea.","count":3}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":35,"examples":[{"address":"bexhill-on-sea - east sussex","count":3},{"address":"maidstone - kent","count":3},{"address":"freehold parcel of land","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"11 chywoone place, newlyn, penzance, cornwall, tr18 5nw","count":3},{"address":"1 cheltenham place, newquay, cornwall, tr7 1ba","count":3}]}`

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

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"mote cottage, london road, wrotham, sevenoaks, kent, tn15 7rr","count":3},{"address":"36-37 the strand, ryde, isle of wight, po33 1jf","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":38,"examples":[{"address":"caledonia house, longford avenue, kilwinning","count":3},{"address":"5 espedair street, flat 0-2, paisley","count":3},{"address":"4 stafford street, first floor flat, aberdeen","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 439/439 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":439,"total":439,"ratio":1}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"haybridge, wells, somerset, ba5","count":3},{"address":"vole road, mark, highbridge, somerset, ta9","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":35,"examples":[{"address":"studio flat","count":4},{"address":"a spacious 3 double bedroom duplex apartment","count":3},{"address":"46 pleasant road, southend-on-sea, essex, ss1 2hj","count":4}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3 st. johns road, burnley, lancashire, bb12 6rp","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":10,"examples":[{"address":"ashford market, kent","count":7},{"address":"ashford market, ashford","count":3}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 44 addresses appear ≥3 times each (154 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":44,"total_dupe_rows":154,"examples":[{"address":"baldwin street, city centre, bs1 1ru","count":3},{"address":"3, fountain buildings, bath, ba1 5du","count":10},{"address":"baroda, the avenue, combe down, bath, ba2 5eq","count":3}]}`

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

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":42,"examples":[{"address":"venn green, milton damerel, ex22","count":3},{"address":"kestle, tregadillett, pl15","count":3},{"address":"molinnis road, bugle, st. austell, cornwall pl26","count":4}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"160 brewery road, london, se18 1nf","count":4},{"address":"21 strand-on-the-green, london, w4 3ph","count":3},{"address":"2 warren lane, dartington hall, totnes, devon, tq9 6eg","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 42/76 (55%) lots missing image_url
  - `{"missing":42,"total":76,"ratio":0.553}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"14 hesslewell court, wirral, merseyside, ch60 7tw","count":3},{"address":"apartment 5, 191 water street, manchester, lancashire, m3 4ja","count":3},{"address":"apartment 2 trevithick, 113-127 windsor road, slough, buckinghamshire, sl1 2jn","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 93/171 (54%) lots missing image_url
  - `{"missing":93,"total":171,"ratio":0.544}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 59/59 (100%) lots missing image_url
  - `{"missing":59,"total":59,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"ty cenin, dyffryn ardudwy, merionethshire, ll44 2dg","count":3},{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 22/33 (67%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":22,"total":33,"ratio":0.667}`

## loveitts

- **[info] bullet_starvation** — Bullet starvation: 38/50 (76%) lots have empty bullets
  - `{"empty":38,"total":50,"ratio":0.76}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 19/24 (79%) lots have empty bullets
  - `{"empty":19,"total":24,"ratio":0.792}`

## maggsandallen

- **[warn] image_coverage_low** — Image coverage low: 52/77 (68%) lots missing image_url
  - `{"missing":52,"total":77,"ratio":0.675}`

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
- **[info] image_domain_mismatch** — Image domain mismatch: 191/191 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":191,"total":191,"ratio":1}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"2 bed semi-detached house","count":3},{"address":"brayford wharf east, lincoln, lincolnshire, ln5 7bg","count":3},{"address":"breakspear road north, harefield, uxbridge, middlesex, ub9 6lz","count":3}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 65 addresses appear ≥3 times each (221 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":65,"total_dupe_rows":221,"examples":[{"address":"17-18 bridge street, troedyrhiw, merthyr tydfil, mid glamorgan, cf48 4dt","count":3},{"address":"17 nott square, carmarthen, sa31 1pq","count":5},{"address":"21 bridge street, maesteg, mid glamorgan, cf34 9lj","count":3}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 64/67 (96%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":64,"total":67,"ratio":0.955}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (51 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":51,"examples":[{"address":"unit 4a, carters square, uttoxeter, staffordshire st14 7fn","count":3},{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":4},{"address":"land between 39 & 41 the crescent, harlington, middlesex ub3 5na","count":3}]}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"westbeach, westward ho, bideford, devon, ex39 1lq","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"land at holme park close, ince, lancashire wn3 4lz","count":3},{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":3},{"address":"35 springcliffe, bradford, west yorkshire bd8 8qp","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat 4 laidlaw house, 15 medawar drive, london, nw7 1ss","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":8}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"43 edgmond court, sunderland, tyne and wear, sr2 0dx","count":3}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"456 elm street, manchester, m1 2ab","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (74 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":74,"examples":[{"address":"634, great horton road bradford, bd7 4aa","count":5},{"address":"14, grantham place bradford, bd7 1rj","count":3},{"address":"6, bordale avenue manchester, m9 4lq","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"not available","count":8}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"51 margravine road, london, w6 8ll","count":3},{"address":"the knot barn, 1 station road, padstow, cornwall, pl28 8db","count":4}]}`

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
  - `{"unique_dupes":165,"total_dupe_rows":581,"examples":[{"address":"16 redworth road, shildon, durham, dl4 2je","count":5},{"address":"room 135 main house montgomery house, demesne road, manchester, manchester, m16 8ph","count":3},{"address":"31 ffordd gwilym, meliden, prestatyn, ll19 8le","count":6}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"land rear of 8 brynawelon road, cwmllynfell, swansea, west glamorgan, sa9 2wg","count":3},{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (79 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":79,"examples":[{"address":"6 broadbelt street, liverpool, l4 5ql","count":3},{"address":"apartment 5 11 sir thomas street, liverpool, l1 6bw","count":5},{"address":"6 woodend, pensby, ch61 8ru","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 101/121 (83%) lots have empty bullets
  - `{"empty":101,"total":121,"ratio":0.835}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"wetherby, west yorkshire","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 37/38 (97%) lots have empty bullets
  - `{"empty":37,"total":38,"ratio":0.974}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/38 (97%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":37,"total":38,"ratio":0.974}`


