DRAFT, not sent; the owner decides.

# NLnet proposal (draft): X2F

**Fund:** [CHECK: which NLnet / NGI Zero call is open at the time of sending]
**Amount requested:** [AMOUNT] EUR
**Applicant:** [OWNER: name or organisation, country]
**Code and licence:** [OWNER: NLnet funds free and open-source work; the repository currently has no LICENSE file]

## Abstract

X2F is a non-custodial peer-to-peer marketplace for trading Monero for fiat money.

- Each trade's coins sit in a fresh 2-of-3 Monero multisig escrow. The buyer and the seller each hold a key share made on their own device, and the operator holds at most the third.
- Trade chat is end-to-end encrypted with libsodium.
- Payment proofs will be stripped of metadata and masked on the device (library built, not yet wired into the app).
- Accounts need no email or phone, and login names are stored only as keyed hashes.

We ask for funding for an **independent external audit** of this cryptography and its fixes, and for publishing the results.

## Why this matters

People who leave or avoid the centralised exchanges give up their identity and their coins to one company. P2P venues avoid that, but only if their escrow and their servers hold up. X2F is designed so that:

- a breach of the API or the message relay cannot move coins, even together with one trader;
- its database does not identify or expose its users.

The limit, stated plainly: a compromised moderation service together with a colluding trader could move that trade's coins: the moderation service's share plus one trader's share is the 2-of-3 threshold, and its refund-only rules bind only an honest service. That is why the moderation service is a separate process with its own database and holds no account or login data, only what the trades need (its key shares and wallet passwords, its trade and chat identities, and its signing key), and why we are seeking an external audit. A breach of the API or the message relay cannot move coins, even together with one trader.

A public, audited specification lets the community check these claims instead of trusting them.

## What the money buys

1. An independent audit of:
   - the escrow protocol (participant attestation, equivocation checks, transaction-set checks, the moderation service's automatic-refund rules);
   - the envelope and chat cryptography, including the planned per-trade membership keys;
   - the account system.
2. Engineering time to fix every finding, and the auditor's re-check.
3. Publication of the report and an updated specification (`docs/public/x2f-crypto-spec.md`).

Budget: audit [AMOUNT]; fixes and re-check [AMOUNT]; total [AMOUNT].

## Comparison with existing work

[OWNER/CITE: a comparison with Haveno and Bisq belongs here only with links to their published documentation or code; we have not verified their designs from this repository.]

What X2F's design does (without claiming that others do not):

- Each co-signer checks the full multisig transaction set: exactly one transaction, no change output, exact outputs.
- Today the moderation service co-signs without a human only two automatic refunds, each paying the whole balance to the address the seller's own key signed. Its key never signs alone: it always co-signs with a trader. Dispute rulings (planned) will let it co-sign payouts to either side, and will require a staff security-key signature.
- The planned chat design gives the operator no key to an undisputed conversation.

## Honest status

Section 9 of the specification lists the known gaps:

- a compromised moderation service together with one trader could move that trade's escrow;
- the moderation service can read chats until the membership keys are built;
- dispute rulings are not built;
- the proof pipeline is not wired into the web app yet;
- whole-trade deletion is not built yet (chats and addresses are already deleted on schedule);
- the web app's code is delivered by the server.
