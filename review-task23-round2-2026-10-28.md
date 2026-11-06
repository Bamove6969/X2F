# Review: wip/lead-p3-task23 @9935936 (Task 23 fix round, round 2) — CHANGES REQUIRED (second's reviewer, 2026-10-28)

The branch has not moved: `origin/wip/lead-p3-task23` is still 9935936 after `git fetch`.

**Scope.** The fix round is `7439fb4..9935936`. It is three merges (a3a7d7f, the Task 22 landing @0031fbf, and main 648493b) plus ten Task 23 commits, from 62ca9af to 9935936. Task 23's own diff on top of the line is `git diff 648493b 9935936`: 32 files.

**What was run.** All runs used my own worktree at 9935936 with main 5dd43e2 merged in locally (nothing was committed or pushed), after `npm ci`. Each run was under `flock check.lock`.
- `tsc --noEmit` (apps/web): clean.
- vitest `@x2f/web`, whole project: 53 files, 782 tests, all pass.
- `bundle.test.ts`: 4/4.
- Playwright `e2e/pay.spec.ts` + `e2e/refund.spec.ts`: 37/37.
- One throwaway probe test, deleted afterwards, for Important 1.

The worktree has been removed. A separate `~/x2f-worktrees/rv-t23` (also at 9935936) is not mine and was left alone.

**What passes:**
- **`paidRecorded` (point 1).**
  - It is computed in one place: runtime.ts:336, `role === 'buyer' && paidSeen && acceptedAtomic !== null`.
  - For a buyer, `acceptedAtomic` is assigned only by `fixAmount`. That is called only from the device's own `paid` action (runtime.ts:742-746, :1065). The other assignment, :733 `fixPending`, is for the seller only.
  - `paidSeen` coming from the API view (:880-882) never sets it alone. The API cannot make it true.
  - Both fields live in the AES-GCM EscrowRecord, saved before `trade.paid` leaves (:1066-1068). So the value survives a reload, which Task 12's "survives a reload" tests already cover for `acceptedAtomic`.
  - The seller always reports false. attestation-flow.test.ts adds the false → API-paid (false) → tap (true) sequence, and checks the seller's false.
  - The buyer cannot co-sign another amount: after the tap, `acceptedAmount` requires the view to equal the fixed amount (:689-690).
  - The buyer cannot co-sign without a tap after paid: `paidSeen` gives null (:693).
  - The ack seam and its tripwire are gone (paySeams.ts:10-11). The lead still has to confirm this ruling (fixer's note).
- **Device amounts (point 2, original I1).** Every sum on Task 23's screens is the device's:
  - "Send exactly", the sheet's sentence and the `mark-paid` post: `deviceTotal` uses `escrow.fiatCents` (PaidFlowSheet.tsx:31-35, :84-90).
  - "Trade grew to": `escrow.amountAtomic` (PaidFlowSheet.tsx:137; BuyerPay.tsx:392-399).
  - The Rate row: `escrow.deal` (PaidFlowSheet.tsx:38-40).
  - SellerWaiting's total: the seller's device figure (BuyerPay.tsx:705).
  - A grep of the six Task 23 files finds `view.fiatCents` only in the two equality checks (payModel.ts:140, BuyerPay.tsx:442). The only `view.lockedRate` use is a currency fallback that is unreachable whenever `fiatCents` is non-null.
  - `onYes` re-checks `payBlock` and that the sheet's total is still the device's before it posts (PaidFlowSheet.tsx:86).
  - Unit and e2e tests cover an amount outside the device's range, totals that differ, an escrow that is stopped or not ready, the rate and the seller's room.
- **Finish / wrong-state (point 3, original I2).**
  - In `paid` with `refusal === 'amount-unknown'`, the screen offers "Finish marking as paid". It calls only `escrow.markPaid(escrow.fiatCents)`, and only while that equals the trade's total (BuyerPay.tsx:441-455). Otherwise it says why.
  - `escrow.fiatCents` is still available there: `deviceAcceptedAmount` (runtime.ts:353-363) does not look at `paidSeen`. So Finish is not dead.
  - A 409 `wrong-state` on Yes closes the sheet and re-reads (PaidFlowSheet.tsx:98-103). The room then lands on the Finish card.
  - A `markPaid` that fails after the post is caught (:109). The runtime then reports `amount-unknown`, which also leads to Finish.
  - A stopped escrow is said in words, with Try again while it can run again (BuyerPay.tsx:514-522). The other refusals are said in words (:413-424, :534-538).
  - The in-memory `unsent` is gone.
- **BuyerCancelling (point 4, original I4).**
  - The slot is buyer × `settling` with `when` buyer-cancel / mutual-cancel (BuyerPay.tsx:51). It wins over any later unguarded Task 24 `settling` slot.
  - It shows "Returning the XMR to <seller>. Keep this page open."
  - Try again calls only `buyerCancel()` / `proposeCancelSign()`, or `retry()` for a stopped escrow, and never posts (:622-637).
  - `viewSupports` allows the retry in `settling` when the kind matches (runtime.ts:201).
  - Tested: a rejection once, then a retry that posts nothing.
- **Fixture hooks (point 5).**
  - `__x2fSetFixtureEscrow`, `__x2fEscrowCalls`, `installPayFixtures`, BoardChat and the board's payment details all live in `src/fixtures/`. The only route there is the `__X2F_FIXTURES__` branch in main.tsx:11-13.
  - Nothing outside `src/fixtures` names them, apart from type-only `declare global`.
  - `bundle.test.ts` builds production and staging with `VITE_FIXTURES=1` and fails on `fixture` in any js/css/html. Each hook name contains `fixture` once lowercased, and the fixtures build proves the check catches it. The test passed (4/4).
  - The worker's one-key-at-a-time env read (f5978ae = main's 648493b fix) keeps `VITE_FIXTURES` out of the worker bundle.
