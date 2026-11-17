# Review (MONEY + security): wip/third-lien-recovery @ 45b440a4 (reviewed at 377c9e3e; 16-17 Nov 2026)

**Verdict: CHANGES NEEDED** (4 blocking, 6 minor). The arithmetic and the API bookkeeping are careful (bigint throughout, floor, capped at the free remainder, an add-only ledger with a sum guard, no double recording, refunds and cancels release the hold, recording only on the chain-observed `settled`). But under this review's threat model the recovery is **not** protected by anything the API cannot forge: the moderation service signs whatever `lienRecovery` the API hands it, and the buyer's device "confirms" a figure the API itself sent and never shows to the person. A compromised API can therefore take up to all but one atomic unit of any buyer's proceeds, to any address, whether or not the buyer owes a lien (B1). Two further blockers are reachable with an honest API: a creditor can make every purchase of the debtor unpayable by registering the debtor's own payout address (B2, proven with a test), and an approved rate near 100% leaves the buyer's output smaller than the network fee so the release cannot be built (B3, proven). Four tests the branch's own changes broke are red (B4), and migration 560 collides with `560_account_bans` on two open branches (M1; the lead says claude3 is renumbering).

**Head.** I reviewed the lien diff at 377c9e3e. On 17 Nov I fetched again and the head had moved to **45b440a4**, which merges `wip/second-disputes-fixes` c084f2b6 (moderation gate D-2/D-3, staff-web ModCase X3-1, staff.css). That merge touches no lien file, still has `560_lien_recovery.sql`, and fixes none of the findings below. I re-ran trade, staff, moderation, staff-web, tsc, copy-lint and the failing web tripwire at 45b440a4 (see Tests).

Reviewer: independent reviewer (claude2 cloud helper), read-only on code. Detached worktree `/home/user/wt/rv-lien` at 377c9e3e, then 45b440a4, fresh `npm ci`, node 24.22.1. Nothing committed or pushed. Probe tests were appended to `apps/api/test/take.test.ts` in the worktree only and the file was restored before the full API run.

Scope: `git log 1cff3d66..377c9e3e`, 9 commits (f6423c15 docs, cb3b8a43/7db78985 staff red/green, 5a0356ab/28e23d12 trade red/green, 1add1d64 api+moderation, abbb13f6 rate requests, 8b8ac19f web, 377c9e3e tests+docs), 49 files, +1738/-67. Read every changed file, plus the code they feed: `@x2f/escrow` `checkTxSet`/`buildRelease` (subtractFeeFrom [0]), `apps/moderation` `attest.ts`, `gate/verify.ts`, `main.ts recordedFor`, the trade machine's `settled`/`escalate` transitions, API `take.ts` wallet handling and migration 008 (wallet uniqueness).

Threat model: API and DB fully compromised; gate.bin, MOD_* secrets, staff-site build and honest staff/owner keys are not; counterparties may be malicious.

The owner's 16 Nov lien rules (partial recovery, no double compensation, option b at 50% with a senior-approved rate change, evidence before enforcement) are quoted only in the branch (`docs/lien-recovery.md`). I grepped origin/comms (owner registers, decisions, demo notes 11-16, handoffs) for "lien" and found nothing from 16 Nov; the lead should record them in owner-answers-register.md before merge.

## What holds

