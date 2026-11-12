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
- 2026-10-21 lead → second: Plan 3 Task 11; HANDOFF update; payment-method verification.
- 2026-10-21 lead → second (owner's request: use as many agents as make sense): run all three IN PARALLEL with subagents, not one after another:
  - 1 builder agent for Task 11 (node proxy) in its own worktree, then 1 separate reviewer agent on its branch before reporting.
  - 1 agent for the HANDOFF update.
  - 4-6 research agents for the payment-method catalog, split by region (e.g. North America; Europe; Latin America; Asia-Pacific; Africa and Middle East; global apps and gift cards), each writing to its own file under research/payment-methods/ on the same branch-per-agent rule, then 1 agent to merge their results into one report.
  - Keep about 6-8 agents running at most at once (the usage limit is the real ceiling); every agent pushes per R30.
- 2026-10-21 lead (own agents): finish Plan 2 Task 8 review and the Task 9 follow-ups; finish Plan 3 Tasks 1-2, 7 and 13 from their wip/ branches.

## Status
- 2026-10-21 08:50 second: all three assignments started in parallel, 8 agents (worktrees under ~/x2f-worktrees):
  - Task 11 node proxy: 1 builder on `wip/p3-task11`; a separate reviewer runs on that branch once it's built.
  - HANDOFF update: 1 agent on `wip/handoff-2026-10-21` (edits HANDOFF.md only; no new decisions).
  - Payment methods: 6 research agents, one branch each (`wip/pm-verify-{north-america,europe-west,europe-north-east,latam-africa-me,asia-pacific,global}`), writing `research/payment-methods/<region>.md`; then 1 merge agent → `wip/payment-methods-verify`. Research only: `data/payment-methods.json` is not edited; proposed changes are flagged here.
  - Messaging check: SendMessage can't see your session (each account keeps its session list in its own config folder), so this file is our channel. I watch `origin/claude/compassionate-johnson-k95ssr:docs/coordination.md` for your updates; I post status on branch `wip/second-status` (this section only).
- 2026-10-21 09:00 second: **HANDOFF update ready for review:** `wip/handoff-2026-10-21` (5be2656, HANDOFF.md only, +44/-15). No new decisions; every addition cites spec section or conversation timestamp. Mismatches found for you to decide (not changed):
  - Extra XMR after "I've paid" / above offer max → back to seller: you added these two limits yourself on 10-20 11:04; the owner never explicitly confirmed them.
  - Staff 12-hour max session: only in Plan 2 and the conversation, not in spec 6.6.
  - Owner YubiKey fw ≥5.7 and the staff brands: only in HANDOFF and the conversation; spec 6.6 just says "two hardware security keys".
  - Spec 10 (Phases) still says "Mainnet with trade limits", conflicting with spec 2.3 (no limits for new accounts).
  - Spec 6.1 says "five-step" setup but lists steps 0–6; the roadmap still shows Plan 1 "Written, awaiting owner review".
  - Also fixed one stale line: trade-flow step 3 "10-minute funding window" → 30 minutes (spec 2.2).
- 2026-10-21 second: Task 9 follow-ups review (opus) → **CHANGES REQUIRED**: (b) enrolFinish unthrottled (probe: 40 wrong codes all 401, then 200). Fixer started on wip/p2-task9-followups; re-review after. Other notes for later tasks: (Minor 2) Plan 2 text still says assertHoldPassed and doesn't tell Tasks 10/12 that GET /me, /methods, /sessions, /alerts need allowRecovery+allowHeld — I'll put that in the Task 10/12 builder briefs; (Minor 3) wip/merge-task8 imports assertHoldPassed in webauthn.ts:26 and pgp.ts:31 → merge will fail to compile; drop the import, keep its 24h hold test on /v1/account/webauthn/start; (Minor 5) enrolment starts insert rows until purge — acceptable.
- 2026-10-21 second: **Plan 3 Tasks 1–2 second review (opus) → CHANGES REQUIRED** (wip/p3-t1-2 @bdfffed; check green: 767 tests, audit 0, semgrep 0). Not fixed by me — your list said "if APPROVED, merge", and I-C needs a plan interface change. Waiting for you:
  - **I-A** growth uses 0-conf coins and never shrinks (machine.ts:252, 275-291): a dropped/double-spent extra leaves the trade grown and un-releasable; a seller could do it on purpose. Fix: grow only when `releasable` (10 conf), or recompute from `grown.fromAtomic` each chain event; test growth then balance drop.
  - **I-B** `SETTLED_FROM` (machine.ts:138) lacks `funding` and `securing`, both reachable via buyer-cancel → settling → tick: refund lands, trade stuck in `securing` / ends `lapsed` with no txHash (loses 90-day dispute-after-refund). Fix: add both + tests.
  - **I-C** `mark-paid` not bound to the total the buyer confirmed (machine.ts:86, 405-421): growth one minute before the tap records a bigger fiat amount; seller can time it. Fix: `mark-paid { fiatCents }` refused on mismatch — needs a plan interface edit for Tasks 6 and 23.
  - Minor: M1 `lapsedAt` not shifted by pause; M2 no growth in refund_requested/settling/disputed (reviewer agrees with it; owner's rule says "before I've paid" — record or ask owner); M3 two surviving mutants (alertOpen condition machine.ts:319; sellerFundsAtomic check payouts.ts:177); M4 1-piconero dust output after seller-poster growth costs more fee than it's worth (owner question); M5 `settleFrom` left set.
  - Note for P3 Task 9: chain watcher must classify release vs refund from tx outputs, not `t.settling`.
