# Visual Audit — 2026-08-16

Scanned **38,324** rows in **28918ms** across **11** houses with findings.

**Findings:** 1 error · 0 warn · 10 info

## 247propertyauctions

- **[info] bullet_starvation** — Content starvation: 20/26 (77%) lots have neither usable bullets nor a meaningful description
  - `{"empty":20,"total":26,"ratio":0.769}`

## austingray

- **[info] bullet_starvation** — Content starvation: 26/35 (74%) lots have neither usable bullets nor a meaningful description
  - `{"empty":26,"total":35,"ratio":0.743}`

## bondwolfe

- **[info] bullet_starvation** — Content starvation: 89/103 (86%) lots have neither usable bullets nor a meaningful description
  - `{"empty":89,"total":103,"ratio":0.864}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 371/372 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":371,"total":372,"ratio":0.997}`

## edwardmellor

- **[info] bullet_starvation** — Content starvation: 29/40 (73%) lots have neither usable bullets nor a meaningful description
  - `{"empty":29,"total":40,"ratio":0.725}`

## firstforauctions

- **[info] bullet_starvation** — Content starvation: 64/64 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":64,"total":64,"ratio":1}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 5/5 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":5,"total":5,"ratio":1}`

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


