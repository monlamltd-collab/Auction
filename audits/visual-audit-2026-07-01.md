# Visual Audit — 2026-07-01

Scanned **27,067** rows in **18243ms** across **136** houses with findings.

**Findings:** 138 error · 14 warn · 25 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"the avenue, minehead, ta24 5ay","count":5},{"address":"new north road, exeter, ex4 4hf","count":3}]}`

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (58 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":58,"examples":[{"address":"140-142 broadway, didcot, oxfordshire, ox11 8rj","count":4},{"address":"speedy, 10a and part 11 rodney road, fratton, portsmouth, hampshire, po4 8sp","count":4},{"address":"33 clarges street, mayfair, london, w1j 7ee","count":3}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":13,"examples":[{"address":"maple street, ashington","count":5},{"address":"beatrice street, ashington","count":5},{"address":"fox street, seaham","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 40 addresses appear ≥3 times each (152 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":40,"total_dupe_rows":152,"examples":[{"address":"land south of stoke valley road, exeter, devon, ex4 5hg","count":6},{"address":"garage at 3 buckthorns, bracknell, berkshire, rg42 1ta","count":3},{"address":"land on the south side of simone weil avenue, ashford, kent, tn24 8qr","count":6}]}`
- **[warn] identical_price_wall** — Identical-price wall: 135/256 (53%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":135,"total":256,"ratio":0.527}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"49/52 pyle street & 22 south street newport, isle of wight, po30 1xb","count":3},{"address":"maghull manor, 1-9 old moat lane, liverpool, l31 8eu","count":3},{"address":"croydon square, barclay road annexe,  croydon college, croydon, cr9 1dx","count":4}]}`

## allwalesauction

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":24,"examples":[{"address":"bryn tirion mawr, gwynedd, ll33 0le","count":3},{"address":"gwynfryn , llanfairfechan, ll33 0dw","count":5},{"address":"tynrardd, anglesey, ll61 6ru","count":4}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":25,"examples":[{"address":"3 bed link detached house for sale in moore avenue, south shields, ne34","count":4},{"address":"2 bed semi-detached house for sale in bluebell way, south shields, ne34","count":5},{"address":"george street, coxlodge, ne3","count":5}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 77/77 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":77,"total":77,"ratio":1}`

## astleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"18 northampton lane, swansea, west glamorgan, sa1 4eh","count":3},{"address":"637 llangyfelach road, treboeth, swansea, west glamorgan, sa5 9en","count":4},{"address":"ebenezer chapel, garnswllt road, abertawe, swansea, sa4 8qg","count":3}]}`

## auctionestates

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"old bothie, broadgate lane, kelham, newark, notts, ng23 5rz","count":3},{"address":"14-18 graham street, airdrie, lanarkshire, ml6 6bu","count":4}]}`

## auctionhammermidlands

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"land adjacent 2, warrington street, fenton, stoke-on-trent, staffordshire st4 3lf","count":5},{"address":"21 oak avenue, great wyrley, walsall, staffordshire ws6 6hw","count":3},{"address":"76 stebbings, sutton hill, telford, shropshire tf7 4jw","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 45/49 (92%) lots have empty bullets
  - `{"empty":45,"total":49,"ratio":0.918}`
- **[info] image_domain_mismatch** — Image domain mismatch: 49/49 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":49,"total":49,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 41 addresses appear ≥3 times each (136 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":41,"total_dupe_rows":136,"examples":[{"address":"7 west street stonebroom, alfreton, derbyshire, de55 6lb","count":4},{"address":"19 white avenue, crewe, cheshire, cw2 7sh","count":4},{"address":"35 orient court gresley close, telford, shropshire, tf7 5tu","count":6}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":13,"examples":[{"address":"31b stanley street, luton, bedfordshire lu1 5al","count":5},{"address":"19 porlock drive, luton, bedfordshire lu2 9ll","count":4},{"address":"21 greenfield road, pulloxhill, bedford mk45 5ez","count":4}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (52 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":52,"examples":[{"address":"7a washington drive, birmingham, west midlands b20 2lr","count":4},{"address":"418 station road, dorridge, solihull, west midlands b93 8eu","count":4},{"address":"53 avon road, worcester, worcestershire wr4 9ag","count":3}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":18,"examples":[{"address":"57 houldsworth drive, chesterfield, derbyshire, s41 0bp","count":3},{"address":"25 sterland street, chesterfield, derbyshire, s40 1bn","count":4},{"address":"47 haldane crescent, bolsover, chesterfield, derbyshire s44 6ru","count":4}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 32 addresses appear ≥3 times each (109 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":32,"total_dupe_rows":109,"examples":[{"address":"55 birch meadow close, warwick, warwickshire cv34 4tz","count":5},{"address":"60 ridgethorpe, willenhall, coventry, west midlands cv3 3gq","count":5},{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":4}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":67,"examples":[{"address":"1 keith grove, the sands, appleby-in-westmorland, cumbria ca16 6xr","count":4},{"address":"15 norfolk street, carlisle, cumbria ca2 5jq","count":4},{"address":"the flat, kirk allans, stock lane, grasmere, ambleside, cumbria la22 9sn","count":5}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":31,"examples":[{"address":"8 penalverne place, penzance, cornwall tr18 2rq","count":3},{"address":"27a higher market street, penryn, cornwall tr10 8ef","count":3},{"address":"the car park at 26 beech road, st. austell, cornwall pl25 4ts","count":4}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 29 addresses appear ≥3 times each (110 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":29,"total_dupe_rows":110,"examples":[{"address":"2 town houses, burnthouse lane, toft monks, beccles, norfolk nr34 0es","count":4},{"address":"4 - 6 orchard street, norwich, norfolk nr2 4pp","count":4},{"address":"willow wood, 166 leverington road, wisbech, cambridgeshire pe13 1ru","count":4}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":5},{"address":"flat 11, lilystone hall, honeypot lane, stock, ingatestone, essex cm4 9gj","count":3},{"address":"5 shirley court, sedley rise, loughton, essex ig10 1lu","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 24/25 (96%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":24,"total":25,"ratio":0.96}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":30,"examples":[{"address":"80 brooklands road, hull, east yorkshire, hu5 5ae","count":4},{"address":"barmston methodist church, sands lane, barmston, driffield, yo25 8pg","count":3},{"address":"53 duesbery street, hull, east yorkshire, hu5 3qe","count":3}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"13b harmer street, gravesend, kent, da12 2ap","count":4},{"address":"flat 4 60 east street, sittingbourne, kent, me10 4rt","count":3},{"address":"flat 34 fisgard court, gravesend, kent, da12 2aw","count":3}]}`

