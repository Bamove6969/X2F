# Review: wip/lead-mod-chat @da9e4973 (chat membership tasks 3-6 + groundwork C), 18 Nov 2026

Independent crypto and security review for the lead. One round. Base: main 75f7b5b4. Design: `design-chat-membership-keys-2026-11-08.md` (comms); builder's calls: `docs/security/chat-membership-lead-decisions-2026-11-18.md` (on the branch). Read in a detached scratch worktree at da9e4973; no code changed.

## Verdict: CHANGES NEEDED

The cryptography is sound: domains are distinct and NUL-terminated, the AEAD binds trade/from/seq, every statement is strictly decoded and verified against attested keys, the R16 weakness is fixed for real, and the internal grant route's use-and-record statement is atomic. What needs fixing is around the protocol: one behaviour gap that blocks disputes (F1, a lead/owner call), one liveness bug in the grant queue (F2), and two missing pins on the trader device (F3, F4), plus a small race (F5).

## Tests run (scratch worktree at da9e4973, `nice -n 10`, no lock, per the 18 Nov lock rule)

| Suite | Files | Result |
|---|---|---|
| `@x2f/protocol` (whole project, incl. chatV2.test) | 8 | 246 passed |
| `@x2f/moderation` `apps/moderation/test` (incl. grant, grants, internal, shred, chat) | 18 | 266 passed |
| `@x2f/api` chat, chatGrant, chatKeyRecord, chatKeys, schema, disputes/staff | 6 | 200 passed, 1 todo |
| `@x2f/web` `apps/web/test/chat*`, disputeGrant, tradeRoomChatHash | 11 | 195 passed |
| `tsc --noEmit` protocol, trade, api, moderation, web | 5 | clean |

Not run: the full `npm run check` (needs the lock, and the lead did not ask for it in this round), regtest and Playwright.

## Tests not weakened

- `chatAttacks.test.ts`: the v1 R16 test ("the mod cannot tell") is kept unchanged as v1's weakness. A new test asserts the flip: under v2 the later member reads the same text, and a message under another key opens for nobody.
- `chatEngine.test.ts`: only 2 `expect` lines were removed. One is "the mod identity opens the sent message", replaced by the opposite claim the design requires (the mod holds no copy before a grant). The other is `checkChatEnvelope(...)`, now `checkChatEnvelopeV2(...)`. The rest are v1 to v2 conversions, and the account-B injection tests are still there under v2.
- `chatNotice`, `internal.test` (FakeApi gains actor fields and `disputeAssignee`), `shred.test` (more rows checked) and `schema.test` (two migrations appended): nothing loosened.

## What checks out

