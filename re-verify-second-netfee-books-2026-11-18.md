# Re-verify: wip/second-netfee-books @ 5ff58cc2 (money, 18 Nov 2026)

**Verdict: APPROVE (code). 0 blocking, 0 major, 4 minor.** It is still **held on owner Q2** (minimum trade size), as before. This review does not change that.

Reviewer: independent re-verify helper (cloud). I ran `git fetch origin` first. The heads were: second-netfee-books 5ff58cc2, main b6f9cf0e (the merge base, so landing is a fast-forward), comms 5932a33d.
Baseline: the approved netfee code, second-netfee-fixes 6790d98d (re-verify-second-netfee-fixes-2026-11-17.md). 6790d98d is an ancestor of the head.
Worktree: a detached worktree in the scratchpad with a fresh `npm ci`. I removed it afterwards, with its node_modules and `.regtest`. Every run took `~/x2f-comms/check.lock`, with the timeout inside the flock.

## Tests (all at 5ff58cc2)

| Run | Result |
|---|---|
| Full `npm run check`: typecheck, copy-lint, separation-check, every vitest project, semgrep, audit | **exit 0**: 382 files, **7163 passed, 0 failed**, 1 todo. semgrep 0 findings, audit 0 vulnerabilities, separation-check ok |
| `@x2f/escrow` (regtest) | **163/0** (19 files) |
| `regtest` | **4/0** |
| `regtest-verify` | **10/0** |
| `@x2f/moderation` | **199/0** |
| `@x2f/moderation-regtest` | **1/0** (execute.regtest: the ruling paid out on regtest with the fee split) |

Not run: Playwright.

## What changed since 6790d98d, and what I checked

**1. Staff Revenue books page (32ae78a8 red, 211d6a1d, lead-netfee-books b104e575, merged as f9366588)**
- `screens/Revenue.tsx` reads `GET /staff/v1/revenue?by=month`, which the API gates on `earnings.read`, the owner's alone.
- The page shows the to-date bucket (fees, "Monero network fees paid to date", net) and a by-month table.
- Every amount is a BigInt string, shown with `xmrText(atomic, 12)`: all 12 places, truncated, no floats. So the books are exact.
- The page has no way to change anything.
- The copy is marked COPY-UNSIGNED and NEEDS_DESIGN_REVENUE. No string says "half".
- This meets NEEDS_DESIGN_REVENUE's interim need, which my 17 Nov review left open.

**2. C1 / NF-1: a3622e66 (red), 82bedd70 (internal/routes.ts:322-333)**
- The ruling `settled` branch now calls `bookSettlementNetworkFee`, the same function as the release path. It runs inside `within`, only for `dispute-buyer`, only when a fee was reported, and only when `next.state === 'released'`.
- Order: `applyEvent` books the 1% (`bookTradeRevenue` with the ruling kind, store.ts:414) before `within` runs (store.ts:422). So the `revenue_booked` row exists when the network fee is booked, in the same transaction.
- Amount: `bookSettlementNetworkFee` takes the kind from `t.settling ?? 'release'`. The machine sets `settling: null` on a ruling close (machine.ts:561), so the kind is `release`. That is equivalent to `dispute-buyer` in every function the booking uses:
  - `feeOutputAtomic` gives the full fee for both;
  - `feeWalletNetworkFee` gives floor(F/2) for both;
  - `payoutsFor` builds the same marked buyer and fee outputs for both, and the surplus is unmarked.

  So the booked share equals what wallet2 takes from X2F's output. The fee is capped at MAX_NETWORK_FEE before the share is taken.
- A fee of zero: `out()` drops the fee output, and `feeOutputAtomic <= 0` books nothing. That is correct.
- Booked once:
  - A replay (same tx, trade already released) returns 201 before any transaction and books nothing. The test also replays with a different fee, and nothing more is booked.
  - Another tx hash on a closed trade is refused 409 `wrong-state`.
  - The `network_fee_atomic is null` guard backs both.
- A late-funds ruling on an escrow that already paid out is refused by the machine (`t.txHash !== null` means `wrong-state`). So it can never book a second 1% or a second share.
- `dispute-seller` books nothing (tested). A malformed fee is refused 400 and changes nothing (tested).
- The path is live: a ruling payout is built by the moderator, so it is an own tx, and the watcher sends `networkFeeAtomic` from its wallet (watcher.ts:224, 292).

