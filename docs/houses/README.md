# Per-house dossiers

One markdown dossier per auction house — the **slug-keyed home** for a house's full
handling story: config pointers, the *why* behind each choice, known quirks, incident
history, and a last-verified date. It complements (does not duplicate) the other layers:

- **Code** (`lib/houses.js`, `lib/scraper/house-recognisers.js`, `lib/scraper/recall-sentinels.js`,
  the recogniser fns) is the authoritative runtime config — the dossier *links to* it.
- **`house_skills`** (DB) holds runtime engine/health metrics.
- **Claude auto-memory** holds cross-cutting themes.

The dossier is the human/AI-readable per-house record none of those own. It exists so a
future session (or a teammate) can read one page instead of grepping the slug across five
files. Consult the relevant dossier **first** when touching a house.

## Lifecycle
- **Created at onboarding** — `auction-conventions` → `references/new-house-playbook.md` **Step 6.5**
  requires a dossier (+ a row here) when a new house is added.
- **Updated on every heal** — `auction-self-healing` §6 LEARN loop requires appending the
  incident (date → root cause → fix PR) to the house's dossier.

## Current dossiers

| Slug | Display name | Platform | Dossier |
|---|---|---|---|
| `btgeddisons` | BTG Eddisons | property-world / EIG widget (static HTML) | [btgeddisons.md](btgeddisons.md) |
| `charlesdarrow` | Charles Darrow | own ASP.NET site (independent) | [charlesdarrow.md](charlesdarrow.md) |
| `sdlauctions` | SDL Auctions | own WordPress site; property-world photos; EIG online mirror | [sdlauctions.md](sdlauctions.md) |
| `cliveemson` | Clive Emson | own JS-rendered SPA (Crawlee render); land-heavy | [cliveemson.md](cliveemson.md) |
| `purplebricksgoto` | Purplebricks (GOTO) | EIG OAS, static `?pagesize=5000` | [purplebricksgoto.md](purplebricksgoto.md) |
| **EIG OAS cluster** (26: `tcpa`, `firstforauctions`, `landwood`, `sageandco`, `harmanhealy`, `hmox`, `thepropertyauctionhouse`, `ahlondon`, +18) | — | EIG OAS current-auction recogniser + live-boundary static path (`?view=List`) | [eig-oas.md](eig-oas.md) |
| `humberts` | Humberts | estate agent, NOT an auction house — RETIRED + dormant; 0 lots is normal | [humberts.md](humberts.md) |
| `wrightmarshall` | Wright Marshall | estate agent; occasional lots via the iamSold platform slug — own slug never probes | [wrightmarshall.md](wrightmarshall.md) |

## Backlog
The long tail of ~170 houses don't yet have dossiers. They can be backfilled incrementally
(every heal/onboarding adds one going forward). A useful seed for the Cat-B per-auction URL
patterns is `.planning/milestones/auction-watcher/HOUSE-CLASSIFICATION.md` (a one-off 2026-04-24
registry — verify against current code before trusting it).
