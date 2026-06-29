# Visual Audit — 2026-06-29

Scanned **26,740** rows in **20170ms** across **130** houses with findings.

**Findings:** 127 error · 16 warn · 26 info

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":39,"examples":[{"address":"33 clarges street, mayfair, london, w1j 7ee","count":3},{"address":"b&m, 66-68 high street, weston-super-mare, somerset, bs23 1hs","count":3},{"address":"ibis styles hotel, emperor way, crewe business park, crewe, cw1 6bd","count":3}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"maple street, ashington","count":4}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (82 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":82,"examples":[{"address":"land south of stoke valley road, exeter, devon, ex4 5hg","count":3},{"address":"garage at 3 buckthorns, bracknell, berkshire, rg42 1ta","count":3},{"address":"land on the south side of simone weil avenue, ashford, kent, tn24 8qr","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 118/198 (60%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":118,"total":198,"ratio":0.596}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (59 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":59,"examples":[{"address":"49/52 pyle street & 22 south street newport, isle of wight, po30 1xb","count":3},{"address":"kenville house, 3 spring villa park, edgware, ha8 7ab","count":3},{"address":"ashwood court, 4 hulse road, southampton, so15 2jx","count":4}]}`

## allwalesauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":20,"examples":[{"address":"bryn tirion mawr, gwynedd, ll33 0le","count":3},{"address":"gwynfryn , llanfairfechan, ll33 0dw","count":3},{"address":"tynrardd, anglesey, ll61 6ru","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (48 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":48,"examples":[{"address":"2 bed semi-detached house for sale in bluebell way, south shields, ne34","count":4},{"address":"george street, coxlodge, ne3","count":3},{"address":"hayton avenue, south shields, ne34","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 104/104 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":104,"total":104,"ratio":1}`

## astleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"18 northampton lane, swansea, west glamorgan, sa1 4eh","count":3},{"address":"1 penshannel, neath abbey, neath, west glamorgan, sa10 6pg","count":4}]}`

## auctionestates

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (89 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":89,"examples":[{"address":"old bothie, broadgate lane, kelham, newark, notts, ng23 5rz","count":3},{"address":"138 derby street, burton upon trent, staffordshire, de14 2lf","count":4},{"address":"mansfield court, 36 mansfield road, nottingham, nottinghamshire, ng5 2bw","count":4}]}`

## auctionhammermidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"lot tbcsold after   14 mere rise, copmere end, stafford, staffordshire st21 6hhguide price £98,000+ plus feessold aftersemi-detached bungalow     1      1      1","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 28/29 (97%) lots have empty bullets
  - `{"empty":28,"total":29,"ratio":0.966}`
- **[info] image_domain_mismatch** — Image domain mismatch: 29/29 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":29,"total":29,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 30 addresses appear ≥3 times each (94 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":30,"total_dupe_rows":94,"examples":[{"address":"35 orient court gresley close, telford, shropshire, tf7 5tu","count":3},{"address":"13 hafod tudor terrace wattsville, crosskeys, np11 7qq","count":3},{"address":"regional online","count":3}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":33,"examples":[{"address":"21 greenfield road, pulloxhill, bedford mk45 5ez","count":3},{"address":"flat b, 55 shakespeare road, bedford, bedfordshire mk40 2dx","count":3},{"address":"1 hazelwood road, bedford, bedfordshire mk42 0hn","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":25,"examples":[{"address":"53 avon road, worcester, worcestershire wr4 9ag","count":3},{"address":"apartment 11 29 longleat avenue, birmingham, west midlands b15 2df","count":3},{"address":"18 prole street, wolverhampton, west midlands wv10 9ad","count":3}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":28,"examples":[{"address":"59 houldsworth drive, chesterfield, derbyshire, s41 0bp","count":4},{"address":"47 haldane crescent, bolsover, chesterfield, derbyshire, s44 6ru","count":5},{"address":"57 houldsworth drive, chesterfield, derbyshire, s41 0bp","count":6}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (61 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":61,"examples":[{"address":"55 birch meadow close, warwick, warwickshire cv34 4tz","count":3},{"address":"60 ridgethorpe, willenhall, coventry, west midlands cv3 3gq","count":3},{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":6}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 41 addresses appear ≥3 times each (149 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":41,"total_dupe_rows":149,"examples":[{"address":"15 norfolk street, carlisle, cumbria ca2 5jq","count":4},{"address":"the flat, kirk allans, stock lane, grasmere, ambleside, cumbria la22 9sn","count":3},{"address":"fusion nightclub, ladies walk, workington, cumbria ca14 3ba","count":4}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":37,"examples":[{"address":"8 penalverne place, penzance, cornwall tr18 2rq","count":3},{"address":"27a higher market street, penryn, cornwall tr10 8ef","count":3},{"address":"96 cheddon road, taunton, somerset ta2 7dw","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 63 addresses appear ≥3 times each (212 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":63,"total_dupe_rows":212,"examples":[{"address":"willow wood, 166 leverington road, wisbech, cambridgeshire pe13 1ru","count":4},{"address":"land adjacent to the water tower, princes street, swaffham, norfolk pe37 7bp","count":6},{"address":"appletree cottage, high street, thornham, hunstanton, norfolk pe36 6ly","count":4}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 5/5 (100%) lots have no price + no price_text
  - `{"tba":5,"total":5,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 5/5 (100%) lots missing image_url
  - `{"missing":5,"total":5,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 5/5 (100%) lots have empty bullets
  - `{"empty":5,"total":5,"ratio":1}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":14,"examples":[{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":6},{"address":"7 york mews, great wakering, southend-on-sea, essex ss3 0fa","count":4},{"address":"5 shirley court, sedley rise, loughton, essex ig10 1lu","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 28/29 (97%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":28,"total":29,"ratio":0.966}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":67,"examples":[{"address":"barmston methodist church, sands lane, barmston, driffield, yo25 8pg","count":4},{"address":"53 duesbery street, hull, east yorkshire, hu5 3qe","count":4},{"address":"325 spring bank west, hull, east yorkshire, hu3 1lb","count":3}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":22,"examples":[{"address":"flat 4 60 east street, sittingbourne, kent, me10 4rt","count":3},{"address":"flat 42 scotney gardens, maidstone, kent, me16 0gr","count":3},{"address":"1 hurst court halfway road, sheerness, kent, me12 3aa","count":3}]}`

## auctionhouseleicestershire

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"land on the south west side of, 17 thurnby lane, stoughton, leicestershire le2 2fp","count":4}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 177 addresses appear ≥3 times each (561 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":177,"total_dupe_rows":561,"examples":[{"address":"flat a, 67 st. st georges road west, grangetown, cleveland, ts6 7hy","count":3},{"address":"13 bairstow street, blackpool, lancashire, fy1 5bn","count":3},{"address":"43 stainton drive, gateshead, tyne and wear, ne10 9qu","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1107/1259 (88%) lots have no price + no price_text
  - `{"tba":1107,"total":1259,"ratio":0.879}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 68 addresses appear ≥3 times each (284 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":68,"total_dupe_rows":284,"examples":[{"address":"flat 3 eleanor house, 89 east street, epsom, surrey, kt17 1dt","count":6},{"address":"93a high street, wealdstone, harrow, middlesex, ha3 5dl","count":6},{"address":"89 birkdale, bexhill-on-sea, east sussex, tn39 3tg","count":5}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 59 addresses appear ≥3 times each (195 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":59,"total_dupe_rows":195,"examples":[{"address":"3 raynham street, ashton-under-lyne, ol6 9nu","count":3},{"address":"flat 34, renaissance house, millbrook street, stockport, sk1 3tn","count":6},{"address":"694 bolton road, pendlebury, swinton, m27 6el","count":4}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"21 water end thorpe meadows, peterborough, cambridgeshire, pe3 6gq","count":3},{"address":"5a stonegate, spalding, lincolnshire, pe11 2pq","count":3},{"address":"36. woodgate, scarborough, north yorkshire, yo12 5qq","count":3}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (79 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":79,"examples":[{"address":"flat 53 5 freehold street, northampton, northamptonshire, nn2 6bf","count":3},{"address":"7 main street, cold ashby, northampton, northamptonshire nn6 6el","count":3},{"address":"23 and 23a colwyn road, northampton, northamptonshire nn1 3pz","count":4}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":42,"examples":[{"address":"29-31 fenkle street, alnwick ne66 1hw","count":3},{"address":"1 stoneylea close, ryton, tyne and wear, ne40 4ez","count":3},{"address":"19 kielder road, newcastle upon tyne, tyne and wear, ne15 8bl","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 271/319 (85%) lots have no price + no price_text
  - `{"tba":271,"total":319,"ratio":0.85}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"123 high street, london, sw1a 1aa","count":3},{"address":"78 broad street, manchester, m1 3aa","count":3},{"address":"101 park lane, leeds, ls1 1aa","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 23/27 (85%) lots missing image_url
  - `{"missing":23,"total":27,"ratio":0.852}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":42,"examples":[{"address":"18 alker street, chorley, lancashire pr7 2da","count":3},{"address":"7 leyland mansions, 18 leyland road, southport, merseyside pr9 9jq","count":3},{"address":"flat 2, beech court, hough green road, widnes, cheshire wa8 4pg","count":3}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 62 addresses appear ≥3 times each (189 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":62,"total_dupe_rows":189,"examples":[{"address":"119 wharf road pinxton, nottingham, nottinghamshire, ng16 6lh","count":3},{"address":"4/6 lonsdale terrace, edinburgh, midlothian, eh3 9hn","count":3},{"address":"three apartments with freehold 27 market street, buxton, derbyshire, sk17 6lf","count":3}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 52 addresses appear ≥3 times each (200 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":52,"total_dupe_rows":200,"examples":[{"address":"the old shop, belhelvie village, balmedie, aberdeen, aberdeenshire ab23 8yu","count":3},{"address":"bruce hall, hall wynd, perth, errol ph2 7ql","count":5},{"address":"80/82 channel street, galashiels, selkirkshire td1 1bd","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 289/290 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":289,"total":290,"ratio":0.997}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"30 torquay road, paignton, devon tq3 3ab","count":3},{"address":"89 houndiscombe road mutley, plymouth, devon, pl4 6hb","count":3},{"address":"elmfield, bear street, barnstaple, devon ex32 7dx","count":3}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 110 addresses appear ≥3 times each (343 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":110,"total_dupe_rows":343,"examples":[{"address":"unit 69 200 norfolk park road, sheffield, south yorkshire, s2 2ua","count":3},{"address":"50 victoria road, doncaster, south yorkshire, dn4 0lz","count":3},{"address":"flat 5 9 cornwallis gardens, hastings, east sussex, tn34 1lp","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1333/1389 (96%) lots have no price + no price_text
  - `{"tba":1333,"total":1389,"ratio":0.96}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"16 delamere court st. marys street, crewe, cheshire, cw1 2jb","count":3},{"address":"19 burden road, wirral, merseyside, ch46 6bg","count":3},{"address":"flat 7 1 knowsley road, birkenhead, merseyside, ch42 1qb","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":20,"examples":[{"address":"flat a ground floor front, 12 claremont terrace, ashbrooke, sunderland, tyne and wear sr2 7lb","count":3},{"address":"93 dale grove, leyburn dl8 5ga","count":4},{"address":"flat 10, rose court, 1 ware street, stockton-on-tees, county durham ts20 2bf","count":3}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 78 addresses appear ≥3 times each (251 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":78,"total_dupe_rows":251,"examples":[{"address":"first & second floors, 69 north end, croydon, surrey, cr0 1tg","count":3},{"address":"6 ruskin walk, bromley, kent, br2 8ep","count":3},{"address":"land at brewers lane, gosport, hampshire, po13 0ju","count":3}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (45 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":45,"examples":[{"address":"llidiart y coed maenan, llanrwst, conwy, ll26 0yn","count":3},{"address":"38, admiral house 38-42, newport road, cardiff, cf24 0dh","count":3},{"address":"lower ground floor, lower ground floor 1 cwrt noddfa, aberdare, mid glamorgan, cf44 6dj","count":3}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 29 addresses appear ≥3 times each (98 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":29,"total_dupe_rows":98,"examples":[{"address":"23 alexandra road, shipley, west yorkshire bd18 3er","count":4},{"address":"flats 1-3, 70 austhorpe road, leeds, west yorkshire ls15 8dz","count":4},{"address":"40 whitehall waterfront, 2 riverside way, leeds, west yorkshire ls1 4ee","count":4}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (41 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":41,"examples":[{"address":"flat 9 imperial apartments, south western house, southampton, so14 3dw","count":5},{"address":"flat 3, 40 tivoli crescent, brighton, bn1 5nd","count":6},{"address":"auckland house, 55 st. ronans road, southsea, hampshire, po4 0pp","count":5}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 120/132 (91%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":120,"total":132,"ratio":0.909}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (52 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":52,"examples":[{"address":"flat 9, rutland house, 112, carrington street, derby, derbyshire de1 2nh","count":4},{"address":"2 lilac cottage, alport lane, bakewell, derbyshire de45 1wn","count":4},{"address":"56, chancel court, solihull, west midlands b91 3ds","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 66/67 (99%) lots have empty bullets
  - `{"empty":66,"total":67,"ratio":0.985}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"67a, harlesden gardens, harlesden, london, nw10 4hb","count":3},{"address":"5b, richmond way, london, w12 8lq","count":3},{"address":"83a, maswell park crescent, hounslow, middlesex, tw3 2ds","count":3}]}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":27,"examples":[{"address":"2 cottages, bath street, cheddar, somerset bs27 3ab","count":3},{"address":"187, 189, 191, 193 & 203 cardiff road, newport, gwent np20 3bp","count":3},{"address":"5 the parade, marshall road, waterloo, poole, dorset bh17 7ez","count":3}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":22,"examples":[{"address":"egerton gardens, london, sw3, united kingdom","count":3},{"address":"st johns way, london, n19, united kingdom","count":4},{"address":"bailey house, berber parade, london, se18, united kingdom","count":4}]}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"789 oak lane, coventry, cv1 2aa","count":3}]}`

## bradleyhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"6 nairn mews, carlton, nottingham, nottinghamshire, ng4 1be","count":4}]}`

## bradleysdevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"connaught avenue, plymouth, devon, pl4","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"dewhurst road, huddersfield","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"allocated strategic land freehold or for promotion hams way, rushwick, worcester, worcestershire, wr2 5sj","count":5}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 82 addresses appear ≥3 times each (256 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":82,"total_dupe_rows":256,"examples":[{"address":"9 ariana apartments, 89 lillie road, london sw6 1ud","count":3},{"address":"the beeches, llangrove, ross-on-wye, herefordshire hr9 6ex","count":3},{"address":"plot 1, land with planning permission , north of springfield road, kearsley, bolton, greater manchester bl4 8nb","count":3}]}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":33,"examples":[{"address":"west avenue, northwich","count":5},{"address":"broad street, crewe cw1 4jj","count":3},{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":8}]}`

## carterjonas

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"lot 4: leaze farm, weston-super-mare, bs24 0ez","count":3},{"address":"chestnut rise, cambridge, cb23 8tf","count":3},{"address":"unit 4 blackdown business park, wellington, ta21 8st","count":3}]}`

## charlesdarrow

- **[warn] image_coverage_low** — Image coverage low: 118/148 (80%) lots missing image_url
  - `{"missing":118,"total":148,"ratio":0.797}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":15,"examples":[{"address":"church end cottage, 14 church end, rampton, cambridge, cambridgeshire, cb24 8qa","count":3},{"address":"barns at ducks hall, ducks hall lane, cavendish, suffolk, co10 8al","count":4},{"address":"123 smith street, cambridge, cb1 1ab","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 20/39 (51%) lots missing image_url
  - `{"missing":20,"total":39,"ratio":0.513}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"14 crane close, bristol, bristol bs15 4nt","count":3},{"address":"for sale by auction29th april 2026","count":5},{"address":"11a, the centre, weston-super-mare, north somerset bs23 1uw","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 18/18 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":18,"total":18,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"middle green, sibton green, sibton, saxmundham, suffolk, ip17 2jx","count":3},{"address":"11 mill hoo, alderton, woodbridge, suffolk, ip12 3da","count":3},{"address":"sunnyholme, rishangles, eye, suffolk, ip23 7lb","count":3}]}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":16,"examples":[{"address":"456 broad street, birmingham, b1 1aa","count":3},{"address":"321 low street, liverpool, l1 1aa","count":3},{"address":"654 riverside avenue, glasgow, g1 1aa","count":3}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 46 addresses appear ≥3 times each (211 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":46,"total_dupe_rows":211,"examples":[{"address":"stables and land with planning in sought after location","count":3},{"address":"landmark freehold commercial building over four floors with rear vehicular access","count":3},{"address":"pair of flats with part vacant possession","count":3}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":47,"examples":[{"address":"land at westwood lane, wanborough, guildford, surrey, gu3 2jn","count":6},{"address":"land at mill lane, sturminster marshall, wimborne, dorset, bh21 4bd","count":6},{"address":"newark road, north hykeham, lincoln, lincolnshire, ln6","count":3}]}`

## cottons

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":23,"examples":[{"address":"former garages/stables/yard (plot 4), 123 new penkridge road, cannock, staffs, ws11 1hn","count":3},{"address":"131 victoria road, stechford, birmingham, west midlands, b33 8an","count":3},{"address":"apartment 103, the quadrant, 150 sand pits, birmingham, west midlands, b1 3rj","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (40 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":40,"examples":[{"address":"apartment 4, 75 henry street, liverpool, merseyside, l1 5bu","count":3},{"address":"7 the cliff, mevagissey, st. austell, cornwall, pl26 6qt","count":3},{"address":"20 westfield terrace, halifax, west yorkshire, hx1 4ap","count":3}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 11/11 (100%) lots have no price + no price_text
  - `{"tba":11,"total":11,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 11/11 (100%) lots missing image_url
  - `{"missing":11,"total":11,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 11/11 (100%) lots have empty bullets
  - `{"empty":11,"total":11,"ratio":1}`

## durrants

- **[warn] identical_price_wall** — Identical-price wall: 5/9 (56%) lots share price £100000 — extractor likely picking up hero/banner price
  - `{"price":100000,"count":5,"total":9,"ratio":0.556}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 88 addresses appear ≥3 times each (405 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":88,"total_dupe_rows":405,"examples":[{"address":"apartment 507, 55 queen street, salford, manchester, m3","count":4},{"address":"arden street, new mills, high peak, derbyshire, sk22","count":4},{"address":"apartment 3d, quay 5, 238 ordsall lane, salford, m5","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 492/516 (95%) lots have empty bullets
  - `{"empty":492,"total":516,"ratio":0.953}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 41 addresses appear ≥3 times each (141 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":41,"total_dupe_rows":141,"examples":[{"address":"flat 162 leybridge court, eltham road, london, se12 8tl","count":3},{"address":"4 wimpole road, colchester, essex, co1 2bx","count":3},{"address":"15 zetland road, gosport, hampshire, po12 3nz","count":3}]}`

## fishergerman

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"whapload road, lowestoft, nr32 1uh","count":3}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (48 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":48,"examples":[{"address":"flat 12, heathlands court, beaulieu road, dibden purlieu, southampton, hampshire, so45 4bb","count":3},{"address":"11 hinkler road, southampton, hampshire, so19 6fr","count":3},{"address":"14 surbiton road, eastleigh, hampshire, so50 4hz","count":3}]}`

## fssproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"east parade, harrogate, hg1 5lq","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 87 addresses appear ≥3 times each (341 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":87,"total_dupe_rows":341,"examples":[{"address":"4 stafford street, first floor flat, aberdeen","count":5},{"address":"22 kirkland walk, methil, fife","count":4},{"address":"commercial investment dalintober street, parking space b, glasgow city centre","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 584/585 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":584,"total":585,"ratio":0.998}`

## gherbertbanks

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"the paddock, worcester, wr6 6qa","count":4},{"address":"rose bank coppice, headley heath, b38 0dx","count":4},{"address":"old pear tree cottage, crowle, worcester wr7 4at","count":3}]}`

## goldings

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"35 – 37 garrick way, ipswich, suffolk, ip1 6nf","count":3}]}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (36 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":36,"examples":[{"address":"haybridge, wells, somerset, ba5","count":6},{"address":"old cleeve, washford, watchet, somerset, ta23","count":3},{"address":"badgworth, axbridge, somerset, bs26","count":3}]}`

## hairandson

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":47,"examples":[{"address":"flat 61, parkview apartments, 122, chrisp street, london, e14 6et","count":3},{"address":"56 / 58 / 68 and 70 maldon road, southend-on-sea, essex, ss2 5az","count":3},{"address":"6 high street, rayleigh, essex ss6 7eg","count":3}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"12, kettlemere close, ellesmere, sy12 0ea","count":3},{"address":"99, vyrnwy road, oswestry, sy11 1nz","count":4}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 45 addresses appear ≥3 times each (147 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":45,"total_dupe_rows":147,"examples":[{"address":"colton house, albert road, sheffield, south yorkshire, s8 9qw - online auctions","count":3},{"address":"grange court, grange road, shanklin, isle of wight, po37 6nn - online auctions","count":3},{"address":"tunnel road, ansley, nuneaton, warwickshire, cv10 9pf - online auctions","count":3}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":39,"examples":[{"address":"121a the annex, montgomery house, demesne road, manchester, m16 8ph","count":3},{"address":"bungalow 2 carlton court, barrowford road, colne, lancashire, bb8 9qp","count":3},{"address":"c401 royal crescent apartments, 1 royal crescent road, southampton, hampshire, so14 3ad","count":3}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"brook house, chapel lane, stoke heath, market drayton, shropshire, tf9 2jt","count":4},{"address":"3 st. johns road, burnley, lancashire, bb12 6rp","count":3},{"address":"87 ashington grove, coventry, west midlands, cv3 4dd","count":3}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"120 boundary park road, oldham, lancashire, ol1 2nz","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":11,"examples":[{"address":"ashford market, ashford","count":5},{"address":"ashford market, kent","count":6}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 102 addresses appear ≥3 times each (393 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":102,"total_dupe_rows":393,"examples":[{"address":"osborne villas, kingsdown, bs2 8bp","count":12},{"address":"shaplands, stoke bishop, bs9 1ay","count":5},{"address":"rivers street, walcot, ba1 2qa","count":5}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"123 example street, london, e1 1aa","count":3},{"address":"246 example boulevard, leeds, ls1 6ff","count":3},{"address":"579 example street, sheffield, s1 9aa","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`
- **[warn] image_coverage_low** — Image coverage low: 3/5 (60%) lots missing image_url
  - `{"missing":3,"total":5,"ratio":0.6}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"maple avenue, bishop auckland, dl4 2ag","count":3},{"address":"main street, shildon, dl4 1aw","count":3},{"address":"princess street, scarborough, yo11 1qr","count":3}]}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"gurney court road, st. albans, hertfordshire, al1 4rj","count":3},{"address":"bankhouse road, bury, lancashire, bl8 1dy","count":4},{"address":"-detached earlsmead, essex, cm8 2eh","count":3}]}`

## johnfrancis

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"dinas cross, newport, pembrokeshire, ...","count":3},{"address":"map iconicon set mapmap","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 10/10 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":10,"total":10,"ratio":1}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":38,"examples":[{"address":"primwell court, tibshelf business park, sawpit lane industrial estate, tibshelf de55 5nh","count":4},{"address":"vehicle auction manchester vehicle auction","count":4},{"address":"vehicle auction mitcham vehicle auction","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 97/125 (78%) lots have empty bullets
  - `{"empty":97,"total":125,"ratio":0.776}`

## jonespeckover

- **[warn] identical_price_wall** — Identical-price wall: 7/12 (58%) lots share price £20000 — extractor likely picking up hero/banner price
  - `{"price":20000,"count":7,"total":12,"ratio":0.583}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":38,"examples":[{"address":"bolventor, launceston, cornwall pl15","count":4},{"address":"ashwater, beaworthy, ex21","count":4},{"address":"west looe hill, looe, pl13","count":3}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (50 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":50,"examples":[{"address":"land at great treadam farm (47.73 acres), abergavenny, monmouthshire, np7 8ta","count":4},{"address":"swedish house, 1 dixons lane, broughton, stockbridge, hampshire, so20 8at","count":4},{"address":"21 strand-on-the-green, london, w4 3ph","count":7}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"18 albert road, south shields, tyne and wear, ne33 2lx","count":3},{"address":"flat 2, 35 oakhill road, horsham, west sussex, rh12 1nq","count":4},{"address":"20 meadow lane, leeds, west yorkshire, ls11 5bg","count":3}]}`

## lodgeandthomas

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"23 trewartha road, bodmin, cornwall, pl31 2je","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 35/35 (100%) lots missing image_url
  - `{"missing":35,"total":35,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 23/34 (68%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":23,"total":34,"ratio":0.676}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land and buildings off vinecote road, longford, coventry, west midlands cv6 6dz","count":3}]}`

## luscombemaye

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (45 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":45,"examples":[{"address":"queens terrace, totnes, tq9 5jq","count":5},{"address":"duncombe street, kingsbridge, tq7 1lr","count":3},{"address":"loddiswell , kingsbridge, tq7 4rb","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 49/54 (91%) lots have empty bullets
  - `{"empty":49,"total":54,"ratio":0.907}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"land at 36, stonehill, hanham,bristol, bs15 3hw","count":3},{"address":"264, gloucester road, horfield,bristol, bs7 8pb","count":3},{"address":"2, witcombe court, little witcombe, \\ gloucester, gl3 4ua","count":3}]}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 119 addresses appear ≥3 times each (395 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":119,"total_dupe_rows":395,"examples":[{"address":"brookfield hall, shrewbridge road, nantwich, cheshire cw5 7ad","count":4},{"address":"6 san remo terrace, dawlish, devon ex7 0aa","count":3},{"address":"4 waterside gardens, nottingham, nottinghamshire ng7 2hl","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 529/638 (83%) lots have empty bullets
  - `{"empty":529,"total":638,"ratio":0.829}`
- **[info] image_domain_mismatch** — Image domain mismatch: 614/638 (96%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":614,"total":638,"ratio":0.962}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"penybont, llandrindod wells, powys, ld1 5tu","count":3},{"address":"glamorgan street, brecon, powys, ld3 7dl","count":3},{"address":"bridgnorth road, kidderminster, worcestershire, dy11 5rr","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 55/72 (76%) lots have empty bullets
  - `{"empty":55,"total":72,"ratio":0.764}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"garage at, richmond walk, radcliffe, manchester, m26 4jn","count":3},{"address":"1-12 headley court, station approach, edenbridge, tn8 5ls","count":3},{"address":"42 oddy street, bradford, bd4 0pr","count":3}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":38,"examples":[{"address":"percy road, southsea po4 0bh","count":3},{"address":"villiers road, southsea po5 2hg","count":4},{"address":"nelson road, southsea po5 2as","count":4}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (72 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":72,"examples":[{"address":"17 north john street, liverpool, merseyside, l2 5qy","count":4},{"address":"woodward terrace, greenhithe, greenhithe, kent, da9 9dd","count":4},{"address":"millfield road, ilkeston, derbyshire, de7 5dj","count":4}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 68 addresses appear ≥3 times each (227 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":68,"total_dupe_rows":227,"examples":[{"address":"southwest medical ltd, comonin warehouse, mitchel troy, monmouth, np25 4bl","count":4},{"address":"182 commercial road, newport, gwent, np20 2pn","count":6},{"address":"land at the rear of parcel 2, wootton bassett road, swindon, wiltshire, sn1 4nq","count":3}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":38,"examples":[{"address":"lichfield road, portsmouth","count":3},{"address":"london road, horndean","count":3},{"address":"eastern parade, southsea","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 66/70 (94%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":66,"total":70,"ratio":0.943}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (61 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":61,"examples":[{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":4},{"address":"5a swains market, flackwell heath, high wycombe hp10 9bl","count":4},{"address":"2 old watery lane, wooburn moor, high wycombe hp10 0ny","count":5}]}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"64 tirgof, llangennech, llanelli, dyfed, sa14 8tp","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 28/32 (88%) lots have empty bullets
  - `{"empty":28,"total":32,"ratio":0.875}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":23,"examples":[{"address":"houseman drive, weston coyney, stoke-on-trent, st3 5sb","count":4},{"address":"catch bar lane, sheffield, s6 1ta","count":3},{"address":"cornwall street, hartlepool, ts25 5rf","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 140 addresses appear ≥3 times each (522 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":140,"total_dupe_rows":522,"examples":[{"address":"flat 14, ambassador house, 219 queensway, bletchingley, milton keynes, buckinghamshire mk2 2eh","count":3},{"address":"112 cemetery road, leeds, west yorkshire ls11 8be","count":3},{"address":"flats 1 & 2, 264 moss bay road, workington, cumbria ca14 3tl","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 59 addresses appear ≥3 times each (205 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":59,"total_dupe_rows":205,"examples":[{"address":"3 hardy street, selby, north yorkshire, yo8 8dq","count":3},{"address":"77 benson avenue, london, e6 3ee","count":3},{"address":"62 providence lane, walsall, west midlands, ws3 2aq","count":3}]}`

## rendells

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"buckleys harraton, ivybridge, pl21 0su","count":3},{"address":"bridford mills gospel hall, bridford, dunsford, devon, ex6 7jy","count":3},{"address":"land adjoining treeby, aish, devon, tq10 9jh","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":17,"examples":[{"address":"land east of dove lane, harrold, bedfordshire, mk43 7df","count":4},{"address":"10 churchfield road, chalfont st. peter, buckinghamshire, sl9 9en","count":4},{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":9}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"7 frogmore street, laugharne, carmarthen, dyfed, sa33 4sx","count":3}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"43 edgmond court, sunderland, tyne and wear, sr2 0dx","count":4},{"address":"36 station road, camperdown, newcastle upon tyne, tyne and wear, ne12 5ux","count":3}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 420 addresses appear ≥3 times each (1550 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":420,"total_dupe_rows":1550,"examples":[{"address":"384 green street, upton park, london e13 9ap","count":3},{"address":"36 tirycoed road, glanamman, ammanford, carmarthenshire, sa18 2ye","count":3},{"address":"62 powis street, london, se18 6lq","count":3}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (57 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":57,"examples":[{"address":"105, 107, 107a & 109 high street, alfreton, derbyshire de55 7dp","count":3},{"address":"54 lister street, grimsby, lincolnshire dn31 2jn","count":3},{"address":"1a eastway, castle donington, derby de74 2pn","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 161/161 (100%) lots have empty bullets
  - `{"empty":161,"total":161,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 161/161 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":161,"total":161,"ratio":1}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":30,"examples":[{"address":"3 keene street, newport, np19 0fu","count":3},{"address":"lock up garage, 40 dan-y-bryn, gilwern, abergavenny, np7 0bl","count":3},{"address":"land at baldwins crescent, swansea, sa1 8pt","count":5}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (104 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":104,"examples":[{"address":"160, whinney hill park, brighouse, calderdale, hd6 2ne","count":5},{"address":"12a byron studios, byron street bradford, bd3 0au","count":5},{"address":"25 the grand mill 132, sunbridge road bradford, bd1 2pf","count":4}]}`

## sheldonbosley

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"5 oak hill, wolverhampton, west midlands, wv3 9ae","count":5}]}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"18 grove lane, barrow-upon-soar, leicestershire, le12 8np","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 29/39 (74%) lots have empty bullets
  - `{"empty":29,"total":39,"ratio":0.744}`

## smithandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":35,"examples":[{"address":"2 beaconsfield road, liverpool, l21 1dt","count":3},{"address":"1a penrhyn avenue, thingwall, ch61 7up","count":3},{"address":"45 greenway road, birkenhead, ch42 0nd","count":3}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":37,"examples":[{"address":"the village hall, taunton, ta3 5ag","count":3},{"address":"the cliff , st. austell, pl26 6qt","count":3},{"address":"osney crescent, paignton, tq4 5ey","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (52 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":52,"examples":[{"address":"45 elm road, swindon, sn1 4ab","count":3},{"address":"123 high street, chippenham, sn15 3eb","count":3},{"address":"not available","count":23}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 46 addresses appear ≥3 times each (177 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":46,"total_dupe_rows":177,"examples":[{"address":"land off red lion lane, rear of prentice place, harlow, essex, cm17 9bg","count":3},{"address":"9 station road, westcliff-on-sea, essex, ss0 7ra","count":4},{"address":"664b high road leyton, leyton, waltham forest, e10 6jp","count":3}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":24,"examples":[{"address":"current auction lots","count":4},{"address":"for sale by tender","count":4},{"address":"buying","count":4}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 225 addresses appear ≥3 times each (821 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":225,"total_dupe_rows":821,"examples":[{"address":"8 mountain view, menai bridge, gwynedd, ll59 5en","count":4},{"address":"130 avon road, bournemouth, dorset, bh8 8sf","count":3},{"address":"2 parkend gardens, saltcoats, ayrshire, ka21 5ph","count":5}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"268 middle road, cwmdu, swansea, west glamorgan, sa5 8et","count":4},{"address":"8 furze crescent, morriston, swansea, west glamorgan, sa6 6bp","count":3}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"1 hillside gate hill, faversham, me13 9ln","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (73 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":73,"examples":[{"address":"37 brookland road west, liverpool, l13 3bg","count":5},{"address":"16 ullswater street, liverpool, l5 6qx","count":4},{"address":"95 alexandra road, crosby, merseyside, l23 7te","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 77/96 (80%) lots have empty bullets
  - `{"empty":77,"total":96,"ratio":0.802}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"doncaster, south yorkshire","count":3},{"address":"wetherby, west yorkshire","count":5},{"address":"goole, east yorkshire","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 37/38 (97%) lots have empty bullets
  - `{"empty":37,"total":38,"ratio":0.974}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/38 (97%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":37,"total":38,"ratio":0.974}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":27,"examples":[{"address":"site at rear of 15 eaton brae, rathgar, dublin 14","count":3},{"address":"west forth farm, forth, lanark","count":4},{"address":"2004 komatsu d65px dozer","count":4}]}`


