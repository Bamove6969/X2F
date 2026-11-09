# Trade chat: one key per trade, with members (design, 2026-11-08)

Security-architect design for the lead, answering the owner's p11-2 ("Can we build encryption that works like that?" and "where they are stored and how they are filed"). Read-only: no code was changed. Code read at `origin/main` 5c4c8773 (fetched 2026-11-08), plus `origin/wip/third-p4-task11` (Plan 4 Task 11 in progress) and `origin/wip/lead-chat-shred` (cut off, unchecked). Builds on `research-chat-crypto-2026-11-08.md` (Option C); where this design differs from that note, this design is the newer thinking.

Items marked **[unsure]** are things I could not confirm from the code or that need a test before anyone relies on them.

---

## 1. The answer: yes

**Yes, we can build it, and it is simpler than what we have now.**

In plain words, for the owner:

- Each trade chat gets **one secret key**, made on a trader's phone or computer when the chat starts.
- That key is never stored in the open anywhere. Each **member** gets their own locked copy of it, locked with that member's personal key. The server keeps the locked copies filed under the trade's chat, like a key cabinet with one drawer per trade and one envelope per member. The server cannot open any of them.
- At the start the members are the **buyer and the seller**. Nobody at X2F is a member.
- When someone presses **Dispute**, that trader's app puts one more locked copy in the drawer, for the **moderation service** (the separate X2F machine that already holds the moderator keys). Only then can X2F get at the key at all.
- When a moderator is **assigned**, the moderation service gives that moderator their own copy. The moderator can read **the whole chat from the first message**, because everything was locked with the same key.
- A **senior moderator or the owner** is added the same way later. They see the whole chat and, from the audit log, everything the first moderator did.
- Every step (who was added, by whom, when, and every action) goes in the **audit log**.
- When the trade's time is up, the drawer is emptied: every locked copy, the moderation service's copy and the chat itself are destroyed, and the apps erase what they hold.

The one real change from the owner's picture: **"only after a dispute" becomes a lock, not a rule.** Today every message is locked to the moderation service from the first line, and only a rule stops it reading. In this design the moderation service simply has no copy of the key until a trader's own app hands one over at the dispute.

**How it maps to the libsodium we already use** (deliberately nothing new):

| Job | Primitive | Already used in |
|---|---|---|
| The trade's chat key `TK` | `randombytes_buf(32)` | `envelope.ts`, `proof/seal.ts` |
| Encrypting each message under `TK` | `crypto_aead_xchacha20poly1305_ietf_encrypt`, with the channel, sender and seq as associated data | `proof/seal.ts` |
| Padding to fixed sizes | the existing 256/1K/4K/16K/64K buckets | `envelope.ts` |
| A member's locked copy of `TK` | `crypto_box_seal(TK, memberBoxPublic)` | not used yet, but part of the standard libsodium-wrappers build (the same X25519 + XSalsa20-Poly1305 as `crypto_box_easy`) |
| Who sent a message, who added a member | `crypto_sign_detached` (Ed25519), domain-separated | `envelope.ts`, `attest.ts` |
| The key's fingerprint `tkh`, which every member checks | `crypto_generichash(32, "x2f/chat-key/v1\0" + TK)` | `envelope.ts` (`kh`) |
| Keys at rest on the moderation host | AES-256-GCM under `MOD_KEYSTORE_KEY`, chat code as AAD | `keystore.ts` |
| Keys at rest in a browser | a non-extractable WebCrypto AES-GCM key in IndexedDB | `chat/store.ts` |

There is no ratchet, no Megolm and no per-message key wrapping. Forward secrecy is ruled out on purpose: the owner's rule that a later member reads the whole history requires it. What protects old chats is **destruction at the end**, plus the fact that X2F never holds the key for an undisputed trade.

---

## 2. Key hierarchy

### 2.1 The keys

| Key | What it is | Made by | Where it lives |
|---|---|---|---|
| **TK**, trade chat key | 32 random bytes, one per chat (a pre-trade chat and the trade it becomes share one chat, so one TK) | the first trader device that opens the chat after attestation | nowhere in the clear; only as locked copies (wraps), and briefly in memory |
| **Chat identity** (exists today) | Ed25519 + X25519 per chat per role, attested by moderation | each trader's device | today: the device's IndexedDB. With multi-device (section 8): also on the server, sealed under the account's ACK |
| **Mod chat identity** (exists today) | Ed25519 + X25519 per chat, minted by moderation at attestation | moderation service | `mod_chat_identities`, sealed under `MOD_KEYSTORE_KEY` |
| **Staff device key** (new) | X25519 + Ed25519 per staff browser, certified by that person's own security-key tap, which the owner-rooted gate (Plan 4 Task 13) knows | staff-web, in a worker | staff browser IndexedDB, wrapped non-extractably |
| **ACK**, account chat key (new, for multi-device) | 32 random bytes per trader account | the account's first device | each approved device's IndexedDB; moved between devices only as `crypto_box_seal` to the new device |
| **Moderation signing key** (exists) | long-term Ed25519, pinned in the apps | owner setup | moderation host |

