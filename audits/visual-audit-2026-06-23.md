# Visual Audit — 2026-06-23

Scanned **25,953** rows in **19689ms** across **121** houses with findings.

**Findings:** 116 error · 14 warn · 18 info

## 247propertyauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"mill street, bideford, ex39 2jt","count":3}]}`

## acuitus

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"221 west george street, glasgow, g2 2nd","count":3},{"address":"3-5 station road, didcot, oxfordshire, ox11 7lu","count":3},{"address":"jd wetherspoon, 48 wallasey road, liscard, wallasey, merseyside, ch45 4nw","count":3}]}`

## agentsproperty

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":21,"examples":[{"address":"beatrice street, ashington","count":3},{"address":"south lackenby, middlesbrough","count":3},{"address":"maple street, ashington","count":3}]}`

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (28 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":28,"examples":[{"address":"land on the south side of oxford lane grove, wantage, oxfordshire, ox12 7ly","count":6},{"address":"land at orchard close, alresford, hampshire, so24 9py","count":3},{"address":"land at rylands road, underwood close & belmont road, kennington, ashford, kent, tn24 9lr","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 98/162 (60%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":98,"total":162,"ratio":0.605}`

## allsop

- **[error] duplicate_address_wall** — Duplicate-address wall: 32 addresses appear ≥3 times each (99 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":32,"total_dupe_rows":99,"examples":[{"address":"west drayton ub7","count":4},{"address":"london w3","count":3},{"address":"units 5-8 mariner, lichfield industrial estate, tamworth, b79 7xh","count":3}]}`

## andrewcraig

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (14 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":14,"examples":[{"address":"stanhope road, south shields, ne33","count":5},{"address":"market lane, dunston, ne11","count":3},{"address":"dorset avenue, birtley, dh3","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 52/52 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":52,"total":52,"ratio":1}`

## auctionestates

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"land to the rear of thrybergh hall road, rawmarsh, rotherham, south yorkshire, s62 5jx","count":3},{"address":"land off ralfland view, shap, penrith, cumbria, ca10 3pe","count":3}]}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 37/37 (100%) lots have empty bullets
  - `{"empty":37,"total":37,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/37 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":37,"total":37,"ratio":1}`

## auctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (49 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":49,"examples":[{"address":"apartment 3 delamere place, runcorn, cheshire, wa7 4ne","count":3},{"address":"49 kingfisher road north cornelly, bridgend, cf33 4nz","count":3},{"address":"34 ashwood close oldbury, oldbury, west midlands, b69 4sd","count":4}]}`

## auctionhousebedsandbucks

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (22 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":22,"examples":[{"address":"flat 30, summers house, coxhill way, aylesbury, buckinghamshire, hp21 8fn","count":3},{"address":"21 greenfield road, pulloxhill, bedford mk45 5ez","count":3},{"address":"380 long chaulden, hemel hempstead, hertfordshire, hp1 2nt","count":3}]}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"31 winterley lane, walsall ws4 1lp","count":3},{"address":"219 waterloo road, stoke-on-trent, west midlands st6 2hs","count":3}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (19 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":19,"examples":[{"address":"2 the poplars, main road, cutthorpe, chesterfield, derbyshire, s42 7ah","count":4},{"address":"47 haldane crescent, bolsover, chesterfield, derbyshire, s44 6ru","count":5},{"address":"57 houldsworth drive, chesterfield, derbyshire, s41 0bp","count":4}]}`

## auctionhousecoventry

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":10,"examples":[{"address":"53 adderley street, hillfields, coventry, west midlands cv1 5ar","count":5},{"address":"46 and 46a, newtown road, bedworth, warwickshire cv12 8qs","count":5}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (129 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":129,"examples":[{"address":"flat 1, jubilee apartments, kendal, cumbria la9 4lr","count":6},{"address":"4 north road, kirkby stephen, cumbria ca17 4rh","count":5},{"address":"rye close barn, stockdalewath, dalston, carlisle, cumbria ca5 7dp","count":4}]}`

## auctionhousedevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":39,"examples":[{"address":"3 heather close, okehampton, devon ex20 1db","count":3},{"address":"flat 6 knightstone court, burnham-on-sea, somerset, ta8 1ll","count":3},{"address":"16 montpelier terrace, ilfracombe, devon ex34 9hr","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 30 addresses appear ≥3 times each (92 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":30,"total_dupe_rows":92,"examples":[{"address":"flat 5 2 victoria road, colchester, essex, co3 3nt","count":3},{"address":"well house cottage, hoe road south, swanton morley, dereham, norfolk nr20 4pu","count":3},{"address":"11 queens place, mill road, great yarmouth, norfolk nr31 0ht","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":23,"examples":[{"address":"5 shirley court, sedley rise, loughton, essex ig10 1lu","count":3},{"address":"flat 11, lilystone hall, honeypot lane, stock, ingatestone, essex cm4 9gj","count":4},{"address":"7 york mews, great wakering, southend-on-sea, essex ss3 0fa","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 31/33 (94%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":31,"total":33,"ratio":0.939}`

## auctionhousehull

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (44 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":44,"examples":[{"address":"29b marton road, bridlington, east yorkshire, yo16 7aq","count":5},{"address":"apartment 6 kemley house, prospect street, hull, east yorkshire, hu2 8ny","count":5},{"address":"1 church close, sutton-on-hull, hull, east yorkshire, hu7 4tq","count":3}]}`

## auctionhousekent

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"flat 10 pine lodge, maidstone, kent, me16 8ta","count":3},{"address":"79 mountbatten square, windsor, berkshire, sl4 1sz","count":3},{"address":"land to the west of london road, sevenoaks, kent, tn13 2tg","count":4}]}`

## auctionhouseleicestershire

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"79 hermitage court, 79 hermitage court honeywell close, leicester, leicestershire, le2 5qq","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 61 addresses appear ≥3 times each (201 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":61,"total_dupe_rows":201,"examples":[{"address":"29 wellington road, blackpool, lancashire, fy1 6ar","count":4},{"address":"2 green lane, bishop auckland, county durham, dl14 6rs","count":4},{"address":"100 wainfleet road, skegness, lincolnshire, pe25 3rq","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 550/648 (85%) lots have no price + no price_text
  - `{"tba":550,"total":648,"ratio":0.849}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 107 addresses appear ≥3 times each (418 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":107,"total_dupe_rows":418,"examples":[{"address":"postponed","count":7},{"address":"12 brownhill road, catford, london, se6 2ej","count":5},{"address":"30b fernshaw road, chelsea, london, sw10 0tf","count":4}]}`

## auctionhousemanchester

- **[error] duplicate_address_wall** — Duplicate-address wall: 16 addresses appear ≥3 times each (62 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":16,"total_dupe_rows":62,"examples":[{"address":"694 bolton road, pendlebury, swinton, m27 6el","count":3},{"address":"3 kirkby avenue, moston, manchester, m40 5hn","count":3},{"address":"flat 34, renaissance house, millbrook street, stockport, sk1 3tn","count":6}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"10 morley street, sutton-in-ashfield, nottinghamshire, ng17 4ed","count":3},{"address":"flat 23 woodlands, poole, dorset, bh13 6bg","count":3},{"address":"barnsdale hognaston, ashbourne, derbyshire, de6 1pr","count":3}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"10 the leys, roade, northampton, northamptonshire nn7 2nr","count":3},{"address":"51 thetford close, corby, northamptonshire, nn18 9ph","count":3}]}`

## auctionhousenortheast

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":30,"examples":[{"address":"apartment 54 hanover mill, hanover street, newcastle upon tyne, tyne and wear, ne1 3ab","count":3},{"address":"47 hilden park ingleby barwick, stockton-on-tees, cleveland, ts17 5aj","count":4},{"address":"22 tiverton square, sunderland, tyne and wear, sr3 4pj","count":3}]}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 10/12 (83%) lots missing image_url
  - `{"missing":10,"total":12,"ratio":0.833}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 31 addresses appear ≥3 times each (112 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":31,"total_dupe_rows":112,"examples":[{"address":"10 rydal road, preston, lancashire pr1 5sl","count":4},{"address":"apartment 6, fearnley mill drive, huddersfield, west yorkshire hd5 0rd","count":6},{"address":"apartment 20, 9 hatton garden, liverpool, merseyside l3 2fe","count":4}]}`

## auctionhousenottsandderby

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (33 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":33,"examples":[{"address":"4/6 lonsdale terrace, edinburgh, midlothian, eh3 9hn","count":3},{"address":"36 old lane, walsall, west midlands, ws3 2dd","count":3},{"address":"20 lord street, mansfield, nottinghamshire, ng18 1hh","count":3}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 48 addresses appear ≥3 times each (192 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":48,"total_dupe_rows":192,"examples":[{"address":"114 hilltown, dundee, angus dd3 7bg","count":7},{"address":"plots at burnside cottages, aberdeen, aberdeenshire ab12 5yq","count":5},{"address":"209 rosemount place, aberdeen, aberdeenshire ab25 2xs","count":5}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 280/283 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":280,"total":283,"ratio":0.989}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"harvenna house, 33 hendra road, st. dennis, st. austell, cornwall pl26 8eq","count":3},{"address":"50 blackthorn road, bristol bs13 0al","count":3},{"address":"14 birchwood road, bristol, bristol bs4 4qh","count":3}]}`

## auctionhousesouthyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 173 addresses appear ≥3 times each (568 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":173,"total_dupe_rows":568,"examples":[{"address":"51 warner road, sheffield, south yorkshire, s6 4fu","count":4},{"address":"number 22 third street blackhall colliery, hartlepool, cleveland, ts27 4ew","count":4},{"address":"56 city point 1 solly street, sheffield, south yorkshire, s1 4bp","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 1801/1883 (96%) lots have no price + no price_text
  - `{"tba":1801,"total":1883,"ratio":0.956}`

## auctionhousestaffordshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (102 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":102,"examples":[{"address":"land / plot @ daffil grange way morley, leeds, west yorkshire, ls27 7qp","count":3},{"address":"apartment 17 delamere place, runcorn, cheshire, wa7 4ne","count":3},{"address":"69 hawksmoor road, stafford, staffordshire, st17 9ds","count":3}]}`

## auctionhouseteesvalley

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"62 derwent street, hartlepool, cleveland ts26 8bn","count":3},{"address":"93 broadway east, redcar, north yorkshire ts10 5dt","count":3},{"address":"114 valley road, northallerton, north yorkshire dl6 1sh","count":4}]}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 105 addresses appear ≥3 times each (372 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":105,"total_dupe_rows":372,"examples":[{"address":"29 nightingale lane, bromley, kent, br1 2sa","count":4},{"address":"65 college road, maidstone, kent, me15 6sx","count":4},{"address":"flat 3, 108 guildford street, chertsey, surrey, kt16 9ah","count":5}]}`

## auctionhousewales

- **[error] duplicate_address_wall** — Duplicate-address wall: 23 addresses appear ≥3 times each (75 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":23,"total_dupe_rows":75,"examples":[{"address":"32 bentley street farnworth, bolton, lancashire, bl4 7pw","count":4},{"address":"65 neath road, briton ferry, neath port talbot, sa11 2dx","count":4},{"address":"unit 2, 6-8 sea view road, colwyn bay, conwy, ll29 8dg","count":4}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":39,"examples":[{"address":"9 newstead avenue, fitzwilliam, pontefract, west yorkshire wf9 5dt","count":4},{"address":"26 castle grove, pontefract, west yorkshire, wf8 1gw","count":4},{"address":"flat 903 colonnade house, 201 sunbridge road, bradford, west yorkshire, bd1 2be","count":3}]}`

## auctionnorth

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (16 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"6 wesley court, langley moor, durham, county durham, dh7 8gz","count":4},{"address":"15 hutton terrace, willington, crook, county durham, dl15 0ds","count":3},{"address":"1 north street, hett, durham, county durham, dh6 5lr","count":3}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (54 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":54,"examples":[{"address":"53 dominica court, eastbourne, bn23 5tr","count":4},{"address":"chantlers, village street, ewhurst green, robertsbridge, tn32 5td","count":4},{"address":"flat 3, 40 tivoli crescent, brighton, bn1 5nd","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 129/138 (93%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":129,"total":138,"ratio":0.935}`

## bagshaws

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"32-34 the cornmarket, derby, derbyshire, de1 2dg","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 26/27 (96%) lots have empty bullets
  - `{"empty":26,"total":27,"ratio":0.963}`

## barnardmarcus

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"flat 1, beaumont court, upper clapton road, clapton, london, e5 8bg","count":3},{"address":"flat c, 90, coningham road, shepherds bush, london, w12 8bh","count":3},{"address":"flats a - f, 250, high street, bromley, kent, br1 1pg","count":3}]}`

## bidx1

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":23,"examples":[{"address":"11 aston chase, hemsworth, pontefract, west yorkshire, wf9 4rb, united kingdom","count":4},{"address":"unit 2a bennett house, the dean, alresford, hampshire so24 9bh, united kingdom","count":5},{"address":"2 old church court, 40 weaste road, salford, m5 5fw, united kingdom","count":4}]}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (27 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":27,"examples":[{"address":"45 staple hall road, northfield, birmingham, b31 3th","count":3},{"address":"110 cambrian, tamworth, staffordshire, b77 2ef","count":3},{"address":"13 & 13a walsall road, willenhall, wv13 2eg","count":3}]}`

