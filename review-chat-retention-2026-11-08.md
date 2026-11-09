# Review: wip/lead-chat-retention (chat retention 30/90 days)

- SHA reviewed: c26869f3, against origin/main (merge base 1ffa1930). Read-only in the review worktree; the mutations ran in a scratch copy.
- Owner rule: origin/comms:owner-decisions-2026-11-06.md, "Chat retention" (8 Nov).
- **Verdict: CHANGES REQUIRED; do not merge as it stands.** The branch's commit says READY, but the full `@x2f/api` suite fails on it (B1). The retention logic itself holds up: only the race in M2 can erase a chat too early, and that needs a system escalation landing on the boundary. Before merge: fix B1, renumber the migration (M1) and take the trade lock (M2). Findings I1 to I4 do not need this branch to change before merge, but each is a launch blocker for the promise "erased for good", and I1 and I4 need owner-level or lead tracking.

## Findings

No Critical findings.

### Blocks merge

**B1. The branch fails the full API test suite: 3 failed, 1863 passed.** `apps/api/test/schema.test.ts:43,108,184` each hold a fixed list of migration names, and the branch adds a migration without adding it to them. All three failures are the single extra line `120_chat_retention_disputes.sql`; the branch does not touch this test file. Fix together with M1: add the migration's final name to all three lists, then run the whole project (`npm test -- --project @x2f/api`, about 5 minutes), not just `chat.test.ts`. Any other branch that adds a migration needs the same, so whichever of this and `wip/lead-cancel-reversal` / `wip/lead-trade-rules-p1` lands second will need its lists merged.

### Important

**I1. Chat keys are not destroyed, only the server's copy of the chat. The owner's rule says "chat keys and messages".**
- `apps/moderation/migrations/002_chat.sql:8` (`mod_chat_identities`: the moderator's secret keys, one row per chat) and `:14` (`signed_chats`): no code deletes from either table. `apps/moderation/src/keystore.ts:146` and `main.ts:377` only insert; there is no `delete` in `apps/moderation/src`.
- `apps/web/src/chat/store.ts:134,153`: the trader's device record (identity secret keys and the plain text of opened messages) has a `delete` that nothing calls.
- Scenario: a chat is purged on day 31. The moderator's secret key for that chat stays in the moderation database with no end date, and each trader's browser keeps the key and the readable messages.
- Fix: this is what the unchecked WIP branch `wip/lead-chat-shred` (3eb636b9) describes ("moderation's shred pass", "the trader's device copy"), but its diff only touches `packages/trade`. It needs finishing and review. Also, that branch rewrites the same lines of `packages/trade/src/chat.ts` with a different field name (`everDisputed` against `disputed`), so one of the two must be rebased on the other.
- Decision for the owner/lead: whether "destroyed" covers the trader's own device.

**I2. No dispute can reach `closed` on this code, so the chat of every disputed trade is kept forever.** (Author flagged; confirmed.)
- `apps/api/src/disputes/timers.ts:58` and `routes.ts:269,290` are the only callers of `applyDispute`, dispatching `window-closed` and `appeal`. Nothing dispatches `executed`, `complied` or `close`, and no route writes a ruling (`dispute_rulings` is only read and updated). `resolveFinal` (`packages/staff/src/dispute.ts:310-312`) leaves an escrow dispute at `final` until `executed` arrives.
- `retention.ts:32` then holds the chat for good (fail-safe: `disputeOpen` true, `chatPurgeDue` false).
- How serious: not a regression today, because rulings are not wired at all, so no dispute on main can end anyway. It is a **launch blocker for the erasure promise**: once traders can open disputes, every disputed chat stays forever unless Plan 4's ruling execution dispatches `executed`/`complied`/`close`.
- Fix: put it on the Plan 4 execution task beside `NEEDS_PLAN_4_RULING_PAYOUT` in docs/coordination.md, with an end-to-end test: dispute, ruling, closed, day 90 + 1 ms, chat gone.

**I3. An after-refund dispute never lets the chat go, even after I2 is fixed.** (Author flagged; confirmed, and it is separate from I2.)
- Opening it sets `state: 'disputed', closedAt: null` (`packages/trade/src/machine.ts:430`). The only exit from `disputed` is `settled` with a transaction hash (`machine.ts:190,494-498`), and an after-refund dispute has no escrow coins to move (`AFTER_REFUND_OUTCOMES`; `dispute.ts:310-317` closes it with nothing executed).
- So `disputes.status` becomes `closed`, but `trades.state` stays `disputed` and `closed_at` stays null. `retention.ts:32` (`r.state === 'disputed'`), `:95`, and `chat.ts` (no `tradeClosedAt`) each keep the chat forever. Dispute rulings on escrow trades always move coins (`ESCROW_OUTCOMES`: release or refund), so this is limited to after-refund disputes.
- How serious: launch blocker, small population (a refund plus a buyer dispute inside 48 hours). `purgeTradeAddresses` (`apps/api/src/trades/purge.ts:29`) has the same hole for addresses.
- Fix: when the after-refund dispute closes, return the trade to `refunded` with `closed_at` set (a machine event; the machine owns this), so every retention and reputation reader works unchanged. Add the test to the Plan 4 task.

**I4. The Terms still promise users 30 days, and the code now keeps 90.**
- `apps/web/src/screens/setup/termsText.ts:31`: "Dispute records are kept for 30 days." `:84`: "Dispute records are kept for 30 days after the dispute closes, then deleted."
- Under the new rule a disputed chat is kept 90 days after the dispute closes, and the owner's reason (staff training, comms decision) is not stated anywhere a user reads. The text is a lawyer placeholder, but it is the current user-facing promise.
- Fix: owner decision on the wording and on saying "training" (rule: no important calls without the owner); then one copy change, also in the lawyer's brief.

### Minor

**M1. Migration number 120 is taken.** `origin/wip/lead-cancel-reversal` has `apps/api/migrations/120_cancel_reversal.sql`. `migrate.ts` keys on the full file name, so both would apply and the order does not matter (trades against a grant on disputes), but two 120s is a collision the numbering exists to avoid. Next free number across `origin/wip/*` and main is 122 (`origin/wip/lead-trade-rules-p1` has 121). Fix: rename to `122_chat_retention_disputes.sql` and update the comment reference in `retention.ts:92`.

**M2. A dispute opening while the purge runs can still lose the chat; the final check does not close this. (The one too-early erasure found.)** `apps/api/src/chat/retention.ts:83` locks only the `chats` row. Opening a dispute (`disputes/routes.ts:238`, `trades/store.ts:374`) locks the trade and inserts a dispute but never touches `chats`. Under READ COMMITTED the final delete (`:93-97`) cannot see an uncommitted dispute and does not wait for it.
- Reproduced on real Postgres in the scratch copy: transaction D sets the trade `disputed` and inserts an open dispute, not yet committed; `purgeChats` returns 1 and the chat is gone; D commits; the dispute is open with no chat.
- Reachability is narrow, so Minor: traders can dispute only inside 48 hours of a refund (`machine.ts:449-451`), far from day 30. Only a system escalation (late funds; `packages/trade/src/watch.ts:62,270`, the watcher stops at 30 days) can land on the boundary.
- Fix, one statement before `retention.ts:83`: lock the trades first, in code order, the same order the take and open-chat paths use: `select 1 from trades where code in (select trade_code from chats where code = any($1)) order by code for share`.

**M3. The purge-role re-check is not tested by itself, and the race test's title overstates it.** `apps/api/test/chat.test.ts`, "a dispute that opens after the scan judged the chat due stops the delete", makes the dispute wait on the chat's row lock, which no real dispute path holds (see M2), and it is stopped by the re-read at `retention.ts:84-85`, not by the delete. Mutations: removing both `not exists` clauses at `:95-96` (mutant A2) survives; removing `disputes_open` from the scan at `:32` (A1) survives; removing both together (A3) is caught by one test only. The protection is real (two layers), but neither layer is pinned alone. Fix: a test that calls `purgeChats` with a custom `due` returning true for a chat with an open dispute, so only the delete's clauses can save it (this one kills A2 alone).

## Notes for the lead and owner (not defects in this branch)

- **The rule's premise differs from the machine.** The decision says a dispute "can be opened in that window [30 days]". In the machine a trader can dispute a closed trade only within 48 hours of a refund (`machine.ts:449-451`) and never after a release. A trader dispute on day 29 or day 31 is refused. The 30 days is therefore mostly spare; only a system late-funds escalation can reopen a trade later. If one lands after the 30 days (watcher kept running because its close time is later than the API's), the chat is already gone and `POST /v1/trades/:code/chat` (`apps/api/src/chat/routes.ts:206-219`) opens a new empty one: within the rule, but the moderator has no history. The owner may want to know this.
- **R36 and the 90-day clock.** `docs/superpowers/rulings-and-lessons.md` R36 and the comment in `migrations/110` count a disputed trade's 90 days from the dispute button; this branch counts from the dispute closing (the lead's reading of the rule). No whole-trade delete exists yet (Plan 7), and `chats.trade_code` has no cascade, so Plan 7 must delete the chat first or be blocked. Record the decision in the rulings file so Plan 7 does not reintroduce the older clock.

