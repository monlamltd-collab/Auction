# Visual Audit — 2026-07-08

Scanned **27,455** rows in **28374ms** across **39** houses with findings.

**Findings:** 16 error · 10 warn · 23 info

## ahlondon

- **[warn] identical_price_wall** — Identical-price wall: 119/198 (60%) lots share price £1800 — extractor likely picking up hero/banner price
  - `{"price":1800,"count":119,"total":198,"ratio":0.601}`

## andrewcraig

- **[info] image_domain_mismatch** — Image domain mismatch: 74/74 (100%) lots use host 'calpa.upcloudobjects.com' — could be a logo/placeholder
  - `{"host":"calpa.upcloudobjects.com","count":74,"total":74,"ratio":1}`

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

## auctionhouseessex

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"flat 11, lilystone hall, honeypot lane, stock, ingatestone, essex cm4 9gj","count":3},{"address":"station house, station road, felsted, dunmow, essex cm6 3hg","count":3}]}`

## auctionhouselincolnshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 822/1007 (82%) lots have no price + no price_text
  - `{"tba":822,"total":1007,"ratio":0.816}`

## auctionhouselondon

- **[error] duplicate_address_wall** — Duplicate-address wall: 3 visible addresses appear ≥3 times each (9 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":3,"total_dupe_rows":9,"examples":[{"address":"flat 91 celeste house, 1 caversham road, colindale, london, nw9 4dt","count":3},{"address":"39 cathedral green court, crawthorne road, peterborough, cambridgeshire, pe1 4ys","count":3},{"address":"7 secunda way, hempsted, gloucester, gloucestershire, gl2 5ga","count":3}]}`

## auctionhousenational

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"22 gedling street, mansfield, nottinghamshire, ng18 4ah","count":3},{"address":"20, priestsic road, sutton-in-ashfield, nottinghamshire, ng17 4eb","count":3}]}`

## auctionhousenorthernireland

- **[info] bullet_starvation** — Bullet starvation: 5/6 (83%) lots have empty bullets
  - `{"empty":5,"total":6,"ratio":0.833}`

## auctionhousenorthwales

- **[warn] image_coverage_low** — Image coverage low: 9/13 (69%) lots missing image_url
  - `{"missing":9,"total":13,"ratio":0.692}`

## auctionhousescotland

- **[error] duplicate_address_wall** — Duplicate-address wall: 12 visible addresses appear ≥3 times each (36 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":12,"total_dupe_rows":36,"examples":[{"address":"114 hilltown, dundee, angus dd3 7bg","count":3},{"address":"5 kilmun court, kilmun, dunoon, argyll and bute pa23 8sf","count":3},{"address":"land at ladysbridge cottages, banff, banffshire ab45 2jr","count":3}]}`
- **[info] image_domain_mismatch** — Image domain mismatch: 295/296 (100%) lots use host 'www.auctionhouse.co.uk' — could be a logo/placeholder
  - `{"host":"www.auctionhouse.co.uk","count":295,"total":296,"ratio":0.997}`

## auctionhousesouthyorkshire

- **[warn] guide_tba_wall** — Guide-TBA wall: 1530/1601 (96%) lots have no price + no price_text
  - `{"tba":1530,"total":1601,"ratio":0.956}`

## austingray

