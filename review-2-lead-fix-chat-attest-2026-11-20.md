# Review 2: wip/lead-fix-chat-attest @4ce573d7 (closed trades never prepare a chat), 20 Nov 2026

This is an addendum to `review-lead-fix-chat-attest-2026-11-20.md`. It covers 2 commits on top of 88224efe: the red test, then the gate. Read in a detached scratch worktree; no code changed.

## Verdict: APPROVE WITH MINORS (m2 is closed; m1 from the first review is still open; one new minor, m3)

- **m2 (closed trades) is fixed.**
  - Each try in `TradeRun.prepareChat` (runtime.ts:517-534) first reads the trade view and returns, asking nothing, for every terminal state: `CHAT_CLOSED` is released, refunded, cancelled and lapsed. Against `packages/trade/src/machine.ts`, that is every terminal `TradeState`. `disputed` and `settling` are rightly not in the list.
  - A 404 or 410 from the view read also ends it.
  - Nothing is marked done, so a closed trade costs one view read per run start. The run reads the view anyway.
  - A trade that closes while the ask is being retried stops at the next try.
  - Revert check: with the state gate disabled, the four tests "a released / refunded / cancelled / lapsed trade is never asked for" fail.
- **The race the builder documents** (the trade closes between the view read and `POST /v1/trades/:code/chat`) is real but small: one chat row, plus at most one identity registration, for a trade that closed in that window. It reveals nothing and makes no key. The panel could already create the same row.
- **m1 (open).** Two tabs (two dedicated workers over one IndexedDB store) can still race in `ensureIdentity` and keep the losing identity. The fix is unchanged: a `navigator.locks` lock per chat around `ensureIdentity`, or an add-if-absent save.
- **m3 (new). `apps/web/src/escrow/runtime.ts:531` (`if (status === 404 || status === 410) return;`) has no test that fails without it.**
  - With that line disabled, every test still passes. The test "a trade gone from the API … is never asked for" only checks that nothing is asked, which a retry loop also satisfies.
  - Failure scenario: a refactor drops the line, and a run for a trade the API no longer has re-reads it every 5 s until the run stops.
  - Fix: assert that the view is read once and the loop ends (for example, no second `getTrade` after the poll interval).

## Should the API refuse to open a chat for a closed trade? (separate change; the lead's call)

Recommendation: **yes, refuse to create a new one; keep answering an existing one.**

In `POST /v1/trades/:code/chat` (apps/api/src/chat/routes.ts:235-270), when the locked trade row has `closed_at` set and no chat is linked (neither `chats.trade_code` nor `linkChatToTrade` finds one), answer 409 `trade-closed` (or 404) instead of inserting.
- **Why:** a chat that never existed while the trade was open holds nothing anyone needs: no lines, no key, nothing for a moderator. Refusing it on the server closes the builder's residual race for every client, not only this device's gate. It also stops a modified client from making attested chats for finished trades, which moderation would otherwise attest and keep.
- **What must stay:** an existing chat of a closed trade must still open. Its history, a dispute or appeal still running on it, ruling compliance, and the 410 purge path all use it.
- **Cost:** the trade room's chat panel on a closed trade that never had a chat needs an empty state. That is new copy (COPY-UNSIGNED), so it is a product call.

## Tests (nice, no lock)

| Suite | Files | Passed |
|---|---|---|
| web: attestation-flow, chatEngine, chatPrepare, useEscrow, signals, escrow-store | 6 | 258 |
| `tsc -p apps/web --noEmit` | | clean |

Not run: the full `npm run check`, regtest and Playwright.
