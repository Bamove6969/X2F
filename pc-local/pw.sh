#!/usr/bin/env bash
# Run ONE Playwright spec from the apps/web of the CURRENT worktree, holding the shared lock.
# Usage: cd <worktree>/apps/web && bash pw.sh e2e/<spec>.spec.ts [extra playwright args]
set -u
[ -f e2e/playwright.config.ts ] || { echo "run from <worktree>/apps/web" >&2; exit 2; }
SPEC="${1:?usage: pw.sh e2e/<spec>.spec.ts}"; shift
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
exec flock "$HOME/x2f-comms/pw.lock" npx playwright test -c e2e/playwright.config.ts --workers=1 "$SPEC" "$@"
