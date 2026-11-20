# Review: wip/lead-fix-noshow-refund at 831698d3 + d56526d3 (vs origin/main 0c5dc3d3)

Reviewer: independent security review helper, 20 Nov 2026 (BC time, UTC-7).
Scope: the no-show refund fix (gap 4). That covers `PartyHandle.settleSent()` (packages/escrow/src/party.ts), `EscrowStatus.handedOff` (apps/web/src/escrow/runtime.ts), the `HandOff` copy in SellerRefund.tsx, and the e2e branch wip/lead-fix-noshow-refund-e2e at 47b2fee5. The e2e branch's fix commit 4728cd17 has the same content as 831698d3.

## Verdict: NOT APPROVED YET. No blockers and no funds at risk at either head. M1 must be dealt with before landing; d56526d3 adds minors only (m6, m7).

The fix does its main job. The seller is told to keep the page open while the seller-built refund still needs this device. `settleSent()` and `handedOff` are pure reads: they sign nothing, send nothing and change nothing. No path to funds changes: release, ruling, lapse or refund-after-dispute.

The problem is the moment the copy says "You can close this page now". A seller who closes the page then, and opens the trade again after it closes, gets a permanent integrity `escrow-failed` on a refund that landed correctly. I reproduced this in a scratch runtime test (see M1). The builder's follow-up is real, and it is wider than reported. It is not limited to "closed before DONE": the path the new copy invites hits it too.

## Findings

### B: Blockers
None.

### M: Majors

**M1. "You can close this page now", followed by reopening the trade after it closed, gives a permanent false integrity failure. The builder's follow-up also hits releases, lapse refunds and buyer cancels.**
- The trigger is `handedOff` going true (runtime.ts:422-427, via party.ts:1313-1318). It goes true when the moderator's DONE is stored, before the tx is in a block. The seller closes the page then, as SellerRefund.tsx:352 invites.
- The rest happens without the seller. The moderator's watcher sees the sweep, the API closes the trade (`refunded`), and the relay channels close (packages/trade/src/watch.ts:342). The relay drops its queue on close (apps/relay/src/server.ts:103-116).
- Then the seller opens the trade again, for example to watch the 10 confirmations the Refunded view counts.
  - runtime.ts:754 hands the stored outcome back only through `settle()`. `settle()` runs `cosignPolicy` against the closed view (runtime.ts:931).
  - `route('auto-refund')` requires `state === 'settling'` (policy.ts:185), so the outcome is refused and the party is never given its `settleOutcome`.
  - The party's `advanceRelease` returns at once without one (party.ts:786-788). So the stored DONE is never checked against the chain (party.ts:842-863), and `intent.done` stays false.
  - In `afterClose` (runtime.ts:1208, 1229-1235), `emptyInBlock && !ownDone && ownOpen` starts the settled-elsewhere clock. After `settledElsewhereMs` (5 min) it calls `fail('escrow-failed', { integrity: true })`.
  - The failure is saved in `rec.failed`, so it is never retryable. The store is never deleted, because `close()` needs `!this.error`. TradeGlance.tsx:62 shows "The escrow stopped on this device" for a completed refund. The Refunded screen itself still shows confirmations.
