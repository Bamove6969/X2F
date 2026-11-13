# Re-verify: escrow later release (late-funds step 1), wip/lead-late-funds 86b7a86c, 12 Nov 2026

Independent re-verify of the round-1 fixes (RED cb71ec95, fixes 2950e962, note d7f142f2, READY
86b7a86c; before the fixes: c1c248b8), against review-escrow-later-release-2026-11-12.md and the note's
"Review round 1" section. Detached worktree at 86b7a86c with a fresh `npm ci`, removed afterwards
along with its node_modules and .regtest. No edits to the branch. Two scratch probes ran on regtest and
were deleted afterwards (copy at
/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/zz-rv-probe.test.ts.txt).

## Verdict

**NOT READY: one blocking finding (N1) and one major finding (N2).** Both have small fixes.

On money, the reconciliation holds. On any path, the relaxed co-signer, a malicious moderator-builder
and the API together still cannot get an honest party to sign a set that pays anything but `o.to`,
or that double-pays. The relaxed path changes *when* a co-signer exports. It does not change what
it signs.

The reconciliation's evidence rules have two holes, though:

- **N1:** a party with **no release of its own** takes a made-up `after` with no check at all. That
  includes the moderator, the builder of every later release. So the first-ever release can run as a
  "later" one, contrary to the lead's "a forged hash is refused at once".
- **N2:** once a party has accepted a wrong `after`, it can never be corrected. The late coins are
  then stranded for that party.

B1, B2, M1 (for a party that has a release), M4, I1, I2, I3 and I6 are fixed as the note says.

## Checks run (all under `flock ~/x2f-comms/check.lock timeout …`; dockerd not touched)

| Run | Result |
|---|---|
| `npx vitest run --project @x2f/escrow` (regtest, monerod v0.18.5.3, sha256 checked by fetch-monerod.sh) | **17 files, 116 passed, 0 failed** (33 min) |
| `npx vitest run --project @x2f/moderation` | **14 files, 199 passed, 0 failed** |
| `npx vitest run --project regtest` | **1 file, 4 passed** |
| `npx vitest run --project regtest-verify` | **1 file, 10 passed** |
| `npm run typecheck` (all workspaces) | clean |
| Scratch probe (3 tests, regtest), output below | reproduces N1 and N2 |

All four suites finished before the container restart. The restart killed only a wait loop, and the
probe was rerun afterwards.

