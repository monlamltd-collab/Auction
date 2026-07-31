# Visual Audit — 2026-07-31

Scanned **35,220** rows in **36405ms** across **14** houses with findings.

**Findings:** 9 error · 2 warn · 6 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 16/21 (76%) lots have neither usable bullets nor a meaningful description
  - `{"empty":16,"total":21,"ratio":0.762}`

## agentsproperty

- **[error] hero_image_bleed** — Hero-image bleed: 4 distinct current addresses share one image_url
  - `{"image_url":"https://www.agentspropertyauction.com/wp-content/themes/apa/img/nava.png","distinct_addresses":4,"row_ids":["4b7da2dd-d7c9-4ce5-84f2-1e210e7fb3da","789cd42e-4914-42cb-abaa-982327cce570","9b8bb102-c438-4a29-8cb4-83b57d33131d","b3b62134-9868-491b-af00-ed29a4790715"]}`

## bradleyhall

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/299/auction/0/2317916_web_medium?v=10/14/2025 8:11:38 AM","distinct_addresses":3,"row_ids":["016d6d22-b3e8-4bbb-93a8-9a0b4a486a10","2f5378d8-6e23-4a8b-8209-61316931eef9","984cf484-a5b8-4d51-b4ff-c0cdf207caae"]}`

## buttersjohnbee

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/4986/listings/820094/images/wzrtul92leaycscevkhz_84d9-1533-5873-5508-c84a-fdf4-f893-58c5_20260723020842.jpg","distinct_addresses":3,"row_ids":["299ab914-6616-44c6-bac6-e399c47d5770","53225d44-f120-48ae-85ff-d940a5240aa5","653de1ee-0274-495e-bce9-fbc42fb30fd7"]}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (5 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":5,"examples":[{"address":"dover, kent","auction_date":null,"count":5}]}`
- **[warn] image_coverage_low** — Image coverage low: 33/33 (100%) lots missing image_url
  - `{"missing":33,"total":33,"ratio":1}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 8/8 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":8,"total":8,"ratio":1}`

## henrysykes

- **[warn] guide_tba_wall** — Guide-TBA wall: 5/7 (71%) lots have no price + no price_text
  - `{"tba":5,"total":7,"ratio":0.714}`

## hunters

- **[info] bullet_starvation** — Content starvation: 16/18 (89%) lots have neither usable bullets nor a meaningful description
  - `{"empty":16,"total":18,"ratio":0.889}`

## lsh

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/13/auction/0/2683577_web_medium?v=6/1/2026 1:54:03 PM","distinct_addresses":3,"row_ids":["19297dd5-67a8-42a7-86cf-76f8f773282a","740a6206-9d21-4a64-bf18-ae9affa54b84","ad358e6f-925d-4cba-9df7-33b8327fb190"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 4 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/13/auction/0/2677897_web_medium?v=5/18/2026 1:24:21 PM","distinct_addresses":4,"row_ids":["3722fcba-9390-4ec1-9d19-ec8132d05acd","85a5274c-794b-41e4-b835-d5d1c49a2f83","8c14d4b3-388f-49f9-b8ae-f17aeb42c94f","a27b4762-466c-479d-94fd-44876fcb229f"]}`

## maggsandallen

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://www.maggsandallen.co.uk/images/Maggs,aAllen_Text_Only_WhitePink.png.pagespeed.ce.I-P4uL8KUk.png","distinct_addresses":3,"row_ids":["17afc12b-730d-48b7-80a5-06befd4e2be2","631b84f4-6dfb-40fe-b2a4-6ec7ff1d66b9","e8deaf81-fee1-4890-809d-c909fece3121"]}`

## shonkibros

- **[info] bullet_starvation** — Content starvation: 17/17 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":17,"total":17,"ratio":1}`

## strakers

- **[info] bullet_starvation** — Content starvation: 15/16 (94%) lots have neither usable bullets nor a meaningful description
  - `{"empty":15,"total":16,"ratio":0.938}`

## tcpa

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/437/auction/0/2760430_web_medium","distinct_addresses":3,"row_ids":["a21a31df-9e82-4003-84cc-e03cd7a12d2b","a2ba1663-3448-4436-9898-0c7cc3eaf346","cfffbc7f-61ff-4697-ac42-3470df9a65c8"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/191/auction/0/2741963_web_medium","distinct_addresses":3,"row_ids":["b7a718b8-34fe-494d-8640-344b73de93e2","f48debaf-2d12-49c6-a140-da67bb3fe03d","fa4f03b9-fbda-40d5-bb33-eea933daa6c4"]}`

## venmore

- **[info] bullet_starvation** — Content starvation: 21/21 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":21,"total":21,"ratio":1}`


