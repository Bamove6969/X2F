# Review: wip/lead-fix-noshow-refund at ad96e350 (vs origin/main 7060191b), e2e companion at 20556742

Reviewer: independent security review helper, 21 Nov 2026 (BC time, UTC-7).
Scope: `git diff origin/main...ad96e350`, which covers:
- node-proxy `/gettransactions`;
- `PartyHandle.landed`, `settleSent`, `keyProof`, `keyAllows` and the m4 check (packages/escrow/src/party.ts);
- `txKeyPays` (packages/escrow/src/monero.ts);
- the export resend 27b5a083;
- runtime `afterClose` and `handedOff` (apps/web/src/escrow/runtime.ts);
- the refund, release and leave-warning copy.

From 20556742 I read only the regtest e2e harness and specs that differ from ad96e350.

Previous round: review-lead-fix-noshow-refund-2026-11-20.md (M1, m1-m7). Its M1 (fixes a, b and c) and m1 to m7 are dealt with at this head. Two new issues sit in the M1 fix itself.

## Verdict: CHANGES NEEDED

There are no blockers. No path makes money move wrongly: every signing, building and submitting path is unchanged except the export resend, which is harmless. But `landed()` can return "proven" for an outcome that did not pay its payouts, so a device can wrongly show done:
- **N-M1:** a co-signer takes the builder's DONE as its proof. A seller and moderator who spend a release elsewhere can silence the buyer device's settled-elsewhere alarm.
- **N-m1:** on dust trades (payout 0 at or below 0.01 XMR), the builder's tx-key check proves nothing, so m4 is not closed for them.

Both are two-line fixes. I applied both temporarily: the probes and the whole incoming regtest file passed with them (9/9).

## Findings

### B: Blockers
None.

### M: Majors

**N-M1. `landed()` takes the builder's DONE as proof for a co-signer, which suppresses the co-signer's settled-elsewhere alarm. This is new in this branch.**
- Where: packages/escrow/src/party.ts:842 (`named` always includes `state.received[doneKey(rel)][rel.counterpart]`) and :832 (`keyAllows` returns true whenever `rel.part !== 'builder'`).
- How it works:
  - For a co-signer, `rel.counterpart` is the builder. `onMessage` (party.ts:1238-1255) stores any `release.done:<tag>.0` frame signed by the counterpart. Nothing checks that the sender is the co-signer, and `wellFormed` (:394) is role-blind for DONE.
  - A legitimate builder never sends a DONE. The only DONE a co-signer can hold is therefore one the builder chose to send.
  - `landedNow` then returns that hash once the co-signer's wallet shows the escrow spent by it in a block (`spentBy`) and the daemon has it (`txSeen`). Nothing checks that the tx pays `o`.
- Attack (web): a release has builder seller and co-signer buyer.
  - The seller and the moderator spend the escrow elsewhere (2-of-3, for example back to the seller). The moderator's watcher closes the trade as released, and the seller sends the buyer a signed DONE for the release's tag naming that tx.
  - The buyer's device had not yet submitted (it was in export or cosigning, or closed). In `afterClose` (runtime.ts:1394-1415) it has `emptyInBlock && ownOpen`, and `party.landed(o)` returns the theft tx.
  - Result: `intent.done = true`, `settleSeenAt` set, phase `done`. The integrity alarm ("settled elsewhere", escrow-failed) that main raises after 5 min never comes. Released.tsx shows the release as done to a buyer who received nothing.
  - The precondition `spentBy(theft) == true` is not extra. The device runs `landed()` only when its wallet already sees the escrow emptied (`emptyInBlock`), and the same wallet view gives `spentBy` for the emptying tx. Forged partial key images can also produce it (payouts.ts:99-101).
  - The same holds for any web co-signer, for example the seller co-signing a buyer-built settle.
- Impact: detection only. Seller plus moderator can already spend by design. But this alarm is the buyer device's own independent signal for exactly that case. main raises it; this branch removes it.
- Proof (probe, not committed): packages/escrow/test/probe-noshow.test.ts P1, on regtest.
  - The buyer co-signs `a` (seller-built). The seller and moderator settle `b` to another wallet. The buyer's wallet view reports `b` spending the escrow.
  - `landed(a)` is null before the DONE (a control). After a DONE signed by the seller naming `b`, it returns `b`'s hash. The probe fails at ad96e350 with `expected 'd7bdcafb…' to be null`.
