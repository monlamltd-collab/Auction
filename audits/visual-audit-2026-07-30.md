# Visual Audit — 2026-07-30

Scanned **35,036** rows in **74665ms** across **24** houses with findings.

**Findings:** 9 error · 3 warn · 16 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 16/21 (76%) lots have neither usable bullets nor a meaningful description
  - `{"empty":16,"total":21,"ratio":0.762}`

## agentsproperty

- **[error] hero_image_bleed** — Hero-image bleed: 4 distinct current addresses share one image_url
  - `{"image_url":"https://www.agentspropertyauction.com/wp-content/themes/apa/img/nava.png","distinct_addresses":4,"row_ids":["4b7da2dd-d7c9-4ce5-84f2-1e210e7fb3da","789cd42e-4914-42cb-abaa-982327cce570","9b8bb102-c438-4a29-8cb4-83b57d33131d","b3b62134-9868-491b-af00-ed29a4790715"]}`

## bradleyhall

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/299/auction/0/2317916_web_medium?v=10/14/2025 8:11:38 AM","distinct_addresses":3,"row_ids":["016d6d22-b3e8-4bbb-93a8-9a0b4a486a10","2f5378d8-6e23-4a8b-8209-61316931eef9","984cf484-a5b8-4d51-b4ff-c0cdf207caae"]}`

## brownco

- **[info] bullet_starvation** — Content starvation: 9/9 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":9,"total":9,"ratio":1}`

## brutonknowles

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://www.brutonknowles.co.uk/wp-content/uploads/2025/01/e91a612c-bb8f-44c0-8aa6-08f56c716b89-2.jpg","distinct_addresses":3,"row_ids":["25228990-1839-481f-8ee1-84b7d269b1bd","7a6a7588-a517-4a23-a72a-ee5b2cf2d1a0","f5778c4e-28fc-4ea4-bae5-234cb0061c07"]}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 305/306 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":305,"total":306,"ratio":0.997}`

## buttersjohnbee

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/4986/listings/820094/images/wzrtul92leaycscevkhz_84d9-1533-5873-5508-c84a-fdf4-f893-58c5_20260723020842.jpg","distinct_addresses":3,"row_ids":["299ab914-6616-44c6-bac6-e399c47d5770","53225d44-f120-48ae-85ff-d940a5240aa5","653de1ee-0274-495e-bce9-fbc42fb30fd7"]}`
- **[info] bullet_starvation** — Content starvation: 27/27 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":27,"total":27,"ratio":1}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (5 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"dover, kent","auction_date":null,"count":5}]}`
- **[warn] image_coverage_low** — Image coverage low: 33/33 (100%) lots missing image_url
  - `{"missing":33,"total":33,"ratio":1}`

## edwardmellor

- **[info] bullet_starvation** — Content starvation: 47/47 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":47,"total":47,"ratio":1}`

## firstforauctions

- **[info] bullet_starvation** — Content starvation: 58/58 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":58,"total":58,"ratio":1}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 8/8 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":8,"total":8,"ratio":1}`

## henrysykes

- **[warn] guide_tba_wall** — Guide-TBA wall: 5/7 (71%) lots have no price + no price_text
  - `{"tba":5,"total":7,"ratio":0.714}`

## hunters

- **[info] bullet_starvation** — Content starvation: 16/19 (84%) lots have neither usable bullets nor a meaningful description
  - `{"empty":16,"total":19,"ratio":0.842}`

## loveitts

- **[warn] image_coverage_low** — Image coverage low: 5/6 (83%) lots missing image_url
  - `{"missing":5,"total":6,"ratio":0.833}`
- **[info] bullet_starvation** — Content starvation: 6/6 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":6,"ratio":1}`

## lsh

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/13/auction/0/2683577_web_medium?v=6/1/2026 1:54:03 PM","distinct_addresses":3,"row_ids":["19297dd5-67a8-42a7-86cf-76f8f773282a","740a6206-9d21-4a64-bf18-ae9affa54b84","ad358e6f-925d-4cba-9df7-33b8327fb190"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 4 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/13/auction/0/2677897_web_medium?v=5/18/2026 1:24:21 PM","distinct_addresses":4,"row_ids":["3722fcba-9390-4ec1-9d19-ec8132d05acd","85a5274c-794b-41e4-b835-d5d1c49a2f83","8c14d4b3-388f-49f9-b8ae-f17aeb42c94f","a27b4762-466c-479d-94fd-44876fcb229f"]}`

## maggsandallen

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://www.maggsandallen.co.uk/images/Maggs,aAllen_Text_Only_WhitePink.png.pagespeed.ce.I-P4uL8KUk.png","distinct_addresses":3,"row_ids":["17afc12b-730d-48b7-80a5-06befd4e2be2","631b84f4-6dfb-40fe-b2a4-6ec7ff1d66b9","e8deaf81-fee1-4890-809d-c909fece3121"]}`

## sarahmains

- **[info] bullet_starvation** — Content starvation: 6/6 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":6,"ratio":1}`

## sharpesauctions

- **[info] bullet_starvation** — Content starvation: 36/36 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":36,"total":36,"ratio":1}`

## shonkibros

- **[info] bullet_starvation** — Content starvation: 17/17 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":17,"total":17,"ratio":1}`

## strakers

- **[info] bullet_starvation** — Content starvation: 16/16 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":16,"total":16,"ratio":1}`

## suttonkersh

- **[info] bullet_starvation** — Content starvation: 28/28 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":28,"total":28,"ratio":1}`

## symondsandsampson

- **[info] bullet_starvation** — Content starvation: 33/33 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":33,"total":33,"ratio":1}`

## tcpa

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/242/auction/0/2743820_web_medium","distinct_addresses":3,"row_ids":["7bf33424-2ed9-492f-aa50-bc2a8abad4d1","d4a5700e-2bcf-4972-8bcd-b193e72cee97","f61f87fc-63cc-48e0-9b03-b87776dbfc41"]}`

## venmore

- **[info] bullet_starvation** — Content starvation: 21/21 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":21,"total":21,"ratio":1}`