- Reproduction: I appended a scratch `it.each` to apps/web/test/attestation-flow.test.ts and did not commit it. It does a seller auto-refund through `build-refund`, with `parties.sent.seller = true` until `handedOff`. It then calls `stopAll()`, sets the view to `refunded` with an empty escrow, and resumes. Result: `settle()` is not handed to the party again on resume, and after the grace the phase is `{"phase":"error","error":"escrow-failed","retryable":false}`. The result is the same with and without the stored DONE.
- Same root cause for other builders (pre-existing on main): the builder is the seller in release and lapse-refund, and the buyer in buyer-cancel. Their routes are state-gated (policy.ts:122/183 `RELEASE_STATES` has no `released`; :184 `lapsed`; buyer-cancel states). A builder that closed before its own settle resolved, and comes back after the close, fails the same way. Seller release case: Released.tsx:38 hides it (`settled`), but the glance and the kept store do not. mutual-cancel happens to resume, because policy.ts:180 has no state gate. Co-signers are not affected, because they mark done on their own submit.
- Severity: no funds lost or at risk. The tx landed exactly as built. But an integrity failure is the signal the app keeps for attacks (settled elsewhere). Showing it for good on a successful refund or release will cause support load and loss of trust, and may lead a user to dispute. Before this branch the refund path reached it only by chance. Now the copy steers the seller onto it.
- Fix. Either a or b is enough to land. c is the real fix.
  - a. Smallest change, safe now (the wording is the owner's call, COPY-UNSIGNED). Show "You can close this page now" only on `escrow.phase === 'done'`, the device's own settle verified in a block (SellerRefund.tsx:349). While `handedOff && phase !== 'done'`, say something like "The moderator has sent the refund to the network. Keep this page open until it is in a block (a few minutes)." `phase` done means `intent.done` is saved, and `afterClose` then sets `settleSeenAt`. No false failure is possible on that path. Closing early still only pauses the refund while the trade is open: the relay queues the DONE.
  - b. Runtime-only alternative. In `afterClose`, before starting `emptiedWhileSettling` for an `ownOpen` intent, call a new read-only party method `landed(outcome): Promise<string | null>`. It returns the release's tx hash when the party can prove from the chain that its own committed release landed. If it returns a hash, set `intent.done = true` and `settleSeenAt`. Only an emptying that cannot be proven then counts as settled elsewhere. This needs no relay and no API, and never reopens signing after close. Do not loosen `cosignPolicy`'s state gate on resume: it would let a closed trade start a new attempt (fresh export and build) from a stored next-attempt export.
  - c. The proof in `landed()`, also used in the builder's 'built' branch (party.ts:842-863):
    1. With a stored DONE: `spentBy(tx) && txSeen(tx)`, as today.
    2. Without one, for a builder in `built` with a saved `rel.txKey`: for each confirmed `daemon.outgoing()` tx, `proveTx(h, rel.txKey, o.to.map(p => p.address))` must return `inBlock && spendsEscrow` and amounts matching `o.to` (fee off `to[0]`, as at party.ts:1411). A tx secret key only fits the tx built with it, so this proves "my built set landed" without anyone's word. It fixes the builder's own follow-up: closed before DONE, returning after close.
    3. Run the same txKey proof on a DONE before accepting it. Today the builder accepts any confirmed spend of the escrow that the co-signer names (see m4).
- Tests to add:
  - attestation-flow: handedOff, stop, closed and emptied, resume. Expect `done`, never `escrow-failed`. Variants: with and without the DONE, and a seller release.
  - escrow regtest: a seller-built refund with the seller party stopped after `built`. The moderator submits and mines. A restarted seller (no relay messages) resolves done by txKey proof.

### m: Minors

**m1. The regtest test does not pin the core guard: false while `built` before DONE.** packages/escrow/test/incoming.test.ts:181 asserts false only in phase `export`. After that it polls for true (:186), so dropping the DONE check from party.ts:1317 is not caught. Proof: guard revert G1 below. Fix: hold the moderator's `release.done` frames (wrap its transport), wait for the seller's `release.phase === 'built'`, assert `settleSent()` is false, then let DONE through.

**m2. "Verified" overstates what `settleSent` checks.** It goes true on a DONE that was authenticated and bound to this outcome, not checked on the chain. That is the co-signer's signed claim (party.ts:167-176 says "the co-signer submitted the signed tx"). `wellFormed` does not even require a hex `txHash` (party.ts:371). The copy "the refund has been sent to the network" (SellerRefund.tsx:352) states the moderator's claim as fact. Fix: word the doc and the copy as the moderator's report ("The moderator has sent the refund…"). This is an owner copy question.

**m3. `settleSent()` is not tied to the outcome the runtime is settling.** party.ts:1313 reads whatever `state.release` is, and runtime.ts:422-427 pairs it with `rec.intent`. It is safe today: after commit the party refuses another outcome, so the committed one is what lands. But it would be stronger as `settleSent(outcome)`, comparing `outcomeDigest`.

**m4 (pre-existing, outside the diff).** The builder's done check (party.ts:842-863) accepts any in-block tx that spent the escrow, if the co-signer names it. It does not check that the tx pays the outcome. So a moderator and buyer spending elsewhere and naming that tx in the DONE makes the seller's device show `done` instead of the settled-elsewhere alarm. This is detection only: mod plus buyer is 2-of-3 by design. M1 fix c.3 closes it.

**m5. The "stopped" copy misleads in two cases** (SellerRefund.tsx:337-347).
- "The refund is waiting for it" also shows for a non-retryable integrity error (settled-elsewhere, equivocation), where no refund from this device will come.
- It also shows for an error after hand-off (for example `funds()` failing after the DONE), when the refund no longer needs the device.

It errs on the safe side, never "close". This is an owner copy question.

**Note (pre-existing liveness, not this diff).** After a co-signer's `done`, nobody resubmits its tx if the pool drops it. The builder has no signed hex. The seller's open page cannot help either, so the "can close" copy is not wrong about that.

## Checks asked for

1. **`settleSent()` signs, sends and changes nothing: confirmed.** party.ts:1313-1318 only reads, with optional chaining and no `??=`. It tolerates state that has not loaded yet. It does not run on the `chain` queue and makes no daemon call. `handedOff` (runtime.ts:422-427) is a pure expression inside `status()`. None of the other changes touches settle control flow (useEscrow, worker, seams, refundSlot) or the CSS.
2. **What makes it true:** `rel.phase === 'done'`, or builder and `phase === 'built'` and `state.received[release.done:<tag>.0][counterpart]` set.
   - That entry is set only by `onMessage` (party.ts:1123-1175) after `open()` checks the signature, participants, trade and replay. `from` must be the release counterpart, and the key must carry this outcome's tag. The entry is saved before it is acted on, so it survives a restart.
   - Relay: cannot forge a DONE or move it to another trade or outcome. It can only hold one back, which keeps "keep open" showing: the safe direction.
   - API: has no input into `settleSent`. The view only picks the screen, and `handedOff` also needs this device's own intent outcome.
   - Lying moderator: can make it true early. The moderator is the co-signer and can send a signed DONE with any txHash. Effect: the copy says close and the refund stalls. The moderator could stall it anyway by not co-signing. The party still requires `spentBy && txSeen` before `done`, so nothing more is signed or paid. **The builder's claim (it only stalls) is confirmed.** One caveat: if the moderator later opens a new attempt, a closed page delays it until reopened. While the trade is open the relay queues, so reopening recovers.
3. **Funds: none at risk on any path.** These are reads used only by copy. Release, ruling (moderator-built, party.ts outcomeRefusal), lapse and refund-after-dispute all run exactly as on main. The co-signer still marks done only after submit (pool or block). After a commit, an outcome switch is still refused.
4. **After-close rule: see M1.** It is worse than reported, because it is also reached after "You can close". The fix is given there.
5. **Copy never says close while closing stalls: holds, except for a lying or buggy moderator,** which stalls either way. `HandOff` shows "can close" only on `handedOff || phase === 'done'`, never during idle, signing without DONE, or an error. Covered by sellerRefund tests. The "can close" moment does lead to M1 on return.
6. **Guard reverts (each applied alone, then restored with git checkout):**

| # | Revert | Result |
|---|---|---|
| G1 | party.ts:1317 drops the DONE check (`builder && built` alone) | **NOT caught**: settleSent regtest test passes (see m1) |
| G2 | party.ts:1317 reads its own role's DONE, not the counterpart's | caught: settleSent regtest test fails (`expected false to be true`) |
| G3 | runtime.ts:423 drops `if (this.error) return false` | caught: attestation-flow "handedOff is false with no settle under way…" fails |
| G4 | runtime.ts:425 drops the no-outcome guard (`i?.done === true \|\| settleSent`) | caught: same test fails |
| G5 | runtime.ts:426 ignores settleSent (`return i.done`) | caught: both handedOff tests fail |
| G6 | SellerRefund.tsx:337 stopped branch disabled | caught: sellerRefund "escrow stopped" test fails |
| G7 | SellerRefund.tsx:349 "can close" on `phase !== 'idle'` | caught: sellerRefund "still signing" test fails |
| G8 | SellerRefund.tsx:306 `<HandOff>` removed | caught: 4 sellerRefund tests fail |


## Follow-up commit d56526d3: beforeunload leave warning (useLeaveWarning)

The lead asked for this commit to be covered here. It adds apps/web/src/ui/useLeaveWarning.ts. The hook is used in:
- SellerRefund `Refunding`: `stillNeeded`, meaning no error, `!handedOff` and phase not `done`;
- SellerConfirm: `signing && !stopped && handedOff !== true`;
- Released, for the buyer's co-sign: `buyer && !cosigned && problem === null && phase === 'signing' && handedOff !== true`.

**It cannot keep a page open forever.**
- The hook only registers a `beforeunload` listener that calls `preventDefault()`. The browser then shows its own "Leave site?" dialog, and the user can always choose Leave.
- No `unload` work, no loop, no `confirm()`, and no history trap.
- The listener is removed when the condition goes false, and on unmount (the effect's cleanup is keyed on `active`). Reverting that cleanup makes 3 tests fail (L2 below).

**It cannot block a ruling or refund flow.**
- The warning only fires on a full-page unload. The trade flows navigate inside the app: `setNavigator` with the router, and `<Link>`.
- The only full-page navigations in apps/web/src are client.ts:43, the fallback `browserGo` (used only when no navigator is set), Login.tsx:424 and Terms.tsx:195. None of them is on a trade screen while a warning is active.
- A dispute or ruling moves the view out of `settling`. SellerRefund.tsx:77 and release/slots.tsx:50-72 then unmount `Refunding`, `SellerConfirm` and `Released`, and the listener goes with them.
- No settle logic changed.

**m6 (new, also in 831698d3's copy): on a device that does not hold the escrow, Refunding keeps the page open and warns for nothing.**
- `stillNeeded` (SellerRefund.tsx:340-342) and `HandOff` treat `phase === 'idle'` as "still needed".
- SellerConfirm itself reads idle as "not on this device" (`notHere`, SellerConfirm.tsx:117).
- So when a seller opens the settling trade on a second browser or phone, two things go wrong:
  - the page says "Keep this page open while this device signs the refund", which this device can never do;
  - every tab close prompts. That lasts while the trade stays settling, and the trade may stay settling precisely because the original device is closed.
- The sellerRefund test "before the escrow runs on this page (idle): keep the page open too" pins this behaviour.
- Fix: treat `idle` as not needed here. Instead, say "this refund is being signed on the device you started the trade on: open it there" (owner copy). A short idle on the right device, before the worker's first status, is not worth a prompt.

**m7: a test gap.** Dropping `problem === null` from Released.tsx:42 is not caught (L3). A refusal during `signing` (for example `amount-changed`) would then keep warning while the device can do nothing. Add a case with `phase: 'signing', refusal: 'amount-changed'`.

**Note: the buyer's warning can last a long time.** Released warns while the buyer is in `signing` and the seller has not built yet: until the seller's device returns. That is correct, since leaving does stall the co-sign, but it can last hours. It is not a blocker; the owner may want an "until when" line.

Leave-warning reverts:

| # | Revert | Result |
|---|---|---|
| L1 | SellerConfirm.tsx:122 ignores `handedOff` | caught: release.test "…until handedOff…" fails |
| L2 | useLeaveWarning.ts:19 cleanup does not remove the listener | caught: 3 tests fail (sellerRefund and release) |
| L3 | Released.tsx:42 drops `problem === null` | **not caught** (m7) |

Tests at d56526d3, targeted vitest with nice, outside the lock: sellerRefund, attestation-flow, useEscrow, tradeRoomEscrow, refundFlow and release. **6 files, 243 passed, 0 failed.**

## Tests run (rev-noshow worktree at 831698d3, then d56526d3; e2e in rev-noshow-e2e at 47b2fee5, which predates d56526d3)

- Targeted vitest, outside the lock with `nice -n 10`: sellerRefund, attestation-flow, useEscrow, tradeRoomEscrow and refundFlow. **5 files, 183 passed, 0 failed.**
- Under the lock: packages/escrow incoming.test (regtest). **1 file, 5 passed, 0 failed** (235 s). party.ts is identical at d56526d3, so this covers both heads.
- Under the lock: e2e `trade.e2e -g "buyer no-show"` from 47b2fee5. **4 passed** (phone and desktop, for both tests; 12.4 min). Neither test reopens the trade after it closed, so neither exercises M1. Add that case once M1 is fixed.
- Not run: full `npm run check`. I am not approving, and disk was at about 2.7 GB free.

## Owner and lead questions
1. M1 fix a: may the "can close" line wait for the refund to be in a block, with an interim "the moderator has sent it, keep open a few minutes" line? (COPY-UNSIGNED; I recommend yes.)
2. m2 and m5 wording: say "the moderator has sent the refund" rather than "has been sent". In the stopped state, separate "waiting for this device" from "stopped for good".
