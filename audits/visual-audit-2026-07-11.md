# Visual Audit — 2026-07-11

Scanned **31,224** rows in **27403ms** across **41** houses with findings.

**Findings:** 21 error · 12 warn · 21 info

## ahlondon

- **[warn] identical_price_wall** — Identical-price wall: 119/204 (58%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":119,"total":204,"ratio":0.583}`

## andrewcraig

- **[info] image_domain_mismatch** — Image domain mismatch: 77/77 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":77,"total":77,"ratio":1}`

## auctionhammermidlands

- **[info] bullet_starvation** — Bullet starvation: 45/62 (73%) lots have empty bullets
  - `{"empty":45,"total":62,"ratio":0.726}`
- **[info] image_domain_mismatch** — Image domain mismatch: 62/62 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":62,"total":62,"ratio":1}`

## auctionhousebirmingham

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"18 broad way, pelsall, walsall, west midlands ws4 1aw","count":3},{"address":"12 wellington terrace, stoke-on-trent, staffordshire st1 3py","count":3}]}`

## auctionhouseeastanglia

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"5a market place, halesworth, suffolk ip19 8ba","count":3}]}`

## auctionhouseeastmidlands

- **[error] retired_slug_straggler** — Retired slug straggler: 'auctionhouseeastmidlands' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"auctionhouseeastmidlands"}`

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"flat 11, lilystone hall, honeypot lane, stock, ingatestone, essex cm4 9gj","count":3}]}`

## auctionhouselincolnshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 778/1013 (77%) lots have no price + no price_text
  - `{"tba":778,"total":1013,"ratio":0.768}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"22 gedling street, mansfield, nottinghamshire, ng18 4ah","count":3},{"address":"20, priestsic road, sutton-in-ashfield, nottinghamshire, ng17 4eb","count":3}]}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 9/13 (69%) lots missing image_url
  - `{"missing":9,"total":13,"ratio":0.692}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 33 visible addresses appear ≥3 times each (110 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":33,"total_dupe_rows":110,"examples":[{"address":"flat f, 51 castle street, aberdeen, aberdeen city ab11 5bb","count":3},{"address":"plots at burnside cottages, aberdeen, aberdeenshire ab12 5yq","count":4},{"address":"114 hilltown, dundee, angus dd3 7bg","count":4}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 360/363 (99%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":360,"total":363,"ratio":0.992}`

## auctionhousesouthyorkshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 1534/1605 (96%) lots have no price + no price_text
  - `{"tba":1534,"total":1605,"ratio":0.956}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"flat 6, 192 church road, hove, bn3 2dj","count":3},{"address":"flat 2, 4 guildhall street, chichester, po19 1nj","count":3}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 58/59 (98%) lots have empty bullets
  - `{"empty":58,"total":59,"ratio":0.983}`

## btgeddisons

- **[info] bullet_starvation** — Bullet starvation: 703/888 (79%) lots have empty bullets
  - `{"empty":703,"total":888,"ratio":0.792}`

## charlesdarrow

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct addresses share one image_url
  - `{"image_url":"https://www.charlesdarrow.co.uk/Modules/Controls/ImageServer.aspx?I=34456_21334.jpg&T=-1&C=/Images/Im2/1/","distinct_addresses":3}`
- **[warn] image_coverage_low** — Image coverage low: 145/176 (82%) lots missing image_url
  - `{"missing":145,"total":176,"ratio":0.824}`

## cityandruralpropertyauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 24/24 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":24,"total":24,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 11 visible addresses appear ≥3 times each (61 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":11,"total_dupe_rows":61,"examples":[{"address":"sittingbourne - kent","count":13},{"address":"dulverton - somerset","count":11},{"address":"maidstone - kent","count":7}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 19 visible addresses appear ≥3 times each (74 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":19,"total_dupe_rows":74,"examples":[{"address":"poldhu cottage, rectory road, penzance, st. buryan, cornwall, tr19 6bb","count":4},{"address":"51 old exeter road, newton abbot, devon, tq12 2nh","count":4},{"address":"19 st. nicholas street, bodmin, cornwall, pl31 1ab","count":4}]}`

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

- **[info] image_domain_mismatch** — Image domain mismatch: 1081/1099 (98%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":1081,"total":1099,"ratio":0.984}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"71 hammer hill, haslemere, surrey, gu27 3qz","count":3}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3, fountain buildings, bath, ba1 5du","count":3}]}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 19/19 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":19,"total":19,"ratio":1}`

