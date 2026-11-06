# Review: Plan 7 Tasks 1-4 (retention rule, whole-trade purge, self-destruct date, Settings → Privacy)

Branch `wip/lead-p7-retention` @ 83fd652, diff base 5c4d35b (merge-base with origin/claude/compassionate-johnson-k95ssr). First review. Read-only. I used a detached worktree (`~/x2f-worktrees/rv-p7`), now removed.

## Verdict: CHANGES REQUIRED

The purge core is sound. Each trade is locked and its facts are read again under the lock. Disputes are locked too. Deletes run in an explicit order with RESTRICT foreign keys, and only x2f_purge can delete; a trigger enforces that. The flag is off by default and only the exact value `on` turns it on. A dispute opened while the purge waits for the lock wins (tested), and so does an appeal.

Two Important findings make what users are shown untrue today (I1, I2). One case of the 48 h after-refund window is not covered (I3). Two seams that must land before `X2F_TRADE_PURGE=on` are not on the recorded list (I4, I5). None of them can delete data today, because the purge is off. I1 and I2, though, ship false statements to users now.

## Important

**I1. While the flag is off, the self-destruct date and "has self-destructed" are shown, but nothing is deleted.**
- Where: `apps/api/src/trades/routes.ts:94`. `deleteAt` is computed whether or not `config.tradePurge` is on. The UI is `apps/web/src/screens/trade/TradeRoom.tsx` (`useSelfDestruct`, the `SelfDestructed` branch) and `SelfDestruct.tsx`.
- Scenario: production runs with `X2F_TRADE_PURGE` off, as decided. A released trade shows "This trade self-destructs on 29 November 2026." On that date the room swaps to "This trade has self-destructed. Nothing about it is kept on this device." The API still holds the trade, its events, identities, attestation (with payout and refund addresses) and disputes, and returns them on GET. The user is told something false about data the server keeps. The user also loses the room for a trade the server still has.
- Fix: return `deleteAt: null` unless `config.tradePurge` is on (pass the flag in through deps or the route options). Better still, have the view say the purge is not active. Add a test with the flag off.

**I2. Settings → Privacy promises things that are not built or not running.**
- Where: `apps/web/src/screens/settings/Privacy.tsx`, lines 26-36.
- Scenario, with the flag off (production default):
  - "Every trade self-destructs 30 days after it ends: the trade, its chat, its proofs and its addresses are deleted" is false.
  - "Nobody can … keep it longer, not even X2F" is false too: X2F keeps every trade indefinitely.
- Scenario, even with the flag on:
  - "Backups are cleared within 14 days, so a deleted trade is gone from them too" promises something unbuilt. `BACKUP_KEEP_DAYS` is Plan 6 D6's recommendation, the owner has not confirmed it, and no backup rotation exists.
  - "with as much private detail blurred as possible" describes Plan 4 work that is not built for dispute records.
  - "Your reviews … stay" refers to Plan 5 reviews, which do not exist yet.
  - The moderation database keeps per-trade rows after the purge (see I5), so "deleted" is not whole.
- Fix: do not route `/settings/privacy` until the flag is on, or gate each statement on what is actually live. Drop the backup line until Plan 6 D6 is built and the owner has confirmed it. Keep COPY-UNSIGNED.

**I3. A disputed trade that ends in a refund gets no protection for the machine's 48 h dispute-after-refund window.**
- Where:
  - `packages/trade/src/retention.ts:88`: `refundDisputeWindowEndsAt` returns null when `disputed`.
  - `apps/api/src/retention/tradePurge.ts:84` passes `disputed`.
- The machine (`packages/trade/src/machine.ts`, around line 413, `onDispute` case `refunded`) still accepts a buyer's `open-dispute` up to closedAt + 48 h on a trade that already had a dispute. Only the never-disputed cancel case is refused.
- Scenario: a dispute is opened on day 0. Its round-2 (final) ruling refunds the seller on day 95, and the refund settles on day 95. `tradeDeleteAt` = opened + 90 days = day 90, already past. The dispute is closed or final, and a round-2 ruling has no `appeal_until`. So the trade is due on the next 10-minute pass, while the machine would still accept the buyer's dispute until day 97.
- The same gap opens with a round-1 ruling whenever settlement lands after `appeal_until`.
- Verified with a scratch vitest in my worktree:
  - `apply(open-dispute)` 24 h after a moderator's `mutual-cancel` refund returns `disputed`.
  - `tradeDeleteDue` for the same facts is true.
