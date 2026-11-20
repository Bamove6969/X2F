# Review: wip/lead-chat-tab-lock @9b7aab47 (the review-3 follow-up: a per-chat Web Lock per whole operation, merge-on-save; the escrow's done after its save), 20 Nov 2026

Independent review for the lead. Range: f777c98a..9b7aab47, 3 commits (two red tests, then the fix). f777c98a is the approved chat-attest branch merged with main 0910dc62. I read it in a detached scratch worktree and changed no code.

## Verdict: APPROVE WITH MINORS

Both fixes do what they claim, each guard's test fails when the guard is reverted, and nothing deadlocks. Three minors, none blocking.

## What I checked

**The lock (`apps/web/src/chat/engine.ts:318-333`).**
- `serial` takes `x2f-chat-identity:<chat>` once around each queued operation, after this engine's own per-chat queue. So within a tab the operations queue first, and across tabs the Web Lock orders them.
- **Deadlock.** The lock is not re-entrant, so I traced every caller:
  - `serial` is called only at the top level of the public methods: `sync`, `prepare`, `grant`, the sweep's per-chat `getChat`, and `post` (send, sendPay, sendProof, sendUnblurred, sendNotice).
  - Inside an operation, the code calls `syncLocked`, `ensureIdentity`, `chatKey` and `keep`. None of them calls `serial` or the lock. `ensureIdentity`'s own lock from the m1 fix is removed, which was necessary.
  - `grant` runs `syncLocked` directly, and `post` re-syncs with `syncLocked` after posting.
  - The sweep runs its chats one after another, each in its own operation, and is never called from inside one.
  - The escrow runtime's `prepareChat` calls the shared engine's public `prepare`. It holds the separate `x2f-escrow:<code>` lock, and no chat operation ever takes that one.
  - The key keeper (`serveChatKeys`) takes no chat lock.
  - So no path asks for the lock while holding it.
- Revert check: with `serial` unlocked, the lock tests fail ("with a per-chat lock … makes none", "the lock is navigator.locks by default").

**Merge-on-save (`keep`, engine.ts:354-382).**
- Each save of an existing record reloads the stored one and fails closed (`bad-signature`) on another stored identity or on another pinned `tkh`. `registered` only goes forward. `tkh`, `attestation` and `identityCreatedAt` keep the stored value once there is one. The rest (`state`, `cursor`, `receipts`) is this operation's.
- Every former `store.save` of an existing record now goes through `keep`. New records still use `store.create` (the compare-and-set).
- In `pin`, a `tkh` mismatch from `keep` wipes the key it was about to cache (`tk.fill(0)`) before throwing.
- Revert check: with `keep` turned into a plain save, "a stale tab never drops the pinned tkh: the record is merged on save (no lock)" and "a stale tab that the API then tells 'no key' (404) makes no second key" fail. F3 holds again across tabs.

**Purge resurrection.**
- Every `erase` runs in `purging` inside `serial`, so under the lock. A tab that comes second waits, then reads the API, gets 410 and erases too.
- `keep` would re-create a record it finds deleted (`stored === null` → save). With Web Locks this cannot interleave with an erase. Without them (an old browser), the re-created record is erased again by the next API call, which answers 410 for a purged chat. So it is bounded, but see m1.

**`doneUnsaved` (`apps/web/src/escrow/runtime.ts:964-972`, `1009`).**
- `done` shows only once the settled intent's save has resolved.
- The flag is set and cleared around one `persist()`, which is caught (`.then(() => true, () => false)`), so a failed save clears it too. A persist that never resolves would keep the phase at `signing`/`ready`, but no settle is repeated:
  - `intent.done` is already true in memory;
  - `inflight` still holds the outcome key;
  - the tick's settle gating reads `done`, not the shown phase.
- So it cannot stall a settle or double one; at worst, with an IndexedDB that never answers, the screen waits.
- Revert check: without the flag, "the done phase shows only once the settled intent is stored (a slow save, a tick in between)" fails. That is the attestation-flow flake I saw on 20 Nov.

## Findings

**m1. `apps/web/src/chat/engine.ts:363-366` (`keep`, `stored === null`): a save that finds no stored record re-creates it.**
- `keep` is only for records that already exist; new ones go through `create`. So a missing record means it was erased: a purge, or another tab's erase.
- Failure scenario (no Web Locks):
  1. Tab A erases on a 410.
  2. Tab B, mid-sync, saves its record back, including the identity's secret halves.
  3. That copy stays on disk until B's next API call erases it again.
- This goes against the purge rule (p11-10) for that window.
- Fix: there, throw a purged error (`Object.assign(new Error('chat-purged'), { status: 410 })`) or a security error, instead of saving.

**m2. `engine.ts` (`keep`'s identity-mismatch failure, and `bad-signature` from the cursor and state saves): the fail-closed path leaves this chat's cached TK in memory.**
- Only `pin`'s own path wipes its key. When `keep` throws later in a sync (the cursor or state save), `keys.get(chat)` is still filled. Every later operation fails at `keep` again, so nothing is sealed, but the key stays resident in the worker until erase or reload.
- Fix: in `keep`, call `forgetKey(rec.chat)` before throwing.
- The mismatch is unreachable with Web Locks plus `create`, so this is defence in depth.

**m3. `apps/web/src/chat/http.ts` (`httpChatApi`): the chat API calls have no timeout, and each one now runs while holding a cross-tab Web Lock.**
- Failure scenario: one tab's fetch hangs on a stalled connection. Every tab's chat operations for that chat, and the escrow's `prepare`, wait until the browser gives up on it, which can be minutes.
- Before this change only that tab's own queue waited.
- Fix: the bounded `AbortSignal.timeout(...)` that the escrow adapters (`apps/web/src/escrow/adapters.ts:138-144`) already use.

## Tests (nice, no lock; Playwright under the lock)

| Suite | Files | Result |
|---|---|---|
| web: chatEngine, chatStore, chatPrepare, attestation-flow, chatPanel, useEscrow, chatAttacks, disputeGrant, chatProofSend | 9 | 322 passed |
| revert checks: merge off; lock off; doneUnsaved off | | each failed its own tests (2, 2, 1) |
| Playwright web chat.spec (under the lock) | 1 | 4 passed |

Not run: the full `npm run check` and regtest.
