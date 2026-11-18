# Review: wip/lead-ruling-compliance @455fab3d (against main 75f7b5b4)

Reviewer: independent security reviewer (Claude), 18 Nov 2026. One round; money code.
Scope: Plan 4 Task 12's missing parts (the seller's tx-proof route, comply lapse, owner alert and
push, the web proof form, the regtest test of the real checker) and Task 29 (the emergency stop on
the offer lists).

## Verdict: CHANGES NEEDED (one blocker: B1, the grown trade)

The server side is sound. I found no way to get a short, wrong-address, replayed or late payment
accepted, no race that accepts two proofs or none, and no path that repays the lien without an
accepted proof. The web form takes the address from the device-verified attestation only. The one
blocker is the amount the web form shows on a GROWN trade, the issue the builder flagged. It costs
the seller money: on a grown trade they pay the smaller take amount, the server correctly refuses
it as short, and the XMR they sent is gone to the buyer.

## B1 (blocker): a grown trade shows the take amount, not the trade amount

`runtime.ts` sets `restitution.amountAtomic = BigInt(this.attested.deal.takeAmountAtomic)`. A trade
grows when the seller funds more than the take amount before "I've paid": `amount_atomic` becomes
the grown amount and the take amount moves to `grown_from_atomic` (migration 112). The buyer paid
fiat for the grown amount, and the server checks the proof against `amount_atomic`, which is right.
On a grown trade the form tells the seller to "Send exactly" the smaller take amount. They send it,
the server answers 409 `proof-invalid` (received < amount_atomic), and that tx is spent. They cannot
top it up, because `judgeProof` counts what one tx paid, so they must send the whole grown amount
again in a new tx. The seller overpays by the whole take amount.

