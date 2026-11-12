# Security review: escrow later release (late-funds step 1), wip/lead-late-funds c1c248b8, 12 Nov 2026

Independent, adversarial review of the commits after 544cf81c (spec 66e2de6d, RED 4710c615,
code f955d4dc, READY c1c248b8): `packages/escrow/src/party.ts` (+102/-12), `index.ts`,
`test/later-release.test.ts` (new), the design note
`docs/superpowers/specs/2026-11-12-escrow-later-release.md`. Detached worktree at c1c248b8,
fresh `npm ci`. No code edits to the branch. Scratch probes (below) were run and then deleted.

## Verdict

**NOT READY: two blocking findings (B1, B2)**. Both have small fixes. No path I found lets an honest
party sign a set paying anything but `o.to` (the `checkTxSet` exact-payout, no-change, fee cap and
input-sum checks are untouched, and they run before every signature). So nothing here lets anyone
steal from an escrow. But:

- **B1**: an outcome *without* `after` still replaces an uncommitted later release. This
  brings back the first release's tag, with its stored episode-0 export and tx set, and lets a
  trader-built release in through the back door. That breaks the note's R26 namespace claim and
  rule 2.
- **B2**: the builder of the earlier release never reaches `done` if late coins land before it
  saw the escrow empty. That builder is usually the moderator, who builds every later release. It
  then refuses every later release for good, and the late coins are stranded. That is the feature's
  own main case.

The refinement (a party with no release of its own takes a later release as its first) adds no
theft path for a compromised moderator plus API, compared with today's first-release rules. It does
make the co-signer's final balance check depend on the moderator's export (M2). It also widens
what an uncommitted party accepts (M1).

## Checks run

- Typecheck `packages/escrow`: clean.
- Scratch regtest probe (3 tests, deleted afterwards, copy at
  /tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/zz-review-probe.test.ts.txt): 3 passed. These reproduce B1, B2 and M1. Output below.
- Whole `@x2f/escrow` project on regtest (monerod v0.18.5.3; fetch-monerod.sh verified the pinned
  sha256): see "Full project run" at the end.
- Existing tests: the diff touches no existing test file. `git diff --stat 544cf81c c1c248b8 --
  packages/escrow/test` lists only the new `later-release.test.ts`. Nothing was weakened.

## Blocking

### B1. A first (no-`after`) outcome replaces an uncommitted later release: the old tag comes back, and so do trader-built "later" releases

`settle()` computes `switching = … && o.after === undefined`, and `beginRelease` allows any switch
away from an uncommitted release. Neither checks that the party is already past a release
(`state.releases` non-empty, or the current release has `after`). Once a later release Lk has started
and is still uncommitted (waiting for funds, mid-export, after a refused attempt, or exhausted), a
`settle()` with **no** `after` is accepted. It replaces Lk without a trace: Lk is not moved to the
history.

**Scenario 1, the episode-0 messages come back (R26 namespace).** R0 is seller-built and the buyer
co-signs, paying 1 XMR. The buyer pays the same 1 XMR again by mistake, the common "duplicate
payment" case. The moderator rules L1 to the buyer, so the buyer starts L1. Before the moderator
joins, the buyer's app restarts and replays the trade's original outcome, `settle(o0)`. The
buyer's party accepts it. `state.release` is R0's digest again, at attempt 1, and
`state.received` still holds the **seller's episode-0 `state.export:<tag0>.1` and
`release.txset:<tag0>.1`**. Because the late balance equals o0's payouts, `fundsReady` passes. The
buyer exports afresh, overwriting its own saved `state.export:<tag0>.1`, which the seller already
holds under that key and will ignore as a duplicate. It then **imports the stale episode-0 export
and runs the stale R0 set through checkRelease/sign**.

The probe (P1) shows: the release tag is tag0 again, history `[[tag0,'done']]`, stale received keys
`state.export:tag0.1` and `release.txset:tag0.1`, and the attempt is refused (`cosign-payout-mismatch`,
attempt 2). What saved it is that wallet2 refused the stale set. The party's own invariant did not.
That is exactly what the note says cannot happen: "a saved export, set or signature of episode n is
never reused". If a wallet ever did sign it, it would be the same message (no key leak), but it is a
double-spend. `submit` fails, `txStatus(R0 hash)` is `block`, and the co-signer marks this release
**`done` with R0's hash** and resolves `settle` with it. The app would then believe the late coins
were paid out.

**Scenario 2, rule 2 bypass.** The same path accepts a no-`after` outcome with `builder: 'seller'`
(or `'buyer'`) over an uncommitted later release. Probe P1b: it is accepted and pending, and the
buyer is now the co-signer of a seller-built second sweep. That is a trader-built later release,
which rule 2 and the lead's decision 1 forbid. It is also a second sweep that sends no spend.info
(`state.sent[SPEND_INFO]` is already set from R0) and that the moderator did not sign. The
watcher has no proof route for it.

