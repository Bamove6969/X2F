# Chat membership keys: lead decisions 18 Nov (addendum)

This is an addendum to `design-chat-membership-keys-2026-11-08.md` (comms folder). It records the lead's engineering calls of 18 Nov 2026 for design tasks 8 and 9, which the design left open, so a security reviewer can check them against the design.

It lives on `wip/lead-mod-chat` and not in the comms file, because helpers may not push comms. The lead may append this section to the design file as is.

## Lead decisions 18 Nov

- **Device key id.** SHA-256 of the staff device's Ed25519 signing public key, as hex, first 32 characters (128 bits). Built: `deviceKeyIdOf` in `apps/moderation/src/internal/grant.ts`. The grant route refuses any other form.
- **Certification lifetime.** A certification lasts 365 days. After that the device needs a fresh `certify-device` tap.
- **Replay of the certification.** The `certify-device` tap is a normal key tap bound to its intent, so the gate's existing nonce and single-use rules apply. The gate also refuses a second certification of a key id while one is still live.
- **Devices per person.** At most 3 live certified devices per staff member. This matches the trader device limit.
- **Revoking one device.** A `revoke-device` tap names the key id. Revoking a person (switch-off or removal) revokes all their devices.
- **Countersign.** The domain is `x2f/mod-countersign/v1`. The staff signature covers chatId, seq, the SHA-256 of the ciphertext, requestId and issuedAt. A countersign is single use because seq is unique per chat in envelope v2. Moderation refuses an issuedAt older than 5 minutes, and any requestId it has already seen.
- **`chat.read`.** It goes in the existing `activity_log` until the per-trade audit log (design task 12) exists. Moderation's own `mod_chat_access` record is the authoritative one.
- **No v1 stopgap.** No new wrap scheme is built on chat envelope v1. Order: groundwork (C), then design tasks 3, 4, 5, 6, then 8, then 9.
- **Owner questions.** p12-1, p12-4 and p12-11 are built to the design's recommendations. Each sits behind a named constant marked `// OWNER: p12-x`, until the owner answers page 12.

## Builder's calls in the groundwork (C), for the reviewer

These were made on `wip/lead-mod-chat` while building `POST /internal/chat/grant`. None of them is crypto.

1. **Who someone is comes from the ruling gate, not the API.** The gate's state (`GateState`, owner-rooted) supplies:
   - the owner;
   - live, joined staff who are not switched off and not removed;
   - their role.

   The gate registry is synced before each check, as `gateCheck` does, so a switch-off already shown by the API counts at once. Only the assignee comes from the API (migration 710 grants the read-only role `disputes.assignee` and nothing else). A compromised API can therefore only point a case at a real moderator, and the access is recorded in `mod_chat_access`.
2. **"Disputed" means two things must both hold.** The API's current dispute is not closed, and this process itself saw the trade disputed within `CHAT_AFTER_DISPUTE_DAYS` (`mod_dispute_seen`, which comes from the watch list and its own escalations). This narrows what the API alone can claim. It is not independent of the API, because the watch list is the API's word too (design section 3, table, API row).
3. **The log entry is bound to the person.** The `chat.read` entry must have actor kind `staff` and the actor must be exactly the staff account named in the request. It must also:
   - be of this trade;
   - be at most 60 seconds old, with up to 30 seconds of clock skew;
   - never have been used before.
4. **Order of checks.** Each check refuses at the first failure:
   1. HMAC, then parse.
   2. Gate present (503 `gate-unavailable`).
   3. Log entry (403 `log-entry-invalid`).
   4. Disputed (403 `not-disputed`).
   5. On the case (403 `not-on-case`). That means the assignee; or a senior or the owner (OWNER p12-4). A helper is never on a case, even if assigned.
   6. Device certified and live, at this process's clock (403 `device-not-certified`).
   7. Chat attested (404 `no-chat`).
