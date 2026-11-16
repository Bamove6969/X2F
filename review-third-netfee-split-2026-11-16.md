# Review: wip/third-netfee-split @ e6f718c4 (money + security, 16 Nov 2026)

**Verdict: CHANGES NEEDED.** The money core is right: the split matches wallet2 exactly, and the co-signer bound still refuses an inflated fee and any shifting of fee between outputs. Three things block the merge. (B1) The Released note tells a taker buyer about X2F's 1%. (B2) Nine web unit tests and one API test are red. (B3) A resumed release no longer reaches the party because the stored outcome loses its fee marks (shown with a probe test).

Reviewer: second (claude2 cloud helper), read-only on code. I fetched the branch again: it is still at e6f718c4.
Scope: `git log origin/main(4f0afa14)..e6f718c4`, 5 commits: 2d85276a and bdc2a8c9 (red tests), 5b29fe2c (the fix in core, escrow, trade, api and moderation), 08a27bf9 (copy), e6f718c4 (docs). 39 files, +638/-105. I read every changed file, plus the code that builds, stores, compares and books payouts: web `escrow/runtime.ts` and `store.ts`, moderation `desk.ts`, api `trades/store.ts` and migration 430.

**The owner's wording is not on origin/comms.** I grepped origin/comms (to-lead.log, the owner registers, the demo notes) for "network fee", "set to receive" and "our fees" on 16 Nov. Nothing matched except my own claim line. The decision is quoted only inside the branch, in migration 550, payouts.ts, coordination.md and BuyQuote.tsx: "the xmr fees are paid by the person who sends the xmr to escrow and then paid by the person who is set to receive it. We should also pay for our fees" / "they pay their fees and we pay our fees". The lead should record it in owner-answers-register.md before merge.

## What the branch does

- `@x2f/core` `networkFeeShares(fee, bearers)` and `feeSplitLayout`: the payout's network fee comes off the outputs marked `bearsNetworkFee`. On `release` and `dispute-buyer` those are the buyer's output and the X2F fee output. The seller's surplus is not marked. A refund's single output is unmarked and still bears all of it.
- `buildRelease` hands the list to monero-ts permuted (`feeSplitLayout`), so wallet2's pay order and `subtractFeeFrom` name the same outputs. `checkTxSet` requires each bearer to be short by exactly its share, and every other output to be exact. `proveSweep` lets each marked minimum be short by its share of the capped fee. The outcome digest and the web `cosignPolicy` both include the marks.
- API: migration 550 adds `network_fee_atomic` to `revenue_ledger` (the add-only trigger is extended) and to `revenue_booked`. The watcher sends `networkFeeAtomic` on `settled`. `bookSettlementNetworkFee` books floor(fee/2) once per trade, inside the settlement transaction. The revenue report gains `networkFeeAtomic`, `netAtomic`, `toDate` and `treasuryNetworkFeesRecorded: false`.

## Money arithmetic: verified against wallet2's source

I fetched Monero `src/wallet/wallet2.cpp` at v0.18.3.4 and checked the two facts the branch rests on.

1. **The split** (`get_adjusted_dsts`, line 10625). `amount_to_subtract = max(remaining / n, 1)` is recomputed only when the iterator wraps to the first subtractable index, so once per pass. Each bearer therefore pays floor(F/n), and the first F mod n bearers in tx order pay 1 more. Line 10650: `THROW ... if d.amount <= amount_to_subtract` (`zero_amount`).
2. **The pay order** (`create_transactions_2`, lines 10965-10976). `destination_index++` runs while `pop_index(dsts, 0)` moves the last destination into slot 0, so `subtract_fee_from_outputs` positions count in the order 0, n-1, ..., 1. `sanity_check` (line 11262) checks against the original indices, which is why a mismatched list is refused.

I wrote a property test in my worktree (not committed): a direct TypeScript port of both loops, run against `feeSplitLayout` and `networkFeeShares`. It covers 8 bearer patterns × 400 random fees and amounts (odd and even fees, n = 1..3). **12/12 passed.** For every payout, the output wallet2 builds equals `amount − share`. The shares sum to exactly the fee, and an unmarked output pays 0. The odd unit goes to the lowest-indexed bearer (the buyer) in both the 2-output and the 3-output layout: `[true,true,false]` gives order `[2,1,0]` and subtractFrom `[1,2]`. A fee of 1 over two bearers gives `[1,0]`, the same as wallet2's max(...,1) step.

