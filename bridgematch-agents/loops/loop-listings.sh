#!/bin/bash
# loop-listings.sh — Ralph Wiggum loop for Listings Agent
# Runs continuously, restarting Claude Code after each sweep

MISSION_FILE="bridgematch-agents/missions/mission-listings.md"
LOG_FILE="bugs/bugs-listings.md"
AGENT_NAME="LISTINGS"

unset CLAUDECODE
echo "[$AGENT_NAME] Starting loop at $(date)"

# Initialise bug log if it doesn't exist
if [ ! -f "$LOG_FILE" ]; then
  echo "# BridgeMatch Bug Log — Listings Agent" > "$LOG_FILE"
  echo "Started: $(date)" >> "$LOG_FILE"
  echo "" >> "$LOG_FILE"
fi

SWEEP=0

while true; do
  SWEEP=$((SWEEP + 1))
  echo ""
  echo "[$AGENT_NAME] ═══════════════════════════════════"
  echo "[$AGENT_NAME] Starting sweep #$SWEEP at $(date)"
  echo "[$AGENT_NAME] ═══════════════════════════════════"

  claude \
    --print \
    --dangerously-skip-permissions \
    --max-turns 80 \
    "$(cat $MISSION_FILE)"

  EXIT_CODE=$?
  echo ""
  echo "[$AGENT_NAME] Sweep #$SWEEP finished at $(date) (exit code: $EXIT_CODE)"
  echo "[$AGENT_NAME] Sleeping 15 seconds before next sweep..."
  sleep 15
done