**3. Merge 3c064bce of lead-netfee-n2 5b57999a (party.ts `nextAttempt` / `giveUp`)**
- `nextAttempt` now calls `giveUp` first once attempts run out. Otherwise it still clears `txSet`, `txKey` and **`feeCeiling`** (party.ts:651).
- `giveUp` also deletes `feeCeiling` (party.ts:664). So an exhausted outcome keeps no stale fee bound, as our side did before the merge.
- The co-signer still stores the bound it checked (`rel.feeCeiling = bound`) and signs with it (party.ts:909-916). That code is unchanged.
- It signs nothing new:
  - `giveUp` is reached only from `nextAttempt` and from the builder's `buildRelease` catch on `build-failed` + UNBUILDABLE. That is before any set is saved, sent or signed.
  - An `exhausted` phase never reaches `cosigning` or `signed`.
  - monero.ts maps only the "destination amount is zero" error to `build-failed`. Every other build error stays the retryable `not-ready` (tested both ways).
- The N2 regtest test proves it:
  - the unbuildable release gives up at attempt 1, with no `build-*` retries;
  - the party then settles the one-output seller refund;
  - the fee wallet gets 0.

**4. Main merge f34baecf (b6f9cf0e) plus the test fixes cc74e224 and e6b0a6b9**
- `outcomeDigest` keeps late-funds' `...(o.after !== undefined ? { after } : {})` beside netfee's per-payout `bearsFee: '1'`. A first, unmarked release keeps its old digest. A later release digests both.
- `ReleaseState.after`, `isSavedRelease` and `beginRelease` are main's, untouched.
- Other conflicts:
  - export unions in escrow/trade index.ts and monero.ts;
  - verify.ts re-exports MAX_NETWORK_FEE from @x2f/core with harden's doc;
  - `checkTxSet` keeps both `maxFee` and the per-bearer shares;
  - chain.ts keeps both `checkRelease → MAX_NETWORK_FEE` and the `*` mark;
  - revenue.ts returns `toDate`, `treasuryNetworkFeesRecorded` and main's real `owedOutstandingAtomic`;
  - routes.ts keeps the separate TX_HASH check and accepts both ruling kinds and `networkFeeAtomic`.

  All of these are mechanical, and I verified them with `git show --remerge-diff`.

## Weakened tests: none
- From main b6f9cf0e to the head, no `it(`, `test(` or `describe(` was deleted, skipped, `.only`'d or todo'd. The two `it(` lines that disappear were renamed in 6790d98d (already reviewed), with stronger exact amounts.
- New since 6790d98d:
  - a0144634 rewords comments and one test name only;
  - cc74e224 adds `bearsNetworkFee: true` to the gate's expected buyer payouts (the gate settles `payoutsFor`'s marked list);
  - e6b0a6b9 replaces "fee wallet got exactly its payout" with the exact wallet2 split of the observed fee (`[buyerShort, feeShort]` equals `networkFeeShares(fee, [true, true])`, with 0 < fee < MAX). That is an exact check, not a looser one.
  - a3622e66, 711bb500 and 32ae78a8 are additions only.

## Findings (all minor)
- **m1: the ruling path reaches `dispute-buyer` through `settling ?? 'release'`.** `bookSettlementNetworkFee` reads the kind from the row, which is null after a ruling. This is correct today, because release and dispute-buyer are identical in `feeOutputAtomic` and `feeWalletNetworkFee`. If the two ever differ, the booking would silently use release's rule. Suggest passing the kind in, as `bookTradeRevenue` does.
- **m2: the first `settled` report decides.** If the first ruling report carries no `networkFeeAtomic`, a later replay that has it returns early, and the share is never booked. This is the same as the release path, where a replay gets 409. Books only.
- **m3: no test pins the `feeCeiling` delete in `giveUp`.** The behaviour is right by reading the code (the bound is never used once the phase is `exhausted`), but nothing tests it. Test hygiene.
- **m4: staff-web's `RevenueReport.owedOutstandingAtomic` is still typed `string | null`.** The API now always returns a string. The page does not use the field. A type nit.
- N2 follow-up (note only): after `giveUp` the trade still waits for the 6 h `spend-unshown` escalation, unless the app acts on attempts-exhausted. That is outside this branch.

## Owner questions (via the lead)
- **Q2 (still blocking landing):** set a minimum trade size or a minimum fee output, as recommended on 17 Nov. N2 now makes an unbuildable release fail at once instead of retrying in silence, but the buyer still cannot be paid on a small trade.
- Q1, Q3 and Q4 are unchanged from 17 Nov. NF-1 is now built, as recommended: a buyer ruling books X2F's network-fee share like a release.