## bowensonandwatson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"tan yr allt farm, ffordd las, cymau, wrexham, ll11 5ey","count":4}]}`
- **[warn] identical_price_wall** — Identical-price wall: 4/5 (80%) lots share price £40000 — extractor likely picking up hero/banner price
  - `{"price":40000,"count":4,"total":5,"ratio":0.8}`

## bradleyhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"21 carson place, hemlington, middlesbrough, cleveland, ts8 9rl","count":3}]}`

## bradleysdevon

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":15,"examples":[{"address":"battery hill, portreath, redruth, cornwall, tr16","count":3},{"address":"jubilee road, pensilva, liskeard, cornwall, pl14","count":3},{"address":"north corner, coverack, helston, cornwall, tr12","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"prospect view, queensbury, bradford","count":3},{"address":"dewhurst road, huddersfield","count":3},{"address":"tolson crescent, huddersfield","count":5}]}`

## brggibsondublin

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"37 collagarry, walsh island, county offaly, r35 wd90","count":3},{"address":"1 park square, armagh road, dundalk, louth, a91 wfr7","count":3},{"address":"150 mullaghmatt, monaghan, h18 e296","count":3}]}`

## brutonknowles

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (10 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":10,"examples":[{"address":"allocated strategic land freehold or for promotion hams way, rushwick, worcester, worcestershire, wr2 5sj","count":4},{"address":"birdwood house farm, birdwood, gloucestershire , gl19 3ej","count":3},{"address":"land at butterow hill rodborough, stroud, gl5 2lf","count":3}]}`

## btgeddisons

- **[error] duplicate_address_wall** — Duplicate-address wall: 23 addresses appear ≥3 times each (74 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":23,"total_dupe_rows":74,"examples":[{"address":"former sand bay care home, 7 court road, kewstoke, weston-super-mare bs22 9ut","count":5},{"address":"52 oaklands avenue, littleover, derby de23 2qh","count":3},{"address":"3 danby mews, wood street, norton, malton, yorkshire yo17 9ba","count":4}]}`

## buttersjohnbee

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (35 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":35,"examples":[{"address":"underwood lane, crewe","count":3},{"address":"hanley road, stoke-on-trent st1 6bl","count":4},{"address":"west avenue, northwich","count":3}]}`

## charlesdarrow

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"plot 1, higher hill farm, crediton, ex17 5aj","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 58/68 (85%) lots missing image_url
  - `{"missing":58,"total":68,"ratio":0.853}`

## cheffins

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"123 high street, cambridge, cb1 2aa","count":4}]}`

## cheffinstimed

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"789 sample ave, haverhill, cb9 8xx","count":3},{"address":"123 example st, cambridge, cb1 1aa","count":3}]}`

## cityandruralpropertyauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 10/10 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":10,"total":10,"ratio":1}`

## cleetompkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"carlton terrace, swansea, city and county of swansea.","count":3},{"address":"walter road, ammanford, carmarthenshire.","count":3},{"address":"talog, carmarthen, carmarthenshire.","count":3}]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (83 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":83,"examples":[{"address":"newport - isle of wight","count":6},{"address":"penzance - cornwall","count":6},{"address":"land with planning","count":3}]}`

## connectuk

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"land at sandy lane north, wirral, merseyside, ch61 4xu","count":3},{"address":"ger y coed, plwmp, llandysul, ceredigion, sa44 6hb","count":3},{"address":"hillcroft, hele lane, frithelstockstone, torrington, devon","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (44 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":44,"examples":[{"address":"shearwater, sea lane, hayle, cornwall, tr27 4lq","count":3},{"address":"19 st. nicholas street, bodmin, cornwall, pl31 1ab","count":3},{"address":"25 woodlands view, looe, cornwall, pl13 2aw","count":3}]}`

## dawsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"53, new street burry port, sa16 0rt","count":3}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 8/8 (100%) lots missing image_url
  - `{"missing":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`

## edwardmellor

- **[error] duplicate_address_wall** — Duplicate-address wall: 86 addresses appear ≥3 times each (330 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":86,"total_dupe_rows":330,"examples":[{"address":"apartment 1401, 5 pomona strand, manchester, greater manchester, m16","count":4},{"address":"kensington street, rochdale, ol11","count":4},{"address":"brinnington road, brinnington, stockport, sk5","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 472/511 (92%) lots have empty bullets
  - `{"empty":472,"total":511,"ratio":0.924}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 21 addresses appear ≥3 times each (68 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":21,"total_dupe_rows":68,"examples":[{"address":"29 hitchmans drive, chipping norton, oxfordshire, ox7 5bg","count":3},{"address":"flat 26 cromwell place, 144-146 station road, redhill, surrey, rh1 1ex","count":3},{"address":"75 hurst grove, bedford, bedfordshire, mk40 4hy","count":4}]}`

## foxandsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"10 hilsea market, london road, portsmouth, po2 9ra","count":3}]}`

## futureauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 43 addresses appear ≥3 times each (158 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":43,"total_dupe_rows":158,"examples":[{"address":"coronation way, prime corner detached restaurant, bar and car park, montrose","count":3},{"address":"171-173 high street, let three investement, ayr","count":5},{"address":"19 fore street, let superdrug investment, bridgwater, somerset","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 509/509 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":509,"total":509,"ratio":1}`

## gth

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"mark causeway, mark, highbridge, somerset, ta9","count":4},{"address":"whitley head, banwell, north somerset, bs29","count":3},{"address":"green drove, burtle, bridgwater, somerset, ta7","count":3}]}`

## halls

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"white gables, middletown, welshpool, sy21 8dq","count":3},{"address":"black park, trelystan, welshpool, sy21 8ja","count":3},{"address":"28, mccreadie drive, ellesmere, sy12 0ea","count":3}]}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (82 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":82,"examples":[{"address":"plot of land","count":4},{"address":"101 new road, brading, sandown, isle of wight, po36 0ad","count":4},{"address":"gff 17 quadrant road, thornton heath, surrey, cr7 7db","count":5}]}`

