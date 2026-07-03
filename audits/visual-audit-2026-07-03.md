# Visual Audit — 2026-07-03

Scanned **27,705** rows in **18013ms** across **121** houses with findings.

**Findings:** 117 error · 13 warn · 24 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"mill street, bideford, ex39 2jt","count":3}]}`

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"16/16a king street, thetford, norfolk, ip24 2ap","count":3},{"address":"39 vineyard path, mortlake, richmond upon thames, london, sw14 8el","count":4},{"address":"new look, 91 to 101 lower precinct, coventry, warwickshire, cv1 1ds","count":4}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"beatrice street, ashington","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (51 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":51,"examples":[{"address":"land lying to the west of featherby road, gillingham, kent, me8 6dp","count":3},{"address":"plot 7 and roadways adjoining the hartings, bognor regis, west sussex, po22 6qf","count":3},{"address":"land at the gavel, south molton, devon, ex36 4bp","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 109/197 (55%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":109,"total":197,"ratio":0.553}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (103 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":103,"examples":[{"address":"lesser knowlesthorpe, barton mill road, canterbury, kent, ct1 1bp","count":3},{"address":"the carriage house, grosvenor road, tunbridge wells, tn1 2ax","count":3},{"address":"stepney lane, newcastle","count":3}]}`

## allwalesauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"gwynfryn , llanfairfechan, ll33 0dw","count":3},{"address":"bron dinas, llangefni, isle of anglesey, ll77 7rw","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":31,"examples":[{"address":"trajan street & roman road, south shields, ne33","count":3},{"address":"hedworth lane, boldon colliery, ne35","count":4},{"address":"hopkins walk, south shields, ne34","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 81/81 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":81,"total":81,"ratio":1}`

## auctionestates

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land between 21 & 19 porlock road, enfield, middlesex, en1 2nh","count":3}]}`

## auctionhammermidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":22,"examples":[{"address":"1 harvey crescent, wellington, telford, shropshire tf1 2nz","count":3},{"address":"59 st. vincent road, walton, stone, staffordshire st15 0du","count":3},{"address":"1a priorslee road, snedshill, telford, shropshire tf2 9ea","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 74/75 (99%) lots have empty bullets
  - `{"empty":74,"total":75,"ratio":0.987}`
