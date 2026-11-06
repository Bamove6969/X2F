# Re-review: wip/lead-p3-task27 @ef50dfa (Task 27 fix round): CHANGES REQUIRED (helper reviewer, 2026-10-28)

**Scope.** The fix round is 6072e3b (merge of main line a3a7d7f) through ef50dfa. I compared it against the first review (`~/x2f-comms/review-task27-2026-10-27.md`) and the fix-round record (`docs/superpowers/reviews/2026-10-27-p3-task27.md`). I also read the main line at 9123b4f, Plan 4's and Plan 7's Revision 2026-10-28 text, `origin/wip/lead-p3-task22-land` @fc534fe and `origin/wip/lead-p3-task4` @2a37fbd.

**What I ran.** All runs used Node 24, docker, and `flock`, in a detached worktree that has since been removed.
- api vitest, four files (`disputes`, `purge`, `schema`, `logs`): 89/89 pass.
- web vitest, four files (`dispute.test.tsx`, `dispute-tripwires`, `moderator-badge-scope`, `app-routes`): 31/31 pass.
- A throwaway probe test, not committed, that confirms both Important findings below.

## Verdict on the first review's findings

| # | Status | Notes |
|---|---|---|
| I1 system escalation has no row | **Fixed, atomic** | `openSystemDispute` runs inside `applyEvent`'s own transaction (trades/store.ts:327). It runs after the trade UPDATE and the `trade_events` insert and before COMMIT, with the trade row locked FOR UPDATE. A crash or throw anywhere rolls back all three writes, so a trade can no longer be `disputed` without its row. Every escalate goes through `applyEvent`: Task 9 IO (`wip/second-p3-task9-io`) does not wire escalate yet, and `index.ts` exports `applyEvent` for it. Web: `disputeScreenFor` never shows DisputeOpen for a `disputed` trade. The new data loss on re-escalation is a separate finding (Important 1 below). |
| I2 retention | **Partly fixed; new problems** | `closed_at` and its check are correct. The purge job, the cascades and the footer settle a retention policy that is still open, and they break other rules (Important 2). |
| M3 appeal gated on `ruled` | Fixed | DisputeRuling.tsx:53 |
| M4 DisputeEntry after a disputed refund | Fixed (client) | The server-side gap is in Important 2(b). |
| M5 NUL and control characters | Fixed | routes.ts:91-92. Tests cover the note and the appeal. |
| M6 log hygiene | Fixed | logs.test.ts passes. |
| M7 live re-read | Fixed for the main line | It breaks on the Task 22 landing; see "To land", item 3. |
| M8 badge-scope strings | Fixed | |
| M9 back links | Fixed | |
| M10 e2e harness | Fixed | Uses `PHONE_VIEWPORTS`, `expectParity`, `KNOWN_EXCEPTIONS` with reasons, and 32 px tap boxes. |
| M11 notice before a moderator joins | Fixed | COPY-UNSIGNED. |
| M12 confirm window | Deferral accepted | |
| Merge 6072e3b | **Correct** | app.ts:237-240 creates one `tradePublish` and passes it to both route sets, and a test shows one `open-dispute` publish. The schema list order is right, App.tsx keeps main's routes plus the dispute route, and `events-route.test` was moved to `propose-cancel`. NEEDS_TASK_3 retired; NEEDS_PLAN_4_MOD_COSIGN re-aimed. |
| Migration numbers | **No collision** | Task 4 uses 102 (`102_offers`), Task 20 has 106 reserved, Task 27 uses 108 and 110, Task 8 / Task 9 IO use 111 (`111_trade_identities`), and Plan 4 uses 2xx. The migrator applies by name and fills gaps, so 110 arriving after 111 on an existing database is fine. 110 only alters 108's tables. Cross-task: Plan 4 Task 23 plans `2xx_dispute_purge.sql` (and Task 10 plans `207_disputes.sql`), and both overlap 108/110 (Important 2(d)). |

