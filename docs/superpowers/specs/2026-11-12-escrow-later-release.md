# A later release from a paid-out escrow (late-funds step 1), design note, 2026-11-12

Status: **for lead review before any code.** Scope: `packages/escrow` only (`party.ts`, its types,
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
   `Outcome.after` (64 lower-case hex). The party must have its own evidence that this tx paid the
   escrow out:
   - its own last episode is `done` with `txHash === after`; or,
   - for a party that took no part in that release (most often the moderator after a
     seller–buyer release), `after` is an in-block tx its wallet showed spending the escrow
     (`PartyState.shown`, or `outgoing` from the same sync). That is the same evidence the moderation
     watcher already relies on.

   A party with an episode in progress (not `done`, `exhausted` or `superseded`) refuses.
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

## Questions for review

- **Rule 2 (later releases moderator-built only).** Is that right, or should a later release
  between the traders, by agreement, be possible too? I propose not now.
- **The co-signer's relaxed pre-export check.** Accept it, or require the co-signer to have imported
  the earlier release's spend info first?
- **How many episodes?** I propose no fixed limit: each one needs a moderator's ruling and its own
  late coins. The attempt limit still applies per episode.
