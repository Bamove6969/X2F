# Review: Plan 3 Task 9 I/O (wip/second-p3-task9-io @dd55fcd, author claude2), 2026-10-29

Reviewer: helper, read only. Scope: the whole diff 0e92cb6...dd55fcd (36 files: escrow party spend.info/spend.claim/claims, monero.ts heights/outgoing, trade machine release-claimed and escalate-from-settling, watch.ts fallback and claim, moderation party/watcher/link/keystore/main plus 002_watch.sql, API internal watch and reports, timers.ts, main.ts, 113_release_claim.sql, docs). Trial merge of 0e92cb6 into dd55fcd was clean (it only brings Task 29 web files plus coordination.md).

## Verdict: CHANGES REQUIRED

There are 2 Important findings and 7 Minor ones. Most of the wiring is careful. The mod party's terms come only from `signed_terms`, never from an API read, and this is tested. Watch state is persisted only after acceptance, and a restart neither forgets nor repeats a report. The backfill covers a crash between posting the attestation and inserting the watch row. Reports must carry exactly the expected keys and are applied only for attested trades. A claim opened from a stranger's frame never counts (regtest). Spend info is never exported before this party's own release is `done`, and it is persisted before it is sent. The mod refuses to import while its own release is under way. A replayed frame hits the replay guard and the participants and channel binding of `open()`.

The two Important findings are both about the "shown, not seen" guarantee. The first (I1) is that the stated proof that a single party cannot fake a sweep looks wrong. The second (I2) is that the API alone can still make the mod close a funded trade's relay channels.

## Important

**I1. One trade party can probably forge a "shown" sweep: the "import is the proof" argument misses that the other signers' partial key images are exchanged in every release round.**
Where: `docs/coordination.md:238` ("would need the full key image of an escrow output, which needs a second signer's key share"), `apps/moderation/src/watcher.ts:166-172` (`spendEvidence` trusts any `Outgoing`), `packages/escrow/src/party.ts:717-726` (each new digest from the same sender is imported again).

The mod's composite key image for an escrow output is its own partial (a+b)·Hp(P) plus every partial in the peer's info that is not already in its set. That is wallet2's `generate_multisig_composite_key_image`. As far as I know it sums the peer's partials without checking them (no proof of correctness, only the info's signer signature). wallet2 then attributes a tx in a block to the escrow purely by key-image match.

Think about the seller, as builder of a seller–buyer release. During the release's `state.export:*` round the seller imports the buyer's export, which carries b·Hp(P) and c·Hp(P). The seller holds a·Hp(P) itself. So the seller knows (a+b)·Hp(P), the mod's part, without any second key share. Step by step:

1. The buyer marks paid and the seller starts the release (`settling`). The two parties exchange exports.
2. The seller never sends the tx set. Instead its patched client sends `spend.info` with a single partial Y = K* − (a+b)·Hp(P), where K* is the key image of the seller's OWN unrelated output, spent in any tx T in a block (a custom wallet can even put the escrow output in T's ring as a decoy).
3. The mod imports Y. Its wallet now computes K* for the escrow output and records T as an outgoing spend of the whole escrow. `spentAtomic` is the escrow amount, because it comes from the wallet's own spent transfers.
4. `spendEvidence` → `settled { txHash: T }`. The API sets `released` (`settleKindFor` = release). `sweptBy`'s exact-prefix match succeeds, so there is no late-funds escalation. The watcher sends the signed relay close for both channels.
5. Result: the buyer has paid fiat, the trade reads `released`, and `open-dispute` from `released` is `wrong-state`, so the buyer has no recourse in the app. The coins stay in the multisig, and the mod's wallet believes they are spent.

I could not confirm on regtest that wallet2 accepts a forged partial (that needs a hand-built multisig info blob). But the doc's security argument is wrong as written, and the failure is a false `released` on a funded escrow.

Required:
- Either prove on regtest that wallet2 refuses such an info (and correct the argument in coordination.md and the `spendEvidence` comment), or
- make a sweep that is shown only through an import (one the mod did not co-sign) count only with an independent check.

