# Paul Fosh (`paulfosh`)

## Canonical source

- Live catalogue: `https://auction.paulfosh.com/search`
- Legacy alias: `https://paulfosh.eigonlineauctions.com/search` (redirects to the branded host)
- Platform: EIG Online Auction System, static list-view recogniser
- Canonical lot identity: branded-host `/lot/details/{uuid}` URL

## Verified source behaviour

Verified 2026-07-26 against the live July catalogue:

- Force `view=List`; grid cards do not expose reliable lifecycle metadata.
- The current catalogue contained 125 affirmatively-live UUID lots for the sale ending 2026-07-28.
- Every live card had a distinct address, UUID detail URL, lot number and EIG property image.
- 123/125 exposed a numeric guide price. A missing source guide is retained as missing.
- 119/125 exposed a useful short card descriptor. Full descriptions live on detail pages and are filled by `narrative-sweep`; missing text must not be fabricated.

## Theme-specific card ordering

Paul Fosh emits each card in this order:

1. empty detail-page anchor;
2. gallery images linked to that UUID;
3. `Lot N - Auction starts ...` metadata;
4. address, price and summary;
5. `View / Bid` link.

The gallery therefore precedes the metadata but follows the card's first anchor. The shared EIG recogniser must prefer a photo found in the current forward card block and only use its backward window as a fallback for other EIG themes. Looking backward first shifts each lot onto its predecessor's image.

## Identity history and reconciliation rule

Production accumulated four representations of the same current property during the host and ID migration:

- current host + UUID;
- legacy host + UUID;
- current host + old numeric ID;
- legacy host + old numeric ID.

Canonicalisation pins both approved hosts to `auction.paulfosh.com`; UUID identities are authoritative for the current source. Never merge or retire on address alone. Alias retirement is allowed only after a fresh complete scrape proves the full current UUID cohort, and must:

- target exact row IDs;
- require the expected canonical cohort count and freshness in the same transaction;
- preserve rows by setting `status='withdrawn'` rather than deleting;
- write `lot_status_changed` events;
- leave genuinely historical sold/unsold rows untouched;
- be followed by Auction Heal.
