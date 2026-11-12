# A later release from a paid-out escrow (late-funds step 1), design note, 2026-11-12

Status: **approved by the lead 2026-11-12** (decisions at the end); building on `wip/lead-late-funds`. Scope: `packages/escrow` only (`party.ts`, its types,
regtests). Integration (relay expiry and re-registration, the moderator's party restart, the trader
apps rejoining, the executor once per ruling, the trade machine and API) is steps 2 to 6, after this
note and its code are reviewed.

## Why

Coins can reach an escrow after it was paid out (a sender's mistake, a late top-up, dust). The
owner's ruling of 30 Oct 2026 (lead, 12 Nov): they are surplus and stay in the escrow until a
dispute; the late-funds escalation opens the system dispute and a moderator rules (the seller is
the default destination for the remainder; never an automatic refund). Paying that ruling means a
second 2-of-3 release from the same multisig wallet.

Today `runParty` settles one outcome per trade. `state.release` holds it; once a tx set was built or
accepted for it (`committed`), any other outcome is refused (`bad-outcome`, "already signed for
another outcome"), also after the release is `done`. The builder's done check also requires
`balance === 0n`, which late coins make false for good (the "liveness only" NOTE in
`advanceRelease`).

## The rule

A party may start a **later release** (release n ≥ 1, called an episode below) only when all of
these hold. Anything else keeps today's behaviour: `settle()` rejects with
`PartyError('bad-outcome')` and nothing is saved or sent.

1. **After a recorded done release.** The outcome names the tx that last emptied the escrow:
   `Outcome.after` (64 lower-case hex).
   - A party that has a release of its own may start a later one only when that release is `done`
     with `txHash === after`. One that is still in progress, or ended `exhausted` or `superseded`, refuses.
   - A party with no release of its own (it took no part in the earlier one: the moderator after a
     seller–buyer release, or the seller after a buyer's cancel the moderator co-signed) treats it as
     its first release.

   *Refined while building (2026-11-12):* the first draft also asked a party with no release for
   evidence of `after`, such as a sweep its wallet showed. A trader who took no part in the earlier
   release cannot see that spend, so it could never co-sign. Accepting it adds no risk: a
   moderator-built release a trader co-signs is already allowed today as a first release, and
   safety rests on rule 3 and `checkRelease`.
2. **Moderator-built.** `builder === 'mod'`: a later release is a ruling's payout, never a trader's
   own set. The co-signer is the trader the ruling pays. This keeps spend.info as it is (it is sent
   only after a release the moderator did not sign, and the moderator signs every later one) and
   keeps one route for these coins.
3. **For the remaining balance only.** Unchanged from today: settlement waits until
   `balance > 0n`, `balance === unlocked`, and `sumPayouts(o.to) === balance`, and the co-signer's
   `checkRelease` checks the set against the outcome (exact payouts, `MAX_NETWORK_FEE`). A later
   release can never touch the coins of an earlier one, because those are already spent on chain.
4. **With a fresh multisig export.** Every attempt of every episode exports afresh, as today. The new
   episode's message keys never collide with an earlier episode's (next section), so a saved export,
   set or signature of episode n is never reused in n+1 (R26 holds across episodes).

## Message namespace

Release keys carry the outcome's tag (the first 16 hex of `outcomeDigest`). For a later release the
digest also covers `after`:

`outcomeDigest(o) = H('outcome', { builder, cosigner, to, ...(o.after ? { after } : {}) })`

So:

- The first release's digest is unchanged. States saved by today's code and peers that run
  today's code agree on it.
- An episode with the same payouts as an earlier one (same addresses, same amounts) still gets a new
  tag: its `after` differs.
- Peers never need a shared episode counter. The moderator, who may have no record of the first
  release, and the seller, who has one, compute the same tag from the same `after`.

`after` is not trusted for anything but the namespace and the evidence check in rule 1. It is not a
payout, and the co-signer still checks the set's payouts itself.

## State

`PartyState` gains `releases?: ReleaseState[]`, the earlier episodes in order, each with its final
phase and `txHash`. It is absent in states saved before this change, and absent means none.
Starting a later episode moves the current `state.release`, which must be `done` (rule 1), or is
null for a party that took no part, into `releases`. A fresh `state.release` for the new outcome
follows, and the state is saved before anything is sent.

What else changes:

- **`funds().ownTxs`** (moderator): the tx hashes of every episode (earlier and current) in
  `signed`, `done` or `superseded`. Today it lists only the current one, so the watcher would lose
  sight of the first sweep.
- **`committedBuilder()`:** the current episode's builder, as today. The moderation watcher names
  the latest sweep from it.
- **spend.info:** unchanged, at most one per trade, about a release the moderator did not sign.
  Rule 2 makes every later episode moderator-signed, so no second spend.info is needed.
- **The builder's done check** (`balance === 0n`, `spentBy`, `txSeen`): unchanged for the episode
  being settled. Its `balance === 0n` refers to the late coins this episode spends.

## The co-signer who took no part in the earlier release

Example: the first release was a buyer-built cancel the moderator co-signed, and the late coins go
to the seller. The seller's wallet never saw that spend's key images, so its `balance` may still
count the spent outputs. Then `sumPayouts === balance` fails before any export, and the episode
waits. That is a liveness problem, not a safety one.

Proposed handling, to be decided at review:

- For a later episode, the co-signer's pre-export check is `balance > 0n && balance === unlocked`.
- The exact match `sumPayouts === balance` is checked after importing the builder's export (which
  carries the moderator's partial key images), inside `checkRelease`.

The builder (the moderator) keeps the full check before building. This only relaxes when the
co-signer exports, never what it signs. A regtest covers the case.

## Not changed

Setup, readiness, the first release, attempts and their limit (per episode), equivocation and replay
rules, R26 saving before sending, and `checkRelease` / `signRelease`.

## Tests (red first, `packages/escrow`)

Unit level (a fake engine):

- `settle` of a second outcome:
  - without `after`: refused;
  - with an `after` the party has no evidence for: refused;
  - with an earlier episode still in progress: refused;
  - with a builder other than the moderator: refused.
  
  In each case nothing is saved or sent.
- The tag:
  - the first release's tag is unchanged against a pinned digest;
  - a later release's tag differs, even with identical payouts.
- `releases` survives a restart; a state without it loads as none.
- `ownTxs` lists the transactions of both episodes.

Regtest (a real chain, three parties, an in-process relay):

1. **Late refund.** A seller-built release that the buyer co-signs is done. Late coins are sent to the escrow
   and unlock. The moderator builds a later release of the whole remainder to the seller; the seller
   co-signs. The seller receives the remainder minus the network fee, the first payout is
   untouched, and the moderator's `ownTxs` lists both transactions.
2. **Restart.** The moderator and the seller are killed in the middle of episode 1. Both resume from
   their stores. No message or export from episode 0 is reused, and the episode settles exactly once.
3. **Wrong amount.** A later outcome whose payouts do not sum to the remaining balance never builds.
4. **Not in the earlier release.** The first release is a buyer-built cancel that the moderator
   co-signs. The later release to the seller (moderator-built, the seller co-signing) settles, under
   the handling above.
5. **A third episode.** More coins arrive after episode 1. Episode 2, named by episode 1's
   transaction, pays them.

## Decisions (lead, 2026-11-12)

- **Later releases are moderator-built only.** No trader-agreed later releases for now.
- **The relaxed pre-export check for the co-signer is accepted.** The exact payout match and
  `checkRelease` still run on the imported set before the co-signer signs. Added regtest: a wrong
  amount is refused at that point, and nothing is signed.
- **No product limit, but a hard safety cap of 10 later releases per escrow** (`MAX_LATER_RELEASES`).
  An 11th is refused (`bad-outcome`), so a bug cannot loop.

## Review round 1 (review-escrow-later-release-2026-11-12, NOT READY → fixes, lead calls)

- **B1, fixed:** past the first release (a history, or a current later release), every outcome
  must carry `after`. A first outcome is refused (`bad-outcome`), and so is any outcome whose
  digest is already in the history. The first release's tag and its stored messages never come back;
  a trader-built release cannot slip in either.
- **B2, fixed (lead OK):** a `built` builder marks its release done when its wallet shows the escrow
  outputs spent by the reported tx in a block (`spentBy`) and the daemon has it (`txSeen`), whatever
  the balance (after a wallet sync: `spentBy` reads the wallet's own view). Late coins before the
  builder saw the escrow empty no longer strand the escrow.
- **M1, fixed:** a later outcome is accepted only when the party's current release is done, or it
  has none. A first release in progress, exhausted or superseded refuses. An uncommitted later
  release may still be replaced by another naming the same `after`.
- **M2 and M3, reconciled (please confirm):** `after` is the latest tx that emptied the escrow.
  - **Who keeps the full pre-export check:** every builder, and a co-signer whose own latest done
    release is `after` (it knows the true balance).
  - **Who gets the relaxed check:** a co-signer that took no part in the release `after` names
    (none of its own, or an older one: alternating co-signers, M3). Its wallet cannot see that spend.
  - **What such a co-signer still must do before signing:** after importing the builder's export,
    the exact payout match, and, when it has releases of its own, `spentBy(after)` with
    `txSeen(after)`. Otherwise the attempt is refused (nothing signed).
  - **At settle time, a co-signer naming a tx not its own** (newer than its latest) is accepted
    only if the daemon has that tx in a block (`txSeen`). A made-up hash is refused there and then,
    with nothing saved or sent; the spend of this escrow is proven after the import, as above.
  - **The builder** must name its own latest done tx, or have none.
  - **Why this reconciliation:** taken alone, M2 (a full check for anyone with a release) would
    deadlock M3's buyer, whose wallet still counts L1's coins.
- **M4, fixed:** the spend.info a trader owes for a release the moderator did not sign is found in
  the history too. It is exported and sent before a later release's first export (`waiting-funds`
  waits for it), so it is never dropped and never clobbers the later release's nonces.
- **I1, fixed:** `ReleaseState.after` marks a later release; the cap counts those (history and
  current) for every party alike: at most 10 per escrow.
- **I2, fixed:** `releases` is validated on load (`bad-state` otherwise).
- **I3, fixed:** `PartyHandle.builderOf(txHash)` names the builder of the release that tx belongs
  to; the moderation watcher uses it for its own txs.
- **I6:** the promised checks run on regtest (the package has no fake engine), in `later-release.test.ts`:
  nothing saved or sent on a refusal, the history absent in an older state and kept across a restart,
  `ownTxs` of both releases.
- **Not changed (not in the lead's calls):** the review's M2 suggestion of a way out for a signed
  later release whose tx is `none`, and the moderator-builder importing the co-signer's export
  before its own balance check (M4, second part). Both stay liveness gaps.
