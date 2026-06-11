#!/bin/bash
set -euo pipefail

# SessionStart hook for Claude Code on the web.
# - Installs project dependencies so tests + linters work in remote sessions.
# - Installs the Railway CLI so the agent can interrogate / manage the Railway
#   service. Auth is via the RAILWAY_TOKEN secret configured in the web
#   environment settings; the CLI reads it automatically at use time, so this
#   hook only needs to make the binary available.
#
# Idempotent and non-interactive. Web-only (skips local runs).

# Only run inside Claude Code on the web (remote) containers.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Project dependencies (npm install, not ci, to benefit from container caching).
npm install --no-audit --no-fund

# Railway CLI — install once; skip if already present (cached container reuse).
if ! command -v railway >/dev/null 2>&1; then
  npm install -g @railway/cli
fi

echo "session-start: deps installed; railway CLI $(command -v railway >/dev/null 2>&1 && railway --version 2>/dev/null || echo 'NOT installed')"