- **Domain separation.** The domains are `x2f/chat-key/v1\0` (tkh hash), `x2f/chat/v2\0` (AD), `x2f/chat-envelope/v2\0`, `x2f/chat-key-record/v1\0`, `x2f/chat-grant/v1\0`, `x2f/chat-dispute-notice/v1\0` and `x2f/chat-grant-accepted/v1\0`. They are all distinct from each other and from v1's `x2f/envelope/v1\0`, `chat-identity`, `relay-*`, `ruling-statement` and the rest. Every signature covers domain + canonical JSON of an exact key set, and `v` is in each body. A trader-signed record cannot pass as a grant, and a mod-signed notice cannot pass as an acceptance (different domains and key sets; tested).
- **AD.** It is `trade\0from\0seq`. `trade` must equal the pinned channel (printable ASCII, no NUL), `from` is a role and `seq` a safe integer, so the AD is unambiguous. Binding `from` in the AEAD is what stops a member who knows TK from re-sending another member's ciphertext under their own signature (tested).
- **Nonces and keys.** Each message has a random 24-byte XChaCha nonce. TK is used only for the AEAD and for the tkh hash, under its own domain. Each wrap is `crypto_box_seal`, with a fresh ephemeral key. `unwrapChatKey` checks tkh with `memcmp` and zeroes the key on a mismatch.
- **v2 open order.** Shape, then trade, then participant, then signature, then AEAD, then canonical parse, with the replay guard committed last. This is the same order as v1.
- **Downgrade.** The API takes only v2 once a chat is keyed (and only v1 before). The engine is v2-only whatever the API says: v1 envelopes get refused receipts and are never shown. The dev v1 moderator send is refused in a keyed chat before anything is logged (decision 9). No path shows v1 in a keyed chat.
- **A key record substituted by the API.** A record must be signed by the attested trader it names, for this channel, and this device's own copy must hash to its tkh. Otherwise the chat shows `security`. A creator who wraps different keys to buyer and seller is caught. (See F3 for the pin that is missing across sessions.)
- **A forged acceptance.** The engine and the API both verify it against the attested moderator identity, bound to `grantBy` and `grantSig`. The API cannot forge one, and the API's `acceptGrant` also matches `tkh` and `sig` on the stored row.
- **Dropping the moderator's wrap.** A dropped wrap or a garbage wrap means no acceptance, so the counterparty grants after 2 minutes. An API that drops both grants is only denial of service, as the design says.
- **The fallback without a dispute.** The engine needs `disputeOpen` plus the other side's grant, signed by that side's attested identity for this chat. The API needs `trades.state = 'disputed'`, the other side's stored grant unaccepted, and no grant yet from this side. Such a grant exists only if that trader pressed Dispute: `openDispute` makes it only after a `grant-required` answer to a submitted dispute.
- **A grant for another chat or trade.** `chat` is the channel, checked everywhere. A chat links to at most one trade (`linkChatToTrade ... where trade_code is null`), and a trade has at most one dispute, so the grant's missing trade/dispute binding is safe today (F9).
- **The key leaving worker memory.** TK lives only in the engine's `keys` Map. `sync` returns `snap` only. `chat-grant` returns the signed grant, whose only secret is the mod wrap. `ChatRecord` has no key field (tested). Moderation zeroes TK right after the tkh check and stores only `mod_chat_grants` (no key), which the shred pass deletes.
- **What moderation checks before accepting.** All of it comes from its own `signed_chats` and its own keystore identity: the chat is attested and the channel matches; the record and the grant are each signed by their attested trader; the grant's tkh equals the record's; the wrap opens to that tkh. It is right that it ignores the API's view of the dispute here.
- **`/internal/chat/grant`.** The order of checks matches the decisions. The log entry must be `chat.read`, of this trade, within 60 s (plus 30 s of skew), unused, with actor kind `staff` and exactly this account. The dispute must be open in the API's view and seen by moderation itself (`mod_dispute_seen` within `CHAT_AFTER_DISPUTE_DAYS`), and the owner is not exempt (p12-1). The person's role comes from the gate, never the API. A helper is never on a case, and a switched-off assignee has no standing. The device key id must be certified (none are yet). The chat must be attested.
- **Atomicity of the internal grant.** The data-modifying CTE `insert into used_log_entries ... on conflict (id) do nothing returning id` feeds the `mod_chat_access` insert in one statement (one implicit transaction):
  - a concurrent replay blocks on the first insert's tuple, then inserts nothing, so `rowCount = 0` and the answer is 403;
  - the FK from `mod_chat_access` to `used_log_entries` is checked at the end of the statement and sees the CTE's row;
  - a failure of either insert rolls back both.

  This is atomic against replay. (Only a sequential replay is tested; see F11.)

## Findings

**F1. HIGH (a lead/owner call before main): `grant-required` blocks every dispute from a device without the chat key, and T2 is not built.**

`disputeGrant` refuses a keyed trade's dispute without a grant (400). The page then asks the worker. A device in `other-device` (a new phone, or a Tor Browser that cleared IndexedDB on close), a team member, or a trader who lost their device gets `not-ready`, so the dispute cannot be opened at all. The design covers these disputers with T2 (task 7), which is not on the branch. A scammed buyer who switched devices could not dispute.

Fix, either of these (it is a behaviour and security trade-off, so the lead or owner picks):
- (a) Do not land task 6's `grant-required` on main before task 7. **Recommended.**
- (b) As an interim, let the page send `grant: null` when the worker answers `not-ready`. The API opens the dispute and files a `no-grant` marker. The counterparty's fallback then also fires on "disputed and the disputer filed no-grant". That is weaker than T1 by proxy: the counterparty acts on the API's word alone, with no moderator notice, so it needs the owner's yes and a visible banner.

**F2. MEDIUM: the grant queue starves behind grants that never verify.**

