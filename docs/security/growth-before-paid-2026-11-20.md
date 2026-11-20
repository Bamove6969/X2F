# Extra XMR after "secured" and before "I've paid" (20 Nov 2026)

Branch `wip/lead-fix-growth-binding`. This is escrow binding on the buyer's device and needs a security review.

## The gap

The regtest e2e found it (`wip/lead-p3t31-regtest-e2e` 0dc70076, spec "surplus after secured").

1. The seller funds the escrow and the trade reaches `secured`.
2. The buyer's device hands its party a standing co-sign for the release at the take amount A. The runtime saves `releaseBoundAtomic = A` (invariant I1).
3. The seller sends extra coins. The release waits until they have 10 confirmations. Then the API grows the trade to A' > A (`@x2f/trade` `grow`; Revision 2026-10-20 (a), 2026-10-21).
4. The buyer's device also grows its own size to A', from its own wallet. But I1 refuses any release amount other than A, so the status shows `amount-changed`. The page reads that as "amount changed after you paid", although the buyer has not paid.
5. The status amount (`deviceAcceptedAmount`) is the bound A. The banner shows the old total. The "I've paid" tap for A' is refused on the device, and a tap for A is refused by the API (`total-changed`). Nobody can move the trade forward, except with a buyer cancel or a dispute.

`docs/coordination.md` (Task 12 follow-up, re-review 2026-10-25) accepted this as a known cost. It also proposed the fix built here: "allow an upward-only rebind before paid, when the party reports it has not signed the earlier set."

## What the plan says should happen

- **Revision 2026-10-20 (a)** (owner decision of 20 Oct, T-022): extra XMR that arrives before "I've paid" grows the trade at the same locked rate, within the offer's limits at take. Both apps show the new totals. Above the maximum, or after "I've paid", the amount stays and the extra goes back to the seller as its own output.
- **Revision 2026-10-21**: growth counts only releasable coins (all with 10 confirmations). There is no growth from `paid`, `refund_requested`, `settling` or `disputed`.
- **Task 2**: "a later `chain` with more coins (a late surplus) clears `releasable` until they unlock; no deadline caps that wait."
- **Task 12**: "When `funds().balance` changes before this side has signed (a late surplus), the app re-derives and settles again."
- **Task 31**: "Extra coins sent after `secured` hold the release until they have 12 blocks, then everything is swept." The e2e spec checks the buyer receives the grown amount less 1% and the network fee.

So, as the plan stands, extra coins after `secured` and before "I've paid" should:

1. hold the release until they unlock;
2. then grow the trade, with the new total shown to both sides;
3. let the buyer pay and tap "I've paid" for the new total;
4. then be swept in full with the release.

The device's I1 binding is the only part that does not follow the plan.

**Owner status.** Page 11 question p11-63 asks whether growth survives the 30 Oct rule (T-023: automatic payouts pay only the agreed amounts, and the extra stays in escrow). It is still unanswered, and p11-64 and p11-65 depend on it. Main grows the trade today, in the API and on the device up to the first standing co-sign.

## Why I1 exists

I1 stops a lying API from moving a buyer's standing co-sign to a lower amount. The buyer reads the sum on the screen, which is the bound amount, and pays that much in fiat. If the API could rebind the co-sign downward, the buyer would get less XMR than they paid for. Any fix must keep that rule.

The escrow party gives a second guarantee (`packages/escrow/src/party.ts`, `settle` / `beginRelease`). Once a tx set has been built or accepted for checking (`committed`), the party refuses to switch to another outcome ("already signed for another outcome"). `committedBuilder()` reads that from the saved state. As co-signer, the buyer commits only after receiving and checking the seller's set, and then signs straight away. So a committed buyer party is a release that is already happening.

## Options

