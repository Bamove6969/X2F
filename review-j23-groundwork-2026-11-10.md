# Review: J-23 phase 1 groundwork (security and protocol), 10 Nov 2026

Branch `origin/wip/lead-multi-device-build` at `ce3d54f8`. Commits reviewed: a8b47512 (protocol `sealed.ts`, REVIEW-PROTOCOL), de1d2c3b + 10302385 (API gate, migration 500, chat-key courier), 03d1ddd6 + ce3d54f8 (web ACK store, keeper, worker messages). Design: `docs/security/multi-device-2026-11-09.md` (origin/wip/lead-multi-device), sections 2-4 and 6. Reviewer was read-only on code; two edge cases were confirmed with a throwaway probe test, since deleted.

## Verdict

**Fine to land as dormant groundwork. Not safe to wire up as it stands.** Nothing calls the courier or the keeper yet, nothing is user-visible, and the parts that are built do what their docs say: correct libsodium use, strict strong-to-strong, owner-only, ciphertext-only. Findings 1 and 2 are design-level and must be settled, with the protocol reviewer, before any screen or engine code calls `chat-key-open` / `chat-key-seal` or before identity records are sealed under the ACK. Findings 3 to 6 are small engineering fixes the builder can make now. Findings 7 to 10 are minor or informational.

## Tests and typechecks (serialised runner, this branch)

- `@x2f/protocol`: sealed, identity, envelope, hardening, attacks, payload, replay: 7 files, **228/228 passed**.
- `@x2f/api`: chatKeys, deviceApproval, frontDoor, schema, jabber-paths, coolingOff: 6 files, **271/271 passed**.
- `@x2f/web`: chatStore, chatAck, chatServeKeys, chatEngine: 4 files, **57/57 passed**.
- `tsc --noEmit` for packages/protocol, apps/api and apps/web: all exit 0.
- Probe (throwaway, deleted): (a) two POSTs to the same recipient at the same clock instant: the second is **500 `internal`**; (b) `GET /v1/account/chat-keys` during an account hold: **200 with the envelope**; (c) a weak session's GET: 403 `weak-session` (as intended).

## Findings

1. **[High before wiring; design] Sealed boxes are anonymous, and the keeper takes any box as its ACK.** `crypto_box_seal` does not authenticate the sender. Anyone who knows a device's public key can seal 32 bytes to it, and that includes the API, which serves that key. `ack.ts:121-142` `open()` accepts whatever opens. It **replaces a key it already holds** when the epoch is equal and the key differs (`ack.ts:139-140`: only an identical key returns `'already'`), and when the epoch is higher. The epoch sits outside the box (it travels as a separate field in the envelope and the API row), so the server sets it freely. So a compromised API, the threat that section 3.3 exists for, can give a device a chat key it chose. In 4.2 rule 2 the device would then seal new identity records under that key, which the server can open. The SAS in 3.3 binds only the **recipient** key (`devicePublic`). It does not prove that the box came from one of the account's own devices. Recommendation (for the lead and the protocol reviewer, not an owner question): (a) never overwrite a held ACK at the same epoch (refuse it as a conflict); (b) accept a box only during a handover this device started (bound to the approval id), never from an unsolicited listing; (c) authenticate the sender, e.g. by putting the approving device's public key into the SAS hash and using `crypto_box` from that device key (or signing the payload), and put a versioned context `x2f/ack/v1 || accountId || epoch || ACK` inside the box so the epoch cannot be relabelled. (The 1024-byte cap in migration 500 already leaves room for that payload.) Without (c), (a) and (b) only narrow the window.

2. **[Medium before wiring] `chat-key-seal` lets the page seal the ACK to any key.** `serveKeys.ts:215-220` / `ack.ts:112-119` seal the ACK to whatever `recipientPublic` the page names. "No key crosses postMessage" holds literally, because only ciphertext goes back. But any script running in the page (an XSS, a rogue dependency) can ask for the ACK sealed to its own key and open it. That gives lasting access to every identity record, beyond the session. Today the ACK protects nothing, so the risk is latent. The handler is live in the production worker (`escrow/worker.ts`). Recommendation: the worker should seal only to a recipient it has checked itself (the commit/SAS of 3.3, computed in the worker), or leave the `chat-key-seal` handler unregistered until that exists. The same applies to `chat-key-make`: the page can make a fresh ACK on a device that ought to receive the existing one, forking the account's key.

