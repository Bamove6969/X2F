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
