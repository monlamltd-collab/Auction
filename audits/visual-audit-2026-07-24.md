# Visual Audit — 2026-07-24

Scanned **33,525** rows in **24729ms** across **34** houses with findings.

**Findings:** 13 error · 12 warn · 20 info

## ahlondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"land lying to the west of, tilehouse lane and peterbrook road, solihull, west midlands, b90 1pw","count":3}]}`
- **[warn] identical_price_wall** — Identical-price wall: 121/210 (58%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":121,"total":210,"ratio":0.576}`

## andrewcraig

- **[info] image_domain_mismatch** — Image domain mismatch: 83/84 (99%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":83,"total":84,"ratio":0.988}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 45/62 (73%) lots have empty bullets
  - `{"empty":45,"total":62,"ratio":0.726}`
- **[info] image_domain_mismatch** — Image domain mismatch: 61/62 (98%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":61,"total":62,"ratio":0.984}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouselincolnshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 783/1029 (76%) lots have no price + no price_text
  - `{"tba":783,"total":1029,"ratio":0.761}`

## auctionhouselondon

- **[error] hero_image_bleed** — Hero-image bleed: 15 distinct addresses share one image_url
  - `{"image_url":"https://auctionhouselondon.co.uk/_next/image?url=%2Fimages%2Fnot-found.jpeg&w=5200&q=95","distinct_addresses":15}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 9/13 (69%) lots missing image_url
  - `{"missing":9,"total":13,"ratio":0.692}`

## auctionhousescotland

- **[info] image_domain_mismatch** — Image domain mismatch: 373/377 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":373,"total":377,"ratio":0.989}`

## auctionhousesouthyorkshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 1544/1668 (93%) lots have no price + no price_text
  - `{"tba":1544,"total":1668,"ratio":0.926}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 82/83 (99%) lots have empty bullets
  - `{"empty":82,"total":83,"ratio":0.988}`

## btgeddisons

- **[info] bullet_starvation** — Bullet starvation: 735/990 (74%) lots have empty bullets
  - `{"empty":735,"total":990,"ratio":0.742}`

## charlesdarrow

- **[warn] image_coverage_low** — Image coverage low: 149/176 (85%) lots missing image_url
  - `{"missing":149,"total":176,"ratio":0.847}`

## cityandruralpropertyauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 27/27 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":27,"total":27,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 visible addresses appear ≥3 times each (16 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":3,"total_dupe_rows":16,"examples":[{"address":"dulverton - somerset","count":8},{"address":"maidstone - kent","count":5},{"address":"dover, kent","count":3}]}`

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

## futureauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 1169/1170 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":1169,"total":1170,"ratio":0.999}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 20/20 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":20,"total":20,"ratio":1}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"11 troydale park, pudsey, west yorkshire, ls28 9lz","count":3},{"address":"apartment 1604 viadux, 42 great bridgewater street, manchester, lancashire, m1 5lj","count":3}]}`

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

- **[info] bullet_starvation** — Bullet starvation: 84/98 (86%) lots have empty bullets
  - `{"empty":84,"total":98,"ratio":0.857}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 118 visible addresses appear ≥3 times each (411 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":118,"total_dupe_rows":411,"examples":[{"address":"unit 2, 15 john street, carmarthen, dyfed, sa31 1qt","count":3},{"address":"33 wharf road, newport, gwent, np19 0ed","count":4},{"address":"building plot the pump house, little newcastle, pembrokeshire, dyfed, sa62 5td","count":4}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 69/73 (95%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":69,"total":73,"ratio":0.945}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 visible addresses appear ≥3 times each (33 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":10,"total_dupe_rows":33,"examples":[{"address":"4 the quadrant, manchester, lancashire, m9 7az","count":3},{"address":"47 cranford street, south shields, tyne and wear, ne34 0qn","count":4},{"address":"23 foxhall road, ipswich, suffolk, ip3 8ju","count":4}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 2332/3226 (72%) lots have no price + no price_text
  - `{"tba":2332,"total":3226,"ratio":0.723}`
- **[warn] image_coverage_low** — Image coverage low: 1656/3226 (51%) lots missing image_url
  - `{"missing":1656,"total":3226,"ratio":0.513}`

## sdl

- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 157/157 (100%) lots have empty bullets
  - `{"empty":157,"total":157,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 157/157 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":157,"total":157,"ratio":1}`

## sharpesauctions

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"136, dirkhill road bradford, bd7 1qr","count":3}]}`

## venmore

- **[info] bullet_starvation** — Bullet starvation: 43/58 (74%) lots have empty bullets
  - `{"empty":43,"total":58,"ratio":0.741}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 57/58 (98%) lots have empty bullets
  - `{"empty":57,"total":58,"ratio":0.983}`
- **[info] image_domain_mismatch** — Image domain mismatch: 57/58 (98%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":57,"total":58,"ratio":0.983}`


## Auto-fixes applied

- **hero_image_bleed**: nulled 26 row(s) across 1 house(s).
  - `auctionhouselondon` × 26 — `https://auctionhouselondon.co.uk/_next/image?url=%2Fimages%2Fnot-found.jpeg&w=5200&q=95`