**Fix (engineering, no product choice):** in `settle()`/`beginRelease`, refuse (`bad-outcome`) any
outcome without `after` once `state.releases?.length` is non-zero, or once the current release
carries a later outcome. Simplest: store `later: true` (or the `after`) on `ReleaseState`, and refuse
a digest that equals any history entry's. Add unit tests: "after a later release starts,
settle(first outcome) is refused" and "a trader-built no-after outcome is refused".

### B2. The earlier release's builder never reaches `done` when late coins land first, so later releases are refused and the late coins are stranded

The builder only marks its release `done` when `balance === 0n && spentBy(tx) && txSeen(tx)`, and only
after the co-signer's `release.done` reaches it. The note keeps this check "unchanged". But
`laterRefusal` requires the builder's own release to be `done` (`phase !== 'done'` and committed
gives "a release is under way"). Late coins make `balance === 0n` false for good. So any builder
that had not yet seen the escrow empty when the late coins confirmed can **never** start a later
release.

**Scenario (probe P2, reproduced):** a dispute ruling R0 is moderator-built and the seller
co-signs. The moderator's party is down, or simply has not ticked, or the seller's `release.done`
was lost because the relay delivers at most once and the seller closed the app. Meanwhile the
seller signs and submits, and the tx confirms. Late coins arrive. They can even be in the same
block, or be sent while R0 is in the mempool: "a late top-up" is exactly that. The moderator
restarts. R0 stays `built` forever. `mod.settle(L1 after t0)` gives
`bad-outcome: a release is under way`. Every later release is moderator-built (rule 2), so **no
later release of this escrow can ever be built. The late coins are stranded** until new code ships.
The same applies to a trader who built R0 (the seller in the normal flow), which blocks it as the
co-signer that rule 2 says the ruling pays. There, the other trader could co-sign as a workaround.

**Fix sketch (for the lead; touches the builder's done rule, so worth an explicit OK):** let the
builder's `built` release become `done` when the reported tx is in a block and spends the escrow
(`spentBy` and `txSeen`), whatever the balance. `spentBy` already proves that this escrow's
outputs were spent by that exact tx. Alternatively, when `o.after === rel.txHash`-candidate for a
`built` builder, check `spentBy(o.after) && txSeen(o.after)`, mark it done, and then proceed. Add
a regtest for "late coins before the builder saw done".

## Minor

### M1. Rule 1 is not enforced against a first release that is in progress or exhausted (forged `after` accepted)

The note says a party "whose release is still in progress, or ended `exhausted` or `superseded`,
refuses". In `laterRefusal`, an uncommitted non-done release with an empty history gives
`base = null` and accepts. So a party mid-first-release (waiting for funds, or uncommitted after a
refused attempt) or with an **exhausted** first release accepts a later outcome naming **any**
64-hex `after`. Probe P3: seller waiting on a first outcome, then
`settle({builder:'mod', cosigner:'seller', after:'c'*64})` is accepted, and the current tag becomes
the forged one.

There is no extra money risk beyond today's rules: today the caller may already switch an uncommitted
first release to any moderator-built outcome. But it turns the main escrow's first payout into a
"later" release, with the relaxed co-signer pre-export (M2) and without the evidence the note
requires. The note's unit test "with an earlier episode still in progress: refused" was not written:
the suite has no fake-engine unit tests, although the note lists four.

**Fix:** when the history is empty and the current release is not done, refuse a later outcome
unless `rel` is null.

### M2. Under the relaxed pre-export check, the decisive balance check is moderator-influenced (partial sweeps; a stuck co-signer)

For every later release the co-signer exports on `balance > 0 && balance === unlocked`. The exact
match then runs after it imports the builder's export. wallet2 takes a peer's partial key images
unchecked (the existing review I1 note). By then the moderator also holds the co-signer's partials
for this attempt, so a **compromised moderator** can shape the co-signer's view:

- **Deflate.** It chooses its partials so that one late output's composite key image equals a
  key image already on chain. The co-signer then sees fewer coins. With `o.to` set to that smaller
  sum (by the compromised API), `fundsReady`/`checkTxSet` pass. The co-signer signs a valid sweep of
  a **subset** of the escrow. The rest stays in the escrow (no theft: moderator plus another trader
  could take it anyway). This breaks the "exact remaining balance" invariant and burns the cap.
- **Inflate.** It makes R0's spent outputs look unspent. The set it builds is a double-spend. The
  co-signer signs (`committed`, `signed`), `submit` fails, `txStatus` is `none`, and `balance !== 0`,
  so it resubmits forever. The co-signer stays committed to that dead set, and those late coins
  cannot be paid through this co-signer again (liveness).

Today's first release blocks both: the co-signer's full `fundsReady` runs on its own view before it
exports. Compared with today, the refinement adds no theft path for a compromised moderator plus API.
Payouts are still exactly `o.to`, and `o.to` is the API's to choose under either rule. It does add
these two failure modes. **Mitigation options (owner/lead call):** keep the full pre-export check for
a co-signer that has a done release of its own (it knows the true balance), and relax it only for a
party with no release. Also give a `signed` later release a way out when its tx is `none` and the
escrow's other coins are untouched.

### M3. A later release's `after` must equal *this co-signer's own* last tx: alternating co-signers deadlock

Example: R0 is seller-built and buyer-co-signed. L1 is to the seller (mod plus seller, tx t1).
Then more coins arrive and are ruled to the buyer, so L2 is mod plus buyer with `after = t1`. The
buyer's own done release is R0 (t0), so it refuses ("after is not this party's done release"). The
moderator refuses any `after = t0`. Only the seller can ever co-sign again. Either the payee is not
the co-signer, contrary to the note's "the co-signer is the trader the ruling pays", or the coins
are stuck. Fix: accept `after` equal to the party's own last done tx **or** any later tx that
`spentBy` shows emptied the escrow, or record the chain in history. Owner/lead call if it changes
who can co-sign.

### M4. The moderator who took no part in R0 depends on spend.info to ever build

When R0 is seller plus buyer, the moderator's builder pre-export check is the full `fundsReady` on
its own view, before any import. If the moderator never imported a spend.info, its balance still
counts R0's outputs and it never exports. That happens when the info was too large (only a
`spend.claim` was sent), or when the trader never came back online. A trader with an R0 that was
done can also start L1 before `offerSpendInfo` ran on that tick (an export failure retried next
tick). Then R0 is moved to history and spend.info for R0 is never sent (`offerSpendInfo` reads only
`state.release`). Liveness only. Suggest: `offerSpendInfo` looks at the last history entry too, and
the moderator-builder in a later release imports the co-signer's export before its balance check, as
the co-signer side does.

