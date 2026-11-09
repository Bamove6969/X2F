#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
SEMGREP="$HOME/.local/semgrep-venv/bin/semgrep"
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  NVM_BIN="$HOME/.nvm/versions/node/v$(tr -d '[:space:]' < .nvmrc)/bin"
  [ -x "$NVM_BIN/node" ] && export PATH="$NVM_BIN:$PATH"
fi
NODE_V="$(node --version 2>/dev/null || echo none)"
case "$NODE_V" in
  v24.*) ;;
  *) echo "check: need Node 24.x, found $NODE_V (nvm install/use per .nvmrc; see docs/dev-setup.md)" >&2; exit 1 ;;
esac
[ -x "$SEMGREP" ] || { echo "check: missing $SEMGREP (see docs/dev-setup.md)" >&2; exit 1; }
npm run typecheck
npm run copy-lint
# Plan 3 Task 8: the API and web never reach moderation secrets; moderation never listens.
npm run separation-check
npm test
# semgrep runs before the audit: under set -e a dirty audit must not skip it.
npm run semgrep
npm run audit
