# Visual Audit — 2026-06-24

Scanned **26,052** rows in **16807ms** across **126** houses with findings.

**Findings:** 119 error · 12 warn · 23 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"brookfields, cargreen, pl12 6ns","count":3}]}`

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"104 high street, whitton, twickenham, london, tw2 7ln","count":3},{"address":"magnet kitchens, cherry tree house, 59 staines road, twickenham, london, tw2 5bh","count":3},{"address":"holiday inn express, reedfield place, walton summit centre, bamber bridge, preston, pr5 8aa","count":3}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"beatrice street, ashington","count":3},{"address":"coatham road, redcar","count":4}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"land south of stoke valley road, exeter, devon, ex4 5hg","count":3},{"address":"a portfolio of eleven plots of land and roadways","count":4},{"address":"land on the east side of walton road, chesterfield, derbyshire, s40 2db","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 62/107 (58%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":62,"total":107,"ratio":0.579}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 26 addresses appear ≥3 times each (78 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":26,"total_dupe_rows":78,"examples":[{"address":"21-23 munden street, hammersmith, london, w14 0rh","count":3},{"address":"st john's place, easton street, high wycombe, hp11 1nl","count":3},{"address":"35 rowan court & 37 chesterfields, cobden avenue, bitterne park, southampton, so18 1fu","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"market lane, dunston, ne11","count":3},{"address":"stanhope road, south shields, ne33","count":3},{"address":"george street, coxlodge, ne3","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 65/65 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":65,"total":65,"ratio":1}`

## astleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"19 approach road, manselton, swansea, swansea, sa5 8pd","count":3}]}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 45/46 (98%) lots have empty bullets
  - `{"empty":45,"total":46,"ratio":0.978}`
