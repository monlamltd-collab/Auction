# Visual Audit — 2026-07-21

Scanned **32,677** rows in **27553ms** across **44** houses with findings.

**Findings:** 25 error · 12 warn · 18 info

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"land lying to the west of, tilehouse lane and peterbrook road, solihull, west midlands, b90 1pw","count":3},{"address":"7e, 7f, 9 & 9a high street, barnet, hertfordshire, en5 5ue","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 121/210 (58%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":121,"total":210,"ratio":0.576}`

## andrewcraig

- **[info] image_domain_mismatch** — Image domain mismatch: 82/83 (99%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":82,"total":83,"ratio":0.988}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 45/62 (73%) lots have empty bullets
  - `{"empty":45,"total":62,"ratio":0.726}`
- **[info] image_domain_mismatch** — Image domain mismatch: 62/62 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":62,"total":62,"ratio":1}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"5a market place, halesworth, suffolk ip19 8ba","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouselincolnshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 780/1018 (77%) lots have no price + no price_text
  - `{"tba":780,"total":1018,"ratio":0.766}`

## auctionhousenorthamptonshire

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"10 the leys, roade, northampton, northamptonshire nn7 2nr","count":3}]}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 9/13 (69%) lots missing image_url
  - `{"missing":9,"total":13,"ratio":0.692}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 32 visible addresses appear ≥3 times each (107 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":32,"total_dupe_rows":107,"examples":[{"address":"flat f, 51 castle street, aberdeen, aberdeen city ab11 5bb","count":3},{"address":"plots at burnside cottages, aberdeen, aberdeenshire ab12 5yq","count":4},{"address":"114 hilltown, dundee, angus dd3 7bg","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 368/372 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":368,"total":372,"ratio":0.989}`

## auctionhousesouthyorkshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 1537/1609 (96%) lots have no price + no price_text
  - `{"tba":1537,"total":1609,"ratio":0.955}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat 6, 192 church road, hove, bn3 2dj","count":3}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 81/82 (99%) lots have empty bullets
  - `{"empty":81,"total":82,"ratio":0.988}`

## bondwolfe

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"14 hughes street, stoke-on-trent, st6 2hb","count":3}]}`

## bramleys

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"prospect view, queensbury, bradford","count":3}]}`

## btgeddisons

- **[info] bullet_starvation** — Bullet starvation: 772/958 (81%) lots have empty bullets
  - `{"empty":772,"total":958,"ratio":0.806}`

## charlesdarrow

- **[warn] image_coverage_low** — Image coverage low: 149/176 (85%) lots missing image_url
  - `{"missing":149,"total":176,"ratio":0.847}`

## cityandruralpropertyauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 26/26 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":26,"total":26,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 visible addresses appear ≥3 times each (49 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":9,"total_dupe_rows":49,"examples":[{"address":"sittingbourne - kent","count":8},{"address":"dulverton - somerset","count":11},{"address":"maidstone - kent","count":6}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 18 visible addresses appear ≥3 times each (72 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":18,"total_dupe_rows":72,"examples":[{"address":"poldhu cottage, rectory road, penzance, st. buryan, cornwall, tr19 6bb","count":4},{"address":"51 old exeter road, newton abbot, devon, tq12 2nh","count":4},{"address":"19 st. nicholas street, bodmin, cornwall, pl31 1ab","count":4}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 8/8 (100%) lots missing image_url
  - `{"missing":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## firstforauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 7 visible addresses appear ≥3 times each (21 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":7,"total_dupe_rows":21,"examples":[{"address":"4 grimston lane, trimley st. martin, felixstowe, suffolk, ip11 0ru","count":3},{"address":"plot 4 - land on the south side of the warren, caversham, reading, berkshire, rg4 7th","count":3},{"address":"50 high street, wargrave, reading, berkshire, rg10 8by","count":3}]}`

## futureauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 1151/1152 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":1151,"total":1152,"ratio":0.999}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"71 hammer hill, haslemere, surrey, gu27 3qz","count":3}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3, fountain buildings, bath, ba1 5du","count":3}]}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 20/20 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":20,"total":20,"ratio":1}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (8 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":8,"examples":[{"address":"apartment 1604 viadux, 42 great bridgewater street, manchester, lancashire, m1 5lj","count":4},{"address":"11 troydale park, pudsey, west yorkshire, ls28 9lz","count":4}]}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 59/59 (100%) lots missing image_url
  - `{"missing":59,"total":59,"ratio":1}`

## lot9

- **[warn] identical_price_wall** — Identical-price wall: 22/33 (67%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":22,"total":33,"ratio":0.667}`

## loveitts

- **[warn] image_coverage_low** — Image coverage low: 16/31 (52%) lots missing image_url
  - `{"missing":16,"total":31,"ratio":0.516}`

## lsh

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 visible addresses appear ≥3 times each (9 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"27 roundstone street, trowbridge, wiltshire, ba14 8de","count":3},{"address":"43 middleton crescent, norwich, norfolk, nr5 0px","count":3},{"address":"5 roundstone street, trowbridge, wiltshire, ba14 8dh","count":3}]}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 20/25 (80%) lots have empty bullets
  - `{"empty":20,"total":25,"ratio":0.8}`

