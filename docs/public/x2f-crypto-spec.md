# X2F cryptography and escrow: specification for review

Version: draft of 2026-11-09, written from the code at `main` 0c6f3f16. It describes what the code does today and marks what is only planned. Corrections are welcome; see the appendix for where each claim lives in the code.

X2F is a peer-to-peer marketplace for trading Monero (XMR) for fiat money. Buyer and seller agree a trade, the seller locks the XMR in a per-trade 2-of-3 multisig escrow, the buyer pays fiat outside X2F, and the escrow is released. A moderator steps in only on a dispute.

Status words used below: **built** (on `main`, with tests), **partly built** (library on `main`, not yet wired end to end), **planned** (designed, not on `main`).

## 1. Threat model

What we try to protect:

- **Coins.** No X2F server alone can move escrowed coins, and neither can the API or the message relay together with one trader. The moderation service is different: it holds one of the three key shares, and its share plus any one trader's share is the 2-of-3 threshold. If the moderation service is compromised and the attacker is also a party to a trade, or colludes with one, that trade's escrow can be moved. The moderation service's own rules (3.4) bind it only while it runs honest code. This is inherent in 2-of-3 escrow with an arbitrator key. It is why the moderation service is a separate process with its own database and holds nothing beyond what section 2 lists, and why we are seeking an external audit (section 9). Running it as its own system user on its own host is **planned**.
- **Trade content.** Chat, payment proofs and payout addresses should not be readable by the network, the message relay, or anyone who copies X2F's API database.
- **Identity.** X2F asks for no name, email or phone. Login names should not be recoverable from a stolen database. A PGP key a user pastes may still carry a name or email in its user IDs (section 2).

Attackers we consider:

| Attacker | Assumed ability |
|---|---|
| Network observer | Sees and changes traffic. TLS is assumed; Tor users also hide their IP. |
| Message relay | Sees, drops, reorders and replays every escrow and signal message. |
| API server or its database | Full control of the API process and database. |
| Moderation service | Holds the moderator's escrow key and chat identity for each trade. Together with one trader it reaches the 2-of-3 threshold (section 1, Coins). |
| One trader | Controls its own app and keys, and may lie or send malformed data. |
| Web origin | Whoever controls the web server can change the app's code (section 8). |

Out of scope: a compromised trader device, the fiat leg of the trade (X2F never sees money move), and attacks on Monero itself.

## 2. What X2F holds and what it never holds

X2F runs two separate services with separate databases. The **API** (accounts, trades, chat storage) has no access to the **moderation service**'s database.

**The API holds:** accounts (login names only as HMAC tags, or sealed while a sign-up waits in its challenge, section 6; display names); public keys and WebAuthn credentials; PGP public keys, encrypted at rest (v4 keys, which are most keys in use, keep their user IDs, which may contain a name or email); password hashes; encrypted TOTP secrets; trade records, including both payout addresses until they are cleared (section 7); chat envelopes as ciphertext; and the public keys of each trade's participants.

**The moderation service holds, per trade:** the moderator's trade identity (Ed25519/X25519), its escrow wallet session (its one multisig key share), and that wallet's password. Per chat, it holds the moderator's chat identity. It also holds the long-term **moderation signing key**, whose public half is built into the apps. All of this is sealed with AES-256-GCM under `MOD_KEYSTORE_KEY`, with the trade or chat code as associated data. The wallet password is sealed under a separate HKDF subkey, in a separate table from the wallet session.

**X2F never holds:**