- **[info] image_domain_mismatch** — Image domain mismatch: 46/46 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":46,"total":46,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (34 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":34,"examples":[{"address":"apartment 3 delamere place, runcorn, cheshire, wa7 4ne","count":3},{"address":"34 ashwood close oldbury, oldbury, west midlands, b69 4sd","count":3},{"address":"land / plot @ abingdon road, maidstone, kent, me16 9dp","count":4}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat 30, summers house, coxhill way, aylesbury, buckinghamshire, hp21 8fn","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"179 erdington hall road, birmingham, west midlands, b24 8jb","count":3},{"address":"4 hafren court, bewdley, worcestershire dy12 2ar","count":3},{"address":"5 ranby road, hillfields, coventry, west midlands cv2 4gs","count":3}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"2 the poplars, main road, cutthorpe, chesterfield, derbyshire, s42 7ah","count":3},{"address":"12 park view, hasland, chesterfield, derbyshire, s41 0jd","count":3},{"address":"47 haldane crescent, bolsover, chesterfield, derbyshire, s44 6ru","count":3}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":37,"examples":[{"address":"49 caldecott street, hillmorton, rugby, west midlands cv21 3th","count":4},{"address":"land and buildings off vinecote road, longford, coventry, west midlands cv6 6dz","count":3},{"address":"flat 4, 12 spencer street, leamington spa, warwickshire cv31 3nf","count":3}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 33 addresses appear ≥3 times each (133 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":33,"total_dupe_rows":133,"examples":[{"address":"rye close barn, stockdalewath, dalston, carlisle, cumbria ca5 7dp","count":3},{"address":"72 and 74 curzon street, maryport, cumbria ca15 6da","count":5},{"address":"swallows lodge, mawbray, maryport, cumbria ca15 6qt","count":6}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"units 1-11, the old national school, st. thomas road, launceston, cornwall pl15 8bu","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 86/90 (96%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":86,"total":90,"ratio":0.956}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (45 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":45,"examples":[{"address":"39 stonegate, spalding, lincolnshire pe11 2ph","count":4},{"address":"11 queens place, mill road, great yarmouth, norfolk nr31 0ht","count":4},{"address":"rockys bar and restaurant, king george v playing field, chequers lane, papworth everard, cambridgeshire cb23 3qq","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":3},{"address":"5 shirley court, sedley rise, loughton, essex ig10 1lu","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 15/15 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":15,"total":15,"ratio":1}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (32 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":32,"examples":[{"address":"16 willow court, beverley, east yorkshire, hu17 7lw","count":4},{"address":"apartment 6 kemley house, prospect street, hull, east yorkshire, hu2 8ny","count":4},{"address":"field house surgery, victoria road, bridlington, east yorkshire, yo15 2at","count":3}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"flat 29 scotney gardens, maidstone, kent, me16 0gr","count":3},{"address":"flat 1 50a high street, new romney, kent, tn28 8at","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 72 addresses appear ≥3 times each (251 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":72,"total_dupe_rows":251,"examples":[{"address":"11 st. lawrence drive, gainsborough, lincolnshire, dn21 1qq","count":3},{"address":"9 oak avenue shirebrook, mansfield, nottinghamshire, ng20 8nr","count":4},{"address":"82 hartington road, stockton-on-tees, cleveland, ts18 1he","count":7}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1040/1240 (84%) lots have no price + no price_text
  - `{"tba":1040,"total":1240,"ratio":0.839}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 50 addresses appear ≥3 times each (210 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":50,"total_dupe_rows":210,"examples":[{"address":"postponed","count":5},{"address":"38 shepiston lane, hayes, middlesex, ub3 1lw","count":6},{"address":"34 de montfort road, streatham hill, london, sw16 1lz","count":4}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":42,"examples":[{"address":"3 kirkby avenue, moston, manchester, m40 5hn","count":3},{"address":"flat 34, renaissance house, millbrook street, stockport, sk1 3tn","count":7},{"address":"5 green lane, delph, saddleworth, ol3 5ep","count":3}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":30,"examples":[{"address":"flat 9, 142-144 eastern road, brighton, brighton & hove, bn2 0ae","count":4},{"address":"barnsdale hognaston, ashbourne, derbyshire, de6 1pr","count":3},{"address":"hollybush farm thwaite road, bungay, suffolk, nr35 2rx","count":3}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":25,"examples":[{"address":"flat 6, grosvenor house, 18 grosvenor gardens, northampton, northamptonshire nn2 7rs","count":4},{"address":"10 the leys, roade, northampton, northamptonshire nn7 2nr","count":5},{"address":"51 thetford close, corby, northamptonshire, nn18 9ph","count":4}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"47 hilden park ingleby barwick, stockton-on-tees, cleveland, ts17 5aj","count":4},{"address":"7 - 9 marine parade, saltburn-by-the-sea, cleveland, ts12 1dp","count":3},{"address":"58 general havelock road, sunderland, tyne and wear, sr4 6xn","count":3}]}`

## auctionhousenorthwales

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"123 high street, london, e1 2ab","count":3},{"address":"202 maple avenue, leeds, ls1 1dd","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 14/18 (78%) lots missing image_url
  - `{"missing":14,"total":18,"ratio":0.778}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (81 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":81,"examples":[{"address":"apartment 6, fearnley mill drive, huddersfield, west yorkshire hd5 0rd","count":6},{"address":"flat 5 william reynolds house, street, somerset, ba16 0al","count":3},{"address":"202 torrisholme road, lancaster, lancashire la1 2td","count":4}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"land next to 7 beauvale road hucknall, nottingham, nottinghamshire, ng15 6pf","count":3},{"address":"5, 13 gillespie crescent bruntsfield, edinburgh, midlothian, eh10 4ht","count":3},{"address":"6/8 bruntsfield place, edinburgh, midlothian, eh10 4hn","count":4}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 48 addresses appear ≥3 times each (194 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":48,"total_dupe_rows":194,"examples":[{"address":"corner house, garrabost, isle of lewis, na h-eileanan siar hs2 0pw","count":4},{"address":"flat 3, 16 store lane, rothesay, rothesay, isle of bute, argyll and bute pa20 9aa","count":3},{"address":"farmhouse 1, mid ingliston, forfar, angus dd8 1tj","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 328/332 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":328,"total":332,"ratio":0.988}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":22,"examples":[{"address":"land associated with 861 wolseley road, plymouth, devon, pl5 1jx","count":3},{"address":"4 brandon road, plymouth, pl3 6at","count":3},{"address":"60 carnarthen street, camborne, cornwall tr14 8up","count":3}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 234 addresses appear ≥3 times each (781 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":234,"total_dupe_rows":781,"examples":[{"address":"freehold land known as plot 4 etruria valley and land north of etruria, stoke-on-trent, staffordshire, st1 5nh","count":4},{"address":"freehold ground rent interest 12 sandringham road, southport, merseyside, pr8 2jz","count":4},{"address":"plots 51 and 52, land denby line, garden lane, doncaster, south yorkshire, dn5 7sn","count":6}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1918/2012 (95%) lots have no price + no price_text
  - `{"tba":1918,"total":2012,"ratio":0.953}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"land off promenade gardens promenade gardens, aigburth, liverpool, l17 2ep","count":3},{"address":"haulfryn greenfields, froncysyllte, llangollen, clwyd, ll20 7sw","count":3},{"address":"4 hassells bridge hassell street, newcastle, staffordshire, st5 1bf","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":37,"examples":[{"address":"93 dale grove, leyburn dl8 5ga","count":4},{"address":"93 broadway east, redcar, north yorkshire ts10 5dt","count":5},{"address":"31 stobart terrace, fishburn, stockton-on-tees, county durham ts21 4af","count":3}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 86 addresses appear ≥3 times each (308 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":86,"total_dupe_rows":308,"examples":[{"address":"flat 3, 108 guildford street, chertsey, surrey, kt16 9ah","count":5},{"address":"flat 77 tennyson apartments, 1 saffron central square, croydon, surrey, cr0 2fw","count":4},{"address":"flat 47 nexus court, malvern road, kilburn, london, nw6 5at","count":5}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (43 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":43,"examples":[{"address":"32 bentley street farnworth, bolton, lancashire, bl4 7pw","count":3},{"address":"36 royal sovereign apartments, phoebe road, copper quarter, pentrechwyth, swansea, sa1 7fh","count":3},{"address":"14 admiral house 38-42 newport road, cardiff, cf24 0dh","count":3}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"26 castle grove, pontefract, west yorkshire, wf8 1gw","count":3},{"address":"26 grand mill, 132 sunbridge road, bradford, bradford, bd1 2pf","count":3},{"address":"110 trinity one, east street, leeds, west yorkshire ls9 8ae","count":3}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"29 hutchinson street, bishop auckland, county durham, dl14 7dd","count":3}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (78 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":78,"examples":[{"address":"57 shelldale road, portslade, brighton, east sussex, bn41 1le","count":3},{"address":"flat 6, 192 church road, hove, bn3 2dj","count":3},{"address":"1 regents close, hayes, middlesex, ub4 8jy","count":6}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 144/155 (93%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":144,"total":155,"ratio":0.929}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"190, hermitage road, coalville, leicestershire le67 5eh","count":4},{"address":"32-34 the cornmarket, derby, derbyshire, de1 2dg","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 51/53 (96%) lots have empty bullets
  - `{"empty":51,"total":53,"ratio":0.962}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"58, lea road, southall, middlesex, ub2 5qa","count":3}]}`

## barnettross

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":6,"examples":[{"address":"bushey, hertfordshire","count":6}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"apartment 15, the george hotel, high street, melton mowbray, leicestershire le13 0tu, united kingdom","count":3},{"address":"11 aston chase, hemsworth, pontefract, west yorkshire, wf9 4rb, united kingdom","count":3},{"address":"2 belgrave terrace, bath, ba1 5jr, united kingdom","count":4}]}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"789 oak lane, coventry, cv1 2aa","count":3}]}`

## brggibsondublin

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"150 mullaghmatt, monaghan, h18 e296","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at butterow hill rodborough, stroud, gl5 2lf","count":3}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 51 addresses appear ≥3 times each (165 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":51,"total_dupe_rows":165,"examples":[{"address":"room 27, st. anns lodge, st. anns lane, leeds, west yorkshire ls4 2sj","count":3},{"address":"22 alstonfield drive, allestree, derby de22 2xf","count":3},{"address":"flat 26 bodmin court, mansfield, nottinghamshire ng18 4qa","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 597/796 (75%) lots have empty bullets
  - `{"empty":597,"total":796,"ratio":0.75}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":27,"examples":[{"address":"hanley road, stoke-on-trent st1 6bl","count":4},{"address":"sherratt street stoke-on-trent st6 7nt","count":3},{"address":"springfields road, trent vale, st4 6ru","count":3}]}`

## carterjonas

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"lot 1: land at splatt lane, bridgwater, ta5 1db","count":3},{"address":"lot 1: leaze farm, weston-super-mare, bs24 0ez","count":3}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":23,"examples":[{"address":"14 park road, plymstock, pl9 9az","count":3},{"address":"48 fore street, exeter, ex4 3hr","count":4},{"address":"11 orchard way, budleigh salterton, ex9 6tg","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 142/168 (85%) lots missing image_url
  - `{"missing":142,"total":168,"ratio":0.845}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"123 high street, cambridge, cb1 2aa","count":4}]}`

## cityandruralpropertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"for sale by auction29th april 2026","count":5},{"address":"16 and 16a emery road, brislington, bristol bs4 5pf","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 16/16 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":16,"total":16,"ratio":1}`

## clarkesimpson

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"4 bedfield road, earl soham, woodbridge, suffolk, ip13 7sq","count":3},{"address":"brock lane, martlesham, woodbridge, suffolk, ip13 6ll","count":3},{"address":"sunnyholme, rishangles, eye, suffolk, ip23 7lb","count":3}]}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"talog, carmarthen, carmarthenshire.","count":5}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (51 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":51,"examples":[{"address":"newport - isle of wight","count":5},{"address":"penzance - cornwall","count":5},{"address":"land with planning","count":3}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"land at westwood lane, wanborough, guildford, surrey, gu3 2jn","count":3},{"address":"land at mill lane, sturminster marshall, wimborne, dorset, bh21 4bd","count":3}]}`

## cottons

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"land at, technology drive, rugby, warwickshire, cv21 1gb","count":3},{"address":"8 houghton court, priory road, hall green, birmingham, west midlands, b28 0ta","count":3},{"address":"central chambers, 416 bearwood road, smethwick, west midlands, b66 4ey","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"11 chywoone place, newlyn, penzance, cornwall, tr18 5nw","count":4},{"address":"stable barn cottage, 1 stable lane, torquay, devon, tq1 4sa","count":3}]}`

## dawsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"53, new street burry port, sa16 0rt","count":3}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 6/6 (100%) lots have no price + no price_text
  - `{"tba":6,"total":6,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 6/6 (100%) lots missing image_url
  - `{"missing":6,"total":6,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 6/6 (100%) lots have empty bullets
  - `{"empty":6,"total":6,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 117 addresses appear ≥3 times each (531 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":117,"total_dupe_rows":531,"examples":[{"address":"apartment 1401, 5 pomona strand, manchester, greater manchester, m16","count":3},{"address":"kensington street, rochdale, ol11","count":3},{"address":"apartment 12, douro house, 11, wellington road, stockport, sk4","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 574/591 (97%) lots have empty bullets
  - `{"empty":574,"total":591,"ratio":0.971}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 addresses appear ≥3 times each (55 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":18,"total_dupe_rows":55,"examples":[{"address":"29 hitchmans drive, chipping norton, oxfordshire, ox7 5bg","count":3},{"address":"8 lynam street, stoke-on-trent, staffordshire, st4 7ed","count":3},{"address":"the old vicarage, 85 silver road, norwich, norfolk, nr3 4tf","count":3}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"gff, 1 albion terrace, bath, avon, ba1 3af","count":3},{"address":"flat 68 melton court, 37 lindsay road, poole, bh13 6bh","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 45 addresses appear ≥3 times each (160 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":45,"total_dupe_rows":160,"examples":[{"address":"commercial investment 167-169 james street, glasgow","count":3},{"address":"5 scott street, flat 4-2, perth","count":3},{"address":"land at 9 mill road, kilbirnie","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 526/527 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":526,"total":527,"ratio":0.998}`

## gherbertbanks

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"old pear tree cottage, crowle, worcester wr7 4at","count":3}]}`

## goldings

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"6 london road, halesworth, suffolk, ip19 8lw","count":3},{"address":"51 warwick road, ipswich, suffolk, ip4 2qh","count":3}]}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":27,"examples":[{"address":"badgworth, axbridge, somerset, bs26","count":3},{"address":"henlade, taunton, somerset, ta3","count":3},{"address":"lethbridge road, wells, somerset, ba5","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":20,"total_dupe_rows":67,"examples":[{"address":"232 swallow street, iver, buckinghamshire, sl0 0ht","count":3},{"address":"plot of land","count":5},{"address":"7 berkshire street, hull, north humberside, hu8 8tj","count":3}]}`

## hawkesford

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"land at leamington road, ryton-on-dunsmore","count":5}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"74 butler crescent, liverpool, merseyside, l6 9hs","count":3}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"45 blackpool street, burton-on-trent, staffordshire, de14 3aw","count":3},{"address":"3 pembroke avenue, bristol, avon, bs11 9sj","count":3},{"address":"35 gilsland road, thornton heath, surrey, cr7 8rq","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"ashford market, kent","count":3},{"address":"ashford market, ashford, kent","count":4}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 57 addresses appear ≥3 times each (234 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":57,"total_dupe_rows":234,"examples":[{"address":"lower high street, shirehampton, bs11 0aw","count":4},{"address":"27, berkeley square, bristol, bs8 1hp","count":3},{"address":"55, silver street, nailsea, bristol, bs48 2ds","count":3}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"357 sample road, newcastle, ne1 7aa","count":3},{"address":"london, e1","count":3},{"address":"daventry, nn11","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## hunters

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"greylands mews, forest moor road, knaresborough, hg5 8jy","count":3},{"address":"main street, shildon, dl4 1aw","count":3}]}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"minshull new road, crewe, cheshire, cw1 3pe","count":3},{"address":"elliott street, manchester, greater manchester, m29 8fl","count":3}]}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 9/9 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":9,"total":9,"ratio":1}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (20 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":20,"examples":[{"address":"chesterfield","count":7},{"address":"vehicle auction mitcham vehicle auction","count":3},{"address":"general auction \\| chesterfield \\| saleroom 46 \\| home delivery","count":4}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'johnpye' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"johnpye"}`

## jonespeckover

- **[warn] identical_price_wall** — Identical-price wall: 4/7 (57%) lots share price £20000 — extractor likely picking up hero/banner price
  - `{"price":20000,"count":4,"total":7,"ratio":0.571}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (47 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":47,"examples":[{"address":"liftondown, lifton, pl16","count":3},{"address":"upton, bude, ex23","count":4},{"address":"marine drive, widemouth bay, ex23","count":3}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (54 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":54,"examples":[{"address":"cottage, 4 holt road, bradford-on-avon, wiltshire, ba15 1aj","count":4},{"address":"the chestnuts, port eynon, swansea, west glamorgan, sa3 1nl","count":3},{"address":"4 old parsonage cottage, dartington, totnes, devon, tq9 6ea","count":3}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"flat 1, 35 gardens lane, conisbrough, doncaster, south yorkshire, dn12 3jx","count":3},{"address":"48 hardman close, blackburn, lancashire, bb1 2dt","count":3},{"address":"7 chapel street, filey, north yorkshire, yo14 9ea","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 99/156 (63%) lots missing image_url
  - `{"missing":99,"total":156,"ratio":0.635}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 46/46 (100%) lots missing image_url
  - `{"missing":46,"total":46,"ratio":1}`

## lot9

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"32, vale street, denbigh, denbighshire, ll16 3be","count":3},{"address":"2, water street, barmouth, ll42 1at","count":3},{"address":"244, manchester road east, little hulton, manchester, m38 9wq","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 14/25 (56%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":14,"total":25,"ratio":0.56}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":24,"examples":[{"address":"46 purcell road, courthouse green, coventry, west midlands cv6 7jz","count":3},{"address":"land and buildings off vinecote road, longford, coventry, west midlands cv6 6dz","count":3},{"address":"24 hastings road, stoke heath, coventry, west midlands cv2 4jd","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 34/46 (74%) lots have empty bullets
  - `{"empty":34,"total":46,"ratio":0.739}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 16/18 (89%) lots have empty bullets
  - `{"empty":16,"total":18,"ratio":0.889}`

## maggsandallen

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"66 & 66a, devonshire road, weston-super-mare, bs23 4nx","count":3}]}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 53 addresses appear ≥3 times each (161 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":53,"total_dupe_rows":161,"examples":[{"address":"290 school road, sheffield, south yorkshire s10 1gr","count":3},{"address":"ransome house, the great hall, wynnstay hall estate, ruabon, wrexham, wrexham ll14 6la","count":3},{"address":"48 dingle road, rushden, northamptonshire nn10 6ue","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 366/428 (86%) lots have empty bullets
  - `{"empty":366,"total":428,"ratio":0.855}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"foxglove close, stourport-on-severn, worcestershire, dy13 9bn","count":3},{"address":"a well presented detached four/five bedroom house, currently used as a bed & breakfast having achieved high accolades, with mature gardens, garage and stable block. adjacent to holiday lodge park.","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 81/91 (89%) lots have empty bullets
  - `{"empty":81,"total":91,"ratio":0.89}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (69 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":69,"examples":[{"address":"20 craven street east, horwich, bolton, bl6 6jx","count":3},{"address":"land between, 24 & 26 aylesbury drive, great notley, braintree, cm77 7aw","count":3},{"address":"179 brooklyn road, cheltenham, gl51 8dx","count":3}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (29 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":29,"examples":[{"address":"st george's road, southsea po4 9pl","count":5},{"address":"north street, havant po9 1pt","count":6},{"address":"southampton road, portsmouth, hampshire, po6 4ry","count":6}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (40 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":40,"examples":[{"address":"trafford street, chester, chester, cheshire, ch1 3gw","count":3},{"address":"worrall street, salford, greater manchester, m5 4yb","count":3},{"address":"worsdell drive, gateshead, gateshead, tyne and wear, ne8 2az","count":3}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 51 addresses appear ≥3 times each (173 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":51,"total_dupe_rows":173,"examples":[{"address":"22 church crescent, ebbw vale, gwent, np23 6ug","count":3},{"address":"southwest medical ltd, comonin warehouse, mitchel troy, monmouth, np25 4bl","count":4},{"address":"parcel 1, cynllwyndu road, tylorstown, ferndale, cf43 3dr","count":4}]}`

## pearsonferrier

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"94 nelson street, bury, bl9 9hx","count":3}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 39/42 (93%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":39,"total":42,"ratio":0.929}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":37,"examples":[{"address":"garage adjacent to 39 & 41 the crescent, harlington, middlesex ub3 5na","count":5},{"address":"36 hogarth avenue, reading, berkshire rg30 4qw","count":4},{"address":"flat 5 winchester way, scawsby, doncaster dn5 8ll","count":3}]}`

## propertyauctionagent

- **[info] bullet_starvation** — Bullet starvation: 65/68 (96%) lots have empty bullets
  - `{"empty":65,"total":68,"ratio":0.956}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":14,"examples":[{"address":"larch house, 241 high street, kingswinford, dudley, dy6 8bf","count":3},{"address":"main street, cambuslang, glasgow, g72 7hb","count":3},{"address":"westbeach, westward ho, bideford, devon, ex39 1lq","count":8}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 35 addresses appear ≥3 times each (111 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":35,"total_dupe_rows":111,"examples":[{"address":"apartment 36, aura court, 1 percy street, manchester, greater manchester m15 4ab","count":3},{"address":"land adjacent to 8 dee close, 13 dee close and lawton way, sandbach, cheshire cw11 1xj","count":3},{"address":"flat 20, ambassador house, 219 queensway, bletchingley, milton keynes, buckinghamshire mk2 2eh","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 246 addresses appear ≥3 times each (768 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":246,"total_dupe_rows":768,"examples":[{"address":"17 radbourne grove, bolton, lancashire, bl3 4td","count":3},{"address":"11 jerome way shipton-on-cherwell, kidlington, oxfordshire, ox5 1jt","count":4},{"address":"5 the courtyard, wakefield, west yorkshire, wf2 8wf","count":4}]}`

## rendells

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"rose cottage, moreleigh road, totnes, tq9 7ts","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (8 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":5},{"address":"wold cottage, burwell, louth, lincolnshire, ln11 8pr","count":3}]}`

## rogerparry

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":6,"examples":[{"address":"63 coton manor, berwick road, shrewsbury, shropshire, sy1 2ly","count":6}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"11 park view, cross keys, newport, gwent, np11 7dd","count":3},{"address":"middle bank wood, coed bwlch, rhysgog, llangollen, denbighshire, ll20 8bw","count":3}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":17,"examples":[{"address":"34b clayton street west, newcastle upon tyne, tyne and wear, ne1 5dz","count":4},{"address":"306 old durham road, gateshead, tyne and wear, ne8 4bq","count":5},{"address":"43 edgmond court, sunderland, tyne and wear, sr2 0dx","count":5}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 187 addresses appear ≥3 times each (599 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":187,"total_dupe_rows":599,"examples":[{"address":"land at brocks lane, frilsham, berkshire, rg18 9uy","count":4},{"address":"unit 6 station court, station approach, borough green, sevenoaks, kent tn15 8bg","count":5},{"address":"13 topcliffe street, hartlepool, ts26 8ll","count":4}]}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":27,"examples":[{"address":"117 high street, barry, cf62 7dt","count":3},{"address":"land at baldwins crescent, swansea, sa1 8pt","count":4},{"address":"flat 2 western avenue court, cardiff, cf5 2be","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":39,"examples":[{"address":"49 byron halls, byron street, bradford, bd3 0ar","count":5},{"address":"2, roberts buildings halifax, hx2 0an","count":5},{"address":"flat 1, 1 griffe head road wyke, bradford, bd12 8qp","count":3}]}`

