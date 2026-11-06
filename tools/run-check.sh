#!/usr/bin/env bash
# Full project check, one at a time machine-wide (rulings R32/R34).
# Usage: ~/x2f-comms/run-check.sh <log file>   (run from the worktree to check)
# Targeted test runs use the other lock:  flock ~/x2f-comms/check.lock npm test -- --project <ws> ...
set -u
LOG="${1:?usage: run-check.sh <log file>}"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
# A shell opened before the docker group was added needs sg; newer shells do not.
if docker info >/dev/null 2>&1; then RUN="npm run check"; else RUN="sg docker -c 'npm run check'"; fi
echo "[$(date '+%F %T')] queued full check in $PWD (git $(git rev-parse --short HEAD 2>/dev/null))" >> "$LOG"
flock "$HOME/x2f-comms/full.lock" bash -c "echo \"[\$(date '+%F %T')] started\" >> '$LOG'; $RUN >> '$LOG' 2>&1; echo \"[\$(date '+%F %T')] exit=\$?\" >> '$LOG'"
tail -1 "$LOG"
