# Loveitts (`loveitts`)

| Field | Value |
|---|---|
| **Brand** | Loveitts — Auction House Coventry & Warwickshire franchise |
| **Catalogue** | `https://www.loveitts.co.uk/auctions/` |
| **Upcoming dates** | `https://www.loveitts.co.uk/auctions/upcoming-auctions` |
| **Discovery** | `lib/pipeline/loveitts-auctions.js` (option / `data-date` HTML) |
| **Not a catalogue** | EIG live-stream embed `eigpropertyauctions.co.uk/live-stream/auction/loveitts` |

## Rules
- Multi-sale traditional house — calendar must carry **real** `YYYY-MM-DD` upcoming rows, not `2099-*`.
- `rewriteUrl` always pins scrapes to `HOUSE_ROOTS.loveitts` so stale EIG / upcoming-id calendar URLs cannot bypass the lot grid.
- Sibling AH branch `auctionhousecoventry` is a separate slug on auctionhouse.co.uk (shared franchise network, different lot URL namespace).

## Incident
- **2026-07-27:** Calendar had only `2099` upcoming + always_on EIG embed; no real future dates. Fixed root, watcher discovery, VIP cover, and calendar spine. Retired-slug `sdl` future rows cleared (coverage lives on `btgeddisons` / `sdlauctions`).
