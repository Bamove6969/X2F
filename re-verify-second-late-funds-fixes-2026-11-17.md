# Re-verify: wip/second-late-funds-fixes 7e339feb / edb028c2, 17 Nov 2026

Independent re-verify of claude2's fixes for re-verify-late-funds-2026-11-12.md (N1, N2, gaps (a) and (b)). The branch continues wip/lead-late-funds 86b7a86c.
- The head moved during the review to **edb028c2**, the READY commit. It has the same tree as 7e339feb (`git diff --stat` is empty), so everything below applies to both.
- I made no edits to the branch.
- I used a detached worktree with a fresh `npm ci`, and a second worktree for the netfee trial merge. Both were removed afterwards. No .regtest was ever created. dockerd was not touched.

## Verdict

**NOT READY: not verified.** None of my test runs happened.
- I queued the suites and the full `npm run check` under `flock ~/x2f-comms/check.lock`, with the timeout inside the flock.
- The lock stayed busy from 03:12 to 05:00 UTC or later. Seven or more full checks or regtest jobs were queued ahead of mine, and flock does not take jobs in order.
- I had to stop before mine started, so I have no pass/fail counts of my own.

My code reading found nothing blocking. The netfee trial merge does show one integration gap (C1, below) that needs fixing when the two branches land together. Gap (a) is still open, on purpose.

claude2's own numbers, in edb028c2's message and run on 7e339feb, not by me:
- escrow: 120/120
- moderation: 199/199
- moderation-regtest: 1/1
- regtest: 4/0
- regtest-verify: 10/0
- api: 2747/0
- web: 2111/0
- typecheck and copy-lint: clean

claude2 did **not** run node-proxy, staff-web, Semgrep or the full `npm run check`. Approval still needs the head's full `npm run check`, plus escrow, regtest, regtest-verify and moderation, run under the lock (use scratchpad/rv-lf2-run.sh).

## The findings, by reading the code (party.ts at e82b0152)

- **N1: fixed in the code, and RED-then-green regtests exist.** I did not run them.
  - `outcomeRefusal`: a party with no release of its own now needs `txSeen(after)`, so a made-up hash is refused with nothing saved or sent. The test covers both the moderator and the seller.
  - `readyToExport`: a later-release builder whose own latest done tx is not `after` waits for `spentBy(after)`, after a sync, before it exports. A regtest names the escrow's own deposit and checks that the moderator never exports or builds.
- **N2: fixed, with a regtest** (the wrong `after` is the deposit, then the corrected one settles).
  - The new rule: an uncommitted, non-superseded later release is dropped (`cur = null`), and the new outcome gets the checks a fresh one gets.
  - The dropped release never enters the history. The test asserts that.
  - On safety:
    - `committed` is true from `cosigning` onward and is reset only by `nextAttempt`, which never runs after `signed`. So a replaced release was never signed by this party.
    - No nonce is reused. Each export is fresh, and wallet2 refuses a set built on stale nonces.
- **Gap (b): fixed, with a regtest.** The moderator drops every spend.info and still builds. When the builder's wallet refuses an import, that counts as `build-payout-mismatch` and moves to the next attempt.
- **Gap (a): NOT fixed** (a deferred owner/lead question).
  - A `signed` later release whose tx is `none` still has no way out.
  - The reasoning holds: freeing it on `none` alone could pay twice, and the safe fix needs a new key-image-depth primitive.
  - It is liveness only. It must land before late-funds steps 2 to 6.

## Double-pay and wrong-payee paths (by reading)

I found no new path that double-pays or pays the wrong party:
- `checkRelease`, which checks exact payouts against `o.to`, still runs before every signature.
- Two sets over the same coins conflict on chain, so only one can confirm.
- A restart is safe. `beginRelease` saves the replacement in one write before anything is sent, and `importedEarly` lives only in memory, so a restart just imports once more, which does no harm.

Two smaller notes:
- **Minor (new, by reading, not probed).**
  - Gap (b)'s early import runs *before* N1's `spentBy(after)` check. wallet2 accepts a peer's partial key images without checking them.
  - So a malicious **co-signer** plus the API might be able to make the moderator's `spentBy(after)` pass for an unrelated in-block tx. That mirrors the 12 Nov note about a malicious moderator.
  - The result is liveness or a partial sweep, never theft: payouts are still exactly `o.to`.
  - Worth one line in the design note. Swapping the order would bring gap (b) back.
- **Info (already there before this branch).**
  - A `built` builder that follows `counterpartNext` resets `committed`, while its half-signed set may still be with the co-signer.
  - An outcome switch after that leaves the old set completable.
  - Same outcome, same payees, so no theft, but be aware of it for steps 2+.

## Trial merge with origin/wip/second-netfee-fixes 6790d98d (a local scratch commit, deleted)

There were six conflicts. Only one is in late-funds code.
- **`outcomeDigest`:** the late-funds side adds `after`, and netfee adds `bearsFee`. Both compose mechanically: keep both fields. A first release's digest stays the same.
- **The other five** come from the ruling-payout, disputes and liens stack underneath:
  - `internal/routes.ts`
  - `staff/revenue.ts`
  - `schema.test.ts` (take the head's list and add `600_revenue_network_fee.sql`)
  - `docs/coordination.md` (keep both sections)
  - the `trade/index.ts` export list (the union of both)

On the netfee rule ("each receiver pays its own output's fee"):
- The `payoutsFor` marks cover `dispute-buyer`.
- The later release's `fundsReady` uses `sumPayouts` and `checkRelease`, which already apply the fee split.
- A single-output later release bears the whole fee, the same as a refund.

**C1 (integration, books only, fix when they land together).**
- In the merged `/internal/v1/reports` `settled` handler, the ruling branch (`isRulingKind`, which calls `recordRulingExecution`) ignores `networkFeeAtomic`. The watcher does send it for ruling sweeps (watcher.ts:292).
- So on a `dispute-buyer` ruling payout, X2F's network-fee share is never booked (`bookSettlementNetworkFee`). Its fee output still pays that share, so the revenue books overstate net.
- Fix: in the ruling `within`, call `bookSettlementNetworkFee(c, code, fee)` when `kind === 'dispute-buyer'` and the fee is not null, and add a test.
- I did not typecheck or test the merge: there were no node_modules and the disk was at 97%.

## Not run

Nothing ran: the full `npm run check`, escrow, regtest, regtest-verify, moderation, moderation-regtest, or the merge's typecheck and tests. The lock never came free in time.
