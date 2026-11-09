# Review: wip/lead-crypto-spec @ d902281a (public crypto spec + grant drafts), 2026-11-09

Reviewer: independent helper, read-only. Files: docs/public/x2f-crypto-spec.md (283 lines), docs/grants/monero-ccs.md, nlnet.md, otf-red-team-lab.md. Base: main 0c6f3f16.

**Verdict: CHANGES NEEDED before anything is published or sent.**
- The spec is careful and mostly accurate. I verified each appendix path exists, and checked about 40 claims against code; they hold (list at the end).
- **One serious over-claim (C1)** sits in the threat model and is repeated more strongly in all three grants.
- Several grant sentences state partly built or unverified things in the present tense.
- **No operational secrets leak.** There are no hostnames, onion addresses, ports, key ids, fingerprints or values. The env var name `MOD_KEYSTORE_KEY` appears three times; it is a name, not a value. That is acceptable, but it could be "the keystore key" if the owner prefers no internal names.

## Over-claims and errors (fix)

- **C1 (serious): what X2F plus one trader can do.**
  - Spec §1 l.13 says: "No X2F server, alone or together with any one trader, should be able to move escrowed coins anywhere the honest parties did not agree to."
  - In a 2-of-3 wallet, the moderation service's share plus any one trader's share is the threshold. The limits in §3.4 (refund-only, `wrong-destination`, the co-sign checks) are code the moderation service runs on itself; they bind an honest service, not a compromised one.
  - So someone holding the moderation database and `MOD_KEYSTORE_KEY`, who is also (or colludes with) the buyer in a trade, can sweep that trade's escrow without paying. That is inherent in arbitrated 2-of-3 escrow (Haveno is the same), and the spec should say so plainly.
  - What is true:
    - The API, the relay, or the API database cannot move coins, even together with one trader.
    - The moderation service alone cannot.
    - The moderation service with one trader can.
  - Suggested §1 text: "No X2F server alone, and neither the API nor the relay together with a trader, can move escrowed coins. The moderation service holds one share: if it is compromised and the attacker is also a party to a trade, that trade's escrow is at risk. The moderation service's own rules (3.4) protect only while it runs honest code." Add this as a numbered item in §9 too.
  - The grants repeat it more strongly:
    - NLnet l.83: "a breach of its servers cannot move coins".
    - OTF l.140: "a breach of X2F cannot move their coins".
    - Both need the same qualification ("a breach of the API or relay cannot ...; the moderation service holds one of the three keys").
- **C2: "act alone" and "only" in the grants.**
  - CCS l.27: "The moderator key can act alone only to refund the whole balance".
  - NLnet l.104: "The operator's key can act alone only to refund the whole escrow".
  - In 2-of-3 the moderator key never acts alone: in both automatic cases it co-signs with a trader (spec §3.1 table). "Only" is also true only **today**, because `verifyRuling` refuses everything (`apps/moderation/src/rulings.ts`). Once Plan 4 rulings land, the moderator will co-sign dispute payouts to either side.
  - Suggest: "Today the moderation service co-signs without a human only two automatic refunds, each paying the whole balance to the address the seller's own key signed; dispute rulings (planned) will require a staff security-key signature."
  - NLnet presents this as a difference from Haveno, which makes the "today" qualification essential.
- **C3: the fee, spec §3.3 step 2.** "The fee output is exactly 1% of the trade." That is true only for release-type payouts. Cancels and refunds carry no fee output: every refund sweeps the whole balance to the seller (`packages/trade/src/payouts.ts` l.84, R41), and on a buyer's ad that the seller wins in a dispute there is no fee output either (l.30-32). Say: "On a release, the fee output is exactly 1% of the trade; cancels and refunds have no fee output."
- **C4: spec §7 l.231 is stale.** "The design's rule for disputed trades counts the 90 days from the moment the dispute button is pressed. The code counts from when the dispute closes. This is under review." The owner settled this on 9 Nov as p11-11 (the dispute closing), and wip/lead-docs-rules rewrites the design to match. Replace it with "Counted from the dispute closing (owner, 2026-11-09)", or delete the line.
- **C5: PGP user IDs, spec §2 and §6.**
  - §6 says keys "are stored encrypted (AES-256-GCM), with user IDs stripped where the key survives it".
  - The code (`apps/api/src/auth/pgp.ts` `storableKey`, l.90-112) strips user IDs **only from v6 keys**. Every v4 key, which is most keys in use, is stored whole, with its user IDs, which often hold a real name and email.
  - §1/§2 say "X2F asks for no name, email or phone". That is true, but a user's pasted key can still carry them, encrypted at rest under a server key.
  - Say so in §2 ("PGP public keys, encrypted at rest; v4 keys keep their user IDs, which may contain a name or email"). The grants' "a stolen database does not identify them" (OTF l.141) and "its database does not identify ... its users" (NLnet l.84) are then fine, because the database alone is still encrypted.