## Important

### 1. A re-escalation deletes an earlier dispute's ruling, appeal and note at once, even when that dispute is not closed

- **Where:** apps/api/src/disputes/store.ts:13-22.
- **What it does:** `openSystemDispute` runs `delete from dispute_appeals`, then `delete from dispute_rulings`, then upserts the `disputes` row. The upsert sets `note = ''`, clears the moderator, and resets `status = 'open'` and `closed_at = null`. The only guard is the trade's state. The earlier dispute's own status is never checked.
- **Failure scenarios:**
  - **This is a designed path, not an edge case.** watch.ts:31-34 says "each late tx escalates once, so a second batch after a ruling escalates again". So a system dispute that was ruled and settled, followed by a second late batch, wipes the first ruling.
  - **Probe result.** A buyer-opened dispute gets a round-2 ruling (`release-to-buyer`, status `final`, *not* `closed`). The trade is released. Late funds then escalate it. Result: **0** rulings left and the trader's note becomes `''`.
  - **Spec and owner rules broken:**
    - Spec 4.1 / HANDOFF:123 keep dispute records until 30 days after close.
    - The owner's rule of 2026-10-27 (HANDOFF:200; Plan 4 Revision 2026-10-28) says a dispute keeps its information until it is resolved. Here a `final` dispute is destroyed before it is closed.
  - **Lost-dispute fact is erased.** The earlier ruling is the only record of who lost. Task 4's stage rule ("a lost dispute drops the account back one stage", spec line 91), Plan 5's "Clean record", and the ruling footer's "It appears on your profile as a lost dispute" all need that fact. A late deposit therefore wipes the loser's penalty.
  - **The moderator loses context.** Whoever handles the new escalation can no longer see the earlier ruling on the same escrow, and Plan 4's moderator needs exactly that.
  - **Appeal right can be lost.** If Plan 4 executes a round-1 ruling while the appeal window is still open (trade `released`, dispute `ruled`), a late deposit wipes the ruling and the appeal right with it.
- **Fix (cheap now, because 108 is not on the main line and holds no data):**
  - Give each dispute its own identity: `seq smallint` (or `id bigserial`), primary key `(code, seq)`. Rulings and appeals reference `(code, seq)`. The "current" dispute is the highest `seq`.
  - `openSystemDispute` inserts a new `seq` and never deletes anything. It may set the earlier dispute's `closed_at` if Plan 4 has not closed it, but only once the lead decides that.
  - GET reads the latest `seq`.
  - Fold the change into 108 rather than layering more ALTERs into 110.
  - Fallback if the lead wants the smallest change: move the old row, its rulings and its appeal into a `dispute_history` table (jsonb, with `closed_at`) that the same purge clock covers.
  - **Test:** a `final` dispute plus late-funds escalation keeps the old ruling, appeal and note, and GET shows the new open dispute.
  - The fix round's own record already lists this as a "Lead decision". My judgement is that it must not land as it is.

### 2. The retention policy is decided in code while the owner's Q1 is still open, and it conflicts with Plan 4 Task 23

Plan 4 Revision 2026-10-28 (main line since 44fa438, after a3a7d7f, so the fixer could not have seen it) assigns this purge to new Plan 4 Task 23. Plan 7 Q1 (the 90-day versus 30-day versus self-delete question) is still waiting for the owner. Against that, the branch does four things.

**(a) It deletes the whole dispute row 30 days after close.**
- Where: apps/api/src/disputes/purge.ts:12-27.
- Plan 4 Task 23's own test says a dispute resolved 31 days ago "keeps nothing but the bare record". The bare record (who opened it, the outcome or loser, the times) is what Task 4's stage, Plan 5's reputation and the profile's "lost dispute" line need. After this purge an account's lost dispute disappears and its Starter stage comes back.
- The footer copy (rules.ts:209-211) says both "deleted 30 days after the dispute closes" and "It appears on your profile as a lost dispute".

