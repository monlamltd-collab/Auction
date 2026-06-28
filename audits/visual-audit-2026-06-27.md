# Visual Audit — 2026-06-27

Scanned **26,380** rows in **19143ms** across **124** houses with findings.

**Findings:** 121 error · 19 warn · 26 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"littleham road, exmouth, ex8 2qg","count":3},{"address":"the close, seaton, ex12 2rl","count":3}]}`

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"unit 2a dundas close, portsmouth, hampshire, po3 5rb","count":3},{"address":"157a kew road, richmond upon thames, london, tw9 2pn","count":3},{"address":"broad lane house, 1 to 3 broad lane, coventry, west midlands, cv5 7aa","count":3}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"maple street, ashington","count":3},{"address":"land - building plot, the old station house, skelton, skelton-in-cleveland","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (49 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":49,"examples":[{"address":"plot 7 and roadways adjoining the hartings, bognor regis, west sussex, po22 6qf","count":3},{"address":"land and roadways at kennedy close, petts wood, orpington, kent, br5 1hp","count":4},{"address":"land at rylands road, underwood close & belmont road, kennington, ashford, kent, tn24 9lr","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 109/193 (56%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":109,"total":193,"ratio":0.565}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 90 addresses appear ≥3 times each (270 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":90,"total_dupe_rows":270,"examples":[{"address":"claire court, peckham, london, se15 4hf","count":3},{"address":"teesside","count":3},{"address":"taunton","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":33,"examples":[{"address":"hedworth lane, boldon colliery, ne35","count":4},{"address":"hopkins walk, south shields, ne34","count":3},{"address":"dryden road, low fell, ne9","count":5}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 85/85 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":85,"total":85,"ratio":1}`

