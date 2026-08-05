# Visual Audit — 2026-08-05

Scanned **35,917** rows in **32099ms** across **11** houses with findings.

**Findings:** 5 error · 0 warn · 8 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 15/20 (75%) lots have neither usable bullets nor a meaningful description
  - `{"empty":15,"total":20,"ratio":0.75}`

## bondwolfe

- **[info] bullet_starvation** — Content starvation: 28/39 (72%) lots have neither usable bullets nor a meaningful description
  - `{"empty":28,"total":39,"ratio":0.718}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 196/196 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":196,"total":196,"ratio":1}`

## buttersjohnbee

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/4986/listings/820092/images/9g2unkfws06q-mrg-6o4_bb3f-a4ac-6a58-a093-9e65-6385-56c4-9d3b_20260723020705.jpg","distinct_addresses":3,"row_ids":["0ceb0522-9bf4-4e30-9952-fd510649eae9","299ab914-6616-44c6-bac6-e399c47d5770","96d8759b-6a59-4855-b57e-9033393596ef"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://au-mirage.cdns.rexsoftware.com/api/v1/output/eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdGciOltbNywiXC9cL3VrLWNybS5jZG5zLnJleHNvZnR3YXJlLmNvbVwvYXBwXC9saXZlc3RvcmVcL2FjY291bnRzXC8xNzk3XC9saXN0aW5nc1wvODIxNDI5XC9pbWFnZXNcL0RKSV8yMDI2MDcyMDExNTMxNl8wX2Q3ZmUtOTlhNy1kYWUxLTk1NjMtNDFiYS01YjUwLTYxOWYtYThkNF8yMDI2MDcyMDA5MjkxNl9vcmlnaW5hbC5qcGciXSxbMTMsMjU2MCwxNDQwLDJdLFs0LCJ3ZWJwIiw5MF1dLCJpc3MiOiJkZjg2OTU0YS05YWMxLTExZWQtOTFlMi1jMzkxN2ZjM2FmOTQifQ.sTyaatP7dxVUOX2mNemRfBoEQNlkW8yuVcF6MZ7HP1w","distinct_addresses":3,"row_ids":["1899b558-6eb8-4f6b-b844-b5ca31ef18dd","82ea5db7-400f-4350-a8d6-418dbf165724","fecf1302-1b5a-4fb9-a35e-7b303b8f2df6"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/4986/listings/822973/images/-efoyrzb9km8eqgxl21r_6e53-9b99-f108-ed23-9ce4-f180-80bf-9995_20260727010718.jpg","distinct_addresses":3,"row_ids":["a55b7ff0-c5d2-43d1-a82f-e9b7499445d4","ad9d7749-0f22-49d4-b76f-f5c9c2323309","e7c3ca74-2428-4e96-bb30-3341ec00b7da"]}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 5/5 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":5,"total":5,"ratio":1}`

## foxandsons

- **[info] bullet_starvation** — Content starvation: 10/11 (91%) lots have neither usable bullets nor a meaningful description
  - `{"empty":10,"total":11,"ratio":0.909}`

## hunters

- **[info] bullet_starvation** — Content starvation: 15/17 (88%) lots have neither usable bullets nor a meaningful description
  - `{"empty":15,"total":17,"ratio":0.882}`

## maggsandallen

- **[error] hero_image_bleed** — Hero-image bleed: 5 distinct current addresses share one image_url
  - `{"image_url":"https://www.maggsandallen.co.uk/images/Maggs,aAllen_Text_Only_WhitePink.png.pagespeed.ce.I-P4uL8KUk.png","distinct_addresses":5,"row_ids":["17afc12b-730d-48b7-80a5-06befd4e2be2","631b84f4-6dfb-40fe-b2a4-6ec7ff1d66b9","a4a42ecb-9197-4e4b-8662-400dd81641df","e62e2aab-e6ec-4313-8541-801496f11b59","e8deaf81-fee1-4890-809d-c909fece3121"]}`

## shonkibros

- **[info] bullet_starvation** — Content starvation: 17/17 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":17,"total":17,"ratio":1}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (14 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":14,"examples":[{"address":"261 barlow moor road, manchester, lancashire, m21 7gj\\","auction_date":"2026-07-28","count":14}]}`

## venmore

- **[info] bullet_starvation** — Content starvation: 20/20 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":20,"total":20,"ratio":1}`


