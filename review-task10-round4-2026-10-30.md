# Review round 4: Plan 3 Task 10 (auto-refund; moderation desk): APPROVED WITH MINOR (0 Important, 2 Minor)

Branch `origin/wip/second-p3-task10` @305124b (claude2). New since 3ded6fc: 77b09d1 (6 red tests), 946a0ef (R3-N1 fix), 305124b (R3-M1/M2 docs). Builder's report: to-lead.log 07:19:43. Round 3: `review-task10-round3-2026-10-30.md`. Reviewer: read-only helper, 2026-10-30.

All tests ran in the detached worktree `~/x2f-worktrees/rv-t10r4`, one command at a time under `check.lock`. The worktree has been removed.

## Verdict: APPROVED WITH MINOR

R3-N1 is fixed. The fix is small and correct:
- `apps/moderation/src/desk.ts:328` `autoRefundPass` is now shared by both paths.
- `desk.ts:428` runs it for an armed buyer-cancel while the API is not `settling(buyer-cancel)` and nothing was escalated.

The 6 new tests fail at 77b09d1 for the intended reason and pass at 305124b. I attacked the fix four ways (below) and found no route to two payouts, no refund of a paid trade, no escalation bypass and no loop. Both Minor findings are about log noise and test coverage.

## Attacks on the fix (checked, not findings)

**1. The buyer races the re-arm (builds the cancel at the moment the desk re-arms): no double outcome.**
- The party has one `state.release` at a time. Every `settle()` and every received message is serialised on the party's `run` chain (`packages/escrow/src/party.ts:986-999`). A switch is refused once `rel.committed` is set (`:991`).
- As co-signer, the mod commits only after `checkRelease` of a tx set received under the *current* outcome's tag (`:617-629`). Release messages carry the outcome digest, so after a switch to the seller-built auto-refund, a buyer tx set tagged with the old outcome is never read.
- So exactly one of two things happens:
  - The cancel set came first. The mod commits, the re-arm `settle` is refused, and the mod itself signs and submits the buyer-built cancel (`:646-667`), which lands.
  - The switch came first. The buyer's set is ignored, and the seller-built refund proceeds.
- The mod signs at most one set. Even if two sets existed, they would spend the same multisig inputs, so at most one confirms. Both pay the same thing: `payoutsFor` in `packages/trade/src/payouts.ts:68-71` gives buyer-cancel and auto-refund the whole balance to the seller-signed address.
- When the committed cancel lands, the shadow (`refund_requested` → `settleKindFor` = auto-refund) and the API record it as an auto-refund. It is an own tx, so `sweepKindAgrees` is skipped. Only the label differs; it is harmless.
- Nonces: the mod never signed the uncommitted buyer-cancel set, so a switch with a fresh export is the existing dust-switch path.

**2. The seller abuses the new path to refund a paid trade: no.** The re-arm calls the same `autoRefundStep`:
- It needs the API in `refund_requested`. The API cannot go from paid to `refund_requested`; `request-refund` needs `secured` and `paidAt === null` (`machine.ts:540`).
- It needs `paidSeen === false` and `shadow.paidAt === null`. A `trade.paid` makes it `wait` and then escalate `refund-unverified` after 2 min. It never signs.
- I confirmed this with a scratch desk test, never committed:
  1. The buyer cancel is armed, and the buyer sends `trade.paid`.
  2. The seller requests a refund; the API shows `refund_requested` with an alert and a receipt.
  3. Over 100 min of passes the seller-built refund is never handed, the record stays `buyer-cancel`, and exactly one `refund-unverified` is reported.
- This is an improvement over round 3: before, an armed cancel plus `trade.paid` never escalated.
- The seller cannot arm a buyer-cancel either: that needs the buyer identity's signal, taken by the shadow.

**3. Does an escalation still stop everything? Yes, for the auto-refund.**
- `autoRefundPass` returns at once when `r.escalated !== null` (`desk.ts:329`), so an escalated trade is never re-armed.
- The armed buyer-cancel itself is not stopped by an escalation. That is the design decided earlier (Plan 3 revision: "not stopped by an earlier escalation"; it pays the seller). The API then moves to `disputed`, which `apiAllows` blocks (`desk.ts:443-447`).
- An already re-armed auto-refund keeps the earlier rule "a refund once armed is kept" (`blocked` is null for kinds other than buyer-cancel). That rule is unchanged. Arming happens only after every `autoRefundStep` gate passed on that pass, past the API's mark-paid window.

**4. Infinite re-arm loop: none.**
- The re-arm branch runs only while `kind === 'buyer-cancel'`. After `sign` the kind is `auto-refund`, and only the unarmed path ever arms a `buyer-cancel`. So the switch happens at most once.
- After `escalate`, `escalated` is saved and the pass never runs again.

