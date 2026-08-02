# Visual Audit — 2026-08-02

Scanned **35,426** rows in **33671ms** across **14** houses with findings.

**Findings:** 8 error · 2 warn · 7 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 16/21 (76%) lots have neither usable bullets nor a meaningful description
  - `{"empty":16,"total":21,"ratio":0.762}`

## agentsproperty

- **[error] hero_image_bleed** — Hero-image bleed: 4 distinct current addresses share one image_url
  - `{"image_url":"https://www.agentspropertyauction.com/wp-content/themes/apa/img/nava.png","distinct_addresses":4,"row_ids":["4b7da2dd-d7c9-4ce5-84f2-1e210e7fb3da","789cd42e-4914-42cb-abaa-982327cce570","9b8bb102-c438-4a29-8cb4-83b57d33131d","b3b62134-9868-491b-af00-ed29a4790715"]}`

## auctionhouseessex

- **[info] bullet_starvation** — Content starvation: 5/6 (83%) lots have neither usable bullets nor a meaningful description
  - `{"empty":5,"total":6,"ratio":0.833}`

## auctionhousekent

- **[info] bullet_starvation** — Content starvation: 6/8 (75%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":8,"ratio":0.75}`

## bradleyhall

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/299/auction/0/2317916_web_medium?v=10/14/2025 8:11:38 AM","distinct_addresses":3,"row_ids":["016d6d22-b3e8-4bbb-93a8-9a0b4a486a10","2f5378d8-6e23-4a8b-8209-61316931eef9","984cf484-a5b8-4d51-b4ff-c0cdf207caae"]}`

## buttersjohnbee

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/4986/listings/820092/images/9g2unkfws06q-mrg-6o4_bb3f-a4ac-6a58-a093-9e65-6385-56c4-9d3b_20260723020705.jpg","distinct_addresses":3,"row_ids":["0ceb0522-9bf4-4e30-9952-fd510649eae9","299ab914-6616-44c6-bac6-e399c47d5770","96d8759b-6a59-4855-b57e-9033393596ef"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://au-mirage.cdns.rexsoftware.com/api/v1/output/eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdGciOltbNywiXC9cL3VrLWNybS5jZG5zLnJleHNvZnR3YXJlLmNvbVwvYXBwXC9saXZlc3RvcmVcL2FjY291bnRzXC8xNzk3XC9saXN0aW5nc1wvODIxNDI5XC9pbWFnZXNcL0RKSV8yMDI2MDcyMDExNTMxNl8wX2Q3ZmUtOTlhNy1kYWUxLTk1NjMtNDFiYS01YjUwLTYxOWYtYThkNF8yMDI2MDcyMDA5MjkxNl9vcmlnaW5hbC5qcGciXSxbMTMsMjU2MCwxNDQwLDJdLFs0LCJ3ZWJwIiw5MF1dLCJpc3MiOiJkZjg2OTU0YS05YWMxLTExZWQtOTFlMi1jMzkxN2ZjM2FmOTQifQ.sTyaatP7dxVUOX2mNemRfBoEQNlkW8yuVcF6MZ7HP1w","distinct_addresses":3,"row_ids":["1899b558-6eb8-4f6b-b844-b5ca31ef18dd","82ea5db7-400f-4350-a8d6-418dbf165724","fecf1302-1b5a-4fb9-a35e-7b303b8f2df6"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/4986/listings/822973/images/-efoyrzb9km8eqgxl21r_6e53-9b99-f108-ed23-9ce4-f180-80bf-9995_20260727010718.jpg","distinct_addresses":3,"row_ids":["a55b7ff0-c5d2-43d1-a82f-e9b7499445d4","ad9d7749-0f22-49d4-b76f-f5c9c2323309","e7c3ca74-2428-4e96-bb30-3341ec00b7da"]}`

## cliveemson

- **[warn] image_coverage_low** — Image coverage low: 30/31 (97%) lots missing image_url
  - `{"missing":30,"total":31,"ratio":0.968}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 6/6 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":6,"ratio":1}`

## henrysykes

- **[warn] guide_tba_wall** — Guide-TBA wall: 5/7 (71%) lots have no price + no price_text
  - `{"tba":5,"total":7,"ratio":0.714}`

## hunters

- **[info] bullet_starvation** — Content starvation: 15/17 (88%) lots have neither usable bullets nor a meaningful description
  - `{"empty":15,"total":17,"ratio":0.882}`

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

## venmore

- **[info] bullet_starvation** — Content starvation: 21/21 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":21,"total":21,"ratio":1}`


