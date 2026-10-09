#!/bin/bash
# ============================================================
#  Cloud SessionStart hook
#
#  Makes a fresh Claude Code cloud session ready to run
#  `npm test` straight away. It only installs when node_modules
#  is missing, so a resumed session costs nothing.
#
#  - Cloud only (CLAUDE_CODE_REMOTE=true). Local sessions are
#    left alone.
#  - Never downloads browsers: Chromium is preinstalled at
#    /opt/pw-browsers, which PLAYWRIGHT_BROWSERS_PATH points to.
# ============================================================
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if [ -d node_modules/@playwright/test ]; then
  echo "session-start: node_modules already there, skipping npm ci"
  exit 0
fi

echo "session-start: installing dev dependencies (npm ci)"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund --prefer-offline
