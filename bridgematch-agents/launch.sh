#!/bin/bash
# launch.sh — Master launcher for BridgeMatch overnight bug sweep
# Run this from your repo root: bash bridgematch-agents/launch.sh
#
# Requirements:
#   - Git Bash on Windows (no tmux needed)
#   - claude CLI installed and authenticated
#   - Run from the root of the monlamltd-collab/Auction repo

set -e

AGENTS_DIR="$(dirname "$0")"
REPO_ROOT="$(pwd)"
PID_FILE="bugs/.agent-pids"

# Check dependencies
if ! command -v claude &> /dev/null; then
  echo "claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
  exit 1
fi

# Create bugs directory if it doesn't exist
mkdir -p bugs

# Kill any existing agents from a previous run
if [ -f "$PID_FILE" ]; then
  echo "Stopping previous agents..."
  while read -r pid; do
    kill "$pid" 2>/dev/null || true
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

echo ""
echo "Launching BridgeMatch overnight bug sweep..."
echo ""

# Launch each agent as a background process with logging
declare -a AGENTS=("listings" "detail" "auth-stripe" "forms-data" "resilience" "coordinator")

for agent in "${AGENTS[@]}"; do
  echo "Starting $agent agent..."
  bash "$AGENTS_DIR/loops/loop-${agent}.sh" >> "bugs/loop-${agent}.log" 2>&1 &
  echo $! >> "$PID_FILE"
  echo "  PID: $! -> bugs/loop-${agent}.log"
done

echo ""
echo "All 6 agents launched as background processes."
echo ""
echo "Bug reports will appear in:"
echo "  bugs/bugs-listings.md"
echo "  bugs/bugs-detail.md"
echo "  bugs/bugs-auth-stripe.md"
echo "  bugs/bugs-forms-data.md"
echo "  bugs/bugs-resilience.md"
echo "  bugs/bugs-SUMMARY.md  <- coordinator writes here every 30 min"
echo ""
echo "Monitor logs:"
echo "  tail -f bugs/loop-listings.log"
echo "  tail -f bugs/loop-detail.log"
echo "  tail -f bugs/loop-coordinator.log"
echo "  (or any loop-*.log file)"
echo ""
echo "Monitor all agents at once:"
echo "  tail -f bugs/loop-*.log"
echo ""
echo "Stop all agents:"
echo "  bash bridgematch-agents/stop.sh"
echo ""