- a buyer's or seller's escrow key share, or their trade or chat identity secret keys (these are made and kept on the trader's device);
- users' coins, or any wallet for users' coins (only X2F's own 1% fee wallet, whose address is built into the app);
- users' PGP private keys (X2F never generates them);
- the plaintext of chat or proofs, on the API.

**Caveat on that last point:** the moderation service can decrypt every chat today (section 4).

## 3. Escrow

**Status: built** for normal release, mutual cancel, lapse refund, buyer cancel and the buyer no-show refund. **Planned** for moderator rulings: on `main`, `verifyRuling` refuses every ruling, so the moderation service cannot yet co-sign a dispute payout.

### 3.1 Keys

Each trade gets a fresh Monero 2-of-3 multisig wallet (monero-ts 0.11.16, `THRESHOLD = 2`). It has three key shares, one each for:

- the **buyer**, made in the buyer's browser (escrow worker);
- the **seller**, made in the seller's browser;
- the **moderator**, made by the moderation service.

**X2F holds at most one share per trade, the moderator's.** No server holds a second share. The moderator's share never signs alone: it always co-signs with a trader (table below), and that pair is the threshold (section 1). On the device, the trader's share and the wallet password sit in IndexedDB, wrapped by a non-extractable WebCrypto AES-256-GCM key. Per-trade wallet passwords are 32 random bytes, never a user password. **Planned:** a backup of the device share encrypted to the user's own PGP key.

| Outcome | Builder | Co-signer |
|---|---|---|
| Release | seller | buyer |
| Mutual cancel | buyer | seller |
| Lapse refund (underfunded) | seller | buyer |
| Buyer cancel | buyer | moderation service (automatic) |
| Buyer no-show refund | seller | moderation service (automatic) |
| Dispute ruling (planned) | moderation service | the winning trader |

### 3.2 Who is in the trade: the attestation

Before funding, the moderation service signs an **attestation** with the moderation signing key (Ed25519, domain `x2f/attestation/v1\0`, over canonical JSON). It names:

- the three participants' public keys;
- the trade's relay channel IDs;
- the deal fixed at take (amount, poster, currency, locked rate, offer maximum);
- the buyer's payout address and the seller's refund address.

The moderation service checks each trader's proof of possession itself (an Ed25519 signature over `x2f/trade-identity/v1\0` + code + role + keys); it does not take the API's word for it. It also mints the moderator identity itself, so the API cannot choose the moderator key.

Each trader app verifies the attestation against the moderation key built into the app. It refuses the attestation unless all of these hold:

- its own slot holds both of its own keys;
- the trade code matches;
- the channel set is exact;
- the deal and its own address equal what its user confirmed on the device.

A relay or API that swaps a participant, an address or the amount is caught before any coins are sent.

Escrow setup and signals (`trade.terms`, `trade.paid`, `trade.cancel`, and so on) travel through the relay as sealed envelopes (section 4.2). Each trader states its own address in a signed `trade.terms` signal. Relay channel IDs are HKDF-SHA-256 of the trade code, so the relay never sees the trade code. To join a channel, a party signs `x2f/relay-join/v1\0` + channel + role + a fresh 32-byte challenge. During setup, every message echoes digests of the previous round's messages, so a party that sends different content to different peers is caught (`equivocation`). All three parties must confirm the same multisig address.

### 3.3 How a payout is built and checked

1. Each party reads the escrow's balance itself and acts only when the whole balance is unlocked (balance = unlocked).
2. Every party computes the payout list with the same pure function (`payoutsFor`), from the attested deal, the addresses signed in `trade.terms`, the fee wallet built into the app, and that balance. The list always sweeps the whole balance. Output 0 bears the network fee. On a release, the fee output is exactly 1% of the trade. Cancels and refunds have no fee output: every refund sweeps the whole balance to the seller. Of the planned dispute payouts, the one a seller wins on a buyer's ad has no fee output either. Any surplus goes to the seller.
3. A trader app settles only an outcome whose payout list is exactly one of the shapes its role may settle (`cosignPolicy`): same order, same addresses, same amounts.
4. The builder makes the multisig transaction set. Before signing, the co-signer decodes it and checks it with `checkTxSet`. It fails closed unless all of these hold:
   - the set holds exactly one transaction;
   - there is **no change output**, because change could hide a payment to the builder;
   - the unlock time is zero;
   - the network fee is above 0 and at most 0.01 XMR;
   - the inputs equal the escrow balance;
   - the outputs are exactly the expected addresses with exactly the expected amounts, output 0 short by exactly the fee;
   - inputs = outputs + fee.

   Nothing is signed if any check fails.

   **Assumption for the auditor:** `checkTxSet` reads the destinations that monero-ts (wallet2) decodes from the multisig transaction set. The check is only as good as wallet2 binding those decoded destinations to the transaction it then signs. We understand that wallet2 rebuilds the transaction from its construction data when signing, but we have not verified this for the monero-ts 0.11.16 path.
5. A party commits to one outcome once a transaction set has been built or accepted for it, and cannot then be switched to another.

### 3.4 The moderator's limits

These rules are code the moderation service runs on itself: they bind an honest service, not a compromised one (section 1). The moderator's share never signs alone; it co-signs with a trader. Today, until rulings land, the moderation service co-signs without a human only in the two automatic cases. Both pay **one output of the whole balance to the seller's refund address, as the seller's own identity signed it in `trade.terms`**. The API's copy of the address is never used. Any other destination is refused (`wrong-destination`), and the co-sign check in 3.3 still applies.

- **Buyer cancel.** The moderation service must itself have opened a valid `trade.cancel` sealed by the buyer's trade identity. It refuses once it has seen a valid `trade.paid` from the buyer.
- **Buyer no-show refund.** All of these must hold:
  - the payment window has passed;
  - the buyer never marked paid;
  - the final alert went out at least 15 minutes ago, plus a margin;
  - the buyer's app confirmed it showed the alert;
  - the API agrees that the trade is `refund_requested`.

  The moderation service keeps its own "shadow" copy of the trade state, fed by its own watcher and the signals it opened. The API's state can only stop a refund; it can never start one. Unclear cases escalate to a person.

**Planned (Plan 4):**

- A ruling must carry a staff member's hardware-security-key signature, checked inside the moderation service.
- Rulings above a set amount need two approvers.
- A ruling pays only the fixed `dispute-buyer` or `dispute-seller` payout list.
- The winning trader's app co-signs only that exact list, paying its own address.

## 4. Chat

**Status: built.** Messages, sealing and storage are on `main`. On `main` no staff screen decrypts chats yet. **Planned:** per-trade membership keys (4.4).

### 4.1 Primitives (libsodium-wrappers 0.8.4)

- `crypto_sign` (Ed25519) for identities and signatures. Each identity's X25519 box key is derived from its Ed25519 key, and that link is checked.
- `crypto_secretbox_easy` (XSalsa20-Poly1305) for the message body, under a fresh 32-byte key K per message.
- `crypto_box_easy` (X25519 + XSalsa20-Poly1305) to wrap K for each recipient.
- `crypto_generichash` (BLAKE2b-256) for the key hash `kh`.
- `randombytes_buf` for every key and nonce.

Each trader has a **separate chat identity per chat and role**, made on the device and registered with a proof signed over `chatIdentityProofBytes`. The moderation service mints a moderator chat identity per chat and signs a chat attestation naming all three public keys.

### 4.2 Envelope format (v1, shared with escrow signals)

```
{ v: 1, trade, from, seq, slots: {buyer, seller, mod}, nonce, kh, ct, ctNonce, sig }
```

- **Plaintext.** Canonical JSON `{type, payload}`, padded (0x80, then zeros) to the smallest of 256, 1024, 4096, 16384 or 65536 bytes. For chat, `type` is `chat.msg` and the payload is exactly `{text}`.
- **`ct`.** `secretbox(padded, ctNonce, K)`.
- **`slots`.** All three roles are always present. Each recipient's slot holds `box(K, nonce, recipientBox, senderBoxSecret)` (48 bytes); a non-recipient's slot holds 48 random bytes. The relay cannot tell who can read a message.
- **`kh`.** `generichash(32, K)`. It is signed, so every recipient provably decrypts the same plaintext.
- **`trade`.** For chat, this is the chat's channel ID, so an envelope cannot be moved to another chat or channel.
- **`sig`.** Ed25519 by the sender over `"x2f/envelope/v1\0"` + canonical JSON of every other field.
- **Opening order.** A reader checks, in order: exact shape and canonical encodings, signature, unwrap, `kh`, decryption, canonical plaintext, and finally replay. The replay check keeps a strictly increasing `seq` per sender and is committed only after everything else succeeds.
- **What the API checks.** The API checks only the shape, the channel and that `from` matches the session's role. It cannot check signatures or content.

### 4.3 Who can read what, and when

Updated 18 Nov 2026 for the chat membership keys (4.4) and the device retention change. Each chat has one key, TK, made on a trader's device. At first TK is stored only as wraps to the buyer and the seller; after a grant (4.4) it is also stored as wraps to the moderation service and to each certified staff device that reads. Every chat message is an envelope v2 under TK. Once a chat has a key, the API takes no v1 chat message except the unblurred proof copy a moderator asks for (below, lead decision 16), and no trader's app opens one.

- **The network, the relay, and anyone with only the API database:** cannot read chats.
- **The moderation service:** can decrypt a chat only after a trader's app has granted it TK, which happens when a dispute opens (4.4). It holds nothing that opens an undisputed chat. The one exception is the unblurred copy of a payment proof that a moderator asks a trader for during a dispute: the app seals that copy to the moderation service's key alone, never under TK (lead decision 16, `docs/security/chat-membership-lead-decisions-2026-11-18.md`).
- **"A moderator reads only after a dispute" is enforced by the key**, not only by staff procedure: before a grant, no X2F server holds TK. Every grant and every staff read is logged.
- **Device copies.** The trader's device keeps its chat identity and its read receipts in IndexedDB (`x2f-chat`), wrapped by a non-extractable AES-256-GCM key. It keeps no message text and never TK. Its record is erased when the API reports the chat purged.

### 4.4 Planned: per-trade membership keys

This is the design note of 2026-11-08. **Built** with the chat membership branch (`wip/lead-mod-chat`, with tests; the builder's and the lead's calls are in `docs/security/chat-membership-lead-decisions-2026-11-18.md`).

- Each chat gets one random key TK, made on a trader's device. TK is stored only as `crypto_box_seal` wraps, one per member. At the start the only members are the buyer and the seller.
- Messages become envelope v2: `crypto_aead_xchacha20poly1305_ietf` under TK, with the channel, sender and seq as associated data, Ed25519-signed. TK's fingerprint `tkh` is checked once per chat.
- **The moderation service receives a wrap of TK only when a trader's own app grants it.** That happens on the trader's own signed dispute request, or on a moderation-signed dispute notice that the API also confirms.
- Moderation then re-wraps TK to the assigned moderator's staff device key, which that person's security key has certified. Every grant and read is logged, including in an access record that the API cannot write.
- So "only after a dispute" is enforced by cryptography for undisputed chats. A backup of an undisputed chat holds nothing X2F can open.

Known limits of the design:

- The API and the moderation service together could fake a dispute, but both traders' apps would show it.
- There is no forward secrecy, on purpose: a moderator must be able to read the whole history.
- Removing a member does not rotate TK.

## 5. Proof images

**Status: partly built.** The library (`packages/proof`) is on `main`. The web app's upload pipeline is not wired yet (`NEEDS_PLAN_5` in `screens/dispute/seams.tsx`).

- **Metadata stripping on the device.** Allowlists, not blocklists:
  - PNG keeps only `IHDR`, `PLTE`, `IDAT` and `IEND`.
  - JPEG keeps only `SOI`, `DQT`, `DHT`, `SOF0`–`SOF2`, `DRI`, `SOS` with its scan data, and `EOI`. Everything else, and any bytes after the end marker, is dropped.
  - Malformed files are refused.
  - The unblurred copy a moderator may request is drawn again on a canvas and saved as a fresh JPEG. Its output is scanned for Exif and XMP and refused if any remain.
- **Automatic masking on the device.** OCR words are scanned for names, account, card and IBAN numbers, addresses, phone numbers, emails and handles.
  - Masked regions are **replaced, not blurred**: each becomes its mean colour plus a fixed position-only texture, so nothing of the original glyphs survives.
  - The trade amount is never masked.
  - The uploader sees the result and can add masking by hand, but never remove automatic masking.
  - Detection is best effort.
- **Encryption.** Each image is encrypted with a fresh 32-byte key under XChaCha20-Poly1305. The associated data is `"x2f/proof/v1\0"` + trade code + proof id + kind, and a SHA-256 of the plaintext is checked after decryption. The key travels inside a sealed chat envelope, and the API stores only ciphertext.

## 6. Logins

**Status: built** (Plan 2).

- **PGP challenge.**
  - The user pastes a public key; no name is needed. X2F encrypts a message to that key holding a one-time code: 12 Crockford base32 symbols (60 bits) from the OS random generator, single use, valid for 5 minutes.
  - The decrypted message names the site, its host, the purpose and the time. It is signed with the official X2F PGP key, whose fingerprint is published.
  - An unknown key gets a decoy of the same shape, so the page does not reveal whether an account exists.
  - The server stores only SHA-256 of the code. Only asking for codes is rate-limited, not guessing.
  - Accepted keys are RSA 4096+, Ed25519 and Ed448. They are stored encrypted (AES-256-GCM). User IDs are stripped only from v6 keys, and only where the key survives it. v4 keys, which are most keys in use, are stored whole, with their user IDs, which often hold a real name and email.
- **Passkeys and security keys.** WebAuthn through SimpleWebAuthn, with origin and RP ID checks. Passkeys require user verification.
- **Passwords.** Argon2id (64 MiB, t=3) over HMAC-SHA-256 of the password under a server-side pepper, checked against a leaked-password list kept on X2F's own server.
- **TOTP.** Secrets are sealed under separate keys. TOTP cannot be an account's only login method; used alone it is a weak login, and security changes then wait 24 hours.
- **Login names.** Stored only as HMAC-SHA-256 under a server key (`x2f/login-name\0` + the lower-cased NFC name). While a sign-up waits in its login challenge, the challenge keeps the login name sealed with AES-256-GCM under a server subkey (`login-seal`), never as plaintext. A stolen database alone does not reveal them. The display name is separate and public.

## 7. Retention

| Data | When it is deleted (on `main`) |
|---|---|
| Chat of a trade with no dispute | 30 days after the trade closes |
| Chat of a disputed trade | 90 days after the dispute closes (never while a dispute is open) |
| Chat that never became a trade | after 7 idle days |
| Payout and refund addresses on a trade | 90 days after the trade closes |

How deletion works:

- Chat deletion removes the envelopes, identities and attestation by cascade, as a restricted database role.
- **Not built yet:**
  - deleting the whole trade record at 30 days, which the published rule calls for;
  - deleting the moderator's chat identity and attestation from the moderation database;
  - erasing device copies.
- For disputed trades the 90 days count from the dispute closing (owner ruling, 2026-11-09).
- Backups may hold ciphertext for their own retention window.
- The API turns off request logging. The policy is to log no IP addresses.

## 8. The web app's code comes from the server

X2F is a web app. Its JavaScript is served by X2F's own origin, and the browser runs whatever that origin serves. **A compromised or coerced origin can serve code that sends keys or plaintext elsewhere, and none of the cryptography above prevents that.** This is the main structural weakness of any web wallet.

What reduces it today:

- a strict Content Security Policy: scripts only from the origin itself (plus WebAssembly), `connect-src` limited to the origin, the relay and the node proxy, and no framing;
- no third-party scripts;
- pinned dependencies;
- secrets held only inside a dedicated worker, never passed over `postMessage`.

**Planned:**

- a Tor onion address for the web app (not yet allowed by the server's origin checks);
- signed, reproducible native apps (Android first; the web app stays the main way in), so code is fixed at install and can be checked against the published source;
- nudging large trades toward the native app;
- Subresource Integrity on every asset.

An onion address protects users' network location and removes the certificate authorities from the picture. It does not stop the operator from changing the code. Only signed, reproducible native builds do that.

## 9. Known gaps, in one place

1. A compromised moderation service together with one trader reaches the 2-of-3 threshold and can move that trade's escrow; its refund-only rules (3.4) bind only an honest service (section 1).
2. Every chat is readable by the moderation service today (4.3). The fix is 4.4.
3. Moderator rulings are not built. Dispute payouts are refused (3.4).
4. The proof pipeline is not wired into the web app (5).
5. Whole-trade deletion at 30 days, moderation-side chat deletion and device erasure are not built (7).
6. Web-delivered code (8). The onion address, native apps and SRI are not built.
7. Monero multisig is labelled experimental upstream, and the FCMP++ upgrade will change it. The escrow sits behind one interface (`EscrowEngine`) so it can be swapped.
8. The transaction-set check relies on wallet2 binding the decoded destinations to the signed transaction; not yet verified for monero-ts 0.11.16 (3.3).
9. No external audit has been done yet.

## Appendix: where each claim lives (paths from the repository root)

- Envelopes, padding, slots, signature, replay: `packages/protocol/src/envelope.ts`, `replay.ts`, `payload.ts`, `identity.ts`, `join.ts`
- Attestation, identity proofs, attested terms: `packages/trade/src/attestation.ts`, `channels.ts`, `signals.ts`
- Payout lists and sweep minimums: `packages/trade/src/payouts.ts`
- Transaction-set checks: `packages/escrow/src/verify.ts` (`checkTxSet`, `MAX_NETWORK_FEE`)
- Automatic refund rules: `packages/escrow/src/autoRefund.ts`, `apps/moderation/src/autoRefund.ts`, `apps/moderation/src/buyerCancel.ts`
- Party protocol, equivocation, outcome lock: `packages/escrow/src/party.ts`; multisig engine: `packages/escrow/src/monero.ts`
- Ruling verifier (refuses all): `apps/moderation/src/rulings.ts`
- Moderation keystore and schema: `apps/moderation/src/keystore.ts`, `apps/moderation/src/attest.ts`, `apps/moderation/migrations/001_mod.sql`, `002_chat.sql`
- Trader co-sign policy: `apps/web/src/escrow/policy.ts`; device stores: `apps/web/src/escrow/store.ts`, `apps/web/src/chat/store.ts`
- Chat sealing: `apps/web/src/chat/chatCrypto.ts`; API chat checks: `packages/trade/src/chat.ts` (`checkChatEnvelope`), `apps/api/src/chat/routes.ts`
- Relay join check: `apps/relay/src/server.ts`
- Retention: `packages/trade/src/chat.ts` (`CHAT_*_DAYS`), `apps/api/src/chat/retention.ts`, `apps/api/src/trades/purge.ts`, `apps/api/src/retentionJobs.ts`
- Proofs: `packages/proof/src/clean.ts`, `detect.ts`, `redact.ts`, `seal.ts`; `apps/web/src/proof/reencode.ts`
- Logins: `apps/api/src/auth/pgp.ts`, `packages/accounts/src/loginCode.ts`, `packages/accounts/src/pgp.ts`, `apps/api/src/auth/webauthn.ts`, `apps/api/src/auth/password.ts`, `apps/api/src/auth/totp.ts`, `apps/api/src/accounts.ts` (`loginTag`, `sealNames`), `apps/api/src/config.ts` (`subkey`)
- CSP and origins: `apps/api/src/static/serve.ts` (`cspFor`); request logging: `apps/api/src/app.ts`
- Design background: `docs/superpowers/specs/2026-10-14-x2f-design.md` sections 3, 4 and 6; `docs/security/research-2026-10-15-escrow-threats.md`
- Planned membership keys: the design note "Trade chat: one key per trade, with members" (2026-11-08), not yet published in this repository
