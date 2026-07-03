---
name: onboard-house
description: "Onboard a new auction house end-to-end. Usage: /onboard-house <slug> <catalogue-url>. Runs the full new-house playbook as an enforced checklist: registration in lib/houses.js, recall sentinel, live extraction probe, optional markdown recogniser, tests, the docs/houses/<slug>.md dossier, and production verification."
disable-model-invocation: true
---

# Onboard a New Auction House

You are onboarding a new auction house into the AuctionBrain pipeline. The
canonical step-by-step reference is
`.claude/skills/auction-conventions/references/new-house-playbook.md` — read
it in full before starting. This skill exists to make the playbook a
one-command, checklist-enforced workflow so no step gets skipped.

## Arguments

`/onboard-house <slug> <catalogue-url>`

- **slug** — lowercase, no spaces, no separators (`mynewhouse`, not `my-new-house`).
- **catalogue-url** — the lot-bearing page (upcoming lots listed), NOT an
  events/calendar page. If the URL given looks like a calendar or events
  index, find the lot-bearing page first (playbook "Two-tier discovery" gotcha).

If either argument is missing, ask for it before doing anything else.

## Enforced checklist

Create a TodoWrite item for every step below. Do not mark the onboarding
complete while any item is open.

1. **Pre-flight** — read `docs/houses/README.md` and check the house (or its
   platform sibling) isn't already covered under another slug (mergers are
   common — see the SDL de-conflation incident). Check View Source of the
   catalogue URL: server-rendered or SPA?
2. **Register** — `HOUSE_ROOTS`, `HOUSE_DISPLAY_NAMES`, `detectAuctionHouse()`
   in `lib/houses.js` (playbook Step 1).
3. **Recall sentinel** — `RECALL_SENTINELS[slug]` in `lib/analysis.js`, unless
   `detectPlatformSentinel()` auto-detects the platform (playbook Step 2).
4. **Probe extraction live** (playbook Step 3). Compare the extracted lot
   count against the count visible on the live page. **100% coverage is the
   standing rule** — a partial house is worse than no house. If lots are
   missing, proceed to step 5; do not ship a partial house.
5. **Recogniser if needed** — markdown recogniser in
   `lib/scraper/house-recognisers.js` + `HOUSE_OVERRIDES` (playbook Step 4a),
   or scrape override (Step 4b, rare). Add a
   `tests/test-<slug>-recogniser.js` following the existing recogniser tests.
6. **admin.html** friendly-name map (playbook Step 5).
7. **Tests** — `npm test` must stay green (playbook Step 6).
8. **Dossier** — create `docs/houses/<slug>.md` in the format of the existing
   dossiers and add a row to `docs/houses/README.md` (playbook Step 6.5).
   This step is mandatory, not optional.
9. **Commit + PR** — commit format from playbook Step 6. Never merge red CI.
10. **Verify in production** after deploy (playbook Step 7): trigger rescrape,
    check lot/image/address counts in the DB, eyeball three lots on the live
    frontend. Report the final count as "N of M available lots".

## Hard rules

- Invoke `auction-conventions` before writing any code.
- If the house turns out to be broken/anti-bot rather than new, switch to the
  `auction-self-healing` skill instead of forcing this playbook.
- Engine choice follows best-engine-first (`docs/ENGINE-ROUTER.md`); manual
  overrides go in `house_skills.engine_locked`.
