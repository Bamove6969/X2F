DRAFT, not sent; the owner decides.

# Monero CCS proposal (draft): independent audit of X2F's multisig escrow and chat cryptography

**Amount requested:** [AMOUNT] XMR
**Milestones:** two, paid by the CCS on completion (below)
**Proposer:** [OWNER: name or handle to publish]
**Code:** [OWNER: public repository link and licence; the CCS expects work that benefits the Monero community, normally open source]

## What X2F is

X2F is a peer-to-peer marketplace for trading Monero for fiat (cash, bank transfers, payment apps). It fills the gap left by LocalMonero's closure in 2024. It is non-custodial:

- Each trade locks the seller's XMR in a fresh 2-of-3 Monero multisig wallet.
- The buyer and the seller each hold one key share, made in their own browser.
- The moderation service holds the third share. X2F holds at most that one share per trade.
- X2F has no user wallets and no balances.

X2F asks for no name, email or phone, runs no analytics, and deletes trade data on a fixed schedule.

## Why this matters to Monero

People need to move between XMR and local money without handing their identity to a centralised exchange. Every recent P2P venue has either closed or been attacked. The 2026 RetoSwap/Haveno incidents came from flaws in the protocol messages around multisig, not in Monero itself. X2F's design answers that directly:

- Every escrow message is signed by a per-trade identity and checked against a participant list that the moderation service signs.
- Each co-signer decodes and checks the full multisig transaction set before signing. It requires exactly one transaction, no change output, no unlock time, a capped fee, and exact outputs.
- The moderator key can act alone only to refund the whole balance to the address the seller's own key signed.

The specification is public for community review: `docs/public/x2f-crypto-spec.md`.

## What the money buys

An **independent security audit by an outside firm** [OWNER: firm, once quotes are in], covering:

1. the multisig escrow protocol and its use of monero-ts/wallet2: setup, equivocation checks, transaction-set verification, resume after a paused phone, and the moderation service's automatic refund rules;
2. the envelope cryptography (libsodium) used for escrow messages and trade chat, and the planned per-trade chat membership keys;
3. the moderation service's key storage.

The audit report and our fixes will be published in full.

## Milestones

1. **Audit delivered** [AMOUNT] XMR: the auditor's report is delivered to the project.
2. **Fixes and publication** [AMOUNT] XMR: every finding is fixed or answered, re-checked by the auditor, and the report is published.

## What this proposal does not fund

Development of X2F itself, hosting, or marketing.

## Honest status

Known gaps are listed in section 9 of the specification:

- the moderation service can read every chat until the planned membership keys are built;
- moderator dispute rulings are not built yet;
- the web app's code is delivered by the server.

Monero multisig is labelled experimental upstream, and FCMP++ will change it. The escrow sits behind one interface so that it can be replaced.
