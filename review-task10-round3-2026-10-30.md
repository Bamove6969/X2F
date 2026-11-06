# Review round 3: Plan 3 Task 10 (auto-refund, signed terms, signals; moderation service + API): CHANGES REQUIRED (1 Important, 3 Minor)

Branch `origin/wip/second-p3-task10` @3ded6fc (claude2). The round-2 fixes are in 481da0e (N1), ccefdab, 08d12dc and 5cf25b7 (N2, N4, shadow veto, docs). Merges: task9-io 7346fc0 (0aea711) and main line 5c4d35b (3ded6fc). Reviewer: read-only helper, 2026-10-30. Earlier rounds: `review-task10-2026-10-29.md`, `review-task10-round2-2026-10-30.md`. Builder's report: to-lead.log 07:04:00.

All tests ran in the detached worktree `~/x2f-worktrees/rv-t10r3` (3ded6fc, `npm ci`), one command at a time under `check.lock`. The worktree has been removed.

## Verdict: CHANGES REQUIRED (1 Important, 3 Minor)

Every round-2 item is fixed and tested: N1, N2, N4, the N3/NTP deploy notes, the shadow veto and the deploy-order note. The builder's file:line claims are accurate.

The new Important (R3-N1) existed before this round but was not reported in earlier rounds. A buyer can permanently switch off the seller's auto-refund at zero cost: they send a `trade.cancel` signal, then never build the cancel tx. Once the API is in `refund_requested`, the seller has no dispute route and no automatic escalation, so the coins sit in escrow until someone notices by hand. I confirmed this with a scratch desk test, never committed. The fix is small, because the buyer-cancel and auto-refund payouts are identical.

## Round-2 items

**N1: fixed.** `autoRefund.ts:112` compares the receipt with `Math.min(shadow alert, API alert) + ALERT_LATE_MS`, and `:105` keeps `max` for the wait. Both orderings are tested (`autoRefund.test.ts`: mod down 30 min → `alert-late`; normal order at +2 min 5 s → `alert-late`, at +2 min → `sign`).

Adversarial check: a seller who backdates or postdates its signal, or a lying API alert, can only move `min` earlier (more escalations) or `max` later (a later sign). Neither can make the refund come sooner.

**N2: fixed as asked, with a residual (R3-M1).** The armed branch at `desk.ts:373-390` now blocks the buyer-cancel with `buyer-cancel-buyer-paid` when `paidSeen` is set, and with `buyer-cancel-api-state` when the API state fails `apiAllows`. It resumes once the API allows the cancel again. Both paths are tested, including a late surplus, a restart, `paid`, `settling(release)`, `disputed`, and back.

Race on `trade.paid` arriving mid-pass: frames and steps are serialised on one `run` chain (`desk.ts` `run`), so a `trade.paid` cannot interleave with a step. It is seen on the next pass. The one gap is an outcome already handed to the party (R3-M1).

**N3 + NTP: done.** `docs/coordination.md` Task 10 "Fix round 2" has NTP/chrony on both hosts, with an alert on offset. It also says in-flight trades are "delayed, not lost, and only with N1 in". The early refund-request is held in `pending` and re-applied. A refund-request signal that never arrives ends in the 60-min `refund-unverified` escalation. The plan-3 revision bullet matches.

**N4: done.** A 409 is logged `escalate-wrong-state` and stays final. Tested both ways (409 vs 201).

