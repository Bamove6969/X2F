# Trade chat crypto: Matrix/Megolm or not? (research, 2026-11-08)

Security-architect research for the lead. Read-only: no code was changed. Code read at `origin/main` (fetched 2026-11-08).

## Answer in short

**Recommendation: do not adopt Matrix or Megolm.** The build already has E2E chat with a per-chat moderator key, and it is in some ways stronger than Megolm: every message is padded to a fixed size bucket, there is no plaintext room state, and there is no server that keeps a membership graph. The two things the owner wants that it lacks are:

1. later staff can read the history, with a log entry;
2. crypto-shredding when the trade closes.

Both are small changes to the moderation service: about 2 to 3 weeks of work together, against roughly 2 to 4 months for any Matrix path. Megolm would add almost nothing for this threat model.

- **Forward secrecy.** Megolm has none for anyone holding the session from index 0. The owner's rule that "a moderator can read the whole chat" rules forward secrecy out by design anyway.
- **Multi-device.** This is the one real gap. It can be solved in-house more cheaply than with Olm/Megolm.

One correction to the brief: on `main` the moderator **cannot read chats yet**. The moderation service makes and keeps a moderator chat identity per chat and signs the attestation. The read path is **planned** in Plan 4 Task 11 (`POST /internal/chat/read`), and that plan has the moderation service decrypt and hand **plaintext** to the API. My main suggestion changes that plan: hand **wrapped keys** to owner-certified staff device keys instead.

---

## 1. What exists today (verified in code)

| Piece | Where | What it does |
|---|---|---|
| Envelope seal/open | `packages/protocol/src/envelope.ts` | Canonical JSON padded to buckets of 256/1K/4K/16K/64K. Encrypted once with `crypto_secretbox` under a fresh 32-byte key K per message. K is wrapped per role (buyer, seller, mod) with `crypto_box`, from the sender's static X25519 key to the recipient's. All three slots are always present, with random bytes for non-recipients. `kh = generichash(K)` is signed, so every recipient decrypts the same text. Ed25519 detached signature, domain-separated. Strict canonical decoding. |
| Replay/order | `packages/protocol/src/replay.ts`, `apps/web/src/chat/chatCrypto.ts` | Per-sender increasing `seq` with a ReplayGuard, persisted before a message is shown or posted. |
| Chat binding | `apps/web/src/chat/chatCrypto.ts` | The envelope `trade` is `channelFor(chat,'chat')`, covered by the signature. The payload is exactly `{text}`. Hidden and bidi characters are refused. Every message goes to buyer, seller and mod. A mod message is shown only while a dispute is open. |
| Engine | `apps/web/src/chat/engine.ts` | Runs in the escrow worker, so secret keys never reach the page. **One chat identity per chat per device**: a second device is read-only (`other-device`). Participants come only from the moderation attestation, checked against the pinned moderation signing key, never from the API. |
| Server storage | `apps/api/migrations/106_chat.sql` | Ciphertext only (`chat_envelopes`), trader public keys with proofs, the attestation. Purge runs as `x2f_purge` and cascades. |
| Retention | `apps/api/src/chat/retention.ts`, `packages/trade/src/chat.ts` | `CHAT_AFTER_CLOSE_DAYS = 90`. The owner rule is 30 days for undisputed trades and 90 from the dispute button for disputed ones (R36). This is already tracked as pending in `docs/coordination.md` (review M4). |
| Mod chat keys | `apps/moderation/migrations/002_chat.sql`, `apps/moderation/src/keystore.ts` | `mod_chat_identities`: one moderator identity **per chat**, sealed with AES-256-GCM under `MOD_KEYSTORE_KEY`, with the chat code as AAD. It lives in the moderation DB, which the API role cannot read. |
| Proof images | `packages/proof/src/seal.ts`, `payloads.ts` | Per-image XChaCha20-Poly1305 key with AAD bound to trade, proof id and kind. **The key travels inside a sealed chat envelope**, so the proof pipeline rides on the chat crypto. |
| Planned mod read | Plan 4 Task 11 | Staff `POST /staff/v1/disputes/:code/chat` appends `chat.read`, then calls the moderation internal socket (HMAC, log entry under 60 s old, single use). The moderation service **decrypts and returns plaintext** to the API, which passes it to staff-web. The plan accepts as a residual that "chat access is enforced by rule and log, not by cryptography" (spec 6.6). |