My suggested check: the releasing party sends the tx's secret key with `spend.info`, and the mod verifies with `checkTxKey` that T pays `payoutsFor(kind, balance, signed_terms…)` to the address in moderation's own `signed_terms`. Then a "fake" sweep is harmless, because T really paid the right party. Alternatively, require the buyer's and seller's infos, each imported alone, to show the same tx.

**I2. A compromised API can make the mod close the relay channels of a funded, open escrow. Decision A now makes this easy to gate.**
Where: `packages/trade/src/watch.ts:262` and `:311` (closed by the API alone → `closeChannels`), executed by `apps/moderation/src/watcher.ts:259-267`.

The module comment says released/refunded close on "our own `settled`", but the code closes on the API's word alone (pinned by `watch.test.ts:252`, "a close known only from the API…"). That rule predates this branch, but this branch wires it to the real signed `closeTrade`. Scenario: the API (compromised, or buggy) lists a `secured` trade holding 1 XMR as `released` (or `cancelled`) in `GET /internal/v1/watch`. On its next pass the mod signs relay closes for both `escrow` and `signals`. The relay refuses rejoins with 4404 and cannot reopen (admin replay protection). The parties can no longer run any settlement, or even deliver `spend.info`. The coins sit in the multisig until a ruling path exists that does not need the relay.

Honestly, the API reaches `released`/`refunded` only through the mod's own `settled`, so this gate costs nothing. Required: close only once the mod has shown a sweep (`s.settledTx !== null`), or when the API says `cancelled`/closed AND the mod's own wallet has never seen an incoming tx. Otherwise keep the channels open, and keep reporting the coins as late (the escalation to the API stays as it is).

## Minor

**M1. A claim is consumed outside `settling`, and a party can burn it early.** Where: `packages/escrow/src/party.ts:785` and `:712` (a claim is recorded in any phase, even mid-setup), `packages/trade/src/watch.ts:267` (`claimReported` is set whatever the API state is). The watcher treats the API's 409 `wrong-state` as done. Scenario: a buyer's patched client sends a sealed `spend.claim:0 {}` while the trade is `secured`. The watcher reports `release-claimed` → `wrong-state` → `claimReported: true` is persisted. On the real release later, nothing is reported, so the window reverts at `settleBy`. A sweep shown after that is `settle-kind-unknown` forever, the pre-(b) behaviour. Fix: in `watchStep`, only consume `claimed` while `a.trade.state === 'settling'`, so a claim that arrives early is still reported when settling starts. And/or have the mod record a claim only once setup is over.

**M2. A party can make the mod re-import, and so hide a sweep or load the service.** Where: `party.ts:717` (re-import whenever the digest differs) and `party.ts:688` (`sync()` plus import plus `persist()` on every attempt). A refused info is never acked, so every resend triggers a full sync and import attempt. A party can also send a garbage info after the honest one: if a later import replaces the composite key images (wallet2 recomputes them from the latest info), the honestly shown sweep can disappear from `outgoing` before the watcher reports it, which leads to a 6 h escalation. Suggest: once an info from a sender has been imported, ignore later distinct infos from that sender, and rate-limit attempts per sender.

**M3. `spend-unshown` ignores pause.** Where: `watch.ts:270-275`; `machine.ts:428` (escalate is not refused while `pausedAt`). The trade timers stop during maintenance ("no timer fires meanwhile"), but the 6 h fallback keeps counting. After maintenance of more than 6 h, or a moderation outage of more than 6 h (the anchor is persisted), every settling trade escalates on the first pass even though the parties could not act. This is latent until `site_flags` exists. Suggest: skip the fallback while the API trade is paused (the watch list would need `paused`), or let the API refuse a system `escalate` from `settling` while paused.