## markjenkinson

- **[info] bullet_starvation** — Bullet starvation: 329/383 (86%) lots have empty bullets
  - `{"empty":329,"total":383,"ratio":0.859}`
- **[info] image_domain_mismatch** — Image domain mismatch: 361/383 (94%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":361,"total":383,"ratio":0.943}`

## mccartneys

- **[info] bullet_starvation** — Bullet starvation: 84/97 (87%) lots have empty bullets
  - `{"empty":84,"total":97,"ratio":0.866}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 125 visible addresses appear ≥3 times each (377 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":125,"total_dupe_rows":377,"examples":[{"address":"33 wharf road, newport, gwent, np19 0ed","count":3},{"address":"building plot the pump house, little newcastle, pembrokeshire, dyfed, sa62 5td","count":3},{"address":"9 orchard street, newport, gwent, np19 7dn","count":3}]}`

## pearsonferrier

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"room 6, grattan house, bradford, bd1 2ph","count":3}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 68/72 (94%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":68,"total":72,"ratio":0.944}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 visible addresses appear ≥3 times each (48 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":14,"total_dupe_rows":48,"examples":[{"address":"4 the quadrant, manchester, lancashire, m9 7az","count":3},{"address":"47 cranford street, south shields, tyne and wear, ne34 0qn","count":4},{"address":"23 foxhall road, ipswich, suffolk, ip3 8ju","count":4}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 2339/3162 (74%) lots have no price + no price_text
  - `{"tba":2339,"total":3162,"ratio":0.74}`
- **[warn] image_coverage_low** — Image coverage low: 1878/3162 (59%) lots missing image_url
  - `{"missing":1878,"total":3162,"ratio":0.594}`

## sdl

- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 157/157 (100%) lots have empty bullets
  - `{"empty":157,"total":157,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 157/157 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":157,"total":157,"ratio":1}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 9 visible addresses appear ≥3 times each (28 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":9,"total_dupe_rows":28,"examples":[{"address":"37, green end clayton, bradford, bd14 6ba","count":4},{"address":"439 - 441 thornton road bradford, bd13 3nn","count":3},{"address":"12a byron studios, byron street bradford, bd3 0au","count":3}]}`

## sheldonbosley

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land at the rookery, badger, wolverhampton, wv6 7jt","count":3}]}`

## strettons

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land adjacent to 1 leaves green, leaves green road, keston, kent, br2 6du","count":3}]}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 57/58 (98%) lots have empty bullets
  - `{"empty":57,"total":58,"ratio":0.983}`