**Merge onto main 4f0afa14: not clean, but none of the conflicts is in late-funds code.**
`git merge-tree 4f0afa14 86b7a86c` conflicts in 5 files: `apps/api/src/disputes/store.ts`,
`apps/api/src/offers/routes.ts`, `apps/api/test/schema.test.ts`, `apps/api/test/staff/routes.ts` and
`packages/staff/src/intent.ts`. The same 5 conflict when merging the unlanded base stack alone
(ruling-payout 544cf81c, or today's wip/lead-ruling-payout a42dad1b), so they come from the stack
(rulings, liens, mod-gate, ruling-payout). The late-funds files (party.ts, index.ts,
later-release.test.ts, watcher.ts, the note) merge without conflict, and the branch merges cleanly
onto a42dad1b. The watcher.ts hunk depends on ruling-payout, so late-funds can land only after that
stack, or with it.

## The fixes, one by one

- **B1: fixed.** Past the first release, an outcome without `after` is refused, and so is a digest
  already in the history. Regtest "review B1" covers it.
- **B2: fixed.** A `built` builder marks done on `spentBy(tx) && txSeen(tx)`, whatever the balance.
  - Safe: `spentBy` is the builder's own wallet view of an in-block tx spending the escrow's
    outputs.
  - The co-signer could report another 2-of-3 tx that spent only some of the outputs. Signing that
    tx already needs two keys, so marking it done is only bookkeeping.
  - Regtest "review B2" covers it.
- **M1: fixed for a party that has a release.** A first release in progress, exhausted or
  superseded refuses a later outcome (regtest). It is still open for a party with none (N1).
- **M2/M3: reconciled, safe for money, with N1 and N2 below.**
- **M4: fixed.** spend.info is looked up in the history, `waiting-funds` waits for it, and
  `offerSpendInfo` runs before the release step. The order is asserted on regtest.
- **I1: fixed** (`after` is stored and every later release counts). **I2: fixed** (`bad-state`).
  **I3: fixed** (`builderOf`, watcher.ts:459).
- **I6: covered on regtest:**
  - nothing saved or sent on a refusal;
  - a missing history loads as none, and the history survives a restart;
  - `ownTxs` lists both releases.
- **Gap from the lead's summary:** the lead's text says the relaxed co-signer always shows
  `spentBy(after)` and `txSeen(after)`. The code checks them only when the co-signer has an earlier
  release (`history().length > 0`), and checks `txSeen` at settle time only for a party that has a
  release. A party with none checks nothing: that is N1.

## Is the reconciliation safe? (the lead's questions)

### Can a malicious builder or the API use the relaxed path to make a co-signer sign a set that double-pays or pays the wrong party?

**No.** Before every signature, a relaxed co-signer still runs:

- `fundsReady(o)` after importing the builder's export;
- `checkRelease(txSet, o.to)`: exact payouts, no change, the fee cap and the input sum;
- the one-commit-per-episode rule.

`o.to` is the API's to choose under any rule, so "the wrong party" is never more than what the API
could already ask for. There is also no double pay:

- Coins an earlier release spent cannot be spent again on chain. A set that tries is invalid.
- Two sets for the same late coins conflict, so only one can confirm.

What the relaxed path does allow is **a malicious moderator shaping the co-signer's view**. wallet2
does not check a peer's partial key images, so the moderator can:

- make it look as if coins were spent ("deflate"), giving a subset sweep that leaves coins behind;
- make spent coins look unspent ("inflate"), giving a dead set that strands the co-signer: gap (a);
- satisfy `spentBy(after)` for an `after` it chooses, because `spentBy` reads that imported view.

So the `spentBy` proof holds against a buggy API, not against a malicious moderator. The keep-the-full-check
rule ("a co-signer whose latest done tx is `after`") can also be dodged. The API names any in-block
tx as `after`, and `txSeen` passes. An honest moderator then refuses, because it must name its own
latest. A malicious one builds. Even then, the outcome is only the liveness failures above. No theft
follows.

### Does exporting early, before the payout check, leak anything an attacker can use?

**No.** An export holds partial key images and fresh nonce commitments, sealed to the moderator only:

- The partial key images let the moderator link the escrow's outputs to their spends. It learns
  that from spend.info and every release anyway.
- The nonce commitments are public. The risk with nonces is signing twice with the same one (R26).
  An early export changes nothing there: each attempt exports afresh, it is saved before it is sent,
  and at most one set is signed per export.
- M4's ordering makes sure spend.info is not exported over a live release's nonces.

The only cost is a denial of service: the API can make a party burn its attempts. In the probe, 14
attempts went in 30 s, and the cap is 20.

### Can a race between two later releases, or a restart mid-release, break it?

**Not for money.**

- **Races:**
  - A committed release refuses any other outcome.
  - The moderator marks a release done only on an in-block tx, so a second later release cannot
    start on a pool-only tx.
  - An uncommitted later release can be swapped for another with the same `after`. If the API flips
    L1, then L1', then back to L1, L1's tag comes back with its saved messages. That is the same
    within-episode behaviour first releases have today. At worst it gives a dead set (gap (a)), never
    a nonce reused across messages.
- **Restart:** the history move and the new release are saved in one write before anything is sent.
  A resumed later release matches on its digest, and re-calling the first outcome is refused (B1).
  The restart regtest passes.
- **The real gaps are N1 and N2.**

## Blocking

### N1. A party with no release takes any `after`, unchecked; the first-ever release can run as a "later" one

In `outcomeRefusal`, `if (rel === null && history().length === 0) return null;` comes before both the
builder check and the `txSeen` check. So:

- a moderator that took no part in R0, the builder of every later release, accepts any 64-hex
  `after`;
- so does a trader with no release.

**Probe PB:** a funded escrow with no release at all. The API sends the moderator and the seller
`{builder:'mod', cosigner:'seller', after:'d'×64}`. It **settles**: tx 1a83697d…, the seller's
release has `after = dddddddd…`, phase `done`.

The escrow's first payout ran as a "later" release:

- The co-signer used the relaxed pre-export check.
- The moderator's view decided the balance.
- The first-release rules for this trade were dodged.
- `after` names nothing at all.

This contradicts the lead's condition that a forged hash is refused at once, and M1's intent. It
pays `o.to` exactly, so nothing is stolen.

**Fix (small):**

1. At settle time, a party with no release requires `txSeen(after)`, like the others.
2. The moderator-builder with no release also requires `spentBy(after)`, after a sync. It sees the
   spend once it has imported a spend.info, and it cannot build before that anyway (gap (b)).

Every later release is moderator-built, so step 2 closes the path for every co-signer while the
moderator is honest. Add regtests for both.

## Major

### N2. A wrong but in-block `after` is accepted and then locks the party to it

Two rules combine:

- A party whose latest tx is t0 accepts a newer `after` if `txSeen` passes (the M3 relaxation), or
  with no check at all if it has no release (N1).
- An uncommitted later release can be replaced only by one naming **the same** `after`
  (`rel.after !== o.after` gives "after is not the earlier release").

So one API error locks the party to that `after` for good. For example, naming the late coins'
deposit tx, which is in a block.

**Probe PA:** R0 is seller-built and buyer-co-signed (t0). Late coins arrive in deposit tx d.

- The seller accepts `L1(after=d)`, then refuses the correct `L1(after=t0)`: "after is not the
  earlier release".
- The moderator (no release) accepts `L1(after=d)`, then refuses `L1(after=t0)`: "a release is under
  way".
- After 30 s both sides are at attempt 14. The seller refuses each set (spentBy(d) fails), and both
  head for `exhausted`. An exhausted release can again be replaced only with `after = d`.

The late coins are then stranded for these parties until code ships. No money is lost.

**Fix:** let an uncommitted later release (never signed, nothing committed in this attempt) be
replaced by an outcome naming a different `after`, provided the new one passes the same checks as a
fresh outcome, run as if the current release were not there. Doing N1's fix (2) as well means an
honest moderator never accepts a wrong `after` in the first place. Add a regtest: wrong `after`,
then corrected, then settles.

## The two gaps the builder left open

### (a) A signed later release whose tx is `none` has no way out: **minor**

In `signed` with `txStatus === 'none'` and `balance !== 0n`, the party resubmits forever. It stays
committed and refuses every later outcome ("a release is under way"), so that trader can never
co-sign for this escrow again.

- **Honest triggers are rare:** a conflicting spend that left coins behind.
- **A malicious moderator can cause it on purpose,** through the inflate trick on a relaxed
  co-signer. But such a moderator can stall the escrow anyway.
- First releases have the same structure today.
- Liveness only. Fix before the late-funds integration (steps 2 to 6).

**Fix:** mark the release `superseded` (lifting the commitment) only when the signed tx can provably
never confirm: at least one of its own key images is spent on chain by another tx at least 10 blocks
deep (daemon `is_key_image_spent`, or the wallet's view after a sync). Never on `none` alone. A
wrongly freed valid set plus a new set over other inputs could both confirm and double-pay. A set
dead from a bad signature stays stuck, and that is accepted.

### (b) The moderator-builder does not import the co-signer's export before its own balance check: **minor**

This bites only when the moderator imported no spend.info for a release it did not sign, either
because the info exceeded SPEND_INFO_MAX_HEX (60 000 hex, so only a claim went), or because no trader
ever delivered it. Its own view then still counts R0's outputs, `fundsReady` fails before it exports,
and the later release never builds.

It is narrow because M4 now sends spend.info from every trader that took part in R0 before its first
later export, and the co-signer of L1 is online by definition. Liveness only, and the watcher's
fallback escalates.

**Fix:** in the builder's `waiting-funds` for a later release, if the co-signer's export for this
attempt has already arrived, sync and import it before `fundsReady`. That mirrors the co-signer. It
is safe: the builder already imports that export before building today, and an import does not touch
its own nonces.

## Info

- **I-a.** A party that ended `superseded` (first or later release) refuses every later outcome for
  good. That is as designed in the note, but it is one more way a trader drops out of later
  releases.
- **I-b.** For step 2+: a relaxed co-signer's own `funds()` still counts the spent R0 outputs until it
  imports the moderator's export. So the app must not size `o.to` from that view. Take it from the
  moderator's ruling and the watcher.
- **Process note:** during the merge check I wrongly wrote 4f0afa14's versions of
  `apps/moderation/src/watcher.ts` and `packages/escrow/**` into the main checkout's **index**
  (`git --work-tree=… checkout`). No working-tree files were touched. I reset those paths to HEAD
  straight away, and `git status` in /home/user/X2F is clean again.

## Probe output (scratch regtest, deleted)

```
PA seller settle(after=deposit) -> pending
PA seller rel.after == deposit: true history [true]
PA seller settle(after=t0, the right one) -> rejected: bad-outcome: after is not the earlier release
PA mod (no release) settle(after=deposit) -> pending
PA mod rel.after == deposit: true
PA mod settle(after=t0) -> rejected: bad-outcome: a release is under way
PA after 30s: mod phase waiting-funds attempt 14 seller phase export attempt 14
PB first-ever release with after=dddd…: settled [null,"1a83697d71627ffc3a0e33fca4f58a455b06554fc8a8e2b9990d40da2f761830"]
PB seller release.after dddddddd phase done
```
