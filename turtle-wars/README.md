# Turtle Wars — Vertical Slice

The first milestone from the build brief (§8): **one Turf Beach, one rival gang,
one full tide cycle, hero lens only.** Premium 2D top-down mobile game — rival
turtle gangs fighting over the nesting beaches of a drowning prehistoric world.
'80s neon over Polynesian craft.

Everything later in the brief (Hatch Runs, the squad, the command lens,
campaign, bosses, customisation, predators) is deliberately **not here yet** —
the point of this slice is to prove the tide window is fun before building
outward (§0, §9).

## Run it

1. Install [Godot 4.3+](https://godotengine.org/download) (any edition, no C# needed).
2. Open `turtle-wars/project.godot` in the editor (Import → select the file).
3. Press **Play** (F5).

No other setup. The project is pure GDScript with procedural art; the only
assets are seven tiny placeholder synth wavs (regenerate with
`python3 tools/generate_sfx.py`).

## How to play

The tide pulls out, the beach opens up, and The Breakers swim in from the deep.
**Claim 60% of the dry turf and hold it for 3 seconds before high tide.**

| Input | Desktop | Touch |
|---|---|---|
| Move | WASD / arrows | drag on the left half of the screen (virtual stick) |
| Shell-charge | Space / Enter | CHARGE button, bottom-right |
| Restart | R | tap anywhere after the round ends |

- Walking over turf claims it; a **shell-charge** carves a wider stripe and
  knocks out (stuns) any rival it hits.
- The **rising water is the deadline** — drowned turf is gone, the beach
  funnels everyone together, and if you haven't secured before high tide, the
  sea took the turf. The rival gang can also secure 60% and beat you to it.
- The water never harms a turtle (§4a) — you actually swim **faster** than you
  walk. Land is where the war is.

## Acceptance criteria → where they live

| §8 criterion | Implementation |
|---|---|
| Move + shell-charge, top-down | `scripts/turtle.gd`, `scripts/player_turtle.gd` |
| Claimable objective (turf tiles) | `scripts/turf_grid.gd` |
| One rival gang actively contesting | `scripts/rival_turtle.gd` (3 Breakers; claim, steal, charge) |
| Tide recedes then rises, ends level (~88 s window) | `scripts/tide.gd` (5 s recede + 3 s slack + 80 s rise) |
| Clear win/lose, turtle never drowns | `scripts/main.gd` (`_win`, `_lose`, `_on_high_tide`) |
| Instant restart | R / tap → `reload_current_scene()` |
| Juice | charge screen-shake (`game_camera.gd`), claim pop + blip (`turf_grid.gd`, `sfx.gd`), rising heartbeat + urgent countdown, buzzer-beater slow-mo (`main.gd`) |

## Feel-tuning knobs

The brief's step 2 is a feel-tuning pass — the dials are all constants:

- `scripts/main.gd` — `SECURE_SHARE`, `SECURE_HOLD`, `RIVAL_COUNT`, buzzer slow-mo.
- `scripts/tide.gd` — `recede_time`, `slack_time`, `rise_time`, ease curve.
- `scripts/turtle.gd` — speeds, charge time/cooldown/claim-width, knockback, stun.
- `scripts/turf_grid.gd` — grid size, claim-pop timing.

## Choices made where the brief was open (flagged for review, per §0)

1. **Win rule** — "turf tiles to colour" with a secure-hold: 60% of *currently
   dry* turf held for 3 s. The hold stops flicker-wins and creates a readable
   "SECURING…" tension beat; measuring against dry turf makes the shrinking
   beach itself change the maths (the final sliver is a genuine scramble).
2. **Rival gang** — The Breakers (loggerheads), three turtles, slightly slower
   than you but three of them. They claim nearest turf, steal yours, and
   charge you when lined up. They can win.
3. **Symmetric loss** — the rival gang securing 60% ends the round early as a
   loss. The brief only demands the high-tide timeout; this felt truer to
   "actively contesting" and is one constant to remove if it plays badly.
4. **Swim boost** — turtles move 1.35× in water. Coherent with §4a (water is
   never the enemy of a turtle, only of turf) and makes flanking through the
   shallows a real move.
5. **Buzzer-beater slow-mo** — triggers only if you're mid-secure inside the
   last ~1.2 s. The near-miss moment from §6, tuned conservatively.
6. **Placeholder presentation** — procedural neon art (sunset sun, palms,
   wavy foam line) and generated synth stings stand in for the real art/audio
   pass (§9 step 10).

## Structure

```
turtle-wars/
├── project.godot          # Godot 4.3+, mobile-friendly (gl_compatibility)
├── scenes/main.tscn       # one node; the level is built in code
├── scripts/
│   ├── boot.gd            # autoload: input map registered in code
│   ├── sfx.gd             # autoload: sound board
│   ├── main.gd            # game state, win/lose, juice orchestration, backdrop
│   ├── tide.gd            # THE core: waterline clock + neon foam rendering
│   ├── turf_grid.gd       # claimable turf, flooding, claim-pop
│   ├── turtle.gd          # shared body: move, charge, stun, procedural drawing
│   ├── player_turtle.gd   # hero lens input
│   ├── rival_turtle.gd    # Breaker AI
│   ├── game_camera.gd     # screen shake
│   └── hud.gd             # bars, countdown, overlays, touch controls
├── assets/sfx/*.wav       # generated placeholders
└── tools/generate_sfx.py  # regenerates them (stdlib only, deterministic)
```
