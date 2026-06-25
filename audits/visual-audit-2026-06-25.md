# Visual Audit — 2026-06-25

Scanned **26,127** rows in **18006ms** across **119** houses with findings.

**Findings:** 114 error · 11 warn · 20 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"brookfields, cargreen, pl12 6ns","count":4}]}`

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3-5 station road, didcot, oxfordshire, ox11 7lu","count":3}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"beatrice street, ashington","count":3},{"address":"coatham road, redcar","count":4}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":38,"examples":[{"address":"land at the gavel, south molton, devon, ex36 4bp","count":3},{"address":"plot 78 land fronting high street, boston spa, wetherby, west yorkshire, ls23 6sy","count":3},{"address":"7e, 7f, 9 & 9a high street, barnet, hertfordshire, en5 5ue","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 90/129 (70%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":90,"total":129,"ratio":0.698}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (43 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":43,"examples":[{"address":"36-44 and 46 watford way, hendon, london, nw4 3al","count":3},{"address":"26-44 chapel street, exmouth, ex8 1hr","count":3},{"address":"boughton industrial estate, cocking hill, boughton, newark, ng22 9ld","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":16,"examples":[{"address":"market lane, dunston, ne11","count":5},{"address":"stanhope road, south shields, ne33","count":3},{"address":"hedworth lane, boldon colliery, ne35","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 64/64 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":64,"total":64,"ratio":1}`

## auctionestates

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"holwell sports & social club, 41 welby road, asfordby hill, melton mowbray, leicestershire, le14 3rd","count":3}]}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 48/49 (98%) lots have empty bullets
  - `{"empty":48,"total":49,"ratio":0.98}`
