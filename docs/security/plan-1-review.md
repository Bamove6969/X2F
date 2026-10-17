# Plan 1 security review (escrow core)

Date: 2026-10-17. Scope: everything Plan 1 built on branch `claude/compassionate-johnson-k95ssr`: `packages/core`, `packages/protocol`, `packages/escrow`, `apps/relay`, `tools/regtest`, dependency pins and install settings.

This is an in-house review. It does not replace the external code and cryptography audit and the penetration test the spec requires before launch (spec 6.5). This document is meant as the starting brief for those auditors.

## How it was reviewed

1. **Per-task reviews.** Each task was reviewed by a separate reviewer agent and fixed until approved: Task 5 (2 rounds), Task 6, Task 7 (2 rounds), Task 8 (5 rounds), Task 9. Their findings and decisions are recorded in `docs/superpowers/rulings-and-lessons.md`.
2. **Semgrep 1.178.0** (`p/typescript`, `p/nodejs`, `p/secrets`) on every commit: 0 findings.
3. **`npm audit --omit=dev`** on every commit: 0 vulnerabilities.
4. **Security review of the whole branch** (the `security-review` skill): no high-confidence High or Medium findings.
5. **Adversarial review** by an agent on a different Claude model, tasked with breaking the escrow (theft, unintended signing, nonce reuse, fund lock, envelope forgery, privacy, supply chain, relay DoS), with proofs of concept on the regtest chain.

## Findings from this review and what was done

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High (proven on regtest) | A dishonest builder could make the honest co-signer's wallet refuse to sign (a set built on stale multisig nonces). The refusal was a non-`EscrowError` and killed the party; on restart it hit the same set again, so that outcome was locked and a dispute was forced. | **Fixed.** `signRelease` and `buildRelease` turn wallet refusals into retryable `EscrowError`s; the party starts a fresh attempt (new export, new nonces) and the outcome lock lifts. Test: `engine.test.ts` "a set built on stale signing data is a refused attempt". |
| 2 | High (proven) | Anyone could hold the relay's 64 unauthenticated slots by opening sockets and never answering the join challenge, locking everyone out. | **Mitigated.** Join timeout cut from 10 s to 3 s. **Residual:** a per-source limit is needed and must live in the front proxy / onion service, because the relay itself never sees or stores IPs (privacy rule). Plan 6 (deployment) must add it. |
| 3 | Medium (proven) | Extra coins sent to the escrow stall settlement: one surplus payment makes trade-derived payouts fail closed; dust sent every few blocks keeps part of the balance locked indefinitely. | **Open, owner decision.** Plan 3 must decide who gets a surplus and how long to wait for locked dust before settling the unlocked amount. Until then the code fails closed (nobody can be paid the wrong amount). |
| 4 | Medium | One trade participant could fill the trade's whole relay queue for an offline peer (e.g. the moderator), delaying the other party. | **Fixed.** Per-sender cap: one sender may use at most half of a trade's queue share. Test: `relay.test.ts` "one sender cannot fill the whole trade queue". |

## Confirmed sound (tried and held up)

- **Payout check / theft.** The co-signer accepts only one transaction that sweeps the whole escrow to exactly the expected payouts; no change output, no unlock time, network fee capped at 0.01 XMR and taken only from the receiver's payout. Checked against monero v0.18.5 source: signing rebuilds the transaction from the same construction data the check decodes, so a builder cannot show one payout and broadcast another.
- **Nonce reuse.** The wallet wipes nonces on use and refuses stale data; the party saves every export, built set and signature before it leaves the device, and never signs a different set for the same attempt.
- **Envelopes.** Signatures cover every field; box keys are bound to signing keys; recipients are hidden; replays across trades and within a trade are refused; malformed input is rejected before use.
- **Relay.** Signed join on a fresh challenge; nothing forwarded before authentication; every envelope must match its connection's trade and role; logs carry reasons only (no IPs, codes or contents).
- **Supply chain.** `ignore-scripts=true`, exact pins, overrides matching the lockfile; the monerod download checks the GPG signature against a pinned fingerprint and pinned SHA-256s for the tarball and the binary.
- **Auto-refund guard.** Pure; every condition strict; only the recorded refund address.

## Open items for Plan 3 and the external audit

- Surplus and dust policy (finding 3).
- Per-source connection limits in front of the relay (finding 2).
- From the Task 8 review: the builder accepts the co-signer's reported tx hash without checking it; `txSeen` counts a pool transaction as done and uses a raw `fetch`; a submit rejected for good retries forever (Plan 3 should watch the chain); daemon calls have no timeouts.
- Saved wallet data: keys use wallet2's single KDF round and no MAC; Plan 3 must use a strong random secret, stored apart from the saved session (R27).
- A winning trader who never returns leaves a ruled payout waiting (Plan 6 key backup).
- monero-ts transitive advisories were cleared with overrides; re-check on every monero-ts upgrade.
- Auditors should independently confirm the monero v0.18 signing behaviour this design relies on (rulings R10, R23, R26).
