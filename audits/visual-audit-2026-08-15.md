# Visual Audit — 2026-08-15

Scanned **38,219** rows in **25272ms** across **12** houses with findings.

**Findings:** 2 error · 1 warn · 10 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 20/26 (77%) lots have neither usable bullets nor a meaningful description
  - `{"empty":20,"total":26,"ratio":0.769}`

## austingray

- **[info] bullet_starvation** — Content starvation: 27/36 (75%) lots have neither usable bullets nor a meaningful description
  - `{"empty":27,"total":36,"ratio":0.75}`

## bondwolfe

- **[info] bullet_starvation** — Content starvation: 77/86 (90%) lots have neither usable bullets nor a meaningful description
  - `{"empty":77,"total":86,"ratio":0.895}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 390/391 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":390,"total":391,"ratio":0.997}`

## edwardmellor

- **[info] bullet_starvation** — Content starvation: 29/40 (73%) lots have neither usable bullets nor a meaningful description
  - `{"empty":29,"total":40,"ratio":0.725}`

## firstforauctions

- **[info] bullet_starvation** — Content starvation: 63/63 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":63,"total":63,"ratio":1}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 5/5 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":5,"total":5,"ratio":1}`

## hunters

- **[info] bullet_starvation** — Content starvation: 18/20 (90%) lots have neither usable bullets nor a meaningful description
  - `{"empty":18,"total":20,"ratio":0.9}`

## sarahmains

- **[warn] identical_price_wall** — Identical-price wall: 3/5 (60%) lots share price £90000 — extractor likely picking up hero/banner price
  - `{"price":90000,"count":3,"total":5,"ratio":0.6}`

## sdlauctions

- **[info] bullet_starvation** — Content starvation: 261/293 (89%) lots have neither usable bullets nor a meaningful description
  - `{"empty":261,"total":293,"ratio":0.891}`

## tcpa

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/537/auction/0/2807505_web_medium","distinct_addresses":3,"row_ids":["0d068366-915a-40b5-8e95-f102ee60962a","962985bb-8d05-4497-81b1-3b7913c37fb3","cd7d168b-8f66-43af-a074-aa8aeed076c7"]}`
- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (14 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":14,"examples":[{"address":"261 barlow moor road, manchester, lancashire, m21 7gj\\","auction_date":"2026-07-28","count":14}]}`

## venmore

- **[info] bullet_starvation** — Content starvation: 19/19 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":19,"total":19,"ratio":1}`


