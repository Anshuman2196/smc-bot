#!/usr/bin/env bash
set -u
AGENT=/workspaces/smc/smc_agent.py
LOG=/tmp/smc-agent.log
SUP=/tmp/smc-supervisor.log
mkdir -p /run/playit
echo "[$(date -u)] supervisor started" >> "$SUP"
while true; do
  if ! pgrep -f "^python3 $AGENT$" >/dev/null 2>&1; then
    echo "[$(date -u)] starting agent" >> "$SUP"
    python3 "$AGENT" >> "$LOG" 2>&1 &
    echo "[$(date -u)] agent pid $!" >> "$SUP"
  fi
  sleep 5
done
