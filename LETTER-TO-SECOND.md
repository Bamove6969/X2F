# To claude2 (bnkxfers@gmail.com) — from the lead, 2026-10-28 late evening

This replaces the 2026-10-26 letter. Read it fully, then the files listed under "Read", then start on
"Your queue".

## 1. Check which account you are (do this first)
Type `/status`. It must show **bnkxfers@gmail.com**. If it shows bamove@gmail.com, you were
started with plain `claude` and are running on the owner's account and quota. That is what happened
today, and it exhausted the owner's weekly limit and killed every lead helper. In that case stop,
tell the owner, and have them restart you from `~/x2f` with the **`claude2`** launcher (profile
`~/.claude-account2`).

Your own memory notes live in `~/.claude-account2/projects/-home-flem-x2f/memory/`. Ignore any memory
or `/resume` sessions that belong to the lead's profile (`~/.claude`).

## 2. Who's who and how we talk
- **lead** = the owner's session (bamove). Plans, assigns, reviews, merges to the main line, and is the
  owner's only point of contact.
- **you, claude2** = bnkxfers. Build and review on `wip/` branches; you never merge to the main line.
- **claude3** = totalcarerx4u, offline until 2026-10-29 7pm. Its old work (Tasks 28, 29, 8) was taken by
  the lead.
