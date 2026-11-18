# Review: wip/lead-mod-chat @6695ff61 (chat membership tasks 7, 8, 9) and the F2-F11 fixes, 18 Nov 2026

Independent crypto and security review for the lead. One round. Range: task 7 is 0bb04fcc (da9e4973..0bb04fcc), the fixes from the t3-6 review are b25bb677 (0bb04fcc..b25bb677), tasks 8 and 9 are 30f6947e and 6695ff61 (b25bb677..6695ff61). Design: `design-chat-membership-keys-2026-11-08.md` (comms). Builder's calls: `docs/security/chat-membership-lead-decisions-2026-11-18.md` on the branch. I read the code in a detached scratch worktree at 6695ff61 and changed no code.

Lead calls taken as settled: the 2-minute wait before a notice on a trader-opened dispute; the 1-minute future limit on a countersign; devices revoked on a security reset; a senior's cases are the trades whose current dispute is assigned to them, or that they have any other log entry on.

## Verdict: CHANGES NEEDED

The cryptography is sound:
- The countersign domain is distinct and NUL-terminated, its exact key set is strictly decoded, and it is verified by the gate's certified signing key over moderation's own recomputed SHA-256.
- The re-wrap goes only to the gate's certified box key.
- The trader grant is re-verified from moderation's own record before its wrap is opened.
- Staff-web checks the attestation, then the trader-signed record's tkh, then the wrap, then every envelope, and never shows a line that fails.
- The gate is wired for real, and it fails closed.

What blocks:
- Two staff-web bugs. The moderator's second message is refused because the chat key is wiped (N1). The API can drop lines from the moderator's read without trace (N2).
- One task 7 liveness bug: one failed post means a dispute never gets its notice (N3).
- After a switch-off or a security reset, the API's view of a person's devices and the gate's view disagree, and nothing in the product gets them back in step (N4).

The rest is LOW or INFO.

## Tests run (scratch worktree at 6695ff61; `nice -n 10`, without the lock, under the 18 Nov lock rule)

| Suite | Files | Result |
|---|---|---|
| `@x2f/moderation` `apps/moderation/test` (incl. grant, internal, gateDeps, gateDevices, grants, notices, shred) | 21 | 287 passed |
| `@x2f/protocol` + `@x2f/staff` + `@x2f/trade` (whole projects, incl. chatV2, intent) | 38 | 1027 passed |
| `@x2f/staff-web` (whole project, incl. caseChat, deviceKey, moderator, webauthnTripwire) | 13 | 117 passed |
| `@x2f/api` chat, chatGrant, chatKeyRecord, chatKeys, staff/devices, staff/matrix, staff/keyTap, staff/securityReset, disputes/staff, disputes/moderationClient, disputes/trader, log, schema | 13 | 422 passed |
| `@x2f/web` chatEngine, chatNotice, chatPanel, disputeGrant (task 7 and the F3-F7 fixes) | 4 | 104 passed |
| `tsc --noEmit` protocol, trade, staff, api, moderation, web, staff-web | 7 | clean |

Not run: the full `npm run check` (it needs the lock, and my verdict is not APPROVE), regtest, and Playwright. The staff-web CSP and the libsodium fallback have never been checked in a browser (see N10).

## Earlier fixes (review t3-6), re-checked at 0bb04fcc..b25bb677