## auctionhouseleicestershire

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":30,"examples":[{"address":"land on the south west side of, 17 thurnby lane, stoughton, leicestershire le2 2fp","count":3},{"address":"apartment 6 belvoir house 33-37, leicester, leicestershire, le1 6sl","count":4},{"address":"301 tudor studios 164 tudor road, leicester, leicestershire, le3 5hu","count":4}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 58 addresses appear ≥3 times each (197 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":58,"total_dupe_rows":197,"examples":[{"address":"flat a, 67 st. st georges road west, grangetown, cleveland, ts6 7hy","count":3},{"address":"225 ropery road, gainsborough, lincolnshire, dn21 2pd","count":3},{"address":"86 church street, gainsborough, lincolnshire, dn21 2js","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1008/1196 (84%) lots have no price + no price_text
  - `{"tba":1008,"total":1196,"ratio":0.843}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 56 addresses appear ≥3 times each (205 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":56,"total_dupe_rows":205,"examples":[{"address":"45 suffolk road, enfield, middlesex, en3 4ay","count":4},{"address":"flat 3 eleanor house, 89 east street, epsom, surrey, kt17 1dt","count":4},{"address":"93a high street, wealdstone, harrow, middlesex, ha3 5dl","count":3}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (111 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":111,"examples":[{"address":"3 raynham street, ashton-under-lyne, ol6 9nu","count":5},{"address":"3 bulls head court yard, commercial road, tideswell, buxton, derbyshire, sk17 8nu","count":5},{"address":"flat 34, renaissance house, millbrook street, stockport, sk1 3tn","count":5}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":24,"examples":[{"address":"15 bairstow street, blackpool, lancashire, fy1 5bn","count":3},{"address":"20, priestsic road, sutton-in-ashfield, nottinghamshire, ng17 4eb","count":5},{"address":"the apartment dufton hall, appleby-in-westmorland, cumbria, ca16 6dd","count":4}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":42,"examples":[{"address":"flat 53 5 freehold street, northampton, northamptonshire, nn2 6bf","count":3},{"address":"7 main street, cold ashby, northampton, northamptonshire nn6 6el","count":5},{"address":"23 and 23a colwyn road, northampton, northamptonshire nn1 3pz","count":6}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":47,"examples":[{"address":"55 cheltenham road, sunderland, tyne and wear, sr5 3qq","count":4},{"address":"29-31 fenkle street, alnwick ne66 1hw","count":3},{"address":"457 stanhope road, south shields, tyne and wear, ne33 4qy","count":4}]}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"789 willow lane, birmingham, b5 1aa","count":4},{"address":"123 high street, london, sw1a 1aa","count":4},{"address":"78 broad street, manchester, m1 3aa","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 15/22 (68%) lots missing image_url
  - `{"missing":15,"total":22,"ratio":0.682}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (64 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":64,"examples":[{"address":"18 alker street, chorley, lancashire pr7 2da","count":4},{"address":"2 cawdor street, bentley, doncaster, south yorkshire dn5 0nx","count":4},{"address":"north shore club, cross street, blackpool, lancashire fy1 2ea","count":3}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (60 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":60,"examples":[{"address":"139 nottingham road eastwood, nottingham, nottinghamshire, ng16 3gh","count":4},{"address":"5, 13 gillespie crescent bruntsfield, edinburgh, midlothian, eh10 4ht","count":4},{"address":"119 wharf road pinxton, nottingham, nottinghamshire, ng16 6lh","count":5}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 49 addresses appear ≥3 times each (211 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":49,"total_dupe_rows":211,"examples":[{"address":"4 millburn road, westfield, bathgate, west lothian eh48 3bt","count":5},{"address":"0/1, 5 brown street, newmilns, east ayrshire ka16 9ad","count":4},{"address":"80/82 channel street, galashiels, selkirkshire td1 1bd","count":5}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 345/345 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":345,"total":345,"ratio":1}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (105 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":105,"examples":[{"address":"flat 1, oxford house, 6 marlborough street, faringdon, oxfordshire sn7 7jp","count":4},{"address":"18 and 20 broad street, launceston, cornwall pl15 8aq","count":4},{"address":"30 torquay road, paignton, devon tq3 3ab","count":3}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 45 addresses appear ≥3 times each (145 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":45,"total_dupe_rows":145,"examples":[{"address":"16 derwent house samuel street, preston, lancashire, pr1 4yl","count":3},{"address":"plot 11 land adjoining armetriding reaches, chorley, lancashire, pr7 6gy","count":4},{"address":"flat 1 16 park crescent, leeds, west yorkshire, ls12 3nl","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1030/1109 (93%) lots have no price + no price_text
  - `{"tba":1030,"total":1109,"ratio":0.929}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":28,"examples":[{"address":"land /plot access @ alton court, staines-upon-thames, middlesex, tw18 3lj","count":3},{"address":"bankhouse 1 and 2, vinebank street, stoke-on-trent, staffordshire, st4 5ad","count":3},{"address":"infill land / plot @ forest edge, liss, hampshire, gu33 7bw","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (64 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":64,"examples":[{"address":"richards house, crosby road, northallerton dl6 1ae","count":4},{"address":"flat 1, 3 station road, redcar, north yorkshire ts10 1ah","count":6},{"address":"62 station road, st. helen auckland, bishop auckland, county durham dl14 9ex","count":6}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 103 addresses appear ≥3 times each (357 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":103,"total_dupe_rows":357,"examples":[{"address":"first & second floors, 69 north end, croydon, surrey, cr0 1tg","count":5},{"address":"6 ruskin walk, bromley, kent, br2 8ep","count":3},{"address":"a portfolio of eleven plots of land and roadways","count":3}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (36 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":36,"examples":[{"address":"land off sycamore close west side of heal-y-groes, bridgend, cf31 1qs","count":3},{"address":"122 oak street, abertillery, blaenau gwent, np13 1tq","count":3},{"address":"4 robins lane, barry, vale of glamorgan, cf63 1qr","count":3}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":25,"examples":[{"address":"2 spen mews, leeds, west yorkshire ls16 5qn","count":4},{"address":"6 sutherland terrace, leeds, west yorkshire, ls9 6dr","count":4},{"address":"flats 1-5 & 7b, 7 fairfax road, leeds, west yorkshire ls11 8sy","count":4}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"16 gloucester terrace, haswell, durham, county durham, dh6 2eg","count":3}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (74 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":74,"examples":[{"address":"flat 4, 16 kenilworth road, st leonards-on-sea, tn38 0jd","count":4},{"address":"flat 1, 13 junction road, burgess hill, rh15 0hr","count":4},{"address":"grasshopper cottage, margards lane, verwood, dorset, bh31 6jq","count":4}]}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"4 vine cottage, main road, spalding, lincolnshire pe11 3dg","count":4},{"address":"32-34 the cornmarket, derby, derbyshire, de1 2dg","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 49/51 (96%) lots have empty bullets
  - `{"empty":49,"total":51,"ratio":0.961}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"flat 60, grosvenor court, london road, morden, surrey, sm4 5hg","count":4},{"address":"25, haynes close, slough, berkshire, sl3 8na","count":4},{"address":"30, coldshott, oxted, surrey, rh8 9bj","count":3}]}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"61, 61a & 61b botley road, oxford, oxfordshire ox2 0bp","count":4},{"address":"bushey, hertfordshire","count":4},{"address":"2 cottages, bath street, cheddar, somerset bs27 3ab","count":3}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"124 chelwater, great baddow, chelmsford, cm2 7ur, united kingdom","count":4},{"address":"egerton gardens, london, sw3, united kingdom","count":3},{"address":"burnham house, station road, ascot, berkshire, sl5, united kingdom","count":4}]}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3 lodge hill, defford, worcester, wr8 9ad","count":3}]}`

