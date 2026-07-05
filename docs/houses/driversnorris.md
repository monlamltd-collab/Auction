# driversnorris — Drivers & Norris (Holloway / North London, via iamsold)

**Status:** kept — **NOT retired** (Simon's decision, 2026-07-05). Known coverage gap.
**Last verified:** 2026-07-05

## Simon's call (2026-07-05, house-removal decision queue)

> "The iamsold website doesn't seem to be working. Whether that means they've got no
> lots at the moment or not, I'm not sure. But it's a modern method of auction — very
> popular normally, so I'm surprised there's no lots on it. But I think we'll have to
> just accept that."

Removal proposal **rejected**. Keep and watch.

## Config pointers / known issues

- `HOUSE_ROOTS`: `https://www.iamsold.co.uk/estate-agent/drivers/` — branded iamsold
  (modern-method) microsite; loads with a working search but shows 0 results to every
  probe (agents and Simon alike, 2026-07-05).
- **Orphan config:** 8 lots in the DB (stale since 2026-03-29) but **no `house_skills`
  row** (flagged by the 2026-07-03 Supabase naming audit).

## Open work item

Restore/repair the house's config (`house_skills` row + render handling for the
iamsold microsite) and watch a full auction cycle. If it still shows 0 lots after
that, bring it back to Simon as a retirement candidate — not before.