`pendingGrants` is `order by m.id limit $1` (`WORK_LIMIT` = 100) over every unaccepted row. A refused grant stays unaccepted forever (until the chat purge): moderation logs `chat-grant-bad`, `chat-grant-wrong-key` or `chat-grant-unattested` and tells the API nothing. Once 100 such rows exist (cheaters' garbage wraps, or chats moderation can no longer open), every later grant, honest fallbacks included, sits behind them and is never accepted. Disputes then proceed with no moderator copy.

Fix:
- add `refused_at timestamptz` to `chat_members`;
- moderation reports `{kind:'chat-grant-refused', chat, grantBy, grantSig, reason}`, and the API sets `refused_at` only for that exact row;
- `pendingGrants` excludes refused rows, or at least orders by a `last_served_at` rotation as chat-shred does (review M4);
- the fallback treats a refused grant as unaccepted (optionally without the 2-minute wait).

Test: 101 garbage grants, then a good one, and the good one is accepted within one pass.

**F3. MEDIUM: the device does not pin tkh across worker starts, so the API alone can change the chat key mid-chat.**

`chatKey()` re-reads `GET …/key` at every worker start. If the API answers 404, the device makes a fresh TK and posts a new record. If the API serves another validly signed record (one the API made this device mint earlier, or a cheating counterparty's second record), the device accepts it. This breaks the invariant that TK is the same from M1 onwards (design 2.4). Lines read under the old key silently vanish, and a later grant covers a key different from the one the device read under, so the API can hide earlier lines from the moderator without leaving gaps.

Fix:
- add `tkh?: string` (public) to `ChatRecord`, and save it on the first accepted or posted record, before any seal;
- afterwards, a fetched record's tkh must equal the pin, or the chat shows `security`;
- a 404 `no-key` once a tkh is pinned is also `security`; never mint again.

Tests: a swapped record after a restart gives `security`, and a 404 after a pin posts nothing.

**F4. LOW-MEDIUM: the engine's fallback does not check tkh on the other side's grant or on its acceptance.**

`fallbackGrant` counts an acceptance whenever it verifies against the mod identity and matches `grantSig` and `grantBy`. Picture a cheating disputer working with a compromised API. The disputer grants an unrelated key X, with a valid wrap, signs a second record for X, and the API serves that record to moderation. Moderation then honestly accepts a grant for X, and the honest counterparty, seeing a valid acceptance, never grants the real TK.

Fix in `engine.ts`:
- compute `mine = await chatKeyHash(tk)`;
- count the other side's grant as accepted only when `v.tkh === mine && a.tkh === mine`; a grant with another tkh counts as unaccepted.

Also in moderation `grantPass`: once `mod_chat_grants` holds a tkh for the chat, refuse to accept a grant whose tkh differs. Test: an accepted grant of another tkh still triggers the fallback.

**F5. LOW: a race in the dispute route (`apps/api/src/disputes/routes.ts`).**

`disputeGrant(deps.db, …)` decides "keyed or not" outside the dispute's transaction. A key record posted between that check and the commit lets a keyed chat's dispute open with no grant, and then no fallback is possible either, because the fallback needs the disputer's grant.

Fix: inside the `applyEvent` callback, re-check `select 1 from chat_keys where chat = $1 for share` on `client`, and throw 400 `grant-required` if a key appeared while the earlier check saw none. Or run `disputeGrant(client, …)` inside the callback.

**F6. LOW: a cheating disputer can stretch the fallback wait.**

`GRANT_FALLBACK_MS` counts from the disputer-signed `disputeAt`, which the API accepts up to 10 minutes in the future. A cheater can therefore delay the counterparty's grant to about 12 minutes.

Fix: make the API's window asymmetric (`disputeAt` at most 10 min in the past and at most 1 min in the future), and/or have the engine wait from `min(disputeAt, the time this worker first saw the grant)`.

**F7. LOW: TK is not wiped on erase.**

`erase()` does `keys.delete(chat)` without zeroing the key.

Fix: `const k = keys.get(chat); if (k) sodium.memzero(k);` before the delete, and the same wherever a key is replaced. Moderation already does this.

**F8. INFO: the gate is not wired in production.**

`main.ts` passes neither `staff` nor `devices` to `startInternalServer`, so `/internal/chat/grant` answers 503 `gate-unavailable` in production before reading anything. That is fail-closed and fine for now. But the decisions note reads as if the gate already supplies the directory. Wire `gateStaffDirectory(gate)` in task 8 or 9, with a startup test, or say plainly in the note that it is unwired.

**F9. INFO: the grant does not name a trade or a dispute seq.**

This is safe only because a chat links to at most one trade and a trade has at most one dispute. Write that invariant in `chatV2.ts` next to `ChatGrant`. If re-disputes or chat reuse ever come, add `trade` and `disputeSeq` under `x2f/chat-grant/v2\0`.

**F10. INFO: v1 slots and v2 wraps are interchangeable.**

The same chat-identity X25519 key opens v1 slots (`crypto_box_seal` of a 32-byte K, 80 bytes) and v2 wraps (a sealed 32-byte TK, also 80 bytes), with no domain inside the seal. This is harmless today, because no path opens attacker-supplied v1 envelopes with a chat identity and hands back the key or plaintext. Keep it that way: any future moderation read path must be v2-only, or must refuse v1 for a keyed chat.

**F11. INFO (test gap): add a concurrent-replay test.**

Send two identical `/internal/chat/grant` requests through `Promise.all` and expect exactly one `mod_chat_access` row, one 503 and one 403. Also test that a staff member's log entry cannot be used for another person's device (the actor check covers it; keep a test).

## Owner and lead questions

1. **F1:** land tasks 6 and 7 together (recommended), or ship the interim "no-grant" fallback with a banner?
2. The p12-1 and p12-4 constants (`OWNER_NEEDS_DISPUTE`, `SENIOR_OR_OWNER_JOINS_ANY_CASE`) are built as recommended and marked `// OWNER: p12-x`. I found no `OWNER: p12-11` marker in the code, though the decisions note lists p12-11 among those built to the recommendation. The lead should check: p12-11 is the audit log's visibility, which belongs to task 12, so a missing marker may simply mean it is not built yet.