- **[info] image_domain_mismatch** — Image domain mismatch: 75/75 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":75,"total":75,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 58 addresses appear ≥3 times each (185 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":58,"total_dupe_rows":185,"examples":[{"address":"4 linden street, nottingham, nottinghamshire, ng3 4nd","count":3},{"address":"apartment 3 delamere place, runcorn, cheshire, wa7 4ne","count":3},{"address":"49 kingfisher road north cornelly, bridgend, cf33 4nz","count":3}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"49 copenhagen close, luton, bedfordshire lu3 3tf","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":20,"examples":[{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":4},{"address":"319 blackpool street, burton-on-trent, west midlands de14 3aw","count":3},{"address":"34 hamilton road, handsworth, birmingham, west midlands b21 8ah","count":4}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"2 the poplars, main road, cutthorpe, chesterfield, derbyshire, s42 7ah","count":3},{"address":"49 castle hill, eckington, sheffield, derbyshire, s21 4ax","count":3}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 39 addresses appear ≥3 times each (129 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":39,"total_dupe_rows":129,"examples":[{"address":"60 ridgethorpe, willenhall, coventry, west midlands cv3 3gq","count":3},{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":6},{"address":"148 poole road, radford, coventry, west midlands cv6 1hw","count":3}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 25 addresses appear ≥3 times each (101 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":25,"total_dupe_rows":101,"examples":[{"address":"the flat, kirk allans, stock lane, grasmere, ambleside, cumbria la22 9sn","count":4},{"address":"134 petteril street, carlisle, cumbria ca1 2aw","count":5},{"address":"28 anson street, barrow-in-furness, cumbria la14 1uz","count":3}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (69 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":69,"examples":[{"address":"flat 10b ridge house, trenance road, st. austell, cornwall pl25 5aj","count":3},{"address":"16 somerset square nailsea, bristol, avon, bs48 1rp","count":3},{"address":"8 mason street, reading, berkshire, rg1 7pd","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 114 addresses appear ≥3 times each (373 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":114,"total_dupe_rows":373,"examples":[{"address":"plot at 2 crow hall farm cottage, nightingale lane, downham market, norfolk pe38 9fd","count":3},{"address":"103 gloucester street, norwich, norfolk nr2 2dy","count":4},{"address":"flat 20, white lodge, 2, cromer road, sheringham, nr26 8rp","count":4}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"flat 11, lilystone hall, honeypot lane, stock, ingatestone, essex cm4 9gj","count":3},{"address":"5 shirley court, sedley rise, loughton, essex ig10 1lu","count":3},{"address":"286 london road, benfleet, essex ss7 5xr","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 23/24 (96%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":23,"total":24,"ratio":0.958}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (46 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":46,"examples":[{"address":"6 holderness villas, ceylon street, hull, east yorkshire, hu9 5rq","count":3},{"address":"'the red lion' + 2 new dwellings, 57 middle street north, driffield, east yorkshire, yo25 6ss","count":4},{"address":"325 spring bank west, hull, east yorkshire, hu3 1lb","count":4}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (76 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":76,"examples":[{"address":"33 derwent way, gillingham, kent, me8 0bt","count":3},{"address":"flat 14 providence house, maidenhead, berkshire, sl6 8bf","count":3},{"address":"26 kings road, high wycombe, buckinghamshire, hp11 1sa","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (88 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":88,"examples":[{"address":"room 20, salem street student accomodation salem street, hallgate, bradford, west yorkshire, bd1 4qd","count":3},{"address":"115 rutland street, grimsby, south humberside, dn32 7nf","count":3},{"address":"the buttercross hall burwell, louth, lincolnshire, ln11 8pr","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 334/477 (70%) lots have no price + no price_text
  - `{"tba":334,"total":477,"ratio":0.7}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 60 addresses appear ≥3 times each (238 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":60,"total_dupe_rows":238,"examples":[{"address":"118 salt hill way, slough, buckinghamshire, sl1 3tx","count":4},{"address":"sold prior for","count":8},{"address":"65 highwood avenue, high wycombe, buckinghamshire, hp12 4ls","count":4}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (72 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":72,"examples":[{"address":"apartment 22, 427, ashton old road, manchester, m11 2dl","count":3},{"address":"3 kirkby avenue, moston, manchester, m40 5hn","count":3},{"address":"58 gramfield road, huddersfield, west yorkshire, hd4 5qd","count":4}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 29 addresses appear ≥3 times each (87 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":29,"total_dupe_rows":87,"examples":[{"address":"102. edenhurst road, birmingham, west midlands, b31 4pl","count":3},{"address":"the royal hotel whitby road, loftus, cleveland, ts13 4lq","count":3},{"address":"141 longford road longford, coventry, west midlands, cv6 6ed","count":3}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (29 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":29,"examples":[{"address":"13 thrush close, corby, northamptonshire nn18 8fg","count":4},{"address":"7 cameron crescent, northampton, northamptonshire nn5 5pd","count":4},{"address":"1 knights court, little billing, northampton, northamptonshire nn3 9at","count":3}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 82 addresses appear ≥3 times each (304 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":82,"total_dupe_rows":304,"examples":[{"address":"24 crosby street, darlington, county durham dl3 0hd","count":3},{"address":"52 basingstoke road, peterlee, county durham sr8 2aw","count":3},{"address":"99 chestnut street, ashington, northumberland, ne63 0bp","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 467/637 (73%) lots have no price + no price_text
  - `{"tba":467,"total":637,"ratio":0.733}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 12/16 (75%) lots missing image_url
  - `{"missing":12,"total":16,"ratio":0.75}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 86 addresses appear ≥3 times each (280 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":86,"total_dupe_rows":280,"examples":[{"address":"flat 85, southmoor, 23 glebelands road, manchester, greater manchester m23 1hr","count":5},{"address":"10 rydal road, preston, lancashire pr1 5sl","count":3},{"address":"apartment 305, the litmus building, 195 huntingdon street, nottingham, nottinghamshire ng1 3nt","count":4}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (76 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":76,"examples":[{"address":"land at heron glade gateford, worksop, nottinghamshire, s81 8up","count":3},{"address":"4/6 lonsdale terrace, edinburgh, midlothian, eh3 9hn","count":3},{"address":"6/8 bruntsfield place, edinburgh, midlothian, eh10 4hn","count":3}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 60 addresses appear ≥3 times each (274 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":60,"total_dupe_rows":274,"examples":[{"address":"burnside, brough, whalsay, shetland, shetland islands ze2 9al","count":5},{"address":"127, fraser studios, 140, causewayend, aberdeen, ab25 3tf","count":4},{"address":"6 & 8 seafield street, banff, banffshire ab45 1ds","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 382/383 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":382,"total":383,"ratio":0.997}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"farm house, snodwell farm post lane, honiton, devon, ex14 9hz","count":3},{"address":"7 godwin court, swindon, wiltshire, sn1 4bb","count":4},{"address":"35 trevean road, truro, cornwall, tr1 3qp","count":3}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 126 addresses appear ≥3 times each (429 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":126,"total_dupe_rows":429,"examples":[{"address":"stephenson street, ferryhill, county durham, dl17 8pg","count":3},{"address":"plots 51 and 52, land denby line, garden lane, doncaster, south yorkshire, dn5 7sn","count":4},{"address":"38 victoria street goldthorpe, rotherham, south yorkshire, s63 9hs","count":4}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1272/1407 (90%) lots have no price + no price_text
  - `{"tba":1272,"total":1407,"ratio":0.904}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"apartment 8 cambridge court, ellesmere port, merseyside, ch65 4aq","count":3},{"address":"52 ford green road, stoke-on-trent, staffordshire, st6 1nx","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"62 derwent street, hartlepool, cleveland ts26 8bn","count":3},{"address":"93 broadway east, redcar, north yorkshire ts10 5dt","count":4},{"address":"18 st. ann's terrace, stockton-on-tees, county durham ts18 2ht","count":3}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 95 addresses appear ≥3 times each (304 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":95,"total_dupe_rows":304,"examples":[{"address":"19 east milton road, gravesend, kent, da12 2jl","count":4},{"address":"top floor flat, 302 lordship lane, london, southwark, se22 8ly","count":4},{"address":"58a herga road, harrow, middlesex, ha3 5as","count":3}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":42,"examples":[{"address":"11 australia road, cardiff, cf14 3bz","count":3},{"address":"flat 57 goodrich court, ross-on-wye, herefordshire, hr9 5ge","count":3},{"address":"32 bentley street farnworth, bolton, lancashire, bl4 7pw","count":4}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"24 aysgarth drive, leeds, west yorkshire ls9 9nx","count":3},{"address":"42 armley lodge road, leeds, west yorkshire ls12 2at","count":3},{"address":"flat 903 colonnade house, 201 sunbridge road, bradford, west yorkshire, bd1 2be","count":3}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (46 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":46,"examples":[{"address":"chantlers, village street, ewhurst green, robertsbridge, tn32 5td","count":3},{"address":"53 dominica court, eastbourne, bn23 5tr","count":3},{"address":"jubilee farm, purlieu lane, godshill, fordingbridge, sp6 2lw","count":3}]}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"32-34 the cornmarket, derby, derbyshire, de1 2dg","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 59/60 (98%) lots have empty bullets
  - `{"empty":59,"total":60,"ratio":0.983}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":25,"examples":[{"address":"11 aston chase, hemsworth, pontefract, west yorkshire, wf9 4rb, united kingdom","count":4},{"address":"unit 2a bennett house, the dean, alresford, hampshire so24 9bh, united kingdom","count":3},{"address":"apartment 15, the george hotel, high street, melton mowbray, leicestershire le13 0tu, united kingdom","count":4}]}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"land at the junction of barlows road & somerset road, edgbaston, birmingham, b15 2pn","count":4}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"dewhurst road, huddersfield","count":3},{"address":"654 simulation place, simulation city, qr9 0st","count":3},{"address":"456 sample avenue, sample city, ef3 4gh","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"cotswold farmyard development opportunity, great wolford, near moreton in marsh, cv36 5nq","count":3}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 25 addresses appear ≥3 times each (87 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":25,"total_dupe_rows":87,"examples":[{"address":"254 glascote road, glascote, tamworth, staffordshire b77 2ap","count":5},{"address":"flat 1019, churchill place, churchill way, basingstoke, hampshire rg21 7es","count":3},{"address":"285 purley way, croydon cr0 4xf","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 456/584 (78%) lots have empty bullets
  - `{"empty":456,"total":584,"ratio":0.781}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"hanley road, stoke-on-trent st1 6bl","count":3},{"address":"fraser street, stoke on trent st6 2dp","count":5},{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":3}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"9 castle street, barnstaple, ex31 1dr","count":3},{"address":"18 prospect place, paignton, tq3 3qz","count":3},{"address":"9 east street, cullompton, ex15 1da","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 147/183 (80%) lots missing image_url
  - `{"missing":147,"total":183,"ratio":0.803}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"202 riverside drive, saffron walden, cb10 1xy","count":3},{"address":"101 station road, newmarket, cb8 7ef","count":3},{"address":"456 high street, ely, cb7 4aa","count":3}]}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"for sale by auction29th april 2026","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 16/16 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":16,"total":16,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"endersley, church road, wingfield, diss, norfolk, ip21 5qz","count":3},{"address":"townsfield cottages, 2 laxfield road, dennington, woodbridge, suffolk, ip13 8ae","count":3},{"address":"sunnyholme, rishangles, eye, suffolk, ip23 7lb","count":3}]}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"carlton terrace, swansea, city and county of swansea.","count":4},{"address":"talog, carmarthen, carmarthenshire.","count":4}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 63 addresses appear ≥3 times each (373 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":63,"total_dupe_rows":373,"examples":[{"address":"st. austell - cornwall","count":6},{"address":"dover - kent","count":24},{"address":"andover - hampshire","count":8}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at sandy lane north, wirral, merseyside, ch61 4xu","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 25 addresses appear ≥3 times each (85 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":25,"total_dupe_rows":85,"examples":[{"address":"13 - 14 the strand, dawlish, devon, ex7 9ps","count":4},{"address":"56 daniel place, penzance, cornwall, tr18 4du","count":3},{"address":"21 carclew street, truro, cornwall, tr1 2dy","count":3}]}`

## dawsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"flat 3, lansdowne, groves avenue langland, swansea, sa3 4qx","count":3},{"address":"46, coldstream street llanelli, sa15 3bh","count":3},{"address":"6, townhill road cockett, swansea, sa2 0ur","count":3}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 11/11 (100%) lots have no price + no price_text
  - `{"tba":11,"total":11,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 11/11 (100%) lots missing image_url
  - `{"missing":11,"total":11,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 11/11 (100%) lots have empty bullets
  - `{"empty":11,"total":11,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (48 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":48,"examples":[{"address":"kingscliffe street, moston, greater manchester, m9","count":3},{"address":"petersburg road, edgeley, stockport, sk3","count":5},{"address":"south back rock, bury, bl9","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 175/209 (84%) lots have empty bullets
  - `{"empty":175,"total":209,"ratio":0.837}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 72 addresses appear ≥3 times each (224 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":72,"total_dupe_rows":224,"examples":[{"address":"flat 1, 130 high street, chesham, buckinghamshire, hp5 1ef","count":3},{"address":"plot 4 - land on the south side of the warren, caversham, reading, berkshire, rg4 7th","count":3},{"address":"55 eccles way, nottingham, nottinghamshire, ng3 3dg","count":4}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"32/34 london road, southampton, hampshire so15 2ag","count":3},{"address":"flat 12 heathlands court, beaulieu road, dibden purlieu, southampton, so45 4bb","count":3},{"address":"6 carnarvon road, bournemouth, bh1 4ew","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 44 addresses appear ≥3 times each (148 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":44,"total_dupe_rows":148,"examples":[{"address":"plot at maud croft, redmoss, drybridge, buckie","count":3},{"address":"52 morrison way, livingston","count":4},{"address":"44 randolph street, buckhaven","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 528/529 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":528,"total":529,"ratio":0.998}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"haybridge, wells, somerset, ba5","count":4}]}`

## hairandson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"123 example street, london, e1 6an","count":3},{"address":"789 test avenue, birmingham, b1 3cd","count":3}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"31, mossfields way, whitchurch, sy13 3bp","count":3},{"address":"5 ash grove, pontesbury, shrewsbury, sy5 0rq","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 49 addresses appear ≥3 times each (178 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":49,"total_dupe_rows":178,"examples":[{"address":"a former bank / shop and four bedroom mid-terrace house","count":4},{"address":"plot of land","count":3},{"address":"a raised ground floor studio flat","count":4}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"flat 3 waterloo house, thornaby place, thornaby, stockton-on-tees, cleveland, ts17 6sa","count":3},{"address":"doris avenue, bolton, lancashire, bl2 6db","count":3}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":15,"examples":[{"address":"3 st. johns road, burnley, lancashire, bb12 6rp","count":5},{"address":"flat 15 wheatsheaf court, kendall road, colchester, essex, co1 2bu","count":3},{"address":"87 ashington grove, coventry, west midlands, cv3 4dd","count":3}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3 pembroke avenue, bristol, avon, bs11 9sj","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"ashford market, kent","count":8}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 76 addresses appear ≥3 times each (306 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":76,"total_dupe_rows":306,"examples":[{"address":"hampton road, redland, bs6 6hp","count":5},{"address":"134, high street, tewkesbury, gl20 5jr","count":6},{"address":"bethel road, st george, bs5 7nn","count":5}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"daventry, nn11","count":5}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"main street, shildon, dl4 1aw","count":3},{"address":"gainsborough avenue, leeds, ls16 7pg","count":3}]}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"griffin gardens, birmingham, west midlands, b17 0hu","count":3},{"address":"tor close, exeter, devon, ex4 9ab","count":3},{"address":"ferry court, cardiff, cardiff, cf11 0jf","count":3}]}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 10/10 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":10,"total":10,"ratio":1}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (40 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":40,"examples":[{"address":"vehicle auction mitcham vehicle auction","count":3},{"address":"vehicle auction stapleford vehicle auction","count":6},{"address":"vehicle auction belvedere vehicle auction","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 112/143 (78%) lots have empty bullets
  - `{"empty":112,"total":143,"ratio":0.783}`

## jonespeckover

- **[warn] identical_price_wall** — Identical-price wall: 4/5 (80%) lots share price £20000 — extractor likely picking up hero/banner price
  - `{"price":20000,"count":4,"total":5,"ratio":0.8}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (70 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":70,"examples":[{"address":"west looe hill, looe, pl13","count":3},{"address":"ashwater, beaworthy, ex21","count":3},{"address":"kestle, tregadillett, pl15","count":3}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":47,"examples":[{"address":"land at great treadam farm (47.73 acres), abergavenny, monmouthshire, np7 8ta","count":4},{"address":"swedish house, 1 dixons lane, broughton, stockbridge, hampshire, so20 8at","count":3},{"address":"21 strand-on-the-green, london, w4 3ph","count":4}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (62 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":62,"examples":[{"address":"apartment 5, 191 water street, manchester, lancashire, m3 4ja","count":4},{"address":"flat 1, 35 gardens lane, conisbrough, doncaster, south yorkshire, dn12 3jx","count":3},{"address":"land at, ocean way, pennar, pembroke dock, pembrokeshire, sa72 6gl","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 108/206 (52%) lots missing image_url
  - `{"missing":108,"total":206,"ratio":0.524}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 67/67 (100%) lots missing image_url
  - `{"missing":67,"total":67,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"ty cenin, dyffryn ardudwy, merionethshire, ll44 2dg","count":4},{"address":"6 fifth avenue, llay, wrexham, clwyd, ll12 0tp","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 23/38 (61%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":23,"total":38,"ratio":0.605}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"46 purcell road, courthouse green, coventry, west midlands cv6 7jz","count":3},{"address":"land and buildings off vinecote road, longford, coventry, west midlands cv6 6dz","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 30/39 (77%) lots have empty bullets
  - `{"empty":30,"total":39,"ratio":0.769}`

## lsh

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"28a, 28b & 30 dyke road avenue, bn1 5lb","count":3},{"address":"school lane, chandler's ford, eastleigh, so53 4dg","count":3}]}`

## luscombemaye

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"loddiswell, kingsbridge, tq7 4rb","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 25/29 (86%) lots have empty bullets
  - `{"empty":25,"total":29,"ratio":0.862}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"17, lydstep terrace, southville,bristol, bs3 1dr","count":3},{"address":"70, crow lane, henbury,bristol, bs10 7el","count":3},{"address":"garage 9 off, kensington road, st george,bs5 7nb","count":3}]}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (45 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":45,"examples":[{"address":"unit 1 slate house, oakwood court, city road, bradford, west yorkshire bd8 8jy","count":3},{"address":"land at bent street & elm street, newsome, huddersfield, west yorkshire hd4 6nx","count":3},{"address":"broom street, broomhall, sheffield, south yorkshire, s10 2da","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 334/409 (82%) lots have empty bullets
  - `{"empty":334,"total":409,"ratio":0.817}`
- **[info] image_domain_mismatch** — Image domain mismatch: 392/409 (96%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":392,"total":409,"ratio":0.958}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":37,"examples":[{"address":"talybont-on-usk, brecon, powys, ld3 7jb","count":3},{"address":"foxglove close, stourport-on-severn, worcestershire, dy13 9bn","count":6},{"address":"a well presented detached four/five bedroom house, currently used as a bed & breakfast having achieved high accolades, with mature gardens, garage and stable block. adjacent to holiday lodge park.","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 97/104 (93%) lots have empty bullets
  - `{"empty":97,"total":104,"ratio":0.933}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 36 addresses appear ≥3 times each (120 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":36,"total_dupe_rows":120,"examples":[{"address":"33 essex street, barnoldswick, bb18 5dt","count":4},{"address":"47 chapel street, orrell, wigan, wn5 0ag","count":5},{"address":"garage at, richmond walk, radcliffe, manchester, m26 4jn","count":3}]}`

## mellerbraggins

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"/42 oak lane, knutsford, wa16 8tr","count":3}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 26 addresses appear ≥3 times each (78 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":26,"total_dupe_rows":78,"examples":[{"address":"17 north john street, liverpool, merseyside, l2 5qy","count":3},{"address":"spark street, stoke-on-trent, staffordshire, st4 1nz","count":3},{"address":"front street, newbiggin-by-the-sea, northumberland, ne64 6ad","count":3}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 156 addresses appear ≥3 times each (596 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":156,"total_dupe_rows":596,"examples":[{"address":"83-89 heol-y-parc, north cornelly, bridgend, mid glamorgan, cf33 4ly","count":3},{"address":"35 roman road, banwen, neath, sa10 9ln","count":3},{"address":"the observatory, warren's road, trelleck, monmouth, gwent, np25 4pq","count":3}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"highfield lane, southampton","count":3},{"address":"new forest car sales, ringwood road, southampton","count":3},{"address":"lichfield road, portsmouth","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 62/66 (94%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":62,"total":66,"ratio":0.939}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (55 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":55,"examples":[{"address":"90 willenhall drive, hayes, middlesex ub3 2ux","count":4},{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":4},{"address":"5a swains market, flackwell heath, high wycombe hp10 9bl","count":5}]}`

## phillipssmithanddunn

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"barnfield, barnstaple, ex32 0rb","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 5/7 (71%) lots share price £528000 — extractor likely picking up hero/banner price
  - `{"price":528000,"count":5,"total":7,"ratio":0.714}`
- **[info] bullet_starvation** — Bullet starvation: 5/7 (71%) lots have empty bullets
  - `{"empty":5,"total":7,"ratio":0.714}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"35 bassett terrace, llanelli, dyfed, sa15 4du","count":3},{"address":"st johns church, priory street, carmarthen, carmarthenshire, sa31 1lx","count":4}]}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"nodder road, sheffield, s13 8dd","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (58 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":58,"examples":[{"address":"rose villa, welshpool road, bicton heath, shrewsbury, shropshire sy3 5ah","count":3},{"address":"15 west street, horncastle, lincolnshire ln9 5je","count":4},{"address":"43 west park terrace, bradford, west yorkshire bd8 9sq","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 121 addresses appear ≥3 times each (379 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":121,"total_dupe_rows":379,"examples":[{"address":"134 southey green road, sheffield, south yorkshire, s5 8ha","count":3},{"address":"141b high street, london, se20 7ds","count":3},{"address":"60a high street, stalybridge, cheshire, sk15 1se","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":4},{"address":"10 churchfield road, chalfont st. peter, buckinghamshire, sl9 9en","count":3}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"98 risca road, cross keys, newport, gwent, np11 7dh","count":3}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (43 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":43,"examples":[{"address":"306 old durham road, gateshead, tyne and wear, ne8 4bq","count":3},{"address":"68 cobden terrace, gateshead, tyne and wear, ne8 3tb","count":3},{"address":"118 wellington road, gateshead, tyne and wear, ne11 9he","count":3}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"marshgate cottage, warrington road, runcorn, wa7 1rb","count":3}]}`

## sdl

- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 80/80 (100%) lots have empty bullets
  - `{"empty":80,"total":80,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 80/80 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":80,"total":80,"ratio":1}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"46 gelligaled road, ystrad, pentre, cf41 7rq","count":3},{"address":"slate hill farm, st ishmaels, haverfordwest, sa62 3tl","count":3},{"address":"24-26 stepney street and 2 vaughan street, llanelli, dyfed, sa15 3tr","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (97 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":97,"examples":[{"address":"57, cottam terrace bradford, bd7 2bn","count":3},{"address":"12a byron studios, byron street bradford, bd3 0au","count":4},{"address":"25 the grand mill 132, sunbridge road bradford, bd1 2pf","count":3}]}`

## sheldonbosley

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"5 oak hill, wolverhampton, west midlands, wv3 9ae","count":3}]}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"workshop & storage rear of, 7 henley road, leicester, le3 9rd","count":3},{"address":"jodora yard, huncote road, stoney stanton, leicestershire, le9 4dj","count":3},{"address":"65 henton road, off glenfield road, leicester, le3 6ay","count":3}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"st aubyn's engine house, redruth, tr16 5hd","count":3}]}`

## starpropertyonline

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"11 bembridge street, brighton, east sussex, bn2 3ln","count":3},{"address":"flat 112b cavendish place, eastbourne, east sussex, bn21 3tz","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":15,"examples":[{"address":"not available","count":15}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":16,"examples":[{"address":"25 the drive, golders green, london, nw11 9sx","count":3},{"address":"77-81 alma road, clifton, bristol, bs8 2dp","count":4},{"address":"62,64,66 & 68 church street, coggeshall, colchester, essex, co6 1ty","count":5}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":30,"examples":[{"address":"789 test avenue, liverpool, l3 4ef","count":4},{"address":"123 example street, liverpool, l1 2ab","count":3},{"address":"stable barn cottage, 1 stable lane, torquay, devon, tq1 4sa","count":3}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"east street, wareham, bh20","count":3},{"address":"quarry close, swanage, bh19","count":3},{"address":"bradon lane, ilminster, ta3","count":3}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 186 addresses appear ≥3 times each (778 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":186,"total_dupe_rows":778,"examples":[{"address":"16 redworth road, shildon, durham, dl4 2je","count":6},{"address":"bryncliffe lodge, 15 bryn y bia road, llandudno, conwy, ll30 3as","count":4},{"address":"178 weaste lane, salford, lancashire, m5 5jl","count":4}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":3},{"address":"land rear of 8 brynawelon road, cwmllynfell, swansea, west glamorgan, sa9 2wg","count":3}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"55 caludon road, coventry, cv2 4lr","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (78 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":78,"examples":[{"address":"flat 355 queensland place 2 chatham place, (room g, cluster 67), l7 3aa","count":4},{"address":"60 moss lane, orrell park, merseyside, l9 8an","count":7},{"address":"apartment 12 1 wellington street, garston, merseyside, l19 2lx","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 101/116 (87%) lots have empty bullets
  - `{"empty":101,"total":116,"ratio":0.871}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"halifax, west yorkshire","count":4}]}`

## williamhbrownnorwich

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"11, ladysmock way, norwich, norfolk nr5 9fg","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 16/18 (89%) lots have empty bullets
  - `{"empty":16,"total":18,"ratio":0.889}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"top floor flat, 40 bedford road, aberdeen, aberdeenshire","count":3},{"address":"west forth farm, forth, lanark","count":3}]}`


