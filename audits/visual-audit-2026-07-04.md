# Visual Audit — 2026-07-04

Scanned **28,530** rows in **20821ms** across **46** houses with findings.

**Findings:** 24 error · 10 warn · 22 info

## ahlondon

- **[warn] identical_price_wall** — Identical-price wall: 119/198 (60%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":119,"total":198,"ratio":0.601}`

## andrewcraig

- **[info] image_domain_mismatch** — Image domain mismatch: 78/78 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":78,"total":78,"ratio":1}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 59/61 (97%) lots have empty bullets
  - `{"empty":59,"total":61,"ratio":0.967}`
- **[info] image_domain_mismatch** — Image domain mismatch: 61/61 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":61,"total":61,"ratio":1}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":3}]}`

## auctionhousechesterfield

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"57 houldsworth drive, chesterfield, derbyshire, s41 0bp","count":3}]}`

## auctionhousecumbria

- **[error] duplicate_address_wall** — Duplicate-address wall: 5 visible addresses appear ≥3 times each (16 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":5,"total_dupe_rows":16,"examples":[{"address":"5 tarn head, haverigg, millom, cumbria la18 4ne","count":3},{"address":"87 market street, dalton-in-furness, cumbria la15 8dl","count":3},{"address":"the flat, kirk allans, stock lane, grasmere, ambleside, cumbria la22 9sn","count":4}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 15 visible addresses appear ≥3 times each (46 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":15,"total_dupe_rows":46,"examples":[{"address":"west cottage, 2 crossways, ormesby st margaret, great yarmouth, norfolk nr29 3jz","count":3},{"address":"plot at 2 crow hall farm cottage, nightingale lane, downham market, norfolk pe38 9fd","count":3},{"address":"18 station road, holt, norfolk nr25 6bs","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"flat 11, lilystone hall, honeypot lane, stock, ingatestone, essex cm4 9gj","count":3},{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":3}]}`

## auctionhouselincolnshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"205 welholme road, grimsby dn32 9jd","count":3},{"address":"14 sandsfield lane, gainsborough, lincolnshire dn21 1bg","count":3}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 817/1029 (79%) lots have no price + no price_text
  - `{"tba":817,"total":1029,"ratio":0.794}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 visible addresses appear ≥3 times each (9 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"flat 91 celeste house, 1 caversham road, colindale, london, nw9 4dt","count":3},{"address":"39 cathedral green court, crawthorne road, peterborough, cambridgeshire, pe1 4ys","count":3},{"address":"7 secunda way, hempsted, gloucester, gloucestershire, gl2 5ga","count":3}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"22 gedling street, mansfield, nottinghamshire, ng18 4ah","count":3},{"address":"20, priestsic road, sutton-in-ashfield, nottinghamshire, ng17 4eb","count":3}]}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 visible addresses appear ≥3 times each (9 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"23 and 23a colwyn road, northampton, northamptonshire nn1 3pz","count":3},{"address":"8 oak close, hartwell, northampton, northamptonshire nn7 2jx","count":3},{"address":"10 the leys, roade, northampton, northamptonshire nn7 2nr","count":3}]}`

## auctionhousenortheast

- **[warn] guide_tba_wall** — Guide-TBA wall: 350/450 (78%) lots have no price + no price_text
  - `{"tba":350,"total":450,"ratio":0.778}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 9/13 (69%) lots missing image_url
  - `{"missing":9,"total":13,"ratio":0.692}`

## auctionhousenorthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 13 visible addresses appear ≥3 times each (39 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":13,"total_dupe_rows":39,"examples":[{"address":"cynefin, 29, victoria road, penygroes, caernarfon, gwynedd ll54 6hd","count":3},{"address":"239 promenade, blackpool, lancashire fy1 6ah","count":3},{"address":"flat 402, galgate silk mill, chapel lane, galgate, lancaster la2 0ez","count":3}]}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 visible addresses appear ≥3 times each (33 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":11,"total_dupe_rows":33,"examples":[{"address":"114 hilltown, dundee, angus dd3 7bg","count":3},{"address":"5 kilmun court, kilmun, dunoon, argyll and bute pa23 8sf","count":3},{"address":"land at ladysbridge cottages, banff, banffshire ab45 2jr","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 290/294 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":290,"total":294,"ratio":0.986}`