- Fix (party.ts:842): a co-signer's only proof is the tx it signed itself (`rel.txHash`, whose payouts `checkRelease` and `signRelease` checked).
  ```ts
  const named = [rel.txHash, rel.part === 'builder' ? state.received[doneKey(rel)]?.[rel.counterpart]?.payload.txHash : undefined].filter(...)
  ```
  Better still, also ignore a DONE from a builder in `onMessage` (only a co-signer sends one), so it is never stored. With the one-line change, P1 passes and so does the whole incoming.test.ts.
- Test to add: P1 as a regtest case in incoming.test.ts. In attestation-flow, add a co-signer (buyer, release) back after close whose party reports no proof. It must still go to escrow-failed.

### m: Minors

**N-m1. The payout-0 fee allowance makes the tx-key check vacuous on dust trades.** packages/escrow/src/party.ts:822.
- The check is `received[i] + (i === 0 ? MAX_NETWORK_FEE : 0n) >= amountAtomic`, and MAX_NETWORK_FEE is 0.01 XMR.
- wallet2's `check_tx_key` does not check that the key belongs to the tx. A key from another tx comes back "good" with `received = 0`, which the wallet.test case also pins: `wrong === null || wrong.received === 0n`.
- So for any refund (one payout) of at most 0.01 XMR, any confirmed spend of the escrow passes `keyProof`.
  - The m4 check (:936) accepts a moderator's DONE naming another spend, and `landed()` proves it.
  - Above 0.01 XMR, payout 0 can still come up short by as much as 0.01 XMR beyond the real fee and pass.
- There is no trade floor (offerRange.ts:66-70 only requires an amount above 0 and one fiat cent).
- Proof: probe P2. A 0.005 XMR escrow, a moderator's DONE naming a buyer+moderator spend to another wallet: `landed(a)` returns that tx (`expected '6004d685…' to be null`).
- Impact: detection only. It needs the moderator and the buyer (2-of-3), and only small sums.
- Fix:
  - Minimum: require `received[i] > 0n` for every payout. The probe passes with that.
  - Better: bound payout 0's shortfall by the tx's actual fee, as the moderator's `sweepMinimums` does (payouts.ts:115, "short by exactly the tx's fee"). For example, have `txKeyPays` also return the tx fee (the wallet's tx record), then require `received[0] + fee >= amount[0]` with `fee <= MAX_NETWORK_FEE`.

**N-m2. Test gaps: three key protections are not pinned (guard reverts E2, E4 and W8 below pass).**
- E2: party.ts:833. `keyAllows` taking `'unavailable'` as proof (`!== false`) is not caught. No test drives `txKeyPays` to `'unavailable'`. Add an incoming case with a session proxy whose `txKeyPays` returns `'unavailable'`: the DONE is never accepted, `landed` is null, and both turn true once it answers.
- E4: party.ts:849. Dropping `provenByKey` from the without-DONE (`outgoing()`) path is not caught. Every `landed` assertion there either has the right tx named or no release. Add, to the m4 test, `landed(a)` null before the forged DONE is injected: the seller's outgoing list then holds `b` unnamed.
- W8: runtime.ts:1403. `landed()` rejecting being taken as proof (`.catch(() => 'x')`) is not caught. Add an attestation-flow case where `landed` rejects: the device still goes to escrow-failed after the grace.

### n: Nits and notes

- **n1. Dead copy branch.** SellerRefund.tsx:359-361 ("The moderator has sent the refund, so it no longer needs this device…") is never shown. `handedOff` is false whenever `this.error` is set (runtime.ts:439), and useEscrow's `error` is the runtime's `status.error` (useEscrow.ts:147). Drop the branch or feed it a different signal. It is harmless.
- **n2. Rebind race, safe direction.** `afterClose` asks `landed(prior)` only when `releaseRebindRefused` is set (runtime.ts:1398). Take a device closed after the rebind was saved but before its party's refusal came back. If it returns after close, it never sets the flag, because a closed trade's outcome is not handed back, so it will raise a false settled-elsewhere alarm if the prior landed.
  - Revert W2 (ask the prior whenever `releasePrior` is set) passes every test. It is not a weakening: it still needs chain proof of an outcome this device approved.
  - The lead may prefer W2's form. It is a very narrow race.
- **n3. One block is enough** for done and `settleSeenAt` (`spentBy` requires in-block). This is the same depth main used for the DONE path, and "The refund is in a block" is literally true. Noted, not new.
- **n4. `keyProof` rejects a tx still in the pool** (`inPool`, party.ts:821). That is belt and braces under `spentBy`; revert E6 is not caught, and that is acceptable.

