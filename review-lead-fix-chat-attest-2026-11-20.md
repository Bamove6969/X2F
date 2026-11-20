# Review: wip/lead-fix-chat-attest @88224efe (regtest e2e gap 5: the trade chat identity registered when the device runs the trade), 20 Nov 2026

Independent security review for the lead. Range: origin/main 0c5dc3d3..88224efe (3 commits: the red test, the fix, the decisions note). I read it in a detached scratch worktree and changed no code.

## Verdict: APPROVE WITH MINORS (conditional on the closed-trades follow-up, which I have not seen)

The fix adds no key, no format and no envelope. It runs exactly the first sync's identity step, earlier, through the same per-chat queue. The minors are one cross-tab race the fix makes a little more likely (m1) and what the follow-up must do (m2). It needs a short look again once the follow-up lands.

## What I checked

- **No new key, format or envelope.**
  - `ChatEngine.prepare` (engine.ts:810) is `serial(chat, purging(chat, ensureIdentity(chat, getChat(chat))))`. That is `syncLocked`'s first step, unchanged: the same `newIdentity`, the same record v2, the same `signChatIdentity` proof and the same `registerIdentity` route.
  - It reads no attestation, key record or envelope, and seals nothing (test: `reads` is empty).
  - The chat key record (task 5) is still made by the first device to sync after the attestation.
  - `httpOpenTradeChat` is the panel's own `POST /v1/trades/:code/chat`, same-origin with `redirect: 'error'`.
- **Identity timing (the attestation's `identityCreatedAt` bound).** The identity is now made earlier, at trade start, and always before moderation can attest the chat, since attestation needs both registrations. So an attestation's issuedAt is still after `identityCreatedAt`, and the `bad-time` check (packages/trade attestation.ts:363, 438) still holds. TK's invariant (one key per chat from first use) is untouched.
- **The shared-engine queue.** worker.ts now makes one engine per worker (`sharedChatEngine`) for both `serveChat` and the runtime's `prepareChat`. So within a worker, a prepare and a sync of one chat run one at a time.
  - I reverted `prepare` to run outside `serial`, and the test "a prepare and a sync at once make one identity" fails.
  - An engine that fails to start is reset (`chatEngine = null`) and made again on the next use. serve.ts's own retry sees the same promise until then, which is harmless.
- **Two engines or devices.**
  - Two *devices*: the API's first-writer-wins `identity-exists` and the re-read make the loser `other-device`, with nothing sealed. Unchanged.
  - Two *tabs*: see m1.
- **The 410 purge.** `prepare` is wrapped in `purging`, so a 410 from `getChat` or `registerIdentity` erases the local record (test "410 chat-purged erases the record"). A 410 from `POST /v1/trades/:code/chat` ends the preparer as final; there is no local record to erase there, and the worker-start `sweep` still covers stored chats.
- **Retry storms.**
  - The runtime retries only non-final errors (no status, 5xx, 401, 408, 429, an engine that will not start), every `pollMs` (5 s), with its own timer, only while the run lives (`!this.stopped`).
  - That is the same cadence as the run's own API polling, and at most one prepare loop per run. Runs are per trade under `navigator.locks` `x2f-escrow:<code>`.
  - A final refusal or `other-device` marks `chatPrepared` and stops. No backoff, which is acceptable.
  - A stopped run never writes `chatPrepared` (in memory only, kept by the run's next save, R26).
- **The escrow device takes the chat role (lead default).** The device that runs the trade's escrow now binds the account's chat role at trade start. Another device of the account that opens the chat later is read-only (`other-device`), as the second device always was.
  - This is sound: the escrow device is the one that can sign the escrow, and it now also holds the chat identity that sends the payment proof.
  - The cost: a trader who runs the trade on one device but meant to chat on another can only read there. This is an owner question (below).
- **Tests.** The red-first tests cover:
  - asking once the trade identity is registered, before any attestation;
  - retry without blocking the escrow;
  - done kept on resume;
  - never asked on `identity-conflict` or an unconfirmed start;
  - the HTTP shape;
  - `other-device` being final;
  - idempotence, one identity under a concurrent prepare and sync, and the 410 erase.

## Findings

**m1. `apps/web/src/chat/engine.ts:386-418` (`ensureIdentity`), with `apps/web/src/escrow/useEscrow.ts:70` (a dedicated worker per tab): two tabs can still race to make the chat identity, and the device can keep the losing one.** This is pre-existing, for two tabs opening the chat at once. The fix makes it a little more likely: the escrow tab now prepares at trade start while another tab may be syncing the chat.
- The shared engine serialises only inside one worker; two tabs have two workers over one IndexedDB store.
- A scratch probe of two engines over one store preparing at once gave `made: 2`, one `registered` and one `other-device`. In that run the record kept was the registered one.
- Failure scenario:
  1. Tabs A and B both load no record and both make an identity.
  2. A saves, registers and saves `registered: true`.
  3. B, whose identity took longer to make, saves after that and overwrites A's record.
  4. B's registration gets `identity-exists`, and B returns `other-device` without saving.
  5. The store now holds B's unregistered identity, and the API holds A's.
  6. Every later sync on this device sees `mySignPublic` ≠ the stored key and returns `other-device`. No device holds the registered secret any more, so this account can never send in that chat, including the payment proof gap 5 is about.
- Fix (pick one):
  - wrap `ensureIdentity` in `navigator.locks.request('x2f-chat-identity:<chat>')` (the runtime already uses navigator.locks);
  - or save a new record with IndexedDB `add` (fails if one exists) and re-load on that failure.
- Test: two engines over one store, the second's `newIdentity` slower. Afterwards the stored identity must be the registered one.

**m2. Closed trades (the follow-up): the guard must come before `POST /v1/trades/:code/chat`, not only before `prepare`.** At 88224efe, any run that resumes past `registering` without `chatPrepared` calls the preparer. That includes a closed trade that was already in this device's escrow store before this change. For a closed trade with no chat yet, `POST /v1/trades/:code/chat` *creates* a chat row (apps/api/src/chat/routes.ts:235-270: only a block is checked for a closed trade). Then `prepare` registers an identity for it, and moderation may later attest a chat for a finished trade.
- What the follow-up should do:
  - skip when the run's view or record says the trade is closed (or settled or cancelled) before calling the preparer at all;
  - mark such a trade `chatPrepared` so it is never asked again;
  - test that a closed trade makes no `POST …/chat` call.

## Owner question

1. **Device binding:** the device that runs a trade's escrow now takes that trade's chat (lead default); a second device of the same account can only read it. Recommend: keep it. The escrow device is the one that must send the payment proof. Say so in the help library's multi-device entry.

## Tests (nice, no lock)

| Suite | Files | Passed |
|---|---|---|
| web: chatEngine, chatPrepare, attestation-flow, chatStore, chatAttacks, escrow-store, escrowView | 7 | 273 |
| web: signals, useEscrow, chatServeKeys, chatPanel | 4 | 45 |
| `tsc -p apps/web --noEmit` | | clean |

Revert check: `prepare` taken out of the per-chat queue makes "a prepare and a sync at once make one identity" fail. Not run: the full `npm run check`, regtest and Playwright.