## auctionhousesouthwest

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (7 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":7,"examples":[{"address":"elmfield, bear street, barnstaple, devon ex32 7dx","count":4},{"address":"suhaili, prussia cove road, rosudgeon, penzance, cornwall tr20 9ax","count":3}]}`

## auctionhousesouthyorkshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 1520/1597 (95%) lots have no price + no price_text
  - `{"tba":1520,"total":1597,"ratio":0.952}`

## auctionhouseuklondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"52 st. marks avenue, northfleet, gravesend, kent, da11 9lw","count":3}]}`

## auctionhousewestyorkshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 visible addresses appear ≥3 times each (21 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"flat 30, northgate house, 35 stonegate road, leeds, west yorkshire ls6 4fl","count":3},{"address":"apartment 113, the velvet mill, lilycroft road, bradford, west yorkshire bd9 5bq","count":3},{"address":"9 newstead avenue, fitzwilliam, pontefract, west yorkshire wf9 5dt","count":3}]}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 visible addresses appear ≥3 times each (9 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"flat 6, 192 church road, hove, bn3 2dj","count":3},{"address":"flat 2, 4 guildhall street, chichester, po19 1nj","count":3},{"address":"jubilee farm, purlieu lane, godshill, fordingbridge, sp6 2lw","count":3}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 58/59 (98%) lots have empty bullets
  - `{"empty":58,"total":59,"ratio":0.983}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"birkby lodge road, huddersfield","count":3}]}`

## btgeddisons

- **[info] bullet_starvation** — Bullet starvation: 601/786 (76%) lots have empty bullets
  - `{"empty":601,"total":786,"ratio":0.765}`

## charlesdarrow

- **[warn] image_coverage_low** — Image coverage low: 145/176 (82%) lots missing image_url
  - `{"missing":145,"total":176,"ratio":0.824}`

## cityandruralpropertyauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 14/14 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":14,"total":14,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 17 visible addresses appear ≥3 times each (92 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":17,"total_dupe_rows":92,"examples":[{"address":"sittingbourne - kent","count":14},{"address":"dulverton - somerset","count":12},{"address":"worthing - west sussex","count":3}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 4 visible addresses appear ≥3 times each (13 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":4,"total_dupe_rows":13,"examples":[{"address":"19 st. nicholas street, bodmin, cornwall, pl31 1ab","count":3},{"address":"flat 2, 62 dale road, plymouth, devon, pl4 6pa","count":3},{"address":"7 the cliff, mevagissey, st. austell, cornwall, pl26 6qt","count":3}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 8/8 (100%) lots missing image_url
  - `{"missing":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`

## edwardmellor

- **[info] bullet_starvation** — Bullet starvation: 322/356 (90%) lots have empty bullets
  - `{"empty":322,"total":356,"ratio":0.904}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## futureauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 466/467 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":466,"total":467,"ratio":0.998}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3, fountain buildings, bath, ba1 5du","count":3}]}`

## humberts

- **[error] retired_slug_straggler** — Retired slug straggler: 'humberts' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"humberts"}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 15/16 (94%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":15,"total":16,"ratio":0.938}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 59/59 (100%) lots missing image_url
  - `{"missing":59,"total":59,"ratio":1}`

## lot9

- **[warn] identical_price_wall** — Identical-price wall: 22/33 (67%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":22,"total":33,"ratio":0.667}`

## loveitts

- **[info] bullet_starvation** — Bullet starvation: 39/51 (76%) lots have empty bullets
  - `{"empty":39,"total":51,"ratio":0.765}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 19/24 (79%) lots have empty bullets
  - `{"empty":19,"total":24,"ratio":0.792}`

## markjenkinson

- **[info] bullet_starvation** — Bullet starvation: 329/383 (86%) lots have empty bullets
  - `{"empty":329,"total":383,"ratio":0.859}`
- **[info] image_domain_mismatch** — Image domain mismatch: 361/383 (94%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":361,"total":383,"ratio":0.943}`

## mccartneys

- **[info] bullet_starvation** — Bullet starvation: 84/96 (88%) lots have empty bullets
  - `{"empty":84,"total":96,"ratio":0.875}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 65/68 (96%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":65,"total":68,"ratio":0.956}`

## sdl

- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 157/157 (100%) lots have empty bullets
  - `{"empty":157,"total":157,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 157/157 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":157,"total":157,"ratio":1}`

## venmore

- **[info] bullet_starvation** — Bullet starvation: 34/48 (71%) lots have empty bullets
  - `{"empty":34,"total":48,"ratio":0.708}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 37/38 (97%) lots have empty bullets
  - `{"empty":37,"total":38,"ratio":0.974}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/38 (97%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":37,"total":38,"ratio":0.974}`


