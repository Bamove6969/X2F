# Re-review (round 4): Plan 3 Task 9 I/O, wip/second-p3-task9-io @7346fc0 (claude2), 2026-10-30

Reviewer: helper, read only. This round checks the round-3 fix commits, measured against `review-task9io-round3-2026-10-30.md`:
- 6c35f63: red tests for R3-I1
- 86dade7: the R3-I1 fix, plus the R3-M3 test rename
- 39bb201: the R3-M2 doc comment
- f60c449: merge of main line f13f574
- 7dc6f80: plan revision
- 7346fc0: review doc

I also trial-merged the current main line, 5c4d35b.

## Verdict: APPROVED WITH MINOR

R3-I1 is fixed correctly. R2-M1 is closed by the same rule, and R3-M2 and R3-M3 are done. R3-M1 is written down as owed and as a mainnet prerequisite in the Plan 3 revision, in coordination.md and in the review doc. It is not yet written in the Plan 4 or Plan 6 plan files (m1). There are no Critical or Important findings, and 3 Minor ones.

## Round-3 items verified

**R3-I1 (also R2-M1).** Fixed at `apps/moderation/src/watcher.ts:239-251` (`proven`).
- **The rule.** An import-only (`!own`) in-block sweep counts only when `spendProofs` holds a `from: 'buyer'` entry AND a `from: 'seller'` entry naming `o.txHash`. At least one non-empty key must then pass `proveSweep` against the minimums. The minimums still come from the mod's own signed terms and the API kind.
- **Order.** `proven` runs before `claimSweep` (`watcher.ts:207-214`). A one-sided statement therefore never writes `mod_sweeps`, and the record stays free for the trade that really owns the tx. The decoy test shows this: no `sweep-counted-elsewhere`, and B counts afterwards.
- **`from` is authenticated.** `spendProofs[].from` is the key of `state.received['spend.info:0']`, which is set only from `opened.from`, "the signed sender, never the raw frame's field" (`packages/escrow/src/party.ts:858`, `:807`).
  - `open()` refuses an envelope for another trade (`packages/protocol/src/envelope.ts:396`).
  - `wellFormed` refuses a `spend.info` from `mod` (`party.ts:265-268`).
  - So a seller cannot forge the buyer's statement, and cannot replay the buyer's statement from another trade (for example the same buyer in trade B naming T_B) into trade A. To forge it, he would need the buyer's per-trade signing key, which the attested participant list binds (`apps/moderation/src/attest.ts:88-96`).
- **The R3-I1 attack.** In trade A, S never gets an honest buyer A to name T_B. Buyer A sends `spend.info` only after its own release reaches `done` with a non-mod counterpart (`party.ts:682`), and then names `rel.txHash`, the tx it signed itself (`party.ts:712`). That can never be T_B. The attack is closed.
- **R2-M1.** A compromised API plus one party building a fresh decoy tx now also needs the other party's signed statement naming that tx. The honest party never names it, so this is closed.
- **Replay and omission inside one trade.** The mod imports one `spend.info` per sender, and the first one wins (`party.ts:791-810`). A party can lock its slot early with a wrong `txHash`. The result is the same as withholding: the honest sweep is not counted and the trade escalates. It cannot get a wrong tx counted. See m2.
- **Red-before-green, checked by running.** At 6c35f63 in my worktree, `vitest watcher.test.ts -t R3-I1` gives 2 failed (2/30 selected). Each fails for the intended reason: a `settled` report from a one-sided statement (`:704` and `:728`). At 7346fc0 both pass.
- **Existing tests.** They were updated to carry both parties' statements, and only by adding the second party's entry. No assertion was weakened.

**R3-M2.** Done. The comment now says what the binding proves and what it does not, and points at the watcher rule (`packages/escrow/src/monero.ts:229-245`).

**R3-M3.** Done. The test is renamed to say it is a STUBBED proof (`apps/moderation/test/watcher.test.ts:745`).

**R3-M1.** Recorded as owed to Plan 4 and as a MAINNET PREREQUISITE, with the reason it is not contained (relay close gives 4404, which is FATAL in `wsTransport`). It appears in:
- `docs/superpowers/plans/2026-10-15-plan-3-trading.md:17`,
- `docs/coordination.md:252`,
- `docs/superpowers/reviews/2026-10-29-p3-task9io.md:332`.

That is clear and accurate, but see m1.

**The accepted residual** (`plan-3-trading.md:16`). A trade whose buyer and seller are one person or collude can name another trade's tx on both sides and claim it first. I checked what this needs:
- one actor controls both of A's identities,
- that actor is the builder of T_B (seller of B), to choose the decoy,
- he holds T_B's tx key,
- A's signed buyer address was set at take time to B's buyer payout address, so that T_B "pays" A's minimums.

The harm: trade B (whose seller is the attacker) escalates after 6 h to a dispute over an empty escrow. Nobody is paid, and A's escrow coins stay under the attacker's own 2-of-3. "Griefs, pays nobody" is correct. The optional "an own tx never yields to an earlier claim" was not built. It matters only in this residual (or for own txs), and the residual cannot target a mod-co-signed own tx: it needs the builder's decoy choice, and the mod-built path picks honest decoys. Accepted.

## Minor

