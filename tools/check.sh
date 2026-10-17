#!/bin/sh
set -e
npm run typecheck
npm test
npm run audit
npm run semgrep
