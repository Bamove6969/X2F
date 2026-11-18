# Re-review: wip/lead-tx-proof-watchdog @0a61855e (2 commits on aa149313)

Reviewer: the same independent security reviewer (Claude), 18 Nov 2026. This reviews the m3
follow-up recommended in re-review-lead-ruling-compliance-2026-11-18.md.

## Verdict: APPROVE (minors only). This branch can land for ruling compliance.

## Can two checks ever share a wallet? No.

- **The slot:** `Semaphore(1, 32)` admits one check at a time. The watchdog runs inside the slot
  holder, and `abandon()` drops `wallet` before that holder releases the slot. The next check's
  `walletOf()` therefore always builds a fresh wallet. The abandoned wallet's late calls run only on
  that dropped instance, which is closed in the background once it settles.
- **The wallet-creation fix:** the `made.catch` now clears `wallet` only when `wallet === made`. A
  late creation failure can no longer clear a newer wallet.
- **Bounded answers:** each part of `checkOne` has its own limit (`block()` has AbortSignal.timeout,
  and `walletOf` and `checkTxKey` go through `timed()`). The caller's answer therefore always settles
  within about 3 x timeoutMs. The watchdog only bounds how long the slot is held after that.
- **At the cap:** `abandoned >= TX_PROOF_MAX_ABANDONED` is checked both before queueing and inside
  the slot, so a check that waited while the last wallet was abandoned never builds a 4th wallet.

## Can an abandoned wallet accept a proof late? No.

The caller's promise settles exactly once, at the timeout at the latest, with TxProofUnavailable,
and the route has already answered 503. A `checkTxKey` result that comes in later resolves only the
inner promise that already lost the race, so it reaches no caller and no database write. The pending
recheck is the same: after a timeout it `continue`s, and the next pass re-asks a fresh wallet.

## Attempts: sound

- **What a row holds:** `ruling_payment_attempts` stores only `(code, seq, at, reason)`, with reason
  limited to `node-unavailable` or `busy`. It holds no tx hash, no key, no address and no account.
- **Deletion:** the rows go with the dispute (`on delete cascade`, the dispute purge).
- **Who can write one:** a row is written only after the session check, the per-account budget (10
  at once, then 1 a minute), the seller-only role, `assertTakesProof` (before complyBy; a late proof
  is not recorded, which is tested) and the replay check. Only the trade's seller can add rows, at
  about 1 a minute at most, and the case view shows at most `FAILED_CHECKS_SHOWN = 10`.
- **The deadline:** complyBy does not move, and the lapse still comes (tested).
- **Insert failure:** a failed insert is swallowed, so the seller still gets the real 503.

## Can a user trigger the alert? Not in any practical way.

`tx-proof-check-stuck` is raised only from `abandon()`. That needs a monero-ts call still unsettled
5 minutes after its check took the slot, which the per-call timeouts make implausible for any input.
The key is validated as reduced scalars (`isTxKey`), and the tx must be one the node already knows.
Even if a user could do it, the alert fires once per episode. An episode ends only when a check that
used the wallet finishes in time, and after 3 abandoned wallets nothing more is built. The alert's
detail is `{}`, with no user data in it.

## Minors (do not block)

- **w1.** `abandoned` never decays. Three unrelated stalls over months leave every proof answering
  503 until a restart. The episode's one alert says "restart the API", so the owner is told. But if
  all 3 abandons fall in one episode, nothing says the checker has now reached its permanent 503
  state. Consider a second alert at the cap, or resetting the count after a long healthy stretch.
- **w2.** `runPendingProofs` treats only TxProofUnavailable as "leave it waiting". A 503 `busy`
  (the queue is full, or the cap is reached) is rethrown into `failures`, so every 30 s pass ends in
  an AggregateError until a restart. Nothing is wrongly decided, but it is log noise. Catch the
  `busy` ApiError the same way.
- **w3.** The alert's best-effort sink is wired after `buildApi` (`onTxProofStuck` starts as a
  no-op). A stall in the first moments of a boot would go unalerted. This is harmless in practice.

## Tests weakened?

None. New tests cover:
- txProofCheck: holding the slot until stuckAfterMs, then a fresh wallet with the old one closed;
  the cap of 3 with one alert per episode; the episode reset;
- comply.test: both 503 reasons recorded with complyBy unmoved; a too-late proof not recorded; the
  alert sink;
- staff-web moderator.test: the failed-check lines.

The one `todo` in the api run is pre-existing (staff.test, NEEDS_P4_CHAT_MEMBERSHIP).

## Runs (own worktree at 0a61855e)

- api vitest (nice, no lock): disputes/comply, txProofCheck, appeals, lien, staff, schema,
  watchReports: 7 files, 219 passed, 1 todo (pre-existing).
- staff-web vitest: moderator.test, 23/23 passed.
- web vitest: dispute, disputeSlot, attestation-flow: 3 files, 194/194 passed.
- typecheck: apps/api, apps/staff-web and apps/web clean.
- regtest (under the lock, `--project @x2f/api-regtest`): txProof.regtest.test.ts, 3/3 passed.
- Full `npm run check`: not run by this reviewer. The lead's landing run must cover it (the 13 Nov
  rule).
