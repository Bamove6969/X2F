# Security review: wip/lead-fix-ruling-pay at b9988ded (ruling payout co-sign)

Reviewer: independent security reviewer (cloud helper), 22 Nov 2026. Worktree `.claude/worktrees/rev-ruling-pay` at b9988ded; branch not changed.

## Verdict: CHANGES NEEDED

The co-sign gate holds. I found no way for the moderator alone, the API alone or a counterparty to make the winner's device co-sign any set other than the device-computed `dispute-buyer` or `dispute-seller` payouts. There are two must-fix findings, both in the runtime around that gate:

- **M1 (loser rule, Major): a winner's alarm is silenced.** If two signers (mod and loser) pay the escrow out against the ruling, the winner's app shows "done" when it should show escrow-failed (integrity). This is reproduced, and it is a regression from the parent.
- **M2 (Q5, Major, liveness): coins can get stuck.** The ruling intent overwrites a committed non-mod intent. After a second reload, the outcome the party is committed to is never handed again, and the ruling set is refused with "already signed". This is reproduced.

Everything else is minor or a test gap.

## Scope

`git diff 2a8866c7 b9988ded` is 102 files, but most of it is the merge of origin/main a8cfc6ac at 7be4b098 (bans, sanctions, payee fields), which main already has. The branch's own change is `git diff 7be4b098 b9988ded`, 16 files:

- the three test-only commits of the harness rows (d2eebbe7, cea617ad, b9988ded);
- the fix ff744c76 with its two red commits.

