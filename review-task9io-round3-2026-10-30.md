# Re-review (round 3): Plan 3 Task 9 I/O, wip/second-p3-task9-io @8cfdbe6 (claude2), 2026-10-30

Reviewer: helper, read only. This round covers the fix round `3dc2a58..8cfdbe6` (f495045 red tests, f19f0ef trade, 3740ccd moderation, 13842f7 escrow, 8cfdbe6 docs), measured against round 2 (`review-task9io-round2-2026-10-29.md`). I also read Task 10 (`origin/wip/second-p3-task10` @6228584, which already merges 8cfdbe6) for the R2-M1 question. I trial-merged the main line at 27e96df.

## Verdict: CHANGES REQUIRED

There is 1 Important finding and 3 Minor ones.

Everything claimed in round 2 is built and tested, and it works as designed:
- the ring binding,
- the durable one-tx-one-trade record,
- no channel close while a coin is late,
- subaddress tx keys.

One gap remains. The ring binding assumes that another trade's legitimate release has honest rings. But the seller who builds that release chooses its decoys. So the attack of R2-I1 still works without any API compromise when the attacker builds the reused tx himself, and `mod_sweeps` then turns it into a race that the first trade to count the tx wins (R3-I1).

The same small fix closes both R3-I1 and R2-M1: an import-only sweep counts only when both trade parties' sealed `spend.info` name that tx. Task 10's shadow trade does not close R2-M1 (see the assessment below). With that fix, Task 9 can land before Task 10.

## Round-2 items: verified in code and tests

- **R2-I1 (a), proof bound to the escrow.** Verified at `packages/escrow/src/monero.ts:240` `spendsOwnOutput`, required at `party.ts:1083` (`spendsEscrow !== true` → false).
  - **Ring offsets.** The daemon gives relative `key_offsets`. monero-ts copies them raw into `ringOutputIndices` (`MoneroDaemonRpc.js:1144`, `safeSet(... val.key_offsets)`). `absoluteRing` (`monero.ts:75`) adds them up: the first offset is absolute and each next one is relative. There is no off-by-one. BigInt avoids precision problems.
  - **Output index.** The wallet's `getIndex()` is the global output index (monero-ts sets `index` from `global_index`). The regtest test confirms both: the real release is still proven, and an unrelated real tx is now refused (`spend-info.test.ts:158-171`). If either index were wrong, the honest release would fail.
  - **Inputs carrying one of the wallet's key images.** Any such input whose ring lacks that output makes the whole proof false. That is good.
  - **The limit.** The key image is whatever the forged partials made it, so this checks only "the escrow output is a ring member of the input with the forged key image". claude2's write-up says so honestly. See R3-I1 for the consequence.
- **R2-I1 (b), one tx counts for one trade.** Verified.
  - Code: `005_sweeps.sql` (`tx_hash` primary key, with a hex check), and `claimSweep` at `watcher.ts:219` (insert `on conflict do nothing`, then select the owner).
  - Ordering: the claim comes before the evidence is returned, so it comes before the report (`watcher.ts:196-214`).
  - Crash between the claim and the report: on restart the same trade claims again, gets `true` and reports. That is idempotent and correct.
  - Two watchers, or two passes, at once: the primary key serializes them. The second insert waits for the first commit and then finds the row, so exactly one trade wins. That is correct.
  - Own txs are claimed too. That is right, but see R3-I1: a forged claim made first can push an own tx out.
  - Test: `watcher.test.ts:658`, including after a restart and the 6 h fallback.
- **R2-I1, channel close with late coins.** Verified at `packages/trade/src/watch.ts:342`. `closeChannels` requires `late.length === 0`, and a later sweep that takes the rest closes them. Tests: `watch.test.ts:277`, `:318-345`, and `watcher.test.ts:695`. One leftover is a late coin after an earlier full close (R3-M1).
- **R2-I2, subaddress tx keys.** Verified.
  - `TX_KEY` is 1 to 17 chunks of 64 hex (`monero.ts:65`).
  - `isTxKey` (`monero.ts:68`) runs `isScalar` (non-zero, below L) on every chunk before monero-ts sees the key, so the WASM-abort guard holds.
  - `txKey()`, `buildRelease` and the party's `TX_KEY` (`party.ts:213`, `:267`) keep the whole key.
  - Malformed keys: a wrong chunk count for the tx, 17 chunks for a 2-output tx, a non-scalar, uppercase or an odd length. Each is either refused by the regex or `isTxKey`, or makes `check_tx_key` throw, which is caught and gives null and then false. `check_tx_key` decodes amounts against the RingCT commitments, so a made-up additional key cannot inflate `received`.
  - Regtest test `spend-info.test.ts:189` (buyer subaddress plus fee wallet) passes.
