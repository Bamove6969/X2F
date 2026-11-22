# Proposal: completing a winner's committed buyer-cancel (not built)

Lead task, 22 Nov 2026, branch wip/lead-ruling-committed. Source: review-lead-fix-ruling-pay-2026-11-22.md (comms), re-review section "Builder's question 1", case (b).

**Status: proposal only. Nothing in this note is built.** It needs a security review and lead or owner sign-off first, because every option widens what the moderator signs or changes the escrow protocol.

## The case

1. A trade is disputed before "I've paid". Both cancels are refused after paid, so this case is rare.
2. Earlier, the buyer built a buyer-cancel: the buyer builds and the moderator co-signs. It refunds the whole escrow to the seller's signed refund address. The buyer's party is committed to it.
3. The moderator's party never received that set before it switched to the ruling.
4. The buyer wins the ruling. The executor records the ruling's payout, announces the signed statement and hands the mod-built set to its party.
5. The buyer's party will never export for the ruling. The coins stay in the escrow.

What staff see since this branch:
- The moderation process names the case `ruling-winner-committed`. The buyer's party keeps sending the moderator its built set for another outcome, signed by the buyer's trade identity.
- It is shown on the case view (`ruling.payoutWait`) and logged as `ruling.payout-waiting`.

## Can staff already complete it? No.

Every route to the moderator co-signing that cancel is closed while the trade is disputed:

- **The desk** (apps/moderation/src/desk.ts) hands nothing once the ruling executor has recorded a payout (`rulingRecorded`, review M5: `desk-ruling-recorded`).
- **The API brake.** Even before that, a buyer cancel is co-signed only while the API shows `funding`, `securing`, `secured` or `settling/buyer-cancel` (`apiAllows`), never `disputed`. An armed cancel is blocked as `buyer-cancel-api-state`.
- **The executor** settles only the round-1 ruling's own payout, exactly once. A different ruling or payout for the trade is `mismatch` for good. Round 2 never reaches settle.
- **Staff routes.** No staff route reaches the moderation process's party. The API's `ModerationClient` has only `chatGrant` and `chatSend`.

## Why the smallest staff action widens what the moderator signs

The smallest action would be "complete committed cancel": a key tap that lets the moderation process hand `{ builder: 'buyer', cosigner: 'mod', to: <refund> }` to its party. The party would then check the buyer's set against those payouts and sign it.

The payout set is one the moderator could sign for this trade before the dispute: the whole balance to the seller-signed address, the same `payoutsFor('buyer-cancel')`. But the action widens the moderator's signing in four ways:

1. **It signs while the trade is disputed and after a ruling payout is recorded.** Today that is excluded twice, by the desk's `rulingRecorded` and by `apiAllows`.
2. **It signs against its own signed ruling statement.** The statement names the buyer as winner and the buyer's payouts. The coins would go to the loser.
3. **It adds a new authority path into the moderator key.** That means a new tap intent kind, gate verification of it, and a new internal route from staff through the API to the moderation process. Today staff authority reaches the moderator key only through a ruling, and only for the ruling's payouts.
4. **The API and trade machine must accept it.** They would have to take a `buyer-cancel` settle on a disputed trade and close the dispute with an execution that is not the ruling's. The watcher, `sweepKindAgrees`, `recordRulingExecution` and the R-M2 kind rules all assume a disputed trade closes only by its ruling.

The brief says to build only if this does not widen what the moderator can sign. It does, so it is not built.

## Options, for a decision

### Option A: staff complete the committed cancel (widens signing)

Preconditions, all from the moderator's own facts, none from the API or a trader's word:
- the desk's `cancelSeen && !paidSeen` (the buyer's own signed `trade.cancel`, and no `trade.paid` ever opened);
- `sellerRefund` recorded;
- the moderator's `peerRelease('buyer').elsewhere` shows `txSet: true` with exactly `releaseTag` of the buyer-cancel outcome the moderator computes itself;
- the moderator's own party is not committed (`committedBuilder() !== 'mod'`);
- the recorded ruling's winner is the buyer, and it is not settled.

The action:
- **Who:** a senior moderator or the owner taps a new intent, `complete-committed-cancel { trade, rulingId, tag }`. Over the large-trade limit, a second person approves, as rulings do. The gate verifies the tap against the pinned registry.
- **The handover:** the moderation process records the action in the sealed gate store (like an execution, before the party is asked) and hands the cancel to its party. The party's own `checkRelease` then binds what is signed to those payouts.
- **The API:** it takes the sweep as `buyer-cancel` on the disputed trade only with that record. The dispute closes with a distinct execution: no fee, R-M2 kinds unchanged otherwise.

Cost: the four widenings above, and a money and key review. The coins go to the seller even though the buyer won. The buyer chose that before paying, but the ruling is not carried out.

### Option B: the moderator declines the committed cancel (no new signing; changes the protocol)

The escrow protocol already lets a builder drop its commitment. If the co-signer's export for the next attempt arrives (the co-signer refused the set), the builder follows with `nextAttempt`, unless it has signed. A builder that only built has not signed, so `committed` goes back to false (party.ts `counterpartNext`).

The web runtime's M2 fix then stops reporting `committedElsewhere()`. The buyer's device saves the ruling intent and hands the mod-built ruling set. The ruling pays the buyer as decided.

What it needs:
- **A new read-only-by-signing party step, "decline outcome o".** The moderator sends a fresh export for o's next attempt without ever taking o as its release, so it can never sign the buyer's set. That is an escrow party protocol change.
- **A fresh attempt of the moderator's own ruling release.** A new export replaces the signing nonces of the ruling export already sent (R26).
- **A trigger:** either automatic, on the moderator's own facts (the `winner-committed` case above, after a set time), or a staff key tap.

Cost: a protocol change in packages/escrow and its own security review. But the moderator never signs anything but the ruling's payout, and the ruling is carried out.

### Option C: do nothing more (today's behaviour plus this branch's reason)

Staff see `ruling-winner-committed`. The coins wait until the buyer's party is reset or restored without that commitment, or until a person acts outside the product.

## Lead recommendation

Option B is the only one that keeps "the moderator signs only the ruling's payout". It also pays the winner. Option A carries out the opposite of the ruling.

Either is an owner question once a reviewer has scoped B's protocol change. Until then, C with the new staff reason is the safe default.

The mutual cancel is the other form of case (b): the buyer builds and the seller co-signs. The moderator takes no part in it, so it shows as `ruling-winner-offline`. Like case (a), the loser can complete it alone. Whether that becomes a lien on the seller is the same question as RP-3, and is not decided here.
