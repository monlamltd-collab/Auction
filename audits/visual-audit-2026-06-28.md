# Visual Audit — 2026-06-28

Scanned **26,551** rows in **19819ms** across **129** houses with findings.

**Findings:** 130 error · 12 warn · 21 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"new north road, exeter, ex4 4hf","count":3},{"address":"the avenue, minehead, ta24 5ay","count":3},{"address":"plot adj 65 moorfield road, exmouth, ex8 3qp","count":3}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"beatrice street, ashington","count":3},{"address":"north view, sherburn hill, durham","count":3},{"address":"druridge drive, blakelaw, newcastle upon tyne","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 23 addresses appear ≥3 times each (88 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":23,"total_dupe_rows":88,"examples":[{"address":"land adjacent to 2-8 exmoor rise, ashford, kent, tn24 8qr","count":4},{"address":"land at broadmead court, broadmead road, send, surrey, gu23 7aa","count":3},{"address":"pumping station, st michaels road, sittingbourne, kent, me10 1ax","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 105/193 (54%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":105,"total":193,"ratio":0.544}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"widewater place, moorhall road, harefield, uxbridge, ub9 6ns","count":3},{"address":"66 mount pleasant, liverpool, l3 5sd","count":3},{"address":"lesser knowlesthorpe, barton mill road, canterbury, kent, ct1 1bp","count":3}]}`

## allwalesauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"waen terrace, conwy, ll32 8ea","count":3},{"address":"bryn bella, isle of anglesey, ll61 6ug","count":3},{"address":"land opposite penrallt, y felinheli, gwynedd, ll56 4qp","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":18,"examples":[{"address":"trajan street & roman road, south shields, ne33","count":3},{"address":"hedworth lane, boldon colliery, ne35","count":4},{"address":"dryden road, low fell, ne9","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 73/73 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":73,"total":73,"ratio":1}`

## astleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"6 gardners lane, neath, west glamorgan, sa11 2aa","count":3},{"address":"7 cae terrace, llanelli, dyfed, sa15 1hn","count":3},{"address":"10 hill road, neath abbey, neath, west glamorgan, sa10 7nr","count":3}]}`

## auctionestates

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":37,"examples":[{"address":"14-18 graham street, airdrie, lanarkshire, ml6 6bu","count":4},{"address":"141 high street, stockton-on-tees, cleveland, ts18 1lx","count":3},{"address":"56 spindle gardens, nottingham, ng6 7dg","count":3}]}`

## auctionhammermidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":35,"examples":[{"address":"76 stebbings, sutton hill, telford, shropshire tf7 4jw","count":3},{"address":"58 henry street, tunstall, stoke-on-trent, staffordshire st6 5hp","count":4},{"address":"68 hayward avenue, donnington, telford, shropshire tf2 8dg","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 80/83 (96%) lots have empty bullets
  - `{"empty":80,"total":83,"ratio":0.964}`
