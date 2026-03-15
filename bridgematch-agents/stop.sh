#!/bin/bash
# stop.sh — Stop all running BridgeMatch bug sweep agents
# Run from repo root: bash bridgematch-agents/stop.sh

PID_FILE="bugs/.agent-pids"

if [ ! -f "$PID_FILE" ]; then
  echo "No running agents found (no PID file at $PID_FILE)"
  exit 0
fi

echo "Stopping all agents..."

while read -r pid; do
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    echo "  Stopped PID $pid"
  else
    echo "  PID $pid already stopped"
  fi
done < "$PID_FILE"

rm -f "$PID_FILE"
echo "All agents stopped."
