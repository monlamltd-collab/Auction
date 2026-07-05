# fidlertaylor — Fidler Taylor (Matlock / Derbyshire)

**Status:** kept, dormant-ish — **NOT retired** (Simon's decision, 2026-07-05).
**Last verified:** 2026-07-05

## Simon's call (2026-07-05, house-removal decision queue)

> "Same thing as Aldreds. They may occasionally have auctions but they don't have
> anything at the moment. A fairly minor second string to their bow versus their
> normal estate agency."

Removal proposal **rejected**; no further investigation needed (this supersedes the
earlier "time-boxed check" work item). Do not re-propose retirement unless something
materially changes (standing rule `only-simon-approves-house-removal`).

## Config pointers

- `HOUSE_ROOTS`: `https://www.fidler-taylor.co.uk/property-auctions` — page is live
  (200, path preserved; Hermes's homepage-redirect claim was wrong) but shows stale
  "Summer property Auction 2025" marketing copy. 0 lots ever captured.
- **Deliberately left registered and unblocked** (unlike `aldreds`, whose URL is a
  broken redirect loop): the URL works, so the pipeline keeps watching and will catch
  an occasional catalogue if one appears. That is the right posture for an
  occasional auctioneer.
