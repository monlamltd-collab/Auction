# Visual Audit — 2026-07-27

Scanned **34,505** rows in **30099ms** across **21** houses with findings.

**Findings:** 7 error · 2 warn · 18 info

## auctionhousekent

- **[info] bullet_starvation** — Content starvation: 6/8 (75%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":8,"ratio":0.75}`

## auctionhouselondon

- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3474/2782873_web_medium","distinct_addresses":3,"row_ids":["04df0b16-052f-4bec-a9b7-27ca50fe5cd5","1464c3a5-5a33-413c-b83f-ebab6076705a","e595de8e-a809-4cc8-9888-0c30967d9991"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3474/2774643_web_medium","distinct_addresses":3,"row_ids":["164da7b3-0922-4a20-b45c-c47b9cfa07ff","63314431-1cb3-4a15-8e8c-bf6b2145e651","faa5b740-1227-48ce-afd1-0c011c0adab5"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3474/2775512_web_medium","distinct_addresses":3,"row_ids":["1b5eaa9e-9e33-45c0-b885-a7bee0d719c5","8bffc999-7b98-4933-a288-b84b477dec3a","cc16745e-007f-42d2-a3ca-40197a35e877"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3474/2724565_web_medium","distinct_addresses":3,"row_ids":["2338ce3c-c66e-41b3-8a1a-f7b3b907cf9b","3ebdb1c0-423b-4db1-bc8f-ed2d15733258","57d02b85-cfc0-4c23-a97c-9ca495aa48b9"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3474/2782213_web_medium","distinct_addresses":3,"row_ids":["6c8aa5ae-7c28-41a8-bb5b-f7e0cd03a4ff","a0d6bf39-c0b4-4f5b-96ac-ed9574868e46","dfe325bb-a5af-4133-aaa0-648ef111f85d"]}`
- **[error] hero_image_bleed** — Hero-image bleed: 3 distinct current addresses share one image_url
  - `{"image_url":"https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3474/2771889_web_medium","distinct_addresses":3,"row_ids":["7b191fe3-d884-410c-ae05-111b3647295b","842f1d0f-981d-400c-910f-6095f65a834d","ed04ffce-0396-4493-9f84-b3d5c74ddbb1"]}`

## bagshaws

- **[info] bullet_starvation** — Content starvation: 22/22 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":22,"total":22,"ratio":1}`

## brownco

- **[info] bullet_starvation** — Content starvation: 10/10 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":10,"total":10,"ratio":1}`

## edwardmellor

- **[info] bullet_starvation** — Content starvation: 35/35 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":35,"total":35,"ratio":1}`

## firstforauctions

- **[info] bullet_starvation** — Content starvation: 59/59 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":59,"total":59,"ratio":1}`

## fishergerman

- **[info] bullet_starvation** — Content starvation: 8/8 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":8,"total":8,"ratio":1}`

## foxandsons

- **[info] bullet_starvation** — Content starvation: 20/21 (95%) lots have neither usable bullets nor a meaningful description
  - `{"empty":20,"total":21,"ratio":0.952}`

## hunters

- **[info] bullet_starvation** — Content starvation: 18/21 (86%) lots have neither usable bullets nor a meaningful description
  - `{"empty":18,"total":21,"ratio":0.857}`

## iamsold

- **[warn] image_coverage_low** — Image coverage low: 5/9 (56%) lots missing image_url
  - `{"missing":5,"total":9,"ratio":0.556}`

## johnfrancis

- **[error] duplicate_address_wall** — Duplicate-address wall: 1 visible address/sale pairs appear ≥3 times each (3 rows users can see) — stale re-list rows, URL variants, or venue extraction
  - `{"unique_dupes":1,"total_dupe_rows":3,"examples":[{"address":"nanternis, new quay, ceredigion, sa45","auction_date":null,"count":3}]}`

## landwood

- **[info] bullet_starvation** — Content starvation: 40/40 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":40,"total":40,"ratio":1}`

## loveitts

- **[warn] image_coverage_low** — Image coverage low: 5/6 (83%) lots missing image_url
  - `{"missing":5,"total":6,"ratio":0.833}`
- **[info] bullet_starvation** — Content starvation: 6/6 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":6,"total":6,"ratio":1}`

## sarahmains

- **[info] bullet_starvation** — Content starvation: 5/6 (83%) lots have neither usable bullets nor a meaningful description
  - `{"empty":5,"total":6,"ratio":0.833}`

## sharpesauctions

- **[info] bullet_starvation** — Content starvation: 31/31 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":31,"total":31,"ratio":1}`

## shonkibros

- **[info] bullet_starvation** — Content starvation: 18/18 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":18,"total":18,"ratio":1}`

## suttonkersh

- **[info] bullet_starvation** — Content starvation: 21/21 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":21,"total":21,"ratio":1}`

## symondsandsampson

- **[info] bullet_starvation** — Content starvation: 31/31 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":31,"total":31,"ratio":1}`

## venmore

- **[info] bullet_starvation** — Content starvation: 14/14 (100%) lots have neither usable bullets nor a meaningful description
  - `{"empty":14,"total":14,"ratio":1}`

## williamhbrownnorwich

- **[info] bullet_starvation** — Content starvation: 18/19 (95%) lots have neither usable bullets nor a meaningful description
  - `{"empty":18,"total":19,"ratio":0.947}`

## wilsons

- **[info] bullet_starvation** — Content starvation: 19/24 (79%) lots have neither usable bullets nor a meaningful description
  - `{"empty":19,"total":24,"ratio":0.792}`


