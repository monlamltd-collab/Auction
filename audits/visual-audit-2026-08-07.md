# Visual Audit — 2026-08-07

Scanned **36,163** rows in **33691ms** across **13** houses with findings.

**Findings:** 3 error · 2 warn · 8 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 15/20 (75%) lots have neither usable bullets nor a meaningful description
  - `{"empty":15,"total":20,"ratio":0.75}`

## auctionhousekent

- **[info] bullet_starvation** — Content starvation: 5/7 (71%) lots have neither usable bullets nor a meaningful description
  - `{"empty":5,"total":7,"ratio":0.714}`

## bidx1

- **[warn] image_coverage_low** — Image coverage low: 21/29 (72%) lots missing image_url
  - `{"missing":21,"total":29,"ratio":0.724}`

## bondwolfe

- **[info] bullet_starvation** — Content starvation: 28/39 (72%) lots have neither usable bullets nor a meaningful description
  - `{"empty":28,"total":39,"ratio":0.718}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 210/210 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":210,"total":210,"ratio":1}`

## buttersjohnbee

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/4986/listings/822973/images/-efoyrzb9km8eqgxl21r_6e53-9b99-f108-ed23-9ce4-f180-80bf-9995_20260727010718.jpg","distinct_addresses":3,"row_ids":["5a80e78b-dd50-44cd-b793-8ded3de172fd","a55b7ff0-c5d2-43d1-a82f-e9b7499445d4","ad9d7749-0f22-49d4-b76f-f5c9c2323309"]}`

## cliveemson

- **[warn] image_coverage_low** — Image coverage low: 8/8 (100%) lots missing image_url
  - `{"missing":8,"total":8,"ratio":1}`

## firstforauctions

- **[info] bullet_starvation** — Content starvation: 59/59 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":59,"total":59,"ratio":1}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 5/5 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":5,"total":5,"ratio":1}`

## hunters

- **[info] bullet_starvation** — Content starvation: 17/19 (89%) lots have neither usable bullets nor a meaningful description
  - `{"empty":17,"total":19,"ratio":0.895}`

## maggsandallen

- **[error] hero_image_bleed** — Hero-image bleed: 5 distinct current addresses share one image_url
  - `{"image_url":"https://www.maggsandallen.co.uk/images/Maggs,aAllen_Text_Only_WhitePink.png.pagespeed.ce.I-P4uL8KUk.png","distinct_addresses":5,"row_ids":["17afc12b-730d-48b7-80a5-06befd4e2be2","631b84f4-6dfb-40fe-b2a4-6ec7ff1d66b9","a4a42ecb-9197-4e4b-8662-400dd81641df","e62e2aab-e6ec-4313-8541-801496f11b59","e8deaf81-fee1-4890-809d-c909fece3121"]}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (14 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":14,"examples":[{"address":"261 barlow moor road, manchester, lancashire, m21 7gj\\","auction_date":"2026-07-28","count":14}]}`

## venmore

- **[info] bullet_starvation** — Content starvation: 20/20 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":20,"total":20,"ratio":1}`