3. **[Medium] Collection is enforced by the client, and the GET ignores the hold.** `chatKeys.ts:131-144`: the GET checks strength but neither `holdInTx` nor the live-session-under-lock check, and it serves each box every time until someone DELETEs it. The receiving device holds the box after its first GET, so the DELETE is only bookkeeping. As a result, "a hold blocks the handover" and "one-shot" (design 4.2 rule 1, 6.1 test 1) are true of the DELETE only. The probe confirmed a 200 with the envelope during a hold. On this branch a live strong session during a hold is hard to reach, because a recovery-code login ends every session (`recovery.ts:221`) and logins during a hold are refused or end it (`approval.ts:283-292`). So this is defence in depth, and the chatKeys hold test (`chatKeys.test.ts:363-380`) does not cover the GET. Fix now: run the GET's check through `strongCallerInTx` (or at least `holdInTx`) and add the GET to the hold test. When this is bound to the approval (p12-5), make collection atomic on the server: return the box and delete it in one statement, bound to the approval and device cookie, as 6.1 specifies.

4. **[Medium, robustness] Superseding at the same instant breaks the table check, and the 500 logs the row.** `chatKeys.ts:158-161` (and the cap update at `:162-167`) set `expires_at = now`. When an open row was created at that same `now` (two POSTs in one millisecond, or API processes whose clocks differ slightly), this violates `check (expires_at > created_at)` (`500_chat_key_envelopes.sql:26`) and returns 500 (probe-confirmed). The supersede test steps the clock 1 s first (`chatKeys.test.ts:231`), which hides it. The handler then runs `req.log.error({ req, err })` (`app.ts:225`). The pg error's `detail` ("Failing row contains ...") carries the recipient key, the sealed bytes and the session id into the log. That is ciphertext only, but it contradicts "nothing here logs a key or a ciphertext" (`chatKeys.ts:31`). Fix: expire by setting `collected_at`/deleting the superseded rows instead, or set `greatest(now, created_at + 1 ms)`; add a same-instant test.

5. **[Low] Collected boxes are kept, not deleted.** DELETE only sets `collected_at` (`chatKeys.ts:187-190`). Collected and expired rows (sealed bytes included) are swept only when the account next POSTs (`:156`), so they can stay indefinitely. Design 4.2 rule 1 says "deleted when collected or when the approval expires". Fix: delete in the DELETE route, and sweep expired rows in an existing retention job.

6. **[Low] No rate limit on the courier.** POST and DELETE take the account lock and run 3-4 statements each, with no `KeyedBuckets` (compare `approvalDecision`, `chatPost` in `limits.ts:214-220`). Storage is bounded (at most 10 open, swept on the next POST) and the global 16 KiB body limit plus the exact 48..1024 decoded check cover size. Request rate is not bounded. Fix: add a per-session or per-account bucket for the two writes.

7. **[Low, protocol] `sealTo` to a low-order public key throws a plain `Error('invalid usage')`.** I checked this against libsodium-wrappers with the all-zero key and a known order-8 point. The documented contract is TypeError for bad input (`sealed.ts:18-20`). It is not a leak. The API accepts any 64-hex `recipientPublic`, which is harmless because it never seals. Fix: catch it and rethrow as TypeError, and add a test vector.

8. **[Low, for phase 2] Boxes from an older epoch are still served.** POST requires the current epoch (`chatKeys.ts:153-154`), but the GET does not filter by it, and a keeper with no key accepts any epoch. When rotation is built (4.3), bump the epoch and delete the open envelopes in the same transaction.

9. **[Low, web] The v2 upgrade does not handle `versionchange`.** `store.ts:159-169` adds the `account` store without touching existing chat records or the wrap key (tested, `chatStore.test.ts:104`). But no `db.onversionchange = () => db.close()` is set. While an older tab is open, the new worker's open is blocked and fails `unavailable` (retried per message), and the old tab breaks on its next open. This is transient around a deploy. Fix: close on `versionchange`.

10. **[Info] Any strong session of the account can list and collect every box of the account.** That includes boxes sealed to its other devices, so it can delete them before the right device fetches them. This stays within the owner's own strong devices and opens nothing, so it is acceptable for phase 1. It goes away once boxes are bound to an approval.

## Checked and correct

