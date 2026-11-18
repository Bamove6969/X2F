# Re-review: wip/lead-ruling-compliance-fix @aa149313 (base 455fab3d)

Reviewer: the same independent security reviewer (Claude), 18 Nov 2026. This re-reviews the fixes
for review-lead-ruling-compliance-2026-11-18.md (B1, m1-m5).

## Verdict: APPROVE (B1 fixed end to end; one follow-up recommended for m3, not blocking)

## B1, end to end: fixed

- **runtime.ts:** `restitution.amountAtomic` is now `deviceAcceptedAmount()`, the same value a
  release trusts. It is the bound amount, else the amount this seller fixed from the buyer's signed
  trade.paid (capped by its own funds), else the API's amount only within [take, own escrow-funded
  size]. When it is null there is no restitution and no form. The address is still
  `attested.buyerPayout` only.
- **DisputeSlot / DisputeRuling:** the form shows only when `sameAmount(payTo.amountAtomic,
  trade.amountAtomic)` holds, with a strict decimal parse of the server's figure. The server's
  figure is only compared, never displayed.
- **Grown trade:** the device's accepted amount is the grown amount and equals `amount_atomic`, so
  the form shows the grown sum and the proof is accepted. If the two amounts differ, there is no
  form, so the seller is never told to send a sum the server will refuse.
- **Attacker-API cases from round 1:**
  - **The view names another address:** no effect. The address is attested only (attestation-flow
    test).
  - **The view names an amount above this device's own size:** `deviceAcceptedAmount` is null, so
    there is no form (new attestation-flow case).
  - **The view names another amount once this seller fixed one:** no effect. The fixed amount wins,
    and if the amounts then differ there is no form (new case).
  - **The view's amount differs from the attested amount:** no form (dispute.test, disputeSlot).
  - **Residual, accepted:** before this device has fixed or bound an amount, a lying API can choose
    the amount shown anywhere in [take, the size this device worked out from its own funds]. The
    worst case is a seller paying up to what they themselves funded, which is the bound a release
    already trusts. This is not new trust.
- **Spec change:** the dispute.test 1.3-vs-1.25 case is now "no form", as the lead accepted. This
  is not a weakened test: the old assertion now lives in the equal-amount case, and the
  differing-amount case asserts that neither figure is shown as the sum to send.

## m1: fixed

`lost_since` is set on the first null check, kept while the tx stays lost and cleared once the node
knows it again. A tx is refused only after `PROOF_LOST_AFTER_MS` lost without a break. Editing
migration 740 in place is fine: it has not landed on main. Tests cover a tx lost at hour 30 and
then found again (accepted), and a tx lost again after being found (a fresh clock, then refused).

## m3: fixed as asked; the stuck-forever behaviour needs a watchdog (follow-up, not blocking)

The slot is now held until every monero-ts call the check started has settled, and the caller is
still answered at the timeout. That removes the overlap on the one WASM wallet (txProofCheck.test
covers it).

**The cost:** a call that never settles holds the slot forever. The queue fills, every new proof
gets 503 `busy`, and every pending recheck is skipped, until a process restart.

- **It is safe for money:** it fails closed. Nothing is accepted, and the lien is never repaid
  without a proof.
- **It is not fair to the seller:** a seller who has paid cannot prove it before `complyBy`. The
  lapse then fires, which goes to a senior and puts a suspension on the table, because of an X2F
  fault. Nobody is told the checker is stuck.

**Recommendation:** add a watchdog before mainnet. It can land as a follow-up.

1. If the slot has been held longer than `timeoutMs` plus a grace period (say 5 minutes in total):
   - give up on that wallet: set `wallet = undefined`, then call `close()` in the background and
     ignore its result;
   - release the slot, so the next check builds a fresh throwaway wallet.

   This is safe because the wallet holds nothing: random keys, never funded, never synced. A leaked
   stuck instance costs only memory. Count the abandoned wallets, and after 3 of them stop
   recreating and stay 503, so a wedged WASM runtime does not leak without bound.
2. Raise a pushed owner alert, `tx-proof-check-stuck`, once per stuck episode, so a restart happens
   before sellers' deadlines pass.
3. Owner question (do not decide in code): should a seller whose proof gets 503 near `complyBy` be
   shielded from the lapse? One option is to not mark the lapse while the checker is unhealthy, or
   to record a failed attempt so the senior sees "tried at 14:02, node unavailable". My
   recommendation: record a failed attempt in the senior's case view, and do not move the deadline
   automatically.

Optional, for later: `proxyToWorker: true` would let a stuck worker be terminated outright.

## m4: fixed

`PAYMENT_PROOF_BUCKET` allows 10 at once, then 1 a minute, per account. It runs after the session
check and before the node is asked, and answers 429 `slow-down`. Another seller is not affected
(test). The figure is a lead default.

## m5: fixed

The stale comment is removed.

## m2: added

New tests cover:
- two proofs at once, with two different txs or the same tx twice: exactly one is accepted,
  `complied` and logged once;
- two waiting proofs at once: exactly one waits;
- a forgotten tx: waits inside the window, then is refused, and the case lapses;
- a pending tx later found in a block older than the dispute: refused at the recheck.

## Runs (own worktree at aa149313)

- api vitest (nice, no lock): disputes/comply, disputes/txProofCheck (new), disputes/appeals,
  disputes/lien, disputes/trader, schema, watchReports: 7 files, 193/193 passed.
- web vitest (nice, no lock): dispute, disputeSlot, attestation-flow, useEscrow, SiteBanner,
  dispute-tripwires: 6 files, 217/217 passed.
- typecheck: apps/api and apps/web clean.
- regtest (under the lock, `--project @x2f/api-regtest`): txProof.regtest.test.ts, 1 file, 3/3
  passed.

Full `npm run check`: not run by this reviewer. The lead's landing run should cover it (the
13 Nov rule).