| | Status | What I checked |
|---|---|---|
| F2 | Fixed | Migration 713 adds `refused_at` and `refused_reason`. Moderation reports `chat-grant-refused` by side and signature for `bad`, `unattested`, `wrong-key` and `other-key`. `refuseGrant` marks only that row, and only while it is unaccepted and unrefused. `pendingGrants` skips refused rows. The fallback still treats a refused grant as unaccepted. Tests: 101 refused grants, then a good one, on both the API and the moderation side. |
| F3 | Fixed | `ChatRecord.tkh` is saved in `pin()` before `keys.set` and before anything is sealed. A record with another tkh is `security`, and so is a 404 once a tkh is pinned. The device never mints a second key. Two tests. |
| F4 | Fixed | The engine counts a grant as accepted only when both `v.tkh` and `a.tkh` equal `chatKeyHash(tk)`. Moderation refuses `other-key` once it holds a tkh for the chat. Tests on both sides. |
| F5 | Fixed | The key insert runs under the chat row's `for update` lock (`locked`). The dispute transaction takes `for share` and re-checks `chat_keys`, so the two serialise correctly. Test. |
| F6 | Fixed | The API's window is 10 min back and 1 min ahead. The engine waits from `min(disputeAt, first seen)`. Tests. |
| F7 | Fixed | `forgetKey` fills the key with zeros on erase, on a refused record and on a lost race. No test, which is fine for a fill. |
| F9 | Fixed | The invariant is written next to `ChatGrant` and in the decisions note. |
| F11 | Fixed | `grant.test.ts` has the concurrent test (`Promise.all`: exactly one access row, 200 and 403) and the test that one person's entry cannot be used for another person's device. A concurrent send test is new as well. |

## What checks out

**Task 7 (T2).**
- *Forged notice.* The API stores a notice only when it verifies against the attested moderator identity for this chat's channel and names the current open dispute exactly (seq, `openedAt` to the millisecond, opener). The device verifies the notice itself, against its own attested participants.
- *A device granting with no real dispute.* The device grants only when the API says `disputeOpen` AND the notice verifies.
- *Moderation signs only on its own records.* It must have attested the chat. Its own `mod_chat_trade` must link the chat to that trade, so the API cannot point a notice at another chat. Its own `mod_dispute_seen` must be recent, and it must have no accepted grant and no notice yet for that seq.
- *API alone.* It cannot forge a notice. It can only obtain one for a trade moderation itself saw disputed, and the design's own table accepts that.
- *Dispute substituted by the API.* The seq, opening time and opener are the API's word, as documented. A lying API at most turns a T1 into a T2 or skips the 2-minute wait (N9). It gains no key.

**Task 8 (device certification).**
- *Someone else's device.* The gate refuses a certification whose `accountId` is not the tap's own person (`not-self`). The API binds the tap to the session's person and to these exact keys.
- *Squatting on public keys.* A person can certify another person's public keys as their own. That gains them nothing: re-wraps go to a box key whose secret they lack, and countersigns need a signing secret they lack. The worst case is denial of service on a key id that is not yet certified. INFO.
- *Replaying a certify tap.* The nonce is single use. A refused tap is spent too.
- *More than 3 devices.* Live devices are counted in the gate (expired ones do not count) and in the API.
- *A revoked device coming back.* A certify tap issued before the revocation is refused (`before-revoke`); a later tap may certify it again, as decided. A certify tap issued before the switch-off this gate saw is refused (`before-off`). Revocations are never undone.
- *Switch-off.* A person who no longer stands loses all their devices at every sync, and `deviceLive` re-checks standing at the moment of each grant.
- *Security reset.* Revocation happens in the reset branch.
- *The issuedAt window.* At most 2 minutes ahead and at most 24 hours old, and the 365 days run from it.
- *The device step* leaves every other tap kind unspent.

**Staff-web key storage.**
- The AES-256-GCM key is generated with `extractable: false` and stored as a `CryptoKey` in IndexedDB. Structured clone keeps it non-extractable.
- The record carries an AAD. `identity()` checks that the secret's public half is the stored signing key, and callers wipe the opened identity.

**Task 9 (the grant to staff and the countersign).**
- *Check order.* Every check comes before any use or record. Use and record happen in one statement for a grant and in one transaction for a send.
- *Re-wrap target.* The re-wrap goes to `device.boxPublic` from the gate, never from the request or the API.
- *Re-verified grant.* The trader grant read back through migration 714 is verified again against the attested traders and moderation's own recorded `grant_sig`, `grant_by` and tkh. TK is wiped in `finally`.
- *Who is refused.*
  - A moderator who is not the assignee, a helper (even when assigned), and someone the gate does not know as live staff.
  - A trade whose dispute is not open, or that this process never saw disputed (the owner included).
  - A device that is not certified to this person, or not live.