**m1. R3-M1 (and the relay-side expiry) is owed to Plan 4 but is not in Plan 4's or Plan 6's plan file.**
- Where it is: `docs/superpowers/plans/2026-10-15-plan-3-trading.md:17` and `docs/coordination.md:252` only.
- Where it is missing: `docs/superpowers/plans/2026-10-15-plan-4-staff.md` has no late-funds or `channelsClosed` item. The mainnet step list in `docs/superpowers/plans/2026-10-24-plan-6-hardening.md` (around `:1040-1050`, `X2F_MONERO_NETWORK=mainnet`) does not list it as a gate.
- Failure scenario: whoever writes Plan 4's late-funds task, or runs Plan 6's mainnet checklist, reads those files and never opens a Plan 3 revision note. The mainnet deploy goes ahead, and a stray deposit after a full close escalates to a dispute that nobody can sign out of the escrow (both channels gone).
- Fix: when landing (lead), add one line to Plan 4's late-funds/disputes task and one checkbox to Plan 6's mainnet steps, pointing at plan-3 line 17. This is doc only and does not block landing.

**m2. Liveness cost of the both-parties rule: one party alone can now force any seller-buyer settlement into a dispute.** The plan words this too narrowly ("a cosigner offline before its spend.info is acked").
- Where: `apps/moderation/src/watcher.ts:244-245`. Plan text: `plan-3-trading.md:16`.
- Before the fix, one party's honest statement was enough. Now each party is a single point of failure, in three ways:
  - **Withholding.** A buyer who has received the coins in a release (the release has to reach `done` on its client) and never reopens the app, or runs a modified client that never sends `spend.info`.
  - **Slot-locking.** A party sends one early `spend.info` with a wrong `txHash`. The mod imports one per sender and keeps the first (`party.ts:791-810`), so the later correct one is only acked.
  - **Dust.** A party dusts the escrow so that both exports exceed `SPEND_INFO_MAX_HEX`. Only `spend.claim` is then sent, with no hash.
- In each case: `spend-unshown`, then `escalate`, then a dispute against an innocent counterparty, 6 h after settling. No coin is at risk.
- The real worry is the honest-but-gone buyer on mobile. A buyer who got paid has no reason to reopen the app. If that is common, many clean releases end as disputes.
- Fix (doc now, code later):
  - Widen the plan's liveness note to "either party withholding, slot-locking or dusting".
  - Record a follow-up: let the dispute desk auto-close a `spend-unshown` dispute when the escrow is empty and the trade has one side's statement. Or move `txHash` into `spend.claim`, as round 3 suggested.
  - Count these disputes separately so the first testnet run shows the rate.

**m3. Merge with the current main line (5c4d35b, Tasks 38-39) has 2 code conflicts that need hand resolution.** This is a landing note, not a defect in this branch.
- `git merge-tree 7346fc0 5c4d35b` conflicts in `apps/api/test/schema.test.ts` (again: add `113_release_claim.sql` between `112_take.sql` and `115_news.sql`; main now has `116_fund_started.sql`) and in `packages/trade/src/machine.ts`, in 3 hunks:
  - **`SYSTEM_EVENTS` (around `:139`).** Needs both `'release-claimed'` and `'return-confirmed'`.
  - **`escalate` (around `:497`).** Must keep this branch's `s !== 'settling'` allowance AND main's `awaitingCancelConfirm(t)` exception. That is: `if (s !== 'lapsed' && s !== 'settling' && !CLOSED.includes(s)) fail; if (t.receivedAtomic <= 0n && !awaitingCancelConfirm(t)) fail;`.
    - Failure scenario if main's side is taken: `spend-unshown` from `settling` is refused `wrong-state`, so the R3-I1/m2 fallback never escalates.
    - If this branch's side is taken: Task 39's unconfirmed buyer-cancel return no longer escalates.
  - **`nextDeadline` (around `:632`).** Keep `case 'settling': return t.releaseClaimedAt !== null ? null : t.settleBy;` and main's `case 'refunded': return cancelAutoCloseAt(t);`.
- After resolving: run tsc for trade, api and moderation, and vitest for @x2f/trade, @x2f/moderation and the api schema, watchReports and timers tests (lessons R-rules: semantic clashes).
- Task 39's buyer cancel is mod-co-signed (`ownTxs`), so the both-parties rule does not affect it.

## Tests (own worktree ~/x2f-worktrees/rv-t9io-r4, under check.lock, one at a time; removed afterwards)
- @6c35f63, after npm ci: `vitest --project @x2f/moderation watcher.test.ts -t R3-I1` gave 2 failed and 28 skipped. Red, as intended.
- @7346fc0, after npm ci (the lockfile changed with the f13f574 merge):
  - `tsc --noEmit` for apps/moderation, apps/api, packages/escrow and packages/trade: clean.
  - vitest @x2f/moderation + @x2f/trade: 13 files, 372/372 passed (370 in round 3, plus the 2 new tests).
  - vitest @x2f/api schema.test.ts + watchReports.test.ts: 2 files, 84/84 passed.
- The regtest `spend-info.test.ts` was not rerun: escrow has a comment-only change (39bb201). It was 3/3 in round 3, and it shows that both parties send `spend.info` with the hash in a real release.
