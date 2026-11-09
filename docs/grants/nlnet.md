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
- Payment proofs are stripped of metadata and masked on the device.
- Accounts need no email or phone, and login names are stored only as keyed hashes.

We ask for funding for an **independent external audit** of this cryptography and its fixes, and for publishing the results.

## Why this matters

People who leave or avoid the centralised exchanges give up their identity and their coins to one company. P2P venues avoid that, but they have repeatedly failed. Some were shut down. Some lost funds to protocol flaws, as in the 2026 RetoSwap/Haveno incidents. X2F is designed so that:

- a breach of its servers cannot move coins;
- its database does not identify or expose its users.

A public, audited specification lets the community check that claim instead of trusting it.

## What the money buys

1. An independent audit of:
   - the escrow protocol (participant attestation, equivocation checks, transaction-set checks, the operator key's refund-only limits);
   - the envelope and chat cryptography, including the planned per-trade membership keys;
   - the account system.
2. Engineering time to fix every finding, and the auditor's re-check.
3. Publication of the report and an updated specification (`docs/public/x2f-crypto-spec.md`).

Budget: audit [AMOUNT]; fixes and re-check [AMOUNT]; total [AMOUNT].

## Comparison with existing work

Haveno and its forks use Monero multisig with arbitrators. Bisq-style designs use deposits on other chains. X2F differs in three ways:

- Each co-signer checks the full multisig transaction set: exactly one transaction, no change output, exact outputs.
- The operator's key can act alone only to refund the whole escrow to the seller's own signed address.
- The planned chat design gives the operator no key to an undisputed conversation.

## Honest status

Section 9 of the specification lists the known gaps:

- the moderation service can read chats until the membership keys are built;
- dispute rulings are not built;
- the proof pipeline is not wired into the web app yet;
- the web app's code is delivered by the server.