- *Countersign.* It verifies by the certified signing key. moderation itself supplies `chat`, the request cannot. A `requestId` is single use, the `issuedAt` window is 5 minutes back and 1 minute ahead, `seq` must be exactly next under `for update`, and moderation never decrypts.
- *Tampering with the signed envelope.* The API can change neither `ct` (its hash is signed) nor `seq`. The envelope moderation returns is signed by the moderator identity over every field. The API also checks that seq, nonce and ct are the ones the device sealed. (The nonce is not in the countersign: N7.)
- *Staff-web checks.* The attestation is verified by the pinned key, then `trade` and channel. The trader-signed record's tkh must equal the re-wrapped tkh, so the API cannot hand the device a key of its own. The wrap opens to that tkh. Each envelope must be signed by an attested participant, with `from` equal to the API's `senderRole`, and pass the replay guard. A failure is counted, never shown.
- *Migration 714.* The reader may select `chat, member_kind, granted_by, sig, statement, removed_at` and nothing more: `wrap` and `member_ref` give 42501, and that is tested. Staff rows carry no `statement`.
- *`gateInternalDeps`.* Both questions run on the same store, sync under `store.exclusive` and save. `gateParts` is set inside the gate factory, which `startModeration` awaits before the internal server starts. With no `MOD_STATE_DIR` the server gets neither, and every call is 503. Startup test.
- *p12-11.* The query matches the lead's definition of a senior's cases. With no role given, the view is the narrowest. No staff route calls it yet.

## Tests not weakened

The behaviour changes the builder lists come with matching test changes. I found none that loosens a security assertion:
- **`moderation/test/internal.test.ts`.**
  - Every send is now a real countersigned body (`sendBody`).
  - "No dispute" and "closed" now answer `not-disputed` instead of `log-entry-invalid`, because the dispute is its own check now, after the log entry.
  - "A refused call does not use its entry" is now stricter: a chat this process never attested uses nothing, where before an accepted send used the entry even when no chat was found.
  - The X2F_DEV_MOD_CHAT tests are inverted: any value is now refused, in every NODE_ENV.
  - The no-chat-read test now also forbids `openChat` in the server source.
- **`grant.test.ts`.** The `grant-unavailable` expectations became real re-wraps. Each test now checks that the wrap opens only with the certified device's box key.
- **`api/test/disputes/staff.test.ts`.** The server-side text checks (blank, too long, control characters) moved to staff-web, where `caseChat.test` "refuses a blank, too long or control-character text" covers them. The API cannot read ciphertext, so this is a real move, not a deletion. The `it.todo` for logged reads is now a real test ("with logging failing nothing is granted").
- **`staff-web/test/moderator.test.tsx`.** The send test now asserts that nothing is sent without an opened chat. This is a **coverage gap, not a weakening**: ModCase's open-and-send flow has no component test, because the screen cannot be given a test device key. That gap hides N1.

## Findings

**N1. MEDIUM: staff-web wipes the chat key after the moderator's first message, so the second is refused.**

`ModCase.tsx`:
```ts
useEffect(() => () => { if (opened !== null) forget(opened); }, [opened]);
...
onSent({ ...opened, nextSeq: seq + 1, lines: [...] })   // the same `tk` array
```
The cleanup runs every time `opened` changes, not only on unmount. After a send, the old `opened` is "forgotten", which fills the `tk` array that the new `opened` shares. The next `sealModMessage` finds an all-zero key, throws `CaseChatError('security')`, and the moderator sees a fault. It fails closed, but a moderator gets one message per page load.

Fix:
- Wipe only on unmount, or only when the key itself changes. For example, a `useRef` that tracks the current `opened`, plus `useEffect(() => () => { if (ref.current) forget(ref.current); }, [])`.
- Thread a device loader through `ModCase` and `ChatCard` into `DeviceCard` (it already takes `load`), and add a component test: open the chat with a test device, send twice, and the key is wiped on unmount.

**N2. MEDIUM: the moderator's read shows no gaps, so the API can hide a trader's lines from the moderator without a trace.**

`openCaseChat` decrypts whatever envelopes the API returns, in the API's order, with no per-sender continuity check. The trader engine shows every drop as a gap (`gapBefore: seq > prev + 1`). The design's threat table relies on that: the API "can drop or withhold messages (shown as gaps)". The moderator is the person who rules on the chat, so a quiet drop of the cheater's incriminating line is exactly the attack that matters.