**Shadow veto (sweepKindAgrees, `desk.ts:103-117`; watcher `watcher.ts:371-376`): correct and fail-safe.**
- An own tx (one the mod co-signed) bypasses the kind check (`spendEvidence`'s `own`). So the mod's own auto-refund or buyer-cancel is never vetoed, even when the API's kind has changed under it (for example a `settleBy` revert to `refund_requested`, which names `auto-refund`).
- The veto therefore only touches import-only sweeps. After R3-I1, those already need both parties' sealed spend.info.
- `NO_DESK_FACTS` applies when a desk can't be opened. `ensureDesk` runs before the check.
- Bypass: there is none for the three refund kinds. `release` vs `mutual-cancel` is recorded as OWED in the plan, coordination.md and Task 9 R2-M1. That is accepted.
- An honest sweep can be wrongly vetoed only in the corner case in R3-M2. The cost is an escalation to a person, never a lost or wrong payout.

**Deploy order (API first): recorded** in coordination.md.

## New findings

### Important

**R3-N1. An armed buyer-cancel switches off the auto-refund and its escalations for good, so a buyer can strand the seller's coins at no cost.**

Where: `apps/moderation/src/desk.ts:373-390` (the armed branch never runs `autoRefundStep`), `:401` (the buyer-cancel is checked first and arms), the `ROUTE` `buyer-cancel` builder = buyer, and `packages/trade/src/machine.ts:420` (`onDispute` has no `refund_requested` case).

Failure scenario, reproduced with a scratch desk test on the real harness:
1. The trade is secured. The buyer's client sends a signed `trade.cancel` **signal only** to the mod and posts nothing to the API, so the API stays `secured`.
2. The shadow takes it and sets `cancelSeen`. `apiAllows('secured')` is true, so the desk arms `buyer-cancel` and hands the party `{builder: buyer, cosigner: mod}`.
3. The buyer never builds the tx. The shadow's settling window reverts it to `secured`.
4. `payBy` passes. The seller requests a refund, which takes the API and the shadow to `refund_requested`, and the API's alert fires. The buyer's device even reports a receipt at once.
5. Probe result: 24 h after the window, `settles` still holds only the buyer-built cancel and there are **no reports** (no `alert-unseen` or `alert-late`). The logs show only `buyer-cancel-signing`. The seller cannot build the refund: it is neither builder nor co-signer of the armed outcome.
6. The seller also cannot dispute, because `onDispute` refuses `refund_requested` (wrong-state). The API has no timer for `refund_requested`.

So the escrow is stuck indefinitely with no alert to anyone. The same happens with an honest API cancel that the buyer leaves to time out (`settling` → `settleBy` → back, then a refund request).

Fix: the payouts are identical (`payoutsFor`: buyer-cancel and auto-refund both pay the whole balance to the seller's signed address).
- In the armed branch, when `kind === 'buyer-cancel'`, the API is not `settling(buyer-cancel)`, and `r.escalated === null`, also run `autoRefundStep`.
- On `sign`, re-arm as `auto-refund` and `settle` the seller-built outcome. The party replaces an uncommitted earlier outcome, and if the mod already committed to the cancel, that tx is its own and will land.
- On `escalate`, report as usual.

Alternatively, at minimum, escalate an armed buyer-cancel that has had no sweep for N hours while the API is not `settling(buyer-cancel)`. `sweepKindAgrees` needs no change for the re-arm: the armed kind then becomes `auto-refund`, and a landed buyer-cancel tx is an own tx.

Tests to add:
- signal-only cancel → never built → refund requested → auto-refund signed (or escalated).
- API cancel → `settleBy` revert → refund requested → same.

### Minor

**R3-M1. An outcome already handed to the party is not withdrawn when an armed buyer-cancel becomes blocked.** `desk.ts:378-385`.

The recheck stops re-sends after a restart or a payout change, but `party.settle` keeps the earlier outcome live (`party.ts` `settleOutcome`; `inFlight` is not cleared). So within one process the mod still co-signs the buyer-built cancel if the buyer's tx set arrives after a `trade.paid` was opened.

Impact is low. Only the buyer can build that tx, and it pays the seller, so the buyer can only hurt themselves (for example an old client after the API reverted the cancel and the buyer then paid). There is no `PartyHandle` withdraw today.

Fix: document this in the N2 comment and in coordination.md. Alternatively add a withdraw, or re-settle a no-op outcome, in a later task.

**R3-M2. The `lapse-refund` veto can wrongly veto an honest lapse.** `desk.ts:111-112`; `machine.ts:469` (the shadow's `fundBy` counts from the mod's own `setup-done`) and `:381`.

The shadow's `fundBy` is later than the API's by the mod's pass and ready delay, or by a mod outage. Funds that land in that gap leave the API `lapsed` but move the shadow to `securing`/`secured`, and the shadow never lapses. The seller and buyer then sign the lapse refund. That is an import-only sweep, both parties name it, and it is vetoed for good (`sweep-kind-vetoed`), so the 6 h `spend-unshown` escalation sends an honest refund to a person.

Fail-safe, rare, no money at risk. Note it in coordination.md next to "a real lapse is delayed, not lost", or accept `lapse-refund` when the shadow's chain facts show the funding arrived after the API's `fundBy`.

**R3-M3. The landing onto the main line (task9-io 23592e9 + 36e728a) is a real conflict, and one wrong pick would silently disable every Task 10 escalation.** `git merge-tree 36e728a 3ded6fc`: conflicts in `packages/trade/src/machine.ts`, `packages/trade/test/machine.test.ts`, `apps/api/src/trades/timers.ts` and `apps/api/test/timers.test.ts`.
- `machine.ts` escalate: take **this branch's** side, which keeps `s !== 'refund_requested'`. With the main line's side, every `alert-unseen`/`alert-late`/`refund-unverified` gets 409 `wrong-state`. N4 then counts that as final (`escalate-wrong-state`): auto-refund is off for good and nobody is alerted. `apps/api/test/watchReports.test.ts:243` catches it, so run that file after the merge.
- `timers.ts`: comment-only hunks. Keep this branch's `siteMaintenanceSince` (main.ts and timers.test use it). The main line's `NEEDS_SITE_FLAGS` comment text and `site-flags-tripwire.test.ts` must stay deleted. The deletion auto-merges, so check it is gone.
- `timers.test.ts`: both sides added the same "48 h auto-close of an unconfirmed buyer's cancel" test under different names. Keep one; "keep both" would duplicate it. Keep this branch's `readFileSync`/`fileURLToPath` imports (the main.ts wiring test).
- `machine.test.ts`: take the main line's version (it also clears `confirmBy`).
- The lead's machine.ts landing choices (SYSTEM_EVENTS keeps release-claimed and return-confirmed; escalate allows settling and `awaitingCancelConfirm`; `nextDeadline` keeps the `releaseClaimedAt` rule and `case 'refunded'`; timers reads `awaitingCancelConfirm`) are already identical on this branch. No other clash.

## Not findings (checked)

- **A compromised API.**
  - It still cannot cause an auto-refund before `max(shadow, API) alert + 15 min + 60 s`, nor after a late receipt measured against the earlier alert.
  - It cannot make the mod co-sign a buyer-cancel without the buyer's own `trade.cancel` signal accepted by the shadow and no `trade.paid`.
  - It cannot get a forged refund-kind sweep counted: the veto plus the both-parties rule.
- **Clock skew.** Only the API-alert term of the wait depends on the clocks agreeing. That is covered by the 60 s margin and NTP (recorded). With `min`, skew in the late check only adds escalations.
- **Double signing.** At most one `armed`. It is saved before `settle`, and the party refuses a second outcome once committed.
- **Escalation after a 409.** It is final and logged apart. Combine this with R3-M3 when landing.

## Test results (3ded6fc, each run under `flock ~/x2f-comms/check.lock`)

- `tsc --noEmit`: packages/trade 0, apps/moderation 0, apps/api 0 errors.
- vitest `@x2f/moderation` + `@x2f/trade`: 16 files, **442/442**. Moderation alone: 5 files, 84/84.
- vitest `@x2f/api` watchReports, timers, schema: 3 files, **93/93**.
- Scratch probe for R3-N1 (desk on the real harness, never committed, deleted): it confirms the stuck state above.
- Not run: web vitest, Playwright, regtest. Task 10's round-2 changes touch only apps/moderation and docs.