- **R2-M1.** Not closed. See the assessment below.
- **R2-M2.** The residuals are recorded in the plan's Revision 2026-10-29 ("Fix round 2"). Done.
- **R2-M3.** Comment added (`party.ts:1023`). Done.

## Important

**R3-I1. A seller who builds trade B's release can put trade A's escrow output in its rings as a decoy. B's real release then also counts for A, and `mod_sweeps` makes it first come, first counted. No API compromise is needed.**
Where: `apps/moderation/src/watcher.ts:225-238` (`proven`: one party's proof is enough), `watcher.ts:204-214` (claim order), `packages/escrow/src/monero.ts:240`.

The round-2 fix (a) rests on "a pre-existing legitimate tx never has escrow A's outputs in its rings". That holds only for rings chosen by an honest wallet. The R2-I1 scenario has the same seller S in both trades and the same buyer payout address, with amountB ≥ amountA. In it, S is the builder of trade B's release:
1. S builds T_B with a modified wallet. One input's ring contains escrow A's output as a decoy; consensus allows any unlocked output. Buyer B's cosigner checks only the payouts (`checkRelease` through `describeMultisigTxSet`), not the decoys, so it signs.
2. As in R2-I1, S starts a release in trade A, gets the buyer's export, and sends mod-A forged partials. They make mod-A's composite key image for that output equal to the real key image of the T_B input that carries the decoy. S also sends `spend.info { txHash: T_B, txKey: k_B }`.
3. `spendsOwnOutput` for A is true (matched key image, A's output in that ring). T_B pays the buyer's address at least toBuyerA and the fee wallet at least feeA, so A's proof passes.
4. Mod-B proves T_B honestly. Both proofs become possible at the same block. Whichever trade's watcher calls `claimSweep` first wins.
   - The loop goes `order by trade` within one pass, and S controls when each `spend.info` is sent.
   - S can repeat this over several trade pairs until A wins.
5. If A wins, trade A is reported `settled` and released, its channels close, and buyer A paid fiat for nothing. Escrow A's coins stay locked: this is griefing, but it is the R2-I1 harm. Trade B escalates through the 6 h fallback and a dispute, even though its buyer was paid.

The same front-run can push the mod's own co-signed tx out (`own` txs are claimed too). A forged claim made first leaves the mod's own release `sweep-counted-elsewhere`, and the trade escalates.

The same capability, together with the API naming the wrong kind, is R2-M1. One fix closes both.

**Required fix.** A sweep shown only through an import (`!own`) counts only when **both** trade parties' sealed `spend.info` name it. That means `f.spendProofs` holds an entry `from: 'buyer'` and one `from: 'seller'` whose `txHash === o.txHash`; `txKey` may be `''` for one of them, and at least one key must prove the minimums.
- A seller–buyer settlement (release or mutual cancel) is signed by both, and the regtest test already shows both parties send `spend.info` with the hash (`spend-info.test.ts`, 2 proofs).
- A forger cannot produce the other party's sealed statement. Buyer A never names T_B on trade A's channel, and in R2-M1 the buyer never names the fresh self-paying tx.
- Optional: check `ownTxs` before claiming, and never yield an own tx to an earlier claim by another trade (log both trades).

Tests:
- Hermetic: a proven tx with only the seller's (or only the buyer's) proof is not counted, then counted once the other party's proof arrives.
- Hermetic: R3-I1 as two trades, where trade A has only one party's proof for T_B and the record stays free for B.

Liveness cost: if the cosigner goes offline before its `spend.info` is acked, the 6 h fallback escalates to a dispute. No coin is at risk, only some extra disputes. It could be eased later by putting `txHash` into `spend.claim`, the too-big case.

## R2-M1 assessment and landing recommendation

**Severity and realism (R2-M1 alone).** Minor, as in round 2. It needs all of these:
- a compromised API (X2F's own server),
- a colluding or same-person trade party,
- a modified wallet to build a ring with a chosen decoy and to send forged partial key images.

It never moves coins to the attacker. S pays itself from its own money, at the cost of one network fee, and the escrow coins stay locked; X2F still cannot move coins. The harm: the mod's own record says "swept", there is no late-funds escalation, and the relay channels close. The buyer, who paid fiat, loses the mod-side path to recover, and Task 10's desk signs nothing more. A compromised API can already stall or deny a buyer's dispute on its own, so R2-M1 adds harm only to the mod's independent check.

**Does Task 10's shadow trade close it? No, not as built** (`origin/wip/second-p3-task10` @6228584):
- The Task 10 watcher still feeds `spendEvidence` the API's kind: `settleKind: item.settleKind` (task10 `apps/moderation/src/watcher.ts:355`). The shadow is never consulted for the kind.
- The shadow could not tell anyway. It is fed only by `setup-done`, `chain`, `settled` (from this same watcher, so circular) and by the signals `trade.paid`, `trade.cancel`, `trade.extend` and `trade.refund-request` (`packages/trade/src/signals.ts`). There is no release signal and no mutual-cancel signal.
  - During a seller–buyer release the shadow sits in `paid`, and `settleKindFor` gives `null` there.
  - From `paid`, both `release` and `mutual-cancel` are legitimate, and they pay opposite parties. The shadow cannot choose between them.
- The shadow could confirm `auto-refund`, `lapse-refund` and `buyer-cancel`. Those are mod-co-signed (`ownTxs`) anyway, so they never use the import proof. The kinds that matter, release and mutual cancel, are exactly the ones the shadow cannot tell apart.
- So "take the kind from the shadow" would need new signed signals: a seller's release and both parties' mutual cancel. That is equivalent to the fix above, which is cheaper.

**Landing order.** Landing before or after Task 10 changes nothing here: Task 10 does not change the kind source. Production needs no Task 10 guard for this. Recommendation:
1. Fix R3-I1 in Task 9 now with the both-parties rule. It is about 10 lines in `proven`, plus 2 hermetic tests, and it also closes R2-M1.
2. Correct the plan revision (`2026-10-15-plan-3-trading.md` line 14, "Owed (R2-M1) … once Task 10 builds it") and coordination.md, which say the shadow will close it.
3. Then Task 9 can land ahead of Task 10, which merges cleanly on top (it already contains 8cfdbe6).

If the lead wants Task 9 on the main line before that fix, it is acceptable only as long as no real-money trading runs; there is no production yet. Record R3-I1 as a hard prerequisite of the first mainnet deploy, not as "owed to Task 10".

## Minor

**R3-M1. A late coin after a full close escalates with the channels already closed.** Where: `packages/trade/src/watch.ts:342-343`. `channelsClosed` is never reset. Scenario: a full release closes both channels, and a stray deposit arrives later. `late-funds` escalates to a dispute, but returning that coin needs a 2-of-3 signing over the escrow relay channel, which is gone. Fix: when a fresh late tx is reported after `channelsClosed`, register the channels again (`relayRegisterMessage`) and clear `channelsClosed`. Or record this as owed to Plan 4's late-funds handling.

**R3-M2. The docs overstate the round-2 binding.** The `spendsOwnOutput` doc comment (`monero.ts:229-239`) says "A tx that existed before … never has this escrow's outputs in its rings". That is true only for txs whose builder was honest. Reword it to point at R3-I1 and its fix.

**R3-M3. Test realism.** The hermetic "replayed tx below the funding height" (`watcher.test.ts:695`) stubs `prove = () => true`. With the real `spendsEscrow`, such a tx can never be proven, because a ring cannot contain a later output. The test is fine for `watchStep`'s no-close rule, but the name should say it is a stubbed proof.

## Landing and conflict notes (merge-tree against 27e96df)
- Conflicts are in `apps/api/test/schema.test.ts` (3 lists) and `docs/coordination.md`, both known.
  - schema.test.ts: take the main-line lists and insert `'113_release_claim.sql'` between `112_take.sql` and `115_news.sql`. 113 is still free on the main line.
  - coordination.md: keep both sections.
- No other conflicts. The lockfile is unchanged.
- Moderation migrations: 001 is on the main line. This branch adds 003 and 005; Task 10 adds 004; Task 20 has 002. `migrateModeration` applies files by name from an applied set, not by highest version, so a gap and a later 002 or 004 apply fine.
- `origin/wip/second-p3-task10` merges cleanly with 27e96df.

## Tests (own worktree ~/x2f-worktrees/rv-t9r3 = 8cfdbe6 + the 27e96df merge, resolved by hand; under check.lock, one at a time; removed afterwards)
- npm ci: ok.
- tsc --noEmit for escrow, trade, moderation and api: clean.
- vitest @x2f/trade + @x2f/moderation: 13 files, 370/370 passed.
- vitest @x2f/api schema (with the hand-resolved list), watchReports and timers: 3 files, 80/80 passed.
- vitest @x2f/escrow verify.test.ts: 19/19 passed.
- vitest @x2f/escrow spend-info.test.ts (regtest, Docker): 3/3 passed. This covers the real release proven, the unrelated tx refused, and the subaddress plus fee-wallet release.
- No test covers R3-I1 (two trades' proofs of one tx where only one party's proof names it for trade A), or R3-M1.