### 2.2 The records filed against the chat (API database, ciphertext only)

```
chat_keys(chat pk → chats on delete cascade,
          tkh, created_by_role, wrap_buyer, wrap_seller, sig, created_at)
  -- the creator's signed record: "TK with fingerprint tkh, locked to the buyer's and the seller's
  -- attested chat identities". First writer wins (primary key); the other side checks its own copy.

chat_members(chat → chats on delete cascade, member_kind 'mod'|'staff'|'trader-device'(later),
             member_ref (staff account id + device key id, or 'mod'),
             box_public, wrap, tkh, trigger 'dispute'|'notice'|'assigned'|'added',
             granted_by, granted_at, sig, log_entry_id, removed_at)
  -- one row per locked copy. The buyer's and seller's copies are in chat_keys.
```

"Filed against the trade" means exactly this: rows keyed by the chat code, which `chats.trade_code` links to the trade, deleted by the same cascade as the envelopes. The API can list who is a member and when they joined (it is the courier), but it holds nothing that opens any wrap.

### 2.3 The message envelope (chat only; v2)

```
{ v: 2, trade: <chat channel>, from: 'buyer'|'seller'|'mod', seq,
  nonce (24 B), ct = XChaCha20-Poly1305(pad(canonical {type, payload}), ad = "x2f/chat/v2\0" + trade + from + seq, nonce, TK),
  sig = Ed25519 by the sender's attested chat identity over "x2f/chat-envelope/v2\0" + canonical JSON of the rest }
```