- This breaks the module's own claim ("never inside the machine's dispute-after-refund window").
- Fix: return the window for any `refunded` trade with a valid `closedAt`, whether or not it was disputed ("a longer keep is never wrong"). Add a DB test for the case above.

**I4. The purge can delete a trade the moderation watch is still watching (late funds), and liens are not in the gate list.**
- Where:
  - `packages/trade/src/watch.ts:43`: `WATCH_CLOSED_DAYS = 30`, counted from when the moderation service *saw* the latest close, which is never before the API's `closed_at`.
  - The purge: API `closed_at` + 30 days.
- Late-funds scenario: a late deposit arrives just after day 30 by the API clock. The watch, still inside its own 30 days, reports `late-funds`. The API's `escalate` hits a deleted trade (404). The coins sit in the multisig with no trade and no dispute. Because `escalationPending` is set, the watch never ends.
- Lapsed trades: a lapsed trade that closed empty is not in the watch's CLOSED list. It is watched as open forever, and after the purge it has no trade.
- Liens: Plan 4 Task 25 liens (restitution after `seller-returns-fiat` or `seller-sends-xmr`) and trading holds with `dispute_code` will point at a trade or dispute the purge deletes.
- None of these is wired yet (the watch runner, `late-funds` → `escalate` and liens are Plan 4). They are still not on the "before X2F_TRADE_PURGE=on" list in docs/coordination.md, dev-setup.md or the tradePurge.ts SEAMS comment.
- Fix: record both as gating seams. Either:
  - purge only after the watch has dropped the escrow (for example, the moderation service confirms the drop, or the API keeps WATCH_CLOSED_DAYS plus a margin), and make `late-funds` for an unknown code fail loudly to staff; or
  - keep the trade while a lien or hold names it.

  Add tripwires (for example `create table liens`, or a `dispute_code` column on `trading_holds`).

**I5. The moderation database keeps more than the recorded Owed item: `signed_terms` holds payout and refund addresses, amounts and currency per trade.**
- Where: `apps/moderation/migrations/001_mod.sql`, the `signed_terms` table. The attestation's terms come from `TERMS_COLUMNS` (`apps/api/src/internal/routes.ts:68`) and include `buyer_payout` and `seller_refund`.
- The Owed note names only `mod_party_state` and `mod_wallet_secrets`.
- Scenario: the purge runs with the flag on. The API holds nothing, but x2f_moderation still has the trade code, both Monero addresses and the deal terms indefinitely. That contradicts "Deletion is real" and the Privacy copy.
- Fix: add `signed_terms` to the Owed item and to the "before on" gate.

## Minor

- **M1. Device-clock local purge on a stale stored date.** `apps/web/src/main.tsx:18`: `runLocalPurge(Date.now())` uses the device clock, despite the localPurge header ("never this device's own clock alone").
  - The stored `deleteAt` can also go stale: a released trade is later escalated by late funds, so the server's `deleteAt` becomes null, but the device has not reopened the room.
  - Scenario: at start-up the device deletes its local keys for a trade now in an open dispute. Once Task 20 registers its deleter, that includes the chat store.
  - Fix: at start-up, purge a trade only after the server confirms it (404, or a `deleteAt` that is still set and has passed), or use a server time offset.