- **C6: present tense for partly built things in the grants.**
  - NLnet l.74 and OTF l.130: "Payment proofs are stripped of metadata and masked on the device". The spec itself says **partly built**: the library is there, and the web pipeline is not wired (`NEEDS_PLAN_5`). NLnet's status list mentions this; OTF's does not, and the CCS draft does not either. Add "(library built, not yet wired into the app)" or "will be".
  - CCS l.19 and OTF l.131: "deletes trade data on a fixed schedule". Chats and addresses are deleted on a schedule. The whole-trade delete at 30 days is **not built** (spec §7). Say "chats and payout addresses are deleted on a fixed schedule; whole-trade deletion is being built".
- **C7: unverified claims about others (the owner's allergy).**
  - CCS l.23: "Every recent P2P venue has either closed or been attacked." This is a sweeping universal; Bisq, RoboSats and Haveno itself still operate.
  - CCS l.23 and NLnet l.81: "The 2026 RetoSwap/Haveno incidents came from flaws in the protocol messages around multisig, not in Monero itself". This is a confident causal claim about a third party's incident, with no citation in the repository.
  - NLnet l.101-105 implies Haveno's co-signers do not check the full transaction set. I could not verify that from the repository.
  - Either cite sources (the incident post-mortem link, Haveno's code) or soften: "Several P2P venues have closed, and some have lost funds (e.g. [cite])"; "X2F's co-signers check ..." without saying others do not.
  - CCS l.12, "LocalMonero's closure in 2024": I believe this is correct (it wound down in 2024), but add a link.
- **C8, minor: TOTP wording, spec §6.** "TOTP is a second factor or a backup only, never the only login." An authenticator code alone *can* log in as a weak way (R42: "password, authenticator code or recovery code alone"), with the 24-hour hold on security changes. "Never the only login" reads as "cannot log in alone". Suggest: "TOTP cannot be an account's only login method; used alone it is a weak login and security changes wait 24 hours."
- **C9, minor: login names in flight.** "Stored only as HMAC-SHA-256" is true for accounts. During sign-up, the login name is also held AES-256-GCM-sealed (`apps/api/src/accounts.ts` `sealNames`, `subkey('login-seal')`), in the client-held sign-up state. Optional: "stored only as HMAC tags (a sign-up in progress carries it sealed)".
- **C10, suggestion, not an error: §3.3 step 4.** The co-signer's `checkTxSet` reads the destinations that monero-ts/wallet2 decodes from the multisig tx set. The check is only as good as wallet2 binding those destinations to the signed transaction. My understanding is that wallet2 rebuilds the transaction from its construction data when signing; I have not verified this in the monero-ts 0.11.16 path. State this as an assumption for the auditor, rather than implying the check is self-contained.

## Status labels

| Section | Label | Right? |
|---|---|---|
| 3 Escrow | built (release, cancels, refunds), planned (rulings) | **Right.** `startTimers` is in apps/api main.ts; the moderation desk wires `autoRefundStep` and `buyerCancelStep`; `verifyRuling` returns false. |
| 4 Chat | built; membership keys planned | **Right.** The chat engine runs in the escrow worker (`apps/web/src/chat/engine.ts`). No staff-web or moderation code decrypts chats; only keystore.ts mentions it. |
| 4.4 | planned, "none of it on main" | Right |
| 5 Proofs | partly built | Right (seams.tsx `NEEDS_PLAN_5`). wip/lead-proof-receive adds a receiver check, which is still unwired. |
| 6 Logins | built | Right |
| 7 Retention | as listed on main | Right, except l.231 (C4) |
| 8 Planned items | onion, native apps, SRI planned | Right |

## Claims verified against code (they hold)

- Envelope:
  - The domain strings `x2f/envelope/v1\0`, `x2f/relay-join/v1\0`, `x2f/attestation/v1\0`, `x2f/trade-identity/v1\0`, `x2f/proof/v1\0` and `x2f/login-name\0`.
  - Padding 0x80 into the buckets 256/1024/4096/16384/65536.
- Escrow:
  - `THRESHOLD = 2`, monero-ts 0.11.16.
  - `checkTxSet`: one tx, fee > 0 and ≤ `MAX_NETWORK_FEE` = 0.01 XMR, no change, unlock time 0, inputs = balance, exact outputs with output 0 short by the fee, inputs = outputs + fee.
  - `FINAL_ALERT_MS` = 15 min, plus `AUTO_REFUND_MARGIN_MS`. The API supplies only brakes; the refund uses the seller-signed address.
- Keystore:
  - The moderation keystore has an HKDF subkey `x2f/mod/wallet` for wallet secrets, in its own table, and 32-byte wallet passwords.
  - The device's escrow and wallet secrets sit in IndexedDB under a non-extractable AES-256-GCM key, with 32-byte random passwords.
- Logins:
  - Argon2id 64 MiB, t=3, over HMAC-SHA-256 under a pepper; the leaked-password list is on X2F's own server.
  - PGP code: 12 Crockford base32 characters (60 bits), 5-minute TTL, SHA-256 stored, decoy for unknown keys, only `start` rate-limited.
  - Key types: RSA ≥ 4096, Ed25519, Ed448.
  - WebAuthn: origin and RP ID checked, user verification required for passkeys.
- Retention: chat 30 days, 90 days after the dispute closes (`dispute_closed_at`), pre-trade chats after 7 idle days, addresses after 90 days. The purge runs as the `x2f_purge` role.
- Server: request logging is disabled (`disableRequestLogging: true`). The CSP is exactly as described (`cspFor`). No secret crosses postMessage (worker.ts).
- Proofs: the PNG and JPEG allowlists (SOF0-2), the unblurred re-encode to JPEG checked for Exif/XMP, and XChaCha20-Poly1305 with SHA-256 of the plaintext.
- Other: the repository has no LICENSE file (the NLnet draft says so correctly).

## Owner questions

None new. The grant amounts, the proposer's identity and the licence are already marked [OWNER] in the drafts. C1's wording is for the lead to fix, not an owner choice, because it is a factual correction.

## Re-verify d7fbdbdb

Reviewer: independent helper, read-only. Fix commit d7fbdbdb (one commit over d902281a) in worktree crypto-spec; origin/wip/lead-crypto-spec equals HEAD. Files read at head: docs/public/x2f-crypto-spec.md (287 lines), docs/grants/monero-ccs.md, nlnet.md, otf-red-team-lab.md. Docs only, no tests.

**Verdict: APPROVED.** All ten findings are closed. One optional item left as it was (the env var name, see "Not a finding").

- **C1 closed.**
  - Spec l.13 now says no X2F server alone, and neither the API nor the relay with one trader, can move coins. It says the moderation service holds one share, and that its share plus any one trader's share is the threshold. If the service is compromised and the attacker is a party or colludes with one, that trade's escrow is at risk.
  - Spec l.113 says the refund-only rules bind an honest service, not a compromised one. Spec §9 item 1 (l.259) is added.
  - CCS l.17, NLnet l.25 and l.28, and OTF l.26 and l.29 now say "the API or relay cannot" or "alone cannot", each followed by the same plain statement of the limit.
- **C2 closed.** CCS l.28 and NLnet l.50 now say "Today ... only two automatic refunds ... Its key never signs alone: it always co-signs with a trader. Dispute rulings (planned) ... will require a staff security-key signature." No "act alone" remains in the grants. Spec l.59 and l.113 say the same.
- **C3 closed.** Spec l.95: "On a release, the fee output is exactly 1% of the trade. Cancels and refunds ..." (the sentence continues with the no-fee statement).
- **C4 closed.** Spec l.233: "For disputed trades the 90 days count from the dispute closing (owner ruling, 2026-11-09)." The table at l.222 agrees.
- **C5 closed.** Spec l.34 and l.211 say user IDs are stripped only from v6 keys and that v4 keys keep theirs, which often hold a real name and email. Spec l.15 adds that a pasted key may carry a name or email. The grant lines "does not identify" (NLnet l.26, OTF l.27) are left as they were and stay true, because the database is encrypted.
- **C6 closed.**
  - Proofs: NLnet l.16 and OTF l.16 now say "(library built, not yet wired into the app)". CCS l.58 says the library is built but not wired.
  - Deletion: CCS l.20 and OTF l.17 say chats and addresses are deleted on a schedule and whole-trade deletion is being built. CCS l.59, NLnet l.61 and OTF l.54 say it is not built.
- **C7 closed.**
  - The "every recent P2P venue has closed or been attacked" sentence is gone (CCS "Why this matters" l.22-26 no longer has it).
  - The RetoSwap/Haveno causal claim is gone from CCS and NLnet. A grep for RetoSwap and Haveno finds only NLnet l.45, which is now an [OWNER/CITE] placeholder saying the designs are not verified from the repository.
  - CCS l.12 carries "[CITE: link to LocalMonero's closure notice]". That link is a placeholder for the owner to fill.
- **C8 closed.** Spec l.214: "TOTP cannot be an account's only login method; used alone it is a weak login, and security changes then wait 24 hours."
- **C9 closed.** Spec l.34 and l.215 say login names are held as HMAC tags, or sealed while a sign-up waits in its challenge (`login-seal` subkey).
- **C10 closed.** Spec l.108 is now a labelled "Assumption for the auditor" about wallet2 binding the decoded destinations to the signed transaction, and §9 item 8 (l.266) lists it as not yet verified for monero-ts 0.11.16.

Not a finding: `MOD_KEYSTORE_KEY` still appears three times in the spec (l.36 and l.163, and one more in the same area). It is a name, not a value; the first review called it acceptable and optional. The owner may still prefer "the keystore key".

Placeholders still open for the owner before sending (marked in the drafts, not review findings): LocalMonero closure link (CCS l.12), Haveno/Bisq comparison (NLnet l.45), grant amounts, proposer identity, licence.