- **Protocol** (`sealed.ts`): `crypto_box_seal` / `crypto_box_seal_open` with the recipient's X25519 box key; `SEALED_OVERHEAD` 48 = `crypto_box_SEALBYTES`; the public key must be exactly 64 lower-case hex; the secret must be 32 bytes and must derive the public key (`crypto_scalarmult_base` with `sodium.memcmp`, constant time) before any opening. The device key is a dedicated `generateBoxKeyPair`, separate from the chat identities, so no key is reused across purposes in the web code. Every failure caused by box content (wrong key, a tampered, truncated or short box, a low-order ephemeral key) returns the same `ProtocolError('not-for-me')`. TypeError comes only from the caller's own key or argument types, never from attacker-supplied bytes, so the distinction leaks nothing. (The two not-for-me messages differ only by the public length check.)
- **Gate**: `keysOffered` is `'strong'` strictly on both sides; null and `weak-single` never pass, and neither does a sign-up's first 30 minutes (`chatKeys.ts:62-66`). The persisted `keys_offered` uses the live caller from `requireLiveSessionInTx`, under the approval and account locks, after the hold check (`approval.ts:576`, `598-599`, `629-633`). The view's flag is advisory only. Weak, null-strength, recovery, member and other-account sessions are refused for GET, POST and DELETE (tests at `chatKeys.test.ts:297-361`). POST and DELETE re-check strength and the hold under the lock.
- **Courier**: stores exactly the posted bytes, never decrypts, the test confirms no plaintext in the row; exact base64url canonical check; 48..1024 bytes both in code and in a table CHECK; 32-byte recipient key CHECK; 10-minute TTL; the newest box per recipient replaces the older one; at most 10 open; POST requires the current epoch; DELETE scoped to `account_id`, UUID-validated; no route reads another account's rows; cascades with the account.
- **Web**: no key, device secret or ACK appears in any message result (tested, `chatAck.test.ts:152`). The account record uses the same non-extractable AES-GCM wrap as the chat records, with its own AAD `x2f-chat/account/v1`, which cannot collide with `x2f-chat/v1\0<chat>`. The keeper serialises every operation. The worker's chat engine and keeper share one store, and the other message handlers ignore `chat-key-*`.
- **Jabber**: `chat_key_envelopes.account_id` is in `NOT_ACCOUNT_CHANGES` (silent), and `chat_key_epoch` is bookkeeping. The recreated `accounts` trigger keeps 334's column list exactly and adds only `chat_key_epoch`. The jabber-paths tripwire passes.
- **Nothing user-visible**: no screen, no copy, no COPY-UNSIGNED string added. The web changes outside the worker are only `keysOffered: false` added to test and e2e fixtures.

## Design deviations to note in the builder's log

The courier is a separate account mailbox (`/v1/account/chat-keys`), not the design's handover blob riding on the approval decision and returned by the poll (6.1). This is acceptable while p12-5 is open. When the gesture lands, though, binding to the approval, atomic one-shot collection and sender authentication (findings 1 and 3) are what make it safe, and the mailbox should either take those on or be retired.

## Questions for the owner

None. Findings 1 and 2 are protocol design for the lead and the Plan 1 Task 3 reviewer. They change nothing that users see.

## Re-verify 7a7d4450 (10 Nov 2026)

Throwaway worktree on `origin/wip/lead-multi-device-build` at `7a7d4450` (11 commits since ce3d54f8), since removed.

**Verdict: every finding is closed, or narrowed to the residual its tripwire names. Fine to land as dormant groundwork.** The stance from the first verdict stands: nothing may wire `open` to a screen, or seal identity records under a handed-over ACK, until the p12-5 sender proof exists (`NEEDS_P12_5_SENDER_PROOF`). The new escrow-store reopen logic is sound.

Tests (serialised runner):
- protocol sealed: 9/9 passed.
- api (chatKeys, accountInactivity, purge, frontDoor, schema, deviceApproval, jabber-paths, coolingOff): 8 files, 301/301 passed.
- web (chatStore, chatAck, chatServeKeys, chatEngine, escrow-store, wallets): 6 files, 92/92 passed.
- `tsc --noEmit` for protocol, api and web: all clean.