**(b) The purge removes the only server-side one-dispute-per-trade guard.**
- The open route refuses a second dispute only through `on conflict (code) do nothing`, i.e. only while the row exists (routes.ts:214-220).
- **Probe:**
  - The buyer disputes; the round-2 ruling is `refund-to-seller`; the trade settles to `refunded`; the dispute is closed.
  - Before the purge, a second open gets **409 `dispute-exists`**.
  - After `purgeClosedDisputes` at +31 d (still inside the 90-day dispute-after-refund window), the same POST gets **200** and the trade is `disputed` again. The loser can re-open a decided case.
- The state machine allows this because `onDispute` (machine.ts:360-366) ignores `t.dispute`.
- **Fix:** in the `within` hook, refuse with `dispute-exists` when `prev.dispute !== null`, or make `onDispute` refuse a `refunded` trade whose `dispute` is set. Add the test above.

**(c) `on delete cascade` on disputes→trades (110:17-18) decides at the database level that deleting a trade wins over dispute retention.**
- The fix round's own test (purge.test.ts:189-210) deletes a trade whose dispute is `final`, not closed, and all three tables empty.
- Plan 7's whole-trade self-delete (1 week or 1 month after the trade ends) and the owner's 90-day auto-delete would therefore silently remove dispute records. That contradicts "A dispute opened before the 1-week mark keeps the trade's information until the dispute is resolved" (HANDOFF:200) and Q1 option A ("kept until settled, then 30 more days").
- The cascade is also inconsistent with `trade_events`, which only `x2f_purge` may delete.
- **Fix:** keep the default (restrict) FK from `disputes` to `trades`, so any trade-delete job must handle the dispute explicitly. Cascading `dispute_rulings` and `dispute_appeals` from `disputes` is fine.

**(d) Names, role and close definition collide with Plan 4 Task 23.**
- Task 23 plans the same file (`apps/api/src/disputes/purge.ts`), the same function name (`purgeClosedDisputes`), a `DISPUTE_KEEP_DAYS` in `@x2f/staff` (here it is `DISPUTE_RETENTION_MS`), and it runs as `x2f_purge` with a test that "the app role cannot delete".
- This job runs as the API's own role. Its clock is `status = 'closed'`, while Task 23's is "resolved", meaning ruled and past the appeal window, or the appeal ruled. Plan 3 never writes `closed`, so today the job never runs. It is inert, but it is a placeholder that Task 23 would have to unpick.