## hawkesford

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (5 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"land at leamington road, ryton-on-dunsmore","count":5}]}`

## henrysykes

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"78 st annes road, cradley heath, sandwell, b64 5bq","count":3},{"address":"4 st. johns road, seaford, east sussex, bn25 1jw","count":3}]}`

## higginsdrysdale

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat 9, 68 church street, hartlepool, cleveland, ts24 7dn","count":3}]}`

## hmox

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (23 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":23,"examples":[{"address":"45 blackpool street, burton-on-trent, staffordshire, de14 3aw","count":4},{"address":"3 pembroke avenue, bristol, avon, bs11 9sj","count":4},{"address":"22/22a mckean road, oldbury, west midlands, b69 4ay","count":3}]}`

## hobbsparker

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (15 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":15,"examples":[{"address":"ashford market, kent","count":6},{"address":"ashford market, ashford","count":3},{"address":"ashford market, ashford, kent","count":6}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 59 addresses appear ≥3 times each (256 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":59,"total_dupe_rows":256,"examples":[{"address":"bethel road, st george, bs5 7nn","count":4},{"address":"bath road, willsbridge, bs30 6ep","count":3},{"address":"osborne villas, kingsdown, bs2 8bp","count":8}]}`

## howkinsandharrison

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":4,"total_dupe_rows":12,"examples":[{"address":"northampton, nn1","count":3},{"address":"atherstone, cv9","count":3},{"address":"henley in arden, b95","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## iamsold

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"minshull new road, crewe, cheshire, cw1 3pe","count":3},{"address":"north street, ashford, kent, tn27 8ag","count":3}]}`

## johnpye

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 addresses appear ≥3 times each (55 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":15,"total_dupe_rows":55,"examples":[{"address":"general auction \\| chesterfield \\| saleroom 46 \\| home delivery","count":4},{"address":"chesterfield","count":4},{"address":"general auction \\| nottingham \\| saleroom 3 \\| home delivery","count":5}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'johnpye' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"johnpye"}`
- **[info] bullet_starvation** — Bullet starvation: 102/129 (79%) lots have empty bullets
  - `{"empty":102,"total":129,"ratio":0.791}`

## kivells

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (49 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":49,"examples":[{"address":"woodacott, holsworthy, devon ex22","count":4},{"address":"stratton road, bude, cornwall ex23","count":4},{"address":"victoria road, camelford, cornwall pl32","count":3}]}`

## knightfrank

- **[error] duplicate_address_wall** — Duplicate-address wall: 8 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":8,"total_dupe_rows":30,"examples":[{"address":"21 strand-on-the-green, london, w4 3ph","count":5},{"address":"cottage, 4 holt road, bradford-on-avon, wiltshire, ba15 1aj","count":4},{"address":"250 bethnal green road, london, e2 0aa","count":3}]}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 addresses appear ≥3 times each (42 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":12,"total_dupe_rows":42,"examples":[{"address":"apartment 5, 191 water street, manchester, lancashire, m3 4ja","count":5},{"address":"55 ashton road, southport, merseyside, pr8 4qf","count":4},{"address":"flat 6, 23 park view, north shields, tyne and wear, ne29 6da","count":3}]}`
- **[warn] image_coverage_low** — Image coverage low: 95/176 (54%) lots missing image_url
  - `{"missing":95,"total":176,"ratio":0.54}`

## lodgeandthomas

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"the coach house, trenoweth, grampound road, truro, cornwall, tr2 4dy","count":3},{"address":"22 trewartha road, bodmin, cornwall, pl31 2je","count":3},{"address":"penpont, blakes lane, redruth, cornwall, tr16 6an","count":3}]}`
- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 34/34 (100%) lots missing image_url
  - `{"missing":34,"total":34,"ratio":1}`

## lot9

- **[warn] identical_price_wall** — Identical-price wall: 7/12 (58%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":7,"total":12,"ratio":0.583}`

## loveitts

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (11 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":11,"examples":[{"address":"land 14 - 16 ash green lane, ash green, coventry, warwickshire cv7 9ah","count":5},{"address":"flat 25, abbey court, priory place, coventry, west midlands cv1 5sa","count":3},{"address":"51, 51a, 51b webb street, stockingford, nuneaton, warwickshire cv10 8jg","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 22/30 (73%) lots have empty bullets
  - `{"empty":22,"total":30,"ratio":0.733}`

## lsh

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land adjacent fountain cottage, the marld, kt21 1rw","count":3}]}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 17/19 (89%) lots have empty bullets
  - `{"empty":17,"total":19,"ratio":0.895}`

## markjenkinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (31 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":31,"examples":[{"address":"16 antill street, stapleford, nottingham ng9 7ft","count":3},{"address":"land at bent street & elm street, newsome, huddersfield, west yorkshire hd4 6nx","count":3},{"address":"unit 1 slate house, oakwood court, city road, bradford, west yorkshire bd8 8jy","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 336/406 (83%) lots have empty bullets
  - `{"empty":336,"total":406,"ratio":0.828}`

## mccartneys

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (9 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":9,"examples":[{"address":"foxglove close, stourport-on-severn, worcestershire, dy13 9bn","count":6},{"address":"a well presented detached four/five bedroom house, currently used as a bed & breakfast having achieved high accolades, with mature gardens, garage and stable block. adjacent to holiday lodge park.","count":3}]}`
- **[info] bullet_starvation** — Bullet starvation: 85/89 (96%) lots have empty bullets
  - `{"empty":85,"total":89,"ratio":0.955}`

## mchughandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 22 addresses appear ≥3 times each (67 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":22,"total_dupe_rows":67,"examples":[{"address":"land between, 24 & 26 aylesbury drive, great notley, braintree, cm77 7aw","count":3},{"address":"18 malvern road, cambridge, cb1 9ld","count":3},{"address":"54 meadway, bedford, mk41 9hh","count":4}]}`

## nesbits

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (24 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":24,"examples":[{"address":"st george's road, southsea po4 9pl","count":4},{"address":"north street, havant po9 1pt","count":4},{"address":"southampton road, portsmouth, hampshire, po6 4ry","count":4}]}`

## pattinson

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 addresses appear ≥3 times each (32 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":9,"total_dupe_rows":32,"examples":[{"address":"brayford wharf east, lincoln, lincolnshire, ln5 7bg","count":4},{"address":"17 north john street, liverpool, merseyside, l2 5qy","count":3},{"address":"middleton road, hartlepool, durham, ts24 0uh","count":4}]}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 213 addresses appear ≥3 times each (889 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":213,"total_dupe_rows":889,"examples":[{"address":"whispering woods, pontardawe, swansea, west glamorgan, sa8 4pj","count":4},{"address":"parcel 1, cynllwyndu road, tylorstown, ferndale, cf43 3dr","count":5},{"address":"1 cross street, penygraig, tonypandy, cf40 1ld","count":4}]}`

## pearsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (13 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":13,"examples":[{"address":"62 high street, west end, hampshire so30 3dt","count":3},{"address":"over 60's, hebron court, hill lane, southampton","count":5},{"address":"highfield lane, southampton","count":5}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/40 (93%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":37,"total":40,"ratio":0.925}`

## philliparnold

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"flat 12 hedley court, 67 putney hill, london sw15 3ns","count":3},{"address":"8 bays farm court, 480 bath road, longford, middlesex ub7 0dy","count":3},{"address":"pumney, 7 drayton road, sutton courtenay, abingdon ox14 4aj","count":3}]}`

## phillipssmithanddunn

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"barnfield close ex33 2hl","count":3}]}`

## probateauction

- **[warn] image_coverage_low** — Image coverage low: 10/19 (53%) lots missing image_url
  - `{"missing":10,"total":19,"ratio":0.526}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 addresses appear ≥3 times each (17 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":5,"total_dupe_rows":17,"examples":[{"address":"westbeach, westward ho, bideford, devon, ex39 1lq","count":5},{"address":"westminster road, morecambe, la4 4ja","count":3},{"address":"westbeach, westward ho!, bideford, devon, ex39 1lq","count":3}]}`

## pugh

- **[error] duplicate_address_wall** — Duplicate-address wall: 24 addresses appear ≥3 times each (77 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":24,"total_dupe_rows":77,"examples":[{"address":"6-8 church street, clitheroe, lancashire bb7 2dg","count":4},{"address":"34 derby street, ince, wigan, lancashire wn3 4tj","count":3},{"address":"18a hodgson fold, bradford, west yorkshire bd2 4eb","count":3}]}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 67 addresses appear ≥3 times each (224 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":67,"total_dupe_rows":224,"examples":[{"address":"top floor flat 21 agar grove, london, nw1 9sl","count":3},{"address":"17 radbourne grove, bolton, lancashire, bl3 4td","count":4},{"address":"11 jerome way shipton-on-cherwell, kidlington, oxfordshire, ox5 1jt","count":3}]}`

## rendells

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (3 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"12 newton road, kingskerswell, devon, tq12 5aa","count":3}]}`

## robinsonhall

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (39 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":39,"examples":[{"address":"flat 16, 70-72 clapham road, bedford, bedfordshire, mk41 7pn","count":4},{"address":"delta marriott hotel, timbold drive, milton keynes, buckinghamshire mk7 6hl","count":7},{"address":"95 bower street, bedford, bedfordshire, mk40 3rb","count":3}]}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"98 risca road, cross keys, newport, gwent, np11 7dh","count":4}]}`

## sarahmains

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 addresses appear ≥3 times each (37 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":11,"total_dupe_rows":37,"examples":[{"address":"30 rayleigh grove, gateshead, tyne and wear, ne8 4qq","count":4},{"address":"306 old durham road, gateshead, tyne and wear, ne8 4bq","count":6},{"address":"62 cameronian square, worsdell drive, gateshead, tyne and wear, ne8 2db","count":3}]}`

## savills

- **[error] duplicate_address_wall** — Duplicate-address wall: 30 addresses appear ≥3 times each (108 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":30,"total_dupe_rows":108,"examples":[{"address":"land at brocks lane, frilsham, berkshire, rg18 9uy","count":3},{"address":"unit 6 station court, station approach, borough green, sevenoaks, kent tn15 8bg","count":3},{"address":"13 topcliffe street, hartlepool, ts26 8ll","count":4}]}`

## seelauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"land at station buildings, blackwood road, pontllanfraith, np12 2br","count":3},{"address":"87 high street, merthyr tydfil, cf47 8ug","count":3}]}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 addresses appear ≥3 times each (93 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":19,"total_dupe_rows":93,"examples":[{"address":"17, hopbine avenue bradford, bd5 8er","count":4},{"address":"317 collonnade sunbridge road bradford, bd1 2hq","count":5},{"address":"439 - 441 thornton road bradford, bd13 3nn","count":3}]}`

## sheldonbosley

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"5 oak hill, wolverhampton, west midlands, wv3 9ae","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 18/33 (55%) lots missing image_url
  - `{"missing":18,"total":33,"ratio":0.545}`

## shonkibros

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (21 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":21,"examples":[{"address":"workshop & storage rear of, 7 henley road, leicester, le3 9rd","count":4},{"address":"76 guthlaxton street, highfields, leicester, le2 0se","count":5},{"address":"9 frankson avenue, narborough road south, leicester, le3 2gj","count":3}]}`

## stags

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 addresses appear ≥3 times each (4 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"ravenshoe, beaminster, dt6 3uh","count":4}]}`

## strakers

- **[error] duplicate_address_wall** — Duplicate-address wall: 6 addresses appear ≥3 times each (25 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":6,"total_dupe_rows":25,"examples":[{"address":"67 pine avenue, bath, somerset, ba2 3ln","count":3},{"address":"32 high street, chippenham, wiltshire, sn15 3er","count":3},{"address":"123 elm road, swindon, wiltshire, sn1 2ab","count":3}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 45 addresses appear ≥3 times each (143 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":45,"total_dupe_rows":143,"examples":[{"address":"25 the drive, golders green, london, nw11 9sx","count":4},{"address":"664 high road leyton, leyton, waltham forest, e10 6jp","count":4},{"address":"53 fairfield road, london, e3 2qa","count":4}]}`

## suttonkersh

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 addresses appear ≥3 times each (45 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":13,"total_dupe_rows":45,"examples":[{"address":"456 sample road, liverpool, l2 3cd","count":4},{"address":"buying","count":4},{"address":"31 brookfield lane, aughton, ormskirk, lancashire, l39 6sn","count":3}]}`

## symondsandsampson

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (6 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"quarry close, swanage, bh19","count":3},{"address":"upton road, torquay, tq1","count":3}]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 34 addresses appear ≥3 times each (136 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":34,"total_dupe_rows":136,"examples":[{"address":"9 park street, shifnal, shropshire, tf11 9ba","count":6},{"address":"12 sunny brow road, middleton, manchester, lancashire, m24 4bg","count":4},{"address":"23 haven close, sutton-in-ashfield, nottinghamshire, ng17 2dg","count":3}]}`

## thepropertyauctionhouse

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 addresses appear ≥3 times each (12 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":3,"total_dupe_rows":12,"examples":[{"address":"land rear of 8 brynawelon road, cwmllynfell, swansea, west glamorgan, sa9 2wg","count":6},{"address":"42a fields park road, newport, gwent, np20 5bb","count":3},{"address":"35 bryn road, brynmill, swansea, west glamorgan, sa2 0ap","count":3}]}`

## underthehammer

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"55 caludon road, coventry, cv2 4lr","count":4},{"address":"2 northumberland avenue, margate, ct9 3bs","count":3}]}`

## venmore

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 addresses appear ≥3 times each (59 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":14,"total_dupe_rows":59,"examples":[{"address":"95 alexandra road, crosby, merseyside, l23 7te","count":7},{"address":"apt. 62 east float quay dock road, birkenhead, ch41 1dn","count":5},{"address":"28 hawarden avenue, liverpool, l17 2al","count":4}]}`
- **[info] bullet_starvation** — Bullet starvation: 73/100 (73%) lots have empty bullets
  - `{"empty":73,"total":100,"ratio":0.73}`

## walkersingleton

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 addresses appear ≥3 times each (7 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"goole & wetherby, yorkshire","count":3},{"address":"halifax, west yorkshire","count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 14/25 (56%) lots missing image_url
  - `{"missing":14,"total":25,"ratio":0.56}`

## wilsons

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 addresses appear ≥3 times each (30 total dupe rows) — pagination may be looping page 1
  - `{"unique_dupes":10,"total_dupe_rows":30,"examples":[{"address":"789 demo drive, manchester, m1 3cd","count":3},{"address":"456 sample avenue, manchester, m1 2ab","count":3},{"address":"789 test drive, birmingham, b1 5ef","count":3}]}`