Fix in `chat/reader.ts`:
- Track the last seq per sender (`buyer`, `seller`, `mod`). A first seq above 0, or any jump, marks a gap.
- Return `missing` (a count) and `gapBefore` per line. ModCase shows "n message(s) missing here" on the line (COPY-UNSIGNED, the same pattern as "did not open").
- Tests: a dropped middle envelope, and a dropped first envelope.
- Residual, inherent: the API can still cut the tail of the chat.

**N3. MEDIUM (task 7 liveness): one failed post means a dispute never gets its notice.**

`noticePass` inserts the `mod_chat_notices` row before `postReport`. If the post throws (a network error) or answers anything other than 201 (a 503, a restart), the row stays. Every later pass then skips the candidate (`r.noticed`). No device grants on T2, moderation never holds TK, and no moderator can ever read that chat.

Fix:
- Store the signed notice in `mod_chat_notices` (`notice jsonb`, `posted_at timestamptz null`).
- On each pass, re-post the **same** signed notice while the API still lists the candidate and `posted_at` is null. The API already answers a repeat with 201. Set `posted_at` on 201. Never sign a second notice for a seq.
- Keep "recorded before sent" as it is.
- Test: `postReport` throws once, and the next pass posts the identical notice, which the API stores.

**N4. MEDIUM-LOW: after a switch-off, a removal or a security reset, the API's device view no longer matches the gate's, and there is no way back.**

`liveDevices` (API) knows only certify and revoke taps. The gate also revokes on a switch-off, a removal and a security reset (the reset revocation is a lead-confirmed call). After a reset:
- DeviceCard says "This device can open disputed chats";
- the read answers 403 `device-not-certified`;
- certifying the same key again gets 409 `device-exists`, and a fourth key gets `device-limit`.

So the person must revoke each device with a tap first, and no screen offers that.

Fix:
- `liveDevices` drops every certification whose `issuedAt` is not after the person's latest switch-off, removal or used `reset-staff-security` tap. This mirrors the gate's `before-off`, less the same 2 minutes. The API has `staff_members.switched_off_at` and the log entries; keep the last switch-off time, because `switched_off_at` is cleared on switch-on.
- ModCase maps 403 `device-not-certified` back to DeviceCard's "Confirm this device" state.
- Test: certify, reset, then GET shows nothing, and re-certifying the same key gives 201 and is live in the gate (`issued > revokedAt`).

**N5. LOW: a switch-off and switch-on between two gate syncs leaves the person's devices live.**

Revocation needs the gate to see `switchedOff` at a sync. If the owner switches someone off and back on before the next sync, the switch-on tap applies and the devices were never revoked. In that case "switch-off revokes devices" depends on timing. A device that was the reason for the switch-off survives.

Fix: when the registry applies a `switch-on` tap, call `revokeDevicesOf(g, accountId, now)`, since a switch-on always follows a switch-off. Test: off and on within one sync window, and the device is not live.

**N6. LOW: a refused countersign stays replayable for 5 minutes.**

`mod_countersign_requests` is written only inside the success transaction. A countersign refused for `stale-seq` (or for `gate-unavailable` or `not-disputed`) burns nothing. staff-web then re-seals the same text at the right seq. A compromised API holds the refused one (for example, it told staff-web a `nextSeq` one too high), writes its own `chat.message-requested` entry and submits it once the seq catches up, within 5 minutes. Both traders then see the moderator's message twice, out of order.

Fix: once `verifyModCountersign` passes, insert the `requestId` in its own committed statement, before the seq check. Refuse a seen one with `replayed`. staff-web already uses a fresh `requestId` on its retry. Test: `stale-seq`, then the same countersign at the right seq, gives 403 `replayed`.

**N7. LOW: the countersign does not bind the nonce.**

The signed body is `{chat, seq, ctSha256, requestId, issuedAt}`. The API can swap `nonce`. Moderation then signs, as the moderator, an envelope that no trader can open, and staff-web shows "Sent and logged." The API's own nonce check does not help, because the API is the attacker here.