```ts
// excerpt of packages/core/test/zz-review-split.test.ts (scratch, not committed)
function wallet2(passed: bigint[], subtract: number[], fee: bigint) {
  const dsts = passed.map((a, i) => ({ a, i })); const tx = []; let destIdx = 0;
  while (dsts.length) { tx.push({ ...dsts[0], sub: subtract.includes(destIdx) });
    const last = dsts.length - 1; [dsts[0], dsts[last]] = [dsts[last], dsts[0]]; dsts.pop(); destIdx++; }
  const idx = tx.map((t, k) => (t.sub ? k : -1)).filter((k) => k >= 0);
  let rem = fee, j = 0, amt = 0n; const res = tx.map((t) => t.a);
  while (rem > 0n) { if (j === 0) amt = rem / BigInt(idx.length) > 1n ? rem / BigInt(idx.length) : 1n;
    if (res[idx[j]] <= amt) throw new Error('zero_amount'); rem -= amt; res[idx[j]] -= amt; j = (j + 1) % idx.length; }
  ...
}
// for each bearer pattern × 400 random (fee, amounts): back-mapped wallet2 outputs == amounts − networkFeeShares(fee, bearers)
```

Answers to the focus questions:
- **Bigint only:** yes. The one `Number()` is `fee % n`, which is at most 5.
- **The leftover piconero:** goes to the buyer's output. The X2F booking uses floor(fee/2), which equals `networkFeeShares(...)[fee output]` both with and without a surplus output.
- **Sum:** outputs + fee = inputs is still enforced (`total + fee !== inputSum`), along with the sweep, no change and unlock 0.
- **Negative, zero or dust:** wallet2 refuses `amount <= share` (`zero_amount`), so no bearer can come out at 0 or below. RingCT outputs have no dust floor. `checkTxSet` could never match a `want` ≤ 0 anyway. The cost is liveness, not money: a fee output under about half a payout fee cannot release at all (the docs' "Open" section says so; see Q2).
- **Fee bound:** `checkTxSet` still refuses fee ≤ 0 or fee > `MAX_NETWORK_FEE` before computing shares. The co-signer takes the marks from its own `payoutsFor`, never from the builder, so **no party can push fee from one output to another.** The branch's tests refuse every variant: the whole fee off the buyer, the whole fee off X2F, the odd unit on X2F, and the surplus paying 1 unit. What changes is who absorbs an inflated fee (I1).
- **Refunds and rulings:** the refund lists are unchanged (one unmarked output bearing the whole fee), and their digests are unchanged. `dispute-seller` is refund-shaped. `dispute-buyer` is marked like a release. Nothing in the code builds partial payouts.
- **One receiver:** when 1% of a tiny amount floors to 0, `out()` drops the fee output. The buyer alone is then marked and bears the whole fee, and the API books nothing (`feeOutputAtomic <= 0`). Correct.
- **Booking:** idempotent. The `network_fee_atomic is null` guard stops a replayed report, it runs only when `next.state === 'released'`, so never on a refund, and it runs after `bookTradeRevenue` in the same transaction, so the marker row exists. The trigger keeps the column add-only. A refund also books nothing, because no `revenue_booked` 'fee' row exists for it.

## Findings

### B1. Released note shows X2F's 1% to a taker buyer
`apps/web/src/screens/trade/Released.tsx:105`. "Before the network fee for your payout. X2F pays the network fee for its own 1%." is shown to every buyer. The standing rule is that only the poster sees the X2F fee: the taker never sees "X2F fee" or "1%" (release.test.tsx:626 "Only the poster sees the X2F fee", and quote.spec.ts on the BuyQuote card). On a seller's ad, the taker buyer now reads about a 1% they never pay. The test `release.test.tsx > Released > taker buyer: the whole amount and no fee anywhere` fails on exactly this: `expected '...X2F pays the network fee for its own 1%.' not to match /X2F fee|1%/i`.
**Fix:** show only "Before the network fee for your payout." to a taker buyer. Add the X2F sentence for the poster buyer only (`fee !== null`), or drop it (copy question Q1).

### B2. Nine web unit tests and one API test are red (expected shapes not updated for the mark)
`payoutsFor` now adds `bearsNetworkFee: true`, and these tests still `toEqual` the old two-key objects:
- `apps/web/test/policy.test.ts:109`: 2 tests (the mod-built buyer win, poster seller and poster buyer).
- `apps/web/test/attestation-flow.test.ts`: 6 tests, at line 708 (release: seller builds, buyer co-signs), 1026 (I2 seller catches up), 1133 ×3 (growth and starter caps) and 1202 (propose-cancel, then paid).
- Plus B1's release.test.tsx test.
- API: `apps/api/test/staff/revenue.test.ts:206`, the retention test "holds no trade or account column...", pins the `revenue_ledger` column list, which now also has `network_fee_atomic`. This file is in the branch's own diff, yet the test is red. The new column is an amount only, so the retention property still holds; update the list.

The branch's own commits ran only the files they touched, and attestation-flow.test.ts is not one of them. This is test drift: the logic is right.
**Fix:** add `bearsNetworkFee: true` to the buyer and fee entries in those expectations. That also asserts the marks on the ruling set.

### B3. A resumed release never reaches the party: `fromStored` drops `bearsNetworkFee` (regression, shown by a probe)
`apps/web/src/escrow/runtime.ts:722` (`fromStored`) rebuilds each payout as `{ address, amountAtomic }`. The stored record does keep the marks: my probe logs `[true,true]`, because `rec.intent.outcome.to` is `o.to`. `StoredPayout` (`store.ts:33`) does not declare the field either. On resume, `settle(this.fromStored(intent.outcome))` is checked by `cosignPolicy`. That check now compares the marks (`policy.ts:122`), so it refuses the unmarked copy silently (`settle()` returns). Before this branch, that call let a resumed party carry on with the outcome it was settling (the comment above line 710).

When the escrow is still `balance == unlocked`, the next tick re-derives a marked outcome and recovers. So the failure needs the escrow to be no longer fully unlocked: for example, the seller reloads after the co-signer submitted the tx and it sits in the pool. Nothing then hands the outcome to the party again, and the intent stays `done: false`.

Probe, added temporarily to `apps/web/test/attestation-flow.test.ts` in the "guards in front of settle" block (not committed):
```ts
it('ZZ-REVIEW probe: on resume with the sweep in the pool (balance != unlocked), the stored release still reaches the party', async () => {
  const t = await settlingSeller();
  const rec = (await t.seller.store.load(CODE))!;
  expect(rec.intent?.done).toBe(false);
  t.parties.funds = { ...t.parties.funds!, unlocked: 0n };
  const count = t.parties.settles.filter((s) => s.role === 'seller').length;
  const again = await t.mk('seller', { idb: t.seller.idb });
  await again.runtime.resumeAll();
  await t.parties.ticks('seller', 3);
  expect(t.parties.settles.filter((s) => s.role === 'seller').length).toBeGreaterThan(count);
});
```
On e6f718c4 it fails (`expected 1 to be greater than 1`). With `fromStored` changed to keep `bearsNetworkFee`, it passes, so the dropped mark is the cause. The test party is a fake, so the downstream effect is inferred from the code, not observed: the seller's settle promise and the work after it, such as its post-release info to the moderator, only run once the party gets the outcome again.
**Fix:** carry `bearsNetworkFee?: boolean` in `StoredPayout` and in `fromStored`. Include the mark in `key()` (`runtime.ts:264`) so that the `refused`, `exhausted` and `inflight` sets never mix a marked set with an unmarked one, and do the same in moderation `desk.ts:183` `outcomeKey`. Add the probe as a regression test.

### M1. Migration number 550 is taken by another open branch
`apps/api/migrations/550_revenue_network_fee.sql`. `550_ruling_statements.sql` already exists on `origin/wip/lead-disputes-stack` and `origin/wip/third-lien-recovery` (both 1cff3d66, 13 Nov). The runner applies migrations by name (`migrate.ts:17`), so both would run. But the repo convention is one number per migration (coordination.md, notes for 113/306), and every name list in `schema.test.ts` will conflict on merge. Numbers used on main or on open branches: 540, 550, 560, 570, 580, 590, 610 and 701.
**Fix:** renumber to a free number, e.g. `600_revenue_network_fee.sql` (unused on main and on every origin branch I listed), and update the three `schema.test.ts` lists.

### M2. The books record a computed share of an uncapped reported fee, not what X2F's output actually lost
`apps/api/src/staff/revenue.ts` `bookSettlementNetworkFee`; `apps/api/src/internal/routes.ts:268` (`ATOMIC` allows 31 digits). The API books `floor(reportedFee / 2)` whenever a released trade reports a fee. It never caps the fee at `MAX_NETWORK_FEE`, and it never checks that the fee output really bore a share.

On a seller–buyer release the moderator did not co-sign, the watcher counts the sweep through `proveSweep`, which caps the fee at 0.01 XMR when checking minimums. But the tx itself is whatever the two traders' apps signed. A modified app, or two old app versions (buyer bears everything, fee output exact), produces a tx where `networkFeeAtomic` is not what X2F paid. Example: a 0.5 XMR fee is booked as 0.25 XMR of X2F network fees, although the fee output lost at most 0.005 XMR. That is enough to pass `proveSweep`. No money moves. The cost is wrong `netAtomic` figures for the owner.
**Fix (cheap):** book `networkFeeShares(min(fee, MAX_NETWORK_FEE), …)`, and log or alert when fee > MAX. **Better:** have the watcher send the shortfall it saw (`feeFor − received[fee output]` from `proveSweep`, or from its own decoded tx when it co-signed), and book `min(share, shortfall)`.

### I1. An inflated fee now costs X2F up to 0.005 XMR per release (griefing only)
`packages/escrow/src/verify.ts` with `MAX_NETWORK_FEE = 0.01 XMR`. On a release the seller builds and the buyer co-signs, and X2F signs neither. Before this branch, a builder that chose a high fee burned only the buyer's output. Now half of it comes off X2F's 1%. The bound and the split stop anyone moving fee between outputs, and the burnt amount goes to miners, so nobody gains. For a small trade, though, 0.005 XMR can be most of the 1%. Possible fix if wanted: a lower co-signer cap for the fee output's share (owner/lead call, Q3).

### I2. Mixed app versions
coordination.md "Open" covers this: an old co-signer refuses a new set (the digest and marks differ) and the reverse. Two old apps settling between themselves still produce the old shape, and M2 then misbooks it. Pre-launch, so this is only a note for the rollout plan.

### I3. Ruling statements on the disputes stack will need the marks
On `wip/lead-disputes-stack`, `packages/trade/src/rulingStatement.ts:30` signs payouts as `{address, amountAtomic}` only, and the device compares order, addresses and amounts. That stays consistent here, because each device derives the marks from the kind itself (`payoutsFor('dispute-buyer')`). Whoever merges second should either add `bearsNetworkFee` to the statement or note why it is left out.

### I4. Booking edge cases
A settlement whose watcher state was saved before this change (`ShownTx` without `feeAtomic`) books no network fee. That is the safe direction. `toDate` scans the whole ledger, which is fine at this size.

## Questions for the owner (via the lead)
- **Q1, copy (COPY-UNSIGNED).** BuyQuote "about 0.00005 XMR for your payout, taken from it". Released "Before the network fee for your payout. X2F pays the network fee for its own 1%." Poster-buyer terms "...less 1% (the X2F fee) and the network fee for your payout." *Recommendation:* approve the BuyQuote and terms lines. Show the X2F sentence on Released only to a poster buyer (B1), or drop it. The figure is "about": a release with a surplus output has a higher fee, still split between two outputs. The ruling copy ("X XMR goes to you", `dispute/rules.ts`) does not mention the network fee at all. This was so before the branch too, but it is now inconsistent with Released.
- **Q2, minimum trade.** A fee output smaller than its share of the network fee makes wallet2 refuse the build, so such a trade can never release. *Recommendation:* a minimum trade size, or a minimum fee output (e.g. 1% ≥ 0.001 XMR, so trades ≥ 0.1 XMR), enforced at offer/take time. Leaving it as is means stuck escrows that need a ruling.
- **Q3, interpretation.** The owner said "paid by the person who is set to receive it". The branch exempts the seller's surplus output, although the seller receives it. *Recommendation:* keep the exemption (it is the seller's own money returning, and a tiny surplus as a bearer would hit `zero_amount`), but confirm it with the owner, along with whether X2F should accept griefing up to 0.005 XMR per release (I1) or a lower cap on its share.
- **Q4, pay accrual** (already in the docs' "Open" section). A senior's share is computed on the gross 1%. *Recommendation:* gross, as now, until the owner says otherwise.

## Tests run (worktree /home/user/wt/rv-netfee at e6f718c4, node 24.22.1)
- `@x2f/trade` project: **498 passed, 0 failed** (19 files).
- `@x2f/core` project: 38 passed (26 of the branch's, plus my 12-test property file, which was removed afterwards).
- `packages/escrow` pure files (verify, autoRefund, base64, buyerCancel; run through a scratch config without the regtest global setup): **49 passed, 0 failed**.
- `@x2f/moderation` `test/watcher.test.ts`: **31 passed**.
- Touched web files (policy, quoteScreen, release, tradeTerms): **149 passed, 3 failed** (B1 and B2). `attestation-flow.test.ts` (not touched): **107 passed, 6 failed** (B2).
- `@x2f/api` project under the lock: **2682 passed, 1 failed, 1 todo** (115 files). The one failure is revenue.test.ts:206 (B2).
- `@x2f/web` project under the lock: **2104 passed, 9 failed** (137 files). The 9 failures are exactly those listed in B1 and B2, and nothing else.
- **Not run:** `packages/escrow` engine.test.ts and spend-info.test.ts (both changed), party, followups and the other regtest files, plus `tools/regtest` and node-proxy. They need monerod, and downloads.getmonero.org is blocked here. So the claim that monero-ts 0.11.16 builds the permuted layout on regtest is **not re-verified**. My wallet2 source check covers wallet2's side only, not monero-ts's index check. Playwright `quote.spec.ts` (touched) was not run.
