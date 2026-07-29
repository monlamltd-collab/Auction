# Visual Audit — 2026-07-29

Scanned **34,843** rows in **26018ms** across **25** houses with findings.

**Findings:** 7 error · 2 warn · 18 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 13/17 (76%) lots have neither usable bullets nor a meaningful description
  - `{"empty":13,"total":17,"ratio":0.765}`

## bagshaws

- **[info] bullet_starvation** — Content starvation: 11/11 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":11,"total":11,"ratio":1}`

## bradleyhall

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/299/auction/0/2317916_web_medium?v=10/14/2025 8:11:38 AM","distinct_addresses":3,"row_ids":["016d6d22-b3e8-4bbb-93a8-9a0b4a486a10","2f5378d8-6e23-4a8b-8209-61316931eef9","c3dfd18e-a109-4e63-af81-6d7a88cba5d9"]}`

## brownco

- **[info] bullet_starvation** — Content starvation: 9/9 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":9,"total":9,"ratio":1}`

## brutonknowles

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://www.brutonknowles.co.uk/wp-content/uploads/2025/01/e91a612c-bb8f-44c0-8aa6-08f56c716b89-2.jpg","distinct_addresses":3,"row_ids":["25228990-1839-481f-8ee1-84b7d269b1bd","7a6a7588-a517-4a23-a72a-ee5b2cf2d1a0","f5778c4e-28fc-4ea4-bae5-234cb0061c07"]}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 342/343 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":342,"total":343,"ratio":0.997}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (4 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"dover, kent","auction_date":null,"count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 25/25 (100%) lots missing image_url
  - `{"missing":25,"total":25,"ratio":1}`

## edwardmellor

- **[info] bullet_starvation** — Content starvation: 42/42 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":42,"total":42,"ratio":1}`

## firstforauctions

- **[info] bullet_starvation** — Content starvation: 57/57 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":57,"total":57,"ratio":1}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 8/8 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":8,"total":8,"ratio":1}`

## foxandsons

- **[info] bullet_starvation** — Content starvation: 11/11 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":11,"total":11,"ratio":1}`

## henrysykes

- **[warn] guide_tba_wall** — Guide-TBA wall: 5/7 (71%) lots have no price + no price_text
  - `{"tba":5,"total":7,"ratio":0.714}`

## hunters

- **[info] bullet_starvation** — Content starvation: 16/19 (84%) lots have neither usable bullets nor a meaningful description
  - `{"empty":16,"total":19,"ratio":0.842}`

## maggsandallen

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://www.maggsandallen.co.uk/images/Maggs,aAllen_Text_Only_WhitePink.png.pagespeed.ce.I-P4uL8KUk.png","distinct_addresses":3,"row_ids":["17afc12b-730d-48b7-80a5-06befd4e2be2","631b84f4-6dfb-40fe-b2a4-6ec7ff1d66b9","e8deaf81-fee1-4890-809d-c909fece3121"]}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"westbeach, westward ho, bideford, devon, ex39 1lq","auction_date":null,"count":3}]}`

## sarahmains

- **[info] bullet_starvation** — Content starvation: 6/6 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":6,"ratio":1}`

## sharpesauctions

- **[info] bullet_starvation** — Content starvation: 36/36 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":36,"total":36,"ratio":1}`

## shonkibros

- **[info] bullet_starvation** — Content starvation: 18/18 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":18,"total":18,"ratio":1}`

## strakers

- **[info] bullet_starvation** — Content starvation: 16/16 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":16,"total":16,"ratio":1}`

## suttonkersh

- **[info] bullet_starvation** — Content starvation: 27/27 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":27,"total":27,"ratio":1}`

## symondsandsampson

- **[info] bullet_starvation** — Content starvation: 33/33 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":33,"total":33,"ratio":1}`

## tcpa

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/242/auction/0/2781312_web_medium","distinct_addresses":3,"row_ids":["4c986004-7478-4f51-beaf-e7907a54b0b3","7a6e19c4-a28d-44dd-bc96-d7d58f15353f","e524feff-a97d-4f27-9cde-a7acd0fdd21e"]}`
- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (52 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":52,"examples":[{"address":"261 barlow moor road, manchester, lancashire, m21 7gj\\","auction_date":"2026-07-28","count":52}]}`

## venmore

- **[info] bullet_starvation** — Content starvation: 15/15 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":15,"total":15,"ratio":1}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Content starvation: 9/10 (90%) lots have neither usable bullets nor a meaningful description
  - `{"empty":9,"total":10,"ratio":0.9}`

## wilsons

- **[info] bullet_starvation** — Content starvation: 26/32 (81%) lots have neither usable bullets nor a meaningful description
  - `{"empty":26,"total":32,"ratio":0.813}`


