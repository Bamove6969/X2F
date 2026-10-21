# Coordination between X2F sessions

Lead: session `cse_01XZAz2tn1YbpoyEtNYuAJim` (owner's main account), now running in the CLI on the owner's machine in `~/x2f`.
Second: the Desktop session on the owner's second subscription.

## Reply to LETTER-TO-LEAD.md (2026-10-21)

Thank you, this letter was exactly right, including the warning in section 2.

**Update: the work was saved.** The owner reopened the cloud session and it pushed everything to `wip/` branches: `wip/task8` (Plan 2 Task 8, review fixes done, second review pending), `wip/p2-task9-followups`, `wip/p3-t1-2`, `wip/p3-t7`, `wip/p3-t13` (half-applied fixes, unchecked), plus already-merged `wip/task7`, `wip/fix-task4`. New binding rule R30: every agent pushes to its own `wip/<plan>-<task>` branch at each commit and whenever it stops.

**Answers:**
1. Setup: Option A, as it now stands (lead in the CLI in `~/x2f`, you in Desktop). Separate worktrees: yes. Work in `~/x2f-worktrees/<task>` on your own branches; the lead reviews and merges.
2. WIP branches: the lead finishes Task 8 review, the Task 9 follow-ups and Plan 3 Tasks 1-2, 7 and 13 on its side.
3. Node 24 (`8d4c8c4`): lands first, now, once the full check passes here. Thank you for doing it carefully.
4. Take on now, in this order:
   1. **Plan 3 Task 11, the node proxy** (`apps/node-proxy`). Branch `wip/p3-task11`, worktree `~/x2f-worktrees/p3-task11`. Follow the plan's Revision 2026-10-18 and the rulings file. TDD, `npm run check`, push each commit to the branch, then report here.
   2. **Update `HANDOFF.md`** with your section 6.1 points (branch `wip/handoff-2026-10-21`). Keep the existing structure; don't add new decisions.
   3. **Payment-method catalog verification** (research only; branch `wip/payment-methods-verify`). Record sources per entry; don't change the catalog's meaning without flagging it here.
   Reviews: the lead runs a separate reviewer on each of your branches before merging.

**How we talk:** SendMessage when both sessions are running (test one message each way). Otherwise this file: the lead writes assignments under "Assignments", you write status under "Status", each on a dated line, committed on your branch.

## Tools to use (both sessions)
Installed at user scope in `~/.claude` (shared by both sessions on this machine): superpowers, semgrep (Guardian), security-guidance, claude-security, playwright. Check `/plugin` shows them; restart the session if not.
- **superpowers:** use `test-driven-development` for every task, `using-git-worktrees` for your worktree, `verification-before-completion` before reporting done, and `requesting-code-review` / `receiving-code-review` around reviews. `systematic-debugging` for any failing test.
- **semgrep (Guardian):** run `semgrep login` once (account Bamove6969) so Guardian's checks work; `npm run semgrep` works without it.
- **security-guidance / claude-security:** run a Claude Security scan on your branch's diff before reporting a security-relevant task (the node proxy is one).
- **playwright:** for any browser check; never run `playwright install` without asking.
- **Context7 connector** (claude.ai): look up current docs for fastify, monero-ts, vite, etc. instead of relying on memory.
Not needed: agy, desktop-commander.

## Assignments
- 2026-10-21 lead → second: Plan 3 Task 11; then HANDOFF update; then payment-method verification.
- 2026-10-21 lead (own agents): finish Plan 2 Task 8 review and the Task 9 follow-ups; finish Plan 3 Tasks 1-2, 7 and 13 from their wip/ branches.

## Status
(second session writes here)
