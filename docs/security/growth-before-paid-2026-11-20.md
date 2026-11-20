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
3. The new bound is saved before the new outcome is handed to the party, together with the bound and release outcome handed over just before it (`releasePrior`; I8, review M2).
4. **The sum shown is the one the party took** (review M1). Until the party's settle queue has taken the rebound outcome (`PartyHandle.acceptedOutcome()`, a read-only addition in `packages/escrow`), the status sum and the "I've paid" tap stay at the prior bound. Only then does the grown sum show and the tap for it pass, and `releasePrior` is cleared (review m3). A tap at the prior amount in that window binds the release back to it. One rebind at a time.
5. After any rebind, the tap also asks the party that it is committed to nothing (`committedBuilder()`); otherwise it is refused (review M1).
6. After paid nothing moves (I2, I3 unchanged). The seller releases only the buyer's signed amount.
7. Refunds stay unbound (I5). A buyer who cannot pay the new total can still cancel before paid, and the whole balance goes to the seller's signed refund address.

## When the party refuses the switch (reviews M1, M2, m2)

A commit can race the check: the seller's set reaches the buyer's party between `committedBuilder()` and the queued `settle()`. The party then refuses the switch ("already signed for another outcome"). That needs the seller's party to build a release without a release tap (a modified seller client; an honest seller harms only itself).

The runtime then does three things, whether or not "I've paid" was tapped meanwhile:

1. It sets `releaseRebindRefused` and **awaits** its save before anything acts on it (review m2). A failed save stops the trade (retryable).
2. It shows no sum, takes no "I've paid" tap and builds no other release (fail closed).
3. It hands the saved prior release (`releasePrior.outcome`) back to the party, once per run, so the release the party is committed to can complete, also after a reload (review M2, lead call). This changes no policy: the device approved exactly that outcome through `cosignPolicy` when it first handed it over. It skips the policy on re-hand only because the escrow's balance is no longer the one that outcome was built for.

Because the sum stays at the prior amount until the party takes the rebound one, a buyer who tapped in the window tapped at the prior amount, which is the amount the committed release pays.

## Owner / lead question (review M3, no change made)

The device's own size comes from the browser wallet's reading through X2F's node proxy (`VITE_NODE_PROXY_URL`). A wallet does not check proof of work, so a malicious daemon can serve made-up outputs that look unlocked and 10 blocks deep. Main froze the sum at `secured` (the first standing co-sign). With the rebind, an attacker holding both the API and the node proxy can raise the sum after the buyer has the payment details, up to the offer maximum. The buyer would then pay fiat for coins that are not there, and only a dispute (the moderator's own monerod) shows the truth. The API alone cannot do this.

Question: is the node proxy in the same trust domain as the API for this threat model? If it is, this belongs with p11-63 and option B (no growth after `secured`), which removes it entirely. No ruling states the node proxy's trust level.

## Built (this branch)

- `mayRebindUp`, `effectiveBound`, `priorTaken`, `resumePrior` and `rebindRefused` in `apps/web/src/escrow/runtime.ts`.
- Record fields `releaseRebound`, `releasePrior` and `releaseRebindRefused` in `apps/web/src/escrow/store.ts`.
- `PartyHandle.acceptedOutcome()` in `packages/escrow/src/party.ts` (read-only; `incoming.test.ts` checks it on regtest).
- The fake party answers `committedBuilder` and `acceptedOutcome` (with a hold) in `apps/web/test/escrow-helpers.ts`.
- Tests in `apps/web/test/attestation-flow.test.ts`:
  - growth after the standing co-sign;
  - upward only;
  - no rebind when the party is committed or lacks the method;
  - no rebind in `settling` or in a `paid` this device never tapped;
  - a rebind the party refuses;
  - the review's M1, M1+M2, M2 reload, m2, m3 and m6 cases;
  - the I3 status test.
- A tripwire in `apps/web/test/dispute-tripwires.test.ts`, with `TODO(m4)` at `acceptedAmount`: when the buyer's ruling co-sign is wired, `releaseRebindRefused` must not block a buyer-favouring ruling (review m4).

## Left open

- **Copy (review m5, owner).** `amount-changed` shows "The trade's amount changed on the server after you paid" (`PaidFlowSheet.tsx`) before paid too: a downward lie, or a refused rebind. Unsigned wording would be needed for a "before you paid" variant. Owner or design call; not changed here.
- **A shrinking escrow.** If extra coins vanish after a rebind (a reorg past 10 confirmations), the device's own size drops below the bound and the release stays refused. The status now shows no sum and the true state, `amount-out-of-range` (review m6). The buyer can still cancel before paid.
- **Starter caps.** The device does not know them, so the upward limit is its own escrow-funded size and the offer maximum, as for the amount before any bound (unchanged).
