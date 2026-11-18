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