## Info

- **I1. Cap off by one for a party with no release.** The cap is only checked when the party has a
  done release of its own. A moderator that skipped R0 counts its first later release as its first,
  so it allows 11 later releases. The escrow-wide limit of 10 still holds in practice, because the
  co-signer chain (M3) always includes R0's participant. The uncommitted replacement branch never
  adds to the count. The cap test covers only the seller's view.
- **I2. `releases` is not validated on load**, unlike `shown`. A non-array value makes `history.at`
  throw, and the party dies with an Error rather than `bad-state`. The store is sealed and trusted,
  so this is a consistency point only.
- **I3. Integration note (step 2+):** `funds().ownTxs` now lists R0's tx, while `committedBuilder()`
  names only the current release. If the watcher ever evaluates R0's tx as `spend` while L1 is
  committed, `apps/moderation/src/watcher.ts:456-459` names R0 with L1's builder (`mod`, a ruling
  payout). It should pair a tx with its own episode's builder.
- **I4. The first release's tag is unchanged**: the pinned-digest test passes, and `after` is
  omitted when undefined. `after: null` or uppercase hex is refused. Replay across episodes: a
  later release's keys carry a different tag, and `onMessage` drops any key not on the current tag.
  So episode-n messages never feed n±1, except through B1.
- **I5. Restart mid-release:** history move and new release are saved in one `saveState` before
  anything is sent. Exports are resent, not replaced, after a restart (covered by the regtest). This
  is safe as long as the app re-calls `settle` with the same later outcome. Re-calling with the
  first outcome is B1.
- **I6.** Of the note's "Tests" list, the four unit-level items (refusals with nothing saved or sent,
  `releases` surviving a restart and absent-means-none, `ownTxs` of both episodes) exist only
  partly, as regtest asserts. There is no test of a later outcome against an in-progress or exhausted
  first release (M1), or of re-settling the first outcome (B1).

## Probe output (scratch regtest, deleted)

```
P1 settle(o0) again -> pending; release tag e3227257f4b053ee == tag0; phase export attempt 2;
   history [[tag0,"done"]]; stale received tag0 keys [state.export:tag0.1, release.txset:tag0.1];
   ignored [cosign-payout-mismatch]
P1b trader-built no-after outcome over an uncommitted later release -> pending (accepted), part cosigner
P2 mod first-release phase after restart: built
P2 mod settle(L1) -> rejected: bad-outcome: a release is under way
P3 forged later over in-progress first -> pending (accepted); current tag == forged tag
```

## Full project run

`npx vitest run --project @x2f/escrow` at c1c248b8 (probe removed first), under
`flock ~/x2f-comms/check.lock timeout 3000`: **17 files, 110 tests passed, 0 failed** (1570 s), the
5 tests in later-release.test.ts included. dockerd was not touched. The worktree, its node_modules
and the .regtest copy were removed afterwards.