## sheldonbosley

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"5 oak hill, wolverhampton, west midlands, wv3 9ae","count":5}]}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":27,"examples":[{"address":"workshop & storage rear of, 7 henley road, leicester, le3 9rd","count":3},{"address":"76 guthlaxton street, highfields, leicester, le2 0se","count":3},{"address":"70 bird hill road, woodhouse eaves, leicestershire, le12 8rr","count":3}]}`

## smithandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"24 ashburton road, prenton, ch43 8tw","count":3}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"the countryman , st. ives, tr26 3jq","count":3},{"address":"land at poole farm , exeter, ex6 7hy","count":3},{"address":"land at culmhead , taunton, ta3 7ea","count":3}]}`

## starpropertyonline

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"53 rushlake road, brighton, east sussex, bn1 9ag","count":3}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":25,"examples":[{"address":"67 pine avenue, bath, somerset, ba2 3ln","count":3},{"address":"32 high street, chippenham, wiltshire, sn15 3er","count":3},{"address":"123 elm road, swindon, wiltshire, sn1 2ab","count":3}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 41 addresses appear ≥3 times each (124 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":41,"total_dupe_rows":124,"examples":[{"address":"664 high road leyton, leyton, waltham forest, e10 6jp","count":3},{"address":"53 fairfield road, london, e3 2qa","count":3},{"address":"16 apr 26  -  lot 44land adjoining, 2a roseheath road, hounslow, middlesex, tw4 5hh","count":3}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":39,"examples":[{"address":"current auction lots","count":3},{"address":"for sale by tender","count":3},{"address":"16 norville road, liverpool, merseyside, l14 3ly","count":3}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":18,"examples":[{"address":"quarry close, swanage, bh19","count":6},{"address":"deveral road, hayle, tr27","count":3},{"address":"bradon lane, ilminster, ta3","count":3}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 238 addresses appear ≥3 times each (801 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":238,"total_dupe_rows":801,"examples":[{"address":"14 malcolm court, stanmore, middlesex, ha7 4hn","count":3},{"address":"54a marlborough road, london, n22 8nn","count":3},{"address":"6 abington close, crewe, cheshire, cw1 3tl","count":3}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":19,"examples":[{"address":"162 port tennant road, port tennant, swansea, west glamorgan, sa1 8jn","count":3},{"address":"8 furze crescent, morriston, swansea, west glamorgan, sa6 6bp","count":3},{"address":"land rear of 8 brynawelon road, cwmllynfell, swansea, west glamorgan, sa9 2wg","count":3}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"55 caludon road, coventry, cv2 4lr","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (90 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":90,"examples":[{"address":"16 ullswater street, liverpool, l5 6qx","count":3},{"address":"95 alexandra road, crosby, merseyside, l23 7te","count":3},{"address":"apt. 62 east float quay dock road, birkenhead, ch41 1dn","count":7}]}`
- **[info] bullet_starvation** — Bullet starvation: 88/113 (78%) lots have empty bullets
  - `{"empty":88,"total":113,"ratio":0.779}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"halifax, west yorkshire","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 13/23 (57%) lots missing image_url
  - `{"missing":13,"total":23,"ratio":0.565}`

## webbers

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (18 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":18,"examples":[{"address":"long close, berrynarbor, ex34 9su","count":3},{"address":"willow cottage, clifford farm, bideford, ex39 5rb","count":3},{"address":"harleigh terrace, cornwall, pl31 1bt","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 30/30 (100%) lots have empty bullets
  - `{"empty":30,"total":30,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 30/30 (100%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":30,"total":30,"ratio":1}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"lands craghy, dungloe, co donegal","count":3}]}`