## bowensonandwatson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3 ruthin road, wrexham, ll13 7nu","count":3}]}`

## bradleysdevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"connaught avenue, plymouth, devon, pl4","count":3},{"address":"30 high street, london, w1d 4eg","count":3},{"address":"10 downing street, london, sw1a 2aa","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"dewhurst road, huddersfield","count":5},{"address":"789 oak lane, birmingham, b1 1cd","count":3},{"address":"123 high street, london, w1a 1aa","count":3}]}`

## brggibsondublin

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (54 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":54,"examples":[{"address":"55 boyne meadows, edenderry, county offaly, r45 cr62","count":3},{"address":"1 boyagh, porthall, ballindrait, donegal, f93 y39x","count":3},{"address":"8 monabraher road, ballynanty, limerick, co. limerick, v94 we2y","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land to the north of beach lane bromsberrow heath, gloucestershire, hr8 1pe","count":3}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 99 addresses appear ≥3 times each (338 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":99,"total_dupe_rows":338,"examples":[{"address":"rose villa, 3 east street, alford, lincolnshire ln13 9eq","count":4},{"address":"9 ariana apartments, 89 lillie road, london sw6 1ud","count":3},{"address":"the beeches, llangrove, ross-on-wye, herefordshire hr9 6ex","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 684/855 (80%) lots have empty bullets
  - `{"empty":684,"total":855,"ratio":0.8}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":28,"examples":[{"address":"west avenue, northwich","count":4},{"address":"peggys bank, wood lane, stoke-on-trent st7 8rh","count":7},{"address":"lavender close, stoke-on-trent","count":3}]}`

## carterjonas

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at stanton fitzwarren, wiltshire, sn3 4tg","count":3}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"52 high street, torrington, ex38 8ap","count":4},{"address":"19 the square, porthleven, cornwall, tr13 9dq","count":4},{"address":"the old post office, fore street, st keverne, cornwall, tr12 6ql","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 65/84 (77%) lots missing image_url
  - `{"missing":65,"total":84,"ratio":0.774}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":20,"examples":[{"address":"church end cottage, 14 church end, rampton, cambridge, cambridgeshire, cb24 8qa","count":3},{"address":"70 high street, little wilbraham, cambridgeshire, cb21 5jy","count":4},{"address":"northfield house, 6 malton lane, meldreth, hertfordshire, sg8 6pa","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 30/58 (52%) lots missing image_url
  - `{"missing":30,"total":58,"ratio":0.517}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"14 crane close, bristol, bristol bs15 4nt","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 12/12 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":12,"total":12,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"105 high street, leiston, suffolk, ip16 4bx","count":4},{"address":"middle green, sibton green, sibton, saxmundham, suffolk, ip17 2jx","count":3},{"address":"11 mill hoo, alderton, woodbridge, suffolk, ip12 3da","count":4}]}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"456 broad street, birmingham, b1 1aa","count":3},{"address":"321 low street, liverpool, l1 1aa","count":3},{"address":"654 riverside avenue, glasgow, g1 1aa","count":3}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 32 addresses appear ≥3 times each (144 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":32,"total_dupe_rows":144,"examples":[{"address":"stables and land with planning in sought after location","count":3},{"address":"landmark freehold commercial building over four floors with rear vehicular access","count":3},{"address":"approximately 26 acres of land","count":3}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 33 addresses appear ≥3 times each (125 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":33,"total_dupe_rows":125,"examples":[{"address":"bowthorpe house, gatwick road, crawley, west sussex, rh10","count":4},{"address":"bishopric court, horsham, west sussex, rh12","count":4},{"address":"16 hyde heath court, crawley, west sussex, rh10 3uq","count":4}]}`

## cottons

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"former garages/stables/yard (plot 4), 123 new penkridge road, cannock, staffs, ws11 1hn","count":3},{"address":"131 victoria road, stechford, birmingham, west midlands, b33 8an","count":3},{"address":"apartment 103, the quadrant, 150 sand pits, birmingham, west midlands, b1 3rj","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 44 addresses appear ≥3 times each (165 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":44,"total_dupe_rows":165,"examples":[{"address":"apartment 4, 75 henry street, liverpool, merseyside, l1 5bu","count":3},{"address":"7 the cliff, mevagissey, st. austell, cornwall, pl26 6qt","count":8},{"address":"20 westfield terrace, halifax, west yorkshire, hx1 4ap","count":4}]}`

## dawsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"28, western lane mumbles, swansea, sa3 4ey","count":4}]}`

## driversnorris

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"property for sale in london","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 17/17 (100%) lots have no price + no price_text
  - `{"tba":17,"total":17,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 17/17 (100%) lots missing image_url
  - `{"missing":17,"total":17,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 17/17 (100%) lots have empty bullets
  - `{"empty":17,"total":17,"ratio":1}`

## durrants

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"my shortlist","count":3}]}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 47 addresses appear ≥3 times each (170 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":47,"total_dupe_rows":170,"examples":[{"address":"apartment 507, 55 queen street, salford, manchester, m3","count":7},{"address":"arden street, new mills, high peak, derbyshire, sk22","count":7},{"address":"roseway, macclesfield, cheshire, sk11","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 315/377 (84%) lots have empty bullets
  - `{"empty":315,"total":377,"ratio":0.836}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 35 addresses appear ≥3 times each (123 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":35,"total_dupe_rows":123,"examples":[{"address":"1 wilcox avenue, mansfield woodhouse, mansfield, nottinghamshire, ng19 8hd","count":4},{"address":"47a cannon lane, pinner, middlesex, ha5 1hn","count":4},{"address":"83 firth drive, birmingham, west midlands, b14 4dl","count":4}]}`

## fishergerman

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"whapload road, lowestoft, nr32 1uh","count":3}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (51 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":51,"examples":[{"address":"flat 12, heathlands court, beaulieu road, dibden purlieu, southampton, hampshire, so45 4bb","count":3},{"address":"11 hinkler road, southampton, hampshire, so19 6fr","count":3},{"address":"14 surbiton road, eastleigh, hampshire, so50 4hz","count":3}]}`

## fssproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"high street, pateley bridge, hg3 5ap","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 114 addresses appear ≥3 times each (404 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":114,"total_dupe_rows":404,"examples":[{"address":"41 urquhart road (eastmost fff & coal cellar), aberdeen","count":4},{"address":"27 jasmine terrace, aberdeen","count":4},{"address":"31.38 acre site at easterhill, gartmore, stirling","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 663/663 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":663,"total":663,"ratio":1}`

## gherbertbanks

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"no.3 school lane, stourbridge, dy9 9ld","count":3}]}`

## goldings

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"35 – 37 garrick way, ipswich, suffolk, ip1 6nf","count":3},{"address":"flats a,b & c, 81 burrell road, ipswich, suffolk, ip2 8ad","count":3}]}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (66 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":66,"examples":[{"address":"golden hill, wiveliscombe, taunton, somerset, ta4","count":4},{"address":"north street, taunton, somerset, ta1","count":4},{"address":"somerset, ta11","count":4}]}`

