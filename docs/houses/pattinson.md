# Pattinson (Pattinson Estate Agents) — house dossier

| Field | Value |
|---|---|
| **Slug** | `pattinson` |
| **Display name** | Pattinson |
| **Platform** | Pattinson's own **React SPA** (`pattinson.co.uk/auction`). Needs a **browser render** (Crawlee/Puppeteer) — a static fetch returns the empty SPA shell. |
| **Region** | North East (+ national auction lots) |
| **Catalogue URL** | `https://www.pattinson.co.uk/auction/property-search` (`HOUSE_ROOTS`), paginated (`maxPages: 84` in `HOUSE_RECOGNISERS`). |
| **Detection** | `detectAuctionHouse()` routes `pattinson.co.uk` → `pattinson`. |
| **Status** | Fixed 2026-07-08 (0 → 20+ lots/page, recogniser rewritten); **prod verify pending** (deploy + rescrape; circuit is open). |
| **Last verified** | 2026-07-08 (live render, recogniser 20/20 page 1 = 100%). |

## Lot URL pattern
`https://www.pattinson.co.uk/property/{id}` (numeric id).

## Recall sentinel
`/\/property\/(\d+)/g` (`RECALL_SENTINELS.pattinson`; `HOUSE_RECOGNISERS.pattinson.recallSentinelPattern`).

## Recogniser
`recognisePattinsonLotsFromMarkdown` (`lib/pipeline/firecrawl-extract.js`).
Matches each whole card link `[{content}](…/property/{id})` (the lazy inner stops
at the property-url close, past nested `![img](cdn)` links) and reads fields off the
content lines: price (`£N`), `{n} bed {type}`, the postcode-bearing address line,
first `…/property-images/{id}/…` photo. Covered by `tests/test-crawlee-recognition.js`
Test 4.

## Image source
Card carries a photo gallery `https://www.pattinson.co.uk/cdn-cgi/image/…/pattinson.blob.core.windows.net/paccess/property-images/{id}/….jpg`; the first is the lead, the rest fill via the multi-image sweep.

## Incidents
- **2026-06-10→13:** went dark — circuit open, `zero_lots_no_heal`, health 0, 10
  consecutive failures. Root cause: **template rebuild** of the React SPA. The old
  recogniser split on a literal `parking](…/property/{id})` anchor (it assumed every
  card's link text ended in "parking"); the rebuilt template no longer emits that,
  so the recogniser matched nothing → 0 lots even though the render succeeded (20
  `/property/{id}` links were in the markdown).
- **2026-07-08 (fix):** recogniser rewritten to match the whole card link + read
  fields off content lines (template-robust). Live render: 20/20 page 1 (100%), was
  0. Prod verify = deploy + `POST /api/admin/rescrape {pattinson}` (bypasses the open
  circuit, closes on success) → confirm `recall_diagnostic` ~100%.

## Lesson
A recogniser anchored on incidental card text (a "parking" detail label) is brittle —
anchor on the **lot-detail link** (stable) and read fields off content **lines**, not
fixed positional offsets.