- **Room wiring and landing items from round 1.**
  - payTypes.ts only re-exports (payRoom.test.ts checks this). `postPayEvent` is a typed wrapper over Task 22's `postTradeEvent`. `payMethodOf` adds `fields`. screens.ts has the Task 23 line.
  - `setFinalAlertPaidSheet(PaidFlowSheet)` with a wider `RefundEscrow`. NEEDS_TASK_23 is retired, and a unit test drives FinalAlert → I've paid → Yes.
  - There is one harness mechanism: `/__harness/pay`, `harness.config.ts` and `payHarness.tsx` are gone. pay.spec drives `/trade/:code` on the fixtures build, and refund.spec's Desktop parity is enabled.
- **Minors 1-5 and 7 are fixed as recorded.** The tips open on a tap and never toggle; hover works for a mouse only. pay.css scopes the shared names under `:is(.x2f-pay, .x2f-room)`.

## Important

1. **"I've paid" stays enabled while the device says the trade's details don't match ("Don't send any money"), and the buyer can mark paid on a trade this device will not settle.** This is the class of round-1 I1 that is still left.
   - Code:
     - `payBlock` (payModel.ts:136-141) checks `error`, `phase`, `fiatCents` and total equality, but not `refusal`.
     - On a view that fails `viewMatches` (runtime.ts:240-248: role, poster, currency, rate, `maxFiatCents`), the runtime sets `refusal = 'view-mismatch'` and `refresh()`es to phase `ready` with no error (runtime.ts:875-878).
     - `fiatCents` is still emitted from `deviceAcceptedAmount` over that same `this.view` (runtime.ts:323-333, :353-363).
     - So when the totals agree (for example, only `maxFiatCents` or, with no `funding` block, `poster` differs), `block === null`.
     - BuyerPay.tsx:474 enables I've paid, while :417-418 shows "The trade's details on the server don't match what you agreed to. Don't send any money."
     - The `paid` action does not check `viewMatches` (runtime.ts:1050-1068), so Yes posts `mark-paid` and fixes the amount.
   - Verified with a throwaway probe built on buyerPay.test.tsx's helpers: `fakeEscrow({ refusal: 'view-mismatch' })` on SECURED gives `disabled: false` next to that sentence.
   - Trigger: a buggy or lying API drifts one deal field after funding. The buyer, who sees an enabled primary, pays and taps Yes. While the mismatch lasts, the buyer's device settles nothing ("nothing settled this tick"), so the buyer has paid for a trade their device will not co-sign. That is the I1 failure ("screens must gate before posting").
   - Fix:
     - In `payBlock`, return a new `'escrow-refused'` (or reuse `'escrow-stopped'`'s wording) when `e.refusal !== null && e.refusal !== 'amount-out-of-range'`. `'amount-out-of-range'` is already `no-amount`.
     - Give it the refusal sentence as its reason, and gate Finish the same way (`finishOk`, BuyerPay.tsx:442).
     - Test: `view-mismatch` with equal totals leaves I've paid disabled and posts nothing.
     - Cross-task note for Task 12: its `paid` action could refuse while `this.refusal === 'view-mismatch'`.

## Minor

1. **BuyerPay.tsx:617-620: BuyerCancelling offers "Try again" while the refund is only waiting for the coins to unlock.**
   - `canRetry` is `phase === 'ready'`. The runtime reports `ready` whenever the intent's `outcome` is still null (runtime.ts:813). It builds the outcome only once `f.balance === f.unlocked` (:913).
   - Trigger: the buyer one-tap cancels in `securing` (the common early cancel). The view goes to `settling` / buyer-cancel, the intent is saved, but the coins are not unlocked for up to about 20 minutes. All that time the primary is "Try again" rather than "Returning the XMR…", `keepOpen` is false, and every tap re-saves the same intent and sends another `trade.cancel`. That is harmless (the seller's runtime only pokes on it, runtime.ts:550-554), but it reads as a failure.
   - The code comment at :619 ("'ready' means … the tapped intent never got saved") is wrong in that case.
   - Fix (either):
     - Task 12 exposes the intent's kind (for example, `EscrowStatus.intentKind`), and Try again shows only when it is not the view's `settling` kind.
     - Or BuyerCancelling shows Try again only when `escrow.error` is retryable, or when the escrow step visibly failed (kept per code in `sessionStorage`).
   - Add a test: the intent is saved and the coins are not unlocked, so there is no Try again.
2. **payModel.ts:140 with PaidFlowSheet.tsx:56-57: a lasting total mismatch says "Your device is checking the new total" forever.**
   - Both sides compute `fiatCents(amount, rate)`. So when `escrow.amountAtomic === BigInt(view.amountAtomic)` and the totals still differ, the API's total is simply wrong and will not clear.
   - Fix: in that case, say "The trade's total on the server doesn't match your trade. Don't send any money. Ask in the chat, or open a dispute if it doesn't clear." Keep "checking" for the case where the amounts differ.
3. **BuyerPay.tsx:754 with :403-405: on the wide SellerWaiting, the primary "Chat" does nothing while no ChatPanel is installed.** That is production until Task 20, because only fixtures call `setTradeChat`.
   - Fix: when `useTradeChat()` is null, disable the button with a hint, or keep the old Sheet fallback for that case only. The Task 20 tripwire is already armed.
4. **What needs the lead is recorded only in the review notes** (docs/superpowers/reviews/2026-10-27-p3-task23.md):
   - the new Task 12 interface field `paidRecorded` and its ruling;
   - the two slots outside the ownership list (buyer × `paid`; buyer × `settling` for the cancel kinds);
   - the deferred round-1 Minors 6 and 8.

   `docs/coordination.md` and the "Who owns which slot" comment in TradeRoom.tsx:42-49 are unchanged.

   Fix: a coordination.md entry at landing, covering the `paidRecorded` meaning, the ownership lines, Minor 6 → Task 24/31 and Minor 8 → lead GAP.

## Status of round-1 items

| Item | Status | Where / note |
|---|---|---|
| I1 device amounts | Fixed, one gap left | 5daab45: PaidFlowSheet.tsx:31-40, :84-90; payModel.ts:136-141; tests in unit and e2e. Still open: a refusal does not block (Important 1). |
| I2 paid never recorded | Fixed | 39d58f9: Finish (BuyerPay.tsx:441-455, :477-480); wrong-state (PaidFlowSheet.tsx:98-103); `unsent` dropped; stopped and refusals in words. |
| I3 "Marked as paid" source | Fixed, needs the lead's ruling | `paidRecorded` (runtime.ts:97-106, :336; useEscrow.ts:91-92, :137); ack seam and tripwire removed. See cross-task note on delivery. |
| I4 stuck settling after cancel | Fixed | b838828: BuyerCancelling slot and Try again without a POST. Residual: Minor 1. |
| M1 growth notice | Fixed | GrownNote (BuyerPay.tsx:392-399) on BuyerPay and SellerWaiting, device figures only. |
| M2 tip tap toggles | Fixed | `useTip` (BuyerPay.tsx:123-157); unit test with pointer type. |
| M3 global CSS classes | Fixed | `:is(.x2f-pay, .x2f-room)` scoping (pay.css:59-83, :146); css-collisions.test.ts green on the merge. |
| M4 stale one-tap cancel | Fixed | `getTrade` re-read before the one-tap (BuyerPay.tsx:461-471); test. |
| M5 second chat panel | Fixed | Wide Chat focuses the aside's composer (:754). Residual: Minor 3. |
| M6 seller's system card test | Deferred | To Task 24 / Task 31. Recorded only in the review notes (Minor 4). |
| M7 dispute before confirmBy | Fixed | "Dispute opens in N min" (BuyerPay.tsx:492-502); test. |
| M8 "Ask in the chat" fallback / no details API | Deferred | Lead GAP, unchanged (BuyerPay.tsx:272). Recorded only in the review notes. |
| Landing: FinalAlert paid sheet | Fixed | 2e0c28b: `setFinalAlertPaidSheet(PaidFlowSheet)` (BuyerPay.tsx:783), `RefundEscrow` widened (refundSlot.ts:33-41). |
| Landing: room wiring / one harness | Fixed | 62ca9af, abf6e45. |
| Landing: phone.ts helper | Not adopted, by choice | Keeps 360×640 / 390×844 / 430×932 with the stricter 44 px rule. Acceptable. |

## Landing notes (main line 5dd43e2)

- **Merging.** `git merge-tree --write-tree origin/claude/compassionate-johnson-k95ssr 9935936` is clean (tree 67dbf14). Since 648493b the main line has added Task 8 (5dd43e2): apps/moderation, 111_trade_identities.sql, `runtime.ts` (+72, the attestation's terms) and `adapters.ts`. The runtime.ts and attestation-flow.test.ts changes auto-merge.
  - The lockfile changes (the moderation workspace), so run `npm ci` after the merge.
  - On the merged tree: tsc is clean, the whole web vitest project is 782/782, bundle 4/4, and pay + refund e2e are 37/37.
- **Task 22 slots.**
  - Task 23 registers buyer × [securing, secured, paid] and seller × [secured] with no `when`, plus the guarded buyer × settling. None of them collides with Task 22's (setup/funding, seller × securing) or Task 25's (guarded seller × secured, refund_requested); `registerTradeScreen` would throw at import if one did.
  - refund-tripwires now expects SellerWaiting for the seller in `secured` before payBy.
- **Tripwires.**
  - css-collisions.test.ts is green, with only the known `.x2f-input`. pay.css's own top-level classes are all `x2f-pay*`, `x2f-room*`, `x2f-escrow*`, `x2f-paid*` and other Task 23 names; the scoped shared ones start with `:is(`.
  - tradeRoom-tripwires (`useLiveEvents` only in App.tsx, no second EventSource) is green. Task 23 calls neither.
  - pay-tripwires keeps the two armed ones: Task 20 `setTradeChat`, and the method name in TradeView.
- **The lead should**, at landing:
  - confirm the `paidRecorded` ruling;
  - add buyer × `paid` and buyer × `settling` (buyer-cancel / mutual-cancel) to TradeRoom.tsx's ownership list;
  - add the coordination.md entry (Minor 4).

## Cross-task notes

- **Task 12.**
  - "Marked as paid" now means the tap is recorded on this device, not that `trade.paid` was delivered.
  - `trade.paid` is sent once (signals.ts:208-214). Only `trade.terms` is resent (:199-202). The transport's outbox drops its oldest frames past its limit (packages/escrow/src/transport.ts:30).
  - If that frame is lost, the seller's device stays at `amount-unknown` and the buyer sees "Marked as paid" with nothing to do.
  - Consider resending `trade.paid`, from the record's fixed amount, until the seller shows its own fix. Alternatively, have the moderator's ack stop the resends, as with terms.
  - Also: the `paid` action could refuse on `view-mismatch` (Important 1). An intent-kind field would let Minor 1 be exact.
- **Task 24.** Its unguarded buyer/any × `settling` slot coexists with Task 23's guarded one. Minor 6's system-card test belongs there.
- **Task 20.** The wide seller room's Chat waits for `setTradeChat` (Minor 3).
