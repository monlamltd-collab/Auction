# Visual Audit — 2026-08-17

Scanned **38,346** rows in **35313ms** across **10** houses with findings.

**Findings:** 1 error · 0 warn · 9 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 20/25 (80%) lots have neither usable bullets nor a meaningful description
  - `{"empty":20,"total":25,"ratio":0.8}`

## austingray

- **[info] bullet_starvation** — Content starvation: 25/33 (76%) lots have neither usable bullets nor a meaningful description
  - `{"empty":25,"total":33,"ratio":0.758}`

## bondwolfe

- **[info] bullet_starvation** — Content starvation: 93/103 (90%) lots have neither usable bullets nor a meaningful description
  - `{"empty":93,"total":103,"ratio":0.903}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 363/364 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":363,"total":364,"ratio":0.997}`

## edwardmellor

- **[info] bullet_starvation** — Content starvation: 29/40 (73%) lots have neither usable bullets nor a meaningful description
  - `{"empty":29,"total":40,"ratio":0.725}`

## firstforauctions

- **[info] bullet_starvation** — Content starvation: 64/64 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":64,"total":64,"ratio":1}`

## hunters

- **[info] bullet_starvation** — Content starvation: 18/20 (90%) lots have neither usable bullets nor a meaningful description
  - `{"empty":18,"total":20,"ratio":0.9}`

## sdlauctions

- **[info] bullet_starvation** — Content starvation: 261/293 (89%) lots have neither usable bullets nor a meaningful description
  - `{"empty":261,"total":293,"ratio":0.891}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (14 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":14,"examples":[{"address":"261 barlow moor road, manchester, lancashire, m21 7gj\\","auction_date":"2026-07-28","count":14}]}`

## venmore

- **[info] bullet_starvation** — Content starvation: 19/19 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":19,"total":19,"ratio":1}`