## Confirmed safe

Scenarios checked against the code, by test or by mutation:

- Open dispute, and every non-closed status (`open`, `awaiting-approval`, `published`, `appealed`, `final`, `complying`): kept, on a trade that already closed. The appeal window after the coins have moved is kept: `published` is not `closed`.
- Several dispute rows: any row not closed keeps the chat (`still_open`), and the clock is the latest `closed_at`.
- Trade closed after its dispute: the later of the two times counts (mutant T1 caught).
- No close time, disputed with no dispute close time, and every invalid date: kept (T2 caught). Undisputed and disputed boundaries are exact to the millisecond (T3 caught).
- A chat linked to a different trade: `trade_code` is `unique` and a foreign key, one chat per trade, and both queries join on it. Pre-trade chats have a null trade, so the lateral count is 0; the 7-idle-day rule is unchanged and tested.
- The scan and the delete under `x2f_purge` agree. The chat row lock is taken before the role switch (the role has no update right), facts are re-read after it, and `set local role` ends with the transaction. Posting (`routes.ts:151`) and take (`linkChatToTrade`) go through the row lock, so both are serialised (A4 caught). I found no deadlock path: the purge holds only `chats` locks.
- Least privilege: migration 120 grants `select (code, status)`, the only two columns the delete reads. `disputes.note` and everything else stay closed to the purge role, and removing the grant fails 13 tests (A5).
- Cascades: identities, attestations, refusals, work-served and envelopes all go with the chat (`106_chat.sql`), and a test checks the envelopes.

## Tests

- `@x2f/trade` 390 passed, `@x2f/protocol` 220 passed, `@x2f/web` 1306 passed, `@x2f/api` chat.test.ts 43 passed. Full `@x2f/api`: **3 failed, 1863 passed** (78 files, 1 failed), all three from B1. No other project was run.
- Attack tests are real: dropping the channel check (T4), the replay guard (P1) and the `modMayPost` gate (W1) each fail named attack tests. The new tests add coverage; nothing test-only weakens an existing test. The only removed assertions are the old 90-day expectations, replaced by the 30/90 rule with exact boundaries.
