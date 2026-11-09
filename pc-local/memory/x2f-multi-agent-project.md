---
name: x2f-multi-agent-project
description: "x2f (P2P Monero-for-fiat escrow marketplace) — where state lives, account roles, main-line branch, status as of 2026-10-26"
metadata:
  node_type: memory
  type: project
  originSessionId: 476e1095-fd6c-47c7-9ca5-5166af75dcd8
  modified: 2026-10-26T18:03:18.365Z
---

Repo github.com/bamove6969/x2f, cloned at /home/flem/x2f. **Main line is `claude/compassionate-johnson-k95ssr`**, not `main` (main stopped 2026-10-15). Start every session by reading its `HANDOFF.md`, `docs/coordination.md` and `docs/superpowers/rulings-and-lessons.md` (binding rules R1–R34), plus the "+" notes in coordination.md on the newest `wip/*` branches.

Roles: lead = bamove@gmail.com (this CLI; plans, reviews, merges). Second (claude2) = bnkxfers@gmail.com. Third (claude3) = totalcarerx4u@gmail.com (owner checked settings 2026-10-27). Branch prefixes: `wip/lead-*`, `wip/second-*`, `wip/t3-*`. Rule R30: every agent pushes its wip branch at each commit. claude2 (second) hit its weekly usage limit on 2026-10-26 ("out for days"); the lead covers its four wip/second-* branches meanwhile.

**Why:** On 2026-10-26 the machine was fresh (new WSL Debian 13, 3.7 GB RAM): ~/x2f-comms (the local lead/second/third message logs, run-check.sh, locks), worktrees, nvm/Node 24.22.1, Docker and Semgrep were all gone. Everything durable is in git.
**How to apply:** Rebuild the toolchain per docs/dev-setup.md before running checks. As of 2026-10-27 early: Plan 3 Tasks 1-3, 6, 7, 9, 11, 13-17, 26, 30 merged, plus Task 20's pure parts; fastify 5.12.7 bump done (R31 ended). claude2 is back (reviewing lead branches FU-A, 19, 22, 18). claude3 queue: 28 final → 29 fixes → 8-b. A git-object corruption on 2026-10-27 (after the usage cutoff) was repaired from origin; backups in ~/x2f-comms/git-corrupt-objects-2026-10-27. Lead fixer on Task 12 (wip/lead-p3-task12-fixes). Lead branches order: fua → fud → 19 → 22 → 18 → 21 → 23 → 24 → 25 → 27, reviews in flight. Review records live in docs/superpowers/reviews/2026-10-26-p3-task*.md; the canvas runtime for board refs is ~/x2f-comms/support.js (= the Design type's artifact-type/dc-runtime.js). Dated chores: fastify 5.12.7 bump on 2026-10-27 (R31), fast-uri override 2026-11-02 and serialize-javascript 7.1.3 on 2026-11-05 (R33), FIDO metadata refresh before 2026-11-01.
Related: [[op-cli-wsl-setup]]

**START HERE after any reset: read `~/x2f-comms/LEAD-HANDOFF-2026-11-07.md`** (then the dated ones before it) (rewritten 2026-10-28 late; current state, in-flight work in order, owner decisions, lessons). Main line 5dd43e2 had 20/33 Plan 3 tasks merged.

Launchers: `lead`/plain `claude` = owner profile ~/.claude; `claude2` = ~/.claude-account2 (bnkxfers); `claude3` = ~/.claude-account3 (totalcarerx4u). On 2026-10-28 claude2 was started with plain `claude`, shared the owner's quota and exhausted the owner's weekly limit. If a worker's reports look like they share this profile, have the owner check `/status` in its window.