Fix (web only; the server's `amount_atomic` is the correct figure and stays):

1. `apps/web/src/escrow/runtime.ts`, `restitution`: use the device's own accepted trade size, the
   value it already uses for a release, instead of the take amount:
   ```ts
   const amt = this.deviceAcceptedAmount(); // bound, else fixed (acceptedAtomic: the buyer's signed
                                            // trade.paid amount capped by own funds), else the API's
                                            // amount only within [take, own device-grown size]
   restitution: this.attested !== null && this.rec?.role === 'seller' && amt !== null
     ? { address: this.attested.buyerPayout, amountAtomic: amt } : null,
   ```
   With this the API still cannot set the amount. At most it can choose a value between the take
   amount and the size this device worked out from its own escrow funds, and only while the device
   has not fixed an amount itself. That is the same bound a release already trusts.
2. `DisputeRuling` / `DisputeSlot`: show the form only when `payTo.amountAtomic` equals the trade's
   amount in the dispute view (`trade.amountAtomic`, the server's `amount_atomic`). When they differ,
   show no form, as when this device has no attestation. A form whose amount the server will refuse
   must never be shown. The server's figure is used only for this check, never as the amount shown.
   Whether a mismatch gets its own line ("this device's amount differs; contact the moderator") is
   copy for the owner (COPY-UNSIGNED until then).
3. Tests (RED first):
   - attestation-flow: a seller whose escrow is funded above the take amount, so the trade grows,
     has `restitution.amountAtomic` equal to the grown amount, not `takeAmountAtomic`;
   - the existing case still holds: a view naming a bigger amount than the device's size changes
     nothing;
   - dispute.test / disputeSlot: payTo differs from the view's amount, so no form.
   Note: today's dispute.test case renders payTo 1.3 XMR against a view of 1.25 and expects the
   form. Under fix 2 that case becomes "no form". This changes the spec, and is not a weakened
   test: the lead should say which rule they want.

## What I hunted and found sound

- **Short payment**: `judgeProof` requires `receivedAtomic >= amount_atomic`, which is
  `check_tx_key` on X2F's node for the buyer's address. regtest covers one atomic unit short, and so
  does comply.test.
- **Wrong address**: the node is asked only about `trades.buyer_payout`. The body takes exactly
  `{txHash, txKey}` and nothing else. Another address receives 0, so the proof is invalid (regtest
  and comply.test).
- **Replay**: `ruling_payments.tx_hash` is the primary key, across all disputes and statuses
  (refused included). `trades.tx_hash` (settlements) is also refused. A tx in a block older than
  `openedAt` is refused, at submission and again when a pending proof is rechecked (the `replayed`
  verdict falls through to refused). The dispute purge's cascade drops rows, but any later dispute
  opens after that tx was mined, so the age rule still refuses it.
- **Late**: `submittedAt` (server clock at request start) must be strictly before `complyBy`. It is
  checked before the node is asked and again inside the dispute transaction. A pending proof
  submitted in time can be accepted after `complyBy`. That is correct: the tx was already known to
  the node, because a null result at submission is invalid.
- **Two proofs racing**: the insert runs inside `withDispute`. `on conflict do nothing` covers both
  the PK and the partial unique index `ruling_payments_one_live`. A second accepted proof is refused
  by `complied`'s own rule (already complied). Pending recheck and lapse: both exclude each other
  through `not exists pending`, inside the update.
- **Reorg, or the node forgets the tx**: a tx back in the pool (confirmations 0, no block) stays
  pending. Unknown to the node (null) stays pending until 24 h after submission, then it is refused.
  Acceptance happens only at 10 confirmations, from the daemon's height (wallet2 `check_tx_key` uses
  the daemon height, not the unsynced wallet's). A recheck after an overturn is refused (`complied`
  throws, so `invalid`).
- **Lien repaid without a proof**: `complied` is a system-only event (`SYSTEM_EVENTS`), and its only
  caller is comply.ts, on an accepted verdict. lien.ts repays on `prev.compliedAt === null &&
  next.compliedAt !== null`. No staff route applies it.
- **API influence on the address**: the address is `this.attested.buyerPayout`, from the
  moderator-attested terms. The form is hidden without them, and a view naming another address
  changes nothing (attestation-flow test). The amount is B1.
- **Emergency stop by direct URL**: the API refuses takes (take.ts, `trading_paused for share`) and
  posts (offers/routes.ts), and lists nothing. On the web, Quote's `canTrade` and Post offer's button
  are both off under `tradingPaused`, and both show the message. The community links are kept only
  as https.

## Minors (do not block)

- m1. `PROOF_LOST_AFTER_MS` is measured from `submitted_at`, not from when the node first lost the
  tx. A tx that a node restart loses at hour 30 is refused on the first null, permanently (the PK),
  even if it is mined later. The lapse then goes to a senior, who can see the tx hash. This is
  acceptable, but measuring from the first null would be kinder.
- m2. No test for: two proofs submitted concurrently; a waiting tx the node forgets, first inside
  24 h and then after it; a pending proof rechecked when its block is older than `openedAt`. The
  code paths are simple, but they are untested.
- m3. `timed()` rejects on timeout while the monero-ts call keeps running on the same wallet, and
  the semaphore slot is released, so the next check can overlap it on one WASM wallet. Consider
  keeping the slot until the call settles, or recreating the wallet after a timeout.
- m4. The route has no per-account rate limit. Every proof costs a node round trip and a turn in the
  single-slot queue (32 queued, then 503 `busy`). One seller could starve other sellers' checks.
- m5. Stale comment: `cantDoCodes.ts` says "the form is not wired yet: NEEDS_TX_PROOF_WEB". It is
  wired now.
- m6. The form needs this device's attestation. A seller on another device, or after the record is
  forgotten, cannot submit at all from the web, and the case lapses to a senior. This is a product
  call, worth an owner line (recommendation: keep it so; never fall back to the API's address).
- m7. The block-timestamp age check uses the miner's timestamp, which can be off by up to about 2 h.
  This is harmless in practice: the payment follows a ruling made hours after the dispute opened.

## Tests weakened?

None. `dispute-tripwires.test.ts` loses the `NEEDS_TASK_12_TX_PROOF` tripwire, which existed to fail
when this route landed. dispute.test's form case is extended (attested address and amount, 1-17
chunk key), not loosened. site and schema tests only add the new field and the migration.

## Runs (this reviewer, own worktree at 455fab3d)

- api vitest (nice, no lock): disputes/comply, disputes/appeals, disputes/lien, disputes/trader,
  schema, watchReports: 6 files, 184/184 passed.
- web vitest (nice, no lock): dispute, disputeSlot, attestation-flow, useEscrow, SiteBanner,
  dispute-tripwires: 6 files, 214/214 passed.
- typecheck: apps/api, apps/web, apps/staff-web: all three clean (tsc --noEmit, exit 0).
- regtest (under the lock): apps/api/test/regtest/txProof.regtest.test.ts: 1 file, 3/3 passed (real monerod v0.18.5.3 regtest, 43 s). Note: `--config apps/api/vitest.regtest.config.ts <path>` finds no files (the config roots at apps/api); run it as `--project @x2f/api-regtest`.
- Full `npm run check`: not run. The verdict is CHANGES NEEDED; the re-review after B1 should run it.