Fix: add `nonce` to the countersign body (nothing is landed, so `v1` can still change), or sign `SHA-256(nonce || ct)`. Update `makeModCountersign` and `verifyModCountersign`, and add a test that a swapped nonce gives `bad-countersign`.

**N8. LOW: device taps lose against the registry's counter mark; the device counter check is untested.**

`syncDevices` runs after the registry steps and refuses a tap whose counter is at or below the key's mark (`out-of-order`). Suppose the owner taps `certify-device` and then any registry tap (a switch-on, a set-role, an invite) before the next sync. Step 2 raises the mark first, so the owner's certification is refused and spent, and the owner must tap again. No test covers the device step's counter refusal.

Fix:
- Order the device step's taps by counter per key, together with that key's registry taps. Or check the device tap's counter against the mark as it stood before this sync.
- Add a test of `out-of-order` for a device tap.

**N9. INFO: the 2-minute notice wait counts from the API's `openedAt`.**

The lead's call is built, but the clock it counts on is the API's word, so a lying API can skip the wait. It gains only T2 in place of T1, which the design accepts. If wanted, count from moderation's own first sight of the dispute.

**N10. INFO (residual risk, task 10 not built): the key handling in page memory.**

TK sits in React state, and the device secrets pass through the page on each `identity()`. Any script on the staff origin, meaning an XSS or a malicious extension, can:
- read TK of an open case;
- call `decrypt` with the non-extractable AES key and take the device's long-term secrets. Non-extractable protects the key at rest, not against same-origin script.

With those secrets and the staff session, it can open every future re-wrap to that device and countersign as it, for up to 365 days, until the device is revoked. The secrets are also hex strings inside JSON, which cannot be wiped.

Recommendations (lead's call):
- Do not go to production before task 10.
- In task 10, keep TK and the secrets inside the worker and never return them.
- Store the secrets as raw bytes.
- Consider non-extractable WebCrypto Ed25519 and X25519 keys.
- Before landing, run the staff-web Playwright moderator flow under the real CSP. No `'wasm-unsafe-eval'` means libsodium must fall back to its asm.js build, and that is untested.

**N11. INFO: small items.**
- (a) Migration 714's comment says "the moderator's rows", but a column grant covers every row. Add `check (member_kind = 'mod' or statement is null)` so a later staff row can never expose a statement.
- (b) staff-web pins one `VITE_MOD_SIGNING_PUBLIC` with no validity window. Use the trader app's `attestationKeys()` list, so a key rotation does not break older chats.
- (c) `sealModMessage` computes `chatKeyHash(c.tk)` and discards it. Keep the tkh in `OpenedChat` and compare, or drop the line.
- (d) `identity()` does not check that `boxSecret` matches `boxPublic`; `crypto_scalarmult_base` would.
- (e) Staff `chat_members` rows never get `removed_at` on revocation (design section 7, not built). A revoked device's stored wraps stay filed.
- (f) A read returns at most `CHAT_READ_MAX` = 5000 envelopes and does not say when it cuts.

## Exact fixes, in order

1. N1: the ModCase key wipe, plus a component test with an injected device loader.
2. N2: per-sender gaps in `openCaseChat`, shown on the line (COPY-UNSIGNED).
3. N3: store the signed notice and re-post it until 201.
4. N4: `liveDevices` honours switch-off, removal and reset; ModCase routes `device-not-certified` to DeviceCard.
5. N5 to N8: revoke devices on a switch-on tap; burn the `requestId` on any verified countersign; bind `nonce` in the countersign; fix the device counter order and add its test.
6. Before APPROVE on the re-review: the full `npm run check` under the lock, and the staff-web Playwright moderator flow under the real CSP (N10).

## Owner and lead questions

1. **N2 copy:** the moderator sees "n message(s) missing here" where the API dropped lines. It is new user-visible copy, so it is COPY-UNSIGNED until the owner signs it. Recommend yes: the trader side already shows drops.
2. **N10:** should task 9 land on main before task 10 (the worker), with the page-memory risk accepted for now? Recommend: land it, but keep it off in production until task 10 and the CSP browser check are done.
