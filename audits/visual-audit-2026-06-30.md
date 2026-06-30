# Visual Audit — 2026-06-30

Scanned **26,841** rows in **16411ms** across **132** houses with findings.

**Findings:** 130 error · 17 warn · 24 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":10,"examples":[{"address":"new north road, exeter, ex4 4hf","count":4},{"address":"the avenue, minehead, ta24 5ay","count":6}]}`

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"138 broadway, didcot, oxfordshire, ox11 8rj","count":5},{"address":"ye olde rose & crown, 53 hoe street, walthamstow, london, e17 4sa","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (154 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":154,"examples":[{"address":"land adjacent to 2-8 exmoor rise, ashford, kent, tn24 8qr","count":12},{"address":"land at broadmead court, broadmead road, send, surrey, gu23 7aa","count":7},{"address":"pumping station, st michaels road, sittingbourne, kent, me10 1ax","count":7}]}`
- **[warn] identical_price_wall** — Identical-price wall: 151/273 (55%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":151,"total":273,"ratio":0.553}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 31 addresses appear ≥3 times each (119 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":31,"total_dupe_rows":119,"examples":[{"address":"1-12 & 14-19 patina walk, rotherhithe, london, se16 5ht","count":3},{"address":"5-6 bower terrace, maidstone, kent, me16 8ry","count":3},{"address":"61 broomielaw, glasgow, lanarkshire, g1 4rj","count":3}]}`

## allwalesauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (93 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":93,"examples":[{"address":"ye olde mill , llanfairfechan, gwynedd, ll33 0ts","count":6},{"address":"windsor court,, conwy, ll31 9tn","count":6},{"address":"highbury, llanfairfechan, ll33 0al","count":6}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":20,"examples":[{"address":"nelson avenue, south shields, ne33","count":3},{"address":"wellands lane, whitburn, sr6","count":3},{"address":"st. michaels avenue, south shields, ne33","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 67/67 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":67,"total":67,"ratio":1}`

## astleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (32 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":32,"examples":[{"address":"6 gardners lane, neath, west glamorgan, sa11 2aa","count":5},{"address":"7 cae terrace, llanelli, dyfed, sa15 1hn","count":5},{"address":"10 hill road, neath abbey, neath, west glamorgan, sa10 7nr","count":5}]}`

## auctionhammermidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"76 stebbings, sutton hill, telford, shropshire tf7 4jw","count":4},{"address":"land adjacent 2, warrington street, fenton, stoke-on-trent, staffordshire st4 3lf","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 37/42 (88%) lots have empty bullets
  - `{"empty":37,"total":42,"ratio":0.881}`