**Fix for 2 (the lead picks one):**
- **A (recommended, the lead's own deferral option from the first review):**
  - Keep `closed_at` and its check.
  - Drop `purgeDisputes` from `RETENTION_JOBS`, along with its file.
  - Restore restrict on disputes→trades.
  - Add the server-side guard from (b).
  - Add a `NEEDS_PLAN_4_TASK_23` tripwire.
  - Add a coordination.md line handing Plan 4 Task 23 the 108/110 schema, the bare-record requirement and the Q1 constant.
  - Mark the footer COPY-UNSIGNED "pending Q1", or revert it to a neutral line such as "Dispute records are deleted after the dispute closes, as set out in the Privacy policy." (owner copy question).
- **B:** keep a job, but:
  - delete only the content (`note`, ruling `reason` and `evidence`, appeal `why`) and keep a bare row (opened_by, outcome or loser, opened_at, closed_at);
  - run it as `x2f_purge` with grants;
  - take the delay from one named constant marked "Q1 pending";
  - add the (b) guard and restrict;
  - record in Plan 4 Task 23 that this partly exists.

## Minor

1. **Two EventSources per dispute tab** (DisputeScreen.tsx:128-130, plus App.tsx `LiveAccepted`). The per-account stream cap is 5 (events/bus.ts:24). Three open dispute tabs, or a phone and a desktop, use up the cap, and another device's accepted-sheet stream then gets 429. This is acceptable on the main line for now, and the landing fix is required anyway (see "To land", item 3).
2. **The invariant "a disputed trade has a current dispute row" is enforced only in `applyEvent`.** A deferred constraint trigger on `trades` (state `disputed` requires a dispute row whose status is not `closed`) would catch a future caller that bypasses `applyEvent`, such as Plan 4 tools or a bulk Task 9 IO path. Optional, but cheap.
3. **No test shows the escalate rolling back when the dispute write fails.** Example: make the insert violate a check through a test-only trigger, then assert that the trade is still `released` and no `escalate` event was appended. The atomicity is right by construction; a test would keep it right.
4. **No seller-side settle kind for a moderator's refund-to-seller.** I noticed this while probing: `settled` only knows `release`, `mutual-cancel`, `buyer-cancel`, `auto-refund` and `lapse-refund`, and the probe had to use `mutual-cancel`. That matches policy.ts:160 (a mod-built `mutual-cancel` to the seller), so it is Plan 4's to name. This is an FYI, not a Task 27 defect.

## To land

**On the current main line (9123b4f, after FU-A).** `merge-tree` shows conflicts only in `schema.test.ts` and `coordination.md`, but the merge also breaks behaviour without a textual conflict:
1. **FU-A renamed `TraderSummary.username` to `displayName`** (main view.ts:11). `parseTrade` (dispute/api.ts:103-104) reads `cp.username`, so it throws on every real trade and DisputeScreen shows "This trade couldn't be loaded" for every trade. NEEDS_FU_A (dispute-tripwires.test.ts:50-53) fires at once.
   - Read `counterparty.displayName`, ideally through Task 22's `publicName` once that lands.
   - Update the e2e mock (dispute.spec.ts:24) and any test fixture.
   - Retire the tripwire.
2. `schema.test.ts`: both lists need `009_login_names.sql` (main) plus `108_disputes.sql` and `110_dispute_system_retention.sql`.
3. `coordination.md`: take both sides' lines.

**On Task 22 (`origin/wip/lead-p3-task22-land` @fc534fe):**
1. **`apps/web/src/App.tsx`:** -land still has `<Route path="/trade/:code/dispute" element={<Screen name="dispute" />} />` (line 148). Take Task 27's `DisputeScreen` there. Keep -land's `/trade/:code` TradeRoom route. `app-routes.test.ts` guards against duplicates.
2. **Slot registration:**
   - On the reserved line in `screens/trade/screens.ts:15`, add `import '../dispute/DisputeSlot.js'; // Task 27`. Note the path: the reserved comment says `./DisputeRoom.js`, but the file lives in `screens/dispute/`.
   - Inside it, call `registerTradeScreen({ owner: 'Task 27', role: 'any', states: ['disputed'], screen: DisputeSlot })`.
   - `DisputeSlot(props: TradeScreenProps)` loads only `GET /v1/trades/:code/dispute`. It builds `DisputeTrade` from `props.view`: `publicName(view.counterparty)`, `methodOf(view)` for the method name (this drops `fetchMethodName`) and `view.dispute`. It uses `props.serverClock()` and calls `props.refresh()` after an appeal.
   - It never calls `getTrade` or `useEscrow`. Plan 4's mod co-sign must use `props.escrow` through `rulingAllowsCosign`.
   - Keep `disputeScreenFor` so a missing row still renders the room.
3. **Live events:**
   - -land's `tradeRoom-tripwires.test.ts` (5497862) now fails if `useLiveEvents(` appears in any file other than App.tsx, so `DisputeScreen.tsx:128` turns it red.
   - Replace it with `useTradeLive(code, reload)` from `screens/trade/seams.ts`, which uses the one `liveFanOut` connection.
   - Keep the 30 s poll, or use `POLL_MS` (15 s) for consistency. Moderator joins and rulings still have no live event.
4. **Shared parser:** `/trade/:code/dispute` stays for DisputeOpen and `?view=chat`. Switch its `fetchTrade`/`parseTrade` (dispute/api.ts:84-113) to -land's `getTrade`/`parseTradeView` and map from `TradeView`, so there is one parser of the trade view.
5. **CSS:**
   - `css-collisions.test.ts` passes: I checked every top-level class in dispute.css against -land's stylesheets and found no collisions. `.dispute-screen .x2f-method-name` is scoped, so it does not count.
   - Task 22's renames (`.x2f-quote`/`.x2f-qr` to TradeFund's own classes, 7171bd2) do not touch any class Task 27 uses.
   - Phone sizes: TradeRoom's doc lists 360×640, 390×844 and 430×932, while Task 15's `PHONE_VIEWPORTS` is 390x844 and 360x800. Task 27 follows Task 15. The lead should settle this once.