**Gaps found while reading** (independent of Matrix):

- **G1. Mod chat identities are never deleted.** No `delete from mod_chat_identities` or `signed_chats` exists anywhere in `apps/moderation`. A purged chat's ciphertext survives in the API DB's WAL-G backups (14 days), and the moderation DB still holds the per-chat key that opens its mod slot. So today a deleted chat is **not** shredded: one API backup plus the moderation DB (or its key) recovers it.
- **G2. The device copy is never deleted.** `ChatStore.delete` has no caller (coordination M4c, owed). The trader's chat identity and decrypted lines stay on the device after the purge.
- **G3. Retention is 90 days, not the owner's 30.** Already tracked.
- **G4. Plan 4 Task 11 sends plaintext through the API.** The API also writes the activity log entry that the moderation service checks. So a compromised API can write a `chat.read` entry and read any disputed chat. Logging still happens, but only in a log the attacker controls.

## 2. The options, with effort, pieces and timeline

Estimates assume the current way of working (AI workers with lead review, security review per task) and include re-review. Each is a rough range, not a commitment.

### Option A: our own Matrix homeserver, custom UI (matrix-rust-sdk / matrix-sdk-crypto-wasm)

**Pieces:**
- A homeserver: Synapse (Python, Postgres, workers) or Conduit/continuwuity (Rust, embedded RocksDB). Federation off, public registration off, accounts provisioned from X2F through an application service or the admin API, served on the onion too.
- A Matrix account and device per trader per chat. Pseudonymous IDs, so that login names never leak.
- A moderator bot in `apps/moderation` using matrix-rust-sdk: one Olm device per chat or one shared device.
- Room creation per trade, with power levels and history visibility.
- Device trust. Matrix cross-signing is not our trust root. We would have to pin device keys via our own attestation, a custom layer on top of standard Matrix.
- Staff join with history. Room-key forwarding or the newer "share history on invite" work in matrix-rust-sdk. **I could not confirm its stability, so verify before relying on it.**
- Key backup: turned off, or a custom one.
- Retention and purge: room purge admin API, redactions, client store wipes.
- Proof-key delivery moved to Matrix events.
- System cards (amounts, memos) as signed events.
- Our UI on matrix-js-sdk or the WASM crypto.
- An SRI and reproducible-build story for a multi-MB WASM blob.
- Two parallel crypto stacks: escrow signals stay on `@x2f/protocol`.

