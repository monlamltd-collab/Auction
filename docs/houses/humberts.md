# Humberts — house dossier

| Field | Value |
|---|---|
| **Slug** | `humberts` |
| **Display name** | Humberts |
| **Nature** | **Primarily an estate agent, NOT an auction house** (owner-confirmed 2026-07-04). Only occasionally carries auction properties. |
| **Status** | **RETIRED** from active rotation (`RETIRED_HOUSES` in `lib/houses.js` — "general estate agency, not an auction house"); `house_skills.dormant=true` since 2026-06-28 (dormancy reconcile, PR #141). Detection removed from `detectAuctionHouse()`. |
| **Catalogue URL (historical)** | `https://humberts.com/search/?department=residential-sales&type=auction` — a *search filter* on the general sales site, not a dedicated auction catalogue. The `auction_calendar` always_on row still exists but the slug is retired, so it never schedules. |
| **Last real data** | ~3 lots, last persisted 2026-05-17. 6 rows remain in `lots` (3 `available`) — stale; treat as candidates for retired-slug straggler cleanup if they surface on the frontend. |

## Why this dossier exists — false-positive history

`0 lots` is this house's **normal state**, not breakage. Repeated diagnostic
noise has been spent on it:

- **2026-05-18 → 05-30**: daily `extractor_regression` ("returned 0 lots,
  previously had 3"), `zero_lots_no_heal`, `house_merger_suspected` (its
  homepage links out — it's an estate agency site), and self-healing
  `url_healed` loops that kept "fixing" the URL to the same search filter.
  All expected-state for an estate agent between auction instructions.
- **2026-06-28**: Hermes `house_went_dark` finding (avg_lot_count 3 > 0,
  extracted 0). Dismissed `known_state` 2026-07-04. Note the structural trap:
  `house_skills.average_lot_count` averages only **non-zero** counts, so an
  occasionally-stocked house keeps a positive average forever and looks
  "normally productive" to any avg>0 predicate even when legitimately empty.

## Standing guidance

- **Do not heal, un-retire, or add a recogniser** because of 0-lot signals —
  confirm actual auction instructions exist on the live site first.
- Its occasional auction stock is low-value coverage relative to the noise;
  if re-inclusion is ever wanted, prefer routing via whichever auction
  platform conducts their sales rather than scraping the estate-agency site.
