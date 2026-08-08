# Visual Audit — 2026-08-08

Scanned **36,457** rows in **33542ms** across **12** houses with findings.

**Findings:** 4 error · 0 warn · 8 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 17/22 (77%) lots have neither usable bullets nor a meaningful description
  - `{"empty":17,"total":22,"ratio":0.773}`

## austingray

- **[info] bullet_starvation** — Content starvation: 26/37 (70%) lots have neither usable bullets nor a meaningful description
  - `{"empty":26,"total":37,"ratio":0.703}`

## bidx1

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://images-prd.bidx1.com/external/5a072b18-4695-4f09-9746-0e487d7df267_thumb.jpg?v=639189429846930000","distinct_addresses":3,"row_ids":["15bd16fb-919e-49c9-9d9e-1f18005d411a","42020511-0463-4907-909c-e11e2c633d1e","478100ae-0878-4c3d-965c-7909f870fc34"]}`

## bondwolfe

- **[info] bullet_starvation** — Content starvation: 27/37 (73%) lots have neither usable bullets nor a meaningful description
  - `{"empty":27,"total":37,"ratio":0.73}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 276/277 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":276,"total":277,"ratio":0.996}`

## buttersjohnbee

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/4986/listings/822973/images/-efoyrzb9km8eqgxl21r_6e53-9b99-f108-ed23-9ce4-f180-80bf-9995_20260727010718.jpg","distinct_addresses":3,"row_ids":["125a9f7e-b28a-411f-b4d8-3282a08bd2d5","a55b7ff0-c5d2-43d1-a82f-e9b7499445d4","ad9d7749-0f22-49d4-b76f-f5c9c2323309"]}`

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