- **[error] duplicate_address_wall** — Duplicate-address wall: 2 visible addresses appear ≥3 times each (6 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":2,"total_dupe_rows":6,"examples":[{"address":"flat 6, 192 church road, hove, bn3 2dj","count":3},{"address":"flat 2, 4 guildhall street, chichester, po19 1nj","count":3}]}`

## bagshaws

- **[info] bullet_starvation** — Bullet starvation: 58/59 (98%) lots have empty bullets
  - `{"empty":58,"total":59,"ratio":0.983}`

## btgeddisons

- **[info] bullet_starvation** — Bullet starvation: 637/822 (77%) lots have empty bullets
  - `{"empty":637,"total":822,"ratio":0.775}`

## charlesdarrow

- **[warn] image_coverage_low** — Image coverage low: 145/176 (82%) lots missing image_url
  - `{"missing":145,"total":176,"ratio":0.824}`

## cityandruralpropertyauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 24/24 (100%) lots use host 'ah-hub.property-world.co.uk' — could be a logo/placeholder
  - `{"host":"ah-hub.property-world.co.uk","count":24,"total":24,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 10 visible addresses appear ≥3 times each (62 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":10,"total_dupe_rows":62,"examples":[{"address":"thursday 23rd july 2026, 11:00 am","count":6},{"address":"sittingbourne - kent","count":12},{"address":"dulverton - somerset","count":11}]}`

## countrywide

- **[error] duplicate_address_wall** — Duplicate-address wall: 20 visible addresses appear ≥3 times each (65 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":20,"total_dupe_rows":65,"examples":[{"address":"poldhu cottage, rectory road, penzance, st. buryan, cornwall, tr19 6bb","count":3},{"address":"51 old exeter road, newton abbot, devon, tq12 2nh","count":3},{"address":"19 st. nicholas street, bodmin, cornwall, pl31 1ab","count":4}]}`

## driversnorris

- **[warn] guide_tba_wall** — Guide-TBA wall: 8/8 (100%) lots have no price + no price_text
  - `{"tba":8,"total":8,"ratio":1}`
- **[warn] image_coverage_low** — Image coverage low: 8/8 (100%) lots missing image_url
  - `{"missing":8,"total":8,"ratio":1}`
- **[info] bullet_starvation** — Bullet starvation: 8/8 (100%) lots have empty bullets
  - `{"empty":8,"total":8,"ratio":1}`

## edwardmellor

- **[info] bullet_starvation** — Bullet starvation: 181/215 (84%) lots have empty bullets
  - `{"empty":181,"total":215,"ratio":0.842}`

## eigplatform

- **[error] retired_slug_straggler** — Retired slug straggler: 'eigplatform' is not in HOUSE_ROOTS — should not have lots
  - `{"slug":"eigplatform"}`

## futureauctions

- **[info] image_domain_mismatch** — Image domain mismatch: 409/410 (100%) lots use host 'www.futurepropertyauctions.co.uk' — could be a logo/placeholder
  - `{"host":"www.futurepropertyauctions.co.uk","count":409,"total":410,"ratio":0.998}`

## harmanhealy

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"71 hammer hill, haslemere, surrey, gu27 3qz","count":3}]}`

## hollismorgan

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible addresses appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"3, fountain buildings, bath, ba1 5du","count":3}]}`

## johnfrancis

- **[info] image_domain_mismatch** — Image domain mismatch: 19/19 (100%) lots use host 'mr0.homeflow-assets.co.uk' — could be a logo/placeholder
  - `{"host":"mr0.homeflow-assets.co.uk","count":19,"total":19,"ratio":1}`

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

- **[info] image_domain_mismatch** — Image domain mismatch: 66/69 (96%) lots use host 'api.clarkscomputers.co.uk' — could be a logo/placeholder
  - `{"host":"api.clarkscomputers.co.uk","count":66,"total":69,"ratio":0.957}`

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

## venmore

- **[info] bullet_starvation** — Bullet starvation: 34/48 (71%) lots have empty bullets
  - `{"empty":34,"total":48,"ratio":0.708}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Bullet starvation: 37/38 (97%) lots have empty bullets
  - `{"empty":37,"total":38,"ratio":0.974}`
- **[info] image_domain_mismatch** — Image domain mismatch: 37/38 (97%) lots use host 'www.williamhbrownauctions-norwich.co.uk' — could be a logo/placeholder
  - `{"host":"www.williamhbrownauctions-norwich.co.uk","count":37,"total":38,"ratio":0.974}`