- **[info] image_domain_mismatch** — Image domain mismatch: 42/42 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":42,"total":42,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (108 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":108,"examples":[{"address":"98 hillside avenue blaenavon, pontypool, torfaen, np4 9je","count":3},{"address":"59 eastgate, worksop, nottinghamshire, s80 1re","count":3},{"address":"midhurst teston road, west malling, kent, me19 5ns","count":3}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":27,"examples":[{"address":"7b market square, buckingham, buckinghamshire mk18 1nj","count":4},{"address":"21 greenfield road, pulloxhill, bedford mk45 5ez","count":4},{"address":"31b stanley street, luton, bedfordshire lu1 5al","count":5}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (77 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":77,"examples":[{"address":"apartment 124 smiths flour mill, walsall, west midlands ws2 8de","count":5},{"address":"212 canal wharf, 12 waterfront walk, birmingham, west midlands b1 1sn","count":6},{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":9}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":31,"examples":[{"address":"brimington social club, 33 high street, brimington, chesterfield, derbyshire s43 1hh","count":4},{"address":"12 park view, hasland, chesterfield, derbyshire s41 0jd","count":4},{"address":"25 sterland street, chesterfield, derbyshire s40 1bn","count":4}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":27,"examples":[{"address":"963 cedar lane, warwick, cv6 6ff","count":3},{"address":"246 birch crescent, coventry, cv8 8hh","count":3},{"address":"68 lawrence saunders road, radford, coventry, west midlands cv6 1hd","count":8}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (48 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":48,"examples":[{"address":"134 petteril street, carlisle, cumbria ca1 2aw","count":3},{"address":"28 anson street, barrow-in-furness, cumbria la14 1uz","count":3},{"address":"low lickbarrow farm, lickbarrow close, windermere, cumbria la23 2nf","count":3}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (57 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":57,"examples":[{"address":"2 selley walk, bristol bs13 7sf","count":3},{"address":"suhaili, prussia cove road, rosudgeon, penzance, cornwall tr20 9ax","count":4},{"address":"25 newman road, exeter, devon ex4 1pl","count":4}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (175 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":175,"examples":[{"address":"103 gloucester street, norwich, norfolk nr2 2dy","count":10},{"address":"54 yarmouth road caister-on-sea, great yarmouth, norfolk, nr30 5bt","count":3},{"address":"flat 105 21b st. matthews street, ipswich, suffolk, ip1 3el","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":20,"examples":[{"address":"flat 11, lilystone hall, honeypot lane, stock, ingatestone, essex cm4 9gj","count":7},{"address":"39 primrose hill, chelmsford, essex cm1 2rh","count":7},{"address":"7 york mews, great wakering, southend-on-sea, essex ss3 0fa","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 35/35 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":35,"total":35,"ratio":1}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":35,"examples":[{"address":"moat farm, southside road, halsham, east yorkshire, hu12 0bp","count":3},{"address":"325 spring bank west, hull, east yorkshire, hu3 1lb","count":3},{"address":"the railings, albemarle back road, scarborough, north yorkshire, yo11 1ya","count":3}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"flat 34 fisgard court, gravesend, kent, da12 2aw","count":4}]}`

## auctionhouseleicestershire

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":12,"examples":[{"address":"15, 15 sandhurst street oadby, leicester, leicestershire, le2 5ar","count":4},{"address":"27 clarence street, loughborough, leicestershire, le11 1dx","count":4},{"address":"29 hill street barwell, leicester, leicestershire, le9 8bj","count":4}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 65 addresses appear ≥3 times each (369 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":65,"total_dupe_rows":369,"examples":[{"address":"6 speedwell place, worksop, nottinghamshire, s80 1uh","count":3},{"address":"6 rectory avenue, gainsborough, lincolnshire, dn21 2je","count":3},{"address":"stow road, stowmarket, suffolk, ip14 5xv","count":6}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 763/961 (79%) lots have no price + no price_text
  - `{"tba":763,"total":961,"ratio":0.794}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 41 addresses appear ≥3 times each (188 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":41,"total_dupe_rows":188,"examples":[{"address":"118 salt hill way, slough, buckinghamshire, sl1 3tx","count":3},{"address":"8 pine view, platt, sevenoaks, kent, tn15 8la","count":3},{"address":"10 ferrara close, darfield, barnsley, south yorkshire, s73 9rb","count":3}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (48 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":48,"examples":[{"address":"3 bulls head court yard, commercial road, tideswell, buxton, derbyshire, sk17 8nu","count":3},{"address":"apartment 22, 427, ashton old road, manchester, m11 2dl","count":8},{"address":"white bull, 159-161 livesey branch road, blackburn, lancashire, bb2 4qr","count":6}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (73 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":73,"examples":[{"address":"chime house audlem road, crewe, cheshire, cw3 0je","count":6},{"address":"20 hawkins close rothwell, kettering, northamptonshire, nn14 6tb","count":6},{"address":"clover garth, taylor lane, holmpton, withernsea, east yorkshire, hu19 2qz","count":7}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"23 and 23a colwyn road, northampton, northamptonshire nn1 3pz","count":4},{"address":"16 longueville court, lumbertubs, northampton, northamptonshire, nn3 8hj","count":5}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (135 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":135,"examples":[{"address":"34 fern avenue, stanley, county durham, dh9 7qy","count":3},{"address":"the mill house, road from knitsley to knitsley bridge, knitsley, durham, dh8 9el","count":3},{"address":"5 egerton street, sunderland, tyne and wear, sr2 8dt","count":3}]}`

## auctionhousenorthernireland

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"83 gulladuff hill knockloughrim, magherafelt, county londonderry, bt45 8pa","count":7}]}`
- **[warn] identical_price_wall** — Identical-price wall: 7/8 (88%) lots share price £50000 — extractor likely picking up hero/banner price
  - `{"price":50000,"count":7,"total":8,"ratio":0.875}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"456 high road, manchester, m1 2ab","count":7}]}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 63 addresses appear ≥3 times each (306 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":63,"total_dupe_rows":306,"examples":[{"address":"apartment 408, 9 burton place, manchester, greater manchester m15 4lr","count":3},{"address":"flat 85, southmoor, 23 glebelands road, manchester, greater manchester m23 1hr","count":3},{"address":"flat 16, maritime court, promenade, southport, merseyside pr8 1sp","count":3}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"4/6 lonsdale terrace, edinburgh, midlothian, eh3 9hn","count":3}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 39 addresses appear ≥3 times each (212 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":39,"total_dupe_rows":212,"examples":[{"address":"6 & 8 seafield street, banff, banffshire ab45 1ds","count":5},{"address":"flat d, 426 great northern road, aberdeen, aberdeen city ab24 2ba","count":5},{"address":"former united free church, aberdeen, aberdeenshire ab42 3nb","count":9}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 324/329 (98%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":324,"total":329,"ratio":0.985}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 25 addresses appear ≥3 times each (121 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":25,"total_dupe_rows":121,"examples":[{"address":"32 beach road, weston-super-mare bs23 1ba","count":3},{"address":"winscote, rackenford, tiverton, devon ex16 8du","count":12},{"address":"93 wallace road, bodmin, cornwall pl31 2ex","count":6}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 49 addresses appear ≥3 times each (172 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":49,"total_dupe_rows":172,"examples":[{"address":"flat 55 coode, sheffield, south yorkshire, s3 8nr","count":3},{"address":"31. court road, wolverhampton, west midlands, wv6 0jn","count":3},{"address":"67 montserrat road, bolton, lancashire, bl1 5uf","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1477/1551 (95%) lots have no price + no price_text
  - `{"tba":1477,"total":1551,"ratio":0.952}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (49 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":49,"examples":[{"address":"103 queensway, winsford, cheshire, cw7 1bn","count":6},{"address":"14 claughton avenue, crewe, cheshire, cw2 6ez","count":6},{"address":"12 hunters hill weaverham, northwich, cheshire, cw8 3pf","count":6}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":27,"examples":[{"address":"3 sheringham court, redcar, cleveland, ts10 2rr","count":6},{"address":"29 askew dale, guisborough, north yorkshire ts14 8jg","count":7},{"address":"62 derwent street, hartlepool, cleveland ts26 8bn","count":3}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 46 addresses appear ≥3 times each (196 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":46,"total_dupe_rows":196,"examples":[{"address":"15 third avenue, wembley, middlesex, ha9 8qe","count":3},{"address":"5 & 7 grants walk & 8 bodmin road, st. austell, cornwall, pl25 5aa","count":3},{"address":"8 pine view, platt, sevenoaks, kent, tn15 8la","count":6}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (72 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":72,"examples":[{"address":"flat 1 ormeside court, llandudno, conwy, ll30 2hg","count":6},{"address":"21 south luton place, cardiff, cf24 0ex","count":6},{"address":"dina, 2 tan y coed, colwyn bay, clwyd, ll28 5rr","count":6}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (84 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":84,"examples":[{"address":"9 newstead avenue, fitzwilliam, pontefract, west yorkshire wf9 5dt","count":3},{"address":"5 cobbler hall, bretton, wakefield, west yorkshire wf4 4lj","count":3},{"address":"land at radcliffe gardens, pudsey, leeds, west yorkshire, ls28 8bg","count":3}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"16 gloucester terrace, haswell, durham, county durham, dh6 2eg","count":7}]}`
- **[warn] identical_price_wall** — Identical-price wall: 11/12 (92%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":11,"total":12,"ratio":0.917}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (77 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":77,"examples":[{"address":"53, dominica court, eastbourne, bn23 5tr","count":5},{"address":"jubilee farm, purlieu lane, godshill, fordingbridge, sp6 2lw","count":7},{"address":"garage 26, the drive, hove, bn3 3jd","count":7}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 27/27 (100%) lots have empty bullets
  - `{"empty":27,"total":27,"ratio":1}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":21,"examples":[{"address":"flat 50, broadwalk court, 79, palace gardens terrace, london, london, w8 4ef","count":7},{"address":"flat 8, mathieson house, crescent road, london, e4 6bl","count":7},{"address":"30, coldshott, oxted, surrey, rh8 9bj","count":4}]}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"bushey, hertfordshire","count":4}]}`

## bowensonandwatson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":11,"examples":[{"address":"tan yr allt farm, ffordd las, cymau, wrexham, ll11 5ey","count":4},{"address":"3 ruthin road, wrexham, ll13 7nu","count":7}]}`

## bradleyhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":19,"examples":[{"address":"northumbria house, church avenue, scotland gate, choppington, northumberland, ne62 5se","count":7},{"address":"cherry trees, brunton lane, newcastle upon tyne, tyne and wear, ne13 9al","count":7},{"address":"17e queen street, quayside, newcastle upon tyne, tyne and wear, ne1 3ug","count":5}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":24,"examples":[{"address":"chapel lane, moldgreen, huddersfield","count":3},{"address":"dewhurst road, huddersfield","count":5},{"address":"prospect view, queensbury, bradford","count":3}]}`

## brggibsondublin

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (112 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":112,"examples":[{"address":"8 monabraher road, ballynanty, limerick, co. limerick, v94 we2y","count":7},{"address":"5, greggs hill, arklow, co. wicklow, y14 de93","count":7},{"address":"stranamart, blacklion, county cavan, f91 a0h2","count":7}]}`

## brownco

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":14,"examples":[{"address":"5 the close, holt, norfolk, nr25 6dd","count":7},{"address":"27-31 high street, mildenhall, bury st. edmunds, suffolk, ip28 7ea","count":7}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"topcon technology site cirencester road, minchinhampton, stroud, gloucestershire, gl6 9bh","count":7}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (99 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":99,"examples":[{"address":"site of former spiritualist church, vernon street, nelson, lancashire bb9 9de","count":5},{"address":"the cube, flat 51 btc-5104, 87 bradshawgate, bolton, lancashire bl1 1qd","count":5},{"address":"21 rosedale avenue, alvaston, derby de24 0fl","count":5}]}`
- **[info] bullet_starvation** — Bullet starvation: 345/459 (75%) lots have empty bullets
  - `{"empty":345,"total":459,"ratio":0.752}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (49 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":49,"examples":[{"address":"2 & 4 bagnall road, stoke st2 7az","count":5},{"address":"stoke-on-trent st1 6","count":5},{"address":"mill green, congleton","count":5}]}`

## carterjonas

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"land at stanton fitzwarren, wiltshire, sn3 4tg","count":4}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":6,"examples":[{"address":"34 market street, exeter, ex1 1bs","count":6}]}`
- **[warn] image_coverage_low** — Image coverage low: 42/54 (78%) lots missing image_url
  - `{"missing":42,"total":54,"ratio":0.778}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (32 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":32,"examples":[{"address":"1 high street, cambridge, cb1 4aa","count":3},{"address":"10 oak avenue, haverhill, cb9 9bb","count":3},{"address":"5 elm road, cambridge, cb2 3aa","count":3}]}`

## cheffinstimed

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"unit 3b cowley road, blyth riverside business park, blyth, northumberland, ne24 5tf","count":7}]}`

## cityandruralpropertyauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 9/9 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":9,"total":9,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":15,"examples":[{"address":"67 central road, leiston, suffolk, ip16 4dd","count":3},{"address":"40 & 40a, westgate street, ipswich, suffolk, ip1 3ed","count":4},{"address":"17-19-19a, high street, saxmundham, suffolk, ip17 1df","count":3}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 30 addresses appear ≥3 times each (133 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":30,"total_dupe_rows":133,"examples":[{"address":"dover - kent","count":9},{"address":"andover - hampshire","count":5},{"address":"tonbridge - kent","count":6}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":37,"examples":[{"address":"southwell road, london, se5","count":6},{"address":"land at sandy lane north, wirral, merseyside, ch61 4xu","count":3},{"address":"land at washpond lane, warlingham, surrey, cr6 9qd","count":5}]}`

## cottons

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (45 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":45,"examples":[{"address":"329 shaftmoor lane, hall green, birmingham, b28 8sj","count":3},{"address":"black lees farm, wolverhampton road, shareshill, wolverhampton, west mids, wv10 7ly","count":7},{"address":"land lying to the north of, drawbridge road, shirley, solihull, worcestershire, b90 1dd","count":7}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 35 addresses appear ≥3 times each (155 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":35,"total_dupe_rows":155,"examples":[{"address":"17 glencairn road, liverpool, merseyside, l13 2al","count":4},{"address":"13 - 14 the strand, dawlish, devon, ex7 9ps","count":7},{"address":"56 daniel place, penzance, cornwall, tr18 4du","count":6}]}`

## dawsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"28, lakefield road llanelli, sa15 2ue","count":6},{"address":"28, western lane mumbles, swansea, sa3 4ey","count":3}]}`

## dedmangray

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":6,"examples":[{"address":"1 main street, london, e1 1aa","count":6}]}`
- **[warn] identical_price_wall** — Identical-price wall: 8/8 (100%) lots share price £250000 — extractor likely picking up hero/banner price
  - `{"price":250000,"count":8,"total":8,"ratio":1}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 10/10 (100%) lots have no price + no price_text
  - `{"tba":10,"total":10,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 10/10 (100%) lots missing image_url
  - `{"missing":10,"total":10,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 10/10 (100%) lots have empty bullets
  - `{"empty":10,"total":10,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 31 addresses appear ≥3 times each (162 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":31,"total_dupe_rows":162,"examples":[{"address":"kensington street, rochdale, ol11","count":3},{"address":"edge lane, droylsden, greater manchester, m43","count":3},{"address":"flat 30 ,the pack horse nelson square, bolton, bl1","count":6}]}`
- **[info] bullet_starvation** — Bullet starvation: 270/330 (82%) lots have empty bullets
  - `{"empty":270,"total":330,"ratio":0.818}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 40 addresses appear ≥3 times each (207 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":40,"total_dupe_rows":207,"examples":[{"address":"35 westridge road, southampton, hampshire, so17 2hp","count":4},{"address":"69 woodfield road, pinxton, nottingham, nottinghamshire, ng16 6jq","count":4},{"address":"146 caswell close, farnborough, hampshire, gu14 8tg","count":4}]}`

## fishergerman

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"12 metford evegate business park, smeeth, ashford, kent, tn25 6sx","count":4}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":35,"examples":[{"address":"land at yarrow way, locks heath, southampton, so31 6th","count":3},{"address":"bridge cottage, burgate, fordingbridge, sp6 1lx","count":5},{"address":"land on north east side of 68 bracken road, north baddesley, southampton, so52 9dn","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 106 addresses appear ≥3 times each (390 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":106,"total_dupe_rows":390,"examples":[{"address":"44 randolph street, buckhaven","count":4},{"address":"fradon, strathpeffer, contin","count":3},{"address":"30 castleton drive, newton mearns","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 594/594 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":594,"total":594,"ratio":1}`

## goldings

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"flats a,b & c, 81 burrell road, ipswich, suffolk, ip2 8ad","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 4/6 (67%) lots share price £500000 — extractor likely picking up hero/banner price
  - `{"price":500000,"count":4,"total":6,"ratio":0.667}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (76 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":76,"examples":[{"address":"south allington, kingsbridge, devon, tq7","count":6},{"address":"eastside lane, bawdrip, bridgwater, somerset, ta7","count":6},{"address":"barton st. david, somerston, somerset, ta11","count":6}]}`

## hairandson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":6,"examples":[{"address":"789 park lane, rochford, ss4 1ed","count":6}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (60 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":60,"examples":[{"address":"4 jubilee way, platt lane, whitchurch, sy13 2ny","count":6},{"address":"14, oswalds well lane, oswestry, sy11 2tp","count":6},{"address":"5, high lea close, oswestry, sy11 1sx","count":6}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 28 addresses appear ≥3 times each (125 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":28,"total_dupe_rows":125,"examples":[{"address":"143 tudor walk, watford, hertfordshire, wd24 7nz","count":9},{"address":"a former bank / shop and four bedroom mid-terrace house","count":3},{"address":"a raised ground floor studio flat","count":5}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":31,"examples":[{"address":"apartment 19 echo building, west wear street, sunderland, tyne and wear, sr1 1xd","count":4},{"address":"flat 3 waterloo house, thornaby place, thornaby, stockton-on-tees, cleveland, ts17 6sa","count":3},{"address":"1 farcroft grove, sheffield, south yorkshire, s4 8bp","count":3}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"25 princess road, ripon, north yorkshire, hg4 1hw","count":3},{"address":"3 st. johns road, burnley, lancashire, bb12 6rp","count":5}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":16,"examples":[{"address":"6 braybrooke terrace, hastings, east sussex, tn34 1td","count":4},{"address":"30 mersey walk, warrington, cheshire, wa4 1su","count":4},{"address":"8 kingsway, nuneaton, warwickshire, cv11 5lp","count":4}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":16,"examples":[{"address":"ashford market, kent","count":13},{"address":"ashford market, ashford","count":3}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 84 addresses appear ≥3 times each (427 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":84,"total_dupe_rows":427,"examples":[{"address":"fishponds road, fishponds, bs16 3tt","count":3},{"address":"baroda, the avenue, combe down, bath, ba2 5eq","count":3},{"address":"hampton road, redland, bs6 6hp","count":5}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"680 unique square, southampton, so1 1aa","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":21,"examples":[{"address":"goodwin road, sheffield, s8 9tj","count":3},{"address":"mayfield terrace, bishop auckland, dl13 5ea","count":3},{"address":"bacup road, todmorden, ol14 7hq","count":3}]}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":25,"examples":[{"address":"gloster street, bolton, lancashire, bl2 2bh","count":3},{"address":"weeford road, sutton coldfield, west midlands, b75 5re","count":4},{"address":"moreton way, slough, berkshire, sl1 5lt","count":4}]}`

## johnfrancis

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (43 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":43,"examples":[{"address":"spring gardens, whitland, carmarthens...","count":7},{"address":"cwel_icon_solid_listlist iconicon set listlist","count":6},{"address":"owls lodge lane, mayals, swansea, sa3","count":5}]}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":15,"examples":[{"address":"general auction \\| chesterfield \\| saleroom 36 \\| collection or delivery","count":4},{"address":"general auction \\| birmingham \\| premium room \\| home delivery","count":4},{"address":"general auction \\| nottingham \\| premium room \\| home delivery","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 85/104 (82%) lots have empty bullets
  - `{"empty":85,"total":104,"ratio":0.817}`

## jonespeckover

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"0.99 acres of land, leadbrook drive, flint, flintshire, ch6 5st","count":4},{"address":"pump field, grange road, llangollen, wrexham, ll20 8ap","count":3}]}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (49 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":49,"examples":[{"address":"stratton road, bude, cornwall ex23","count":3},{"address":"trewidland, land known as furzedon field, pl14","count":3},{"address":"ashwater, beaworthy, ex21","count":4}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":28,"examples":[{"address":"stanbrook farm, newent road, staunton, gloucester, gloucestershire, gl19 3qr","count":3},{"address":"swedish house, 1 dixons lane, broughton, stockbridge, hampshire, so20 8at","count":4},{"address":"21 strand-on-the-green, london, w4 3ph","count":4}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 23 addresses appear ≥3 times each (95 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":23,"total_dupe_rows":95,"examples":[{"address":"apartment 5, 191 water street, manchester, lancashire, m3 4ja","count":4},{"address":"flat 1, 35 gardens lane, conisbrough, doncaster, south yorkshire, dn12 3jx","count":3},{"address":"83 clowes street, manchester, lancashire, m12 5fy","count":3}]}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 53/53 (100%) lots missing image_url
  - `{"missing":53,"total":53,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":3},{"address":"ty cenin, dyffryn ardudwy, merionethshire, ll44 2dg","count":3},{"address":"6 fifth avenue, llay, wrexham, clwyd, ll12 0tp","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 20/30 (67%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":20,"total":30,"ratio":0.667}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":31,"examples":[{"address":"49 caldecott street, hillmorton, rugby, west midlands cv21 3th","count":7},{"address":"flat 1, walton court, 100 bath street, rugby, warwickshire cv21 3jd","count":5},{"address":"flat 5, the mews 15-17, north street, atherstone, west midlands cv9 1jn","count":5}]}`
- **[info] bullet_starvation** — Bullet starvation: 34/47 (72%) lots have empty bullets
  - `{"empty":34,"total":47,"ratio":0.723}`

## luscombemaye

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"harbour view, 7 - 8 passage road, noss mayo, plymouth, pl8 1ew","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 20/25 (80%) lots have empty bullets
  - `{"empty":20,"total":25,"ratio":0.8}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":38,"examples":[{"address":"8, pows court, high street, midsomer norton, ba3 2le","count":6},{"address":"487, gloucester road, horfield, bristol, bs7 8ua","count":7},{"address":"52, st johns lane, bedminster, bristol, bs3 5ad","count":7}]}`
- **[warn] image_coverage_low** — Image coverage low: 61/97 (63%) lots missing image_url
  - `{"missing":61,"total":97,"ratio":0.629}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 29 addresses appear ≥3 times each (158 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":29,"total_dupe_rows":158,"examples":[{"address":"35 highbury avenue, nottingham, nottinghamshire ng6 9db","count":3},{"address":"exchange house, 6 marton road, middlesbrough, north yorkshire ts1 1db","count":3},{"address":"flat 8, ridgeway court, 224 warwick avenue, derby de23 6lh","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 382/455 (84%) lots have empty bullets
  - `{"empty":382,"total":455,"ratio":0.84}`

## martinpole

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"3 cranford park drive, yateley, hampshire, gu46 6jr","count":5},{"address":"6 havelock road, wokingham, berkshire, rg41 2xu","count":3},{"address":"19 the broadway, newbury, berkshire, rg14 1as","count":3}]}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"load street, bewdley, worcestershire, dy12 2as","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 57/65 (88%) lots have empty bullets
  - `{"empty":57,"total":65,"ratio":0.877}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (59 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":59,"examples":[{"address":"61 fairywell road, timperley, altrincham, wa15 6xb","count":3},{"address":"44(a) loscoe road, heanor, de75 7ff","count":3},{"address":"27 sandcliff road, erith, da8 1nz","count":3}]}`

## mellerbraggins

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"weaver view, weaverham, northwich","count":3},{"address":"princess road, allostock","count":6}]}`
- **[warn] identical_price_wall** — Identical-price wall: 6/9 (67%) lots share price £485000 — extractor likely picking up hero/banner price
  - `{"price":485000,"count":6,"total":9,"ratio":0.667}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"villiers road southsea, po5 2hg","count":3},{"address":"forton road gosport, po12 3hd","count":6}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 38 addresses appear ≥3 times each (128 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":38,"total_dupe_rows":128,"examples":[{"address":"ulster street, burnley, lancashire, bb11 4nx","count":7},{"address":"westward way, harrow, ha3 0se","count":7},{"address":"front street, newbiggin-by-the-sea, northumberland, ne64 6ad","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 394/778 (51%) lots missing image_url
  - `{"missing":394,"total":778,"ratio":0.506}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 180 addresses appear ≥3 times each (797 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":180,"total_dupe_rows":797,"examples":[{"address":"50 maesglas avenue, newport, gwent, np20 3br","count":3},{"address":"2 springfield workshops, llanarth road, pontllanfraith, blackwood, np12 2lg","count":3},{"address":"30 fields road, newport, np19 8el","count":3}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":12,"examples":[{"address":"auction - white star place, southampton","count":4},{"address":"new forest car sales, ringwood road, southampton","count":5},{"address":"midanbury, southampton","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/40 (93%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":37,"total":40,"ratio":0.925}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (65 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":65,"examples":[{"address":"90 willenhall drive, hayes, middlesex ub3 2ux","count":6},{"address":"98 princes road, watford, hertfordshire wd18 7rs","count":7},{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":5}]}`

## phillipssmithanddunn

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"lower park road ex33 2lh","count":7}]}`
- **[warn] identical_price_wall** — Identical-price wall: 7/9 (78%) lots share price £820000 — extractor likely picking up hero/banner price
  - `{"price":820000,"count":7,"total":9,"ratio":0.778}`

## probateauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"6 dinas road, cheltenham, gloucestershire, gl51 3ew","count":3},{"address":"25 kemplay road, hampstead, london, nw3 1ta","count":3},{"address":"land adjoining, 5 long lane, newport, isle of wight, po30 2nh","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 13/19 (68%) lots missing image_url
  - `{"missing":13,"total":19,"ratio":0.684}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":18,"examples":[{"address":"111 pant y celyn road, townhill, swansea, west glamorgan, sa1 6nd","count":7},{"address":"92 st. catherine street, carmarthen, dyfed, sa31 1rf","count":7},{"address":"64 tirgof, llangennech, llanelli, dyfed, sa14 8tp","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 45/50 (90%) lots have empty bullets
  - `{"empty":45,"total":50,"ratio":0.9}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (70 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":70,"examples":[{"address":"watermarque, 100 browning street, birmingham, b16 8gy","count":3},{"address":"blackstock road, gleadless, sheffield, s14 1lb","count":3},{"address":"hilton heights, woodside, aberdeen, ab24 4qe","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 138 addresses appear ≥3 times each (606 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":138,"total_dupe_rows":606,"examples":[{"address":"62 market street, bolton, lancashire bl4 7ny","count":3},{"address":"land to the rear of 14 beech walk, mill hill, london nw7 3ph","count":3},{"address":"land off campbell road, swinton, manchester, greater manchester m27 5gq","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 112 addresses appear ≥3 times each (616 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":112,"total_dupe_rows":616,"examples":[{"address":"3 main street, rotherham, rotherham, south yorkshire, s63 9jx","count":3},{"address":"158 grange road erdington, birmingham, west midlands, b24 0ex","count":3},{"address":"16 belgrave park, halifax, west yorkshire, hx3 6bb","count":3}]}`

## rendells

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"myrtle cottage, eastdown, devon, tq9 7ap","count":3},{"address":"drayford unit, 30 quay road, newton abbot, tq12 2bu","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":27,"examples":[{"address":"6 bull close, bozeat, northamptonshire, nn29 7lr","count":5},{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":14},{"address":"flat 6, 37 studley road, luton, bedfordshire, lu3 1bb","count":4}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (56 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":56,"examples":[{"address":"3 powells place, newport, gwent, np20 1el","count":3},{"address":"building plots, charles street, tredegar, gwent, np22 4ad","count":3},{"address":"building plot, stanley road, garndiffaith, pontypool, gwent, np4 7ly","count":8}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"17 march courtyard, ash street, gateshead, tyne and wear, ne8 2gf","count":4},{"address":"3 shibdon road, blaydon-on-tyne, tyne and wear, ne21 5af","count":3},{"address":"28 boyd street, newburn, newcastle upon tyne, tyne and wear, ne15 8lu","count":3}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":31,"examples":[{"address":"land and buildings on the west side of curnick's lane, west norwood, london, se27 0ur","count":4},{"address":"land at a82, west larach, ballachulish ph49 4jx","count":4},{"address":"7 glumangate, chesterfield s40 1tp","count":7}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":20,"examples":[{"address":"158 daubney street and 48 & 48a johnson street, cleethorpes, lincolnshire dn35 7nu","count":3},{"address":"land at chatterton hey, exchange street, edenfield, ramsbottom, bury, lancashire bl0 0qh","count":4},{"address":"the cottage, r/o 46 church street, paignton, devon tq3 3ah","count":4}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 228/228 (100%) lots have empty bullets
  - `{"empty":228,"total":228,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 228/228 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":228,"total":228,"ratio":1}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (71 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":71,"examples":[{"address":"land and buildings at church crescent, beaufort, ebbw vale, np23 5pe","count":3},{"address":"34 caerau road, maesteg, cf34 0pb","count":3},{"address":"former katz nightclub, north east side of queen street back road, neath, sa11 1ee","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 23 addresses appear ≥3 times each (103 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":23,"total_dupe_rows":103,"examples":[{"address":"57, cottam terrace bradford, bd7 2bn","count":3},{"address":"24, woodstock walk bradford, bd5 0td","count":4},{"address":"59, ferncliffe road, bingley, bradford, bd16 4pn","count":3}]}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (52 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":52,"examples":[{"address":"42 & 42a wigston street, countesthorpe, leicestershire, le8 5rq","count":5},{"address":"123 example street, london, e1 1eg","count":7},{"address":"17 longhurst close, rushey mead, leicester, le4 7wa","count":4}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"st aubyn's engine house, redruth, tr16 5hd","count":5},{"address":"hawkers wood land at penrose , bodmin, pl30 4qy","count":3}]}`

## starpropertyonline

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"53 rushlake road, brighton, east sussex, bn1 9ag","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":30,"examples":[{"address":"78 oak drive, trowbridge, ba14 9de","count":3},{"address":"not available","count":7},{"address":"123 example street, chippenham, sn15 1aa","count":4}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 36 addresses appear ≥3 times each (154 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":36,"total_dupe_rows":154,"examples":[{"address":"98 rolls court, inks green, highams park, london, e4 9ej","count":3},{"address":"167 high street, staines, middlesex, tw18 4pa","count":4},{"address":"25 the drive, golders green, london, nw11 9sx","count":4}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"9 blackstone street, liverpool, merseyside, l5 9ty","count":3},{"address":"warwick house, 16a morrab place, penzance, cornwall, tr18 4dg","count":4},{"address":"456 sample road, liverpool, l2 3cd","count":3}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 257 addresses appear ≥3 times each (1326 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":257,"total_dupe_rows":1326,"examples":[{"address":"flat 1 romney court, shepherds bush green, london, w12 8py","count":9},{"address":"16 redworth road, shildon, durham, dl4 2je","count":6},{"address":"130 broomfield road, coventry, west midlands, cv5 6jy","count":6}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (40 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":40,"examples":[{"address":"4 bonython drive, grampound, truro, tr2 4rl","count":4},{"address":"apartment 424a, lakeshore drive, bristol, bs13 7be","count":3},{"address":"37 the purple apartments broadway plaza, birmingham, b16 8eq","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (90 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":90,"examples":[{"address":"67 peter road, liverpool, l4 3rt","count":7},{"address":"apartment 4, 10b moss street, liverpool, l6 1hd","count":8},{"address":"apartment 2 26 cornhill, liverpool, l1 8dt","count":9}]}`
- **[info] bullet_starvation** — Bullet starvation: 120/126 (95%) lots have empty bullets
  - `{"empty":120,"total":126,"ratio":0.952}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":27,"examples":[{"address":"the old post office, main street, grassington, skipton, north yorkshire, bd23 5aa","count":3},{"address":"42 cavendish road, morecambe, lancashire, la4 5ap","count":3},{"address":"taunton, somerset","count":7}]}`

## williamhbrownnorwich

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"5, the coach house, 44, cromer road, norwich, norfolk nr11 8db","count":4},{"address":"1, ladysmock way, norwich, norfolk nr5 9fg","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 38/40 (95%) lots have empty bullets
  - `{"empty":38,"total":40,"ratio":0.95}`
- **[info] image_domain_mismatch** — Image domain mismatch: 38/40 (95%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":38,"total":40,"ratio":0.95}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (77 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":77,"examples":[{"address":"57 gateside crescent, airdrie, north lanarkshire","count":6},{"address":"63 kilnside road, paisley, renfrewshire","count":6},{"address":"5 sandelfields, coleraine","count":6}]}`


