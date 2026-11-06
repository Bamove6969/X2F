# Review: wip/lead-p3-task23 @8fccd6f (Task 23 fix round 3) — APPROVED WITH MINOR (reviewer, 2026-10-29)

**Scope.** This round is three commits: b839cba (merges main 5dd43e2), 156c7f9 (the fixes, red-first) and 8fccd6f (docs). It answers review-task23-round2-2026-10-28.md, which had 1 Important and 4 Minors. Task 23's own diff for the round is `git diff b839cba 8fccd6f`: 18 files.

**What was run.** All runs used my own detached worktree `~/x2f-worktrees/rv-t23`, at 8fccd6f with main line 0e92cb6 trial-merged in locally (the merge was clean; only docs/coordination.md auto-merged). Nothing was committed or pushed. I ran `npm ci` first, and every run was under `flock check.lock`.
- `tsc --noEmit` on apps/api, apps/web and packages/auth-client: all clean (rc=0).
- vitest `@x2f/web`, whole project: 55 files, 811/811 pass. This includes bundle.test, refund-tripwires, tradeRoom-tripwires, css-collisions, finalAlert/sellerRefund, attestation-flow and buyerPay.
- Playwright `pay` + `refund` + `fund` (fund is the Task 22 room spec): **65/65 pass** (1.7 min; a first attempt without `X2F_CHROMIUM_PATH` could not launch a browser and is discarded).
- Mutation checks, each reverted afterwards (`git status` was clean at the end):
  - Delete the `escrow-refused` line in `payBlock` (payModel.ts:152): **6 tests fail**. They are payModel round 2; buyerPay I1 for view-mismatch, amount-changed and attempts-exhausted; I1 wide; and I1 in the FinalAlert paid step.
  - Delete the runtime `paid` `viewMatches` throw (runtime.ts:1123): **2 attestation-flow tests fail** (maximum drift and poster drift).
  - Drop `&& !saved` in BuyerCancelling (BuyerPay.tsx:612): **1 test fails** (Minor 1).

So the Important fix and Minor 1 each have a real test that fails without them.

The worktree has been removed.

## Important 1 (round 2): fixed in every path

| Path | Where | Verified by |
|---|---|---|
| Gate | `payBlock` returns `escrow-refused` for any refusal except `amount-out-of-range`, before the phase and total checks (payModel.ts:150-155). `finishBlock` is the same, except that `amount-unknown` is allowed (payModel.ts:163-167). | payModel.test, plus the mutation |
| Phone BuyerPay | The primary has `disabled={block !== null}`, and the click is guarded the same way (BuyerPay.tsx:458-461). The refusal sentence is shown once: the payBlock line is skipped when `refusalText` already says it (BuyerPay.tsx:508, :523). | buyerPay "I1: refusal …" ×3 |
| Wide BuyerPay | Uses the same `primary` and `notices` elements (BuyerPay.tsx:556-577). | "I1: wide too" |
| PaidFlowSheet / FinalAlert | `PaidFlowEscrow` and Task 25's `PaidStepKeys` now carry `refusal` (PaidFlowSheet.tsx:22; refundSlot.ts:41). While open with a block, the sheet shows only the reason and "Not yet" (:140-153). `onYes` re-checks `payBlock` before posting (:112). | "I1: the paid step itself (FinalAlert …)" |
| Task 12 runtime `paid` | Throws when the view fails `viewMatches`, after `loadView()` and before `fixAmount` / `paidSeen` / persist / `trade.paid` (runtime.ts:1119-1123). | attestation-flow: maximum and poster drift. Nothing is fixed, `paidSeen` stays false, the seller never sees `trade.paid`, and the same tap succeeds once the view is right. Mutation confirmed. |
| Finish gating | `needsFinish` also covers `view-mismatch` with no recorded tap, in which case Finish is shown but disabled with "Don't pay again" (BuyerPay.tsx:425-427, :513-522). The runtime returns `view-mismatch` before setting `paidSeen` from the view (runtime.ts:921-927), so this is the state that is actually reached. Once the view is right, it becomes `amount-unknown` and Finish is enabled. | "Finish is offered but refused …"; "once recorded … Marked as paid" |