## landwood

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"11 troydale park, pudsey, west yorkshire, ls28 9lz","count":3}]}`

## lodgeandthomas

- **[error] retired_slug_straggler** — Retired slug straggler: 'lodgeandthomas' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"lodgeandthomas"}`
- **[warn] image_coverage_low** — Image coverage low: 59/59 (100%) lots missing image_url
  - `{"missing":59,"total":59,"ratio":1}`

## lot9

- **[warn] identical_price_wall** — Identical-price wall: 22/33 (67%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":22,"total":33,"ratio":0.667}`

## loveitts

- **[warn] image_coverage_low** — Image coverage low: 16/30 (53%) lots missing image_url
  - `{"missing":16,"total":30,"ratio":0.533}`
- **[info] bullet_starvation** — Bullet starvation: 27/30 (90%) lots have empty bullets
  - `{"empty":27,"total":30,"ratio":0.9}`

## lsh

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 visible addresses appear ≥3 times each (9 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"27 roundstone street, trowbridge, wiltshire, ba14 8de","count":3},{"address":"43 middleton crescent, norwich, norfolk, nr5 0px","count":3},{"address":"5 roundstone street, trowbridge, wiltshire, ba14 8dh","count":3}]}`

## luscombemaye

- **[info] bullet_starvation** — Bullet starvation: 19/24 (79%) lots have empty bullets
  - `{"empty":19,"total":24,"ratio":0.792}`

## markjenkinson

- **[info] bullet_starvation** — Bullet starvation: 329/383 (86%) lots have empty bullets
  - `{"empty":329,"total":383,"ratio":0.859}`
- **[info] image_domain_mismatch** — Image domain mismatch: 361/383 (94%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":361,"total":383,"ratio":0.943}`

## mccartneys

- **[info] bullet_starvation** — Bullet starvation: 84/97 (87%) lots have empty bullets
  - `{"empty":84,"total":97,"ratio":0.866}`

## paulfosh

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (4 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"75 high street, cinderford, gloucestershire, gl14 2su","count":4}]}`

## pearsons

- **[info] image_domain_mismatch** — Image domain mismatch: 66/69 (96%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":66,"total":69,"ratio":0.957}`

## purplebricksgoto

- **[error] duplicate_address_wall** — Duplicate-address wall: 14 visible addresses appear ≥3 times each (48 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":14,"total_dupe_rows":48,"examples":[{"address":"4 the quadrant, manchester, lancashire, m9 7az","count":3},{"address":"47 cranford street, south shields, tyne and wear, ne34 0qn","count":4},{"address":"23 foxhall road, ipswich, suffolk, ip3 8ju","count":4}]}`
- **[warn] guide_tba_wall** — Guide-TBA wall: 2336/3143 (74%) lots have no price + no price_text
  - `{"tba":2336,"total":3143,"ratio":0.743}`
- **[warn] image_coverage_low** — Image coverage low: 1971/3143 (63%) lots missing image_url
  - `{"missing":1971,"total":3143,"ratio":0.627}`

## sageandco

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"garage/workshop, malpas road, newport, gwent, np20 6na","count":3}]}`

## sdl

- **[error] retired_slug_straggler** — Retired slug straggler: 'sdl' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"sdl"}`
- **[info] bullet_starvation** — Bullet starvation: 157/157 (100%) lots have empty bullets
  - `{"empty":157,"total":157,"ratio":1}`
- **[info] image_domain_mismatch** — Image domain mismatch: 157/157 (100%) lots use host 'asta.btgeddisonspropertyauctions.com' — could be a logo/placeholder
  - `{"host":"asta.btgeddisonspropertyauctions.com","count":157,"total":157,"ratio":1}`

## suttonkersh

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct addresses share one image_url
  - `{"image_url":"https://www.suttonkersh.co.uk/properties/gallery/themes/sk/images/my-sk.png","distinct_addresses":3}`

## venmore

- **[info] bullet_starvation** — Bullet starvation: 34/48 (71%) lots have empty bullets
  - `{"empty":34,"total":48,"ratio":0.708}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 38/39 (97%) lots have empty bullets
  - `{"empty":38,"total":39,"ratio":0.974}`
- **[info] image_domain_mismatch** — Image domain mismatch: 38/39 (97%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":38,"total":39,"ratio":0.974}`


## Auto-fixes applied

- **hero_image_bleed**: nulled 10 row(s) across 2 house(s).
  - `suttonkersh` × 6 — `https://www.suttonkersh.co.uk/properties/gallery/themes/sk/images/my-sk.png`
  - `charlesdarrow` × 4 — `https://www.charlesdarrow.co.uk/Modules/Controls/ImageServer.aspx?I=34456_21334.jpg&T=-1&C=/Images/Im2/1/`

