# To the third session (claude3, totalcarerx4u@gmail.com) — from the lead, 2026-10-26

The owner's machine was reinstalled (fresh WSL Debian 13, 3.7 GB RAM, 8 cores). Everything local is gone: `~/x2f-comms`, `~/x2f-worktrees`, nvm, Docker, Semgrep, and every session's memory. Everything pushed to GitHub survived. Treat this letter and the repo as your whole context.

## Read first, in this order
1. `HANDOFF.md` on the main line.
2. `docs/superpowers/rulings-and-lessons.md` — rules R1–R34 are binding. R30: push your `wip/` branch at every commit and whenever you stop.
3. `docs/coordination.md`, plus the extra notes on your own branches (some carry additions to that file not on the main line yet).

**Main line is `claude/compassionate-johnson-k95ssr`**, not `main` (`main` stopped 2026-10-15).

## Your branches (prefix `wip/t3-`), none merged yet
| Branch | Last commit | Ahead |
|---|---|---|
| `wip/t3-p3-task8` / `wip/t3-p3-task8-b` | 10-24 08:53 / 10-25 10:25 — moderation service; `-b` has the review I1 fix | 6 / 12 |
| `wip/t3-p3-task15` / `wip/t3-p3-task15-wsl` | 10-21 / 10-25 06:19 — parity harness; `-wsl` has the re-review fixes | 2 / 11 |
| `wip/t3-p3-task16` | 10-25 16:02 — sell browse | 21 |
| `wip/t3-p3-task17` | 10-25 16:03 — buy browse (WIP: failing tests first) | 22 |
| `wip/t3-p3-task28` | 10-25 15:44 — getting started units | 23 |
| `wip/t3-p3-task29` | 10-24 14:05 — your wallets | 11 |
| `wip/t3-p3-task30` | 10-24 14:11 — log in, confirm, security settings | 5 |

## First assignment: status, not new work
Do not start new tasks yet. For each branch above, report in `~/x2f-comms/to-lead.log` (one dated line each; this file is the channel, since SendMessage cannot see across accounts):
- Is the task finished, and did a reviewer APPROVE it? Name the commit if so. Which of each `/-b` or `/-wsl` pair is the live one?
- What is still open (review findings not yet fixed, tests not yet green)?
- Does it still merge cleanly onto the main line (`git merge-tree` or a trial merge in a worktree)?
Then wait for my assignments in `~/x2f-comms/to-third.log`.

## Machine setup (already done by the lead)
- Node 24.22.1 via nvm (`~/.nvm`); `tools/check.sh` finds it on its own. Repo deps installed in `~/x2f`.
- Docker 26.1 running (systemd). Your terminal was opened after the owner joined the `docker` group, so plain `docker` should work; if not, prefix with `sg docker -c '...'`.
- Semgrep 1.178.0 at `~/.local/semgrep-venv`. Chromium at `/usr/bin/chromium` (`X2F_CHROMIUM_PATH`).
- Worktrees: `git -C ~/x2f worktree add ~/x2f-worktrees/<task> <branch>` then `npm ci` there (`npx -y npm@11.21.0 ci`). Create `~/x2f-worktrees` if missing.
- Full checks: `~/x2f-comms/run-check.sh <log>` (queues on `full.lock`, R32). Targeted tests: `flock ~/x2f-comms/check.lock npm test -- --project <ws>` (R34).
- Commits: `git -c user.name="flem" -c user.email="bamove@gmail.com" commit`. No global identity is set.

## Dated chores the lead owns (do not do them)
fastify 5.12.7 bump on 2026-10-27 (R31); FIDO metadata refresh before 2026-11-01; fast-uri override 2026-11-02 and serialize-javascript 7.1.3 on 2026-11-05 (R33).

## Reporting (owner's rule, 2026-10-27)
Report to the lead only, in `~/x2f-comms/to-lead.log`. Never bring status, findings or requests to the owner directly; if the owner types in your window, answer briefly, say the lead has it, and log it. Decisions reach you from the lead.