**Effort:** roughly 10 to 16 weeks to parity with what exists, plus ongoing homeserver operations and upgrades (Matrix had "high severity" protocol fixes in August 2025 that needed room upgrades; [The Register](https://www.theregister.com/2025/08/13/secure_chat_darling_matrix_admits/)).

**Net:** a large new surface for features we mostly have.

### Option B: vodozemac/Megolm only, inside our own stack (no homeserver)

**Pieces:**
- WASM bindings for vodozemac. It is pure Rust and compiles to wasm32, as `matrix-sdk-crypto-wasm` shows. Writing our own `wasm-bindgen` layer means a Rust toolchain in a TypeScript monorepo, plus SRI for the WASM blob.
- Megolm outbound sessions per sender per chat. Session keys are distributed **inside our existing seal envelopes** (instead of Olm).
- Ratchet state persisted in the escrow worker. Session rotation rules.
- Re-sharing a session from index 0 to the moderator and to later staff.
- Moving proof-key payloads onto Megolm.
- New padding: Megolm does not pad, so we would have to keep our bucket padding on top.

**Effort:** roughly 4 to 7 weeks.

**What it buys:** "send one key per session, not per message" (irrelevant at chat volume) and a forward-only ratchet that gives nothing against the moderator, who must hold index 0 anyway. **It is not worth it.**

### Option C (recommended): keep `@x2f/protocol`, add re-wrap to staff and shredding

1. **Shredding (G1, G2, G3):**
   - The moderation service deletes `mod_chat_identities` and `signed_chats` rows for chats the API has purged. It needs either a signed "chat purged" list over the internal link, or its own retention check from trade facts it already receives.
   - The engine deletes the device record when the chat answers 404.
   - The 30/90-day rule.
   - **About 3 to 5 days.**
   - Optional, stronger: seal each per-chat mod identity under a per-week **epoch key** held in the vault, and destroy epoch keys after the backup window. A restored moderation DB backup then cannot open purged chats either. **About 1 week.**
2. **Later staff see history, logged, end to end (replaces Task 11's plaintext path):**
   - Each staff device has an X25519 key **certified through the owner-rooted key chain** that Plan 4 already builds for ruling approvals, so the API cannot add its own key.
   - On `chat.read` with a valid fresh log entry, the moderation service opens each envelope's mod slot. That needs only the mod box secret and the sender's attested public key. It then re-wraps K to that staff key with `crypto_box_seal` (or a signed `crypto_box` from the mod identity) and stores one grant per envelope with the log entry id. It also writes its own copy of the access record, so the log does not depend only on the API.
   - Staff-web fetches ciphertext plus grants and decrypts in a worker. The API never sees chat plaintext.
   - Grants are deleted with the chat, and `kh` lets staff verify that each grant opens the signed message.
   - **About 1.5 to 2.5 weeks** including review. If time is short, ship Task 11 as written and do this as a follow-up; the data model is compatible.
3. **Multi-device for traders (optional):**
   - Either add per-device box keys under a role (slots become a list per role; envelope v2), or move the chat identity between a user's approved devices over the existing device-approval flow (Plan 2).
   - **About 1 to 2 weeks.**
   - This is the only real Matrix-style feature still missing.

## 3. Customisation: can it look 100% like X2F?

- **Option A:** yes, if we use matrix-rust-sdk (server/native) or `matrix-sdk-crypto-wasm` / matrix-js-sdk (browser) with our own React UI. No Element code is needed.
  - Matrix concepts still leak into the product: device verification, "unable to decrypt" states, key backup prompts, room state. We would have to hide or re-design all of them.
- **Option B:** yes, fully. There is no Matrix UI concept at all.
- **Option C:** already 100% X2F.

## 4. Licences

| Component | Licence | Notes |
|---|---|---|
| vodozemac | Apache-2.0 | [repo](https://github.com/matrix-org/vodozemac). Fine for closed source; keep the NOTICE. |
| matrix-rust-sdk (incl. matrix-sdk-crypto) | Apache-2.0 | [repo](https://github.com/matrix-org/matrix-rust-sdk) |
| @matrix-org/matrix-sdk-crypto-wasm | Apache-2.0 | WASM/JS bindings of matrix-sdk-crypto ([README](https://cdn.jsdelivr.net/npm/@matrix-org/matrix-sdk-crypto-wasm@18.0.0/README.md), [Snyk](https://security.snyk.io/package/npm/%40matrix-org%2Fmatrix-sdk-crypto-wasm)) |
| Synapse | AGPL-3.0 since the move to element-hq (Dec 2023, from v1.99), dual-licensed with a commercial licence from Element | [Element blog](https://element.io/blog/synapse-now-lives-at-github-com-element-hq-synapse/), [repo](https://github.com/element-hq/synapse). Whether it is AGPL-3.0-only or -or-later is not confirmed. |
| Conduit | Apache-2.0 | [GitLab](https://gitlab.com/famedly/conduit). Maintenance pace not verified. |
| conduwuit | Apache-2.0, **archived (2025)** | Successors are continuwuity and Tuwunel ([r/selfhosted](https://reddit.sudovanilla.org/r/selfhosted/comments/1jxc1rb/conduwuit_is_archived)). |
| continuwuity | Apache-2.0 per mirrors | **Verify** on the upstream Forgejo ([forgejo.ellis.link](https://forgejo.ellis.link/continuwuation/continuwuity)). It cannot migrate from Conduit's database. |

**Does Synapse's AGPL matter if we run it unmodified?** In practice, mostly no.

- AGPL §13 (the network clause) applies when you **modify** the program: users who interact with the modified version over a network must be offered its source ([AGPL-3.0 §13](https://www.gnu.org/licenses/agpl-3.0.html#section13)).
- Running an **unmodified** Synapse as a separate program, and talking to it over its HTTP API from closed-source X2F code, does not put our code under the AGPL.
- The risks are any patch, and any Synapse **module** loaded into its process (e.g. a custom auth or spam-checker module). A module plausibly makes a combined, modified work, so its source would have to be offered to users. Keep anything custom out-of-process (application service over HTTP), or buy Element's commercial licence.
- A lawyer should confirm this before relying on it (add to `~/x2f-comms/lawyer-questions.md` if Option A is chosen).

## 5. Cost

All the options are self-hostable with **no per-user fees**:
- Apache components are free.
- Synapse is free under AGPL. A commercial licence is optional and priced by Element on request.
- Element's hosted or enterprise products are not needed.

Real cost is engineering and operations:
- **Option A:** a homeserver to run, patch, back up, Tor-expose and include in the security review, audit scope and bug bounty. Synapse needs Postgres plus workers at scale; Conduit-family servers are lighter.
- **Options B and C:** no new servers. **C costs nothing in infrastructure.**

## 6. Fit with X2F

- **Moderator key and later staff.** Megolm would need the moderator bot to receive every session at index 0, which is exactly what our per-message mod slot already gives. For later staff, Matrix needs key forwarding or history-share-on-invite, and those keys would be trusted through Matrix device trust, not our owner-rooted chain. Option C's re-wrap is simpler, logged at the source, and bound to owner-certified staff keys.
- **Revocation.** In every scheme, a staff member who has read a chat keeps what they read. Removing their key stops future grants only.
- **Metadata.** A homeserver stores, in plaintext:
  - room membership, the sender and timestamp of every event, and the event graph;
  - device lists and keys;
  - room state events (name, topic, membership), which are not encrypted in Matrix;
  - Megolm ciphertext with **no padding**, so message lengths leak.

  Our API already sees which two accounts share a chat and when messages are posted. It does not see sizes beyond the bucket, nor any device or key graph beyond one key per role. Federation would add other servers; it must be off in Option A.
- **Forward secrecy.**
  - Megolm ratchets forward only. Anyone with the session at index i reads every later message in that session. There is no post-compromise security, and rotation is per session.
  - Our scheme uses a static-static `crypto_box` wrap, so compromising one per-chat identity reveals that chat. That is equivalent in practice, and the identities are **per chat** (bounded blast radius).
  - True forward secrecy (a Double Ratchet between traders) contradicts "a moderator can read the whole chat". **Crypto-shredding at close is the property that actually matters here.**
- **Tor/onion.** All the options work over an onion. Matrix clients need the homeserver base URL to be the onion, plus well-known/delegation config; federation off makes this simpler. Option C needs nothing new.
- **Proof upload pipeline.** Today the proof keys ride in sealed chat envelopes, AAD-bound. Options A and B mean re-plumbing this onto Matrix events or Megolm and reviewing it again. Option C keeps it. The re-wrap covers proof keys automatically, because they are just envelopes; the unblurred-proof read stays its own logged action.
- **vodozemac audit status.**
  - **Verified:** Least Authority audited vodozemac. The report is dated 30 March 2022 and was announced on 16 May 2022: 10 valid concerns, 8 fixed during the audit, partly funded by gematik ([matrix.org post](https://matrix.org/blog/2022/05/16/independent-public-audit-of-vodozemac-a-native-rust-reference-implementation-of-matrix-end-to-end-encryption/), [report PDF](https://leastauthority.com/static/publications/LeastAuthority-Matrix_vodozemac_Final_Audit_Report.pdf)). The README says "one security audit by Least Authority, with no significant findings".
  - **Since then:** in February 2026 Soatok published findings ([post](https://soatok.blog/2026/02/17/cryptographic-issues-in-matrixs-rust-library-vodozemac/)):
    - Olm 3DH accepts the identity element, because there is no contributory check (rated High by the author);
    - a V2-to-V1 MAC downgrade (Low);
    - a 100-value ECIES check code;
    - a deterministic pickle IV;
    - strict Ed25519 off by default.
  - Matrix's security team said there is "no practical security impact". The two sides dispute this.
  - matrix-sdk-crypto itself also had a 2024 advisory (CVE-2024-34063, zeroisation in vodozemac 0.5.x).
  - Takeaway: "audited in 2022" is not a current assurance. We would carry it into our own external audit (Plan 6).
- **Browser.** Yes. matrix-sdk-crypto (with vodozemac) ships as `@matrix-org/matrix-sdk-crypto-wasm`, which Element Web uses. It is a multi-MB WASM module (size not measured), which affects SRI, the release manifest, first-load time over Tor and the escrow-worker design. Our libsodium path is already in the worker and reviewed.

## 7. Next steps (if the owner agrees with C)

1. **Now, small (lead or Sonnet worker, Opus review):** fix G1 and G2. Moderation-side purge of `mod_chat_identities` and `signed_chats` for purged chats; engine deletes the device record on 404; a test that a purged chat's backed-up envelope cannot be opened with what remains. About 3 to 5 days. Pair it with G3 (30/90 days), which is already owed.
2. **Plan 4 Task 11 revision (Opus):** replace `/internal/chat/read → plaintext` with `/internal/chat/grant → per-envelope wrapped K` to owner-certified staff device keys. The moderation service keeps its own access record; staff-web decrypts in a worker; grants are purged with the chat. About 1.5 to 2.5 weeks. Update the Plan 4 residual: "chat access is enforced by rule, log **and** staff-key certification; the API alone cannot read a chat".
3. **Optional:** epoch-key wrapping of mod chat identities, for backups that shred too (about 1 week).
4. **Optional:** trader multi-device chat (about 1 to 2 weeks), as a design question first.
5. **Do not start:** Option A (about 10 to 16 weeks plus operations) or Option B (about 4 to 7 weeks), unless the owner wants Matrix for another reason, such as interoperability or a community room (`docs/community-room-plan.md` might be such a case, and could be weighed separately from trade chat).

## 8. Needs the owner's decision

1. **Matrix: yes or no** for trade chat. Recommendation: no.
2. **How staff read chats.** Either server-side decrypt with plaintext through the API (Plan 4 as written: simpler, weaker against a compromised API), or staff-device decryption via re-wrap (recommended). This is a security/privacy call.
3. **What "destroyed at close" promises users.** With G1 and G2 fixed, backups still hold ciphertext for up to 14 days, and the mod key, unless epoch keys are added. The Terms/FAQ wording depends on this.
4. **Staff who leave or are removed.** They keep what they already read (unavoidable). New grants stop. Should the log show a "key revoked" entry?
5. **Trader multi-device chat.** Wanted? Today a second device is read-only.
6. **Keep times** are already decided (30 days undisputed, 90 days from dispute). Confirm that dispute grants follow the same 90 days.

---
Sources: [vodozemac](https://github.com/matrix-org/vodozemac) · [matrix-rust-sdk](https://github.com/matrix-org/matrix-rust-sdk) · [matrix-sdk-crypto-wasm README](https://cdn.jsdelivr.net/npm/@matrix-org/matrix-sdk-crypto-wasm@18.0.0/README.md) · [Snyk: matrix-sdk-crypto-wasm](https://security.snyk.io/package/npm/%40matrix-org%2Fmatrix-sdk-crypto-wasm) · [Least Authority report](https://leastauthority.com/static/publications/LeastAuthority-Matrix_vodozemac_Final_Audit_Report.pdf) · [matrix.org audit post](https://matrix.org/blog/2022/05/16/independent-public-audit-of-vodozemac-a-native-rust-reference-implementation-of-matrix-end-to-end-encryption/) · [Soatok, Feb 2026](https://soatok.blog/2026/02/17/cryptographic-issues-in-matrixs-rust-library-vodozemac/) · [Element: Synapse AGPL](https://element.io/blog/synapse-now-lives-at-github-com-element-hq-synapse/) · [element-hq/synapse](https://github.com/element-hq/synapse) · [AGPL-3.0 §13](https://www.gnu.org/licenses/agpl-3.0.html#section13) · [Conduit](https://gitlab.com/famedly/conduit) · [continuwuity](https://forgejo.ellis.link/continuwuation/continuwuity) · [conduwuit archived](https://reddit.sudovanilla.org/r/selfhosted/comments/1jxc1rb/conduwuit_is_archived) · [The Register, Aug 2025](https://www.theregister.com/2025/08/13/secure_chat_darling_matrix_admits/)