- **Arithmetic.** `recoveryFor` = `min(floor(proceeds × bps / 10000), free)`, all bigint, rate a safe integer 1..10000; `lienRemaining` throws on over-recovery; the API caps at `proceeds − 1` so `payoutsFor`'s "buyer keeps something" holds. Rounding is always down (toward the debtor). Zero is never an output (`rec.amountAtomic > 0n` guard, `recoveryOf` refuses ≤ 0).
- **The payout set is the attested one on every co-signer.** `payoutsFor` (`release`, `dispute-buyer`) and `sweepMinimums` take the recovery only from the attested terms; the web `cosignPolicy` builds `signedTerms.lienRecovery` from the verified attestation, never the API view (`runtime.ts:766`); the gate's `recordedTerms` takes it from the moderation service's own `signed_terms`. `checkTxSet` then requires the exact set, so given the attested terms nobody can add, inflate or redirect a recovery by one atomic unit, and a refund (`dispute-seller`, every cancel) never pays one. The X2F fee output is unchanged (exact `feeFor(amount)`); the recovery comes only out of the buyer's share.
- **Bytes compatibility.** `lienRecovery` is omitted when absent (attest.ts:77, internal `termsOf`), and `isAttestedTerms` accepts exactly the old key set or the old set plus a well-formed `lienRecovery`.
- **No double recording.** `settleRecovery` runs once per transition into a closed state, locks the open hold `for update`, and a closed hold can never reopen (560 guard); `unique (lien_id, trade_code)` and the sum trigger back it up. Recording only on `settled` with kind `release`/`dispute-buyer` (rule 4), tested; "I've paid" and the release start record nothing (tested).
- **Concurrency.** Two takes by one debtor are serialised by take's `accounts ... for update` on both parties (taken before `reserveRecovery`), so the second take's statement snapshot sees the first's hold. Settle vs reserve is consistent because one transaction moves the amount from "held" to "recovered". (Note: the `for update of l` in `reserveRecovery` alone would not be enough: in READ COMMITTED the `sum(...)` subqueries in its select list keep the statement's snapshot after waiting on the lien lock. It is the accounts lock that makes it correct; say so in the comment.)
- **Rate requests, honest API.** Propose needs `disputes.handle` and a reason (1..500, also a DB check); approve/reject need `rulings.approve`, role senior/owner and not the proposer (`canDecideRateRequest`, plus `decided_by <> proposed_by` in SQL); approve consumes a `lien-rate` key tap bound to lien, request and rate (`tapPermOf` → `rulings.approve`); one pending request per lien (partial unique index); every decision logged without the reason text. A moderator cannot self-approve; a senior cannot approve their own proposal (tested).
- **Notices.** `GET /v1/account/liens` and the web screen carry no account ids or addresses; the trade view's `lienRecoveryAtomic` is the buyer's only (tested). The web parser refuses figures that do not add up.

## Findings

### B1 (blocking, MONEY/security): a compromised API can inject or inflate a recovery on any buyer's release; nothing outside the API checks it
`apps/api/src/internal/routes.ts:110-136` (`termsOf` puts the open hold's address and amount into the terms), `apps/moderation/src/attest.ts:53,77` (only `isAttestedTerms`, then signs it), `packages/trade/src/attestation.ts:332-339` (buyer check), `apps/web/src/screens/quote/useTake.tsx:124-128` and `AcceptedSheet.tsx:139,159` (the "confirmed" amount is the API's take response / trade view).

The moderation service has no lien state: it signs any well-formed `lienRecovery`. The buyer's device accepts the attested recovery iff it equals `ConfirmedDeal.lienRecoveryAtomic`, but that figure is copied silently from the API's take response (taker) or trade view (poster-buyer); the person never sees it (NEEDS_DESIGN_LIEN_NOTICE). The seller's device ignores it. So with the API compromised:
1. buyer B (no lien) takes an offer; the API returns `lienRecoveryAtomic = toBuyer − 1` and writes a hold to an attacker address;
2. moderation signs terms with that recovery; B's device stores the same figure as "confirmed", so `verifyAttestation` passes; the seller's device and `checkTxSet` require exactly that set;
3. on release B receives 1 atomic unit (minus the network fee: in practice the attacker picks `toBuyer − fee − ε`) and the attacker the rest.

Before this branch, a compromised API could not touch the buyer's proceeds (the buyer's device checks `buyerPayout === ownAddress`). This branch opens that path. "More than owed", "more than the rate", "wrong address" and "no lien at all" are all enforced only in API code and in DB triggers the API role owns. The `lien-rate` key tap is likewise API-only (the API applies the rate at take), so under this threat model it protects nothing. The design doc's last section names the gap; it must be closed before `liens_enabled` is turned on, not after.

