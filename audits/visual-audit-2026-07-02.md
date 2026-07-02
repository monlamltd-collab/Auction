# Visual Audit — 2026-07-02

Scanned **27,598** rows in **20898ms** across **113** houses with findings.

**Findings:** 106 error · 11 warn · 25 info

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"holland and barrett, 253 high street, bangor, clwyd, ll57 1pb","count":4}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"beatrice street, ashington","count":3},{"address":"coatham road, redcar","count":4}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (50 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":50,"examples":[{"address":"land lying to the west of featherby road, gillingham, kent, me8 6dp","count":4},{"address":"land at the gavel, south molton, devon, ex36 4bp","count":3},{"address":"land at brewers lane, gosport, hampshire, po13 0ju","count":3}]}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"widewater place, moorhall road, harefield, uxbridge, ub9 6ns","count":3},{"address":"lesser knowlesthorpe, barton mill road, canterbury, kent, ct1 1bp","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"hopkins walk, south shields, ne34","count":3},{"address":"market lane, dunston, ne11","count":3},{"address":"stanhope road, south shields, ne33","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 65/65 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":65,"total":65,"ratio":1}`

## astleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"57 hafod street, swansea, west glamorgan, sa1 2hb","count":3}]}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 45/46 (98%) lots have empty bullets
  - `{"empty":45,"total":46,"ratio":0.978}`
- **[info] image_domain_mismatch** — Image domain mismatch: 46/46 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":46,"total":46,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 94 addresses appear ≥3 times each (296 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":94,"total_dupe_rows":296,"examples":[{"address":"jillians cottage, stryt issa, wrexham, clwyd, ll14 2pn","count":4},{"address":"3 lys an pons crockwell street, bodmin, cornwall, pl31 2ds","count":4},{"address":"4 linden street, nottingham, nottinghamshire, ng3 4nd","count":5}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"7b market square, buckingham, buckinghamshire mk18 1nj","count":3},{"address":"15 belvoir walk, bedford, bedfordshire mk41 8lf","count":3},{"address":"49 copenhagen close, luton, bedfordshire lu3 3tf","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"319 blackpool street, burton-on-trent, west midlands de14 3aw","count":3}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"brimington social club, 33 high street, brimington, chesterfield, derbyshire s43 1hh","count":3},{"address":"2 the poplars, main road, cutthorpe, chesterfield, derbyshire, s42 7ah","count":3},{"address":"47 haldane crescent, bolsover, chesterfield, derbyshire, s44 6ru","count":3}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":35,"examples":[{"address":"60 ridgethorpe, willenhall, coventry, west midlands cv3 3gq","count":3},{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":4},{"address":"148 poole road, radford, coventry, west midlands cv6 1hw","count":3}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (45 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":45,"examples":[{"address":"17 brow top, workington, cumbria ca14 2dp","count":3},{"address":"the flat, kirk allans, stock lane, grasmere, ambleside, cumbria la22 9sn","count":3},{"address":"flat 1, jubilee apartments, kendal, cumbria la9 4lr","count":3}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"flat 114, 29 phoenix street, plymouth, devon pl1 3dn","count":3},{"address":"flat 10b ridge house, trenance road, st. austell, cornwall pl25 5aj","count":3},{"address":"flat 2, 252 albert road, plymouth, devon pl2 1aw","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (74 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":74,"examples":[{"address":"greenwood house, mouth lane, north brink, wisbech pe13 4uq","count":3},{"address":"holly farm house, 34 loddon road, norton subcourse, norwich, norfolk nr14 6rt","count":3},{"address":"103 gloucester street, norwich, norfolk nr2 2dy","count":5}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"flat 11, lilystone hall, honeypot lane, stock, ingatestone, essex cm4 9gj","count":3},{"address":"5 shirley court, sedley rise, loughton, essex ig10 1lu","count":3},{"address":"169/169a dunstans road, east dulwich, southwark, london se22 0hb","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 27/28 (96%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":27,"total":28,"ratio":0.964}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":28,"examples":[{"address":"6 holderness villas, ceylon street, hull, east yorkshire, hu9 5rq","count":4},{"address":"'the red lion' + 2 new dwellings, 57 middle street north, driffield, east yorkshire, yo25 6ss","count":3},{"address":"325 spring bank west, hull, east yorkshire, hu3 1lb","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 76 addresses appear ≥3 times each (242 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":76,"total_dupe_rows":242,"examples":[{"address":"room 20, salem street student accomodation salem street, hallgate, bradford, west yorkshire, bd1 4qd","count":3},{"address":"115 rutland street, grimsby, south humberside, dn32 7nf","count":3},{"address":"9 rydal avenue grangetown, middlesbrough, cleveland, ts6 7qg","count":4}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 616/792 (78%) lots have no price + no price_text
  - `{"tba":616,"total":792,"ratio":0.778}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 52 addresses appear ≥3 times each (244 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":52,"total_dupe_rows":244,"examples":[{"address":"118 salt hill way, slough, buckinghamshire, sl1 3tx","count":4},{"address":"8 pine view, platt, sevenoaks, kent, tn15 8la","count":3},{"address":"sold prior for","count":12}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (44 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":44,"examples":[{"address":"58 gramfield road, huddersfield, west yorkshire, hd4 5qd","count":3},{"address":"646 halifax road, todmorden, ol14 6dw","count":4},{"address":"16 orme avenue, alkrington, middleton, m24 1es","count":3}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"57 south market road, great yarmouth, norfolk, nr30 2bt","count":3},{"address":"22 gedling street, mansfield, nottinghamshire, ng18 4ah","count":4}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"10 ringwood close, northampton, northamptonshire nn2 8qg","count":3},{"address":"22 hill street, kettering, northamptonshire nn16 8ee","count":3},{"address":"flat 10, 1a midland road, wellingborough, northamptonshire nn8 1ha","count":3}]}`

## auctionhousenortheast

- **[warn] guide_tba_wall** — Guide-TBA wall: 129/179 (72%) lots have no price + no price_text
  - `{"tba":129,"total":179,"ratio":0.721}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 8/12 (67%) lots missing image_url
  - `{"missing":8,"total":12,"ratio":0.667}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 28 addresses appear ≥3 times each (92 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":28,"total_dupe_rows":92,"examples":[{"address":"flat 85, southmoor, 23 glebelands road, manchester, greater manchester m23 1hr","count":5},{"address":"apartment 305, the litmus building, 195 huntingdon street, nottingham, nottinghamshire ng1 3nt","count":3},{"address":"flats 1, 2, 3, 4, 5 & 6, 90 woodchurch lane, birkenhead, merseyside ch42 9pd","count":3}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"land at heron glade gateford, worksop, nottinghamshire, s81 8up","count":3},{"address":"6/8 bruntsfield place, edinburgh, midlothian, eh10 4hn","count":4}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 41 addresses appear ≥3 times each (157 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":41,"total_dupe_rows":157,"examples":[{"address":"127, fraser studios, 140, causewayend, aberdeen, ab25 3tf","count":3},{"address":"6 & 8 seafield street, banff, banffshire ab45 1ds","count":4},{"address":"flat d, 426 great northern road, aberdeen, aberdeen city ab24 2ba","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 302/303 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":302,"total":303,"ratio":0.997}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"harvenna house, 33 hendra road, st. dennis, st. austell, cornwall pl26 8eq","count":3},{"address":"farm house, snodwell farm, post lane, cotleigh, honiton, devon ex14 9hz","count":3},{"address":"7 godwin court, swindon, wiltshire, sn1 4bb","count":4}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 153 addresses appear ≥3 times each (498 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":153,"total_dupe_rows":498,"examples":[{"address":"187 tallants road, coventry, west midlands, cv6 7fq","count":3},{"address":"stephenson street, ferryhill, county durham, dl17 8pg","count":5},{"address":"plots 51 and 52, land denby line, garden lane, doncaster, south yorkshire, dn5 7sn","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1350/1429 (94%) lots have no price + no price_text
  - `{"tba":1350,"total":1429,"ratio":0.945}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"72 court street madeley, telford, shropshire, tf7 5ep","count":3},{"address":"land @ hawthorn drive, poole, dorset, bh17 7up","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"overdale, 12 thornborough crescent, leyburn, north yorkshire dl8 5dy","count":3},{"address":"93 broadway east, redcar, north yorkshire ts10 5dt","count":4},{"address":"18 st. ann's terrace, stockton-on-tees, county durham ts18 2ht","count":3}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 52 addresses appear ≥3 times each (174 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":52,"total_dupe_rows":174,"examples":[{"address":"18 market street, scarborough, north yorkshire, yo11 1ey","count":3},{"address":"230 maiden lane, crayford, dartford, kent, da1 4ps","count":5},{"address":"31 liden close, walthamstow, london, e17 8hq","count":3}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (45 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":45,"examples":[{"address":"32 bentley street farnworth, bolton, lancashire, bl4 7pw","count":4},{"address":"16 westland view luston, leominster, herefordshire, hr6 0ea","count":3},{"address":"glanrafon holyhead road, betws-y-coed, conwy, ll24 0bn","count":5}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"9 newstead avenue, fitzwilliam, pontefract, west yorkshire wf9 5dt","count":3},{"address":"flat 30, northgate house, 35 stonegate road, leeds, west yorkshire ls6 4fl","count":3},{"address":"110 trinity one, east street, leeds, west yorkshire ls9 8ae","count":3}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"40 baff street, spennymoor, county durham, dl16 7tz","count":3},{"address":"28 commercial street, willington, crook, county durham, dl15 0ad","count":3},{"address":"36 commercial street, willington, crook, county durham, dl15 0ad","count":3}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":42,"examples":[{"address":"chantlers, village street, ewhurst green, robertsbridge, tn32 5td","count":3},{"address":"53 dominica court, eastbourne, bn23 5tr","count":3},{"address":"flat 3, 40 tivoli crescent, brighton, bn1 5nd","count":3}]}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"32-34 the cornmarket, derby, derbyshire, de1 2dg","count":5}]}`
- **[info] bullet_starvation** — Bullet starvation: 49/52 (94%) lots have empty bullets
  - `{"empty":49,"total":52,"ratio":0.942}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"flat 1, beaumont court, upper clapton road, clapton, london, e5 8bg","count":4}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"7 tucker street, briton ferry, neath, west glamorgan sa11 2sp, united kingdom","count":3},{"address":"2 old church court, 40 weaste road, salford, m5 5fw, united kingdom","count":3},{"address":"garages at vernon close, st albans, hertfordshire al1 1pb, united kingdom","count":3}]}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"116 vicarage road, wednesbury, ws10 9dp","count":3}]}`

## bradleysdevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"30 high street, london, w1d 4eg","count":3},{"address":"10 downing street, london, sw1a 2aa","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"prospect view, queensbury, bradford","count":3},{"address":"birkby lodge road, huddersfield","count":4},{"address":"tolson crescent, huddersfield","count":3}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (65 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":65,"examples":[{"address":"flat 1019, churchill place, churchill way, basingstoke, hampshire rg21 7es","count":4},{"address":"land at and to the rear of 3 heath view cottages, copthorne common, copthorne, crawley, west sussex rh10 3lf","count":3},{"address":"63 george street, walsall, west midlands ws1 1rs","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 491/671 (73%) lots have empty bullets
  - `{"empty":491,"total":671,"ratio":0.732}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"underwood lane, crewe","count":3},{"address":"bagnall road, stoke-on-trent st2 7az","count":3},{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":5}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"the old post office, fore street, st keverne, cornwall, tr12 6ql","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 232/282 (82%) lots missing image_url
  - `{"missing":232,"total":282,"ratio":0.823}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"789 oak road, newmarket, cb8 7aa","count":3},{"address":"123 high street, cambridge, cb1 1aa","count":3}]}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":7,"examples":[{"address":"for sale by auction29th april 2026","count":7}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 17/17 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":17,"total":17,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"sunnyholme, rishangles, eye, suffolk, ip23 7lb","count":4},{"address":"40 & 40a, westgate street, ipswich, suffolk, ip1 3ed","count":3}]}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":15,"examples":[{"address":"carlton terrace, swansea, city and county of swansea.","count":5},{"address":"talog, carmarthen, carmarthenshire.","count":6},{"address":"walter road, ammanford, carmarthenshire.","count":4}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 40 addresses appear ≥3 times each (194 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":40,"total_dupe_rows":194,"examples":[{"address":"dover - kent","count":13},{"address":"andover - hampshire","count":7},{"address":"folkestone - kent","count":4}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (89 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":89,"examples":[{"address":"13 - 14 the strand, dawlish, devon, ex7 9ps","count":3},{"address":"56 daniel place, penzance, cornwall, tr18 4du","count":4},{"address":"7 the cliff, mevagissey, st. austell, cornwall, pl26 6qt","count":3}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 11/11 (100%) lots have no price + no price_text
  - `{"tba":11,"total":11,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 11/11 (100%) lots missing image_url
  - `{"missing":11,"total":11,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 11/11 (100%) lots have empty bullets
  - `{"empty":11,"total":11,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (44 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":44,"examples":[{"address":"petersburg road, edgeley, stockport, sk3","count":3},{"address":"tynedale square, highwoods, colchester, co4","count":3},{"address":"ember street, clayton, greater manchester, m11","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 272/298 (91%) lots have empty bullets
  - `{"empty":272,"total":298,"ratio":0.913}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (34 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":34,"examples":[{"address":"plot 4 - land on the south side of the warren, caversham, reading, berkshire, rg4 7th","count":4},{"address":"55 eccles way, nottingham, nottinghamshire, ng3 3dg","count":5},{"address":"flat 3 waterford court, leeland terrace, london, w13 9hl","count":3}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"32/34 london road, southampton, hampshire so15 2ag","count":3},{"address":"gff, 1 albion terrace, bath, ba1 3af","count":5}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 83 addresses appear ≥3 times each (292 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":83,"total_dupe_rows":292,"examples":[{"address":"52 morrison way, livingston","count":4},{"address":"44 randolph street, buckhaven","count":3},{"address":"20 montrose street, flat 28, merchant city, glasgow","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 659/660 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":659,"total":660,"ratio":0.998}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"wharfdale cottage, minsterley road, pontesbury, shrewsbury, sy5 0ql","count":3},{"address":"the gate house, plot 8 - whitehall gardens, monkmoor road, shrewsbury, sy2 5ap","count":3},{"address":"plot 116 - the cutler, darwin's edge, hereford road, shrewsbury, sy3 9nb","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 46 addresses appear ≥3 times each (170 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":46,"total_dupe_rows":170,"examples":[{"address":"a former bank / shop and four bedroom mid-terrace house","count":3},{"address":"plot of land","count":4},{"address":"flat 30 kimpton court, 2 murrain road, london, n4 2bn","count":3}]}`

## hawkesford

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at leamington road, ryton-on-dunsmore","count":3}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat 3 waterloo house, thornaby place, thornaby, stockton-on-tees, cleveland, ts17 6sa","count":3}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"3 st. johns road, burnley, lancashire, bb12 6rp","count":5},{"address":"flat 15 wheatsheaf court, kendall road, colchester, essex, co1 2bu","count":3},{"address":"87 ashington grove, coventry, west midlands, cv3 4dd","count":3}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"3 pembroke avenue, bristol, avon, bs11 9sj","count":3},{"address":"flat 1, 14 green lane, kettering, north northamptonshire, nn16 0da","count":4},{"address":"35 gilsland road, thornton heath, surrey, cr7 8rq","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":11,"examples":[{"address":"ashford market, kent","count":7},{"address":"ashford market, ashford, kent","count":4}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 54 addresses appear ≥3 times each (218 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":54,"total_dupe_rows":218,"examples":[{"address":"hampton road, redland, bs6 6hp","count":4},{"address":"134, high street, tewkesbury, gl20 5jr","count":5},{"address":"walton road, clevedon, bs21 6an","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"main street, shildon, dl4 1aw","count":3}]}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 9/9 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":9,"total":9,"ratio":1}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":47,"examples":[{"address":"vehicle auction mitcham vehicle auction","count":3},{"address":"project telecoms infrastructure","count":3},{"address":"business for sale – project wholesale","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 104/127 (82%) lots have empty bullets
  - `{"empty":104,"total":127,"ratio":0.819}`

## jonespeckover

- **[warn] identical_price_wall** — Identical-price wall: 7/11 (64%) lots share price £20000 — extractor likely picking up hero/banner price
  - `{"price":20000,"count":7,"total":11,"ratio":0.636}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (70 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":70,"examples":[{"address":"woodacott, holsworthy, devon ex22","count":4},{"address":"stratton road, bude, cornwall ex23","count":8},{"address":"ashwater, beaworthy, ex21","count":3}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":28,"examples":[{"address":"land at great treadam farm (47.73 acres), abergavenny, monmouthshire, np7 8ta","count":4},{"address":"2 warren lane, dartington hall, totnes, devon, tq9 6eg","count":3},{"address":"cottage, 4 holt road, bradford-on-avon, wiltshire, ba15 1aj","count":3}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (79 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":79,"examples":[{"address":"apartment 5, 191 water street, manchester, lancashire, m3 4ja","count":4},{"address":"flat 1, 35 gardens lane, conisbrough, doncaster, south yorkshire, dn12 3jx","count":3},{"address":"83 clowes street, manchester, lancashire, m12 5fy","count":3}]}`

## lodgeandthomas

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"6 meadow lane, st. columb, cornwall, tr9 6bj","count":3},{"address":"12 trewartha road, bodmin, cornwall, pl31 2je","count":3},{"address":"11 trewartha road, bodmin, cornwall, pl31 2je","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 60/60 (100%) lots missing image_url
  - `{"missing":60,"total":60,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"ty cenin, dyffryn ardudwy, merionethshire, ll44 2dg","count":5},{"address":"6 fifth avenue, llay, wrexham, clwyd, ll12 0tp","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 25/44 (57%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":25,"total":44,"ratio":0.568}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"land 14 - 16 ash green lane, ash green, coventry, warwickshire cv7 9ah","count":3},{"address":"46 purcell road, courthouse green, coventry, west midlands cv6 7jz","count":3},{"address":"land and buildings off vinecote road, longford, coventry, west midlands cv6 6dz","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 30/42 (71%) lots have empty bullets
  - `{"empty":30,"total":42,"ratio":0.714}`

## lsh

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"29 pondecroft, aylesbury, buckinghamshire, hp18 0fs","count":3},{"address":"unit 12a cobalt business park, silver fox way, west allotment, north tyneside, ne27 0qj","count":3},{"address":"former colt international site, new lane, havant, hampshire, po9 2sl","count":3}]}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 14/15 (93%) lots have empty bullets
  - `{"empty":14,"total":15,"ratio":0.933}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3, baugh road, downend,bristol, bs16 6pl","count":3}]}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"eldon arms, eldon terrace, ferryhill, durham dl17 0aw","count":3},{"address":"13 florence avenue, bolton, lancashire bl1 8rq","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 282/330 (85%) lots have empty bullets
  - `{"empty":282,"total":330,"ratio":0.855}`
- **[info] image_domain_mismatch** — Image domain mismatch: 313/330 (95%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":313,"total":330,"ratio":0.948}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":24,"examples":[{"address":"load street, bewdley, worcestershire, dy12 2as","count":5},{"address":"baskerville road, kidderminster, worcestershire, dy10 2ye","count":3},{"address":"baldwin road, stourport-on-severn, worcestershire, dy13 9au","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 80/93 (86%) lots have empty bullets
  - `{"empty":80,"total":93,"ratio":0.86}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 40 addresses appear ≥3 times each (122 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":40,"total_dupe_rows":122,"examples":[{"address":"land between, 24 & 26 aylesbury drive, great notley, braintree, cm77 7aw","count":3},{"address":"18 malvern road, cambridge, cb1 9ld","count":3},{"address":"15 draughton street, bradford, bd5 9qq","count":3}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"francis avenue, southsea po4 0aj","count":3},{"address":"st george's road, southsea po4 9pl","count":3},{"address":"st ronans road, southsea po4 0pt","count":3}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 64 addresses appear ≥3 times each (199 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":64,"total_dupe_rows":199,"examples":[{"address":"front street, newbiggin-by-the-sea, northumberland, ne64 6ad","count":4},{"address":"cecil avenue, skegness, lincolnshire, pe25 2bx","count":3},{"address":"pensby road, heswall, wirral, merseyside, ch60 7re","count":7}]}`
- **[warn] image_coverage_low** — Image coverage low: 441/880 (50%) lots missing image_url
  - `{"missing":441,"total":880,"ratio":0.501}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 125 addresses appear ≥3 times each (460 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":125,"total_dupe_rows":460,"examples":[{"address":"83-89 heol-y-parc, north cornelly, bridgend, mid glamorgan, cf33 4ly","count":3},{"address":"the observatory, warren's road, trelleck, monmouth, gwent, np25 4pq","count":3},{"address":"land to the rear of, 16-24 chestnut way, merthyr tydfil, mid glamorgan, cf47 9sb","count":3}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"highfield lane, southampton","count":4},{"address":"north road, clanfield","count":3},{"address":"bellair house, havant","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 62/66 (94%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":62,"total":66,"ratio":0.939}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":27,"examples":[{"address":"90 willenhall drive, hayes, middlesex ub3 2ux","count":3},{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":3},{"address":"site rear of 6 woodham lane, new haw, addlestone kt15 3na","count":4}]}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"64 tirgof, llangennech, llanelli, dyfed, sa14 8tp","count":4},{"address":"62 stepney road, burry port, dyfed, sa16 0be","count":3}]}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"westbeach, westward ho, bideford, devon, ex39 1lq","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":47,"examples":[{"address":"145 town lane, whittle-le-woods, chorley, lancashire pr6 8ag","count":3},{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":3},{"address":"35 springcliffe, bradford, west yorkshire bd8 8qp","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 66 addresses appear ≥3 times each (209 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":66,"total_dupe_rows":209,"examples":[{"address":"flat 34 mitton lodge, vale road, stourport-on-severn, worcestershire, dy13 8gb","count":3},{"address":"38 hope street, ashton-under-lyne, lancashire, ol6 9sn","count":3},{"address":"134 southey green road, sheffield, south yorkshire, s5 8ha","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":12,"examples":[{"address":"6 bull close, bozeat, northamptonshire, nn29 7lr","count":3},{"address":"greyfriars, cold brayfield, olney, buckinghamshire, mk46 4hs","count":3},{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":6}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"building plots, charles street, tredegar, gwent, np22 4ad","count":3},{"address":"21 george street, pontypool, gwent, np4 6lr","count":3},{"address":"flat 1, 114 st. mary street, risca, newport, gwent, np11 6gr","count":3}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (50 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":50,"examples":[{"address":"306 old durham road, gateshead, tyne and wear, ne8 4bq","count":3},{"address":"2 rokeby street, newcastle upon tyne, tyne and wear, ne15 8rr","count":4},{"address":"2 bridlington avenue, gateshead, tyne and wear, ne9 6xj","count":3}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"land at brocks lane, frilsham, berkshire, rg18 9uy","count":3},{"address":"unit 6 station court, station approach, borough green, sevenoaks, kent tn15 8bg","count":3},{"address":"13 topcliffe street, hartlepool, ts26 8ll","count":3}]}`

## sdl

- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 44/44 (100%) lots have empty bullets
  - `{"empty":44,"total":44,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 44/44 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":44,"total":44,"ratio":1}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (89 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":89,"examples":[{"address":"7 blanche street, cardiff, cf24 1qs","count":3},{"address":"gatesgarth, blaenavon road, govilon, abergavenny, np7 9pf","count":3},{"address":"land at baldwins crescent, swansea, sa1 8pt","count":4}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (76 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":76,"examples":[{"address":"12a byron studios, byron street bradford, bd3 0au","count":4},{"address":"210, southfield lane bradford, bd7 3nq","count":3},{"address":"10 quebec street bradford, bd1 2er","count":4}]}`

## sheldonbosley

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"15 belle vue terrace, ludlow, shropshire, sy8 2nz","count":3},{"address":"45 arden way, alveley, bridgnorth, shropshire, wv15 6nr","count":3},{"address":"5 oak hill, wolverhampton, west midlands, wv3 9ae","count":4}]}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (60 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":60,"examples":[{"address":"42 & 42a wigston street, countesthorpe, leicestershire, le8 5rq","count":3},{"address":"17 longhurst close, rushey mead, leicester, le4 7wa","count":4},{"address":"76 guthlaxton street, highfields, leicester, le2 0se","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 63/82 (77%) lots have empty bullets
  - `{"empty":63,"total":82,"ratio":0.768}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"st aubyn's engine house, redruth, tr16 5hd","count":4},{"address":"ravenshoe, beaminster, dt6 3uh","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":9,"examples":[{"address":"not available","count":9}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":22,"examples":[{"address":"167 high street, staines, middlesex, tw18 4pa","count":3},{"address":"77-81 alma road, clifton, bristol, bs8 2dp","count":3},{"address":"the knot barn, 1 station road, padstow, cornwall, pl28 8db","count":3}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":33,"examples":[{"address":"789 test avenue, liverpool, l3 4ef","count":4},{"address":"456 high st, liverpool, l2 2bb","count":3},{"address":"45 pine street, liverpool, l8 1bl","count":3}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"quarry close, swanage, bh19","count":3},{"address":"bradon lane, ilminster, ta3","count":3}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 266 addresses appear ≥3 times each (1322 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":266,"total_dupe_rows":1322,"examples":[{"address":"flat 1 romney court, shepherds bush green, london, w12 8py","count":3},{"address":"16 redworth road, shildon, durham, dl4 2je","count":5},{"address":"the old smithy cottage, st. ive, liskeard, cornwall, pl14 3nb","count":6}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":19,"examples":[{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":4},{"address":"8 furze crescent, morriston, swansea, west glamorgan, sa6 6bp","count":3},{"address":"land rear of 8 brynawelon road, cwmllynfell, swansea, west glamorgan, sa9 2wg","count":5}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"55 caludon road, coventry, cv2 4lr","count":4},{"address":"flat 46 nelson court glen view, gravesend, da12 1pl","count":3},{"address":"50 barnes road, stafford, st17 9rl","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (132 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":132,"examples":[{"address":"67 peter road, liverpool, l4 3rt","count":3},{"address":"apartment 4, 10b moss street, liverpool, l6 1hd","count":6},{"address":"17 heswall road, liverpool, l9 4se","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 134/156 (86%) lots have empty bullets
  - `{"empty":134,"total":156,"ratio":0.859}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"halifax, west yorkshire","count":5}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 32/34 (94%) lots have empty bullets
  - `{"empty":32,"total":34,"ratio":0.941}`
- **[info] image_domain_mismatch** — Image domain mismatch: 32/34 (94%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":32,"total":34,"ratio":0.941}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"top floor flat, 40 bedford road, aberdeen, aberdeenshire","count":3},{"address":"63 kilnside road, paisley, renfrewshire","count":3},{"address":"drumgullane east, kinsalebeg, co. waterford, p36 n447","count":3}]}`