**M4. A claim is once per watch, but the machine allows once per episode.** Where: `watch.ts:267`, `party.ts:712` (claims is a set of roles, and spend info is sent once per trade). A second settling episode after a claimed one (for example claimed, then `open-dispute` after `settleBy`, then a later settle) never gets a claim. Acceptable today, but the Revision note says "once per settling episode". Document it as once per trade, or make it per episode.

**M5. Escalation from `settling` leaves `settling`/`settleFrom`/`settleBy`/`releaseClaimedAt` set on a `disputed` trade.** Where: `machine.ts:428-430`. This matches `onDispute`, and nothing reads those fields outside `settling` today (`settleKindFor`, `onTick` and `nextDeadline` check the state first). But Task 27 (disputes, `wip/lead-p3-task27`) and Plan 4 rulings should know about it. The same goes for a sweep shown after a `spend-unshown` escalation: it is `settle-kind-unknown` from `disputed`, so it backs off forever and needs a moderator. Worth one line in the Revision note.

**M6. Late funds can go unwatched in the gap between the API's 31-day list and the watcher's own 30 days.** Where: `apps/api/src/internal/routes.ts:286` versus `watch.ts` (30 days from the watcher's latest close). A trade the API closed earlier than the watcher's `closedAt` (for example a sweep first shown more than 1 day after the API closed the trade) drops off the list while the watcher would still watch it, so `tick` `continue`s. A late coin in that gap is never escalated. Suggest: list closed trades the mod still watches (`watching`) by a longer margin, or have the watcher keep a trade that is not listed but is within its own 30 days.

**M7. Migration numbering.** API `113_release_claim.sql` does not clash: 110 (disputes, Task 27), 112 (Task 5) and 106 (Task 20) are the only nearby numbers on wip branches, and `wip/second-p3-task10` carries this same file through its merge of this branch. On moderation, though, `002_watch.sql` here and `002_chat.sql` on `wip/second-p3-task20-rest` share a number. The migrator keys on the name, so both apply. Renumber one (003) so the order is deliberate and the convention stays clear. Every other branch that rebuilds a `Trade` literal (for example `refundRules.ts`-style dry runs; Task 27's `dispute.test.tsx` builds trade views) must add `releaseClaimedAt` after this merges: tsc will catch it.

## Not findings (checked)
- Payouts and terms: `partyArgsFor` (moderation main.ts) takes the terms from `signed_terms` (`posted_at is not null`) only; `watcher.test.ts:244` serves different terms from the API.
- Replay: `spend.*` frames go through `open()` (signature, participants, channel, replay guard). The sender is the signed `from`. `spend.info` from the mod and `spend.ack` from a non-mod are malformed.
- Nonces: a buyer or seller exports only at `phase === 'done'` (the co-signer after submitting, the builder after the tx is in a block), never after a release the mod co-signed. The export is saved before it is sent. The mod imports only outside its own release (`importRefusal`). Any later mod co-signature starts with a fresh `state.export` round.
- Crash and restart: the watch row is backfilled from `signed_terms`. When the API is already past setup, setup-done is recorded locally. `settlingSince`, `claimReported` and `claimedAt` are persisted. The API's `wrong-state` is idempotent.
- API: reports must carry exactly the expected keys and are accepted for attested trades only. The settled kind comes from the API's own trade. The timer loop applies each event through `applyEvent` with its own `at` and logs refusals. A claimed trade has no deadline (timers.test).

## Tests (own worktree ~/x2f-worktrees/rv-t9, dd55fcd plus trial merge of 0e92cb6, under check.lock)
- tsc --noEmit: escrow, trade, api, moderation and web, all exit 0.
- vitest @x2f/trade and @x2f/moderation: 13 files, 344/344 passed.
- vitest @x2f/api watchReports, timers, schema, events, events-route and purge: 6 files, 125/125 passed.
- vitest @x2f/escrow spend-info.test.ts (regtest, Docker): 2/2 passed.
- No test covers I1 (a forged partial key image) or I2 (a close on the API's word alone while the escrow holds coins). In fact watch.test.ts:252 pins I2's current behaviour. Add both with the fixes.
- Worktree removed after the run.