- There are no `slots` and no per-message `kh`. Every member decrypts the same ciphertext with the same TK, and `tkh` is checked once per chat, so the "every recipient reads the same text" property (R15) holds for the whole chat.
- **The escrow `signals` channel keeps envelope v1 unchanged.** Moderation must read those from the first frame, and Plan 1's reviewed code stays as it is.
- `proof.attached` (the blurred proof's key) rides inside a v2 chat message, so it is readable by exactly the chat's members.
- `proof.unblurred` stays a v1 `seal` to `mod` only. Plan 5 says it is uploaded only after a logged moderator request, so it already exists only after a dispute. For staff to view it in the browser, moderation re-wraps that one message's K to the staff device key (section 2.4, step 5).
- **[unsure]** I assume there are no production chats yet (Monero test network only), so v2 can replace v1 for chat with no migration. The lead should confirm.

### 2.4 Who holds what, moment by moment

| Moment | Buyer device(s) | Seller device(s) | API | Moderation service | Staff |
|---|---|---|---|---|---|
| **M0** Chat opened, identities registered, attestation signed (as today) | own chat identity | own chat identity | public keys, attestation | mod chat identity (sealed), attestation | nothing |
| **M1** First device online makes TK, posts `chat_keys` | TK (memory) via its wrap | TK via its wrap, after checking `tkh` | `chat_keys` row (wraps only) | **nothing that opens the chat** | nothing |
| **M2** Messages flow | TK | TK | v2 ciphertext, sender role, times | nothing | nothing |
| **M3** Dispute pressed (T1) | the disputer's app posts a signed grant `crypto_box_seal(TK, modChatBoxPublic)` with the dispute request | auto-posts the same grant on seeing the disputer's signed grant (fallback only) | the `chat_members` 'mod' row; verifies the signature against `chat_identities` | can open the 'mod' wrap; checks `tkh`; posts signed `grant-accepted` | nothing |
| **M4** Moderator assigned and opens the chat | TK | TK | `chat.joined` audit entry; a 'staff' row with a wrap it cannot open | opens the mod wrap in memory, re-wraps TK to the moderator's **certified** staff device key, writes **its own** access record, forgets TK | the moderator's worker: TK in memory for the session; fetches ciphertext and decrypts in the browser |
| **M5** Senior or owner added (appeal, review) | same | same | another 'staff' row and entry | same re-wrap, own record | the senior: TK; reads the whole chat plus the per-trade audit (the first moderator's actions) |
| **M6** Dispute and appeal closed | same | same | rows kept for the keep time | wrap kept, so an appeal or senior review can still add members | nothing stored; a re-open needs a fresh grant (and a log entry) |
| **M7** Destruction (section 5) | erased | erased | rows and envelopes deleted | mod chat identity, signed chat and access record deleted | nothing to erase (never stored) |

**How a late joiner reads old messages:** TK is the same from M1 onwards, so a member added at M4 or M5 opens every envelope back to the first one, pre-trade chat included (spec 6.6 wants that). Nothing is re-encrypted.

**How a moderator writes:** staff-web seals the message under TK and signs it with the staff device key. It goes over Task 11's socket to moderation, which checks the staff signature, the certification and the assignment, then signs the v2 envelope as `from: 'mod'` with the mod chat identity, as today. Traders verify the mod identity they already pin, so the trader side barely changes. Moderation sees ciphertext only on this path. (It could decrypt, since it holds the mod wrap, but it has no reason to.)

---

## 3. Making "only after a dispute" enforced

**Today:** `chatCrypto.ts` seals every message `to: ['buyer','seller','mod']` from line one. Moderation can open every chat ever written, disputed or not, and only the rule in spec 6.6 and the Task 11 log check stop it. The Plan 4 Task 22 residual says this outright: "chat access is enforced by rule and log, not by cryptography."

**This design:** there is no mod copy of TK until a **trader device** makes one. There are two triggers, and a device grants on nothing else:

- **T1, a trader's own dispute.**
  - The Dispute button's request (`POST /v1/trades/:code/dispute`) carries the disputer's signed grant `{chat, tkh, wrap = crypto_box_seal(TK, modBox), disputeAt}` under the domain `x2f/chat-grant/v1\0`.
  - The API verifies the signature against the attested chat identity and stores it. It cannot verify the wrap. A trader whose chat has a key must send the grant, or the API refuses the dispute with 400 `grant-required`.
  - Moderation opens the wrap and checks `generichash(TK) = tkh` from `chat_keys`. If it matches, it posts a signed `grant-accepted`. If not (a cheater sent garbage), the counterparty's app sees the disputer's signed grant with no `grant-accepted` after it, and posts its own grant automatically. That is T1 by proxy: the counterparty acts only on a statement the disputer's own key signed, which the API cannot forge.
- **T2, a dispute no trader pressed.**
  - This covers a system escalation (`openedBy: 'system'`, reason `escalated`: late funds or a lapse nobody refunded) and a disputer with no device holding the key (a lost device, or a team member before Plan 3 Task 42).
  - Moderation signs a `dispute-notice {chat, disputeSeq, openedAt, openedBy}` with the mod chat identity, but only when its own view shows the trade disputed and no accepted grant exists.
  - A trader device grants on T2 only if **both** the notice verifies **and** the API's own `disputeOpen` is true. The app then shows the dispute banner ("A moderator has been called by the system"), so the trader sees it.

**What this buys:**

| Attacker | Can they get TK for an undisputed chat? |
|---|---|
| API alone | No. It cannot sign a T1 grant or a T2 notice. It can stage a fake system escalation, but a T2 notice comes from moderation, and moderation signs one only for a trade its own view shows disputed (for escalations it reported itself, it knows that from its own watcher). **[unsure]** Some escalations come from the API's own timer loop (`disputes/store.ts` "Task 9's timer loop"), and moderation learns of those only through the API's watch list. In that case a compromised API **can** get a T2 notice issued. The result: moderation holds TK, and the trader sees a dispute banner, but no one reads the chat without a certified staff key, a grant and a log entry. |
| Moderation alone | No. T2 also needs the API to show a dispute, and the trader's app checks the API too. |
| API and moderation together | Yes, for chats whose traders come online: a fake dispute plus a fake notice. It is **visible**, though: both traders' apps show a dispute they did not open. This is the strongest honest claim available without a trader tap on every dispute (open question Q2). |
| Nobody, once both traders' devices are gone | No copy can ever be made. The moderator rules on proofs and statements without the chat (open question Q3). |

---

## 4. Where keys are stored and filed

| What | Where | Protected by | Filed by |
|---|---|---|---|
| TK | nowhere in the clear | each wrap is `crypto_box_seal` to one member's key | — |
| Buyer and seller wraps | API DB `chat_keys` | the traders' chat identity secrets | chat code; `chats.trade_code` links to the trade |
| Mod wrap and staff wraps | API DB `chat_members` | the mod chat identity / staff device key | chat code + member |
| Mod chat identity secret | moderation DB `mod_chat_identities` | AES-256-GCM under `MOD_KEYSTORE_KEY`, chat code as AAD (optionally a weekly epoch key, section 5) | chat code |
| Moderation's own access record (new) | moderation DB `mod_chat_access(chat, at, staff_id, device_key_id, log_entry_id, action)` | the moderation host; the API cannot write it | chat code |
| Staff device key | staff browser IndexedDB, non-extractable wrap. **Certified** in the gate registry (`GateStore`, `MOD_STATE_DIR/gate.bin`) by a WebAuthn tap of a credential the owner chain approved | browser and the person's security key | staff account + device |
| Trader chat identity | today: device IndexedDB. With section 8: also `chat_identity_records(account_id, chat, sealed)` on the API, sealed under ACK | ACK | account + chat |
| ACK | each approved device's IndexedDB | non-extractable WebCrypto key | account + device |
| Ciphertext | API DB `chat_envelopes` (v2) | TK | chat code |

**Staff device certification**, so the API cannot add its own reader:

1. Staff-web makes the device key.
2. The person taps their security key over `{staffAccountId, deviceSignPublic, deviceBoxPublic, at}` (a new `KeyTapIntent` kind, `certify-device`).
3. Moderation verifies the tap against the gate registry (owner `create-invite` tap → registration → this tap), as `authorizeRuling` does.
4. Revocation (switch-off) needs no signature, the same as Task 13.

**The gate (Task 13) is not built on main** (`rulings.ts` still refuses everything), so this step depends on it.

---

## 5. Destruction

The keep times are already decided and unchanged:

- An undisputed trade: 30 days after close (a dispute can still be opened in that window). This is `CHAT_AFTER_CLOSE_DAYS = 30`, already on main. p11-17 (48 hours or 30 days) is still unanswered.
- A disputed trade: 90 days after the dispute or appeal closes (`CHAT_AFTER_DISPUTE_DAYS`).
- A pre-trade chat: 7 idle days.

**What is destroyed, and where:**

| Copy | How it is destroyed | Today |
|---|---|---|
| Envelopes, `chat_keys`, `chat_members`, identities, attestation | the existing `purgeChats` cascade as `x2f_purge` | built (cascade) |
| Mod chat identity, `signed_chats`, `mod_chat_access`, any unblurred-proof state | a moderation **shred pass**. Moderation keeps its own clock from the dispute facts it already gets (watch list, its own reports); the API's purge list is only a trigger. It refuses to shred a chat with an open dispute in its own view, so a compromised API cannot get evidence destroyed mid-case. | **not built (G1)**: nothing in `apps/moderation` deletes these rows |
| Trader device copy | see below | **not built (G2)**: `ChatStore.delete` has no caller |
| Staff device | nothing to delete: TK and plaintext are held in worker memory only, never in storage; staff-web sends `Cache-Control: no-store` on chat routes | new |
| API backups (WAL-G, 14 days) | age out | these hold ciphertext and wraps for up to 14 days |
| Moderation DB backups | age out (**[unsure]** whether the moderation DB is in the same WAL-G set and on the same 14 days; Plan 6 puts PostgreSQL on one database host) | the sealed mod identity for up to the backup window |
| Proof images | Plan 5 `purgeProofs`. Their keys are inside TK envelopes, so once TK is unrecoverable they are dead even if a blob lingers | built separately; its timing must match |
| Training copies (p11-9, "privacy tool scrubbed") | scrubbed in the staff browser (Task 19's anonymizer moves client-side; today it would run on moderation and hand plaintext to the API); kept at most as long as the dispute | open question Q12 |

**What backups can and cannot reveal after destruction:**

- **An undisputed chat:** nothing. X2F never had a member key: a backup holds ciphertext plus wraps that only the traders' (erased) chat identities open. **This is the big gain over today**, where an API backup plus the moderation DB reads every chat.
- **A disputed chat:** for up to the backup window, an API backup **plus** a moderation-DB backup **plus** `MOD_KEYSTORE_KEY` would open it.
  - To close that window, add **epoch keys**: seal each mod chat identity under a per-week key held only in the vault and in moderation's memory, never in the DB, and destroy each week's key once every chat sealed under it is past its destruction day plus the backup window. A restored backup then cannot open purged chats.
  - About 1 week of work. Recommended before launch if time allows (Q9).

**Device copies (p11-10): what must change.** The owner believes "all data is being fed live from our servers". In fact the app keeps a local IndexedDB record per chat (`x2f-chat`): the chat identity's secret keys **and every opened message's text** (`ChatRecord.messages`), wrapped with a key that sits in the same database. To make the owner's belief true:

1. **Stop storing message text on the device.** Each sync fetches and decrypts the whole chat again, so the device keeps only keys and a cursor. Chats are small, but over Tor this costs a few seconds on a long chat. **[unsure]** It needs a quick timing test on a phone over Tor.
2. **Erase on purge.** On a 404 for a chat, `store.delete(chat)`. At every app start, list `GET /v1/chats` and delete any local record whose chat is gone (this needs `ChatStore.list()`).
3. **With section 8**, the chat identity itself lives on the server under ACK, so once the server row is gone, nothing the device keeps opens anything.
4. **Honestly, what cannot be erased:** screenshots, copy-paste, a device that never comes back online (it keeps a key that now opens nothing, because the ciphertext is gone), and a modified app.

---

## 6. The audit log

**Today:** `activity_log` (migration 201) is one global SHA-256 hash chain. It is append-only and **never purged** ("a trade's 90-day delete (R36) leaves its entries, which hold only ids"). The owner's p11-2 now overrides that for trade entries: the per-trade log is destroyed with the trade. A global chain cannot delete rows without breaking, so the log splits in two:

**(a) The per-trade audit log (new, `trade_audit`).** One hash chain per trade, starting at the trade's first event (or the chat's, for a pre-trade chat). `appendLog` routes every entry that has a `tradeCode` here, so callers barely change.

- **What is recorded** (ids, roles, enums and times only, never message text or addresses, as `assertDetail` already enforces):
  - every trade event and button tap (`trade.*`, with the actor role and the team member when there is one);
  - every chat message sent (envelope id, sender role, time);
  - proof attached;
  - nudges;
  - dispute opened or escalated;
  - **every key event**: TK created, a grant (by whom, to whom, trigger T1 or T2), `grant-accepted`, `chat.joined` (a staff member received a wrap), `chat.read` (each ciphertext fetch by staff-web), `chat.message-sent`;
  - proof requested and opened;
  - freezes and holds;
  - rulings, approvals, appeals;
  - **`member.revoked`** on each case of a removed staff member (p11-5: "any event of any sort");
  - "destruction scheduled".
- **Where:** the API DB.
- **Encrypted?**
  - At rest, yes: `detail` is sealed with the API's stored-secret key ring, with the trade code as AAD.
  - End to end, **no**: the API writes these entries and already knows all of this (it runs the trade and stores the envelope metadata), so E2E would add no protection.
  - Message text is never in the log.
- **Who reads:**
  - the owner: all;
  - a senior moderator: every entry on cases they may see, including the first moderator's actions (the owner's ask);
  - the assigned moderator: the trade's trader and system entries and their own, but not other staff members' entries (recommendation, Q11);
  - traders: not this log (they see their own trade timeline already).
- **Tamper evidence:**
  - the per-trade chain;
  - **moderation's own access record** (section 4), which the API cannot write, so a compromised API cannot fake or hide a staff read. This fixes the research note's G4.
  - At destruction, the global log gets one row `trade.audit-closed {head}` with a **null trade code**. Because the chain's first entry includes a random per-trade salt, the head hash cannot be linked back to the trade, yet it proves the trade's log was intact up to its deletion.
- **Destroyed:** in the same transaction as the chat, on the same clock (30 days after an undisputed close, 90 after a dispute closes). The owner said "when the trade is completed without a dispute", but a dispute can still be opened for 30 days after close, and it would then have no log, so I recommend the chat's clock (Q7).

**(b) The global log (`activity_log`, kept).** Entries with no trade: `staff.*`, `owner.*`, `settings.*`, `site.*`, `log.checkpoint`, and the `trade.audit-closed` heads. These are kept, as today.

**Consumers to check when splitting:**

- `queryLog` (it unions both);
- `disputes/routes.ts:280` (reads log rows);
- Task 24's "involved in round 1" rule, and the gate's copy of it. These only need the log while a case is live, so they are fine;
- Task 20's moderator metrics. These must be computed into aggregate counters before a trade's log is destroyed. **[unsure]** Task 20 is not on main, so I could not check its inputs.

---

## 7. Revoking a removed staff member, honestly

- **What revocation does:**
  - the gate marks them revoked (no signature needed, Task 13), so moderation never re-wraps TK to them again;
  - their device certification is void;
  - their sessions end;
  - their `chat_members` rows get `removed_at`, and the API stops serving them ciphertext;
  - the per-trade audit log gets `member.revoked` on every case they were on, and the global log gets `staff.switched-off`.
- **What it cannot do:**
  - They keep whatever they already read, saved or screenshotted. No scheme can undo that.
  - While a case is live, if they kept TK from memory (a modified staff browser could), they could read **new** messages in that chat, but only by also getting the ciphertext, which needs API or database access they no longer have.
- **Not built, on purpose:** rotating TK when a member leaves. It would need every member's app to accept a new key mid-chat. It is about 1 week of work if the owner ever wants it (Q6).

---

## 8. Multi-device (p11-4)

The owner wants full abilities on an additional device, approved from a notification on a device already logged in, with no 24-hour wait.

**Design: one shared account chat key (ACK), handed over at approval.**

- The attested model stays **one chat identity per role**, so the counterparty and moderation never see a device list. That is a good privacy property to keep (the research note: we hold "no device or key graph beyond one key per role").
- Each chat identity record is sealed under the account's ACK and stored on the server (`chat_identity_records`). Any device holding ACK can open it and act fully: read, send, dispute (grant). The `other-device` read-only phase goes away. Two devices sending at once are already handled by the API's `stale-seq` 409 and the engine's one retry.
- **The approval must carry the key safely.** Today's number matching (`approval.ts`: a server-chosen 10-99 number with 3 choices) is fine for a login, but **not for handing over a key**. A compromised API could swap in its own device key and get the user to approve it. So for the key handover:
  1. The new device sends `commit = generichash(newDevicePublic)` with its login.
  2. The approving device answers with a random `nonce`.
  3. The new device reveals its public key.
  4. Both devices show a **6-digit code** computed from `(newDevicePublic, nonce)`. The user checks that the codes match and taps Approve.
  5. The approving device sends `crypto_box_seal(ACK, newDevicePublic)`.

  The commit-then-reveal order stops a server from searching for a key whose code matches. This is the classic short-authentication-string pattern; **it needs its own review**.
- **The 24-hour hold:** approval from a live device makes the new device fully able at once (owner p11-4). With **no** other device online, the login can still happen under today's rules, but that device has no ACK. It cannot read old chats, and for a trade in progress the chat is locked to it. The owner said the Jabber notice belongs here as well; **there is no Jabber code in `apps/api/src` on main**, so that depends on the notification work.
- **Removing a device:** a new ACK is made for future chats, and live chats' records are re-sealed under it. A removed device already knew the old ACK, so for chats in progress the same honesty as section 7 applies.
- **Vendor team members** (p7-7: members with dispute access "see everything and can answer the moderator") fit as more trader-side members, each with a wrap to their own account's ACK, added by the lead's device and logged. This waits for Plan 3 Task 42 (member keys, OPEN).
- **[unsure]** Tor Browser clears IndexedDB when it closes, so every Tor session would be a "new device", and ACK would be lost if no other device holds it. The escrow store has the same problem today, so it needs a decision for both.
- **Out of scope here, but the same question:** the escrow worker's per-trade party keys are also bound to one device. "Full abilities" on a second device means release and fund too, which is a separate design.

---

## 9. The sender-can-omit-the-moderator weakness (R16)

**Today:** a modified client can seal a message whose buyer and seller slots are real and whose mod slot is random bytes. The counterparty reads it, the moderator cannot, and nobody can tell (`apps/web/test/chatAttacks.test.ts:149`, "the mod cannot tell (R16, called out for the lead)"). A scammer could say "send to this other account" in a line the moderator will never see.

**This design fixes it.**

- There are no per-recipient slots. A message is one ciphertext under TK, and TK is pinned by `tkh`, which every member checks.
- If the counterparty can read a message, any later member can read it too, because it is the same key.
- A sender who encrypts under some other key produces a message the counterparty's app also cannot read. The app shows it as "unreadable", which is itself evidence.
- The existing test should flip to "a message the counterparty can read always opens for a later member".

**What it does not fix:**

- talking outside X2F;
- text that is itself encoded with a secret agreed elsewhere;
- a creator who hands out a TK that does not match `tkh`. The counterparty's app refuses that at once with the `security` failure state, so the chat never starts.

---

## 10. Threat table

"Today" means `main`, plus Plan 4 Task 11 as written on `wip/third-p4-task11`.

| Compromised | Today | With this design | What remains |
|---|---|---|---|
| **API** (code + DB) | No read of chats on main. With Task 11 as written it **reads every disputed chat**: it writes the `chat.read` entry that moderation checks, and moderation returns plaintext to it. | No read. It holds ciphertext and wraps only, can't sign grants, can't certify a staff key. | It sees metadata (who chats with whom, when, sizes in buckets, who joined). It can drop or withhold messages (shown as gaps), deny service, and stage a T2 for API-timer escalations (visible to traders, and still needs a staff read). It can serve **malicious web code** (row below). |
| **Moderation service** (host, `MOD_KEYSTORE_KEY`) | **Reads every chat, disputed or not, from line one.** | Reads only chats it was granted (disputed), and only from the dispute on. It can't create T2 without the API also showing a dispute. | It can forge "moderator" messages (as today). It can refuse grants (DoS). It can show a staff member a chat outside the rules, but only for disputed chats, and its own access record would hold the event unless it was also tampered with. |
| **API + moderation together** | Everything. | Undisputed chats only through a **visible** fake dispute on online devices. | Q2 (a trader tap) would close this. |
| **Staff device** | With Task 11: whatever the API shows that person. | The chats of cases that person joined, while the key is in memory, plus future grants to that device until revoked. | It can't add themselves to a case: assignment comes from the API, and moderation checks certification. A rogue staff member **plus** a compromised API could be "assigned" any disputed chat, and that is logged in moderation's own record. |
| **Trader device** | That trader's chats on that device. | That trader's chats, on every device (via ACK). | It can't impersonate the counterparty or a moderator. It can screenshot. |
| **Web-delivered code** (malicious JS from a compromised API or CDN) | Total for the users who load it: keys and plaintext. | **The same: this is the biggest risk.** E2E in a browser is only as good as the code the server delivers. | Plan 6 Tasks 13-14 (SRI, import-map integrity, signed release manifest, live integrity check) reduce it but do not remove it. For **staff-web** this matters most, because one malicious staff build reads every case its user joins. Recommendation: staff open staff-web only from a pinned, manifest-checked build (Q10). |
| **Backups** | API backup + moderation DB = every chat. | Undisputed: nothing. Disputed: for up to 14 days after destruction, with the moderation DB and its key too. | Epoch keys (section 5) close it. |

---

## 11. Build plan

Sizes: S ≤ 2 days, M 3-5 days, L 1-2 weeks, each including review. Rough, not commitments.

| # | Task | Depends on | Size |
|---|---|---|---|
| 1 | **Moderation shred (G1)** on today's v1: delete `mod_chat_identities` and `signed_chats` on its own clock, with a test that a backed-up purged envelope no longer opens. Lands now. | — | S-M |
| 2 | **Device erase (G2)**: delete on 404, sweep at launch, `no-store` on chat routes. Lands now on v1. | — | S |
| 3 | `@x2f/protocol` **chat key and envelope v2** (pure): `newChatKey`, `tkh`, `wrapTo`/`unwrap` (`crypto_box_seal`), signed key record, grant and notice formats, `sealV2`/`openV2` with padding and AD. Strict decoding as in `envelope.ts`. | — | M |
| 4 | **API storage**: `chat_keys` (first writer wins), `chat_members`, the v2 check in `checkChatEnvelope`, cascade on purge. | 3 | M |
| 5 | **Trader engine on v2**: make or accept TK, check `tkh` (otherwise `security`), seal and open v2, **no message text stored**, full re-read per sync. Flip the R16 test. | 3, 4 | L |
| 6 | **Dispute grant T1**: the grant inside the dispute request, verified by the API; moderation checks it and posts `grant-accepted`; the counterparty's fallback grant. | 5 | M |
| 7 | **Dispute notice T2**: escalations and lost-device disputes; the device's two checks and the banner. | 6 | S-M |
| 8 | **Plan 4 Task 13 gate** (not on main), plus the `certify-device` tap for staff device keys. | Task 13 | M (on top of Task 13) |
| 9 | **Grant to staff**: `/internal/chat/grant` on Task 11's socket **replaces `/internal/chat/read`** (no plaintext to the API); `/internal/chat/send` becomes countersign; moderation's `mod_chat_access`; the unblurred-proof K re-wrap. | 6, 8, Task 11 | M |
| 10 | **Staff-web reader**: decrypt in a worker, keep nothing stored, send moderator messages, add a senior or owner. | 9 | L |
| 11 | **Revocation**: `member.revoked` entries, refused grants, `removed_at`. | 9 | S |
| 12 | **Per-trade audit log**: split `appendLog`, per-trade chain, destruction with the chat, `trade.audit-closed` head, `queryLog` union, metrics counters. | — (any time; before Task 20) | L |
| 13 | **Multi-device**: ACK, device keys, the commit-then-reveal code on approval, `chat_identity_records`, and the end of `other-device`. | 5 | L |
| 14 | **Epoch keys** for the mod chat identity (backups shred too). Optional. | 1 | M |
| 15 | **Docs and review**: spec 6.6 and 4.1; Plan 4 Tasks 11, 19 and 22 (the residual becomes "the API alone cannot read a chat; only after a trader's own grant can moderation"); `rulings-and-lessons` R15 and R16; the Terms and FAQ text; one security review of the whole set before it ships. | all | M |

**Order:**

- Now: 1 and 2 (they help regardless of the rest), with 12 in parallel.
- Then 3 → 4 → 5 → 6 → 7.
- Staff side: 8 → 9 → 10 → 11.
- Then 13, then 14 if wanted, and 15 last.

**Total:** about 13-15 weeks of single-thread work. With three lanes (shred and audit, the trader side, the staff side), about 5-7 weeks of calendar time. That is more than the research note's 2-3 weeks, because making "only after dispute" a lock changes the envelope, not just the read path.

**About `wip/third-p4-task11`:** land its queue, case view, freeze and incident-ID parts. Keep its `/internal/chat/read` plaintext path for development only, never production, until task 9 replaces it. Otherwise the API-reads-disputed-chats gap ships.

---

## 12. Questions for the owner (plain language, each with a recommendation)

1. **Moderators can never read a chat unless there is a dispute.** That includes the owner, and a trader who complains outside a dispute. *Recommend: yes, this is the point.*
2. **When the system opens a dispute by itself** (no trader pressed the button), a trader's app hands the chat key to X2F automatically the next time it is open, and shows a "moderator called" banner. Alternatively, it could ask the trader to tap "Allow". *Recommend automatic with the banner: it is faster, and the banner makes misuse visible. A tap is stronger but lets a cheater stall.*
3. **If both traders have lost their phones or computers**, nobody can ever read that chat, not even X2F. The moderator decides on proofs and statements. *Recommend: accept; it is rare and it is what makes the encryption real.*
4. **Seniors and the owner get in the same way as moderators:** they are added to that one case, the addition is logged, and they see the whole chat and the first moderator's actions. Nobody gets a master key to every chat. *Recommend: yes.*
5. **A new device:** approving it from your other device shows the **same 6-digit code on both screens**, and you tap only if they match. This replaces picking one of three numbers. Then the new device has full abilities at once, with no 24-hour wait. *Recommend: yes. With no other device online, the new device can log in as today but cannot open old chats.*
6. **A removed staff member** cannot un-see what they read. We stop all future access and log it on every case they were on. Changing a chat's key mid-case when someone is removed is not built (about 1 week). *Recommend: don't build it now.*
7. **When the audit log is destroyed:** with the chat, 30 days after an undisputed trade closes (because a dispute can still be opened in that time), and 90 days after a dispute or appeal closes. Not at the moment the trade completes. *Recommend: yes. Also still open: p11-17, 48 hours or 30 days.*
8. **Staff-wide events** that are not about one trade (hiring, settings, site stops) stay in a permanent log. *Recommend: yes.*
9. **Backups:** for up to 14 days after a disputed chat is destroyed, a copy could be pieced back together from backups, but only by someone holding both servers' backups and the moderation key. Undisputed chats can never be recovered. *Recommend: build "backups shred too" (about 1 week) before launch, and until then say "within 14 days" in the Terms.*
10. **Staff should open the staff site only from a checked, pinned copy**, because whoever controls the code the browser receives can read what that browser decrypts. *Recommend: yes; a short setup step for every staff member.*
11. **Who sees the audit log:** the owner sees everything; a senior sees everything on their cases, including the first moderator's actions; a moderator sees the traders' actions and their own, not other staff members' entries. *Recommend as stated.*
12. **"Privacy tool scrubbed" training copies:** these are made in the staff member's own browser and destroyed when the dispute is (90 days after it closes). *Recommend: yes. Say if you want them kept longer.*
13. **Staff-only questions to the previous moderator:** a separate staff-only thread on the case, which traders never see, built with the same member keys. *Recommend: yes, as a later small task.*
14. **Chats no longer stored on the phone:** the app reads them live from X2F every time, which matches what you believed. It needs to be online, and a long chat over Tor may take a few seconds. *Recommend: yes.*

Interpretation note: p11-5 says "for the audit log for the team lead". I read "team lead" as the owner and seniors (staff). If it meant a vendor's team lead (Teams, p7), the vendor team audit (`team/audit.ts`) should also record a member's removal; it is cheap to do both.