- **[info] image_domain_mismatch** — Image domain mismatch: 83/83 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":83,"total":83,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (59 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":59,"examples":[{"address":"37 lundhill drive wombwell, barnsley, south yorkshire, s73 0wg","count":4},{"address":"3 lys an pons crockwell street, bodmin, cornwall, pl31 2ds","count":3},{"address":"farm house, snodwell farm post lane, honiton, devon, ex14 9hz","count":3}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"15 belvoir walk, bedford, bedfordshire mk41 8lf","count":4},{"address":"19 porlock drive, luton, bedfordshire lu2 9ll","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 35 addresses appear ≥3 times each (116 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":35,"total_dupe_rows":116,"examples":[{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":6},{"address":"44 springhill terrace, brereton, rugeley, west midlands ws15 1bu","count":3},{"address":"26 springfield road, coventry, west midlands cv1 4gs","count":4}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"12 park view, hasland, chesterfield, derbyshire, s41 0jd","count":3},{"address":"38 station road, brimington, chesterfield, derbyshire, s43 1jt","count":3},{"address":"2 the poplars, main road, cutthorpe, chesterfield, derbyshire, s42 7ah","count":3}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":37,"examples":[{"address":"41 herrick road poets corner, coventry, west midlands, cv2 5jn","count":3},{"address":"68 lawrence saunders road, radford, coventry, west midlands cv6 1hd","count":4},{"address":"land and buildings off vinecote road, longford, coventry, west midlands cv6 6dz","count":3}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (57 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":57,"examples":[{"address":"54 watermans walk, carlisle, cumbria ca1 3tu","count":3},{"address":"2 - 4 wilson street, workington, cumbria ca14 4az","count":4},{"address":"76 stainburn road, stainburn, workington, cumbria ca14 1sn","count":3}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":30,"examples":[{"address":"46 lostwithiel street, fowey, cornwall, pl23 1bg","count":3},{"address":"second floor flat, 23 melbourne street, plymouth, devon pl1 5hq","count":3},{"address":"unit 1 communication centre, par moor road, par, cornwall pl24 2sq","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (118 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":118,"examples":[{"address":"10 north street, walton on the naze, essex co14 8ph","count":4},{"address":"61 briston road, melton constable, norfolk, nr24 2ap","count":4},{"address":"36 alexandra way, downham market, norfolk pe38 9tf","count":4}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"flat 20, trinity house, argent street, grays, essex rm17 6rj","count":3},{"address":"5 shirley court, sedley rise, loughton, essex ig10 1lu","count":3},{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 23/23 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":23,"total":23,"ratio":1}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":28,"examples":[{"address":"3 moorcroft cottages, main street, harpham, east yorkshire, yo25 4qy","count":4},{"address":"62-70 sunny bank, hull, east yorkshire, hu3 1lq","count":4},{"address":"27 hustler road, bridlington, east yorkshire, yo16 6rn","count":4}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"flat 34 fisgard court, gravesend, kent, da12 2aw","count":3},{"address":"flat 58 miller heights 43-51, maidstone, kent, me15 6ln","count":4}]}`

## auctionhouseleicestershire

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"15, 15 sandhurst street oadby, leicester, leicestershire, le2 5ar","count":3},{"address":"27 clarence street, loughborough, leicestershire, le11 1dx","count":3},{"address":"29 hill street barwell, leicester, leicestershire, le9 8bj","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 80 addresses appear ≥3 times each (256 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":80,"total_dupe_rows":256,"examples":[{"address":"35 sibthorp street, lincoln, lincolnshire, ln5 7sl","count":3},{"address":"31 new road woodston, peterborough, lincolnshire, pe2 9hd","count":4},{"address":"12 trinity road, bridlington, north humberside, yo15 2ey","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 859/1012 (85%) lots have no price + no price_text
  - `{"tba":859,"total":1012,"ratio":0.849}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 36 addresses appear ≥3 times each (139 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":36,"total_dupe_rows":139,"examples":[{"address":"sold prior for","count":4},{"address":"28 levett road, leatherhead, surrey, kt22 7eg","count":3},{"address":"64 powis street, woolwich, london, se18 6hz","count":3}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":39,"examples":[{"address":"7 armitage close, middleton, m24 4pa","count":5},{"address":"60 keldregate, huddersfield, west yorkshire, hd2 1tb","count":4},{"address":"68 clough lane, halifax, west yorkshire, hx2 8sw","count":4}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (34 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":34,"examples":[{"address":"land in shipley lane, bexhill-on-sea, east sussex, tn39 3sr","count":3},{"address":"141 queens road beeston, nottingham, nottinghamshire, ng9 2fe","count":3},{"address":"31 greenfield road, rotherham, south yorkshire, s65 3nx","count":4}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":23,"examples":[{"address":"16 longueville court, lumbertubs, northampton, northamptonshire, nn3 8hj","count":3},{"address":"13 thrush close, corby, northamptonshire nn18 8fg","count":3},{"address":"7 cameron crescent, northampton, northamptonshire nn5 5pd","count":3}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":42,"examples":[{"address":"1. tindale avenue, durham, county durham dh1 5ew","count":3},{"address":"25a bowes street, blyth, northumberland, ne24 1bd","count":3},{"address":"44 ernest street pelton, chester le street, county durham, dh2 1du","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 258/356 (72%) lots have no price + no price_text
  - `{"tba":258,"total":356,"ratio":0.725}`

## auctionhousenorthernireland

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"83 gulladuff hill knockloughrim, magherafelt, county londonderry, bt45 8pa","count":3}]}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"789 oak lane, birmingham, b1 1bb","count":3},{"address":"123 main street, london, ec1a 1aa","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 14/21 (67%) lots missing image_url
  - `{"missing":14,"total":21,"ratio":0.667}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 28 addresses appear ≥3 times each (86 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":28,"total_dupe_rows":86,"examples":[{"address":"10 rydal road, preston, lancashire pr1 5sl","count":3},{"address":"apartment 109, 15 hatton garden, liverpool, merseyside l3 2ha","count":3},{"address":"67 freckleton street, kirkham, preston, lancashire pr4 2sn","count":3}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"22 park street, alfreton, derbyshire, de55 7je","count":3},{"address":"4/6 lonsdale terrace, edinburgh, midlothian, eh3 9hn","count":4},{"address":"4b essex brae, edinburgh, midlothian, eh4 6ln","count":3}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 51 addresses appear ≥3 times each (207 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":51,"total_dupe_rows":207,"examples":[{"address":"6 & 8 seafield street, banff, banffshire ab45 1ds","count":4},{"address":"flat d, 426 great northern road, aberdeen, aberdeen city ab24 2ba","count":5},{"address":"former united free church, aberdeen, aberdeenshire ab42 3nb","count":6}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 333/336 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":333,"total":336,"ratio":0.991}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 30 addresses appear ≥3 times each (104 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":30,"total_dupe_rows":104,"examples":[{"address":"25 newman road, exeter, devon ex4 1pl","count":3},{"address":"plot 24 home farm, brightwell, sotwell, wallingford, oxfordshire ox10 0qu","count":3},{"address":"winscote, rackenford, tiverton, devon ex16 8du","count":4}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 23 addresses appear ≥3 times each (75 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":23,"total_dupe_rows":75,"examples":[{"address":"357. pye green road, cannock, staffordshire, ws11 5rw","count":3},{"address":"102 edenhurst road. longbridge, birmingham, west midlands, b31 4pl","count":3},{"address":"1 vine villas, west felton, oswestry, shropshire, sy11 4en","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 967/1041 (93%) lots have no price + no price_text
  - `{"tba":967,"total":1041,"ratio":0.929}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"5 queen street, stoke-on-trent, staffordshire, st6 3el","count":3},{"address":"174 ravens lane bignall end, stoke-on-trent, staffordshire, st7 8py","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (92 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":92,"examples":[{"address":"29 askew dale, guisborough, north yorkshire ts14 8jg","count":5},{"address":"53 normanby road, ormesby, middlesbrough, north yorkshire ts7 9nu","count":5},{"address":"62 derwent street, hartlepool, cleveland ts26 8bn","count":3}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 84 addresses appear ≥3 times each (285 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":84,"total_dupe_rows":285,"examples":[{"address":"8 pine view, platt, sevenoaks, kent, tn15 8la","count":4},{"address":"ground floor, 282 wellington street, grimsby, north east lincolnshire, dn32 7jp","count":4},{"address":"garage at 61 moatfield road, bushey, hertfordshire, wd23 3bp","count":4}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (44 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":44,"examples":[{"address":"122 oak street, abertillery, blaenau gwent, np13 1tq","count":3},{"address":"11 australia road, cardiff, cf14 3bz","count":3},{"address":"122 oak street, abertillery, np13 1tq","count":3}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":38,"examples":[{"address":"flat 43, netherwood chambers 1a, bradford, west yorkshire bd1 4pb","count":3},{"address":"5 westgate central, 117 westgate, wakefield, west yorkshire wf1 1ew","count":3},{"address":"90 glen lee lane, long lee, keighley, west yorkshire bd21 5qy","count":3}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"16 gloucester terrace, haswell, durham, county durham, dh6 2eg","count":3},{"address":"66 hessewelle crescent, haswell, durham, county durham, dh6 2eh","count":4},{"address":"6 wesley court, langley moor, durham, county durham, dh7 8gz","count":4}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (64 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":64,"examples":[{"address":"jubilee farm, purlieu lane, godshill, fordingbridge, sp6 2lw","count":5},{"address":"garage 26, the drive, hove, bn3 3jd","count":3},{"address":"unit 9 tungsten building, george street, southwick, west sussex, bn41 1ra","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 129/137 (94%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":129,"total":137,"ratio":0.942}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"2, edward street, dudley, west midlands dy1 2ae","count":3},{"address":"addlethorpe mill, mill lane, skegness, lincolnshire pe24 4tb","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 45/45 (100%) lots have empty bullets
  - `{"empty":45,"total":45,"ratio":1}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"flat 8, mathieson house, crescent road, london, e4 6bl","count":3},{"address":"30, coldshott, oxted, surrey, rh8 9bj","count":3}]}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"43 halyards court, durham wharf drive, brentford lock west, brentford, middlesex tw8 8fb","count":3},{"address":"49 high street, chesham, buckinghamshire hp5 1bw","count":3}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (75 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":75,"examples":[{"address":"dorset mansions, lillie road, london, sw6, united kingdom","count":3},{"address":"cobbett road, guildford, gu2, united kingdom","count":3},{"address":"11 aston chase, hemsworth, pontefract, west yorkshire, wf9 4rb, united kingdom","count":4}]}`

## bowensonandwatson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3 ruthin road, wrexham, ll13 7nu","count":3}]}`

## bradleyhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"northumbria house, church avenue, scotland gate, choppington, northumberland, ne62 5se","count":3},{"address":"cherry trees, brunton lane, newcastle upon tyne, tyne and wear, ne13 9al","count":3},{"address":"17e queen street, quayside, newcastle upon tyne, tyne and wear, ne1 3ug","count":3}]}`

## brggibsondublin

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (48 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":48,"examples":[{"address":"8 monabraher road, ballynanty, limerick, co. limerick, v94 we2y","count":3},{"address":"5, greggs hill, arklow, co. wicklow, y14 de93","count":3},{"address":"stranamart, blacklion, county cavan, f91 a0h2","count":3}]}`

## brownco

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"5 the close, holt, norfolk, nr25 6dd","count":3},{"address":"27-31 high street, mildenhall, bury st. edmunds, suffolk, ip28 7ea","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":31,"examples":[{"address":"topcon technology site cirencester road, minchinhampton, stroud, gloucestershire, gl6 9bh","count":3},{"address":"46 edinburgh place, cheltenham, gloucestershire, gl51 7sf","count":4},{"address":"68 south street, exeter, devon, ex1 1ee","count":4}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (64 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":64,"examples":[{"address":"254 glascote road, glascote, tamworth, staffordshire b77 2ap","count":3},{"address":"27-29 wide bargate, boston pe21 6sw","count":3},{"address":"1-4 salisbury street, widnes, cheshire wa8 6pj","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 434/564 (77%) lots have empty bullets
  - `{"empty":434,"total":564,"ratio":0.77}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (29 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":29,"examples":[{"address":"uttoxeter road, rugeley ws15 3ja","count":3},{"address":"west avenue, northwich","count":3},{"address":"hanley road, stoke-on-trent st1 6bl","count":4}]}`

## carterjonas

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at stanton fitzwarren, wiltshire, sn3 4tg","count":3}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"9 chapel street, tavistock, pl19 8bs","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 51/66 (77%) lots missing image_url
  - `{"missing":51,"total":66,"ratio":0.773}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"3 tower road, ely, cambridgeshire, cb7 4hw","count":3},{"address":"123 high street, cambridge, cb1 2aa","count":3},{"address":"yard and buildings, malton lane, meldreth, hertfordshire, sg8 6pa","count":3}]}`

## cheffinstimed

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"unit 3b cowley road, blyth riverside business park, blyth, northumberland, ne24 5tf","count":3},{"address":"reed cottage, holywell, st. ives, cambridgeshire, pe27 4tg","count":3},{"address":"burrleigh house, main street, caldecote, cambridgeshire, cb23 7nu","count":3}]}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at, old bristol road, keynsham bs31 2aa","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 14/14 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":14,"total":14,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"18 beaumont cottages, kelsale, saxmundham, suffolk, ip17 2nw","count":3},{"address":"blaxhall hall crossing, little glemham, woodbridge, suffolk, ip13 0bp","count":3}]}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"gwendraeth town, kidwelly, carmarthenshire.","count":3},{"address":"gnoll park road, neath, neath port talbot.","count":3},{"address":"high street, llandybie, ammanford, carmarthenshire","count":3}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (77 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":77,"examples":[{"address":"freehold block of four flats for investment","count":3},{"address":"substantial vacant commercial premises with potential","count":4},{"address":"penzance - cornwall","count":6}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":25,"examples":[{"address":"45 sample road, manchester, m1 2ab","count":3},{"address":"22 test drive, liverpool, l1 1ef","count":3},{"address":"78 demo avenue, birmingham, b1 1cd","count":3}]}`

## cottons

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"black lees farm, wolverhampton road, shareshill, wolverhampton, west mids, wv10 7ly","count":3},{"address":"land lying to the north of, drawbridge road, shirley, solihull, worcestershire, b90 1dd","count":3},{"address":"18 barnsley road, edgbaston, birmingham, west midlands, b17 8ed","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":27,"examples":[{"address":"1 pendrea place, gulval, penzance, cornwall, tr18 3ne","count":4},{"address":"9 blackstone street, liverpool, merseyside, l5 9ty","count":3},{"address":"22 valley road, liverpool, merseyside, l4 0ud","count":3}]}`

## dawsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"28, lakefield road llanelli, sa15 2ue","count":3}]}`

## dedmangray

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"1 main street, london, e1 1aa","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 3/5 (60%) lots share price £250000 — extractor likely picking up hero/banner price
  - `{"price":250000,"count":3,"total":5,"ratio":0.6}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 99 addresses appear ≥3 times each (350 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":99,"total_dupe_rows":350,"examples":[{"address":"kensington street, rochdale, ol11","count":3},{"address":"edge lane, droylsden, greater manchester, m43","count":3},{"address":"flat 30 ,the pack horse nelson square, bolton, bl1","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 461/507 (91%) lots have empty bullets
  - `{"empty":461,"total":507,"ratio":0.909}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 74 addresses appear ≥3 times each (255 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":74,"total_dupe_rows":255,"examples":[{"address":"2 pine needle lane, northwood, middlesex, ha6 1az","count":3},{"address":"266 old worting road, basingstoke, hampshire, rg22 6pd","count":3},{"address":"87 grosvenor road, aldershot, hampshire, gu11 3dz","count":3}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"development site at the masons arms, 34 east street, warminster, ba12 9bn","count":5},{"address":"12 the square, uffculme, cullompton, ex15 3aa","count":3},{"address":"development site at petersfield close, plymouth, pl3 6qp","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 52 addresses appear ≥3 times each (187 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":52,"total_dupe_rows":187,"examples":[{"address":"63f rose street, tenanted investment, rosemount, aberdeen","count":3},{"address":"plot of land plot 2, radlett, hertfordshire","count":3},{"address":"41 urquhart road, first floor flat, aberdeen","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 523/525 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":523,"total":525,"ratio":0.996}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":24,"examples":[{"address":"vole road, mark, highbridge, somerset, ta9","count":6},{"address":"off panborough drove, panborough, wells, somerset, ba5","count":3},{"address":"new homes developments","count":3}]}`

## hairandson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"789 park lane, rochford, ss4 1ed","count":3}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (73 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":73,"examples":[{"address":"instree, hillside road, telford, tf2 0bz","count":4},{"address":"81, wildwood, telford, tf7 5pw","count":4},{"address":"y bwthyn, bridge street, welshpool, sy21 0rz","count":4}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 30 addresses appear ≥3 times each (114 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":30,"total_dupe_rows":114,"examples":[{"address":"tower hamlets street, dover, kent, ct17 0dy - online auctions","count":3},{"address":"broad street, coventry, west midlands, cv6 5bd - online auctions","count":3},{"address":"327a crystal palace road, east dulwich, london, se22 9jl","count":3}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":18,"examples":[{"address":"3 st. johns road, burnley, lancashire, bb12 6rp","count":6},{"address":"flat 15 wheatsheaf court, kendall road, colchester, essex, co1 2bu","count":4},{"address":"87 ashington grove, coventry, west midlands, cv3 4dd","count":4}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":25,"examples":[{"address":"6 braybrooke terrace, hastings, east sussex, tn34 1td","count":3},{"address":"30 mersey walk, warrington, cheshire, wa4 1su","count":3},{"address":"8 kingsway, nuneaton, warwickshire, cv11 5lp","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":14,"examples":[{"address":"ashford market, kent","count":11},{"address":"ashford market, ashford","count":3}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 79 addresses appear ≥3 times each (279 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":79,"total_dupe_rows":279,"examples":[{"address":"134, high street, tewkesbury, gl20 5jr","count":4},{"address":"conygre grove, filton, bs34 7dp","count":3},{"address":"french yard, , bs1 6ue","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"southcliffe, 2 south drive, harrogate, hg2 8au","count":3}]}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"ferry lane, wakefield, wf3 4jr","count":3},{"address":"bury street, salford, lancashire, m3 7ga","count":3},{"address":"calder view, west yorkshire, wf14 8jd","count":3}]}`

## johnfrancis

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"cwel_icon_solid_listlist iconicon set listlist","count":3},{"address":"owls lodge lane, mayals, swansea, sa3","count":3},{"address":"marine terrace, aberystwyth, ceredigi...","count":3}]}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":15,"examples":[{"address":"vehicle auction mitcham vehicle auction","count":4},{"address":"vehicle auction belvedere vehicle auction","count":4},{"address":"chesterfield","count":7}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'johnpye' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"johnpye"}`

## jonespeckover

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"0.99 acres of land, leadbrook drive, flint, flintshire, ch6 5st","count":3}]}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (64 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":64,"examples":[{"address":"woodacott, holsworthy, devon ex22","count":6},{"address":"stratton road, bude, cornwall ex23","count":8},{"address":"liftondown, lifton, pl16","count":4}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (34 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":34,"examples":[{"address":"2 warren lane, dartington hall, totnes, devon, tq9 6eg","count":3},{"address":"21 strand-on-the-green, london, w4 3ph","count":6},{"address":"8 locksbrook road, bath, ba1 3ey","count":3}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"flat 2 wellwood house, wellwood glade, ryde, isle of wight, po33 4ha","count":3},{"address":"107 the parklands, dunstable, bedfordshire, lu5 4gw","count":4},{"address":"121 cornwall drive, bury, lancashire, bl9 9ex","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 91/158 (58%) lots missing image_url
  - `{"missing":91,"total":158,"ratio":0.576}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 55/55 (100%) lots missing image_url
  - `{"missing":55,"total":55,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 22/29 (76%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":22,"total":29,"ratio":0.759}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"49 caldecott street, hillmorton, rugby, west midlands cv21 3th","count":3},{"address":"24 hastings road, stoke heath, coventry, west midlands cv2 4jd","count":4},{"address":"flat 30, darlaston court, 123 main road, meriden, coventry, west midlands cv7 7nj","count":3}]}`

## lsh

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":33,"examples":[{"address":"unit 9 orton enterprise centre, bakewell road, pe2 6xu","count":4},{"address":"59 silverdale place, dl5 7ea","count":4},{"address":"school lane, chandler's ford,, so53 4dg","count":4}]}`

## luscombemaye

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"loddiswell, kingsbridge, tq7 4rb","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 23/29 (79%) lots have empty bullets
  - `{"empty":23,"total":29,"ratio":0.793}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"52, st johns lane, bedminster, bristol, bs3 5ad","count":3},{"address":"filton rectory, rectory lane, filton, bristol, bs34 7bx","count":3},{"address":"213, gloucester road, patchway, bristol, bs34 6nd","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 43/71 (61%) lots missing image_url
  - `{"missing":43,"total":71,"ratio":0.606}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":39,"examples":[{"address":"violet avenue, new edlington, doncaster, south yorkshire, dn12 1nw","count":3},{"address":"7 mapleton drive, hemlington, middlesbrough, north yorkshire ts8 9nf","count":3},{"address":"land adjoining 43 norton avenue, sheffield, south yorkshire s12 2la","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 341/399 (85%) lots have empty bullets
  - `{"empty":341,"total":399,"ratio":0.855}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"crai, brecon, powys, ld3 8ys","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 73/85 (86%) lots have empty bullets
  - `{"empty":73,"total":85,"ratio":0.859}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (63 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":63,"examples":[{"address":"5 lionel street, burnley, bb12 6ra","count":3},{"address":"81 argyle street, hindley, wigan, wn2 3pn","count":3},{"address":"45 taylor lane, denton, manchester, m34 3nq","count":3}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"st george's road, southsea po4 9pl","count":4}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 64 addresses appear ≥3 times each (214 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":64,"total_dupe_rows":214,"examples":[{"address":"westward way, harrow, ha3 0se","count":3},{"address":"collingwood close, heacham, king's lynn, norfolk, pe31 7ld","count":3},{"address":"manchester road, huddersfield, west yorkshire, hd4 5sl","count":3}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 204 addresses appear ≥3 times each (785 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":204,"total_dupe_rows":785,"examples":[{"address":"58 orchard street, weston-super-mare, avon, bs23 1rl","count":4},{"address":"land at the rear of, wootton bassett road, swindon, wiltshire, sn1 4nq","count":4},{"address":"st paul's church, birchgrove street, porth, cf39 9uu","count":4}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"auction - white star place, southampton","count":3},{"address":"62 high street, west end, hampshire so30 3dt","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 46/50 (92%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":46,"total":50,"ratio":0.92}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":38,"examples":[{"address":"98 princes road, watford, hertfordshire wd18 7rs","count":5},{"address":"flat 12 hedley court, 67 putney hill, london sw15 3ns","count":4},{"address":"pumney, 7 drayton road, sutton courtenay, abingdon ox14 4aj","count":3}]}`

## phillipssmithanddunn

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"lower park road ex33 2lh","count":3}]}`

## probateauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"brentwood, essex","count":3}]}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"92 st. catherine street, carmarthen, dyfed, sa31 1rf","count":3},{"address":"64 tirgof, llangennech, llanelli, dyfed, sa14 8tp","count":4},{"address":"97-99 neath road, briton ferry, neath, west glamorgan, sa11 2dq","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 27/33 (82%) lots have empty bullets
  - `{"empty":27,"total":33,"ratio":0.818}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 29 addresses appear ≥3 times each (87 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":29,"total_dupe_rows":87,"examples":[{"address":"ernald gardens, stone, st15 0ae","count":3},{"address":"liberty place, 26-38 sheepcote street, birmingham, b16 8jb","count":3},{"address":"guildhall lane, wedmore, bs28 4al","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 65 addresses appear ≥3 times each (208 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":65,"total_dupe_rows":208,"examples":[{"address":"land and buildings south of dudley street, eccles, manchester, greater manchester m30 8pt","count":4},{"address":"45 parkinson street, burnley, lancashire bb11 3ls","count":4},{"address":"rose villa, welshpool road, bicton heath, shrewsbury, shropshire sy3 5ah","count":4}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 72 addresses appear ≥3 times each (233 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":72,"total_dupe_rows":233,"examples":[{"address":"7 halliday grove, leeds, west yorkshire, ls12 3pd","count":3},{"address":"134 southey green road, sheffield, south yorkshire, s5 8ha","count":4},{"address":"121 priory road, oxford, oxfordshire, ox4 4nd","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":21,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":10},{"address":"flat 6, 37 studley road, luton, bedfordshire, lu3 1bb","count":5},{"address":"28 laburnum road, sandy, bedfordshire, sg19 1hg","count":3}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"building plot, stanley road, garndiffaith, pontypool, gwent, np4 7ly","count":4},{"address":"flat 1, 114 st. mary street, risca, newport, gwent, np11 6gr","count":3},{"address":"7 frogmore street, laugharne, carmarthen, dyfed, sa33 4sx","count":3}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (40 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":40,"examples":[{"address":"30 rayleigh grove, gateshead, tyne and wear, ne8 4qq","count":6},{"address":"306 old durham road, gateshead, tyne and wear, ne8 4bq","count":5},{"address":"68 cobden terrace, gateshead, tyne and wear, ne8 3tb","count":4}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":35,"examples":[{"address":"7 glumangate, chesterfield s40 1tp","count":3},{"address":"heath farm, dickinson heights, gisburn forest, wigglesworth, north yorkshire, bd23 4ta","count":4},{"address":"tal y fan gwynfryn, nantglyn road, denbigh ll16 4st","count":4}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"land at chatterton hey, exchange street, edenfield, ramsbottom, bury, lancashire bl0 0qh","count":3},{"address":"the cottage, r/o 46 church street, paignton, devon tq3 3ah","count":3},{"address":"4 lombard street, derby de22 4jd","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 88/88 (100%) lots have empty bullets
  - `{"empty":88,"total":88,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 88/88 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":88,"total":88,"ratio":1}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (79 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":79,"examples":[{"address":"flat a & b, 77 john street, porthcawl, cf36 3ay","count":3},{"address":"57/57a commercial street, kenfig hill, bridgend, cf33 6dh","count":3},{"address":"7 ty devonia, pierhead view, penarth, cf64 1sj","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":67,"examples":[{"address":"the blue boar, thornton road thornton, bradford, bd13 3lp","count":4},{"address":"8, grape street allerton, bradford, bd15 7re","count":3},{"address":"11 georges house, upper millergate bradford, bd1 1sx","count":5}]}`

## sheldonbosley

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (36 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":36,"examples":[{"address":"crumps brook, hopton wafers, kidderminster","count":4},{"address":"victoria mews, warwick","count":4},{"address":"bridge court, banbury road, southam","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 36/52 (69%) lots missing image_url
  - `{"missing":36,"total":52,"ratio":0.692}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":37,"examples":[{"address":"123 example street, london, e1 1eg","count":3},{"address":"workshop & storage rear of, 7 henley road, leicester, le3 9rd","count":3},{"address":"17 longhurst close, rushey mead, leicester, le4 7wa","count":5}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"st aubyn's engine house, redruth, tr16 5hd","count":5},{"address":"land at aliceford , okehampton, ex20 4hr","count":3}]}`

## starpropertyonline

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"53 rushlake road, brighton, east sussex, bn1 9ag","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":28,"examples":[{"address":"123 example street, chippenham, sn15 1aa","count":3},{"address":"321 demo avenue, bath, ba2 3aa","count":3},{"address":"789 test place, trowbridge, ba14 8aa","count":3}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (63 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":63,"examples":[{"address":"flat 2, instow house marine parade, instow, bideford, devon, ex39 4jj","count":3},{"address":"22 mansfield hill, london, e4 7ju","count":3},{"address":"flat 57 fisher court, rhapsody crescent, warley, brentwood, essex, cm14 5ge","count":3}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"10 the cedars, liverpool, merseyside, l12 0ph","count":3},{"address":"11 chywoone place, newlyn, penzance, cornwall, tr18 5nw","count":3},{"address":"123 example street, liverpool, l1 2ab","count":4}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 263 addresses appear ≥3 times each (1347 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":263,"total_dupe_rows":1347,"examples":[{"address":"flat 1 romney court, shepherds bush green, london, w12 8py","count":6},{"address":"plot 2 land off stony lane, boundary drain, braunton, devon, ex33 2ny","count":5},{"address":"8 richmere road, didcot, oxfordshire, ox11 8ht","count":3}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":12,"examples":[{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":4},{"address":"162 port tennant road, port tennant, swansea, west glamorgan, sa1 8jn","count":5},{"address":"167 gower road, sketty, swansea, west glamorgan, sa2 9jh","count":3}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":35,"examples":[{"address":"555 oak street, sheffield, s1 1aa","count":4},{"address":"55 caludon road, coventry, cv2 4lr","count":4},{"address":"flat 16 silverbirch court, orphanage road, birmingham, b24 0ab","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (65 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":65,"examples":[{"address":"67 peter road, liverpool, l4 3rt","count":3},{"address":"apartment 4, 10b moss street, liverpool, l6 1hd","count":4},{"address":"apartment 2 26 cornhill, liverpool, l1 8dt","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 71/97 (73%) lots have empty bullets
  - `{"empty":71,"total":97,"ratio":0.732}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"salford, greater manchester","count":4},{"address":"wetherby, west yorkshire","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 17/18 (94%) lots have empty bullets
  - `{"empty":17,"total":18,"ratio":0.944}`
- **[info] image_domain_mismatch** — Image domain mismatch: 17/18 (94%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":17,"total":18,"ratio":0.944}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":39,"examples":[{"address":"57 gateside crescent, airdrie, north lanarkshire","count":4},{"address":"flat 1/2, 287 glasgow road, blantyre, glasgow","count":5},{"address":"10 ballyphilip road, portaferry, newtownards","count":5}]}`


