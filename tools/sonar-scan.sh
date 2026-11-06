#!/usr/bin/env bash
# Run a local SonarQube scan of an X2F worktree. Nothing leaves this PC:
# the scanner container sits only on the internal docker network
# "sonar-internal" (no internet route) and talks to the local "sonarqube"
# container. The worktree is mounted read-only; scanner scratch goes to a
# tmpfs inside the container, so the repo is never modified.
#
# Usage: sonar-scan.sh [WORKTREE_PATH] [PROJECT_KEY]
#   WORKTREE_PATH defaults to ~/x2f, PROJECT_KEY defaults to x2f.
# Server: http://127.0.0.1:9000 (start: docker start sonarqube)
set -euo pipefail

SRC="$(realpath "${1:-$HOME/x2f}")"
PROJECT_KEY="${2:-x2f}"
SECRETS="$HOME/x2f-comms/secrets/sonarqube-local.txt"
SCANNER_IMAGE="sonarsource/sonar-scanner-cli:11.4.0.2044_7.2.0"
NETWORK="sonar-internal"

[ -d "$SRC" ] || { echo "No such directory: $SRC" >&2; exit 1; }
[ -r "$SECRETS" ] || { echo "Missing secrets file: $SECRETS" >&2; exit 1; }

SONAR_TOKEN="$(sed -n 's/^SONAR_TOKEN=//p' "$SECRETS")"
[ -n "$SONAR_TOKEN" ] || { echo "SONAR_TOKEN not found in $SECRETS" >&2; exit 1; }
export SONAR_TOKEN

if ! docker ps --format '{{.Names}}' | grep -qx sonarqube; then
  echo "SonarQube container is not running. Start it: docker start sonarqube" >&2
  exit 1
fi
if ! curl -sf http://127.0.0.1:9000/api/system/status | grep -q '"status":"UP"'; then
  echo "SonarQube is not UP yet (check: curl -s http://127.0.0.1:9000/api/system/status)" >&2
  exit 1
fi

# Git blame: mount the worktree at its own absolute path; for a linked
# worktree (.git is a file) also mount the main repo's .git read-only.
MOUNTS=(-v "$SRC:$SRC:ro")
if [ -f "$SRC/.git" ]; then
  COMMON="$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)"
  MOUNTS+=(-v "$COMMON:$COMMON:ro")
fi

REV="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git -C "$SRC" branch --show-current 2>/dev/null || echo unknown)"

EXCLUSIONS='**/node_modules/**,**/dist/**,**/dist-fixtures/**,**/dist-fixtures-*/**,**/coverage/**,**/fixtures/**,**/test/fixtures/**,**/*.dc.html,**/test-results/**,**/playwright-report/**,**/.scratch/**,**/.claude/**,**/.regtest/**,**/*.png'
TESTS='**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/*.spec.tsx,**/test/**,**/e2e/**'

echo "Scanning $SRC ($BRANCH @ $REV) as project '$PROJECT_KEY'..."
docker run --rm \
  --network "$NETWORK" \
  --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,exec,size=3g \
  -e SONAR_TOKEN \
  -e SONAR_HOST_URL=http://sonarqube:9000 \
  -e SONAR_USER_HOME=/tmp/sonar-home \
  -w "$SRC" \
  "${MOUNTS[@]}" \
  "$SCANNER_IMAGE" \
  -Dsonar.projectKey="$PROJECT_KEY" \
  -Dsonar.projectName="$PROJECT_KEY" \
  -Dsonar.projectVersion="$REV" \
  -Dsonar.projectBaseDir="$SRC" \
  -Dsonar.working.directory=/tmp/scannerwork \
  -Dsonar.sources=. \
  -Dsonar.exclusions="$EXCLUSIONS,$TESTS" \
  -Dsonar.tests=. \
  -Dsonar.test.inclusions="$TESTS" \
  -Dsonar.test.exclusions='**/node_modules/**,**/fixtures/**' \
  -Dsonar.scm.provider=git \
  -Dsonar.sourceEncoding=UTF-8 \
  -Dsonar.qualitygate.wait=true \
  -Dsonar.qualitygate.timeout=600 \
  "${@:3}" || { rc=$?; echo "Scanner exit $rc (non-zero also means the quality gate failed)." >&2; }

echo "Done. Results: http://127.0.0.1:9000/dashboard?id=$PROJECT_KEY"
