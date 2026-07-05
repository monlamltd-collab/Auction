# aldreds — Aldreds (Great Yarmouth / Norfolk)

**Status:** kept, dormant — **NOT retired** (Simon's decision, 2026-07-05).
**Last verified:** 2026-07-05

## Simon's call (2026-07-05, house-removal decision queue)

> "Aldreds doesn't have anything currently but they might occasionally. Very occasional
> auction house — they're more an estate agent."

Removal proposal **rejected**; the slug stays registered but dormant. Do not re-propose
retirement unless something materially changes (standing rule
`only-simon-approves-house-removal`).

## Config pointers

- `lib/houses.js` `rewriteUrl()`: **blocked since 2026-05-30** — the configured
  `/auction/` URL is a genuine infinite redirect loop.
- `HOUSE_ROOTS`: entry retained (`https://www.aldreds.co.uk/auction/`) but unreachable
  behind the block. 0 lots ever captured.
- Their `/auctions` page (2026-07-05 probe): "please call us" referral copy — no lots,
  prices, or dates.

## Revisit trigger

If Aldreds ever publishes a real catalogue (lots + guide prices + auction dates):
un-block in `rewriteUrl()`, point `HOUSE_ROOTS` at the catalogue page, and scrape.
Until then it costs nothing and stays out of Hermes's proposals (decision recorded in
`house_removal_candidates`).