- **M2. Purge order.** The purge locks the trade and then updates `accounts` (`tradePurge.ts`, around line 170). Any path that locks accounts and then trades can deadlock with it. Postgres aborts one side, so the purge retries on the next pass and nothing is lost. A note in the comment would help.
- **M3. Maintenance.** The purge ignores `site_flags.maintenance_since`. During a long maintenance (trade timers frozen, users unable to act), trades still self-destruct on schedule. Consider skipping purge passes during maintenance, or record that this is intended.
- **M4. Stale comment.** `apps/web/src/screens/trade/SelfDestruct.tsx:8` points to `test/selfDestruct-tripwire.test.ts`, which does not exist. The check is in `test/privacy-tripwire.test.ts`.
- **M5. Weak or missing tripwires.**
  - NEEDS_PLAN_4_TASK_32_LEDGER only requires the string `revenue_ledger` somewhere in tradePurge.ts, so a comment would satisfy it. Require a query on the table instead.
  - Plan 5 running totals and the lost-dispute record (108's own header: "who lost a dispute must survive") have no tripwire. The FK test catches only tables with a foreign key to trades. Add one for `create table` of the running totals.
- **M6. Partial flag documentation.** `apps/api/src/config.ts`: `env.X2F_TRADE_PURGE || 'off'` treats an empty string as off, which is fine. Note in dev-setup.md that the flag is process-global (`setTradePurge`) and that a CLI or tool calling `purgeTrades` directly bypasses it. Nothing does that today.

## Focus answers

1. **Keeping what must be kept.**
   - Covered: an open trade, an open or appealed dispute, a ruled dispute inside `appeal_until`, an unconfirmed buyer's cancel, and the 48 h window on an undisputed refund.
   - The dispute-open race and the appeal race are safe: both lock, and the purge's `now` is the job start, which is conservative.
   - Gaps: I3 (the 48 h window after a disputed refund), and I4 (late funds and the watch, liens), which matters before the flag goes on.
   - A trade still funded on chain: a lapsed trade with coins has `closed_at` null, so it is never a candidate. A closed trade only becomes funded again through the watch (I4).
2. **Leftover data.**
   - Covered tables: trade_events, trade_identities, trade_attestations, trade_refusals, trade_work_served, disputes, dispute_rulings, dispute_appeals, and `chats` (Task 20, by `trade_code`; its child tables cascade).
   - No trade reference: push_subscriptions, nudges, feedback_form (`from_code` is a refusal code, not a trade code), offers, trading_holds (today).
   - API request logging is off (`disableRequestLogging`), and the retention scheduler logs only the job name and a count.
   - Left behind: x2f_moderation `mod_party_state`, `mod_wallet_secrets` (Owed) and `signed_terms` (not recorded, I5). Plan 5 reviews and proofs and Plan 4 liens are future tables, caught by the FK test or by I4's fix.
   - The relay keeps only in-memory queues, dropped when the trade ends.
3. **Displayed date.** The date is computed from the server clock (`deps.clock()`) and shown in the viewer's locale and time zone (`toLocaleDateString`, `dateStyle: long`). The trade room's check uses `serverClock` from `serverNow`. That part is correct. Problems: the start-up local purge uses the device clock (M1), and the date is shown even though the purge is off (I1).
4. **Privacy copy.** Not truthful today (I2).
5. **Migration 701.** Safe on existing data:
   - `add column … not null default 0` is metadata-only, and 0 is the correct starting value.
   - The grants are column-scoped.
   - The DELETE and TRUNCATE triggers refuse everyone but x2f_purge. No source deletes trades or disputes outside the purge.
   - The plain `create index` locks writes briefly, which is fine before launch.
6. **Flag.** The default is off (config default and module default). Only the exact `on` enables it. Any other value stops start-up and names only the variable. A test shows a fresh module touches no row. `main.ts` calls `setTradePurge` before `startRetention`. This is correct.
7. **Tripwires.** They read the local tree only (migrations, src and the design canvas). The Task 20 seam order `purgeChatsJob → purgeFeedbackForm → purgeTradesJob` is recorded in docs/coordination.md (Plan 7, Task 2 seams).

## Commands run

- `npm ci` (pinned npm 11.21.0) in the detached worktree, under flock.
- `flock ~/x2f-comms/check.lock npx vitest run packages/trade/test/retention.test.ts packages/trade/test/zz-review-p7.test.ts`: 2 files, 11 tests passed. `zz-review-p7` was a scratch test confirming I3 and was never committed.
- I did not re-run the full suites (already passed at 83fd652).
