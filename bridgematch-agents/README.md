# BridgeMatch — Overnight Bug Sweep

## What This Is
5 parallel Claude Code agents running in Ralph Wiggum loops, each checking a specific layer of the BridgeMatch auction tool, plus a coordinator that consolidates findings every 30 minutes.

## Agents

| Agent | Mission File | Bug Log | Focus |
|---|---|---|---|
| Listings | mission-listings.md | bugs-listings.md | Index, search, filters, pagination, heavy refurb regression |
| Detail Pages | mission-detail.md | bugs-detail.md | Detail page rendering, data shapes, images, null handling |
| Auth & Stripe | mission-auth-stripe.md | bugs-auth-stripe.md | Gating, Coming Soon labels, Stripe flow, webhooks, secrets |
| Forms & Data | mission-forms-data.md | bugs-forms-data.md | Enquiry form, yield calc, comparables, deal stacking |
| Resilience | mission-resilience.md | bugs-resilience.md | API failure handling, mobile layout, console errors, env vars |
| **Coordinator** | mission-coordinator.md | **bugs-SUMMARY.md** | Reads all logs, consolidates every 30 min |

## How to Run

### Step 1 — Copy this folder into your repo root
```
your-repo/
  bridgematch-agents/    ← this folder
  pages/
  components/
  ...
```

### Step 2 — Make scripts executable
```bash
chmod +x bridgematch-agents/launch.sh
chmod +x bridgematch-agents/loops/*.sh
```

### Step 3 — Launch
```bash
bash bridgematch-agents/launch.sh
```

This opens tmux with 6 windows, one per agent.

### Step 4 — Detach and go to bed
```
Ctrl+B then D
```

Agents keep running overnight.

### Step 5 — Check in the morning
```bash
tmux attach -t bridgematch-bugs
```

Or just read the summary:
```bash
cat bugs/bugs-SUMMARY.md
```

## Stopping Everything
```bash
tmux kill-session -t bridgematch-bugs
```

## Notes
- Agents log bugs but do NOT make code changes
- Each sweep takes ~10-20 minutes, then restarts after 15 second pause
- Coordinator runs every 30 minutes and overwrites bugs-SUMMARY.md with latest consolidated view
- If an agent crashes, the loop restarts it automatically
- Token usage: 5 agents × ~8 sweeps/night × ~20k tokens/sweep ≈ keep an eye on API usage in the morning