## hairandson

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":16,"examples":[{"address":"123 high street, southend-on-sea, ss1 2ab","count":4},{"address":"13 leigh road, leigh-on-sea, essex, ss9 1jp","count":4},{"address":"456 elm road, southend-on-sea, ss2 8cd","count":4}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (29 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":29,"examples":[{"address":"119, wrexham road, whitchurch, sy13 1jf","count":4},{"address":"12, kettlemere close, ellesmere, sy12 0ea","count":3},{"address":"bishops castle","count":4}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 65 addresses appear ≥3 times each (245 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":65,"total_dupe_rows":245,"examples":[{"address":"bold place, liverpool, merseyside, l1 9dn - online auctions","count":4},{"address":"north end avenue, portsmouth, po2 9eb - online auctions","count":4},{"address":"swallow fields, liverpool, merseyside, l9 6ed - online auctions","count":4}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":23,"examples":[{"address":"121a the annex, montgomery house, demesne road, manchester, m16 8ph","count":3},{"address":"bungalow 2 carlton court, barrowford road, colne, lancashire, bb8 9qp","count":3},{"address":"c401 royal crescent apartments, 1 royal crescent road, southampton, hampshire, so14 3ad","count":3}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"3 st. johns road, burnley, lancashire, bb12 6rp","count":5},{"address":"213 robin hood way, london, sw20 0aa","count":3},{"address":"144 arden gate, balby, doncaster, south yorkshire, dn4 9dp","count":3}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"6 braybrooke terrace, hastings, east sussex, tn34 1td","count":3},{"address":"30 mersey walk, warrington, cheshire, wa4 1su","count":3},{"address":"8 kingsway, nuneaton, warwickshire, cv11 5lp","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":25,"examples":[{"address":"ashford market, ashford","count":6},{"address":"ashford market, kent","count":19}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 96 addresses appear ≥3 times each (394 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":96,"total_dupe_rows":394,"examples":[{"address":"osborne villas, kingsdown, bs2 8bp","count":25},{"address":"stapleton road, st judes, bs5 0pw","count":4},{"address":"courtenay walk, worle, bs22 7tq","count":4}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"123 example street, london, e1 1aa","count":3},{"address":"246 example boulevard, leeds, ls1 6ff","count":3},{"address":"579 example street, sheffield, s1 9aa","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"maple avenue, bishop auckland, dl4 2ag","count":3},{"address":"main street, shildon, dl4 1aw","count":5},{"address":"princess street, scarborough, yo11 1qr","count":3}]}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"gurney court road, st. albans, hertfordshire, al1 4rj","count":3},{"address":"vesey close, sutton coldfield, west midlands, b74 4qn","count":3}]}`

## johnfrancis

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"dinas cross, newport, pembrokeshire, ...","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 19/21 (90%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":19,"total":21,"ratio":0.905}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":28,"examples":[{"address":"vehicle auction mitcham vehicle auction","count":3},{"address":"vehicle auction belvedere vehicle auction","count":3},{"address":"chesterfield","count":8}]}`
- **[info] bullet_starvation** — Bullet starvation: 101/131 (77%) lots have empty bullets
  - `{"empty":101,"total":131,"ratio":0.771}`

