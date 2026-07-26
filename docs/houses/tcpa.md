# Town & Country Property Auctions (`tcpa`)

## Catalogue contract

- Canonical national catalogue: `https://www.townandcountrypropertyauctions.co.uk/search?pagesize=500`
- The unparameterised `/search` response defaults to 50 cards and is not a complete source.
- Regional TCPA/EIG URLs can contain valid detail-page identities, but catalogue scrapes are rewritten to the national wide-list URL.
- Lot identity is the source UUID in `/lot/details/<uuid>`, not address alone.

Verified 2026-07-26: the default catalogue yielded 50 identities; `pagesize=500` yielded 354 affirmatively live UUID identities.

## Shared-site lodge inventory

TCPA listed a campaign of separately sold physical lodges at the source-provided site address:

`261 Barlow Moor Road, Manchester, Lancashire, M21 7GJ`

This is a genuine shared-site address, not fallback-address corruption or duplicate rows. The campaign contained many distinct UUID detail URLs, mostly distinct hero images, differing prices/bedrooms, and source detail-page lodge/model names.

Rules:

1. Preserve every UUID lot as a separate identity.
2. Never merge, withdraw, or delete these rows on address equality alone.
3. Preserve the common postal address; do not invent individual postal addresses.
4. Prefer displaying the source-backed lodge/model name as a unit label when detail-page extraction supplies it.
5. The visual audit's duplicate-address heuristic may exempt this exact address only for the `tcpa` house. Do not apply a generic shared-address exemption to other houses; that would hide venue/parser leakage.
6. Auction Heal remains diagnostic-only (`autoFix=false`); this exemption does not authorise production row mutation.
