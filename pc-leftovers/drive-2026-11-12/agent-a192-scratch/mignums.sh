#!/bin/bash
# For every origin/wip/* branch: its migrations numbered 017, 198 or 200 (blob ids, to compare content).
cd /home/flem/x2f/.claude/worktrees/agent-a192d62c603df9941 || exit 1
git for-each-ref --format='%(refname:short)' refs/remotes/origin/wip/ | while read -r b; do
  git ls-tree "$b" apps/api/migrations/ | grep -E '/(017|198|200)_' | awk -v b="$b" '{print b, $3, $4}'
done | sort -k3 | uniq