- **[info] image_domain_mismatch** — Image domain mismatch: 49/49 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":49,"total":49,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":37,"examples":[{"address":"4 linden street, nottingham, nottinghamshire, ng3 4nd","count":3},{"address":"apartment 3 delamere place, runcorn, cheshire, wa7 4ne","count":5},{"address":"the lookout post lane, honiton, devon, ex14 9hz","count":3}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"19 porlock drive, luton, bedfordshire lu2 9ll","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":20,"examples":[{"address":"319 blackpool street, burton-on-trent, west midlands de14 3aw","count":3},{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":4},{"address":"34 hamilton road, handsworth, birmingham, west midlands b21 8ah","count":4}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"2 the poplars, main road, cutthorpe, chesterfield, derbyshire, s42 7ah","count":4},{"address":"51 dunston lane, chesterfield, derbyshire, s41 8ey","count":3},{"address":"47 haldane crescent, bolsover, chesterfield, derbyshire, s44 6ru","count":3}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":24,"examples":[{"address":"14 beckbury road, walsgrave, coventry, west midlands cv2 2dy","count":3},{"address":"52 abbey court, whitley, coventry, west midlands cv3 4bb","count":3},{"address":"49 caldecott street, hillmorton, rugby, west midlands cv21 3th","count":4}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (87 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":87,"examples":[{"address":"rye close barn, stockdalewath, dalston, carlisle, cumbria ca5 7dp","count":3},{"address":"72 and 74 curzon street, maryport, cumbria ca15 6da","count":3},{"address":"jolly fryer, burneside, kendal, cumbria la9 6qt","count":3}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"unit 1 communication centre, par moor road, par, cornwall pl24 2sq","count":3},{"address":"32 south street, braunton, devon ex33 2aa","count":3},{"address":"51 priory road, lower compton, plymouth, devon pl3 5ep","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 55/76 (72%) lots have empty bullets
  - `{"empty":55,"total":76,"ratio":0.724}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (71 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":71,"examples":[{"address":"60 nottingham way, great yarmouth, norfolk, nr30 2rz","count":3},{"address":"flat 5 2 victoria road, colchester, essex, co3 3nt","count":5},{"address":"39 stonegate, spalding, lincolnshire pe11 2ph","count":4}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":3},{"address":"169/169a dunstans road, east dulwich, southwark, london se22 0hb","count":3},{"address":"flat 2, 509 southchurch road, southend-on-sea, essex ss1 2ph","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 23/24 (96%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":23,"total":24,"ratio":0.958}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (41 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":41,"examples":[{"address":"16 willow court, beverley, east yorkshire, hu17 7lw","count":3},{"address":"apartment 6 kemley house, prospect street, hull, east yorkshire, hu2 8ny","count":3},{"address":"field house surgery, victoria road, bridlington, east yorkshire, yo15 2at","count":3}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"flat 58 miller heights 43-51, maidstone, kent, me15 6ln","count":4},{"address":"14 elysium park close whitfield, dover, kent, ct16 2fj","count":3}]}`

## auctionhouseleicestershire

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"apartment 67 alexandra house, rutland street, leicester, leicestershire, le1 1sq","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 25 addresses appear ≥3 times each (81 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":25,"total_dupe_rows":81,"examples":[{"address":"2 green lane, bishop auckland, county durham, dl14 6rs","count":3},{"address":"15 bairstow street, blackpool, lancashire, fy1 5bn","count":4},{"address":"82 hartington road, stockton-on-tees, cleveland, ts18 1he","count":5}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 630/750 (84%) lots have no price + no price_text
  - `{"tba":630,"total":750,"ratio":0.84}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 69 addresses appear ≥3 times each (276 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":69,"total_dupe_rows":276,"examples":[{"address":"postponed","count":4},{"address":"65 highwood avenue, high wycombe, buckinghamshire, hp12 4ls","count":5},{"address":"1 belmore gardens, bath, avon, ba2 1hu","count":5}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (64 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":64,"examples":[{"address":"3 kirkby avenue, moston, manchester, m40 5hn","count":4},{"address":"flat 34, renaissance house, millbrook street, stockport, sk1 3tn","count":7},{"address":"apartment 28, the victory, 165 union street, oldham, ol1 1td","count":3}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"357. pye green road, cannock, staffordshire, ws11 5rw","count":3},{"address":"405 - 405a poulton road, wallasey, merseyside, ch44 4df","count":4},{"address":"11, gateford road, worksop, nottinghamshire, s80 1dy","count":3}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":42,"examples":[{"address":"10 the leys, roade, northampton, northamptonshire nn7 2nr","count":3},{"address":"apartment a, 99 abington avenue, northampton, northamptonshire nn1 4pb","count":3},{"address":"7 cameron crescent, northampton, northamptonshire nn5 5pd","count":3}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"201 stamfordham road, newcastle upon tyne, tyne and wear, ne5 3jh","count":3},{"address":"26 richardson street, ashington, northumberland, ne63 0pn","count":3},{"address":"55a alexandra road, ashington, northumberland, ne63 9hg","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 359/475 (76%) lots have no price + no price_text
  - `{"tba":359,"total":475,"ratio":0.756}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 17/21 (81%) lots missing image_url
  - `{"missing":17,"total":21,"ratio":0.81}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 29 addresses appear ≥3 times each (93 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":29,"total_dupe_rows":93,"examples":[{"address":"apartment 6, fearnley mill drive, huddersfield, west yorkshire hd5 0rd","count":5},{"address":"apartment 20, 9 hatton garden, liverpool, merseyside l3 2fe","count":3},{"address":"flat 5 william reynolds house, street, somerset, ba16 0al","count":4}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":20,"examples":[{"address":"4/6 lonsdale terrace, edinburgh, midlothian, eh3 9hn","count":3},{"address":"5, 13 gillespie crescent bruntsfield, edinburgh, midlothian, eh10 4ht","count":3},{"address":"6/8 bruntsfield place, edinburgh, midlothian, eh10 4hn","count":4}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 51 addresses appear ≥3 times each (192 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":51,"total_dupe_rows":192,"examples":[{"address":"2 farley, beauly, highland iv4 7af","count":3},{"address":"81-83 high street, elgin, moray iv30 1ea","count":3},{"address":"corner house, garrabost, isle of lewis, na h-eileanan siar hs2 0pw","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 296/298 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":296,"total":298,"ratio":0.993}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 54 addresses appear ≥3 times each (186 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":54,"total_dupe_rows":186,"examples":[{"address":"34 orchard meadow, chagford, newton abbot, devon tq13 8bp","count":3},{"address":"st. alan flat & st. james flat & st. stephen flat, 12 turf street, bodmin, cornwall pl31 2dh","count":5},{"address":"4 bellevue terrace, brislington, bristol, bristol bs4 4jp","count":3}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 77 addresses appear ≥3 times each (274 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":77,"total_dupe_rows":274,"examples":[{"address":"freehold of 6 romilly avenue, barry, south glamorgan, cf62 6rb","count":4},{"address":"freehold land known as plot 4 etruria valley and land north of etruria, stoke-on-trent, staffordshire, st1 5nh","count":5},{"address":"freehold ground rent interest 12 sandringham road, southport, merseyside, pr8 2jz","count":4}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1841/1917 (96%) lots have no price + no price_text
  - `{"tba":1841,"total":1917,"ratio":0.96}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"apartment 17 delamere place, runcorn, cheshire, wa7 4ne","count":3},{"address":"69 hawksmoor road, stafford, staffordshire, st17 9ds","count":3},{"address":"land @ rosemere drive, chester, cheshire, ch1 6pd","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (93 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":93,"examples":[{"address":"93 dale grove, leyburn dl8 5ga","count":3},{"address":"93 broadway east, redcar, north yorkshire ts10 5dt","count":5},{"address":"114 valley road, northallerton, north yorkshire dl6 1sh","count":3}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 135 addresses appear ≥3 times each (472 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":135,"total_dupe_rows":472,"examples":[{"address":"flat 3, 108 guildford street, chertsey, surrey, kt16 9ah","count":3},{"address":"flat 77 tennyson apartments, 1 saffron central square, croydon, surrey, cr0 2fw","count":5},{"address":"flat 47 nexus court, malvern road, kilburn, london, nw6 5at","count":4}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (109 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":109,"examples":[{"address":"32 bentley street farnworth, bolton, lancashire, bl4 7pw","count":6},{"address":"18 bryn castell, abergele, conwy, ll22 8qa","count":4},{"address":"36 royal sovereign apartments, phoebe road, copper quarter, pentrechwyth, swansea, sa1 7fh","count":4}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (32 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":32,"examples":[{"address":"3 grange terrace, allerton, bradford, west yorkshire bd15 7se","count":3},{"address":"9 newstead avenue, fitzwilliam, pontefract, west yorkshire wf9 5dt","count":3},{"address":"4 fieldhouse court, lane end, clayton, bradford, west yorkshire bd14 6jn","count":3}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"66 hessewelle crescent, haswell, durham, county durham, dh6 2eh","count":4}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (61 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":61,"examples":[{"address":"23c shirley drive, hove, bn3 6nq","count":3},{"address":"flat 2, 6 st augustine road, littlehampton, west sussex, bn17 5ng","count":3},{"address":"53 dominica court, eastbourne, bn23 5tr","count":3}]}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"2, edward street, dudley, west midlands dy1 2ae","count":3},{"address":"addlethorpe mill, mill lane, skegness, lincolnshire pe24 4tb","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 47/47 (100%) lots have empty bullets
  - `{"empty":47,"total":47,"ratio":1}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"bushey, hertfordshire","count":3}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"dorset mansions, lillie road, london, sw6, united kingdom","count":3},{"address":"cobbett road, guildford, gu2, united kingdom","count":3},{"address":"apartment 15, the george hotel, high street, melton mowbray, leicestershire le13 0tu, united kingdom","count":3}]}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"13 foxyards road, tipton, dy4 8bh","count":3},{"address":"43 jerrys lane, erdington, birmingham, b23 5nx","count":3}]}`

## bradleyhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"22 dean street, shildon, county durham, dl4 1ez","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"tolson crescent, huddersfield","count":3}]}`

## brownco

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"8 town close road, norwich, norfolk, nr2 2nb","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at southam ratcliff lawns, cheltenham, gl52 3pb","count":3}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":47,"examples":[{"address":"6-8 harrow place, blackpool, lancashire fy4 1rp","count":3},{"address":"unit 1 slate house, oakwood court, city road, bradford, west yorkshire bd8 8jy","count":3},{"address":"flat 1019, churchill place, churchill way, basingstoke, hampshire rg21 7es","count":3}]}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (29 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":29,"examples":[{"address":"underwood lane, crewe","count":4},{"address":"hanley road, stoke-on-trent st1 6bl","count":4},{"address":"fraser street, stoke on trent st6 2dp","count":3}]}`

## charlesdarrow

- **[warn] image_coverage_low** — Image coverage low: 95/112 (85%) lots missing image_url
  - `{"missing":95,"total":112,"ratio":0.848}`

## cheffinstimed

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"reed cottage, holywell, st. ives, cambridgeshire, pe27 4tg","count":3}]}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"land at, old bristol road, keynsham bs31 2aa","count":3},{"address":"for sale by auction29th april 2026","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 15/15 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":15,"total":15,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"40 & 40a, westgate street, ipswich, suffolk, ip1 3ed","count":4},{"address":"sunnyholme, rishangles, eye, suffolk, ip23 7lb","count":3},{"address":"woodside, westleton road, yoxford, saxmundham, suffolk, ip17 3ld","count":3}]}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":18,"examples":[{"address":"gwendraeth town, kidwelly, carmarthenshire.","count":3},{"address":"gnoll park road, neath, neath port talbot.","count":3},{"address":"high street, llandybie, ammanford, carmarthenshire","count":3}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (66 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":66,"examples":[{"address":"newport - isle of wight","count":4},{"address":"penzance - cornwall","count":4},{"address":"st. austell - cornwall","count":3}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"land at sandy lane north, wirral, merseyside, ch61 4xu","count":3},{"address":"the hawthorn, the green, great cheverell, devizes, wiltshire, sn10 5uy","count":3},{"address":"land at westwood lane, wanborough, guildford, surrey, gu3 2jn","count":3}]}`

## cottons

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (36 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":36,"examples":[{"address":"oak court, harrison road, four oaks, sutton coldfield, west midlands, b74 4jl","count":3},{"address":"62 farm road, oldbury, west midlands, b68 8rd","count":3},{"address":"200 hednesford road, heath hayes, cannock, staffordshire, ws12 3dz","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"flat 2 l1 boutique apartments, 14 colquitt street, liverpool, liverpool, l1 4de","count":3},{"address":"apartment 3, 75 henry street, liverpool, merseyside, l1 5bu","count":3},{"address":"49 robarts road, liverpool, merseyside, l4 0ty","count":3}]}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 106 addresses appear ≥3 times each (389 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":106,"total_dupe_rows":389,"examples":[{"address":"apartment 1401, 5 pomona strand, manchester, greater manchester, m16","count":4},{"address":"kensington street, rochdale, ol11","count":3},{"address":"apartment 12, douro house, 11, wellington road, stockport, sk4","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 478/515 (93%) lots have empty bullets
  - `{"empty":478,"total":515,"ratio":0.928}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (53 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":53,"examples":[{"address":"8 leonard road, gosport, hampshire, po12 4tu","count":3},{"address":"16 nelson street, broughton, salford, lancashire, m7 1nb","count":3},{"address":"6 cunningham avenue, guildford, surrey, gu1 2pe","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (82 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":82,"examples":[{"address":"83 cairncry road, aberdeen","count":3},{"address":"171-173 high street, let three investement, ayr","count":4},{"address":"41 king street, kilmarnock","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 370/372 (99%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":370,"total":372,"ratio":0.995}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":12,"examples":[{"address":"mark causeway, mark, highbridge, somerset, ta9","count":4},{"address":"butleigh moor drove, walton, street, somerset, ta7","count":3},{"address":"haybridge, wells, somerset, ba5","count":5}]}`

## hairandson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"51 / 51a hainault avenue, westcliff-on-sea, essex, ss0 9ha","count":3}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"queen anne cottage, whitehurst, wrexham, ll14 5as","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (38 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":38,"examples":[{"address":"232 swallow street, iver, buckinghamshire, sl0 0ht","count":4},{"address":"plot of land","count":3},{"address":"28 church road, leighton buzzard, bedfordshire, lu7 2lr","count":4}]}`

## hawkesford

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at leamington road, ryton-on-dunsmore","count":3}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"doris avenue, bolton, lancashire, bl2 6db","count":3},{"address":"flat 503 rede house, 63-75 corporation road, middlesbrough, middlesbrough, ts1 1ly","count":3}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"elizabeth house, church street, liskeard, cornwall, pl14 3ag","count":3},{"address":"flat 4, 43 south terrace, littlehampton, west sussex, bn17 5nu","count":3},{"address":"flat 2, 302a stanstead road, london, lewisham, se23 1de","count":4}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"35 gilsland road, thornton heath, surrey, cr7 8rq","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"ashford market, ashford, kent","count":4},{"address":"ashford market, kent","count":5}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 73 addresses appear ≥3 times each (297 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":73,"total_dupe_rows":297,"examples":[{"address":"lower high street, shirehampton, bs11 0aw","count":5},{"address":"blackmoor, langford, bs40 5hj","count":4},{"address":"gayner road, horfield, bs7 0sw","count":4}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"789 sample avenue, birmingham, b3 3cc","count":3},{"address":"daventry, nn11","count":4}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"southcliffe, 2 south drive, harrogate, hg2 8au","count":3}]}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 8/8 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":8,"total":8,"ratio":1}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":42,"examples":[{"address":"general auction \\| chesterfield \\| saleroom 46 \\| home delivery","count":3},{"address":"general auction \\| chesterfield \\| saleroom 35 \\| home delivery","count":5},{"address":"general auction \\| birmingham \\| saleroom 107 \\| home delivery","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'johnpye' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"johnpye"}`

## jonespeckover

- **[warn] identical_price_wall** — Identical-price wall: 6/11 (55%) lots share price £20000 — extractor likely picking up hero/banner price
  - `{"price":20000,"count":6,"total":11,"ratio":0.545}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":22,"examples":[{"address":"liftondown, lifton, pl16","count":3},{"address":"upton, bude, ex23","count":3},{"address":"bolventor, launceston, cornwall pl15","count":4}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 addresses appear ≥3 times each (63 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":17,"total_dupe_rows":63,"examples":[{"address":"8 locksbrook road, bath, ba1 3ey","count":4},{"address":"the hearts of oak, forest of dean, drybrook, gloucestershire, gl17 9ee","count":3},{"address":"white horse inn, church road, soudley, cinderford, gloucestershire, gl14 2ua","count":3}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"apartment 1604 viadux, 42 great bridgewater street, manchester, lancashire, m1 5lj","count":3},{"address":"107 the parklands, dunstable, bedfordshire, lu5 4gw","count":3},{"address":"21 meadow lane, leeds, west yorkshire, ls11 5bg","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 86/150 (57%) lots missing image_url
  - `{"missing":86,"total":150,"ratio":0.573}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 38/38 (100%) lots missing image_url
  - `{"missing":38,"total":38,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"ty cenin, dyffryn ardudwy, merionethshire, ll44 2dg","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 23/36 (64%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":23,"total":36,"ratio":0.639}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":19,"examples":[{"address":"land 14 - 16 ash green lane, ash green, coventry, warwickshire cv7 9ah","count":3},{"address":"land and buildings off vinecote road, longford, coventry, west midlands cv6 6dz","count":4},{"address":"148 poole road, radford, coventry, west midlands cv6 1hw","count":4}]}`

## luscombemaye

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"loddiswell, kingsbridge, tq7 4rb","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 24/28 (86%) lots have empty bullets
  - `{"empty":24,"total":28,"ratio":0.857}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":39,"examples":[{"address":"290 school road, sheffield, south yorkshire s10 1gr","count":3},{"address":"land at bent street & elm street, newsome, huddersfield, west yorkshire hd4 6nx","count":3},{"address":"unit 1 slate house, oakwood court, city road, bradford, west yorkshire bd8 8jy","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 378/438 (86%) lots have empty bullets
  - `{"empty":378,"total":438,"ratio":0.863}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"foxglove close, stourport-on-severn, worcestershire, dy13 9bn","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 70/84 (83%) lots have empty bullets
  - `{"empty":70,"total":84,"ratio":0.833}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (40 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":40,"examples":[{"address":"land between, 24 & 26 aylesbury drive, great notley, braintree, cm77 7aw","count":4},{"address":"18 malvern road, cambridge, cb1 9ld","count":4},{"address":"97 brighton road, godalming, gu7 1pw","count":3}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":17,"examples":[{"address":"st george's road, southsea po4 9pl","count":5},{"address":"north street, havant po9 1pt","count":4},{"address":"southampton road, portsmouth, hampshire, po6 4ry","count":4}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":42,"examples":[{"address":"17 north john street, liverpool, merseyside, l2 5qy","count":4},{"address":"thirteenth street, horden, peterlee, durham, sr8 4qp","count":3},{"address":"brayford wharf east, lincoln, lincolnshire, ln5 7bg","count":4}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 69 addresses appear ≥3 times each (232 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":69,"total_dupe_rows":232,"examples":[{"address":"southwest medical ltd, comonin warehouse, mitchel troy, monmouth, np25 4bl","count":3},{"address":"74 ruspidge road, cinderford, gloucestershire, gl14 3ae","count":5},{"address":"land at cardiff road, trelewis, treharris, merthyr tydfil, cf46 5ey","count":3}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"85 canute road, southampton","count":3},{"address":"25 high street, ventnor","count":3},{"address":"fareham road, gosport. auction guide price £180,000.","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 52/52 (100%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":52,"total":52,"ratio":1}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":39,"examples":[{"address":"16 windermere avenue, wembley, middlesex ha9 8sf","count":4},{"address":"flat 5 winchester way, scawsby, doncaster dn5 8ll","count":3},{"address":"site rear of 6 woodham lane, new haw, addlestone kt15 3na","count":4}]}`

## propertyauctionagent

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"18 heol y felin, pontyberem, llanelli, dyfed, sa15 5eh","count":3},{"address":"9 glanmor place, llanelli, dyfed, sa15 2rg","count":3},{"address":"14 balaclava street, st. thomas, swansea, west glamorgan, sa1 8bs","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 38/42 (90%) lots have empty bullets
  - `{"empty":38,"total":42,"ratio":0.905}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (58 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":58,"examples":[{"address":"westbeach, westward ho, bideford, devon, ex39 1lq","count":7},{"address":"apartment 21, the atrium, 141 london road, liverpool, l3 8ja","count":3},{"address":"westbar house, 70 furnace hill, sheffield, s3 7bz","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (80 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":80,"examples":[{"address":"flats 1 & 2, 262 moss bay road, workington, cumbria ca14 3tl","count":3},{"address":"former sand bay care home, 7 court road, kewstoke, weston-super-mare bs22 9ut","count":3},{"address":"crow wood, blackburn road, edenfield, ramsbottom, lancashire bl0 0gh","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 32 addresses appear ≥3 times each (98 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":32,"total_dupe_rows":98,"examples":[{"address":"11 jerome way shipton-on-cherwell, kidlington, oxfordshire, ox5 1jt","count":3},{"address":"22 de havilland way, hartlepool, cleveland, ts25 2dw","count":4},{"address":"9 whitland road, carshalton, surrey, sm5 1qx","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":8,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":8}]}`

## rogerparry

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"63 coton manor, berwick road, shrewsbury, shropshire, sy1 2ly","count":4}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":31,"examples":[{"address":"30 rayleigh grove, gateshead, tyne and wear, ne8 4qq","count":3},{"address":"34b clayton street west, newcastle upon tyne, tyne and wear, ne1 5dz","count":4},{"address":"306 old durham road, gateshead, tyne and wear, ne8 4bq","count":3}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 26 addresses appear ≥3 times each (90 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":26,"total_dupe_rows":90,"examples":[{"address":"land at brocks lane, frilsham, berkshire, rg18 9uy","count":5},{"address":"one station square, bracknell, rg12 1qn","count":3},{"address":"38-40 high street, andover sp10 1nn","count":3}]}`

## sdl

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"8 st. annes street, preston, lancashire pr1 6ds","count":3},{"address":"13 dornoch avenue, sherwood, nottingham ng5 4dq","count":3},{"address":"flat 1, 26 st. james road, sutton, surrey sm1 2tp","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 266/269 (99%) lots have empty bullets
  - `{"empty":266,"total":269,"ratio":0.989}`
- **[info] image_domain_mismatch** — Image domain mismatch: 268/269 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":268,"total":269,"ratio":0.996}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"57/57a commercial street, kenfig hill, bridgend, cf33 6dh","count":3},{"address":"7 ty devonia, pierhead view, penarth, cf64 1sj","count":3},{"address":"117 high street, barry, cf62 7dt","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (61 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":61,"examples":[{"address":"49 byron halls, byron street, bradford, bd3 0ar","count":4},{"address":"6, bordale avenue manchester, m9 4lq","count":5},{"address":"2, roberts buildings halifax, hx2 0an","count":5}]}`

## sheldonbosley

- **[warn] image_coverage_low** — Image coverage low: 18/31 (58%) lots missing image_url
  - `{"missing":18,"total":31,"ratio":0.581}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"76 guthlaxton street, highfields, leicester, le2 0se","count":3},{"address":"4 rannoch close, beaumont leys, leicester, le4 0re","count":4},{"address":"9 frankson avenue, narborough road south, leicester, le3 2gj","count":3}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"st aubyn's engine house, redruth, tr16 5hd","count":3}]}`

## starpropertyonline

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"market house, church road, worthing, west sussex, bn13 1hf","count":3},{"address":"garages 1 & 2 to the r/o, 17 st. catherines road, littlehampton, west sussex, bn17 5hr","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":16,"examples":[{"address":"not available","count":16}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":23,"examples":[{"address":"the knot barn, 1 station road, padstow, cornwall, pl28 8db","count":5},{"address":"98 morieux road, leyton, london, e10 7ll","count":3},{"address":"51 northbrook road, ilford, redbridge, ig1 3bp","count":3}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":39,"examples":[{"address":"7 the cliff, mevagissey, st. austell, cornwall, pl26 6qt","count":5},{"address":"stable barn cottage, 1 stable lane, torquay, devon, tq1 4sa","count":4},{"address":"apartment 26 liberty place, 10 madison square, liverpool, merseyside, l1 5fd","count":4}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"quarry close, swanage, bh19","count":4},{"address":"the square, beaminster, dt83as","count":3},{"address":"little hill, chard, ta20","count":3}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 146 addresses appear ≥3 times each (572 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":146,"total_dupe_rows":572,"examples":[{"address":"12 sunny brow road, middleton, manchester, lancashire, m24 4bg","count":5},{"address":"yew tree cottage, linton, ross-on-wye, herefordshire, hr9 7rs","count":5},{"address":"236 market street, whitworth, rochdale, lancashire, ol12 8eg","count":5}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"162 port tennant road, port tennant, swansea, west glamorgan, sa1 8jn","count":3},{"address":"apartment 18, 154-155 st. helens road, swansea, west glamorgan, sa1 4dj","count":3},{"address":"land rear of 8 brynawelon road, cwmllynfell, swansea, west glamorgan, sa9 2wg","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":28,"examples":[{"address":"95 alexandra road, crosby, merseyside, l23 7te","count":4},{"address":"apt. 62 east float quay dock road, birkenhead, ch41 1dn","count":4},{"address":"apartment 5 11 sir thomas street, liverpool, l1 6bw","count":3}]}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"brighouse, west yorkshire","count":3},{"address":"unit 1a, prospect business park, prospect road, dewsbury, west yorkshire, wf12 8db","count":3}]}`

## webbers

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"high street, bideford, ex39 2aa","count":3},{"address":"st. davids close, bude, ex23 9jp","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 23/24 (96%) lots have empty bullets
  - `{"empty":23,"total":24,"ratio":0.958}`
- **[info] image_domain_mismatch** — Image domain mismatch: 23/24 (96%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":23,"total":24,"ratio":0.958}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (29 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":29,"examples":[{"address":"12 the park, lutterell hall, summerhill road, dunboyne","count":3},{"address":"10 archdeaconry view, kells, co meath","count":3},{"address":"63 kilnside road, paisley, renfrewshire","count":3}]}`