## auctionestates

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"14-18 graham street, airdrie, lanarkshire, ml6 6bu","count":4},{"address":"42 forest road west, nottingham, ng7 4eq","count":3}]}`

## auctionhammermidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"lot tbcsold after   14 mere rise, copmere end, stafford, staffordshire st21 6hhguide price £98,000+ plus feessold aftersemi-detached bungalow     1      1      1","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 40/40 (100%) lots have empty bullets
  - `{"empty":40,"total":40,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 40/40 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":40,"total":40,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":31,"examples":[{"address":"35 orient court gresley close, telford, shropshire, tf7 5tu","count":3},{"address":"9 charles cotton street, stafford, staffordshire, st16 1pj","count":3},{"address":"plot 78 land fronting high street, boston spa, wetherby, west yorkshire, ls23 6sy","count":3}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"flat g02 the heights, bedford, bedfordshire, mk42 0ft","count":3},{"address":"flat 3 23-25 biscot road, luton, bedfordshire, lu3 1ah","count":3},{"address":"98a shelley road, luton, bedfordshire, lu4 0ja","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"17 station road, rushall, walsall, west midlands ws4 1ep","count":3},{"address":"34 hamilton road, handsworth, birmingham, west midlands b21 8ah","count":5},{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":3}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"2 the poplars, main road, cutthorpe, chesterfield, derbyshire, s42 7ah","count":3}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":38,"examples":[{"address":"60 ridgethorpe, willenhall, coventry, west midlands cv3 3gq","count":3},{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":4},{"address":"148 poole road, radford, coventry, west midlands cv6 1hw","count":4}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 25 addresses appear ≥3 times each (83 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":25,"total_dupe_rows":83,"examples":[{"address":"the flat, kirk allans, stock lane, grasmere, ambleside, cumbria la22 9sn","count":5},{"address":"76 stainburn road, stainburn, workington, cumbria ca14 1sn","count":3},{"address":"67 moresby parks road, moresby parks, whitehaven, cumbria ca28 8xd","count":5}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"units 1-11, the old national school, st. thomas road, launceston, cornwall pl15 8bu","count":4},{"address":"48 lockeridge road, bere alston, yelverton, devon pl20 7ap","count":3},{"address":"8 parklands 16 branksome hill road, bournemouth, dorset, bh4 9ld","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 38 addresses appear ≥3 times each (135 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":38,"total_dupe_rows":135,"examples":[{"address":"willow wood, 166 leverington road, wisbech, cambridgeshire pe13 1ru","count":4},{"address":"land adjacent to the water tower, princes street, swaffham, norfolk pe37 7bp","count":4},{"address":"old ambulance station, earls street, thetford, norfolk ip24 2af","count":5}]}`

## auctionhouseeastmidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"watch the bedfordshire and buckinghamshire auction live online! click here to view","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 7/7 (100%) lots have no price + no price_text
  - `{"tba":7,"total":7,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 7/7 (100%) lots missing image_url
  - `{"missing":7,"total":7,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 7/7 (100%) lots have empty bullets
  - `{"empty":7,"total":7,"ratio":1}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":3},{"address":"7 york mews, great wakering, southend-on-sea, essex ss3 0fa","count":3},{"address":"169/169a dunstans road, east dulwich, southwark, london se22 0hb","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 23/24 (96%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":23,"total":24,"ratio":0.958}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (49 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":49,"examples":[{"address":"325 spring bank west, hull, east yorkshire, hu3 1lb","count":4},{"address":"high flags mill 1, 192 wincolmlee, hull, east yorkshire, hu2 0pz","count":3},{"address":"18 inglewood drive, hull, east yorkshire, hu4 7px","count":4}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (60 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":60,"examples":[{"address":"152a london road southborough, tunbridge wells, kent, tn4 0pj","count":3},{"address":"55 gillingham road, gillingham, kent, me7 4rz","count":3},{"address":"flat 5 the eye, chatham, kent, me4 4sd","count":3}]}`

## auctionhouseleicestershire

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"land on the south west side of, 17 thurnby lane, stoughton, leicestershire le2 2fp","count":3},{"address":"51, 51b & 51e main street, broughton astley, leicester, leicestershire le9 6re","count":4}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 52 addresses appear ≥3 times each (169 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":52,"total_dupe_rows":169,"examples":[{"address":"13 bairstow street, blackpool, lancashire, fy1 5bn","count":6},{"address":"43 stainton drive, gateshead, tyne and wear, ne10 9qu","count":3},{"address":"60 tunnard street, grimsby, south humberside, dn32 7na","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 615/786 (78%) lots have no price + no price_text
  - `{"tba":615,"total":786,"ratio":0.782}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 48 addresses appear ≥3 times each (171 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":48,"total_dupe_rows":171,"examples":[{"address":"89 birkdale, bexhill-on-sea, east sussex, tn39 3tg","count":3},{"address":"19 jarvis road, south croydon, surrey, cr2 6hw","count":3},{"address":"12 brownhill road, catford, london, se6 2ej","count":3}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (66 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":66,"examples":[{"address":"3 bulls head court yard, commercial road, tideswell, buxton, derbyshire, sk17 8nu","count":4},{"address":"flat 34, renaissance house, millbrook street, stockport, sk1 3tn","count":5},{"address":"694 bolton road, pendlebury, swinton, m27 6el","count":3}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 31 addresses appear ≥3 times each (93 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":31,"total_dupe_rows":93,"examples":[{"address":"starwood the leazes, newcastle upon tyne, tyne and wear, ne16 6hj","count":3},{"address":"16 john street fencehouses, houghton le spring, tyne and wear, dh4 6lh","count":3},{"address":"1 whitehall drive, leeds, west yorkshire, ls12 5lw","count":3}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (43 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":43,"examples":[{"address":"7 main street, cold ashby, northampton, northamptonshire nn6 6el","count":3},{"address":"23 and 23a colwyn road, northampton, northamptonshire nn1 3pz","count":3},{"address":"8 oak close, hartwell, northampton, northamptonshire nn7 2jx","count":6}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 29 addresses appear ≥3 times each (88 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":29,"total_dupe_rows":88,"examples":[{"address":"shop and 3 flats at 11 main street crawcrook, ryton, tyne and wear, ne40 4tx","count":3},{"address":"28. ridley gardens swalwell, newcastle upon tyne, tyne and wear, ne16 3ht","count":3},{"address":"apartment 103 echo building, sunderland, tyne and wear, sr1 1xh","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 395/483 (82%) lots have no price + no price_text
  - `{"tba":395,"total":483,"ratio":0.818}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 11/16 (69%) lots missing image_url
  - `{"missing":11,"total":16,"ratio":0.688}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 51 addresses appear ≥3 times each (162 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":51,"total_dupe_rows":162,"examples":[{"address":"18 alker street, chorley, lancashire pr7 2da","count":3},{"address":"20b mersey road, widnes, cheshire, wa8 0dg","count":3},{"address":"apartment 22 old tannery, bingley, west yorkshire, bd16 4jj","count":3}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 35 addresses appear ≥3 times each (108 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":35,"total_dupe_rows":108,"examples":[{"address":"119 wharf road pinxton, nottingham, nottinghamshire, ng16 6lh","count":3},{"address":"4/6 lonsdale terrace, edinburgh, midlothian, eh3 9hn","count":3},{"address":"flat 3 3 constitution place, edinburgh, midlothian, eh6 7dl","count":4}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 36 addresses appear ≥3 times each (142 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":36,"total_dupe_rows":142,"examples":[{"address":"plots at burnside cottages, aberdeen, aberdeenshire ab12 5yq","count":6},{"address":"32 bridge street, strichen, fraserburgh, aberdeenshire ab43 6ss","count":3},{"address":"plot adjacent to harvieston cottage, gorebridge, midlothian eh23 4qa","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 260/265 (98%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":260,"total":265,"ratio":0.981}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (124 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":124,"examples":[{"address":"937a wimborne road, bournemouth, dorset, bh9 2bn","count":3},{"address":"the freehold reversion of annandale 12 belle vue road, paignton, devon, tq4 6er","count":3},{"address":"flat 1, prospect place porthleven, helston, cornwall, tr13 9dr","count":3}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 119 addresses appear ≥3 times each (414 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":119,"total_dupe_rows":414,"examples":[{"address":"elizabeth street, goldthorpe, rotherham, south yorkshire, s63 9na","count":3},{"address":"4 barwood avenue church lawton, stoke-on-trent, staffordshire, st7 3en","count":3},{"address":"31 york street, thurnscoe, rotherham, south yorkshire, s63 0dy","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 2058/2168 (95%) lots have no price + no price_text
  - `{"tba":2058,"total":2168,"ratio":0.949}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"51 moneybrook way, shrewsbury, shropshire, sy3 9nh","count":3},{"address":"no. 1 tower street flat 7, ludlow, shropshire, sy8 1rl","count":3},{"address":"16 mount pleasant road, shrewsbury, shropshire, sy1 3bq","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":33,"examples":[{"address":"93 broadway east, redcar, north yorkshire ts10 5dt","count":5},{"address":"11 newlyn green park end, middlesbrough, cleveland, ts3 0du","count":3},{"address":"93 dale grove, leyburn dl8 5ga","count":5}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 290 addresses appear ≥3 times each (950 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":290,"total_dupe_rows":950,"examples":[{"address":"a portfolio of eleven plots of land and roadways","count":5},{"address":"7e, 7f, 9 & 9a high street, barnet, hertfordshire, en5 5ue","count":4},{"address":"land adjacent to 2-8 exmoor rise, ashford, kent, tn24 8qr","count":4}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 36 addresses appear ≥3 times each (110 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":36,"total_dupe_rows":110,"examples":[{"address":"land off sycamore close west side of heal-y-groes, bridgend, cf31 1qs","count":3},{"address":"38, admiral house 38-42, newport road, cardiff, cf24 0dh","count":3},{"address":"pendre wyn 13 west street, knighton, powys, ld7 1en","count":3}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":67,"examples":[{"address":"4 colton street, leeds, west yorkshire ls12 1tx","count":3},{"address":"99 park lane, keighley, west yorkshire bd21 4rh","count":3},{"address":"24 aysgarth drive, leeds, west yorkshire ls9 9nx","count":3}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"47 davy street, ferryhill, county durham, dl17 8pn","count":3},{"address":"river view, 87 low street, sunderland, tyne and wear, sr1 2at","count":3},{"address":"4 york street, stanley, county durham, dh9 8sn","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 11/21 (52%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":11,"total":21,"ratio":0.524}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 23 addresses appear ≥3 times each (82 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":23,"total_dupe_rows":82,"examples":[{"address":"auckland house, 55 st. ronans road, southsea, hampshire, po4 0pp","count":3},{"address":"31 broadwater boulevard flats, worthing, west sussex, bn14 8jf","count":3},{"address":"cemmaes meadow, london road, ashington, pulborough, west sussex, rh20 3jr","count":3}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 42/42 (100%) lots have empty bullets
  - `{"empty":42,"total":42,"ratio":1}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat a, 19, southolm street, battersea, london, sw11 5ez","count":3}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"heritage court, trundleys road, london, se8, united kingdom","count":3},{"address":"11 aston chase, hemsworth, pontefract, west yorkshire, wf9 4rb, united kingdom","count":3},{"address":"buick house, london road, kingston upon thames, kt2, united kingdom","count":3}]}`

## bowensonandwatson

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"tan yr allt farm, ffordd las, cymau, wrexham, ll11 5ey","count":3},{"address":"30 prince street, oswestry, shropshire, sy11 1ld","count":3},{"address":"black park chapel, maes y parc, chirk, wrexham, ll14 5bb","count":3}]}`

## bradleyhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"30 church street, shildon, county durham, dl4 1dx","count":3},{"address":"hetton social club, station road, hetton-le-hole, sunderland, tyne and wear, dh5 9jb","count":3},{"address":"unit 30 navigation point, middleton road, hartlepool, county durham, ts24 0uj","count":3}]}`

## bradleysdevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"calloose lane, leedstown, hayle, cornwall, tr27","count":3},{"address":"greenfield road, watchet, somerset, ta23","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"birkby lodge road, huddersfield","count":3},{"address":"chapel lane, moldgreen, huddersfield","count":3}]}`

## brownco

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"59 theatre street, dereham, norfolk, nr19 2er","count":3},{"address":"2 college farm lane, thompson, thetford, norfolk, ip24 1qg","count":3},{"address":"105 neville road, sutton, norwich, norfolk, nr12 9rr","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"under offer","count":3},{"address":"1-2 bishops walk, tewkesbury, gloucestershire, gl20 5lq","count":3},{"address":"salt box road, guildford, surrey, gu3 3ta","count":3}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 52 addresses appear ≥3 times each (174 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":52,"total_dupe_rows":174,"examples":[{"address":"long spring cottage, gracious lane, sevenoaks, kent tn13 1tj","count":3},{"address":"site at holland way, newport pagnell, buckinghamshire mk16 0lw","count":3},{"address":"flat 1019, churchill place, churchill way, basingstoke, hampshire rg21 7es","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 563/795 (71%) lots have empty bullets
  - `{"empty":563,"total":795,"ratio":0.708}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (46 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":46,"examples":[{"address":"west avenue, northwich","count":4},{"address":"broad street, crewe cw1 4jj","count":3},{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":9}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"auction lot: vacant office building in newton abbot","count":3},{"address":"24 fore street, exeter, ex4 3an","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 74/94 (79%) lots missing image_url
  - `{"missing":74,"total":94,"ratio":0.787}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"123 high street, cambridge, cb1 2aa","count":3},{"address":"stables and paddock land, harpers drove, ramsey heights, cambridgeshire, pe26 2rj","count":3},{"address":"land to the south side of south road, great abington, cambridgeshire, cb21 6au","count":3}]}`

## cheffinstimed

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"former white lion veterinary clinic, 1 hall street, bessemer road, south hetton, county durham, dh6 2tu","count":3}]}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"11a, the centre, weston-super-mare, north somerset bs23 1uw","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 10/10 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":10,"total":10,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":67,"examples":[{"address":"17-19-19a, high street, saxmundham, suffolk, ip17 1df","count":4},{"address":"24.29 acres of arable land, clay lane, brent eleigh, lavenham, suffolk, co10 9pg","count":3},{"address":"2 church lane, walberswick, southwold, suffolk, ip18 6uz","count":3}]}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"talog, carmarthen, carmarthenshire","count":3}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 52 addresses appear ≥3 times each (178 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":52,"total_dupe_rows":178,"examples":[{"address":"penzance - cornwall","count":3},{"address":"ventnor - isle of wight","count":5},{"address":"st. austell - cornwall","count":3}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"land at westwood lane, wanborough, guildford, surrey, gu3 2jn","count":3},{"address":"land at mill lane, sturminster marshall, wimborne, dorset, bh21 4bd","count":3},{"address":"land at moor lane, staines-upon-thames, surrey, tw19 6ee","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"13 - 14 the strand, dawlish, devon, ex7 9ps","count":3},{"address":"68 knowsley road, bootle, merseyside, l20 4np","count":3},{"address":"69 scargreen avenue, liverpool, merseyside, l11 3ay","count":3}]}`

## dedmangray

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"78 river road, essex, e3 3cc","count":3},{"address":"45 park lane, essex, e2 2bb","count":3},{"address":"123 high street, essex, e1 1aa","count":3}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 10/10 (100%) lots have no price + no price_text
  - `{"tba":10,"total":10,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 10/10 (100%) lots missing image_url
  - `{"missing":10,"total":10,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 10/10 (100%) lots have empty bullets
  - `{"empty":10,"total":10,"ratio":1}`

## durrants

- **[warn] identical_price_wall** — Identical-price wall: 4/6 (67%) lots share price £100000 — extractor likely picking up hero/banner price
  - `{"price":100000,"count":4,"total":6,"ratio":0.667}`
- **[info] bullet_starvation** — Bullet starvation: 5/6 (83%) lots have empty bullets
  - `{"empty":5,"total":6,"ratio":0.833}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 41 addresses appear ≥3 times each (139 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":41,"total_dupe_rows":139,"examples":[{"address":"apartment 59, archer house, 3 john street, stockport, sk1","count":3},{"address":"easton drive, sittingbourne, me10","count":3},{"address":"apartment 2108, affinity living riverview, 29 new bailey street, salford, m3","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 327/341 (96%) lots have empty bullets
  - `{"empty":327,"total":341,"ratio":0.959}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (59 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":59,"examples":[{"address":"flat 1, 130 high street, chesham, buckinghamshire, hp5 1ef","count":3},{"address":"24 st marks court, bath road, worcester, worcestershire, wr5 3eg","count":3},{"address":"158 st. leonards road, windsor, berkshire, sl4 3dl","count":3}]}`

## fishergerman

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"norman court, ashby de la zouch, le65 2uz","count":3},{"address":"1 emperor way, exeter business park, exeter, ex1 3qs","count":3}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"luckystone, carters clay road, newtown, romsey, so51 0gl","count":3},{"address":"6 swan quay, bath lane, fareham, po16 0dx","count":3}]}`

## fssproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"east parade, harrogate, hg1 5lq","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (58 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":58,"examples":[{"address":"4 stafford street, first floor flat, aberdeen","count":3},{"address":"41 urquhart road, first floor flat, aberdeen","count":3},{"address":"22 barfillan drive, flat 3-1, craigton","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 348/348 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":348,"total":348,"ratio":1}`

## gherbertbanks

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"hillside cottage, bridgnorth, wv16 6tp","count":3}]}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"haybridge, wells, somerset, ba5","count":4},{"address":"eastside lane, bawdrip, bridgwater, somerset, ta7","count":3},{"address":"barton st. david, somerston, somerset, ta11","count":3}]}`

## hairandson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"ingledene court, 108 york road, southend-on-sea, essex, ss1 2dj","count":3},{"address":"123 main st, london, e1 6an","count":3}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"trelydan farm, trelydan, welshpool, sy21 9ht","count":3},{"address":"huntsfield cottage, eymore wood, bewdley, dy12 1ph","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 36 addresses appear ≥3 times each (125 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":36,"total_dupe_rows":125,"examples":[{"address":"pound street, newbury, berkshire, rg14 6aa - online auctions","count":3},{"address":"kenilworth house, fletcher road, gateshead, tyne and wear, ne8 2aw - online auctions","count":3},{"address":"fieldside road, kinsley, pontefract, west yorkshire, wf9 5lg - online auctions","count":3}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"land at canal view / orrell street, warrington road, ince, wigan, wigan, wn1 3aq","count":3},{"address":"81 lyppiatt road, bristol, avon, bs5 9hp","count":4},{"address":"doris avenue, bolton, lancashire, bl2 6db","count":4}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"elizabeth house, church street, liskeard, cornwall, pl14 3ag","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":10,"examples":[{"address":"ashford market, ashford","count":4},{"address":"ashford market, kent","count":6}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 51 addresses appear ≥3 times each (210 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":51,"total_dupe_rows":210,"examples":[{"address":"osborne villas, kingsdown, bs2 8bp","count":14},{"address":"apsley road, clifton, bs8 2sn","count":6},{"address":"lower high street, shirehampton, bs11 0aw","count":5}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"33 st john's croft, lutterworth, le17 4au","count":3},{"address":"1 mill lane, long lawford, rugby, cv23 9ga","count":3},{"address":"16 warwick street, rugby, cv22 5hn","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`
- **[warn] image_coverage_low** — Image coverage low: 5/7 (71%) lots missing image_url
  - `{"missing":5,"total":7,"ratio":0.714}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"main street, shildon, dl4 1aw","count":3}]}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":30,"examples":[{"address":"leek road, buxton, derbyshire, sk17 0tb","count":3},{"address":"dane road, margate, kent, ct9 2aa","count":3},{"address":"st. pauls road, halifax, west yorkshire, hx1 3rs","count":3}]}`

