# Security review: the cancel reversal (owner 8 Nov, p6-1 / p9-2 / p9-4) on the trade rules branch

- Reviewer: lead's independent security reviewer, 8 Nov 2026
- Tree: `wip/lead-trade-rules-p1` at **fde037d9** (worktree agent-ab4411d8497a06c68, confirmed clean; nothing changed)
- Scope: `git diff 76579555 fde037d9`, mainly the merged `origin/wip/lead-cancel-reversal` (d422a67f: ef0851a0, a3a634cc, f2e04ccd, adf1dbe4, d422a67f), migration 120, and the merge resolutions (dispute/rules.ts, parity.ts, schema.test.ts, machine.test.ts)
- Owner rules checked against: owner-decisions-2026-11-06.md lines 122-127 and 168 (p6-1, p9-2, p9-4, p11-16)
- Tests run (one file each): `packages/trade/test/machine.test.ts` 151 passed; `packages/escrow/test/autoRefund.test.ts` 8 passed. Pure probe of the machine (scratchpad, not committed): it confirms that after `request-refund` then a buyer `open-dispute`, the trade is `disputed`, `settling` is still `auto-refund`, and `settleKindFor` returns `null`.

## Verdict

**CHANGES REQUIRED: one Important finding, then good to land.** The core money rules are right. The API decides the "I've paid" vs Cancel race on the trade row lock. A seller can't cancel after "I've paid". The moderator signs only when the API and its own shadow both show the cancel and it has never opened a `trade.paid`. Nothing is left in `refund_requested`. But the buyer's "dispute at once" (p9-2), which is now the buyer's main protection, nearly always ends in a dispute that can't be ruled or closed.

## Findings

### I1 (Important): a buyer's "dispute at once" during the seller's cancel gets stuck: wrong dispute type, empty escrow, the trade never closes

Where:
- `packages/trade/src/machine.ts:449` lets the buyer dispute at once in `settling`/`auto-refund`.
- `apps/api/src/disputes/routes.ts:238` records `afterRefund: prev.state === 'refunded'`, which is `false` here.
- `packages/trade/src/watch.ts:373-377` (`settleKindFor`) gives `null` for `disputed`.
- `apps/api/src/internal/routes.ts:278-280` then refuses the sweep as `settle-kind-unknown`.
- `packages/staff/src/dispute.ts:268` allows only the escrow outcomes when `afterRefund` is false, and `:310` closes the case only once `executedAt` is set.
- The moderator signs at once: `apps/moderation/test/autoRefund.test.ts:77` "co-signs … in the first pass after the cancel"; the pass interval is 5 s (`apps/moderation/src/main.ts:413`).
- A refund already handed to the party is never taken back (`desk.ts:567-573`, R3-M1).

Scenario:
1. The buyer paid late. The seller taps Cancel after the time to pay, and the trade goes to `settling`/`auto-refund`.
2. Within about 5 s the moderator arms the refund and hands it to its party. The seller's device builds it.
3. The buyer gets the generic push and opens SellerCancelled, which says "Open a dispute now". They tap it. The machine accepts, so the trade is `disputed` and the dispute row has `afterRefund = false`.
4. The refund was already handed out, so it completes and lands on chain.
5. The watcher reports `settled`. The API refuses it (`settle-kind-unknown`, since `settleKindFor(disputed)` is null), and the watcher backs off up to 1 h, forever.

Result:
- The trade stays `disputed` with an empty escrow.
- The dispute can only rule `release-to-buyer` or `refund-to-seller`. Neither can execute on an empty escrow, so `executedAt` never comes and the case never closes.
- The remedy SellerCancelled promises ("they are asked to send you the XMR as agreed", i.e. `seller-sends-xmr`) is only an after-refund outcome, so it is not on offer.
- The buyer can't open the right dispute later: one dispute per trade (`routes.ts:222-225`).
- The chat is never erased, since a dispute stays open (`chat.ts` `chatPurgeDue`).

