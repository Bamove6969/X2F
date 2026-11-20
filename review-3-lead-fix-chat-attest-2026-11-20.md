# Review 3: wip/lead-fix-chat-attest @307dedf3 (m1, m3, no new chat for a closed trade), 20 Nov 2026

This is an addendum to `review-2-lead-fix-chat-attest-2026-11-20.md`. It covers 2 commits on top of 4ce573d7: the red tests, then the fix. I read it in a detached scratch worktree and changed no code.

## Verdict: APPROVE

m1 and m3 are fixed, and the lead's API change is sound. The residual of unlocked cross-tab saves is real but not this branch's; a follow-up is suggested below.

### m1: one chat identity per chat across tabs

- **The two-tab probe** with the second tab slower (fake IndexedDB, two connections; the builder's `twoTabs` is exactly my probe, B 40 ms slower):
  - *Without the lock* (store layer alone): both tabs end `registered`, and both stores hold the registered identity.
  - *With the lock*: only one identity is made in all.
  - Revert checks:
    - CAS off (`create` writes with `put`): "two connections at once: exactly one creates" and "without a lock … the stored identity is the registered one" fail.
    - Lock off: "with a per-chat lock … makes none" and "the lock is navigator.locks by default" fail.
- **The CAS is atomic across connections.**
  - `create` (store.ts:275-291) encrypts first, then does `count` and `add` in one `readwrite` transaction on `chats`.
  - IndexedDB never runs two readwrite transactions with overlapping scope at once, across connections too, so the count cannot go stale before the add.
  - `add` would fail on an existing key anyway: the transaction aborts and `create` throws, failing closed, never silently overwriting.
  - Nothing awaits inside the transaction.
- **The lock.**
  - `navigator.locks.request('x2f-chat-identity:<chat>', …)` is exclusive by default, per origin across tabs and workers, and covers load, make, create and register.
  - A browser without Web Locks falls back to the CAS alone, which is still safe, as the first probe shows.
  - The view read before the lock may be stale (`mySignPublic` null after the winner registered). The loser then adopts the stored record: either already registered, or it registers the same key, gets `identity-exists`, re-reads, and the key matches. No dead end.
- **The zeroing frees nothing in use.** It zeroes only the losing tab's own fresh `me` from `newIdentity()`. That object is referenced by nothing else: the record holds hex copies, which `create` did not store. The winner's identity is the one re-loaded from the store.

### m3: fixed

`expect(reads).toBe(2)` pins one view read per ask, and the loop ends after a 404 or 410.

### The API change: no new chat for a terminal trade

`apps/api/src/chat/routes.ts:245-264`:
- The order is unchanged ahead of the new check:
  1. a non-party or unknown trade gets the same `notFound()`;
  2. for a closed trade, `assertNotBlocked` runs (the block's 404);
  3. only then come the linked chat, the pre-trade link, and the new `trade-closed`.
- So the 409 tells only a party of an unblocked pair what they can already see: their own trade is closed and has no chat. It tells a non-party nothing, and a blocked pair nothing beyond what was already true.
- Existing chats keep opening, and the pre-trade chat still links.
- `disputed` and `settling` are not terminal, so they still get a chat. Tests cover all four terminal states, an existing chat, the pre-trade link, and disputed.
- The trade row is held `for update`, so this also closes the device-side residual race from review 2 on the server.
- The ChatPanel empty state ("This trade has no chat.", COPY-UNSIGNED) is checked before the CantDoThat codes, so it is never shown as a refusal.

### The residual: state, cursor and receipt saves are still unlocked across tabs

It matters a little, but not for this branch.
- The engine saves its whole in-memory record (engine.ts:570, 656, 691, 809).
- Two tabs syncing the same chat can overwrite each other with a record loaded earlier. Mostly this costs only re-work:
  - a lost receipt is re-decided on the next read;
  - a stale `state.nextSeq` makes the next post a 409 `stale-seq` at the API;
  - v2 nonces are random, so a reused seq is never a nonce reuse.
- **The one security-relevant case:** a tab whose record was loaded before the other tab pinned the chat key's `tkh` (pin, line 488) can save over it and drop `tkh`. That device then loses review F3's "a 404 once pinned is security" guard for that chat, so a compromised API could later get it to mint a second chat key.
- This needs two tabs on one chat at the moment the key is first pinned, plus a compromised API, and it existed before this branch.
- Suggested follow-up, not blocking: hold the same per-chat Web Lock around each whole `serial` operation (`sync` and `post`), or reload and merge on save so that `identity`, `tkh` and `attestation` never go backwards.

## Tests (nice, no lock)

| Suite | Files | Result |
|---|---|---|
| web: chatEngine, chatStore, chatPrepare, attestation-flow, chatPanel, useEscrow, chatAttacks | 7 | 305 passed in 3 of 4 runs |
| web: useEscrow, attestation-flow (alone) | 2 | 138 passed, 3 of 3 runs |

In one loaded run, `attestation-flow` › "once settle resolved, a reload never calls settle again" failed once, at line 1657 (`intent.done` not yet saved when the phase reads `done`). It did not reproduce in 6 more runs, 3 of them under the same load. It is likely a pre-existing timing flake in the persist after `done`; not traced to this branch's background prepare loop. Worth the runner watching.

Not run: the full `npm run check`, regtest and Playwright. The API's chat.test (the four terminal states) was read but not run here.