**`paidRecorded` (unchanged).** It is still computed in one place: runtime.ts:358, `role === 'buyer' && paidSeen && acceptedAtomic !== null`.
- For the buyer, `acceptedAtomic` is set only by `fixAmount` in the device's own `paid` action.
- The new view check runs before that, so it cannot set it either.
- The fixture's `markPaid` is the only fixture path that sets it.

**Pre-paid refusals for the buyer (deadlock check).** The only refusals a buyer can get before paid are:
- `amount-out-of-range`: allowed, and it is the `no-amount` path;
- `view-mismatch`: correctly blocks;
- `attempts-exhausted`: blocks, which is conservative and correct.

`amount-changed`, `amount-unknown` and `paid-amount-refused` need `acceptedAtomic`, `paidSeen` or seller-side state. So the new gate cannot strand a legitimate buyer before paid.

## Minors (round 2)

1. **Fixed.** New Task 12 field `intentKind` (runtime.ts:118-125, :359-362). It is null for the runtime's automatic choice.
   - BuyerCancelling offers Try again only while `intentKind !== view.settling` (BuyerPay.tsx:608-612).
   - The runtime test shows `intentKind === 'buyer-cancel'` while the coins are still locked, with nothing built yet.
   - The UI test shows no Try again for the saved kind, and Try again for another kind. The mutation confirmed it.
2. **Fixed.** `total-wrong` is used when the device's amount equals the API's and the totals differ, with a final sentence. `amount-differs` ("checking") is kept for a different amount (payModel.ts:143-147; PaidFlowSheet.tsx:82-83). Tested.
3. **Fixed.** With `useTradeChat() === null`, the wide SellerWaiting disables Chat with `aria-describedby`, "Chat isn't available here yet." (BuyerPay.tsx:698, :746-761). There is still a single primary. Tested.
4. **Fixed.**
   - coordination.md has a Task 23 section covering: `paidRecorded` and its ruling, `intentKind`, the `paid` view check, the open `trade.paid` resend for Task 12, the two slots, Minor 6 → Task 24/31, Minor 8 → lead GAP, and the Task 20 install line.
   - TradeRoom.tsx's ownership comment lists buyer × `paid` and the guarded buyer × `settling` (TradeRoom.tsx:44-48).

## Task 25 (refund screens): no regressions

- Task 23 touched only the `PaidStepKeys` type (refundSlot.ts:41, `refusal` added). `useEscrow` already supplies it.
- finalAlert/sellerRefund/refund-tripwires unit tests are green in the 811.
- The Playwright refund spec is green, including the phone-fit cases (see the result above).
- FinalAlert's paid sheet now refuses on a blocking refusal, as intended.

## New findings

### Minor

1. **BuyerCancelling never shows `escrow.refusal` (BuyerPay.tsx:637-661).** This is pre-existing (round 2's code) and not made worse by round 3.
   - Scenario:
     - The buyer one-tap cancels.
     - The refund outcome's attempts run out (`attempts-exhausted`, runtime.ts:831-834). Or the API view drifts (`view-mismatch`).
   - Result:
     - The phase stays `signing` / `ready` with the saved intent, so there is no Try again (correctly).
     - But the card says "Returning the XMR to <seller>. Keep this page open." indefinitely. The room never says that the device cannot settle, or that the buyer should open a dispute.
   - Fix: render `refusalText(escrow.refusal)` (the PaidFlowSheet export) under the card in BuyerCancelling when `escrow.error === null`. Add a test for `attempts-exhausted` in buyer-cancel `settling`.
2. **The runtime check runs after the API post (PaidFlowSheet.tsx:116-133 with runtime.ts:1123).** Note only; no change is needed for landing.
   - `onYes` posts `mark-paid` first and calls `markPaid` after. Suppose the view drifts in the one tick between the last emitted status and the paid action's own `loadView()`.
   - Then the API is paid and the device refuses. The buyer lands on the disabled Finish card with "Don't pay again", which is the correct and safe end state.
   - Recorded so the lead knows the runtime check is defence in depth, not the primary gate.

## For the lead at landing

- Confirm the `paidRecorded` ruling.
- Accept or reject the second Task 12 interface addition, `intentKind`. Branches that build `EscrowStatus`, `UseEscrow` or `TradeEscrow` literals need both fields; tsc names them.
- Task 12's `trade.paid` resend is still open (recorded in coordination.md).
- The phone rooms' Chat still opens an empty sheet until Task 20 installs `setTradeChat`.