Fix (lead/owner decision, pick one; my recommendation is the first two together):
- **The moderation service is the authority.** At ruling publication the gate already signs ruling statements (550): have it sign a lien statement `{lienId, debtor, creditor, amountAtomic, rateBps}` and keep, in its own DB, the sum it has signed into terms per lien (reserved and released as it sees trades close on its own watcher). At attestation it refuses a `lienRecovery` that is not `min(floor(proceeds × rate), owed − signed)` for a lien whose debtor is this trade's buyer. A rate change then needs the senior's key tap verified by the moderation service (a gate-checked tap kind like `ruling`, not an API-only one like `set-grants`).
- **The creditor's address is bound by the creditor's own device** (a signed "pay my recoveries to X" statement, verified by moderation), so the API cannot substitute its own.
- **The buyer sees it and agrees before the take.** The quote shows "this purchase pays X XMR to the person you owe" and the device takes the amount from what the person accepted; a buyer who was never told about a lien sees an unexpected deduction and can refuse. Alone this is weaker (a compromised API can also show a fake lien), but it is the owner's rule 3 ("the debtor is told") anyway.

### B2 (blocking, MONEY, honest API): a malicious creditor can make every purchase by the debtor unpayable
`apps/api/src/disputes/recovery.ts:83-90` picks the creditor's newest usable wallet with no check against the trade's own addresses; `apps/api/migrations/008_wallets.sql:17` makes wallet addresses unique per account only; `packages/trade/src/payouts.ts:72-74` throws `bad recovery address` when the recovery address equals the buyer payout, the seller refund or the fee wallet.

The creditor was the debtor's counterparty in the disputed trade and saw the debtor's payout address in its attested terms. They add that address as one of their own wallets, wait out the cool-down, and from then on every take by the debtor reserves the recovery to the debtor's own address. If the debtor reuses that wallet, `payoutsFor` throws for `release` and for `dispute-buyer` on every device and in the gate, so after the buyer has paid fiat the only settlement that can be built is a refund to the seller (`dispute-seller`): the buyer loses the fiat. The X2F fee wallet address (shipped to every device in config) works the same way for every trade of the debtor regardless of which wallet they use.

