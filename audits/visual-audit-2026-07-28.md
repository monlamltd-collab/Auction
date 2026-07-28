# Visual Audit — 2026-07-28

Scanned **34,678** rows in **29703ms** across **23** houses with findings.

**Findings:** 5 error · 3 warn · 17 info

## agentsproperty

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://www.agentspropertyauction.com/wp-content/themes/apa/img/nava.png","distinct_addresses":3,"row_ids":["789cd42e-4914-42cb-abaa-982327cce570","9b8bb102-c438-4a29-8cb4-83b57d33131d","bf41b01d-e263-4e22-a4c9-51ce0bc8d835"]}`

## bagshaws

- **[info] bullet_starvation** — Content starvation: 22/22 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":22,"total":22,"ratio":1}`

## brownco

- **[info] bullet_starvation** — Content starvation: 14/14 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":14,"total":14,"ratio":1}`

## btgeddisons

- **[info] bullet_starvation** — Content starvation: 382/384 (99%) lots have neither usable bullets nor a meaningful description
  - `{"empty":382,"total":384,"ratio":0.995}`

## cliveemson

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (4 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":4,"examples":[{"address":"dover, kent","auction_date":null,"count":4}]}`
- **[warn] image_coverage_low** — Image coverage low: 17/17 (100%) lots missing image_url
  - `{"missing":17,"total":17,"ratio":1}`

## edwardmellor

- **[info] bullet_starvation** — Content starvation: 39/39 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":39,"total":39,"ratio":1}`

## firstforauctions

- **[info] bullet_starvation** — Content starvation: 58/58 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":58,"total":58,"ratio":1}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 8/8 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":8,"total":8,"ratio":1}`

## foxandsons

- **[info] bullet_starvation** — Content starvation: 20/21 (95%) lots have neither usable bullets nor a meaningful description
  - `{"empty":20,"total":21,"ratio":0.952}`

## hunters

- **[info] bullet_starvation** — Content starvation: 17/20 (85%) lots have neither usable bullets nor a meaningful description
  - `{"empty":17,"total":20,"ratio":0.85}`

## iamsold

- **[warn] image_coverage_low** — Image coverage low: 5/9 (56%) lots missing image_url
  - `{"missing":5,"total":9,"ratio":0.556}`

## johnfrancis

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"nanternis, new quay, ceredigion, sa45","auction_date":null,"count":3}]}`

## loveitts

- **[warn] image_coverage_low** — Image coverage low: 5/6 (83%) lots missing image_url
  - `{"missing":5,"total":6,"ratio":0.833}`
- **[info] bullet_starvation** — Content starvation: 6/6 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":6,"ratio":1}`

## propertysolvers

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"westbeach, westward ho, bideford, devon, ex39 1lq","auction_date":null,"count":3}]}`

## sarahmains

- **[info] bullet_starvation** — Content starvation: 6/6 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":6,"ratio":1}`

## sharpesauctions

- **[info] bullet_starvation** — Content starvation: 32/32 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":32,"total":32,"ratio":1}`

## shonkibros

- **[info] bullet_starvation** — Content starvation: 18/18 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":18,"total":18,"ratio":1}`

## suttonkersh

- **[info] bullet_starvation** — Content starvation: 24/24 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":24,"total":24,"ratio":1}`

## symondsandsampson

- **[info] bullet_starvation** — Content starvation: 34/34 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":34,"total":34,"ratio":1}`

## tcpa

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (77 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":77,"examples":[{"address":"261 barlow moor road, manchester, lancashire, m21 7gj\\","auction_date":"2026-07-28","count":77}]}`

## venmore

- **[info] bullet_starvation** — Content starvation: 14/14 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":14,"total":14,"ratio":1}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Content starvation: 18/19 (95%) lots have neither usable bullets nor a meaningful description
  - `{"empty":18,"total":19,"ratio":0.947}`

## wilsons

- **[info] bullet_starvation** — Content starvation: 20/24 (83%) lots have neither usable bullets nor a meaningful description
  - `{"empty":20,"total":24,"ratio":0.833}`