## johnfrancis

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"map iconicon set mapmap","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 13/13 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":13,"total":13,"ratio":1}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"general auction \\| chesterfield \\| saleroom 38 \\| collection or delivery","count":3},{"address":"general auction \\| chesterfield \\| saleroom 36 \\| collection or delivery","count":3},{"address":"general auction \\| nottingham \\| premium room \\| home delivery","count":4}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'johnpye' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"johnpye"}`
- **[info] bullet_starvation** — Bullet starvation: 78/105 (74%) lots have empty bullets
  - `{"empty":78,"total":105,"ratio":0.743}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (63 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":63,"examples":[{"address":"bolventor, launceston, cornwall pl15","count":4},{"address":"ashwater, beaworthy, ex21","count":5},{"address":"west looe hill, looe, pl13","count":4}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (36 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":36,"examples":[{"address":"dartington lodge, dartington hall, totnes, devon, tq9 6ea","count":5},{"address":"swedish house, 1 dixons lane, broughton, stockbridge, hampshire, so20 8at","count":3},{"address":"21 strand-on-the-green, london, w4 3ph","count":4}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":20,"examples":[{"address":"78 clovelly road, bideford, devon, ex39 3dg","count":3},{"address":"83 clowes street, manchester, lancashire, m12 5fy","count":3},{"address":"land at, ocean way, pennar, pembroke dock, pembrokeshire, sa72 6gl","count":3}]}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 54/54 (100%) lots missing image_url
  - `{"missing":54,"total":54,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":5},{"address":"ty cenin, dyffryn ardudwy, merionethshire, ll44 2dg","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 25/34 (74%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":25,"total":34,"ratio":0.735}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"21 bracadale close, binley, coventry, west midlands cv3 2pf","count":4},{"address":"72 terry road, stoke, coventry, west midlands cv1 2ba","count":4},{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 23/40 (57%) lots missing image_url
  - `{"missing":23,"total":40,"ratio":0.575}`
- **[info] bullet_starvation** — Bullet starvation: 31/40 (78%) lots have empty bullets
  - `{"empty":31,"total":40,"ratio":0.775}`

## luscombemaye

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"the manor, south brent, tq10 9nq","count":3},{"address":"the friary, south brent, tq10 9ab","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 29/34 (85%) lots have empty bullets
  - `{"empty":29,"total":34,"ratio":0.853}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"land adjoining the firs, new road, rangeworthy, bristol, bs37 7qh","count":3},{"address":"denbank, 188, westbrook, bromham,nr. chippenham, sn15 2ed","count":3},{"address":"unit 4, old mills court, paulton, bristol, bs39 7sw","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 40/72 (56%) lots missing image_url
  - `{"missing":40,"total":72,"ratio":0.556}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":42,"examples":[{"address":"unit 1 slate house, oakwood court, city road, bradford, west yorkshire bd8 8jy","count":3},{"address":"land at bent street & elm street, newsome, huddersfield, west yorkshire hd4 6nx","count":3},{"address":"61 conway street, long eaton, nottingham ng10 2af","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 339/403 (84%) lots have empty bullets
  - `{"empty":339,"total":403,"ratio":0.841}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"baskerville road, kidderminster, worcestershire, dy10 2ye","count":3},{"address":"foxglove close, stourport-on-severn, worcestershire, dy13 9bn","count":4},{"address":"teme court, new street, ludlow, shropshire, sy8 2bl","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 52/61 (85%) lots have empty bullets
  - `{"empty":52,"total":61,"ratio":0.852}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (46 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":46,"examples":[{"address":"colnside, gloucester road, andoversford, cheltenham, gl54 4hr","count":3},{"address":"53 norfolk street, blackburn, bb2 4ew","count":4},{"address":"20 grecian crescent, crystal palace, se19 3hh","count":3}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"st george's road, southsea po4 9pl","count":3},{"address":"francis avenue, southsea po4 0aj","count":4}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (32 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":32,"examples":[{"address":"blackbrook close, shepshed, loughborough, leicestershire, le12 9ld","count":3},{"address":"breakspear road north, harefield, uxbridge, middlesex, ub9 6lz","count":3},{"address":"orton hall, orton, penrith, cumbria, ca10 3rf","count":3}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 101 addresses appear ≥3 times each (344 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":101,"total_dupe_rows":344,"examples":[{"address":"20 bessemer road, cardiff, cf11 8ba","count":3},{"address":"156 bute street, treherbert, treorchy, cf42 5pe","count":4},{"address":"parcel 2, cynllwyndu road, tylorstown, ferndale, cf43 3dr","count":3}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (74 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":74,"examples":[{"address":"lichfield road, portsmouth","count":3},{"address":"london road, horndean","count":4},{"address":"eastern parade, southsea","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 96/99 (97%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":96,"total":99,"ratio":0.97}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (49 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":49,"examples":[{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":3},{"address":"5a swains market, flackwell heath, high wycombe hp10 9bl","count":3},{"address":"2 old watery lane, wooburn moor, high wycombe hp10 0ny","count":4}]}`

## probateauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"192 haydn road, nottingham, nottinghamshire, ng5 2lg","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 16/24 (67%) lots missing image_url
  - `{"missing":16,"total":24,"ratio":0.667}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"64 tirgof, llangennech, llanelli, dyfed, sa14 8tp","count":3},{"address":"5 trinity road, llanelli, dyfed, sa15 2ab","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 59/62 (95%) lots have empty bullets
  - `{"empty":59,"total":62,"ratio":0.952}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"lees road, mossley, ashton-under-lyne, ol5 0pq","count":3},{"address":"rosedale avenue, middlesbrough, ts4 2sf","count":3},{"address":"westbeach, westward ho, bideford, devon, ex39 1lq","count":4}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 33 addresses appear ≥3 times each (106 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":33,"total_dupe_rows":106,"examples":[{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":6},{"address":"31 sandown crescent, manchester, greater manchester m18 7wg","count":3},{"address":"land at belmont road, bolton, lancashire bl1 7at","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 45 addresses appear ≥3 times each (135 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":45,"total_dupe_rows":135,"examples":[{"address":"65 darlington road, ferryhill, county durham, dl17 8ex","count":3},{"address":"7 portfield close, buckingham, buckinghamshire, mk18 1bd","count":3},{"address":"87 heathfield road, nottingham, nottinghamshire, ng5 1nl","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":3},{"address":"land and barns adjacent to st. peters farm, middle drove, wisbech, cambridgeshire, pe14 8jt","count":3}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"43 edgmond court, sunderland, tyne and wear, sr2 0dx","count":3},{"address":"sunnymead, dunston bank, gateshead, tyne and wear, ne11 9qa","count":3},{"address":"17 march courtyard, ash street, gateshead, tyne and wear, ne8 2gf","count":4}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"marshgate cottage, warrington road, runcorn, wa7 1rb","count":3},{"address":"land at brocks lane, frilsham, berkshire, rg18 9uy","count":3},{"address":"unit 6 station court, station approach, borough green, sevenoaks, kent tn15 8bg","count":3}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"3 clinton street, worksop, nottinghamshire s80 2ry","count":3},{"address":"40 osborne street, nottingham ng7 5ly","count":3},{"address":"12 dorterry crescent, ilkeston de7 4dt","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 122/122 (100%) lots have empty bullets
  - `{"empty":122,"total":122,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 122/122 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":122,"total":122,"ratio":1}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"flat a & b, 77 john street, porthcawl, cf36 3ay","count":3},{"address":"35 high street, ferndale, cf43 4rh","count":3},{"address":"former barclays bank, 46 rhosmaen street, llandeilo, dyfed, sa19 6hf","count":4}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (92 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":92,"examples":[{"address":"160, whinney hill park, brighouse, calderdale, hd6 2ne","count":4},{"address":"12a byron studios, byron street bradford, bd3 0au","count":9},{"address":"25 the grand mill 132, sunbridge road bradford, bd1 2pf","count":5}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"st aubyn's engine house, redruth, tr16 5hd","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":18,"examples":[{"address":"not available","count":18}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":25,"examples":[{"address":"flat 2, instow house marine parade, instow, bideford, devon, ex39 4jj","count":4},{"address":"16 apr 26  -  lot 38flat 31 kirkstall gate, 101 commercial road, leeds, west yorkshire, ls5 3ad","count":3},{"address":"16 apr 26  -  lot 56former public telephone kiosk, longport, canterbury, kent, ct1 1pe","count":3}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (29 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":29,"examples":[{"address":"flat 19 balmoral court, new road, old swan, liverpool, merseyside, l13 7hx","count":3},{"address":"405 & 405a cherry lane, liverpool, merseyside, l4 8sb","count":3},{"address":"17 st. nicholas street, bodmin, cornwall, pl31 1ab","count":3}]}`

## symondsandsampson

- **[warn] image_coverage_low** — Image coverage low: 44/61 (72%) lots missing image_url
  - `{"missing":44,"total":61,"ratio":0.721}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 180 addresses appear ≥3 times each (781 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":180,"total_dupe_rows":781,"examples":[{"address":"2 parkend gardens, saltcoats, ayrshire, ka21 5ph","count":3},{"address":"41 westwood road, glenrothes, fife, ky7 5bb","count":3},{"address":"12 sunny brow road, middleton, manchester, lancashire, m24 4bg","count":3}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":3}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"53 john f kennedy court, wisbech, pe13 2ag","count":3},{"address":"18 hutton road, bradford, bd5 9dt","count":3},{"address":"40 helmsdale close, reading, rg30 2ps","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (44 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":44,"examples":[{"address":"37 brookland road west, liverpool, l13 3bg","count":3},{"address":"95 alexandra road, crosby, merseyside, l23 7te","count":6},{"address":"apartment 504 37 strand street, liverpool, l1 8nd","count":7}]}`
- **[info] bullet_starvation** — Bullet starvation: 65/82 (79%) lots have empty bullets
  - `{"empty":65,"total":82,"ratio":0.793}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"wetherby, west yorkshire","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 34/36 (94%) lots have empty bullets
  - `{"empty":34,"total":36,"ratio":0.944}`
- **[info] image_domain_mismatch** — Image domain mismatch: 34/36 (94%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":34,"total":36,"ratio":0.944}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":14,"examples":[{"address":"61 church street, newry","count":6},{"address":"10 ballyphilip road, portaferry, newtownards","count":3},{"address":"top floor flat, 40 bedford road, aberdeen, aberdeenshire","count":5}]}`