## Checks asked for

1. **node-proxy `/gettransactions`: confirmed exact alias, nothing else widened.**
   - The only change is one JSON_PATHS entry (server.ts:90). It forwards to the constant `${base}/gettransactions`, the same constant-path forwarding as the other JSON paths.
   - It goes through the same `jsonBody` re-serialisation, the same 1 MiB `bodyLimit`, the 20 s upstream abort, `maxInFlight` and `maxUpstream`, and the same Origin check.
   - monerod maps `/get_transactions` and `/gettransactions` to the same `on_get_transactions` handler, with the same restricted-RPC limits.
   - `decode_as_json` and `prune` were already reachable through `/get_transactions` with the same bodies, so the alias adds no work the node could not already be asked for.
   - proxy.test fails both when the entry is removed and when another path is added beside it (exact list).
   - wallet.test runs `check_tx_key` through the proxy against a restricted node: good, the right amount, and a key from another tx never proves anything.
2. **`landed(o)`:**
   - Builder with its tx key: it needs `spentBy` + `txSeen` (in a block, the wallet's own view plus the daemon) and the key check. This holds except on dust (N-m1).
   - Co-signer: not safe (N-M1).
   - The without-DONE path (outgoing txs plus the key) is sound apart from N-m1, but unpinned (E4).
   - A read that fails: `'unavailable'` maps to false in both `keyAllows` and `provenByKey`. Timeouts throw `daemon-unavailable`, which `advance` retries and `afterClose` treats as unproven (`.catch(() => null)`). A refused read is never counted as proof, but that is unpinned (E2).
   - `landed()` is read-only. It syncs and reads, and never exports, imports, signs or sends. It runs on the `chain` queue and rejects like `funds()`.
3. **The m4 check:**
   - A mismatched key: not proven.
   - A key from another tx: `received = 0`, not proven above 0.01 XMR (the m4 regtest and the wallet.test case).
   - Right addresses with wrong amounts: refused unless the shortfall is on payout 0 and at most 0.01 XMR (N-m1).
   - `keyAllows` returns true only with no `txKeyPays` (test doubles, since MoneroMultisigSession has it in Node and the web bundle) or no saved `txKey`. A seller-built release always saves one when the engine returns it.
4. **`txKeyPays`** (monero.ts:291-311):
   - Inputs are checked before the WebAssembly call: `TX_HASH` and `isTxKey` (a reduced scalar, as in `proveTx`).
   - It returns one `received` per address in order. `getIsGood() !== true` gives null, any pool hit gives `inPool`, and a timeout rethrows as an EscrowError.
   - Error mapping: only "failed to get transaction from daemon" gives `'unavailable'`; anything else gives null. Both are false for the party, so a wrong mapping can only delay, never prove.
   - Caveat: `getIsGood` is true for a key that does not belong to the tx (wallet2 never checks the key against the tx pubkey). The amount check is the real proof, hence N-m1.
5. **The export resend (27b5a083, party.ts:909):**
   - `send()` only ever sends `state.sent[key]`, the export saved and persisted at party.ts:886-887 before it first left the device.
   - It is the same frame `resend()` already sends every tick in any phase after waiting-funds (party.ts:553). It goes under a fresh seq, signed and sealed for this trade, and keyed by this outcome's tag and this attempt.
   - The receiver accepts a (sender, key) once and drops duplicates (party.ts:1245-1250). It cannot be confused with another release or attempt (the key carries both), and replaying it changes nothing.
   - Nothing unsaved is sent. Revert E5 is caught.
6. **runtime `afterClose`:**
   - It marks done only on `landed()` proof for the stored intent's outcome, or, after a refused rebind, the saved prior: the outcome the party is committed to and this device approved earlier.
   - `intent.outcome` is rewritten only to that proven candidate (W3 is caught).
   - With no proof, or a rejection, it falls through to the settled-elsewhere clock and escrow-failed, as on main (W1 is caught; the rejection case W8 is not pinned).
   - It hands no outcome to the party and loosens no `cosignPolicy` gate. Unproven emptying still alarms, except where N-M1 forges the proof.
7. **The copy (COPY-UNSIGNED): nothing says it is safe to close before it is.**
   - "You can close this page now" shows only on phase `done`: the device's own settle seen in a block, through the m4 check. W7 is caught.
   - After the moderator's DONE the page says "The moderator has sent the refund. Keep this page open a few minutes while it confirms": worded as the moderator's report (old m2 done).
   - `idle` now says the escrow is not on this device, with no leave warning (old m6 done).
   - A non-retryable error says "stopped for good… open a dispute" (old m5 done).
   - The leave warnings (useLeaveWarning) are unchanged from d56526d3 apart from the `idle` fix.
   - Caveat: on a co-signer device, N-M1 could make a release falsely show done. No refund screen is affected, because the seller builds the no-show refund.

**e2e companion (20556742): test-only, cannot reach a production build.**
- The diff from ad96e350 touches only apps/web/e2e/* (the regtest config, specs, kit and stack shims) and tools/regtest/e2e/* (stack.ts, modState.ts, fixed-prices.mjs, foreignIdentity.ts).
- No file under apps/*/src or packages/*/src imports them (git grep).
- Vite builds from index.html and src only. playwright.config.ts now ignores `*.e2e.spec.ts`.
- `modKeystoreKey` is a fresh random `key32()` per stack run, given to the moderation process as MOD_KEYSTORE_KEY there and used only by modState.ts. modState.ts reads the moderator's sealed state with the existing `loadEscrow` and writes nothing.
- modState sits in tools/ because apps/web may not load moderation code (separation-check).
- No apps/moderation source changed.

## Guard reverts (each applied alone, then restored with git checkout; worktree clean afterwards)

| # | Revert | Test | Result |
|---|---|---|---|
| E1 | party.ts:832-833 `keyAllows` always true (drop m4) | incoming m4 | **caught** (never reached the key check; seller went done) |
| E2 | party.ts:833 `'unavailable'` counts as proof (`!== false`) | incoming m4 | **not caught** (N-m2) |
| E3 | party.ts:822 no amount check (`return true`) | incoming m4 | **caught** (`expected 'done' to be 'built'`) |
| E4 | party.ts:849 outgoing path without `provenByKey` | incoming settleSent/landed and m4 | **not caught** (N-m2) |
| E5 | party.ts:909 export resend removed | incoming "goes again with the tx set" | **caught** ("the moderator waited for a resend") |
| E6 | party.ts:821 `inPool` accepted | incoming settleSent/landed | not caught (belt and braces, n4) |
| P1 | node-proxy server.ts:90 `/gettransactions` removed | proxy.test | **caught** |
| P2 | node-proxy JSON_PATHS widened by one extra path | proxy.test | **caught** |
| W1 | runtime.ts:1409 done without proof | attestation-flow | **caught** (9 fail) |
| W2 | runtime.ts:1398 prior asked without `releaseRebindRefused` | attestation-flow | not caught (not a weakening, n2) |
| W3 | runtime.ts:1410 keeps `intent.outcome`, not the proven one | attestation-flow | **caught** |
| W6 | runtime.ts:439 `handedOff` ignores the error | attestation-flow | **caught** |
| W7 | SellerRefund.tsx:381 "can close" also on `handedOff` | sellerRefund | **caught** |
| W8 | runtime.ts:1403 a `landed()` rejection counts as proof | attestation-flow | **not caught** (N-m2) |

## Tests run

- Targeted vitest at ad96e350, outside the lock with `nice -n 10`: attestation-flow, sellerRefund, release, useEscrow, tradeRoomEscrow, buyerPay (**6 files, 358 passed, 0 failed**); refundFlow (**13/13**); node-proxy proxy.test (**30/30**).
- Under ~/x2f-comms/check.lock:
  - packages/escrow incoming.test.ts (regtest): **7/7 passed**.
  - node-proxy wallet.test.ts (restricted regtest): **1/1 passed**.
  - Probes P1 and P2: **2 failed at ad96e350** (the findings).
  - With both proposed fixes applied temporarily: probes plus incoming.test **9/9 passed**.
- Regtest e2e at 20556742 under the lock, `-g "buyer no-show|taker seller, poster buyer"`: **10/10 passed** in 49.9 min. That is phone and desktop, for: the seller-built release (taker seller, poster buyer) and the four no-show tests (says it may close only in a block; closed after the moderator sent it, then reopened after close: done; closed before the DONE, then reopened after close: proven by the tx key, done; closed early, then reopened: finishes). So the m4 key check works in the browser through the proxy (no liveness regression). None of these exercises N-M1 or N-m1: neither has an attacker.
- Not run: full `npm run check`. I am not approving.

## Owner and lead questions

None for the owner. Both fixes are engineering and change no copy.

For the lead:
- Take N-M1's fix (and drop a builder's DONE in `onMessage`) and N-m1's fix (at least `received > 0`; better, the real fee).
- Add the N-m2 tests, then ask for a short re-review.