Per finding:
- **F1 (91b8e9d0): closed as far as phase 1 can close it.**
  - The keeper takes a box only while a handover it started is pending (`chat-key-device` with `{accountId, epoch}`, a 10-minute window, held in memory only).
  - The box now carries `'x2f/ack/v1' || accountId || epoch (u32 BE) || ACK`, 82 bytes, which seals to 130, inside the 1024 cap. The label, account and epoch inside the box must match the pending handover.
  - The server's epoch outside the box is ignored.
  - A different key at the held epoch is `'conflict'` and is never written. An older epoch is `stale-epoch`.
  - The `NEEDS_P12_5_SENDER_PROOF` note in `ack.ts` is pinned by a test (`chatAck.test.ts:268`).
  - **Residual** (named by that note, not a new finding): the expected epoch comes from the page, which takes it from the server. A party that can seal to the published device key can still plant a key at a *higher* epoch than the one held, and that replaces it. A `conflict` or `wrong-context` box also leaves the handover pending, so more attempts are possible within the window. Both go away with sender proof. Until then, one option for the lead: refuse any box while a key is held, unless a rotation this device saw is under way.
- **F2 (c269ad12): closed.** `chat-key-make` and `chat-key-seal` are answered `refused` before the keeper is even created. The keeper's `makeKey`/`sealFor` stay, reachable only from tests. No page message returns ciphertext of the ACK any more.
- **F3 (d3a323fc): closed.** The GET runs inside `withTx` through `strongCallerInTx`: live session under the account lock, strictly strong, refused with `recovery-hold` during a hold. The hold test now covers the GET. Collection is still client-acknowledged (a DELETE), which is acceptable until binding to the approval.
- **F4 (053307bb): closed.** Superseded and over-cap rows are deleted, not expired at `now`. A test covers the same-millisecond case and the cap at one instant. Correction to my first report: the log was never at risk, because the API's `logError` serializer (`app.ts:199`) already drops the pg `detail`. The new test pins that (no row bytes, no account id, no "Failing row" in the 500's log). The 500 itself was real and is fixed.
- **F5 (8c5b1d97): closed.** DELETE deletes the row. `purgeChatKeyEnvelopes` is in `RETENTION_JOBS` and removes expired rows, plus any collected rows left from before. d46dfb82 erases an account's envelopes in the close transaction (`accountInactivity.ts`), with a tripwire that every file setting `accounts.closed_at` calls `eraseChatKeyEnvelopes`.
- **F6 (7a7d4450): closed.** Per-account `KeyedBuckets` on POST and DELETE (capacity 30, 10 a minute), applied after the session check, return 429 `slow-down`, and are tested. The GET has no bucket; it now takes the account lock per call. This is informational and in line with the other own-data reads.
- **F7 (36f7d075): closed.** A low-order recipient key in `sealTo` is now TypeError, with a test.
- **F8: open, as agreed for phase 2** (rotation is not built).
- **F9 (550c8456): closed.** The chat store closes on `versionchange`, reopens on next use, and fails `unavailable` on a newer database, never hanging. Note: a chat-store reopen after a delete elsewhere *does* recreate an empty database and wrap key. That matches the escrow store's earlier behaviour and is acceptable for chat, because a delete there is a deliberate erase.
- **F10:** unchanged, informational.

The escrow store (12775671), checked closely:
- Only the store's first open may create the database or the wrap key (`openDb(idb, true)`, `wrapKey(..., make = true)`).
- Every reopen after a `versionchange` uses `openDb(idb, false)`. If `onupgradeneeded` fires, which means the database was deleted elsewhere, it aborts the upgrade transaction. Per the IndexedDB spec an aborted upgrade of a newly created database removes it, and an aborted upgrade of an existing one leaves it at its old version with its data intact. The open then fails `unavailable` (`onerror` with `preventDefault`).
- A reopen also refuses when any of `trades`/`secrets`/`keys` is missing, closing the connection first. It refuses when the wrap key is missing, and never puts a fresh key in place (`wrapKey(..., false)`).
- A newer version elsewhere gives VersionError, which is `unavailable`.
- `close()` is final.
- All of these are tested in `escrow-store.test.ts:178-290`: delete elsewhere, never recreated, no fresh wrap key, newer build, close final.
- Within one operation, the wrap key and the db can come from different connections across a reopen. This is harmless, because the key is never re-made, so it is the same key.

Wallets (b9c02676): closed. It reads `trades` by name instead of "the first store that is not the secrets store", which was `keys` and listed `wrap` as an open trade. Its short-lived open still aborts any upgrade, so it never creates the database, and it now also closes on `versionchange`.

Dormancy: the only call site is `escrow/worker.ts:152` (`serveChatKeys`). No screen, engine or `apps/web/src` file outside `chat/` sends a `chat-key-*` message. No user-visible string was added.
