DRAFT, not sent; the owner decides.

# OTF Red Team Lab request (draft): X2F

**Support requested:** a security audit through the Red Team Lab. [CHECK: as we understand it, the Lab pays the auditor directly rather than granting money; confirm against OTF's current terms.] Estimated value: [AMOUNT]
**Applicant:** [OWNER: name or organisation, country]
**Code:** [OWNER: public repository link and licence; OTF support generally expects open-source software]

## What X2F is

X2F is a peer-to-peer marketplace where people trade Monero, a privacy-preserving cryptocurrency, for local money. It is designed so that users share only the minimum needed to finish a trade:

- no name, email or phone number;
- no analytics or third-party scripts;
- end-to-end encrypted trade chat;
- payment proofs stripped of metadata and masked on the device;
- trade data deleted on a fixed schedule.

X2F never holds users' coins. Each trade uses a 2-of-3 multisig escrow, and X2F holds at most one of the three keys.

## Why privacy matters here

Access to money that cannot be frozen or watched matters most where banking is surveilled or restricted, and where using a centralised exchange means handing over an identity document. A P2P venue only protects such users if:

- its servers cannot read their conversations;
- a breach of X2F cannot move their coins;
- a stolen database does not identify them.

These are the properties we want tested.

## What the audit should cover

The public specification is `docs/public/x2f-crypto-spec.md`. The audit should cover:

1. **Chat and message cryptography:** libsodium envelopes (Ed25519, X25519 `crypto_box`, XSalsa20-Poly1305, padding buckets, replay guard), and the planned per-trade membership keys that make "moderators read only after a dispute" enforced by cryptography.
2. **The web delivery model:** CSP, worker isolation of secrets, and what a compromised origin can do; plus the planned Tor onion service and signed native builds.
3. **Accounts:** the PGP challenge login, WebAuthn, peppered Argon2id, and HMAC-tagged login names.
4. **The escrow protocol** around Monero multisig, and the moderation service's limits.

## What we commit to

- Fix or answer every finding.
- Publish the report once the fixes ship.
- Keep the specification's "known gaps" section current.

## Honest status

[OWNER: launch stage and user numbers, if any.] The known gaps are listed in section 9 of the specification. The biggest are:

- today the moderation service can decrypt every chat (a rule and an audit log, not cryptography, stop it reading);
- the web app's code comes from the server.