## jonespeckover

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"pump field, grange road, llangollen, wrexham, ll20 8ap","count":4},{"address":"0.99 acres of land, leadbrook drive, flint, flintshire, ch6 5st","count":3}]}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (51 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":51,"examples":[{"address":"bolventor, launceston, cornwall pl15","count":3},{"address":"ashwater, beaworthy, ex21","count":4},{"address":"south street, hatherleigh, okehampton, devon ex20","count":7}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (66 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":66,"examples":[{"address":"dartington lodge, dartington hall, totnes, devon, tq9 6ea","count":8},{"address":"land at great treadam farm (47.73 acres), abergavenny, monmouthshire, np7 8ta","count":6},{"address":"swedish house, 1 dixons lane, broughton, stockbridge, hampshire, so20 8at","count":6}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":39,"examples":[{"address":"18 albert road, south shields, tyne and wear, ne33 2lx","count":3},{"address":"9 lime tree place, ipswich, suffolk, ip1 5fa","count":3},{"address":"apartment 5, 191 water street, manchester, lancashire, m3 4ja","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 76/147 (52%) lots missing image_url
  - `{"missing":76,"total":147,"ratio":0.517}`

## lodgeandthomas

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"6 meadow lane, st. columb, cornwall, tr9 6bj","count":3},{"address":"12 trewartha road, bodmin, cornwall, pl31 2je","count":3},{"address":"11 trewartha road, bodmin, cornwall, pl31 2je","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 52/52 (100%) lots missing image_url
  - `{"missing":52,"total":52,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 20/24 (83%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":20,"total":24,"ratio":0.833}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":39,"examples":[{"address":"flat 1, walton court, 100 bath street, rugby, warwickshire cv21 3jd","count":4},{"address":"flat 5, the mews 15-17, north street, atherstone, west midlands cv9 1jn","count":4},{"address":"flat 4, william house, st. christopher court, evesham, worcestershire wr11 4ll","count":6}]}`
- **[info] bullet_starvation** — Bullet starvation: 61/74 (82%) lots have empty bullets
  - `{"empty":61,"total":74,"ratio":0.824}`

## luscombemaye

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":20,"examples":[{"address":"devon square, kingsbridge, tq7 1ee","count":4},{"address":"queens terrace, totnes, tq9 5jq","count":7},{"address":"duncombe street, kingsbridge, tq7 1lr","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 40/45 (89%) lots have empty bullets
  - `{"empty":40,"total":45,"ratio":0.889}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"land at 36, stonehill, hanham,bristol, bs15 3hw","count":3},{"address":"9, pows court, high street, midsomer norton, ba3 2le","count":3},{"address":"52, st johns lane, bedminster, bristol, bs3 5ad","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 43/70 (61%) lots missing image_url
  - `{"missing":43,"total":70,"ratio":0.614}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 55 addresses appear ≥3 times each (191 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":55,"total_dupe_rows":191,"examples":[{"address":"flat, kedleston court, norbury close, allestree, derby de22 2qe","count":4},{"address":"29 lowther street, carlisle, cumbria ca3 8ee","count":4},{"address":"34 mayfield road, ashbourne, derbyshire de6 1ar","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 404/490 (82%) lots have empty bullets
  - `{"empty":404,"total":490,"ratio":0.824}`
- **[info] image_domain_mismatch** — Image domain mismatch: 445/490 (91%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":445,"total":490,"ratio":0.908}`

## martinpole

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"3 cranford park drive, yateley, hampshire, gu46 6jr","count":5}]}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":12,"examples":[{"address":"penybont, llandrindod wells, powys, ld1 5tu","count":4},{"address":"glamorgan street, brecon, powys, ld3 7dl","count":4},{"address":"crai, brecon, powys, ld3 8ys","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 62/74 (84%) lots have empty bullets
  - `{"empty":62,"total":74,"ratio":0.838}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":25,"examples":[{"address":"53 norfolk street, blackburn, bb2 4ew","count":4},{"address":"129 cherrydown avenue, chingford, e4 8dx","count":4},{"address":"42 oddy street, bradford, bd4 0pr","count":3}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"percy road, southsea po4 0bh","count":3}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 30 addresses appear ≥3 times each (98 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":30,"total_dupe_rows":98,"examples":[{"address":"mallard crescent, sittingbourne, kent, me9 8tj","count":4},{"address":"montague road, hounslow, middlesex, tw3 1ld","count":4},{"address":"regency square, brighton, east sussex, bn1 2fj","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 384/766 (50%) lots missing image_url
  - `{"missing":384,"total":766,"ratio":0.501}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 208 addresses appear ≥3 times each (813 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":208,"total_dupe_rows":813,"examples":[{"address":"gwenlli, llanbedrog, pwllheli, gwynedd, ll53 7pg","count":4},{"address":"31 commercial street, newport, gwent, np20 1hj","count":6},{"address":"58 orchard street, weston-super-mare, avon, bs23 1rl","count":6}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (70 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":70,"examples":[{"address":"lichfield road, portsmouth","count":7},{"address":"london road, horndean","count":5},{"address":"eastern parade, southsea","count":5}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 85/87 (98%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":85,"total":87,"ratio":0.977}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (68 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":68,"examples":[{"address":"gwynfryn, new street, rhosllanerchrugog, wrexham ll14 1re","count":9},{"address":"5a swains market, flackwell heath, high wycombe hp10 9bl","count":8},{"address":"2 old watery lane, wooburn moor, high wycombe hp10 0ny","count":3}]}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"64 tirgof, llangennech, llanelli, dyfed, sa14 8tp","count":4},{"address":"92 st. catherine street, carmarthen, dyfed, sa31 1rf","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 39/43 (91%) lots have empty bullets
  - `{"empty":39,"total":43,"ratio":0.907}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"thurlby motors, mumby road, alford, ln13 9jn","count":4},{"address":"saddlery way, chester, ch1 4lw","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 102 addresses appear ≥3 times each (377 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":102,"total_dupe_rows":377,"examples":[{"address":"95 tunstall lane, wigan, lancashire wn5 9hr","count":4},{"address":"flat 14, ambassador house, 219 queensway, bletchingley, milton keynes, buckinghamshire mk2 2eh","count":3},{"address":"112 cemetery road, leeds, west yorkshire ls11 8be","count":4}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 107 addresses appear ≥3 times each (379 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":107,"total_dupe_rows":379,"examples":[{"address":"80 faygate court hemlington, middlesbrough, cleveland, ts8 9lg","count":4},{"address":"5 the copse featherstone, pontefract, west yorkshire, wf7 6lz","count":4},{"address":"99 parrs wood road, manchester, lancashire, m20 4sh","count":4}]}`

## rendells

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"buckleys harraton, ivybridge, pl21 0su","count":3},{"address":"10 bank lane, victoria street, totnes, tq9 5eh","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":17,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":11},{"address":"flat 6, 37 studley road, luton, bedfordshire, lu3 1bb","count":3},{"address":"28 laburnum road, sandy, bedfordshire, sg19 1hg","count":3}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":17,"examples":[{"address":"garage/workshop, malpas road, newport, gwent, np20 6na","count":5},{"address":"7 frogmore street, laugharne, carmarthen, dyfed, sa33 4sx","count":6},{"address":"98 risca road, cross keys, newport, gwent, np11 7dh","count":3}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (57 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":57,"examples":[{"address":"74 falstone avenue, newcastle upon tyne, tyne and wear, ne15 7sg","count":3},{"address":"57 biddlestone road, newcastle upon tyne, tyne and wear, ne6 5sl","count":3},{"address":"68 cobden terrace, gateshead, tyne and wear, ne8 3tb","count":5}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":35,"examples":[{"address":"13 horn lane, acton, london w3 9nj","count":4},{"address":"384 green street, upton park, london e13 9ap","count":3},{"address":"36 tirycoed road, glanamman, ammanford, carmarthenshire, sa18 2ye","count":3}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"317 castle boulevard, nottingham ng7 1hp","count":4},{"address":"land at chatterton hey, exchange street, edenfield, ramsbottom, bury, lancashire bl0 0qh","count":3},{"address":"the cottage, r/o 46 church street, paignton, devon tq3 3ah","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 135/135 (100%) lots have empty bullets
  - `{"empty":135,"total":135,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 135/135 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":135,"total":135,"ratio":1}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"3 keene street, newport, np19 0fu","count":3},{"address":"lock up garage, 40 dan-y-bryn, gilwern, abergavenny, np7 0bl","count":3},{"address":"87 high street, merthyr tydfil, cf47 8ug","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 32 addresses appear ≥3 times each (160 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":32,"total_dupe_rows":160,"examples":[{"address":"521 collonnade sunbridge road bradford, bd1 2hq","count":4},{"address":"160, whinney hill park, brighouse, calderdale, hd6 2ne","count":10},{"address":"16, delph hill, baildon, shipley, bd17 5hj","count":4}]}`

## sheldonbosley

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"5 oak hill, wolverhampton, west midlands, wv3 9ae","count":3}]}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"18 grove lane, barrow-upon-soar, leicestershire, le12 8np","count":5},{"address":"65 henton road, off glenfield road, leicester, le3 6ay","count":3},{"address":"123 example street, london, e1 1eg","count":3}]}`

## smithandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"2 beaconsfield road, liverpool, l21 1dt","count":3},{"address":"1a penrhyn avenue, thingwall, ch61 7up","count":3},{"address":"45 greenway road, birkenhead, ch42 0nd","count":3}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (32 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":32,"examples":[{"address":"the village hall, taunton, ta3 5ag","count":3},{"address":"the cliff , st. austell, pl26 6qt","count":3},{"address":"osney crescent, paignton, tq4 5ey","count":3}]}`