- **Channel:** files, not SendMessage (it can't cross accounts).
  - The lead writes `~/x2f-comms/to-second.log`; read the tail on start and after each item.
  - You write `~/x2f-comms/to-lead.log`: one dated line per finished item, starting `second:`, with
    branch, pushed SHA, what was done, test counts, and anything the lead must decide.
  - Format: `echo "[$(date '+%Y-%m-%d %H:%M:%S')] second: …" >> ~/x2f-comms/to-lead.log`
- **Owner's standing rule:** report to the lead only. If the owner types in your window, answer
  briefly, say the lead has it, and log what they asked in to-lead.log. Don't make status pages or
  take decisions for the owner. (Your status page on 10-28 was fine because the owner asked, but log
  such requests and point the owner at the lead's board.)

## 3. Read, in this order
1. `~/x2f/HANDOFF.md` on the main line, incl. "Decided 2026-10-27 (owner)" at the end.
2. `docs/superpowers/rulings-and-lessons.md`: rules R1–R35 are binding.
3. `docs/coordination.md`: running cross-task notes (many new sections on 10-28: Task 4, Task 8,
   Task 22 landing, Task 28/29, FIDO).
4. `~/x2f-comms/helper-common.md`: toolchain, locks, git and review rules. They apply to you and to
   any helper agents you spawn.
5. The review files named in your queue below.

## 4. State of things (main line `claude/compassionate-johnson-k95ssr` @ 5dd43e2)
- **Merged 10-28:** FU-A (login_name vs display_name; seedAccount takes `{loginName, displayName}`;
  the web uses `displayName`), FIDO key-list refresh, Plan 7 docs, **Task 22** (the trade room with
  `registerTradeScreen` slots, `liveFanOut`, `useTradeLive`, `e2e/fixtures-serve.ts`, the
  css-collisions test), and **Task 8** (attestation signs `terms`; migration 111; `ModPartyArgs`
  requires `terms: AttestedTerms`).
- **Plan 3:** 20 of 33 merged.
- **Your Task 24 round 3** (@6b60297, 05:36 today) was received. Thank you; it gets a fresh review
  from the lead's side.
- The lead's own branches are in flight: 4, 5, 23, 27, 28, 29.

## 5. Your queue, in order (push every commit; one to-lead.log line per item)
**(N) Re-review the Task 23 fix round. Read-only.** Branch `origin/wip/lead-p3-task23` @9935936.
- Inputs: the original review `~/x2f-comms/review-task23-2026-10-27.md` (yours, from 10-27) and the
  fixer's notes `docs/superpowers/reviews/2026-10-27-p3-task23.md` on that branch.
- Key change to judge: a NEW `paidRecorded: boolean` in Task 12's `EscrowStatus`/`UseEscrow`
  (`apps/web/src/escrow/runtime.ts`, `useEscrow.ts`). It means the buyer's own tap fixed the amount
  on this device, and "Marked as paid" reads it.
  - Is it set only from the device's own `markPaid`, never from the API?
  - Is it persisted across a reload?
  - Can the buyer's device co-sign for a different amount or without the tap?
- Also: "Finish marking as paid" after `amount-unknown`, the 409 `wrong-state` handling, the
  BuyerCancelling slot, and that the fixtures hooks (`window.__x2fSetFixtureEscrow`) cannot exist in
  a production build (bundle.test).
- Write the verdict to `~/x2f-comms/review-task23-round2-2026-10-28.md` (APPROVED / CHANGES
  REQUIRED, Important/Minor with file:line + failure scenario).

**(O) Re-review the Task 4 fix round. Read-only.** Branch `origin/wip/lead-p3-task4` @02bb5ba.
- Round 1: `~/x2f-comms/review-task4-2026-10-28.md`.
- Commits: d30c25e tests, 1b590d5 api, 911242c web + notes, 8013366 main merge, 02bb5ba.
- Claims to verify:
  - Caps of 3 per (side, method, currency) and 20 total, from `owner_settings` or defaults, under an
    account-row `FOR UPDATE` lock; race test of 6 posts → 3×201 / 3×409.
  - SQL sort before LIMIT, with an SQL rate that must equal `offerRate` in every pricing mode and
    rounding.
  - `liveOfferStats` counts in SQL.
  - One transaction for checks + write.
  - The narrowed terms character rule.
  - `lastSeenAt` floored to 5 min.
  - Emergency stop hides lists.
  - `stage` on `/v1/account/me`.
- Check the lock order can't deadlock against hold inserts or other account-row locks (FU-A
  login-name update, Task 30 confirm).
- Write the verdict to `~/x2f-comms/review-task4-round2-2026-10-28.md`.

Run (N) and (O) in parallel with read-only helper agents if you like; they share no files.

**(L) Task 9 I/O wiring**, `wip/second-p3-task9-io` (@1651b10): continue.
- Base on / merge the main line.
- Take mod-party payout/refund addresses ONLY from the attested terms (moderation's own
  signed_terms), never a later API read.
- Report the spend-evidence gap (your NEEDS_SPEND_EVIDENCE seam) as a decision for the lead, with
  options.

**(M) Task 20 rest (chat)**, `wip/second-p3-task20-rest` (@8566d21): continue.
- `106_chat.sql`; each chat message stores which side sent it (owner revision 2026-10-28, for
  self-delete later).
- Hook the chat panel into Task 22's room through its slots and seams (`useTradeLive`, not a second
  EventSource: a tripwire enforces `useLiveEvents(` only in App.tsx).

When the queue is empty, write one line to to-lead.log saying so and wait for to-second.log.

## 6. House rules (short)
- Main line is `claude/compassionate-johnson-k95ssr`, not `main`. Never merge or push to it.
- Branches: `wip/second-*` for your own work. When fixing a lead branch, use that branch.
- Commit as `git -c user.name=flem -c user.email=bamove@gmail.com commit`, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after every commit (R30).
- **Tests and checks:** every test or typecheck run goes under `flock ~/x2f-comms/check.lock`. The
  full check is `~/x2f-comms/run-check.sh <log>`. The machine has 3.7 GB RAM shared with the lead's
  agents.
- **Merges:** resolve conflicts by hand and typecheck. After any main-line merge, run tsc + vitest:
  renames break things without textual conflicts.
- **Tripwires** check the local tree only. No deliberately red tests.
- **Things only the owner can do:** remote branch deletes are blocked by the guard. Don't ask peers
  to do anything your session was refused.
- **Dated chores** belong to the lead (FIDO re-fetch after 11-01, fast-uri 11-02,
  serialize-javascript 11-05).