| | What changes | Plan / policy | Safe for the buyer | Safe for the seller |
|---|---|---|---|---|
| **A. Upward-only rebind before paid** | The buyer's device moves `releaseBoundAtomic` up to the grown amount. Only in `secured`, before this device knows of paid, with no fixed amount, never above its own escrow-funded size, and only while the party is not committed to another outcome. Downward stays refused. | Follows Revision 2026-10-20/21 and main's API. No new policy. | The co-sign never goes below what the screen showed. The new sum is on the screen before it can be tapped. A lying API can raise the sum only up to real coins in the escrow and the offer maximum, at the locked rate. That is honest growth. | Unchanged. The seller's device still fixes its release only from the buyer's signed `trade.paid` (I2). The extra is never paid out without the buyer paying for it. |
| B. Stop growth at `secured` | Growth only in `funding` and `securing`. Extra after `secured` is held, then swept to the seller as its own output (or kept in escrow under T-023). | Changes the owner's 20 Oct rule ("before I've paid"). Moves toward p11-63 option 1. Owner decision. | Best. The sum can never change while payment details are visible. | Gets the extra back, no fiat for it. |
| C. Keep the binding, fix only the wording | Show "the trade grew; cancel or dispute". | Leaves the plan's growth broken. | The trade is stuck. The buyer must cancel or dispute. | Same. |
| D. Unbind freely (both directions) | Drop I1. | No policy change. | **Unsafe.** A lying API can short a buyer who paid for the shown sum. | — |

## Recommendation

**Build A now.** It is a bug fix inside the decided policy. It removes the stuck trade, and it keeps I1's protection: no downward rebind, and no rebind once the party is committed.

**Ask the owner about B** (new question, with p11-63). Today the growth rule lets the sum change while the buyer may already be paying. A seller can send extra after `secured`, so a buyer who has just sent the old total then sees a higher one. That buyer must then pay the difference, cancel (and lose the fiat sent), or dispute. That is true on main today with or without this fix, because the API already refuses the old total (`total-changed`). This fix only makes the buyer's device show and accept the new total instead of a dead end. If the owner picks p11-63 option 1 (fixed amounts), growth goes entirely and so does this rebind.

## What is safe for both sides (the rules A keeps)

1. A co-sign never drops below an amount already handed over (I1 downward, unchanged).
2. It may move up only while all of these hold:
   - this device's view is `secured`;
   - this device knows nothing of "I've paid" (no tap, no `paidAt`);
   - nothing is fixed (`acceptedAtomic` null, `paidRefused` not set);
   - the new amount lies within [take, this device's own escrow-funded size], from its own `funds()`, never the API's word;
   - the party reports no committed outcome (`committedBuilder()` returns null; a party without the method counts as committed, failing closed).
3. The new bound is saved before the new outcome is handed to the party (I8).
4. The status sum is the bound, so the screen shows the new sum before an "I've paid" tap for it can pass.
5. After paid nothing moves (I2, I3 unchanged). The seller releases only the buyer's signed amount.
6. Refunds stay unbound (I5). A buyer who cannot pay the new total can still cancel before paid, and the whole balance goes to the seller's signed refund address.

**Residual risk.** A commit can race the check: the seller's set reaches the buyer's party between `committedBuilder()` and the queued `settle()`. The party then refuses the switch ("already signed for another outcome"), and the earlier release at the lower amount completes. That needs the seller's party to build a release without a release tap. In that case the buyer receives the lower amount before paying anything, so nobody loses coins; the seller has released early. When the party refuses the switch, the runtime sets `releaseRebindRefused`. From then on the device shows no sum, takes no "I've paid" tap and co-signs no other release (fail closed), because it no longer knows which amount the party committed to. A tap in the moment between the rebind and the party's refusal is the only gap. It needs the same misbehaving seller, and the buyer's XMR is already on its way.

## Built (this branch)

- `mayRebindUp` and `rebindRefused` in `apps/web/src/escrow/runtime.ts`.
- New record fields `releaseRebound` and `releaseRebindRefused` in `apps/web/src/escrow/store.ts`.
- The fake party now answers `committedBuilder` in `apps/web/test/escrow-helpers.ts`.
- Tests in `apps/web/test/attestation-flow.test.ts`:
  - growth after the standing co-sign;
  - upward only;
  - no rebind when the party is committed or lacks the method;
  - no rebind in `settling` or in a `paid` this device never tapped;
  - a rebind the party refuses;
  - the I3 status test.

  The two tests that pinned the old accepted cost now pin the rebind.

## Left open

- **Copy.** `amount-changed` shows "The trade's amount changed on the server after you paid" (`PaidFlowSheet.tsx`) before paid too: a downward lie, or a refused rebind. Unsigned wording would be needed for a "before you paid" variant. Owner or design call; not changed here.
- **A shrinking escrow.** If extra coins vanish after a rebind (a reorg past 10 confirmations), the device's own size drops below the bound and the release stays refused. The buyer can still cancel before paid. This is the same as any bound above the device's size before this change.
- **Starter caps.** The device does not know them, so the upward limit is its own escrow-funded size and the offer maximum, as for the amount before any bound (unchanged).
