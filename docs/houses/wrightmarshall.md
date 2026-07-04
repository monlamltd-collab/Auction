# Wright Marshall — house dossier

| Field | Value |
|---|---|
| **Slug** | `wrightmarshall` |
| **Display name** | Wright Marshall |
| **Nature** | **Primarily an estate agent** (owner-confirmed 2026-07-04). Only occasionally carries auction properties, and those are sold via the **iamSold** partner platform (modern method of auction). |
| **Status** | Active in `HOUSE_ROOTS` (`lib/houses.js`) but **effectively platform-routed**: its configured URL `https://www.iamsold.co.uk/estate-agent/wrightmarshall/` is on `iamsold.co.uk`, and `detectAuctionHouse()` maps ANY iamsold URL to the `iamsold` slug (`lib/houses.js` — the platform check precedes per-agent domains). So the calendar row schedules and scrapes under `iamsold`, and the `wrightmarshall` slug itself never probes. Compare `davidjames` ("iamSold partner — lots route via iamsold.co.uk") and `driversnorris` (same shape). |
| **Last own-slug data** | 7 `available` lots, last persisted 2026-05-15 — stale (auction_date `2099-12-31` sentinel keeps them "live" indefinitely). |

## Why this dossier exists — structural false positives

Because the slug is active-but-never-probed, TWO monitors re-fire for it
daily until the config is reconciled:

- **Hermes `house_went_dark`** — avg_lot_count 8 > 0, `last_probe_at` frozen
  at 2026-05-18 → fires every deterministic-rules run (8 occurrences by
  2026-07-04). Dismissed `known_state` 2026-07-04, but it will re-insert
  while the slug stays in this half-state.
- **`house_unscheduled` queue guardrail** (PR #154) — the calendar row's URL
  resolves to slug `iamsold`, so `wrightmarshall` is absent from the
  assembled queue every pass. The guardrail is working as designed; the slug
  state is what's anomalous.

Earlier noise (May–June 2026): `house_merger_suspected` /
`house_url_drift_detected` / `url_healed` loops — all artefacts of pointing a
per-agent slug at a platform domain. 54 alerts bulk-resolved 2026-07-04.

## Open decision (proposed 2026-07-04, awaiting owner)

Retire the `wrightmarshall` slug (add to `RETIRED_HOUSES`, delete/reattribute
its 7 stale lot rows, retire its calendar row) and let its occasional auction
lots flow through the `iamsold` platform slug like other iamSold partners —
**provided** iamsold's `/available-properties/` catalogue lists partner-agent
lots (verify against the live page before deleting anything). Until then the
daily `house_went_dark` + `house_unscheduled` noise for this slug should be
read as known-state.

## Standing guidance

- **Do not add a recogniser or "fix" the URL** — 0-extracted under this slug
  is structural, not a scraper break.
- Any real Wright Marshall auction lot should appear via the `iamsold`
  scrape; check there before believing coverage is lost.