I read the whole fix diff. I read the harness (tools/regtest/e2e/staffStack.ts, softKey.ts, staffClient.ts, stack.ts hunk, apps/staff-web/e2e/*) at a lighter level.

## Findings

### M1 (Major, must fix): the new loser rule also silences the winner's integrity alarm

- **Where:** apps/web/src/escrow/runtime.ts:1469 (`rulingByOthers`), used at :1470-1476.
- **The rule:** `rulingByOthers = v.settling === null && ((seller && released) || (buyer && refunded))`.
- **What it doesn't check:**
  - that this device verified a statement naming the OTHER side the winner;
  - that this device has no ruling intent of its own open. The ruling intent is `auto`, so `tappedOpen` is false.
- **The attack:** the buyer wins and saves its ruling intent. The mod and the seller (2-of-3) then refund the escrow to the seller instead. The API, honest or not, reports `refunded` with settling null.
- **What happens:** the buyer's device sets `settledWithoutDevice`. The trade screens (BuyerPay, Released, TradeGlance) treat that the same as `done`, so there is no escrow-failed (integrity) alarm.
- **Before the branch:** the same chain state hit the `ownOpen || coins` arm and raised escrow-failed after settledElsewhereMs.
- **Also affected:** a winner that never saw the statement (offline through the whole ruling) but has `coins` (paidSeen).
- **Repro (probe, not committed):** add this to the "Plan 4 rulings" describe in apps/web/test/attestation-flow.test.ts and it FAILS at b9988ded (`expected 'settled-without-device' not to be 'settled-without-device'`):
  1. `disputed()`
  2. serve the buyer-win statement
  3. wait for the mod-built hand-over
  4. view `{state:'refunded', paidAt, settling:null}`
  5. funds empty in a block
  6. expect phase != settled-without-device
- **Compared with the existing byOthers rules:** they trust the API's close kind only where this device has nothing at stake that the close could hide. The buyer arm, for example, needs `acceptedAtomic === null`: it never paid.
- **Compared with N-M1 in packages/escrow party.ts:** a co-signer there ignores the builder's DONE and counts only a tx it signed itself (`landedNow`, party.ts:851-870).
- **The new rule goes further than both:** it takes the API's word for a device that paid fiat, and even for the winner.
- **Can it require `landed()` instead?** No. `landed()` cannot serve the loser, because it needs a release record of this party for the outcome (party.ts:854), and the loser has none. `proveSweep` would need the builder's (mod's) tx key, which is the Task 10 signal the existing TODO(lead, pending) waits for.
- **Fix (pure engineering, smallest):**
  - (a) `rulingByOthers` only when `r.intent?.kind !== 'ruling'` and no own intent is open (`!ownOpen`);
  - (b) only when this device verified a statement for this trade and this escrow with the other side the winner. That needs `rulingLost` persisted on the record (today it is in memory only, runtime.ts:198), set where `check.reason === 'not-winner'` (:1515);
  - (c) keep the TODO(lead) for a chain proof (OutProof from the mod's signed txHash and tx key) and add this rule to it.
- **Owner question:** whether a loser that never verified a statement (offline for the whole dispute) should then see escrow-failed (a false alarm) or an "unknown" state. I recommend escrow-failed until a proof exists (fail closed).
- **Add tests:**
  - the probe above;
  - the loser without a verified statement;
  - a loser case with its own open intent.

### M2 (Major, liveness / stuck coins): a ruling intent overwrites a committed non-mod outcome (builder's Q4)

- **Where:** runtime.ts:1527-1549 (`rulingTick`). It writes `r.intent = {kind:'ruling', ...}` at :1543 without asking the party whether it is already committed (`committedBuilder()`).
- **Party behaviour:**
  - party.ts:1399-1402 refuses the switch with "already signed for another outcome";
  - `advanceRelease` (party.ts:874-877) moves a committed release on only while `settleOutcome` holds it, and `settleOutcome` is in memory per run.
- **The sequence:**
  1. The buyer's party is committed to the seller-built release: it imported the set, `phase: cosigning/signed`, but the tx did not land yet.
  2. The trade is disputed and the buyer wins.
  3. The first run after that reload hands the old release on a pre-ready tick: `loadRuling` needs `this.address`, so the release goes first. The ruling intent then overwrites the stored release intent.
  4. From the next reload on, `rulingTick` owns every disputed tick (:1333, returns true with `saved` and no verified statement before `ready`). It hands only the mod set, which the party refuses (`refused.add`). The committed release is never handed again, so the party never signs or submits it.
  5. The moderation process waits at `ruling-signing` for good.
- **Who can still move the coins:** only mod plus seller (the loser), which is a stuck-coins case.
- **Repro (probe, not committed):** at b9988ded, after the second reload the buyer hands `['mod']` only (the first reload hands `['seller','mod']`). Steps:
  1. `disputed()`
  2. `committedBuilders.buyer='seller'`
  3. reload, reject the mod set with "already signed", reload again
  4. expect a seller-built hand-over
- **Same root cause, smaller impact:** a seller whose own auto-refund (seller builds, mod co-signs) was committed when the after-refund dispute came gets its intent replaced by a `ruling` intent. When the mod lands the refund, afterClose asks `landed()` only for the ruling outcome (:1436), which fails. The result is a false escrow-failed alarm. Coins are safe, because the mod co-signs and submits.
- **Fix:**
  - In `rulingTick`, before saving the ruling: if `this.party?.committedBuilder?.()` is not null and not `'mod'`, return false. A party without the method counts as committed, fail closed, as in the existing gap-2 code. The existing path then keeps handing the committed intent.
  - If a `ruling` intent is already saved and the party reports a non-mod commitment, restore the earlier intent. That means keeping it on the ruling intent, for example `prior: StoredIntent`.
  - On "already signed" for a mod-built outcome, do the same (today `rebindRefused` returns early for `builder !== 'seller'`, :1146).
  - In afterClose, add the prior to the `landed()` candidates.
- **Add the probe as a test.**

### m1 (Minor): TODO(m4) is safe, but the seller half of its test is vacuous

- **`paidRefused`:** set only on the seller (`absorbPaid`/`fixPending`, :785, :1033-1060). The seller's ruling context is `refundOnly` (`r.role === 'seller'` at :1534), which never calls `rulingAmount`/`acceptedAmount`. So the flag never mattered for a seller ruling, and the "seller paidRefused" half of "TODO(m4) decided" passes for any `rulingAmount`.
- **`releaseRebindRefused`** (buyer only, gap 2): ignoring it for the ruling amount is safe for the money.
  - Its job is to stop this device building a second seller-built release at a new amount while the party is committed to the prior one.
  - The party enforces that itself: it refuses the mod set with "already signed".
  - `resumePrior` (:1328) still runs before `rulingTick`, so the prior keeps going, and afterClose's candidates include the prior.
  - Whichever lands is an outcome this buyer approved.
- **Growth-binding gap 2 and rebind:** not weakened, because the flags still gate every counterparty-built release through `acceptedAmount`.
- **Recommendation:** keep the lead default and make the seller half of the test meaningful (or drop it and say why in the comment).

### m2 (Minor): `rulingAllowsCosign` (rules.ts:409) now has no caller: delete it

It reads the API's unsigned dispute view, and its test pins that it allows a round-2 ruling (apps/web/test/dispute.test.tsx:271), which the signed statement refuses. Keeping a second, weaker "gate" invites a future caller to wire it instead of the statement. Delete it with its describe block in dispute.test.tsx, fix the comment at policy.ts:25-27, and make the tripwire assert it is gone.

### m3 (Minor): "Waiting for <winner> to open X2F" can be wrong

rules.ts:247 shows the line for every published round-1 escrow ruling while the trade is `disputed`. But the payout can also wait on:

- the moderation process: funds not unlocked, the desk-armed auto-refund first (execute.ts "ruling-waits-desk-armed");
- `rulingAmount` returning null for a buyer whose device knows of paid without a fixed amount: a stuck ruling that will never complete however often the winner opens X2F.

This is copy accuracy only, not money (COPY-UNSIGNED). Owner/lead question: accept the smallest version as is? I recommend yes, with a follow-up once the API reports the payout state.

### m4 (Minor): a statement request on every disputed tick

`loadRuling` (:1503) GETs `/ruling-statement` on every tick of a disputed trade until one verifies. That includes the whole open-dispute period before any ruling, and a statement that keeps failing. This is load, not safety; consider backing off.

### m5 (Minor): test gaps found by guard-revert

See the table. Precedence is untested in the case where the API withdraws the statement after the ruling intent is saved (G11), and the same goes for the save-before-hand-over order (G16) and the DisputeScreen amount check on `payTo` (G18). Three layers are only defence in depth, so a single revert passes: G1, G4 and G8 (cosignPolicy re-checks winner, escrow and state). G12 and G13 are effectively dead code (an auto intent is never "tapped"; outcomeFor('ruling') throws to null). Add the G11, G16 and G18 tests.

## The attack questions

1. **Malicious co-sign: none found.**
   - **What binds a statement:** it is domain-separated (`x2f/ruling-statement/v1\0`, distinct from attestation, chat and other domains under the same mod key), exact-keyed, and bound to the trade code, the escrow address from this device's own `party.ready()`, round 1 and this side as the winner.
   - **Replay from another trade:** refused (wrong-trade or wrong-escrow).
   - **Round 2:** refused.
   - **Key:** the pinned key comes from build config `VITE_MOD_SIGNING_PUBLIC` (worker.ts:128), never from the API.
   - **The payout set:** it must equal the device's own `expected(dispute-*)`, built from:
     - signed-terms addresses;
     - the config fee wallet;
     - the fee from `escrowPlan(deal.amountAtomic)`;
     - its own `funds()` balance while balance == unlocked.
   - **Amount source (buyer):** `rulingAmount` is the fixed amount (the view must equal it), or the API amount within [take, device size]. A lie there must also match the mod-signed list, so the API alone cannot move it.
   - **Moderation side:** one execution record per trade (execute.ts), so one statement per trade unless the moderation store is lost.
2. **Ruling intent blocking or diverting:** by itself it never diverts. It needs a verified statement naming this side, and the outcome pays this side.
   - **A malicious API flipping a trade to disputed:** no statement verifies, `rulingTick` returns false and the old path runs, so a pending release is not dropped. The not-winner side keeps its standing release co-sign.
   - **Blocking:** it does block in M2, where a committed non-mod outcome is overwritten.
3. **TODO(m4):** safe; see m1.
4. **Loser rule:** not safe as written; see M1. `landed()` is not available to the loser. Fix by restricting the rule and keep the chain-proof TODO.
5. **Party commitment:** yes, a stuck-coins case; see M2 and its fix.
6. **`rulingAllowsCosign`:** delete; see m2.
7. **The harness is test-only:**
   - **Keys and secrets random per run:** softKey.ts uses fresh P-256 keys and a random CA, credential ids and leaf serials. stack.ts/staffStack.ts use a random mod signing pair, internal secret, reader password and keystore key, all under the run's work dir.
   - **Staff build:** goes to the work dir, not the repo dist.
   - **Separation from the normal suite:** `*.e2e.spec.ts` is ignored by the normal staff playwright config.
   - **Production imports:** no production source imports tools/regtest or e2e.
   - **Allowlists:** the fixed test AAGUID is only on the stack's own written MDS folder (`X2F_ATTESTATION_DIR`/`MOD_FIDO_MDS_DIR`, both existing production knobs that predate the branch).
   - **The one fixed seed:** apps/staff-web/e2e/modKey.ts, already on main, used only by the stubbed (non-regtest) moderator.spec.ts.
   - **Direct SQL:** the after-refund row's `update disputes set appeal_ends_at` writes straight to the test database to skip the 48 h. The close still runs through the real `window-closed` timer; acceptable.

## Guard-revert table

Each change was applied alone, then the set below was run, then the change was restored. The set is policy, attestation-flow, dispute-tripwires, dispute, disputeScreenProof and packages/trade rulingStatement; the baseline is 293/293 passing.

| # | Guard reverted | Result |
|---|---|---|
| G1 | loadRuling: no winner in `want` | 293 pass (cosignPolicy re-checks; defence in depth) |
| G2 | policy ruled(): no winner check | 2 fail |
| G3 | policy ruled(): no payout-set match | 7 fail |
| G4 | escrow address taken from the statement in loadRuling | 293 pass (ruled() re-checks with this.address) |
| G5 | rulingStatementValid: no round-1 check | 6 fail |
| G6 | rulingStatementValid: no trade check | 6 fail |
| G7 | policy: buyer ruling outside disputed | 1 fail |
| G8 | context(): statement carried outside disputed | 293 pass (policy state check) |
| G9 | rulingOutcomeFor skips cosignPolicy | 6 fail |
| G10 | rulingTick: no balance == unlocked | 293 pass (gap; the party also waits) |
| G11 | saved ruling without a verified set no longer owns the tick | 293 pass (**gap**) |
| G12 | bottom hand-over not skipped for ruling | 293 pass (redundant: outcomeFor throws to null) |
| G13 | tapHolds counts the ruling intent | 293 pass (dead: ruling is auto) |
| G14 | TODO(m4) reverted (acceptedAmount for rulings) | 2 fail (buyer half only, see m1) |
| G15 | loser rule removed | 2 fail |
| G16 | intent persisted after the hand-over | 293 pass (**gap**) |
| G17 | waitingForWinner shown to the winner | 1 fail |
| G18 | DisputeScreen payTo without the amount check | 293 pass (**gap**) |
| G19 | ruling intent exposed as intentKind | 293 pass (cosmetic) |
| G20 | rulingByOthers without the settling-null check | 1 fail |

## Tests run

- **Targeted vitest** (nice -n 10, no lock), apps/web policy, attestation-flow, dispute-tripwires, dispute, disputeScreenProof: **288/288 passed**. With packages/trade rulingStatement: **293/293 passed**.
- **Probes** (scratch, not committed): M1 probe FAILS at head (confirms the finding); M2 probe FAILS at head after the second reload (confirms the finding).
- **Staff dispute regtest** (apps/staff-web/e2e/playwright.regtest.config.ts, under ~/x2f-comms/check.lock): **13/13 passed** (29.1 min, both sizes: buyer wins, above the limit, appeal overturns, winner offline, dispute after refund, emergency stop, plus login hours). The happy paths do not exercise M1 or M2.
- **Full `npm run check`:** not run, since the verdict is CHANGES NEEDED; it is needed on the fixed head before APPROVED.
