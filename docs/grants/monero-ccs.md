DRAFT, not sent; the owner decides.

# Monero CCS proposal (draft): independent audit of X2F's multisig escrow and chat cryptography

**Amount requested:** [AMOUNT] XMR
**Milestones:** two, paid by the CCS on completion (below)
**Proposer:** [OWNER: name or handle to publish]
**Code:** [OWNER: public repository link and licence; the CCS expects work that benefits the Monero community, normally open source]

## What X2F is

X2F is a peer-to-peer marketplace for trading Monero for fiat (cash, bank transfers, payment apps). It fills the gap left by LocalMonero's closure in 2024 [CITE: link to LocalMonero's closure notice]. It is non-custodial:

- Each trade locks the seller's XMR in a fresh 2-of-3 Monero multisig wallet.
- The buyer and the seller each hold one key share, made in their own browser.
- The moderation service holds the third share. X2F holds at most that one share per trade.
- A compromised moderation service together with a colluding trader could move that trade's coins: the moderation service's share plus one trader's share is the 2-of-3 threshold, and its refund-only rules bind only an honest service. That is why the moderation service is a separate process with its own database and holds no account or login data, only what the trades need (its key shares and wallet passwords, its trade and chat identities, and its signing key), and why we are seeking an external audit. A breach of the API or the message relay cannot move coins, even together with one trader.
- X2F has no user wallets and no balances.

X2F asks for no name, email or phone and runs no analytics. Chats and payout addresses are deleted on a fixed schedule; whole-trade deletion is being built.

## Why this matters to Monero

People need to move between XMR and local money without handing their identity to a centralised exchange. A multisig escrow is only as safe as the messages and checks around it, and that is where X2F's design concentrates:

- Every escrow message is signed by a per-trade identity and checked against a participant list that the moderation service signs.
- Each co-signer decodes and checks the full multisig transaction set before signing. It requires exactly one transaction, no change output, no unlock time, a capped fee, and exact outputs.
- Today the moderation service co-signs without a human only two automatic refunds, each paying the whole balance to the address the seller's own key signed. Its key never signs alone: it always co-signs with a trader. Dispute rulings (planned) will let it co-sign payouts to either side, and will require a staff security-key signature.

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

- a compromised moderation service together with one trader could move that trade's escrow (see above);
- the moderation service can read every chat until the planned membership keys are built;
- moderator dispute rulings are not built yet;
- payment proofs: the metadata-stripping and masking library is built, but not yet wired into the app;
- whole-trade deletion is not built yet (chats and addresses are already deleted on schedule);
- the web app's code is delivered by the server.

Monero multisig is labelled experimental upstream, and FCMP++ will change it. The escrow sits behind one interface so that it can be replaced.
