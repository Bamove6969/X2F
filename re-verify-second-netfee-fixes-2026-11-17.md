# Re-verify: wip/second-netfee-fixes @ 6790d98d (money, 17 Nov 2026)

**Verdict: NOT READY to land on its own.** The code is right: every amount is exact, the fee is booked once and only on a release, the review fixes B1, B2, B3, M1 and M2 are all in, no test was weakened, and the full `npm run check` is green. But open owner question **Q2 is now proven**: with no minimum trade size, a small trade's escrow can never be released to the buyer. The release fails, and so does a buyer-win ruling. Only a refund to the seller still builds. The payout code also reports this as a retryable `not-ready`, so the trade stalls with no error shown. Land it once the owner answers Q2 and the chosen guard is built (or the owner accepts the risk in writing). Everything else can land as it is.

Reviewer: independent re-verify helper (cloud). I ran `git fetch origin` first. The heads were: second-netfee-fixes 6790d98d, main 4f0afa14 (the merge base), second-escrow-harden-fixes 9c7e7a78, comms e0c2b536.
Worktree: a detached worktree in the scratchpad with a fresh `npm ci`, removed afterwards with its node_modules and `.regtest`. Every test ran under `~/x2f-comms/check.lock`, with the timeout inside the flock. I did not touch dockerd.