**Residual explored: a buyer cycling honest API cancels from `refund_requested`.**
- `BUYER_CANCEL_SETTLE` includes `refund_requested` (`machine.ts:179`), and the 15-min window reverts to `settleFrom`.
- A scripted buyer can therefore keep the API in `settling(buyer-cancel)` almost all the time. `autoRefundStep` needs `refund_requested` (an API brake that is not new), so during settling nothing signs.
- This is bounded either way:
  - If the 5 s watcher pass sees the reverted state, the desk acts on that pass once the auto-refund is due: it signs, or it escalates `alert-unseen` / `alert-late`.
  - If the watcher never sees the reverted state, `settlingSince` is never reset (`packages/trade/src/watch.ts:293-300`, an episode ends only when another open state is *seen*), and `spend-unshown` escalates after 6 h.
- So it is a delay, at most about 6 h, never a strand. It is not a finding. If the lead wants it tighter, the API could refuse a second buyer-cancel from `refund_requested` (owed to the machine, not Task 10).

## Findings

### Minor

**R4-M1. A refused re-arm logs `auto-refund-signing` and `auto-refund-settle-failed` on every pass until the committed cancel lands.**
- Where: `desk.ts:308-319` (`settle`: on reject `inFlight` is cleared and `o.log` is not `logOnce`), together with `desk.ts:428-432` and the armed `auto-refund` re-hand.
- Scenario:
  1. The mod's party committed to the buyer's cancel set.
  2. The auto-refund falls due, and the desk saves `armed: auto-refund`.
  3. The party refuses the switch, `inFlight` is cleared, and the next pass (5 s) settles again.
  4. Two log lines repeat every 5 s while the mod signs and submits and until the watcher reports `settled`, normally one pass to a few blocks.
- If `signRelease` or `submit` keeps failing (daemon down), the noise lasts that long and could hide the real cause.
- The builder flagged this. Harmless for funds. Fix later: `logOnce` the refused re-arm, or keep `inFlight` set after a `bad-outcome` rejection.

**R4-M2. No test drives the committed-cancel branch of the re-arm.** `apps/moderation/test/harness.ts:146-152`. The fake party records every `settle` and never rejects, so the R3-N1 tests cover only the uncommitted switch. The committed path rests on `party.ts` logic (`:991`, and mod-side submit at `:646`) and on comments.
- Scenario: a later change to `settle` (for example, re-saving `armed` from the promise) could break the "the earlier settle keeps going" behaviour, and no test would notice.
- Suggested: give the fake party an option to reject a switch, then assert that the record stays `auto-refund`, the earlier outcome is not re-handed, and `desk-trade-over` follows once `settled` is reported.
- The paid-plus-armed case (attack 2) is also untested in the repo. My scratch test above could be added as is.

## R3-M3 landing guidance: still holds

`git merge-tree 36e728a 305124b` (the lead's local main line; origin's 5c4d35b merges clean because it is already in) gives the same four conflicts. The new commits do not touch them.
- `packages/trade/src/machine.ts` escalate: take this branch's side, which keeps `s !== 'refund_requested'`. Then run `apps/api/test/watchReports.test.ts`.
- `apps/api/src/trades/timers.ts`: there are two comment-only hunks. Keep `siteMaintenanceSince` (it is outside the hunks and present in the merged tree, used by `main.ts:5,119` and `timers.test.ts:10,132-145`).
- `NEEDS_SITE_FLAGS`:
  - `site-flags-tripwire.test.ts` is absent from the merged tree.
  - The code (`main.ts`, `timers.ts`) has no `NEEDS_SITE_FLAGS`.
  - `coordination.md:231,292` mention it only as deleted.
- `timers.test.ts`: keep one 48 h test, plus this branch's `readFileSync`/`fileURLToPath` imports.
- `machine.test.ts`: take the main line's side.

## Docs (305124b)

- R3-M1 and R3-M2 are documented in `desk.ts` (the comments above `sweepKindAgrees` and in the armed branch), in coordination.md "Fix round 3" and in the plan-3 revision bullet. They are accurate.
- The coordination note for R3-N1 matches the code.

## Test results (each run under `flock ~/x2f-comms/check.lock`)

- `tsc --noEmit`: packages/trade 0, apps/moderation 0, apps/api 0 errors (at 305124b).
- vitest `@x2f/moderation` + `@x2f/trade`: 16 files, **448/448** (+6 over round 3).
- vitest `@x2f/api` watchReports, timers, schema: 3 files, **93/93**.
- R3-N1 tests (`buyerCancel.test.ts -t R3-N1`):
  - At **77b09d1: 6 failed** for the intended reasons. The `sign` cases got only `[cancelOutcome]` where `[cancelOutcome, REFUND]` was expected. The `alert-unseen` and `alert-late` cases got 0 reports where 1 was expected.
  - At **305124b: 6 passed**.
- Scratch test (attack 2, never committed, reverted): 1 passed.
- Not run: web vitest, Playwright, regtest. The changes touch only apps/moderation and docs.