5. **Use and record happen together.** Only after every check passes does one SQL statement both mark the entry used and write the `mod_chat_access` row. A replay finds the entry used and gets 403 `log-entry-invalid`. Refused requests use nothing and record nothing.
6. **Nothing is granted yet.** A request that passes every check is answered 503 `grant-unavailable`, because no moderator copy of the chat key exists until tasks 3–6 (NEEDS_P4_CHAT_MEMBERSHIP). In production `devices` is `NO_CERTIFIED_DEVICES` until task 8, so in practice every request stops at `device-not-certified`.
7. **The grant route is not dev-only.** `/internal/chat/send` stays behind `X2F_DEV_MOD_CHAT` (NEEDS_P4_MOD_COUNTERSIGN) until the countersign is built.
8. **Shredding.** The shred pass deletes `mod_chat_access` with the chat's keys (design section 5).
9. **Migration numbers.** API 710 and 711 (lead 18 Nov: after retention's 701, so an existing database applies them in order) and moderation 016 (the next free number).

## Builder's calls in tasks 5 and 6, for the reviewer

Tasks 5 and 6 are on `wip/lead-mod-chat`. None of these is a new primitive; the formats follow the design's own pattern (Ed25519 over a domain string and canonical JSON).

**Task 5, the trader engine**
1. **Getting the key.** The engine gets the chat key right after the attestation checks out, before it reads or seals any envelope. With no record on the server, it makes the key and posts the record. On 409 it reads the record that won.
2. **Checking the record.** The engine checks the record against the attested participants, never the API's word. The record must be signed by the trader it names, for this chat's channel. This device's copy must hash to the record's tkh. If any check fails, the chat shows the `security` failure and nothing is read or sent.
3. **The key is never stored on the device.** It is held in the worker's memory and erased with the chat. Each worker start opens the device's copy again.
4. **The engine is v2 only.** A v1 envelope is never shown: it gets a refused receipt, and the lines after it still show. Envelope v1 stays in chatCrypto for its own tests. Consequence: a chat that already holds v1 lines from before its key record shows none of them. The design assumes there are no production chats yet. The lead should confirm.
5. **No "unreadable" line.** Design section 9 wants a message that does not open shown as "unreadable". Today it is dropped, as before, because a visible line needs copy (an owner/design item).

**Task 6, the dispute grant (T1)**

6. **Grant-accepted statement.** Domain `x2f/chat-grant-accepted/v1\0`, body `{v, chat, tkh, grantBy, grantSig}`. It names exactly one grant, by that grant's signature, and is signed with the chat's moderator identity.
7. **What the API checks before filing a grant.** The grant must:
   - be signed by the registered identity of the side sending it, for this chat's channel;
   - carry the key record's tkh;
   - have a `disputeAt` within 10 minutes of the server's clock.

   The grant is required once the chat has a key (400 `grant-required`) and refused when it has none. The API stores the signed grant exactly as posted, in `chat_members.statement`.
8. **What moderation checks before accepting a grant.** All of these come from its own records:
   - the chat is one it attested;
   - the key record and the grant are each signed by the attested trader they name;
   - the grant's tkh equals the record's tkh;
   - the wrap opens with the chat's sealed moderator identity to a key with that tkh.

   The key is wiped from memory at once. Moderation keeps only a `mod_chat_grants` record (no key; deleted by the shred pass). It does not check its own view of the dispute, because a grant is the trader's own act.
9. **Fallback grant (T1 by proxy).** The counterparty's device grants too only when all of these hold:
   - the trade is disputed;
   - the other side's grant, signed by its attested identity for this chat, has no acceptance that verifies against the attested moderator identity;
   - `GRANT_FALLBACK_MS` = 2 minutes have passed since that grant's `disputeAt`;
   - this side has not granted.

   The API files a fallback grant only under the same conditions, once per side.
10. **The grant passes through the page.** It crosses postMessage from the worker to the page, which sends it with the dispute request. Its only secret part is a wrap that only the moderator's key opens.

## Builder's calls in task 7 (T2, the dispute notice), for the reviewer

No new primitive: the notice format (`x2f/chat-dispute-notice/v1\0 {chat, disputeSeq, openedAt, openedBy}`) is task 3's.

1. **When moderation signs a notice.** Only when all of these hold, on its own records: it attested the chat; its own `mod_chat_trade` links the chat to the trade the API names; its own `mod_dispute_seen` shows the trade disputed within `CHAT_AFTER_DISPUTE_DAYS`; it accepted no grant for the chat (`mod_chat_grants`); it signed no notice for that dispute seq (`mod_chat_notices`, migration 018, shredded with the chat). The seq, opening time and opener are the API's word, listed by `GET /internal/v1/chat-notices`.
2. **A trader-opened dispute waits.** `NOTICE_AFTER_TRADER_MS` = 2 minutes after its opening, by moderation's clock, so the disputer's own grant (T1) goes first. A system dispute gets its notice at once. This also covers the disputer whose device holds no key.
3. **What the API files.** The notice is stored (`chat_dispute_notices`, migration 712, cascades with the chat) only when it verifies against the chat's attested moderator identity for this chat's channel and names the linked trade's current open dispute exactly (seq, opening time, opener). The chat view shows the notice for the current open dispute only.
4. **What the device does.** With the API's `disputeOpen` true AND a notice that verifies against the attested moderator identity, and no grant of this side and no verified acceptance, the device grants once at once (`POST /v1/chats/:chat/grant`, trigger `notice`). The API takes such a grant only while disputed, with a stored notice for the current dispute and no accepted grant, once per side.
5. **The banner.** A verified notice with `openedBy: 'system'` shows "A moderator has been called by the system." (COPY-UNSIGNED, the design's own words). A trader-opened dispute's notice grants without the banner: the trader already sees the dispute.

## Fixes from the review of tasks 3-6 (review-lead-mod-chat-t3-6-2026-11-18.md)

- **F1.** Lead call (a): tasks 6 and 7 land together, never 6 alone. Task 7 is on the branch.
- **F2.** `chat_members.refused_at` and `refused_reason` (migration 713). Moderation reports `chat-grant-refused {chat, grantBy, grantSig, reason}` for a grant that fails for good (`bad`, `wrong-key`, `unattested`, `other-key`). The API marks only that exact row, only while it is neither accepted nor refused. `pendingGrants` skips refused rows. The fallback still treats a refused grant as unaccepted.
- **F3.** The trader device pins the chat key's tkh in its ChatRecord on the first record it accepted or posted, before anything is sealed. After that, a record of another tkh, or a 404, is the `security` failure, and the device never makes a second key.
- **F4.** The engine counts the other side's grant as accepted only when both the grant's and the acceptance's tkh equal `chatKeyHash(tk)` of this device's key. Moderation's grant pass refuses (`other-key`) a grant whose tkh differs from one it already accepted for the chat.
- **F5.** The key route inserts under the chat row's lock (`for update`). The dispute route, inside the dispute's transaction, takes that row `for share` and re-checks `chat_keys`; a record that appeared needs the grant (400 `grant-required`).
- **F6.** The API takes a grant's `disputeAt` at most 10 minutes in the past and at most 1 minute in the future. The engine waits `GRANT_FALLBACK_MS` from the earlier of `disputeAt` and when this worker first saw the grant.
- **F7.** The engine fills the chat key with zeros before dropping it (on erase, on a refused record, on a lost race). In JavaScript, libsodium's `memzero` is the same fill; the web app does not import libsodium itself.
- **F9.** **A grant relies on one trade per chat and one dispute per trade.** It names its chat (the channel), not a trade or a dispute seq. That is safe only while a chat links to at most one trade (`linkChatToTrade … where trade_code is null`) and a trade has at most one dispute. If re-disputes or chat reuse ever come, the grant needs `trade` and `disputeSeq` under `x2f/chat-grant/v2\0`. Noted in `chatV2.ts` too.
- **F11.** Tests: two identical `/internal/chat/grant` requests at once give exactly one access row (one passes, one 403 `log-entry-invalid`); one person's `chat.read` entry cannot be used for another person.
- **F8** (the gate wired into the internal server) and **p12-11** are in task 9.

## Builder's calls in task 8 (staff device certification), for the reviewer

The lead's decisions above are built as stated. No new primitive: the certification is a key tap (`tapChallenge`), verified by the gate as every tap is.

1. **The intents.** `certify-device {accountId, deviceKeyId, signPublic, boxPublic, issuedAt}` and `revoke-device {accountId, deviceKeyId, issuedAt}` (`@x2f/staff`). `issuedAt` is the API's own start time of the tap, signed (as the owner registry kinds), and the 365 days run from it. The id is `staffDeviceKeyId(signPublic)`, one function for staff-web, the API and the gate.
2. **Who may tap.** A certification only for oneself (`accountId` is the tap's account), by any live staff member or the owner. A helper may certify a device too; a helper is never on a case, so it opens nothing. A revocation by the device's own person or by the owner. The API has a route for one's own revocation only; the owner's revocation of someone else's device works in the gate, but there is no API route or screen for it yet (switching the person off revokes all their devices anyway).
3. **What the gate refuses** (each tap spent, logged `gate.refused.device-*`): a tap that does not verify against its registry (unknown key, revoked person, bad signature), a reused nonce, a key counter at or below its mark, a tap for someone else, an id that is not the signing key's, keys that are not 64 lower-case hex, an `issuedAt` more than 2 minutes ahead or more than 24 hours old (`MAX_TAP_AGE_MS`), a certification issued before the person's last switch-off this gate saw (less 2 minutes), a live id, a revoked id certified by a tap issued before its revocation, and a fourth live device.
4. **Revoking a person.** At every sync, every device of a person who no longer stands (switched off, removed, gone from the API, not the owner) is revoked for good: a later switch-on brings none back. A tapped security reset (D-032) revokes the person's devices too (builder's call: the devices were certified with the old keys). `deviceLive` also checks the person still stands at the moment of a grant.
5. **The device step leaves other taps alone.** It reads only `certify-device` and `revoke-device` taps and never spends a nonce of any other kind.
6. **The API keeps no device table.** `POST /staff/v1/devices` uses the tap (bound to the session, as every tap) and logs `staff.device-certified {deviceKeyId}`; it refuses a live id (409 `device-exists`) and a fourth device (409 `device-limit`) from its own view of the used taps. The gate re-verifies the stored tap itself and is the only judge.
7. **Staff-web keeps the key.** An Ed25519 key and its X25519 box key (`generateIdentity`), the secrets sealed with AES-256-GCM (AAD `x2f-staff-device/v1`) under a non-extractable WebCrypto key in the same IndexedDB database (`x2f-staff-device`), as the trader chat store does. `identity()` opens the secrets for one use and checks they belong to the stored public key. Staff-web now depends on `@x2f/protocol` (lock file updated by hand: one line).
8. **The screen.** `DeviceCard` ("Confirm this device", COPY-UNSIGNED, DESIGNER-REVIEW, no board) opens the key tap with every signed field labelled. It is added to the webauthn tripwire's reviewed callers.