Sources read: review-third-netfee-split-2026-11-16.md; to-lead.log lines 404-417 and 472 (claude2's netfee notes and its READY line); WHO-DOES-WHAT.md; agy-wake/LEAD-START-HERE-17NOV.md (owner decisions since 13 Nov: "Each receiver pays its own payout network fee; never say half"; books: "Monero network fees paid to date" and a net total); landing-plan-2026-11-17.md (10b); review-disputes-stack-2026-11-16.md (MIG-1, NF-1).

## Tests

| Run | Result |
|---|---|
| Full `npm run check` at 6790d98d: typecheck of every workspace, copy-lint, separation-check, every vitest project, semgrep, audit | **exit 0**: 370 files, **6915 passed, 0 failed**, 1 todo; semgrep 0 findings; audit 0 vulnerabilities |
| `@x2f/escrow` (regtest, as in final-check-9c.sh) | **114/0** (16 files; engine and spend-info verify the permuted layout on regtest) |
| `regtest` | **4/0** |
| `regtest-verify` | **10/0** |
| `@x2f/node-proxy` | **34/0** |
| Trial merge onto second-escrow-harden-fixes (5eaa15c3, see below): `npm run typecheck` | clean |
| the same: core 26/0, trade 513/0, escrow (regtest) **145/0**, moderation 149/0, regtest 4/0, regtest-verify 10/0 | all green |
| the same: web policy + attestation-flow + release **210/0**; api revenue + watchReports + schema **138/0** | all green |
| Scratch Q2 proofs (not committed, deleted): a wallet2 arithmetic port over the real `payoutsFor` sets (trade project, 2/2); the same on regtest with real multisig escrows (escrow project, 2/2) | see Q2 |

Not run: Playwright (`quote.spec.ts` is touched; a copy-only change).

## Merges

- **Onto main 4f0afa14:** main is the merge base, so the merge is a fast-forward with nothing to resolve. The head's full check is that result.
- **Onto origin/wip/second-escrow-harden-fixes 9c7e7a78:** 4 textual conflicts and no logic conflicts: `packages/escrow/src/{index,monero,verify}.ts` and `apps/moderation/test/chain.ts`. In each, keep both sides:
  - the export and import lists are the union;
  - in verify.ts, keep netfee's re-export of `MAX_NETWORK_FEE` from @x2f/core (a local const would clash with the import) and harden's doc;
  - in chain.ts, keep harden's `checkRelease: async () => MAX_NETWORK_FEE` and netfee's `buildRelease` encoding with the `*` mark.

  The bodies merge on their own: `checkTxSet` keeps harden's `maxFee` and netfee's per-bearer shares, and `buildRelease` uses netfee's layout. claude2's trial merge **5eaa15c3** (on 36ba072e, whose tree is identical to 9c7e7a78) resolves it exactly like this. I tested that tree (results above).

## Money checks

**Exact amounts, by payout path**
- **Release and buyer-win ruling (`dispute-buyer`).** Buyer and X2F fee outputs are marked; a surplus to the seller is not. Each marked output is short by exactly its wallet2 share: floor(F/2), and the buyer takes any odd unit. `checkTxSet` requires exactly that, and every other output must be exact. On regtest the fee wallet received `fee − net/2` exactly (spend-info), and a 3-output release paid buyer `amount − (net − net/2)`, fee `1% − net/2` and surplus exact (engine). Moving the fee between outputs is refused: the whole fee off the buyer, the whole fee off X2F, or any part off the surplus (engine and verify tests).
- **Cancels and refunds** (mutual-cancel, buyer-cancel, auto-refund, lapse-refund) **and the seller-win ruling (`dispute-seller`).** These are unchanged: one unmarked output bears the whole fee, and the digest is unchanged.
- **Late funds.** These escalate to a dispute (watch.ts). A ruling then pays one of the two ruling sets above. `dispute-buyer` on a late top-up smaller than the seller's funds is refused (`underfunded`), so late coins go out as the one-output seller refund. The watcher reports `settled` once per escrow (`closedAt`), so a second sweep books nothing. That is correct, because it has no X2F fee output.
- **Appeals.** Not on this branch (wip/lead-appeals). `payoutsFor` has no appeal kind, so an appeal pays through the same two ruling sets.
- **Sweep check (`proveSweep`).** Each marked minimum may be short by its share of min(fee, 0.01 XMR), never more. The allowance never moves between outputs (spend-info has a negative case). X2F's treasury sweep is not wired (`treasuryNetworkFeesRecorded: false`).

**Negative and dust.** No output can be zero or negative. wallet2 refuses `amount <= share` ("destination amount is zero", seen on regtest), and `checkTxSet` can only ever match outputs wallet2 built. Economic dust can happen: the fee output can arrive at as little as 1 atomic unit above its share. Monero has no consensus dust floor, but X2F's treasury would pay more to spend such an output than it holds. This falls under the same Q2 guard.

**Charged at the right time, and once**
- The 1% stays gross in `fee_atomic`.
- `bookSettlementNetworkFee` runs only inside the `settled` transaction, only when `next.state === 'released'`, and only when the trade has a fee output. It runs once per trade: the `network_fee_atomic is null` guard covers a replayed report, and the add-only trigger now covers the new column.
- The booked fee is capped at `MAX_NETWORK_FEE` (M2), and an over-cap report is logged.
- A refund books nothing.

**Books: "network fees paid to date"**
- What X2F's output really lost and what is booked are the same number. `feeWalletNetworkFee` books floor(F/2), and that is the fee output's `networkFeeShares` share in both the 2-output and the 3-output layouts (trade test, plus the regtest balance).
- `GET /staff/v1/revenue` returns `networkFeeAtomic` and `netAtomic` (gross 1% + owed − network fees) in every bucket, plus a `toDate` bucket over the whole ledger.
- Still missing (and outside this branch's scope; WHO-DOES-WHAT gives it to claude2): there is no staff-web page or column showing "Monero network fees paid to date" or the net total (NEEDS_DESIGN_REVENUE). The owner's decision should be judged met only once that page exists.

**"Never say half"**
- No user-visible string says "half".
- BuyQuote: "about 0.00005 XMR for your payout, taken from it".
- Released: "Before the network fee for your payout." The extra sentence "X2F pays the network fee for its own 1%." is shown to the poster buyer only (B1 fixed; the taker test now also refuses "X2F pays").
- Poster-buyer terms: "...less 1% (the X2F fee) and the network fee for your payout."
- "Half" still appears in code comments, test names and docs/coordination.md ("under about half a payout fee"). That is harmless, but whoever does the wording pass should reword these too.

## Q2, proven: without a minimum trade size, an escrow can become impossible to release

**The rule.** wallet2 builds a release only if every marked output is larger than its share. The buyer's output is about 99 times larger, so the X2F fee output is the binding one:

  releasable  ⇔  feeFor(amount) > floor(F / 2)  ⇔  amount ≥ (floor(F/2) + 1) × 100

Here F is the payout's network fee. The rule is the same for both posters, for `release` and `dispute-buyer`, and with or without a surplus.

**Arithmetic.** I bisected the smallest releasable amount with a wallet2 port over the real `payoutsFor` sets. Every result matched the formula exactly.

| Payout network fee F | Smallest trade that can release |
|---|---|
| 0.00003072 XMR (a mainnet-like 2-output fee; the figure the branch's own tests use) | **0.001536 XMR** |
| 0.00006 XMR | **0.003 XMR** |
| 0.0001 XMR (the repo's planning figure, p11-66 / BuyQuote) | **0.005 XMR** |
| 0.0002 XMR (FEE_BOUND_FLOOR on escrow-harden) | **0.01 XMR** |

Before this branch, the buyer bore the whole fee and the limit was about amount > F, roughly 50 times lower. Example: a 0.001 XMR trade with F = 0.0001 XMR built under the old rule (buyer output 1e9 > 1e8). Under the split, the fee output is 1e7, which is not more than its 5e7 share, so wallet2 refuses it.

**On regtest** (real 2-of-3 escrows, monero-ts 0.11.16, monerod v0.18.5.3). Regtest's 2-output payout fee was F = 0.0017952 XMR, so the regtest threshold is 0.08976 XMR. Trade of 0.02 XMR (seller-posted, fee output 0.0002 XMR):
  - the release set under the new split: **refused**, `not-ready: could not build: destination amount is zero`;
  - `dispute-buyer` (the ruling): **refused**, with the same error;
  - the old rule (unmarked list, buyer bears all): **built** (fee 0.0017952);
  - `dispute-seller` refund (one output): **built** (fee 0.0018084).

  A 0.5 XMR trade built every set.

**Is anything stopping such trades? No.**
- Offers only require `min > 0`: `offerRange.ts:35`, and migration 490 `check (min_amount > 0)`.
- Fiat-unit offers convert at the market rate, so a $1 trade at $300/XMR is 0.0033 XMR. That is below the 0.005 XMR threshold at the planning fee.
- `LAUNCH_TRADE_CAP_USD_CENTS` is a maximum, not a minimum.

**What happens to such a trade.**
- The buyer pays fiat and taps "I've paid". The seller's app then gets `not-ready` from `buildRelease` (monero.ts maps every build error to `not-ready`, which means "a fresh attempt can recover"), so it retries forever and shows no error.
- After 6 h, `spend-unshown` escalates the trade to a dispute.
- A buyer-win ruling uses the same marked set, so it fails the same way.
- The only payout that can still be built is the full reversal to the seller. So the buyer who paid can never get the XMR. If the balance is at or below F, nothing at all can be built (that last case existed before this branch).

**Recommendation for the owner:** a minimum trade size enforced at offer and take time, set from the fee bound so it can never be reached. For example, 1% ≥ FEE_BOUND_FLOOR, i.e. trades ≥ 0.02 XMR, or a fiat equivalent with margin. That also stops the fee output from arriving as dust.
Alternative (a behaviour change, so it is the owner's call): when the fee output cannot bear its share, the buyer's output bears the whole fee.
Engineering fix either way (no owner call needed): have `buildRelease` report wallet2's "destination amount is zero" as a permanent `build-failed`, not `not-ready`, so the trade escalates at once instead of after 6 h of silent retries.

## Findings

- **N1 (blocking, owner Q2): small trades cannot release.** See above. A liveness regression introduced by this branch: the buyer's money is stuck, and only a refund to the seller remains.
- **N2 (major, engineering): wallet2's "destination amount is zero" is reported as retryable `not-ready`** (monero.ts `buildRelease` catch). It is permanent. Map it to `build-failed`, or to a new code, so the party stops retrying and the UI or watcher can escalate.
- **N3 (minor): dust fee outputs.** A fee output can arrive at 1 atomic unit or more above its share. The Q2 guard covers this.
- **N4 (minor, test hygiene, not a weakening):** `apps/web/test/tradeTerms.test.ts` says its `BOARD` is a byte-identical copy of the design board (b5bb4faa). The poster-buyer line in it was edited to the new COPY-UNSIGNED text. Design's board needs the same edit, or the comment should say the line is ahead of the board. `parity.ts` KNOWN_EXCEPTIONS was updated the same way.
- **N5 (note): the owner's 16 Nov wording is still only inside the branch** (migration 600, payouts.ts, coordination.md), not in owner-answers-register.md. The lead should record it, and the 17 Nov "never say half" rule, before merging.
- **N6 (merge note, unchanged): NF-1.** When the disputes stack is merged with this branch, the `settled` route must keep both `RulingKind` and `networkFeeAtomic`, and decide whether a `dispute-buyer` payout books X2F's share. Today on this branch the route accepts only `SETTLE_KINDS`, so a ruling payout never books one.
- Review items rechecked: B1 fixed (taker buyer sees no X2F sentence; the test is tighter). B2 fixed (10 expectations add `bearsNetworkFee: true`, none removed). B3 fixed (`StoredPayout`, `fromStored`, `key()` and moderation `outcomeKey` carry the mark; reload-resume regression test present). M1 fixed (600 is free on main, on escrow-harden-fixes and on batch10a's 560-590; signup-r3 uses 610). M2 fixed (cap and log).
- **Weakened tests: none.** Every removed line in the diff is an expectation rewritten with the mark, or with stronger exact amounts. Examples: engine.test now asserts the buyer, fee and surplus balances to the atomic unit instead of a range, and release.test's taker check adds `X2F pays`. No `it(` or `test(` was deleted, skipped or marked todo.

## Owner questions (via the lead)
- **Q2 (blocking, now proven):** set a minimum trade size, or a minimum fee output (recommended: 1% ≥ FEE_BOUND_FLOOR, so ≥ 0.02 XMR, enforced at offer and take), or let the buyer bear the whole fee when X2F's output cannot. Without one of these, trades under about 0.0015-0.005 XMR on mainnet (about $0.50-$2) can never pay the buyer.
- **Q1 (copy, COPY-UNSIGNED):** the BuyQuote, Released and terms lines quoted above. BuyQuote's "about 0.00005 XMR" understates a 3-output release.
- **Q3:** the seller-surplus exemption, and whether X2F accepts a griefing cost of up to 0.005 XMR per release, or wants a lower cap on its share.
- **Q4:** senior pay accrual on the gross 1% (`payAccrual.ts`).
- **NF-1:** should a buyer-win ruling book X2F's network-fee share like a release? (Recommended: yes.)
