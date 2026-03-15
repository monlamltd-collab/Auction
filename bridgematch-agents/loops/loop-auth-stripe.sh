#!/bin/bash
# loop-auth-stripe.sh — Ralph Wiggum loop for Auth & Stripe Agent

MISSION_FILE="bridgematch-agents/missions/mission-auth-stripe.md"
LOG_FILE="bugs/bugs-auth-stripe.md"
AGENT_NAME="AUTH-STRIPE"

unset CLAUDECODE
echo "[$AGENT_NAME] Starting loop at $(date)"

if [ ! -f "$LOG_FILE" ]; then
  echo "# BridgeMatch Bug Log — Auth & Stripe Agent" > "$LOG_FILE"
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
  echo "[$AGENT_NAME] Sweep #$SWEEP finished at $(date) (exit code: $EXIT_CODE)"
  echo "[$AGENT_NAME] Sleeping 15 seconds before next sweep..."
  sleep 15
done