6. **`parity.ts` `KNOWN_EXCEPTIONS`:** -land adds entries in the same object. Merge both by hand and check the brackets (a merge lost one before, see Task 18).
7. **Dispute entry points:**
   - Tasks 23 and 24 place `<DisputeEntry>` on BuyerPay and SellerConfirm.
   - **Gap:** no task owns the buyer's `refunded` slot. TradeRoom's owner list (TradeRoom.tsx:41-48) gives Task 25 only `secured`+`payBy` and `refund_requested`, and nobody gets `refunded`, `cancelled` or `lapsed`. The 90-day dispute-after-refund entry (spec 2.3) is unreachable after Task 22 lands.
   - The lead should assign it: Task 27 can register `{ role: 'buyer', states: ['refunded'] }` with a status card plus `DisputeEntry`, or Task 25 can.
8. **Retire `NEEDS_TASK_22`** (dispute-tripwires.test.ts:12-25) in the same merge.

**On Task 4 (`origin/wip/lead-p3-task4` @2a37fbd; traders/stage.ts):**
1. **Server-side loser mapping.** Today it exists only in web `rules.ts:144-148`. Move `loserOf` and the finality rule into `@x2f/trade` (or an API module) so the API and the web share one definition:
   - `release-to-buyer`, `seller-sends-xmr` and `seller-returns-fiat` mean the seller lost;
   - `refund-to-seller` means the buyer lost;
   - `no-action` means nobody lost.
2. **One `LOST_DISPUTES_SQL`** next to `COMPLETED_TRADES_SQL` (stage.ts:108-110).
   - A dispute counts as lost by account `a` when:
     - its latest ruling is final, meaning round 2, or round 1 with no appeal and `appeal_until <= now` (or `status in ('final','closed')` once Plan 4 writes those); and
     - the losing side's account (`trades.buyer_account_id` or `seller_account_id`) is `a`.
   - `now` therefore becomes a parameter. A ruling still inside its appeal window does not count yet.
3. **`COMPLETED_TRADES_SQL`:** count released trades **excluding those where this account lost a dispute** (spec: "Only completed trades with no dispute lost count"). Either change the summary's public `completedTrades` too, or keep two counts and have the lead or owner say which one the offer card shows.
4. **`stageFor(s, completedTrades, createdAt, now)`** gains `lostDisputes: number` and drops one stage per lost dispute, floored at `starter`. `tradeCap` and `summary.ts:43-58` both pass it. The lead should confirm whether several losses stack.
5. **Depends on Important 1 and 2(a).** The lost fact has to survive re-escalation and the purge (a bare record), or stages come back after 30 days or after a late deposit.
6. **A re-escalated released trade** is `disputed` while it is open, so it leaves `COMPLETED_TRADES_SQL` (`state = 'released'`) until it settles again. Decide whether that is intended, then test it.
7. **Tests:**
   - the stage before and after a final lost ruling;
   - a ruling inside its appeal window does not count;
   - a won dispute still counts the trade;
   - the purge does not restore the stage;
   - one losing account and one winning account on the same trade.
8. **Migrations:** Task 4's `102_offers.sql` must go into `schema.test.ts` together with 108 and 110 in both lists. There is no number clash.