## starpropertyonline

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"53 rushlake road, brighton, east sussex, bn1 9ag","count":4}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":42,"examples":[{"address":"123 main street, swindon, sn1 2ab","count":4},{"address":"789 park avenue, salisbury, sp1 3jf","count":4},{"address":"456 high street, chippenham, sn15 1aq","count":4}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 27 addresses appear ≥3 times each (132 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":27,"total_dupe_rows":132,"examples":[{"address":"33b canterbury road, london, e10 6ee","count":5},{"address":"98 morieux road, leyton, london, e10 7ll","count":6},{"address":"51 northbrook road, ilford, redbridge, ig1 3bp","count":6}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":23,"examples":[{"address":"buying","count":3},{"address":"1 pendrea place, gulval, penzance, cornwall, tr18 3ne","count":3},{"address":"flats 1 & 2, 357a edge lane, fairfield, liverpool, liverpool, l7 9lg","count":4}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 214 addresses appear ≥3 times each (895 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":214,"total_dupe_rows":895,"examples":[{"address":"75 redcar road, guisborough, cleveland, ts14 6hr","count":4},{"address":"8 mountain view, menai bridge, gwynedd, ll59 5en","count":4},{"address":"202 old town, glasgow, g1 3ab","count":4}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"pembroke buildings, 31 cambrian place, swansea, west glamorgan, sa1 1rl","count":4},{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":3},{"address":"8 furze crescent, morriston, swansea, west glamorgan, sa6 6bp","count":3}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (51 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":51,"examples":[{"address":"apartment 424a, lakeshore drive, bristol, bs13 7be","count":3},{"address":"37 the purple apartments broadway plaza, birmingham, b16 8eq","count":3},{"address":"191 maiden lane, dartford, da1 4pt","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (66 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":66,"examples":[{"address":"37 brookland road west, liverpool, l13 3bg","count":6},{"address":"apt.19 9 hatton garden, liverpool, l3 2fe","count":4},{"address":"95 alexandra road, crosby, merseyside, l23 7te","count":5}]}`
- **[info] bullet_starvation** — Bullet starvation: 86/105 (82%) lots have empty bullets
  - `{"empty":86,"total":105,"ratio":0.819}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":18,"examples":[{"address":"wetherby, west yorkshire","count":3},{"address":"11 victoria road, sowerby bridge, west yorkshire, hx6 1ab","count":4},{"address":"land adjacent to 15 back lane, sowerby bridge, west yorkshire, hx6 1ju","count":4}]}`

## williamhbrownnorwich

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":24,"examples":[{"address":"5, ladysmock way, norwich, norfolk nr5 9fg","count":4},{"address":"3, shepherd purse way, norwich, norfolk nr5 9fd","count":4},{"address":"5, shepherd purse way, norwich, norfolk nr5 9fd","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 16/27 (59%) lots share price £210000 — extractor likely picking up hero/banner price
  - `{"price":210000,"count":16,"total":27,"ratio":0.593}`
- **[info] bullet_starvation** — Bullet starvation: 26/27 (96%) lots have empty bullets
  - `{"empty":26,"total":27,"ratio":0.963}`
- **[info] image_domain_mismatch** — Image domain mismatch: 26/27 (96%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":26,"total":27,"ratio":0.963}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":37,"examples":[{"address":"site at rear of 15 eaton brae, rathgar, dublin 14","count":4},{"address":"west forth farm, forth, lanark","count":4},{"address":"61 church street, newry","count":5}]}`


