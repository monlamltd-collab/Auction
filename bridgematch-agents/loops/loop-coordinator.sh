#!/bin/bash
# loop-coordinator.sh — Coordinator agent, runs every 30 minutes
# Reads all bug logs and writes consolidated priority-ranked summary

MISSION_FILE="bridgematch-agents/missions/mission-coordinator.md"
LOG_FILE="bugs/bugs-SUMMARY.md"
AGENT_NAME="COORDINATOR"
INTERVAL=1800  # 30 minutes

unset CLAUDECODE
echo "[$AGENT_NAME] Starting coordinator loop at $(date)"
echo "[$AGENT_NAME] Will consolidate bug reports every 30 minutes"

SWEEP=0

while true; do
  echo "[$AGENT_NAME] Waiting ${INTERVAL}s before next consolidation..."
  sleep $INTERVAL

  SWEEP=$((SWEEP + 1))
  echo ""
  echo "[$AGENT_NAME] ═══════════════════════════════════"
  echo "[$AGENT_NAME] Consolidation sweep #$SWEEP at $(date)"
  echo "[$AGENT_NAME] ═══════════════════════════════════"

  claude \
    --print \
    --dangerously-skip-permissions \
    --max-turns 40 \
    "$(cat $MISSION_FILE)"

  EXIT_CODE=$?
  echo "[$AGENT_NAME] Consolidation #$SWEEP finished at $(date) (exit code: $EXIT_CODE)"
done