Proven (probe appended to the branch's own `lien recovery at take` describe, not committed):
```ts
it('REVIEW PROBE: a creditor who registers the debtor\'s payout address gets it reserved, and the release set cannot be built', async () => {
  ...
  await lienOn(debtor, creditor, 2n * XMR);
  await deps.db.query('update wallets set address = $2 where account_id = $1', [creditor.id, debtor.address]);
  const res = await take(debtor, offer, body(debtor, XMR));            // 200
  expect((await holds(code))[0]!.address).toBe(row.buyer_payout);    // reserved to the debtor's own address
  expect(() => payoutsFor({ kind: 'release', ..., lienRecovery: { address: h.address!, amountAtomic: BigInt(h.amount) } })).toThrow(/bad recovery address/);
  expect(() => payoutsFor({ kind: 'dispute-buyer', ... })).toThrow(/bad recovery address/);
});
```
Result: see Tests (PROBE-B2).

Fix: refuse to reserve when the creditor address equals the trade's buyer payout, seller refund or the fee wallet; for a poster-buyer whose payout is chosen later (`POST /v1/trades/:code/wallet`), check again there and release the hold (or refuse that wallet) on a match; and recheck in `termsOf` before asking for a signature. Better still, B1's creditor-signed address plus a wallets-side refusal of an address another account already holds.

### B3 (blocking, MONEY): a high approved rate leaves the buyer's output below the network fee; the release cannot be built
`packages/staff/src/lienRecovery.ts:22` allows 1..10000 bps (also `560` check and `keyTap.ts:448`); `recovery.ts:78-80` caps the recovery at `proceeds − 1`; `payoutsFor` only requires the recovery to be below the proceeds; `packages/escrow/src/verify.ts:72` and `monero.ts:315` take the whole network fee from payout 0 (the buyer).

At 10000 bps the buyer's output is 1 atomic unit. wallet2 refuses to subtract a fee from an output that is not larger than it (`zero_amount`), so no release or `dispute-buyer` tx can be built, and the trade can only be refunded to the seller after the buyer paid fiat. Any rate that leaves `toBuyer − recovery ≤ fee` (fee up to `MAX_NETWORK_FEE` = 0.01 XMR) has the same effect on small trades. Proven: probe "an approved rate of 10000 bps leaves the buyer 1 atomic unit" (Tests, PROBE-B3) returns `lienRecoveryAtomic = XMR − 1`.

Fix: the buyer's output after recovery must be at least `MAX_NETWORK_FEE` plus a margin, enforced in `recoveryOf` (shared by every co-signer, so a forged set is refused too) and in `reserveRecovery` (so the API never reserves one that would be refused). And/or cap the approvable rate below 100% (owner question Q1).

### B4 (blocking, tests): four tests the branch broke are red
Full runs at 377c9e3e (the 45b440a4 merge touches none of these files; the web one is still red at 45b440a4):
- `apps/api/test/frontDoor.test.ts` "every session-guarded route ... is behind requireInside or is listed as own-data-only": `GET /v1/account/liens` is new and in neither list. Decide which (it reads the account's own data: probably `requireInside` like the other account reads) and add it.
- `apps/api/test/jabber-paths.test.ts` (2 tests): `liens.recovery_rate_bps` is an unclassified column of a change table, and `lien_rate_requests.proposed_by` / `decided_by` refer to accounts but are neither change paths nor in `NOT_ACCOUNT_CHANGES`. Classify them (rate change: does the debtor get a Jabber "account change" notice? staff ids: NOT_ACCOUNT_CHANGES with a reason).
- `apps/web/test/tradeRoom-tripwires.test.ts` "the web TradeView matches the API's": the API `TradeView` gained `lienRecoveryAtomic`, the web `TradeView` did not. Add it (optional string) to the web type.

### M1 (minor, merge): migration number 560 is taken by another open branch
`apps/api/migrations/560_lien_recovery.sql`. `origin/wip/lead-bans` and `origin/wip/lead-batch10a` both have `560_account_bans.sql`. Numbers in use on main and origin branches at 500 and up: 500, 520, 540, 550, 560, 570, 580, 590, 600, 610, 701. Fix: renumber to a free number (e.g. 620) and update the three `schema.test.ts` lists; the header comment's "next free number" claim is then out of date too.

### M2 (minor, MONEY, rule 2): a recovery can be paid without being recorded
`apps/api/src/disputes/recovery.ts:126-138` and `packages/trade/src/machine.ts:561,586`. The hold is released at cancel, but the moderation service's signed terms keep the recovery. A cancelled trade with funds can be escalated (`escalate` from a closed state when `receivedAtomic > 0`, late funds) and then ruled `dispute-buyer`; the gate pays the attested recovery, but `settleRecovery` finds no open hold and records nothing, so later trades recover the same amount again (the creditor is overpaid; the on-chain total exceeds the lien). Similarly a lien marked `repaid` by `complied` (NEEDS_TASK_12_TX_PROOF) while a trade with an open hold is in flight still pays that recovery (rule 2: "never more than owed"). Fix: on a completed settle with no open hold but a hold for this trade in any status, record the recovery from the trade's signed terms (or keep the hold open until the trade can no longer pay out); and make `complied` refuse (or wait) while a hold is open.

### M3 (minor, privacy): the seller learns the buyer owes a lien and the creditor's address
`apps/moderation/src/attest.ts:77`: one attestation, the same terms object, goes to both parties. The seller's device holds `lienRecovery.address` and `amountAtomic`: the buyer lost a dispute, how much is being recovered, and the creditor's Monero address (which links to the creditor's own trades as `buyerPayout`). Not shown in the UI, but any seller who reads their own device's data has it. Owner/lead question Q3; if it must be in the common terms, at least say so in the privacy notes.

### M4 (minor, privacy): the creditor can reconstruct the debtor's purchases
`apps/api/src/disputes/lienRoutes.ts:166-176`: `owedTo` carries each recovery's exact amount and timestamp **and** the lien's `rateBps`, so the creditor computes each purchase's proceeds (`amount × 10000 / rate`, exact unless capped by the remainder) and when it settled. The design says "the creditor sees recoveries received"; the owner should decide whether that means per-trade figures and times or a running total (Q4). Recommend: totals only (received so far, remaining), no per-trade rows and no rate.

### M5 (minor, merge with second-netfee-fixes): the creditor's output and the network-fee split are not designed yet
Trial merge (below) conflicts exactly on the release lists in `payoutsFor` and `sweepMinimums`. The doc says to mark the creditor's output `bearsNetworkFee`. Two consequences to settle before the merge:
- wallet2 refuses a bearer whose amount is not larger than its share, so a small recovery (the free remainder can be 1 atomic unit) would make the release unbuildable, like B3. Either do not mark the creditor, or never reserve less than `MAX_NETWORK_FEE` (carry a smaller remainder until it can be paid, or forgive it: owner).
- `feeWalletNetworkFee` on second-netfee-fixes hard-codes two bearers (`networkFeeShares(fee, [true, true])[1]`), so with a third bearer X2F's booked share is wrong; it has to take the actual mark list (and the tx-order permutation) from the trade's set.

### M6 (minor, tests): the moderation side has no recovery tests
No test under `apps/moderation/test` mentions `lienRecovery`: nothing pins that `signAttestation` signs it, that `authorizeRuling` pays it on `dispute-buyer` and not on `dispute-seller`, or that the watcher's `sweepMinimums` path accepts a release with a recovery (and what happens when `recoveryOf` throws there). Add them in `gate.test.ts`/`attest.test.ts`. Also missing in the API: the poster-buyer path (seller takes a debtor's buy ad, hold reserved, reaches the poster's view), and the `escalate` case of M2.

### I1: declared gaps (not counted as findings)
The doc's NEEDS_* list stands: NEEDS_STAFF_WEB_LIEN_RATE (no staff screen calls approve, so in practice the rate cannot be changed yet), NEEDS_DESIGN_LIEN_NOTICE, NEEDS_OWNER_SELLER_DEBTOR (a selling debtor repays nothing and is no longer blocked, since `LIEN_BLOCKS_SQL` is now `false` for every lien), NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY. None is hidden; each has a tripwire.

### I2: `reservedAtomic` shows a released hold
`apps/api/src/disputes/recovery.ts:110-113` returns the hold in any status, so a cancelled trade's buyer view still shows the recovery. Harmless (the trade paid nothing); filter `status <> 'released'` for accuracy.

## Questions for the owner (via the lead)
- Q1: May a rate be 100%? Recommend: cap at 90% and always leave the buyer at least 0.01 XMR (B3).
- Q2: Which creditor address receives recoveries (doc Q3)? Recommend: an address the creditor's device signs for this purpose (B1/B2), not "newest wallet".
- Q3: May the seller see that the buyer owes a lien and the creditor's address (M3)? Recommend: no; if the protocol needs it in common terms, disclose it.
- Q4: What does the creditor see (M4)? Recommend: totals only.
- Q5: Remainders smaller than a network fee (M5): carry, or forgive? Recommend: carry until a trade can pay at least 0.01 XMR to the creditor; forgive at the end only by a senior with a key tap.
- Q6 (doc Q4, kept): a lien voided or overturned while a recovery is in flight.

## Trial merge with origin/wip/second-netfee-fixes (6790d98d), not committed
`git merge --no-commit --no-ff` from 377c9e3e (detached scratch worktree, aborted afterwards). 7 conflicting files:
- From this branch's lien work (absent when merging 1cff3d66 alone): `packages/trade/src/payouts.ts` (both release lists, in `payoutsFor` and `sweepMinimums`: lien adds `toBuyer − rec` plus the creditor output, netfee adds `bearsNetworkFee: true` on buyer and fee), `packages/trade/test/payouts.test.ts` (the new lien describe vs netfee's tests).
- Already conflicting from the dispute stack 1cff3d66 (same five files conflict without the lien commits), with lien lines inside them: `packages/trade/src/index.ts` (export line: keep `RULING_KINDS`, `attestedRecovery`, `isRulingKind` and `feeWalletNetworkFee`), `apps/api/test/schema.test.ts` (three migration lists: keep 211, 212, 400, 401, 550, the renumbered lien migration and 600), `apps/api/src/internal/routes.ts` (settled: keep ruling kinds and `networkFeeAtomic`), `apps/api/src/staff/revenue.ts` (keep `owedOutstandingAtomic` from the stack and `toDate`/`treasuryNetworkFeesRecorded`), `docs/coordination.md`.
- Auto-merged but needs semantic review: `apps/web/src/escrow/policy.ts`, `runtime.ts`, `store.ts`, `apps/moderation/src/desk.ts`, `watcher.ts`. Resolution rule for payouts: insert the recovery output after the fee output in both lists, and decide its mark per M5 (if marked, `feeWalletNetworkFee` must take the real bearer list; if not marked, say so in the doc).

## Tests
Node 24.22.1, fresh `npm ci`; dockerd was running and I did not restart it; full and API runs under `flock /tmp/claude-0/heavy.lock`.

At 377c9e3e:
- `@x2f/trade`: 511/511 passed
- `@x2f/staff`: 277/277 passed
- `@x2f/moderation` (hermetic): 16 files, 240/240 passed
- `@x2f/escrow` (includes the monerod regtest, downloads worked): 16 files, 104/104 passed
- `@x2f/moderation-regtest`: 1 file, 2/2 passed
- `@x2f/api` (full): 118 files, **3 failed** | 2771 passed | 1 todo (2775); 2 files failed: frontDoor (1), jabber-paths (2), see B4
- `@x2f/web` (full): 138 files, **1 failed** | 2128 passed (2129): tradeRoom-tripwires, see B4. (ECONNREFUSED 127.0.0.1:3000 lines in the log are noise from tests without a server; they did not fail anything.)
- `@x2f/staff-web`: 9 files, 93/93 passed
- `npm run typecheck` (all workspaces): clean; `npm run copy-lint`: clean
- PROBES (appended to `take.test.ts` "lien recovery at take", file restored before the full run): 10 passed | 58 skipped. The branch's 8 tests plus PROBE-B2 (creditor address = debtor's payout is reserved, and `payoutsFor` throws for `release` and `dispute-buyer`) and PROBE-B3 (rate 10000 reserves `XMR − 1`), both passing, i.e. both bugs are real.

At 45b440a4 (new head, re-run of what its merge touches): `@x2f/moderation` 16 files 243/243, `@x2f/staff-web` 10 files 95/95, `@x2f/staff` 11 files 277/277, `@x2f/trade` 20 files 511/511, typecheck clean, copy-lint clean, `apps/web/test/tradeRoom-tripwires.test.ts` still 1 failed | 5 passed.

Not run: Playwright (not requested; no lien e2e spec exists); full `@x2f/api`/`@x2f/web`/escrow regtest again at 45b440a4 (its merge touches no API or web file and no escrow code; the API frontDoor/jabber-paths re-check at 45b440a4 was queued behind the shared lock and I stopped it, so the 377c9e3e result stands for those).

Counts: 4 Blocking (B1-B4), 6 Minor (M1-M6), 2 Info, 6 owner questions.
