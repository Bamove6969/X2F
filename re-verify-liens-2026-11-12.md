# Re-verify (MONEY): `wip/lead-liens` f3f238c2 (fix for R1 and R2), 12 Nov 2026

Reviewer: independent reviewer (cloud helper). Read-only on code. Detached worktree `rv-liens3` at f3f238c2, fresh `npm ci`, removed afterwards with its node_modules. dockerd was already up and was not restarted. Every run went through `flock ~/x2f-comms/check.lock`.
Earlier rounds: `review-liens-2026-11-12.md` (f97740c4, then 274ad0c1). The new commit is f3f238c2 only. It changes 4 files: `packages/staff/src/lien.ts`, `apps/api/src/disputes/lien.ts` and the two lien test files.

## Verdict: R1 FIXED, R2 FIXED. No new MONEY defect. Two info items for the lead or owner, one minor test gap.

| Item | Result |
|---|---|
| R1: the buyer's overturned lien keys on `compliedAt` | **Fixed** |
| R2: with liens off, the poster's 1% is recorded at finality, with no loss or double count across a flag flip | **Fixed** |
| The changed L1 tests (moved to a buyer's ad, "stands" now owes the 1%) | **Not weakened.** The old fixture was a state no stored row can be in. The new expectation is what the branch has always done on a buyer's ad. But D-062 is the wrong citation: this rests on g63 and on O3, which is still open (N3). |

## R1: fixed
In the round-2 overruled branch, the code (`packages/staff/src/lien.ts:166-169`) now reads:

`paidDebtor = afterRefund ? restitutionDebtor(round1 outcome) : null`

If `next.compliedAt !== null` and liens are on, it places a round-2 `overturned` lien on `other(paidDebtor)`, the buyer, for `facts.amountAtomic` with fee 0. The lien's status no longer plays any part.

- **`compliedAt` is a sound key.** `complied` is accepted only while `outcomeInForce` is `seller-sends-xmr` and only on an after-refund case (`dispute.ts:426`). So a non-null `compliedAt` at a round-2 decision means exactly one thing: the seller paid under round 1's order. Nothing clears it: the appeal copies the dispute (`...d`), and so does `resolveFinal`.
- **The right party is liened.** The lien goes on the buyer, because only `seller-sends-xmr` gives a restitution debtor. The overturned branch for escrow coins returns earlier, so the two can never both apply. The round-2 restitution branch only ever liens the seller, so the unique key `(from_code, dispute_seq, round, debtor)` cannot collide.
- **No fee goes with it, which is correct.** The final outcome is `no-action` or `seller-returns-fiat`, and g63 makes both `none`. The seller's round-1 lien, which carried F, is voided. So no 1% stays recorded.
- **Never paid means no lien.** Without `compliedAt`, nothing is placed on the buyer (pure test "never paid").
- **Red then green.** I put the 274ad0c1 versions of both source files back in my worktree and ran the new tests: 4/4 pure R1 tests and 4/4 API R1 tests failed. All pass at f3f238c2.

## R2: fixed
`LienFacts.liensOn` is new, and `checkFacts` refuses anything that is not a boolean. The API still drops `place` steps while off, as a second guard.

**At publish.** While off, publish returns `[]`, so no fee is written while an appeal could still undo it.

**At finality.** Every path that is final now calls `feeSplit(..., inLienOk)`:
- Round 1 final with no appeal, and round 2 "stands": `inLienOk = round1Carries(stored liens)`. That is whether a stored round-1 restitution lien that is not void already carries F. It is read from the stored rows, not from the flag now.
- Round 2 overturned places (escrow coins and restitution): `inLienOk = liensOn`, and the place step is pushed only while on.

So a 1% is either in a lien or a `fees_owed` row, never both and never neither:

| Flag at publish | Flag at finality | Where the 1% is recorded |
|---|---|---|
| on | off | in the stored lien (F) only. It does not bind while off, but it is not lost. |
| off | on | no lien is stored, so it becomes a `fees_owed` row |

**Red then green.** On 274ad0c1, 6 of the pure R2 tests and the API R2 test fail. All pass at f3f238c2.

### The full matrix (scratch probe, outside the repo, deleted with the worktree)
The probe drives `applyDispute` and `lienSteps` through every case and keeps a store of liens and owed fees the way `applyLienRules` does. That covers the `on conflict` keys, one `fees_owed` per dispute, and dropping `place` while off.

It runs 51 event sequences. They cover:
- after refund × each round-1 outcome, and escrow × each round-1 outcome;
- no appeal, or an appeal by the buyer or by the seller × each round-2 outcome;
- when the seller paid: never, during round 1, during the appeal, or after finality.

Each sequence runs × ad side (seller's or buyer's) × **every on/off flag combination per transition**, so 2^n per sequence. That is 4,656 runs.

Invariants checked at the end:
1. The 1% recorded (escrow output + fee in non-void liens + `fees_owed`) is exactly 1× when `rulingFee` of the final state is `poster-pays`, and 0× otherwise.
2. Only the poster is ever charged it.
3. A `fees_owed` row is written only on a transition into `final`, `complying` or `closed`. There is never a second one.
4. Nothing is placed while off, and no lien is left suspended at the end.
5. With the flag on throughout, the set of debtors with an active lien equals the set of parties wrongly holding XMR under the final outcome.

**Result: 0 of 4,656 runs fail.**

Sanity check: a mutation that ignores `liensOn` (the R2 bug) makes 2,024 runs fail. 256 of them are "fee charged 0×, expected 1×". So the probe does detect a lost fee.

## The changed L1 tests: a correct reading, not a weakened test
Two old L1 pure tests ("overruled to seller-returns-fiat" and "Decision stands after the seller paid") used `sellerPosted` with a round-1 lien of fee 0 and status `repaid`. On a seller's ad the stored lien always carries F (D-063), and `complied` repays only a lien with fee 0. So no stored row can look like that fixture; this was R1's point.

Moving the two tests to `buyerPosted` makes the fixture real. The seller's-ad case is now covered by the new R1 block, with F and `active` or `suspended`, which matches what is really stored.

The new "stands" expectation (`fee-owed` on the buyer) is not new behaviour. f97740c4 already produced it for a buyer's ad, and the older tests at lines 118 and 189 pin the same rule ("a buyer poster now owes the 1%"). A seller's-ad "stands" still gives `[]`, because the lien carries F (line 128; the probe covers it with payment too).

**N3 (Info, citation).** The new test name cites D-062, but D-062 in the register says "*Loser* with no escrow money still owes 1%". Here the buyer is the winner. The charge follows g63 ("a lien … the poster pays") as the lead read it, which is exactly the earlier **O3** owner question, and O3 is still open. The test is not weakened. Its name should cite g63 and O3 rather than D-062, and O3 should stay on the owner list.

## New findings
- **N1 (Info, lead or owner: XMR lien coverage across a flag flip).** A lien is placed only at the transition that orders the payment: the round-1 publish, or the round-2 decision. Two consequences:
  - If liens were off at publish and are on at finality (the window closes, or "Decision stands"), the seller who has not paid `seller-sends-xmr` is never liened for the XMR. The probe found 36 such runs. The 1% is still recorded.
  - Likewise, a buyer who was paid and then overruled while off is never liened, even once liens are switched on.

  This is the earlier note ("disputes ruled while off never gain a lien"), now pinned down to the case where the *final* decision happens while on. No fee is lost and nobody is wrongly liened, so it is not a must-fix. But before the switch is turned on, the operator should know that open restitution cases from the dark period carry no lien. If the owner wants coverage, the option is to place the missing round-1 restitution lien at finality when none is stored and the seller has not paid. That would be a behaviour change, so it is an owner or lead call.
- **N2 (Minor, tests).** The flag flipping between publish and finality is tested only in the pure package (both directions). Through `withDispute`, the API test covers only the case where the flag is off throughout. An API case "on at publish, off at finality, seller's ad: no `fees_owed` row; the lien still carries F" would pin the `round1Carries` path end to end. There is also no pure "stands after payment on a seller's ad" test (it is equivalent to line 128, and the probe covers it).
- **Still open from earlier rounds, unchanged by this commit:**
  - L2 (NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY): a seller's-ad lien stays `active` after the seller pays. The probe saw it in 336 runs.
  - O1, O3 and O4.

## Tests run (`flock ~/x2f-comms/check.lock`, worktree at f3f238c2)
- `packages/staff` `lien.test.ts` + `dispute.test.ts` + `rulingFee.test.ts`: 117/117 passed (3 files)
- `apps/api/test/disputes/lien.test.ts`: 27/27 passed
- `npx tsc -p apps/api --noEmit` and `npx tsc -p packages/staff --noEmit`: clean
- Red check, with the 274ad0c1 `lien.ts` sources and the new tests:
  - staff: 10 failed, 32 passed. The failures are the 4 R1 tests, 5 of the R2 tests, and the `liensOn` boolean check.
  - API: 5 failed, 22 passed (the 4 R1 tests and the R2 test).
  - Sources restored before the worktree was removed.
- Matrix probe (tsx, scratch): 4,656 runs, 0 failures. The mutation run: 2,024 failures.

Not run: the other API suites (take, offers, offersBulk, schema, the rest of disputes), web, Playwright, `npm run check`, anything Monero. The commit touches only the two lien sources and their tests.