The buyer is only protected if they do nothing until the refund lands (then the existing 48 h refunded dispute works), or if they win a race of a few seconds against the moderator (then the coins stay in escrow and the normal escrow ruling applies). The comments at `machine.ts:446-448` and `SellerCancelled.tsx:5-7` ("the moderator then stops co-signing it") describe the rare case as if it were the usual one.

Fix (the lead picks one; both are technical):
- (a) Settle it in the API. When a `settled` sweep arrives on a `disputed` trade whose `settling` is `auto-refund` (dispute opened from the seller's cancel), apply it with that kind: let `settleKindFor` return `t.settling` for `disputed` trades with `settling` set, or special-case it in the internal route. In the same transaction, flip the open dispute to `after_refund = true`, so the ruling offers `seller-sends-xmr` / no-action.
- (b) Decide `afterRefund` at ruling time from the escrow balance, not at opening.

Add an API test: cancel, buyer dispute, `settled` report accepted, trade `refunded`, dispute after-refund, ruling `seller-sends-xmr` allowed. Fix the two comments. Nothing on chain is misdirected today; this is a stuck path that loses the buyer's remedy in code.

**Note for the lead (owner-visible, not a code defect):** with no final alert, a buyer who paid but didn't tap "I've paid" before the time ran out can't stop the refund. In practice their only remedy is the after-refund dispute: the seller is ordered to send the XMR, backed by account action, with nothing taken from an escrow. That follows p9-2 as written ("the buyer can dispute at once"). The owner may assume the dispute halts the refund, so this is worth one line in the next batch of questions. The buyer-side warning exists (`BuyerPay.tsx:423-436` PayOverNote).

### M1 (Minor): migration 120 at deploy can reopen "I've paid" on a trade whose refund was already co-signed under the old rule

Where: `apps/api/migrations/120_cancel_reversal.sql:12`; comment lines 5-11.

Scenario: a trade sat in `refund_requested` past `final_alert_at + 15 min`. The old moderator armed the refund and its party (R26: signed sets are saved and resubmitted after a restart) or the seller's device already holds the co-signed refund. The migration moves the trade to `secured`, so the buyer sees the payment details and "If you've sent the money, tap I've paid now" again. If the buyer then pays and taps, the trade is `paid`. The refund lands, and `settled` is refused (`settleKindFor(paid)` is null), so the trade sits `paid` on an empty escrow. That is the same stuck class as I1, and here the buyer was invited to pay.

The comment "its new process … holds no refund handed out under the old rule" covers the process's memory, not the party's saved signed tx.

Fix: a deploy precondition. Run `select code from trades where state = 'refund_requested' and final_alert_at <= now() - interval '15 minutes'` and settle those by hand first, or leave such rows in place as `settling`/`auto-refund` instead of `secured`. Pre-launch (owner p11-7: before real money moves), so Minor.

### M2 (Minor): stale doc lines

- `docs/superpowers/rulings-and-lessons.md:77` still opens with the old guard ("finalAlertAt present and now ≥ finalAlertAt + 15 min … final-alert-pending") and the superseding sentence is appended at the end. A reader who stops early reads the retired rule. Strike the old text (`~~…~~`) or put "Superseded" first.
- `docs/coordination.md:133` (the `settleKindFor` follow-up) still names `refund_requested → 'auto-refund'`. It should be marked retired, like line 331.
- `docs/coordination.md:82` and `:93` (Task 10 final-alert notes) are history and fine, but a "retired 8 Nov" tag would stop someone acting on them.

### M3 (Minor, info): the seller can dispute their own cancel 15 min after it

Where: `machine.ts:450`, with `onTick` never reverting `auto-refund` (`:396`).

Past `settleBy` either side may dispute a `settling` trade, and `dispute/rules.ts:85-88` shows the seller "Open dispute" there. A seller doing so blocks their own armed refund for good (`auto-refund-api-disputed`) until a ruling. It harms only them and is a reasonable exit for a refund that never builds. Recorded so it is a choice, not an accident. No change needed unless the lead wants the seller's exit to be only the 6 h `spend-unshown` fallback.

## Confirmed safe

- **"I've paid" vs Cancel race at the API.** `applyEvent` locks the trade row `for update` (`apps/api/src/trades/store.ts:239`, `:350`). `mark-paid` needs `secured`; `request-refund` needs `secured` with `paidAt === null` (`machine.ts:538`, `:566`). The two are mutually exclusive and one-way. A concurrent API test covers both orders (`apps/api/test/tradePublish.test.ts:126-127`).
- **The race at the moderation service with stale snapshots.** Once the API shows `settling`/`auto-refund`, its only next states are `disputed` (I1), a system escalation, or `refunded`, never `paid`. So a watch item up to `WATCH_FRESH_MS` (10 s) old that shows the cancel can be contradicted only by a dispute; I1 covers that.
  - The buyer's `trade.paid` signal is sent only after the API accepted `mark-paid` (`PaidFlowSheet.tsx:148-168`).
  - A `trade.paid` the desk opens at any time blocks for good (`desk.ts:109`, `autoRefund.ts` step 2) and escalates after 2 min (`paidConflict`).
  - `armedRefundBlock` re-reads fresh facts before every hand-off (`desk.ts:579-583`).
- **The moderator never signs on API facts alone.** `autoRefundStep` also needs:
  - the shadow itself `settling`/`auto-refund`, having taken the seller's signal only after its own `payBy` (pending and retried before);
  - no `trade.paid`;
  - the seller-signed refund address and balance == unlocked;
  - `autoRefundDecision` (`packages/escrow/src/autoRefund.ts`: window passed, no mark-paid, exactly one payout to the recorded address).
- **Pause / maintenance.**
  - `request-refund` and `open-dispute` are refused while paused (`WHILE_PAUSED`, `machine.ts:194`); `mark-paid` stays allowed. The moderator waits while the API or its shadow is paused.
  - If the shadow misses a short pause, its `payBy` is earlier than the API's, but the API's own `payBy` brake still holds.
  - If the shadow sees a longer pause than the API, its `payBy` is later: the signing waits, with the 60 min `refund-unverified` escalation as backstop.
  - `settleBy` shifts on resume, but nothing reads it for `auto-refund`.
- **No dead states left behind.**
  - `refund_requested` is gone from the type, the machine, `SETTLED_FROM`, `BUYER_CANCEL_SETTLE`, escalate, the API view and watch list, the web and the moderation service.
  - The DB check constraint now refuses it (`cancelReversal.test.ts:62`).
  - The `final_alert_*` columns are never read or written.
  - Old desk records are revived (`reviveShadow`, tested at `autoRefund.test.ts:333`, `:368`).
  - An `apiRefundSince` left over from the old rule resets once the API shows `secured`.
  - `/final-alert-seen` gives 404, and `alert-unseen` / `alert-late` give 400.
- **No stuck paths.** `settling`/`auto-refund` never reverts (`machine.ts:396`) and has no deadline (`:648`), but every route out still works:
  - the desk's 60 min `refund-unverified` escalation;
  - the watcher's 6 h `spend-unshown` fallback (`watch.ts:283-312`, any `settling`);
  - `escalate` from `settling` (`machine.ts:517`);
  - the buyer's dispute.
- **Nudges are optional.** No rule reads `sellerNudgedAt`; it is a record only (nudge route, view, fixtures). The desk's synthetic nudge is removed.
- **machine.test.ts:373** (fde037d9: the dispute opened by the seller instead of the buyer in `secured`). It still proves "a disputed trade can't be cancelled": `request-refund` is refused on `state !== 'secured'` whoever opened the dispute. The buyer can no longer dispute in `secured` on this branch, so the seller is the only valid opener there.
- **Schema lists** (`apps/api/test/schema.test.ts`, three lists). They add `120_cancel_reversal.sql` and `122_chat_retention_disputes.sql` in order and match `apps/api/migrations/` on disk. Migration 120 drops and re-adds the default-named `trades_state_check` from 103's inline check.
- **Merge resolutions.**
  - `dispute/rules.ts` `disputeEntry` combines both branches' rules: no buyer dispute in `securing`/`secured` (P1, p11-16), the buyer at once in `settling`/`auto-refund` (p9-2), and either side from `confirmBy` in `paid` (p9-4). It mirrors the machine.
  - `parity.ts` keeps both branches' SellerRefund exceptions.
- **Web money checks.**
  - The seller's device builds `auto-refund` only while the view is settling it (`runtime.ts:1073`, `viewSupports` `:224`).
  - Policy allows the route only in `settling`/`auto-refund` with `paidAt === null` (`policy.ts:174`).
  - The buyer-cancel lists no longer include the retired state.

## Re-verify 43fbbb2f

- Tree: `wip/lead-trade-rules-p1` at **43fbbb2f** (same worktree, clean; nothing changed). Scope: `git diff fde037d9 43fbbb2f` (d93dc5b8 I1, 5cefa43a M1/M2).
- Tests run (one file each): `packages/trade/test/machine.test.ts` 151 passed; `apps/api/test/watchReports.test.ts` 21 passed.
- Deviation accepted by the lead: the trade stays `disputed` and open (`settling` auto-refund, `txHash` recorded, `settleBy`/`closedAt` null). That is the same shape as the existing refunded-then-disputed case (`onDispute` `open()` keeps `txHash`/`settling` and nulls `closedAt`), so nothing new downstream.

### Verdict

**CHANGES REQUIRED: one Important finding (new, opened by the fix), two Minors.** I1 as reported is fixed. In the usual race the refund is recorded, the dispute becomes after-refund in the same transaction, `seller-sends-xmr` can be ruled, and the trade no longer sits stuck. But the flip runs whatever stage the dispute is at, and that opens a new path that silently closes a case the buyer won.

### R-I1 (Important): the after-refund flip also hits a dispute that already has an escrow ruling, and that case then closes with nothing owed

Where:
- `apps/api/src/internal/routes.ts:288-296` flips `after_refund = true` on any dispute that is not closed (`closed_at is null`), so also on `awaiting-approval`, `published`, `appealed` and `final`.
- `packages/staff/src/dispute.ts:267`/`:427`: `outcomeFits` is checked only at `propose`.
- `dispute.ts:302-317` `resolveFinal`: with `afterRefund` true and an outcome other than `seller-sends-xmr`, the case goes to `closed` with `complyBy: null`.
- `:378`: `executed` is refused once `afterRefund` is true.

How it is reached:
- The refund was handed out before the dispute, and a hand-out is never taken back (R3-M1).
- The seller's device is the builder. It sends the tx set when it chooses (`party.ts:297-301`), and the moderator co-signs and broadcasts whenever it arrives.
- So a modified seller client can stall the build until a `release-to-buyer` ruling is published, which is likely, since the coins are still in escrow at ruling time. Ruling payouts are not wired yet (no producer of `executed`), so nothing can beat it.
- The seller then sends the set. The refund lands. The watcher reports `settled` auto-refund, the API accepts it, and the dispute is flipped. At the end of the appeal window `resolveFinal` closes the case: the buyer gets no payout, no `seller-sends-xmr` order and no lien.
- The same happens to a proposal awaiting approval: it was proposed while `afterRefund` was false and is approved after the flip.

Before the fix this path stayed stuck (`settle-kind-unknown`), which was bad but visible. Now it closes quietly against the buyer.

Fix (technical, lead's pick):
- Flip only while the dispute has no ruling or proposal (`status = 'open'`, i.e. `ruling is null`).
- Otherwise record the tx, leave `after_refund` alone, and raise the case for staff: a log/alert, or reopen it for a fresh ruling, with `seller-sends-xmr` the natural replacement for `release-to-buyer`.
- Add an API test: dispute, `release-to-buyer` published, then `settled` auto-refund lands; the case must not close with nothing owed.
- Pre-launch, but it defeats the buyer's main remedy under p9-2, hence Important.

### R-M1 (Minor): a second, different tx on the disputed auto-refund shape closes the trade as `refunded` while the dispute is open

Where: `packages/trade/src/machine.ts:518-523`. When `t.txHash` is set and `e.txHash` differs, the new branch falls through to the general case. That gives `state: 'refunded'`, `closedAt: now`, `txHash` overwritten, and it starts the closed-trade clocks with an open dispute.

`settleKindFor` now names `auto-refund` for both shapes: this one, and the existing refunded-then-disputed trade from a seller's cancel. So the route no longer refuses such a report as it did before (`settle-kind-unknown`).

Not reachable through today's watcher: it reports `settled` only while its own `closedAt` is null, and the state is persisted (`mod_watch`). A later sweep of late coins, which needs both traders' spend.info to count, is recorded without a report. So this is defence in depth.

Fix: in that branch, `return fail('wrong-state')` for a different tx (the watcher counts it as done), and add a machine test.

### R-M2 (Minor, forward note): ruling payouts on this shape will be counted as `auto-refund`

Where: `watch.ts:377`, `watcher.ts:436`.

`settleKindFor(disputed, auto-refund)` is `auto-refund`. So once ruling payouts are built, a seller-built escrow payout the moderator co-signs on a dispute that beat the moderator's pass would be reported and recorded as the cancel refund, and the flip would run.

Today the desk co-signs nothing on a disputed trade, and an import-only sweep is proven against auto-refund minimums with both traders' spend.info, so nothing mis-records now. Tag `NEEDS_PLAN_4_RULING_PAYOUT`: ruling execution must report its own kind (`RulingKind` exists in `payouts.ts`), checked before this branch.

### Checked and fine

- **Repeated report.** Same tx: the machine returns `t` unchanged, the route's flip guard (`prev.txHash === null`) does not run again, and the API test asserts 201 with the trade unchanged. The desk's shadow catch-up (`desk.ts:518-520`), which feeds `settledTx` every pass, is now a no-op on this shape instead of moving the shadow to `refunded`.
- **Forged kind.** The route accepts only the kind `settleKindFor(prev)` names under the row lock. On a disputed trade that is `auto-refund`, and only when `settling` is `auto-refund`. A `release`/`buyer-cancel` claim is 409 `settle-kind-changed`, and a disputed trade with any other `settling` (or none) is still 409 `settle-kind-unknown` (`watch.test.ts`, the second API test). The machine's own fall-through for `kind: 'release'` is reachable only by the route, which cannot name it here.
- **Sweeps on other disputed trades.** Escalations from `settling` keep `settling`: a `spend-unshown`/`refund-unverified` system dispute on a seller's cancel gets the same handling, which is correct (the escrow is empty once the refund is shown). Disputes from `paid`/`secured` have `settling` null and are untouched.
- **Late funds.** Late coins on this open trade come in as `chain` reports only (`late-funds` escalates only when closed or on the settling step, and a dispute is already open). Nothing changes kind.
- **The flip.** It runs in the same `applyEvent` transaction as the trade write (`within` under the row lock, `store.ts`), only when the machine took the new branch (`prev`/`next` both `disputed`, `txHash` null to set), and only on the latest dispute (`seq = max(seq)`) that is not closed. See R-I1 for the status filter it lacks.
- **`countTradeTotals`.** It runs only on a change to `released`/`refunded`, so this shape counts nothing. That is right: a cancelled trade is not a completed one. The old `refunded` + `dispute_by` result would have counted it as completed.
- **Closed-trade clocks.** `closedAt` stays null, so reviews, the 30-day purge and the chat erase do not start, the same as the existing after-refund shape. The dispute's own `closed_at` governs chat retention.
- **Web.**
  - `DisputeRoom.tsx:142` reads `afterRefund` from the dispute view, so after the flip it drops "Locked in escrow", and `rulingAllowsCosign` refuses any co-sign on an after-refund dispute.
  - Between the dispute and the refund landing (minutes), the room still shows "Locked in escrow" for coins already on their way back. This is cosmetic (COPY-UNSIGNED screen) and worth a design note only.
  - `SellerCancelled.tsx` and the `machine.ts` comments now describe the usual case correctly.
- **Tests prove it.**
  - API test 1 fails without any of the three parts: the machine branch (state would be `refunded`), the `settleKindFor` line (409) or the flip (`afterRefund` stays false, and `publishRuling` goes through `propose` → `outcomeFits`, so `seller-sends-xmr` would throw).
  - API test 2 is weaker than its title: its trade has `settling` null, so it would pass even if `settleKindFor` returned `t.settling` for every disputed trade. The unit test in `watch.test.ts` covers the other kinds.
  - The repeated report does not re-assert the dispute row. Both are acceptable.
- **M1/M2 docs.** The migration 120 pre-deploy query is in place, and the rulings-and-lessons and coordination lines are tagged. M3 is commented at `machine.ts:453-454`.

## Re-verify 2199561a

- Tree: `wip/lead-trade-rules-p1` at **2199561a** (same worktree, clean; nothing changed). Scope: `git show 7fa7bad6`.
- Tests run (one file each): `packages/trade/test/machine.test.ts` 151 passed; `apps/api/test/watchReports.test.ts` 22 passed.

### Verdict

**APPROVED.** R-I1, R-M1 and R-M2 are closed. The branch can land.

### R-I1: fixed

- **The flip.** `internal/routes.ts` now selects the latest not-closed dispute `for update`, inside the same `applyEvent` transaction as the trade write. It sets `after_refund` only when `status = 'open'`. Dispute changes go through `withDispute`, which takes the same row with `for update of d`. So a concurrent `propose` serialises with the flip: it either sees `afterRefund` true at `outcomeFits`, or it commits first and the status is no longer `open`, in which case the case is escalated. There is no window where a `release-to-buyer` proposal ends up on an after-refund dispute. The lock order is trade then dispute; the dispute paths do not lock trades, so no new deadlock.
- **Past `open`.** The tx is recorded, `after_refund` is left alone, and `appendLog` (`dispute.refund-after-ruling`, `{seq, status}`) plus `addOwnerAlert` (`dispute-refund-after-ruling`, `{trade, seq}`) both run on the same client `c`, so they are in the same transaction. The only escalation trigger is `prev.txHash === null`, so a repeated report raises nothing new (the test asserts exactly one log row).
- **Never closes with nothing owed.** With `afterRefund` false, `resolveFinal` reaches `final` and closes only on `executedAt`. `executed` has no producer yet, and once one exists it must be its own `RulingKind` (R-M2 tripwire). Round 2 (`appealed`) follows the same `!afterRefund` path. A rejected proposal goes back to `open`/`appealed` with `afterRefund` false, so it waits again. The `close` system event has no producer in `apps/api/src`. The API test proves that after the appeal window the case is `final`, with `closed_at` null and `afterRefund` false.
- **`appealed`: escalate rather than flip.** I accept the lead's call. It is the same safe shape: it waits, and staff are alerted.
- **Residual (no action, already in coordination.md as Plan 4 owes):** there is no staff path yet to re-rule such a case with `seller-sends-xmr`, and the staff app has no words for the alert kind. Until then the case sits at `final`, visible to the owner. If no dispute row is found (`d === undefined`) the route returns without an alert. That cannot happen on a `disputed` trade, whose current dispute is never closed.

### R-M1: fixed

`machine.ts`: on the disputed auto-refund shape, a different `txHash` is now `fail('wrong-state')`. The machine test asserts it, alongside the existing same-tx no-op.

### R-M2: tagged

`NEEDS_PLAN_4_RULING_PAYOUT` is at `machine.ts` (`settled` branch), at `internal/routes.ts` (the flip), and in the `docs/coordination.md` line.

### API test 2 (strengthened)

The trade is now disputed from `settling`/`release` (`spend-unshown`). Both `auto-refund` and `release` claims get 409 `settle-kind-unknown`, and the trade and dispute are unchanged. If `settleKindFor` returned `t.settling` for every disputed trade, the `release` claim would be accepted and the `auto-refund` claim would get `settle-kind-changed`, so the test now proves its title.

### Secrets in the new entries

- The log detail is `{seq, status}`, and `LOG_ACTIONS` types it as `number`/`id`.
- The alert detail is `{trade, seq}`.
- Neither carries a txHash, address, amount, account id, IP, user agent or key.
