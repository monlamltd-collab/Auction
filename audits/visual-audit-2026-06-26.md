# Visual Audit — 2026-06-26

Scanned **26,248** rows in **22291ms** across **118** houses with findings.

**Findings:** 121 error · 15 warn · 25 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"the avenue, minehead, ta24 5ay","count":3},{"address":"brookfields, cargreen, pl12 6ns","count":3}]}`

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"unit 2a dundas close, portsmouth, hampshire, po3 5rb","count":5},{"address":"units 1-3 dundas spur north, portsmouth, hampshire, po3 5rb","count":3},{"address":"163 king street, aberdeen, aberdeenshire, ab24 5ae","count":3}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"high street, eldon lane, bishop auckland","count":5}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (71 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":71,"examples":[{"address":"land on the south side of simone weil avenue, ashford, kent, tn24 8qr","count":3},{"address":"plot 2 caversham park road, caversham, reading, berkshire, rg4 6nn","count":3},{"address":"plot 7 and roadways adjoining the hartings, bognor regis, west sussex, po22 6qf","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 104/186 (56%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":104,"total":186,"ratio":0.559}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 61 addresses appear ≥3 times each (284 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":61,"total_dupe_rows":284,"examples":[{"address":"bristol","count":5},{"address":"hyde park & headingley, leeds","count":5},{"address":"fairchild house, 21 southampton street, southampton, so15 2ed","count":5}]}`

## allwalesauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":30,"examples":[{"address":"ye olde mill , llanfairfechan, gwynedd, ll33 0ts","count":3},{"address":"windsor court,, conwy, ll31 9tn","count":3},{"address":"highbury, llanfairfechan, ll33 0al","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":27,"examples":[{"address":"hedworth lane, boldon colliery, ne35","count":4},{"address":"dryden road, low fell, ne9","count":4},{"address":"st. michaels avenue, south shields, ne33","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 91/91 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":91,"total":91,"ratio":1}`

## astleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"31 high street, skewen, neath, west glamorgan, sa10 6nb","count":3}]}`

## auctionestates

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"14-18 graham street, airdrie, lanarkshire, ml6 6bu","count":5},{"address":"land on river street, todmorden, lancashire, ol14 5by","count":3}]}`

## auctionhammermidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land adjacent 2, warrington street, fenton, stoke-on-trent, staffordshire st4 3lf","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 41/44 (93%) lots have empty bullets
  - `{"empty":41,"total":44,"ratio":0.932}`
- **[info] image_domain_mismatch** — Image domain mismatch: 44/44 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":44,"total":44,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 23 addresses appear ≥3 times each (72 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":23,"total_dupe_rows":72,"examples":[{"address":"plot 78 land fronting high street, boston spa, wetherby, west yorkshire, ls23 6sy","count":3},{"address":"cellarman cottage frenchay hill, bristol, avon, bs16 1lu","count":3},{"address":"flat 1 36a laurel road, doncaster, south yorkshire, dn3 2es","count":3}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (43 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":43,"examples":[{"address":"flat b, 55 shakespeare road, bedford, bedfordshire mk40 2dx","count":4},{"address":"57 porthcawl green tattenhoe, milton keynes, buckinghamshire, mk4 3al","count":3},{"address":"109 runley road, luton, bedfordshire, lu1 1tx","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":25,"examples":[{"address":"34 hamilton road, handsworth, birmingham, west midlands b21 8ah","count":3},{"address":"26 springfield road, coventry, west midlands cv1 4gs","count":4},{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":3}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":20,"examples":[{"address":"16 & 16a stephenson place and 15 cavendish street, chesterfield, derbyshire","count":5},{"address":"eastwood barn, 23 bridle road, woodthorpe, mastin moor, chesterfield, derbyshire, s43 3by","count":3},{"address":"12 park view, hasland, chesterfield, derbyshire, s41 0jd","count":4}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"land off valley road, galley common, nuneaton, warwickshire cv10 9nh","count":3},{"address":"flat 30, darlaston court, 123 main road, meriden, coventry, west midlands cv7 7nj","count":4},{"address":"land to the rear of 1 grenville avenue lower stoke, coventry, west midlands, cv2 4an","count":3}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (60 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":60,"examples":[{"address":"the flat, kirk allans, stock lane, grasmere, ambleside, cumbria la22 9sn","count":3},{"address":"67 moresby parks road, moresby parks, whitehaven, cumbria ca28 8xd","count":6},{"address":"126 holborn hill, millom, cumbria la18 5bw","count":3}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":35,"examples":[{"address":"89 careys way, weston-super-mare, avon, bs24 7hh","count":4},{"address":"4 parklands 16 branksome hill road, bournemouth, dorset, bh4 9ld","count":4},{"address":"5 parklands 16 branksome hill road, bournemouth, dorset, bh4 9ld","count":4}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 119 addresses appear ≥3 times each (462 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":119,"total_dupe_rows":462,"examples":[{"address":"willow wood, 166 leverington road, wisbech, cambridgeshire pe13 1ru","count":4},{"address":"land adjacent to the water tower, princes street, swaffham, norfolk pe37 7bp","count":6},{"address":"salvation army hall 8 bushel lane, soham, cambridgeshire, cb7 5by","count":5}]}`

## auctionhouseeastmidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"watch the bedfordshire and buckinghamshire auction live online! click here to view","count":5}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 8/8 (100%) lots missing image_url
  - `{"missing":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":30,"examples":[{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":5},{"address":"7 york mews, great wakering, southend-on-sea, essex ss3 0fa","count":5},{"address":"169/169a dunstans road, east dulwich, southwark, london se22 0hb","count":6}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 39/39 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":39,"total":39,"ratio":1}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"high flags mill 1, 192 wincolmlee, hull, east yorkshire, hu2 0pz","count":4},{"address":"62-70 sunny bank, hull, east yorkshire, hu3 1lq","count":3},{"address":"18 inglewood drive, hull, east yorkshire, hu4 7px","count":3}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 26 addresses appear ≥3 times each (82 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":26,"total_dupe_rows":82,"examples":[{"address":"55 gillingham road, gillingham, kent, me7 4rz","count":5},{"address":"flat 5 the eye, chatham, kent, me4 4sd","count":5},{"address":"flat 1 80 eastern esplanade, margate, kent, ct9 2jp","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 122 addresses appear ≥3 times each (401 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":122,"total_dupe_rows":401,"examples":[{"address":"13 bairstow street, blackpool, lancashire, fy1 5bn","count":4},{"address":"60 tunnard street, grimsby, south humberside, dn32 7na","count":3},{"address":"flat 1 & flat 2 griffin works, accrington, lancashire, bb5 2hr","count":5}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 879/1092 (80%) lots have no price + no price_text
  - `{"tba":879,"total":1092,"ratio":0.805}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 114 addresses appear ≥3 times each (409 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":114,"total_dupe_rows":409,"examples":[{"address":"89 birkdale, bexhill-on-sea, east sussex, tn39 3tg","count":3},{"address":"19 jarvis road, south croydon, surrey, cr2 6hw","count":4},{"address":"21 meander house, 20 logan close, stratford, london, e20 1fg","count":4}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 37 addresses appear ≥3 times each (162 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":37,"total_dupe_rows":162,"examples":[{"address":"apartment 22, 427, ashton old road, manchester, m11 2dl","count":3},{"address":"7 armitage close, middleton, m24 4pa","count":3},{"address":"12 sheepridge road, huddersfield, west yorkshire, hd2 1hh","count":5}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 61 addresses appear ≥3 times each (189 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":61,"total_dupe_rows":189,"examples":[{"address":"21 water end thorpe meadows, peterborough, cambridgeshire, pe3 6gq","count":3},{"address":"152a london road southborough, tunbridge wells, kent, tn4 0pj","count":5},{"address":"33 derwent way, gillingham, kent, me8 0bt","count":5}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":21,"examples":[{"address":"23 and 23a colwyn road, northampton, northamptonshire nn1 3pz","count":4},{"address":"8 oak close, hartwell, northampton, northamptonshire nn7 2jx","count":3},{"address":"10 the leys, roade, northampton, northamptonshire nn7 2nr","count":3}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 55 addresses appear ≥3 times each (193 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":55,"total_dupe_rows":193,"examples":[{"address":"shop and 3 flats at 11 main street crawcrook, ryton, tyne and wear, ne40 4tx","count":5},{"address":"28. ridley gardens swalwell, newcastle upon tyne, tyne and wear, ne16 3ht","count":5},{"address":"apartment 103 echo building, sunderland, tyne and wear, sr1 1xh","count":5}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 339/471 (72%) lots have no price + no price_text
  - `{"tba":339,"total":471,"ratio":0.72}`

## auctionhousenorthernireland

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"83 gulladuff hill knockloughrim, magherafelt, county londonderry, bt45 8pa","count":4}]}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"watch the cumbria auction live online! click here to view","count":3},{"address":"456 high road, manchester, m1 2ab","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 10/17 (59%) lots missing image_url
  - `{"missing":10,"total":17,"ratio":0.588}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 74 addresses appear ≥3 times each (247 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":74,"total_dupe_rows":247,"examples":[{"address":"flat 16, maritime court, promenade, southport, merseyside pr8 1sp","count":3},{"address":"apartment 22 old tannery, bingley, west yorkshire, bd16 4jj","count":5},{"address":"land off hope street, chester, cheshire ch4 8bz","count":5}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":31,"examples":[{"address":"flat 3 3 constitution place, edinburgh, midlothian, eh6 7dl","count":6},{"address":"6/8 bruntsfield place, edinburgh, midlothian, eh10 4hn","count":3},{"address":"flat 209 minerva house, nottingham, nottinghamshire, ng1 6ep","count":3}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 60 addresses appear ≥3 times each (240 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":60,"total_dupe_rows":240,"examples":[{"address":"the old mission church, bualadubh, isle of south uist, na h-eileanan siar hs8 5rq","count":3},{"address":"plots at burnside cottages, aberdeen, aberdeenshire ab12 5yq","count":6},{"address":"4-6 irving street, dumfries, dumfriesshire dg1 1el","count":7}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 329/337 (98%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":329,"total":337,"ratio":0.976}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 42 addresses appear ≥3 times each (153 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":42,"total_dupe_rows":153,"examples":[{"address":"flat 4, 34 the triangle, bournemouth, dorset, bh2 5se","count":5},{"address":"72 raymond road, redruth, cornwall, tr15 2hf","count":5},{"address":"flat 2, 1 high street, gloucester, gloucestershire, gl1 4sp","count":5}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 297 addresses appear ≥3 times each (1025 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":297,"total_dupe_rows":1025,"examples":[{"address":"1, chapman lane grassmoor, chesterfield, derbyshire, s42 5en","count":5},{"address":"84 midland road royston, barnsley, south yorkshire, s71 4qt","count":5},{"address":"apartment 1010, sovereign house, 110, queen street, sheffield, s1 2fr","count":5}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 2505/2646 (95%) lots have no price + no price_text
  - `{"tba":2505,"total":2646,"ratio":0.947}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":39,"examples":[{"address":"51 moneybrook way, shrewsbury, shropshire, sy3 9nh","count":5},{"address":"16 delamere court st. marys street, crewe, cheshire, cw1 2jb","count":3},{"address":"72 court street madeley, telford, shropshire, tf7 5ep","count":4}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (78 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":78,"examples":[{"address":"93 broadway east, redcar, north yorkshire ts10 5dt","count":8},{"address":"11 newlyn green park end, middlesbrough, cleveland, ts3 0du","count":5},{"address":"93 dale grove, leyburn dl8 5ga","count":7}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 108 addresses appear ≥3 times each (367 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":108,"total_dupe_rows":367,"examples":[{"address":"a portfolio of eleven plots of land and roadways","count":6},{"address":"land adjacent to 2-8 exmoor rise, ashford, kent, tn24 8qr","count":3},{"address":"100 ellesmere avenue, mill hill, london, nw7 3hd","count":3}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (110 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":110,"examples":[{"address":"38, admiral house 38-42, newport road, cardiff, cf24 0dh","count":4},{"address":"llidiart y coed maenan, llanrwst, conwy, ll26 0yn","count":3},{"address":"pendre wyn 13 west street, knighton, powys, ld7 1en","count":5}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (106 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":106,"examples":[{"address":"12 town gate, wyke, bradford, west yorkshire, bd12 9nx","count":5},{"address":"4 mill green view, leeds, west yorkshire, ls14 5jt","count":5},{"address":"71 willans avenue, rothwell, leeds, west yorkshire, ls26 0nf","count":5}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"29 nelson street, bishop auckland, county durham, dl14 7dg","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 9/16 (56%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":9,"total":16,"ratio":0.563}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 42 addresses appear ≥3 times each (151 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":42,"total_dupe_rows":151,"examples":[{"address":"flat 3, 40 tivoli crescent, brighton, bn1 5nd","count":4},{"address":"9 beech grove, addlestone, surrey, kt15 1qq","count":4},{"address":"auckland house, 55 st. ronans road, southsea, hampshire, po4 0pp","count":5}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 179/194 (92%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":179,"total":194,"ratio":0.923}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the conifers, pontrilas, hereford, herefordshire hr2 0eh","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 43/43 (100%) lots have empty bullets
  - `{"empty":43,"total":43,"ratio":1}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"26j, penywern road, london, sw5 9su","count":3},{"address":"flat 46, isobel house, staines road west, sunbury-on-thames, middlesex, tw16 7bd","count":3},{"address":"flat f, heather court, 150, leigham court road, london, sw16 2rj","count":3}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":16,"examples":[{"address":"buick house, london road, kingston upon thames, kt2, united kingdom","count":5},{"address":"5 back lane, beeston, norfolk pe32 2nn, united kingdom","count":5},{"address":"4 manor terrace, mileham, king's lynn, norfolk pe32 2pu, united kingdom","count":3}]}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"456 oak avenue, wolverhampton, wv1 1ab","count":3},{"address":"656 streetsbrook road, solihull, b91 1lb","count":3},{"address":"plot j, greville drive, edgbaston, birmingham, b15 2er","count":3}]}`

## bowensonandwatson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"lot 1 tan yr allt farm, ffordd las, cymau, wrexham, ll11 5ey","count":3}]}`

## bradleyhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"2 prospect row, sunderland, tyne and wear, sr1 2bp","count":3}]}`

## bradleysdevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":16,"examples":[{"address":"calloose lane, leedstown, hayle, cornwall, tr27","count":5},{"address":"greenfield road, watchet, somerset, ta23","count":5},{"address":"jubilee road, pensilva, liskeard, cornwall, pl14","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"coule royd, huddersfield","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at southam ratcliff lawns, cheltenham, gl52 3pb","count":3}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 117 addresses appear ≥3 times each (370 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":117,"total_dupe_rows":370,"examples":[{"address":"long spring cottage, gracious lane, sevenoaks, kent tn13 1tj","count":3},{"address":"site at holland way, newport pagnell, buckinghamshire mk16 0lw","count":3},{"address":"285 purley way, croydon cr0 4xf","count":5}]}`
- **[info] bullet_starvation** — Bullet starvation: 686/869 (79%) lots have empty bullets
  - `{"empty":686,"total":869,"ratio":0.789}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":25,"examples":[{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":7},{"address":"the avenue, stoke on trent st7 1al","count":3},{"address":"peel terrace, stafford st16 3bx","count":3}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"3 church lane, combe martin, ex34 0dh","count":3},{"address":"14 park road, plymstock, pl9 9az","count":3},{"address":"48 fore street, exeter, ex4 3hr","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 74/98 (76%) lots missing image_url
  - `{"missing":74,"total":98,"ratio":0.755}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"20 birch lane, newmarket, cb8 0dt","count":5},{"address":"12 station road, six mile bottom, newmarket, suffolk, cb8 0uq","count":3},{"address":"50 swaffham road, burwell, cambridgeshire, cb25 0an","count":3}]}`

## cityandruralpropertyauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 10/10 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":10,"total":10,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (59 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":59,"examples":[{"address":"approximately 26 acres of land","count":3},{"address":"penzance - cornwall","count":3},{"address":"ventnor - isle of wight","count":3}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"land at westwood lane, wanborough, guildford, surrey, gu3 2jn","count":3},{"address":"land at mill lane, sturminster marshall, wimborne, dorset, bh21 4bd","count":3},{"address":"langdale gardens, earley, reading, berkshire, rg6","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":19,"examples":[{"address":"13 - 14 the strand, dawlish, devon, ex7 9ps","count":3},{"address":"stable barn cottage, 1 stable lane, torquay, devon, tq1 4sa","count":4},{"address":"1 cheltenham place, newquay, cornwall, tr7 1ba","count":4}]}`

## driversnorris

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"property to rent in wiltshire","count":3},{"address":"property for sale in london","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 12/12 (100%) lots have no price + no price_text
  - `{"tba":12,"total":12,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 12/12 (100%) lots missing image_url
  - `{"missing":12,"total":12,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 12/12 (100%) lots have empty bullets
  - `{"empty":12,"total":12,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 86 addresses appear ≥3 times each (328 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":86,"total_dupe_rows":328,"examples":[{"address":"kennedy street, chadderton, oldham, ol8","count":4},{"address":"easton drive, sittingbourne, me10","count":3},{"address":"dawn birch, station road, whitworth, rochdale, ol12","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 433/464 (93%) lots have empty bullets
  - `{"empty":433,"total":464,"ratio":0.933}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (60 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":60,"examples":[{"address":"flat 1, 130 high street, chesham, buckinghamshire, hp5 1ef","count":3},{"address":"50 underwood road, high wycombe, buckinghamshire, hp13 6yb","count":3},{"address":"115 penn road, datchet, slough, berkshire, sl3 9hs","count":3}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"development site at the masons arms, 34 east street, warminster, ba12 9bn","count":3},{"address":"bridge cottage, burgate, fordingbridge, sp6 1lx","count":3},{"address":"luckystone, carters clay road, newtown, romsey, so51 0gl","count":4}]}`

## fssproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"east parade, harrogate, hg1 5lq","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 30 addresses appear ≥3 times each (109 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":30,"total_dupe_rows":109,"examples":[{"address":"commercial investment 2 new mill road, kilmarnock","count":4},{"address":"22 barfillan drive, flat 3-1, craigton","count":5},{"address":"14 blackhall street, flat 0-2, paisley","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 367/367 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":367,"total":367,"ratio":1}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":25,"examples":[{"address":"eastside lane, bawdrip, bridgwater, somerset, ta7","count":5},{"address":"barton st. david, somerston, somerset, ta11","count":5},{"address":"mark causeway, mark, highbridge, somerset, ta9","count":4}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"28, mccreadie drive, ellesmere, sy12 0ea","count":3},{"address":"14, oswalds well lane, oswestry, sy11 2tp","count":3},{"address":"5, high lea close, oswestry, sy11 1sx","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 44 addresses appear ≥3 times each (163 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":44,"total_dupe_rows":163,"examples":[{"address":"a former bank / shop and four bedroom mid-terrace house","count":3},{"address":"a two/three bedroom detached bungalow","count":3},{"address":"a spacious 3 double bedroom duplex apartment","count":3}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"doris avenue, bolton, lancashire, bl2 6db","count":4},{"address":"81 lyppiatt road, bristol, avon, bs5 9hp","count":4},{"address":"flat 3 waterloo house, thornaby place, thornaby, stockton-on-tees, cleveland, ts17 6sa","count":3}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"35 gilsland road, thornton heath, surrey, cr7 8rq","count":3},{"address":"6 braybrooke terrace, hastings, east sussex, tn34 1td","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":14,"examples":[{"address":"ashford market, ashford","count":5},{"address":"ashford market, kent","count":9}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 58 addresses appear ≥3 times each (248 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":58,"total_dupe_rows":248,"examples":[{"address":"lower high street, shirehampton, bs11 0aw","count":3},{"address":"osborne villas, kingsdown, bs2 8bp","count":9},{"address":"highridge road, bishopsworth, bs13 8hp","count":3}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"northampton, nn1","count":3},{"address":"321 nice place, bristol, bs1 4dd","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"stonefall avenue, harrogate, hg2 7nr","count":3}]}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"leek road, buxton, derbyshire, sk17 0tb","count":5},{"address":"vesey close, sutton coldfield, west midlands, b74 4qn","count":3},{"address":"park view, newton abbot, devon, tq12 4nx","count":3}]}`

## johnfrancis

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"templeton, narberth, pembrokeshire, sa67","count":3},{"address":"spring gardens, whitland, carmarthens...","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 29/31 (94%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":29,"total":31,"ratio":0.935}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":37,"examples":[{"address":"vehicle auction mitcham vehicle auction","count":3},{"address":"vehicle auction belvedere vehicle auction","count":3},{"address":"general auction \\| chesterfield \\| saleroom 38 \\| collection or delivery","count":5}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'johnpye' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"johnpye"}`
- **[info] bullet_starvation** — Bullet starvation: 109/131 (83%) lots have empty bullets
  - `{"empty":109,"total":131,"ratio":0.832}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (69 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":69,"examples":[{"address":"bolventor, launceston, cornwall pl15","count":5},{"address":"west looe hill, looe, pl13","count":5},{"address":"woodacott, holsworthy, ex22","count":4}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":15,"examples":[{"address":"swedish house, 1 dixons lane, broughton, stockbridge, hampshire, so20 8at","count":3},{"address":"21 strand-on-the-green, london, w4 3ph","count":5},{"address":"2 warren lane, dartington hall, totnes, devon, tq9 6eg","count":4}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (66 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":66,"examples":[{"address":"55 ashton road, southport, merseyside, pr8 4qf","count":3},{"address":"1 chesterfield road, oakerthorpe, alfreton, derbyshire, de55 7ln","count":3},{"address":"11 axwell terrace, swalwell, newcastle upon tyne, tyne and wear, ne16 3js","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 88/168 (52%) lots missing image_url
  - `{"missing":88,"total":168,"ratio":0.524}`

## lodgeandthomas

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"23 trewartha road, bodmin, cornwall, pl31 2je","count":3},{"address":"land at trenoweth, grampound road, truro, cornwall, tr2 4dy","count":3},{"address":"the bungalow, trenoweth, grampound road, truro, cornwall, tr2 4dy","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 83/83 (100%) lots missing image_url
  - `{"missing":83,"total":83,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"brookside, llandyrnog, denbigh, ll16 4hb","count":3},{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":5},{"address":"5 moonlight close, summerhill, wrexham, wrexham, ll11 4qj","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 14/18 (78%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":14,"total":18,"ratio":0.778}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 27/35 (77%) lots have empty bullets
  - `{"empty":27,"total":35,"ratio":0.771}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"64, northville road, filton, \\ bristol, bs7 0rg","count":3},{"address":"flat 1 plough house, 29, bedminster down road, bedminster, \\ bristol, bs13 7ab","count":3},{"address":"8, pows court, high street, midsomer norton, ba3 2le","count":3}]}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (57 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":57,"examples":[{"address":"abbeydale road, sheffield, south yorkshire","count":3},{"address":"unit 1 slate house, oakwood court, city road, bradford, west yorkshire bd8 8jy","count":3},{"address":"land at bent street & elm street, newsome, huddersfield, west yorkshire hd4 6nx","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 351/417 (84%) lots have empty bullets
  - `{"empty":351,"total":417,"ratio":0.842}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"bridgnorth road, kidderminster, worcestershire, dy11 5rr","count":3},{"address":"glascwm, llandrindod wells, powys, ld1 5se","count":3},{"address":"cae waldis, bronllys, powys, ld3 0la","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 54/59 (92%) lots have empty bullets
  - `{"empty":54,"total":59,"ratio":0.915}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":42,"examples":[{"address":"53 norfolk street, blackburn, bb2 4ew","count":7},{"address":"6 ruskin walk, bromley, br2 8ep","count":3},{"address":"garage 3 at, buckthorns, bracknell, rg42 1ta","count":4}]}`

## mellerbraggins

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"princess road, allostock","count":3}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":27,"examples":[{"address":"percy road southsea, po4 0bh","count":5},{"address":"eastney road southsea, po4 9jb","count":5},{"address":"st george's road, southsea po4 9pl","count":3}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 25 addresses appear ≥3 times each (83 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":25,"total_dupe_rows":83,"examples":[{"address":"17 north john street, liverpool, merseyside, l2 5qy","count":3},{"address":"breakspear road north, harefield, uxbridge, middlesex, ub9 6lz","count":3},{"address":"orton hall, orton, penrith, cumbria, ca10 3rf","count":4}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 89 addresses appear ≥3 times each (302 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":89,"total_dupe_rows":302,"examples":[{"address":"20 bessemer road, cardiff, cf11 8ba","count":3},{"address":"156 bute street, treherbert, treorchy, cf42 5pe","count":3},{"address":"bethany church, bethania street, glynneath, neath, sa11 5de","count":3}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"college road, woolston","count":4},{"address":"homeborough house, brinton lane, hythe","count":3},{"address":"property auctions            auction property search            auction results            blog","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 54/58 (93%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":54,"total":58,"ratio":0.931}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (60 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":60,"examples":[{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":5},{"address":"2 old watery lane, wooburn moor, high wycombe hp10 0ny","count":7},{"address":"unit 4a, carters square, uttoxeter, staffordshire st14 7fn","count":5}]}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (36 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":36,"examples":[{"address":"4 bryngelli road, treboeth, swansea, west glamorgan, sa5 9bb","count":3},{"address":"56 brighton road, gorseinon, swansea, west glamorgan, sa4 4bw","count":3},{"address":"the red lion inn, 24 randell square, porth tywyn, sir gar, sa16 0ub","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 68/70 (97%) lots have empty bullets
  - `{"empty":68,"total":70,"ratio":0.971}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (65 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":65,"examples":[{"address":"rosedale avenue, middlesbrough, ts4 2sf","count":5},{"address":"greendale crescent, clipston village, mansfield ng21 9bd","count":3},{"address":"mount pleasant, reading rg1 2tf","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 40 addresses appear ≥3 times each (127 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":40,"total_dupe_rows":127,"examples":[{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":3},{"address":"31 sandown crescent, manchester, greater manchester m18 7wg","count":3},{"address":"rose villa, welshpool road, bicton heath, shrewsbury, shropshire sy3 5ah","count":5}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 92 addresses appear ≥3 times each (341 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":92,"total_dupe_rows":341,"examples":[{"address":"apartment 18 smiths flour mill, 71 wolverhampton street, walsall, west midlands, ws2 8dd","count":5},{"address":"46 southfield road armthorpe, doncaster, south yorkshire, dn3 3bj","count":5},{"address":"5 defender walk, southampton, hampshire, so19 7gj","count":7}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (29 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":29,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":11},{"address":"1 antona gardens, raunds, northamptonshire, nn9 6eb","count":3},{"address":"40 main road, drayton parslow, buckinghamshire, mk17 0js","count":3}]}`

## rogerparry

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"63 coton manor, berwick road, shrewsbury, shropshire, sy1 2ly","count":5}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"39 edith mills close, neath, west glamorgan, sa11 2jl","count":3},{"address":"building plot, stanley road, garndiffaith, pontypool, gwent, np4 7ly","count":3}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"the cottage, new ridley, stocksfield, northumberland, ne43 7rg","count":3},{"address":"43 edgmond court, sunderland, tyne and wear, sr2 0dx","count":3},{"address":"57 biddlestone road, newcastle upon tyne, tyne and wear, ne6 5sl","count":3}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":33,"examples":[{"address":"61 tower heights, hoddesdon, herts, en11 8uh","count":3},{"address":"200 whitehorse lane, south norwood, london se25 6ux","count":3},{"address":"59 southern parade, preston, pr1 4nj","count":3}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":22,"examples":[{"address":"3 clinton street, worksop, nottinghamshire s80 2ry","count":4},{"address":"garsdale street methodist chapel, garsdale, sedbergh la10 5pq","count":3},{"address":"8 st. annes street, preston, lancashire pr1 6ds","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 147/147 (100%) lots have empty bullets
  - `{"empty":147,"total":147,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 147/147 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":147,"total":147,"ratio":1}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat a & b, 77 john street, porthcawl, cf36 3ay","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (83 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":83,"examples":[{"address":"12a byron studios, byron street bradford, bd3 0au","count":6},{"address":"25 the grand mill 132, sunbridge road bradford, bd1 2pf","count":4},{"address":"210, southfield lane bradford, bd7 3nq","count":5}]}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"1 stuart street, corner of narborough road, leicester, le3 0du","count":3},{"address":"321 sample lane, liverpool, l1 3cd","count":3},{"address":"25 bruce street, off narborough road, leicester, le3 0af","count":3}]}`

## strakers

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct addresses share one image_url
  - `{"image_url":"https://ggfx-strakers.s3.eu-west-2.amazonaws.com/x.prod/456x438/arthur_5788dd7ea8.webp","distinct_addresses":3}`
- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":15,"examples":[{"address":"not available","count":15}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (57 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":57,"examples":[{"address":"9 station road, westcliff-on-sea, essex, ss0 7ra","count":4},{"address":"flat 2, instow house marine parade, instow, bideford, devon, ex39 4jj","count":3},{"address":"22 mansfield hill, london, e4 7ju","count":3}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"405 & 405a cherry lane, liverpool, merseyside, l4 8sb","count":3},{"address":"apartment 2, 75 henry street, liverpool, merseyside, l1 5bu","count":3},{"address":"123 example street, liverpool, l1 2ab","count":3}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"madison vean, hayle, tr27","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 35/52 (67%) lots missing image_url
  - `{"missing":35,"total":52,"ratio":0.673}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 60 addresses appear ≥3 times each (197 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":60,"total_dupe_rows":197,"examples":[{"address":"rose cottage, church lane, bankfoot, perth, perthshire, ph1 4bd","count":3},{"address":"178 weaste lane, salford, lancashire, m5 5jl","count":3},{"address":"former empire theatre, deepdale road, loftus, redcar and cleveland, ts13 4rs","count":4}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":4},{"address":"118 graig road, morriston, swansea, west glamorgan, sa6 8pq","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (64 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":64,"examples":[{"address":"unit on west side 1 birstall road, liverpool, l6 9ah","count":3},{"address":"apartment 5 11 sir thomas street, liverpool, l1 6bw","count":3},{"address":"apartment 4, 10b moss street, liverpool, l6 1hd","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 77/94 (82%) lots have empty bullets
  - `{"empty":77,"total":94,"ratio":0.819}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"wetherby, west yorkshire","count":4},{"address":"33 elm street, bradford, west yorkshire, bd7 1ap","count":3},{"address":"3 cavendish terrace, leeds, west yorkshire, ls8 1nd","count":3}]}`

## williamhbrownnorwich

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"3, ladysmock way, norwich, norfolk nr5 9fg","count":3},{"address":"springfields, 18, hall road, great yarmouth, norfolk nr29 4pd","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 42/42 (100%) lots have empty bullets
  - `{"empty":42,"total":42,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 42/42 (100%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":42,"total":42,"ratio":1}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (41 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":41,"examples":[{"address":"61 church street, newry","count":7},{"address":"dun an óir 1 lios darog, shannon, co clare","count":3},{"address":"10 ballyphilip road, portaferry, newtownards","count":5}]}`


## Auto-fixes applied

- **hero_image_bleed**: nulled 5 row(s) across 1 house(s).
  - `strakers` × 5 — `https://ggfx-strakers.s3.eu-west-2.amazonaws.com/x.prod/456x438/arthur_5788dd7ea8.webp`

