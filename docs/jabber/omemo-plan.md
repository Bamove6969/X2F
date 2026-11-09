# OMEMO for the Jabber sender: plan

Owner ruling p11-31: OMEMO and Tor are both mandatory for the Jabber notices. The jabber-notices
branch built the Tor-only, TLS-only, SCRAM XMPP sender, the recipient's device-list and bundle
fetch and the `NEEDS_OMEMO_RATCHET` tripwire (`apps/api/src/jabber/omemo.ts`), so nothing is sent.
This plan picks the OMEMO version, lists the protocol pieces, weighs the libraries and licences, and
says what gets built where. Written 2026-11-09 from the sources named below; re-check the client
facts before lighting the feature.

## 1. Which OMEMO version

XEP-0384 exists in two incompatible generations:

| | "OMEMO 0.3" (siacs, legacy) | "OMEMO 2" (twomemo) |
|---|---|---|
| XEP version | 0.3.0, 2018-07-31 ([attic](https://xmpp.org/extensions/attic/xep-0384-0.3.0.html)) | 0.4.0 (2020) through 0.9.1 (2026-04-06, current, Experimental) |
| Namespace | `eu.siacs.conversations.axolotl` | `urn:xmpp:omemo:2` (0.4.0 used `urn:xmpp:omemo:1`) |
| PEP nodes | `….axolotl.devicelist`, `….axolotl.bundles:<deviceId>` (one node per device) | `urn:xmpp:omemo:2:devices`, `urn:xmpp:omemo:2:bundles` (one node, one item per device) |
| Keys | Curve25519 (libsignal form, `0x05` ‖ 32 bytes), XEdDSA signature | Ed25519 public keys, XEdDSA optional |
| Session | libsignal: X3DH, Double Ratchet, protobuf `PreKeySignalMessage` / `SignalMessage`, HKDF infos `WhisperText`, `WhisperRatchet`, `WhisperMessageKeys` | its own Double Ratchet spelling, HKDF infos `OMEMO X3DH`, `OMEMO Root Chain`, …, over XEP-0420 SCE |
| Payload | AES-128-GCM, random 16-byte key and 12-byte IV; `key ‖ tag` (32 bytes) encrypted per device by the session | AES-256-CBC with HMAC-SHA-256 (truncated to 16) over an SCE envelope |

What the common clients accept today (each project's own DOAP file, read 2026-11-09):

- Conversations: XEP-0384 **0.3.0**, complete; latest release 2.17.10 (2025-02-04). `conversations.doap` on codeberg.org/iNPUTmice/Conversations. Its `XmppAxolotlMessage` encrypts with `AES/GCM/NoPadding`, a 128-bit key, a 12-byte IV (it accepts 12 or 16 on receipt), and puts `key ‖ tag` into each `<key>` (`PUT_AUTH_TAG_INTO_KEY`); a 16-byte key without a tag is refused as an outdated sender.
- Dino: XEP-0384 **0.3.0**, complete (`dino.doap`).
- Monal: XEP-0384 **0.3.0**, complete since Monal 4.8 (`monal.doap`).
- Gajim: depends on `omemo-dr` (Gajim's Double Ratchet library, the legacy namespace; `pyproject.toml`); its ChangeLog up to 2.7.0 (2026-11-03) has no OMEMO 2 entry.
- Kaidan is the exception: XEP-0384 **0.8.3** (OMEMO 2) in its DOAP, release 0.17.0 (2026-11-05). A Kaidan user cannot receive an OMEMO 0.3 message.
- omemo.top (last updated 2025-02-11) lists support without versions; it is not a source for this choice.

**Decision: OMEMO 0.3 (`eu.siacs.conversations.axolotl`).** It is the only version Conversations,
Monal, Gajim and Dino all accept, and it is what the jabber-notices branch already fetches and
checks. OMEMO 2 can be added later as a second encryptor behind the same sender once a client the
owner cares about needs it; the sender's XML and the Double Ratchet core are shared, the KDF labels,
payload cipher and envelope differ.

Owner note: a user whose only client is Kaidan (OMEMO 2 only) will see "no OMEMO device found" at
set-up, which is the honest answer under p11-31.

## 2. Protocol pieces (sender side)

Exactly what libsignal-protocol-java does, which is what every 0.3 client decrypts with (Conversations
and Dino use libsignal, Gajim uses omemo-dr, Monal its own port of the same). Sources read: libsignal's
`RatchetingSession`, `RootKey`, `ChainKey`, `HKDF`/`HKDFv3`, `DerivedMessageSecrets`, `SignalMessage`,
`PreKeySignalMessage`, `SessionBuilder`, `ByteUtil`, `WhisperTextProtocol.proto`.

1. **Our identity** (built, migration 332): a device id in 1..2^31-1 and a Curve25519 key pair,
   private key sealed under `X2F_JABBER_KEYS`. Public form on the wire: `0x05 ‖ 32 bytes`.
2. **Our bundle** (new): a signed prekey (Curve25519 pair, id) with its XEdDSA signature under the
   identity key over the 33-byte public key, and 100 one-time prekeys (the XEP says at least 20).
   Stored once, sealed, published on every connection (idempotent) to
   `eu.siacs.conversations.axolotl.bundles:<deviceId>` as item `current`, with publish-options
   `pubsub#persist_items=true`, `pubsub#access_model=open` so other servers' users can read it; and
   our device list `<list><device id=…/></list>` to `….devicelist`, item `current`. X2F never
   receives, so its prekeys are never consumed; they exist so the bundle is well-formed and stable.
3. **Device list and bundle fetch** (built): PEP `items` requests; bundle checks (key types and
   lengths, signed prekey signature under the identity key, at least one prekey).
4. **X3DH** (Alice side), per recipient device: a fresh base key pair `EK`; one prekey `OPK` taken
   from the bundle at random (libsignal takes the one the server handed out; a PEP bundle lists them
   all, so the sender picks); master secret =
   `0xFF×32 ‖ DH(IK_A, SPK_B) ‖ DH(EK_A, IK_B) ‖ DH(EK_A, SPK_B) ‖ DH(EK_A, OPK_B)`;
   `HKDF-SHA-256(salt = 32 zero bytes, ikm = master, info = "WhisperText", 64)` → root key (32),
   receiving chain key (32, unused by a sender).
5. **Double Ratchet** first step: a fresh sending ratchet pair; `HKDF(salt = root, ikm =
   DH(ratchet_A, SPK_B), info = "WhisperRatchet", 64)` → new root, sending chain key. Message keys:
   `HMAC(chain, 0x01)` → seed, `HMAC(chain, 0x02)` → next chain; `HKDF(zero salt, seed,
   "WhisperMessageKeys", 80)` → AES-256 key (32), MAC key (32), IV (16). HKDFv3: the expand counter
   starts at 1 (RFC 5869); HKDFv2 (counter 0) belongs to session version 2 and is not used.
6. **SignalMessage**: AES-256-CBC/PKCS#7 of the 32-byte `key ‖ tag`; protobuf
   `{1: ratchetKey (33 bytes), 2: counter, 3: previousCounter, 4: ciphertext}`; version byte
   `(3 << 4) | 3 = 0x33`; MAC = `HMAC-SHA-256(macKey, IK_A ‖ IK_B ‖ version ‖ protobuf)[0..8]`.
   **PreKeySignalMessage**: `0x33 ‖ protobuf {5: registrationId, 1: preKeyId, 6: signedPreKeyId,
   2: baseKey (33), 3: identityKey (33), 4: SignalMessage bytes}`. OMEMO 0.3 marks it
   `<key rid=… prekey='true'>`. The registration id is any value in 1..16380 (libsignal); we use
   the device id when it fits, else a fixed one; clients ignore it.
7. **Payload**: one AES-128-GCM encryption of the UTF-8 text under a random 16-byte key and 12-byte
   IV; `<encrypted xmlns='eu.siacs.conversations.axolotl'><header sid='ours'><key rid='…'
   prekey='true'>base64(PreKeySignalMessage of key‖tag)</key>…<iv>base64(iv)</iv></header>
   <payload>base64(ciphertext)</payload></encrypted>`, built from typed parts (review R1), never
   from a string. No `<body>`; `<store xmlns='urn:xmpp:hints'/>` and the nickname as built.
8. **Sessions: none kept.** Every notice is a fresh X3DH and a PreKeySignalMessage. libsignal
   receivers accept a new prekey message at any time and archive the old session (`SessionBuilder.
   processV3`, `SessionRecord.promoteState`). This keeps the sender stateless (no per-recipient
   session rows, nothing to rewrap or get out of sync, nothing to leak), costs one of the recipient's
   100 prekeys per notice per device (clients replenish), and means a reply from the client (its
   key-transport "session completed" message) is never read. The Double Ratchet is still built in
   full (sending and receiving) so the tests can run both sides and so a stateful sender can be
   added later without a redesign.
9. **Trust policy**: blind trust before verification (BTBV), the default of Conversations, Gajim
   and Dino: every device in the device list whose bundle checks out gets the message. X2F has no
   way to verify a user's fingerprint and no UI for it; pinning the first-seen identity key per
   address would silently cut off a user who buys a new phone. See owner question 1.

## 3. Libraries, licences

Checked with `npm view` on 2026-11-09:

| Package | Licence | Latest | Notes |
|---|---|---|---|
| `@signalapp/libsignal-client` | **AGPL-3.0-only** | 0.106.2 (2026-11-05) | Signal's own, Rust with native bindings; the only vetted full implementation. AGPL reaches the whole API service. |
| `libsignal-protocol` | **GPL-3.0** | 1.3.15 (2024-02) | Signal's old JavaScript port, archived. |
| `@privacyresearch/libsignal-protocol-typescript` (+ `@privacyresearch/curve25519-typescript`) | **GPL-3.0-only** | 0.0.16 (2025-06) | TypeScript port of the above; keeps its licence. |
| `libsignal-protocol-typescript` | **GPL-3.0-only** | 0.0.18 (2024-03) | Same. |
| `@noble/curves` | MIT | 2.4.0 (2026-08-27) | Audited (Cure53, Trail of Bits), pure JS, not constant-time (bigint). Would provide Ed25519 point arithmetic only. |
| `@noble/hashes` | MIT | 2.4.0 | Already in the tree, transitively via `otpauth`. Node has every hash we need. |

Licence rule: `docs/superpowers/rulings-and-lessons.md` has no GPL clause; the repo has no LICENSE
file and the owner wants the code on GitHub (p11-38). Every dependency so far is MIT, ISC, BSD or
Apache-2.0. A GPL dependency would put the API under GPL once published; an AGPL one puts the running
service under AGPL. **No GPL or AGPL dependency** unless the owner rules otherwise (owner question 4).
The 14-day rule (rulings, Toolchain) is met by `@noble/curves` 2.4.0 if it is wanted.

What Node 24's `node:crypto` already gives, with no dependency: X25519 key pairs and `diffieHellman`
(checked against libsignal's `Curve25519Test` agreement vector), `hkdfSync`, HMAC-SHA-256,
AES-128-GCM, AES-256-CBC, Ed25519 verify (used by the built XEdDSA check), randomness. The one gap is
**XEdDSA signing** of our signed prekey: it needs Ed25519 scalar-multiplication of the base point by
our Curve25519 private scalar, and Node's Ed25519 signer only takes a seed. That is roughly 70 lines
of bigint Edwards arithmetic (field ops are already in `omemo.ts`), checked three ways: libsignal's
XEdDSA known-answer vector (`Curve25519Test.testSignature`), a differential test against OpenSSL (for
random seeds, our scalar-mult of `clamp(SHA-512(seed)[0..32])` must equal Node's Ed25519 public key),
and the built verifier.

**Recommendation: no new dependency.** Build `@x2f/omemo` on `node:crypto` plus that small amount of
curve arithmetic. `@noble/curves` is the fallback if the reviewer prefers audited point code; it is
not constant-time either, and the signing it would serve happens once per key rotation over public
data with a fresh 64-byte nonce. The protobuf framing is two varint field types and needs no library.

## 4. Where it lives and how it is built

- `packages/omemo` (`@x2f/omemo`, server-only, Node crypto; the browser-safe `@x2f/protocol` stays
  separate): `edwards.ts` (point arithmetic, XEdDSA sign and verify), `protobuf.ts`, `x3dh.ts`,
  `ratchet.ts` (Double Ratchet session, both directions, skipped keys capped), `message.ts`
  (SignalMessage / PreKeySignalMessage), `envelope.ts` (OMEMO 0.3 payload and the `<encrypted>`
  element from typed parts, and its parser for tests), `bundle.ts` (our bundle: generation, XML,
  signing). Tests: known-answer vectors (libsignal agreement and signature, RFC 5869 HKDF,
  hand-built protobuf), the differential Ed25519 test, X3DH + ratchet round trips, seeded property
  tests over random message schedules (out-of-order delivery, both directions, no message key ever
  repeats, a wrong identity fails the MAC), and the envelope decrypting on every device.
- `apps/api`: migration 333 (`jabber_omemo_bundle`, one sealed row; rewrap covers it), the real
  encryptor replacing `ratchetEncryptor` (keeps the `OmemoEncrypt` shape; `NEEDS_OMEMO_RATCHET`
  disappears), the sender publishes our device list and bundle after bind, the fake server in
  `xmpp.test.ts` grows a real receiving device that decrypts what the sender wrote.
- Behind the existing flag: nothing changes while `X2F_XMPP_*` is unset. Red test first, small
  commits, no network in tests.

Not in this plan: receiving (X2F never reads replies), OMEMO 2, key verification UI, our prekey
replenishment (never consumed), group chats.

## 5. Owner questions

1. **Trust.** May a notice go to a device whose key nobody verified? Recommendation: yes, blind trust
   before verification, as Conversations, Gajim and Dino do by default. The alternative (pin the
   first key, refuse new devices) silently cuts off a user with a new phone, and X2F cannot show or
   compare fingerprints with the user.
2. **Kaidan and other OMEMO-2-only clients** get "no OMEMO device" at set-up. Accept for now?
   Recommendation: yes; add OMEMO 2 when a client that matters needs it.
3. **Stateless sessions**: one fresh prekey message per notice (uses one of the recipient's prekeys
   each time; the client's reply is never read). Recommendation: yes; it is the simplest thing that
   is correct, and it removes a whole class of state to protect.
4. **Licence**: confirm no GPL/AGPL dependency in the API (rules out Signal's own library).
5. **Operations** (not a code question): clients answer a prekey message with a key-transport
   message to x2f-alerts. X2F sends no presence, so the XMPP server stores them offline for ever.
   X2F's own server (p11-42, still open) should cap or expire that account's offline store.
