# Review: wip/lead-retention @ d80a25c1 (Plan 7 Tasks 1-3, Plan 4 Task 23: the retention promise)

Reviewer: independent security reviewer for the lead, 18 Nov 2026, about 07:35 BC time. This is one round.
Base: main 75f7b5b4. The branch is 3 commits on top of it: 2dd9bcb9 RED, d8e4b4c6 RED, d80a25c1 feat.
Scope: `packages/trade/src/retention.ts`, `apps/api/src/retention/tradePurge.ts`, `apps/api/src/disputes/purge.ts`, `migrations/701_trade_purge.sql`, the `chat/retention.ts` refactor, the `purged_*` add-back in the profile and stage readers, `TradeView.deleteAt`, and on the web `chat/localPurge.ts`, `SelfDestruct.tsx`, `main.tsx` and `TradeRoom.tsx`. I also checked the changed tests.

## Verdict: CHANGES NEEDED

The rule and the purge are careful. It keeps open trades, open disputes and appeals (`published`, `final` and `complying` all count as open), a cancel waiting for Confirm cancel, the after-refund window and the moderation watch (31 days > 30). Liens, owed fees, the revenue ledger, freezes and staff pay all survive it. Races with a dispute opening are closed by the trade row lock, and the foreign keys back that up. The device never touches the escrow store or the chat store.

One defect blocks: a purge can permanently lower a trader's completed count, stage or won/lost record when another trade of the same account changes at the same moment (I1). I reproduced it. One device-side weakness should be fixed in the same round (I2).

## Findings

### Important (blocking)

**I1. The `purged_*` delta loses counts under concurrency (READ COMMITTED).** `purgeOne` (tradePurge.ts) reads `countsOf` for both accounts before the deletes and again after them, and adds the difference to `account_traded_totals.purged_*`. The transaction runs at the default READ COMMITTED level, so each of those two statements sees whatever other transactions committed in between.

The failure: another trade of the same seller or buyer commits as `released` in that window, or a ruling on another trade lands. Then `after` already includes the new trade, the delta for the purged trade comes out as 0, nothing is added, and the account's completed count (R38 stage), its final sales (R-012), or its won/lost disputes (Clean record) end up one lower, permanently. If the concurrent change goes the other way (a count falls), the "a count rose" guard throws and that pass is lost, which is harmless.

Reproduced with a scratch test (not committed). The seller had one released trade due for purge and one open trade. A trigger fired inside the purge, between the two reads, and released the open trade, which is what a committed concurrent release looks like under READ COMMITTED. After the purge, `traderSummary(...).completedTrades` was **1**. It should be 2: one purged plus one new.

The brief says "profile and starter-stage totals must not change after a purge", so this blocks. There are two fixes, both engineering only:
- (a) Run `purgeOne`'s transaction at `repeatable read` (`begin isolation level repeatable read`). Both reads then share one snapshot plus the transaction's own deletes. A conflicting concurrent update makes the trade's `for update` raise 40001; the trade is skipped this pass and picked up next time. Under RR the lock should come first in the transaction, as it already does.
- (b) Count only the purged trade's own contribution: the readers' predicates restricted to `t.code = $code`, read once before the delete.

Either way, add a test that fails today. A trigger-based test like mine works for (b). For (a), use a second connection that commits between the two reads, for example via a hook or an advisory-lock rendezvous.

### Important (fix in this round; on its own it would not block)

**I2. The device's local purge acts on the API's date alone, even for an open trade and even when the escrow integrity check failed.** `useSelfDestruct` (SelfDestruct.tsx) and `runConfirmedLocalPurge` (localPurge.ts) delete as soon as `deleteAt <= serverNow`. Both values come from the API. Nothing on the device checks that the view itself says the trade has ended.

In `TradeRoom.tsx` the hook runs before and regardless of `broken` (`integrityFailed`). Only the "self-destructed" screen is suppressed when broken; the deletion still happens. So the API, or anything that answers `/v1/trades/:code` and `/v1/news`, can force early local deletion. What can go:
- `x2f.fund.funded.<code>` and `x2f.fund.opened.<code>`. This is the funding guard: "once funded the address is never shown again" (fund.ts).
- The tab's `x2f.confirmed:<code>`, the device's own record of what the trader tapped. It exists so that the escrow "never starts from the API's trade alone".

It also replaces the room with "This trade has self-destructed", on every reload, for a trade that may be open or disputed.

**Evidence is not at risk:** the chat (IndexedDB `x2f-chat`) and the escrow keys (`x2f-escrow`) are never touched here. But the device is built not to trust the API on exactly these guards.

Suggested fix (cheap): purge locally only when the view is not `broken`, `view.closedAt` is set, the state is one of the closed states, there is no open dispute in the view, and `deleteAt >= closedAt + TRADE_KEEP_DAYS`. Keep the existing rule for the start-up 404 path, where the stored date came from a view that already passed these gates. Add tests: an open trade with a past `deleteAt` keeps its keys; a broken room keeps its keys.

### Minor (do not block)

- **m1. No database guard behind the app check.** 701 grants `x2f_purge` `delete` on `trades`, `disputes`, `dispute_rulings`, `dispute_appeals`, `ruling_drafts` and `ruling_statements`. Only the app's re-check under the lock stops it deleting an open trade or an unclosed dispute.
  - The grants themselves are tight: `select (code)` only on the child tables, nothing on liens, fees_owed, revenue_ledger, activity_log or account_traded_totals. They also add no real power, because the API user owns every table.
  - As defence in depth, in the 104 `trade_events` pattern, add a `before delete` trigger for `current_user = 'x2f_purge'` that refuses:
    - a `trades` row with `closed_at is null` or `state = 'disputed'`;
    - a `disputes` row with `status <> 'closed'`.
- **m2. The team.test comment claims coverage that does not exist.** It says 199's `team_audit_forget_trade` "now runs on every purged trade (tradePurge.test.ts)". No assertion in tradePurge.test.ts checks `team_audit.trade_code` after a purge. Add one: a team_audit row naming the trade has `trade_code` null after `purgeTrades`.
- **m3. Spec test items not built (Plan 7 Task 2 Step 1, Plan 4 Task 23 Step 1).** Missing:
  - "a captured logger holds no trade code";
  - "the app role cannot delete". This one is untestable while the API user owns the tables; say so in the plan;
  - a test that a dispute opened, or an appeal filed, between the scan and the lock keeps the trade. The code handles it: the facts are re-read under the lock, and the foreign key's key-share lock blocks a new `disputes` insert until commit.
- **m4. Spec deviations for Task 3, to be listed for the lead.**
  - The plan says localPurge deletes "cached messages, proofs and closed-trade escrow state from IndexedDB". The branch deliberately deletes none of these. Chat is left to the 410 sweep. Escrow follows `KEEP_AFTER_CLOSE_MS` on the device clock and keeps a failed escrow indefinitely, which I agree with for coin safety.
  - Not built: `apps/web/e2e/selfDestruct.spec.ts` and the completed-trades list change.
  - The coordination note records the moderation DB rows (`signed_terms` with addresses, `mod_watch`, `mod_sweeps`, the escrow key material) as having no purge. Good that it is written down.
- **m5. Copy overclaims (COPY-UNSIGNED, owner).** "This trade has self-destructed. Nothing about it is kept on this device." can be false. The escrow record (with keys) can stay longer: for 30 days after this device saw the close, or for good after an `escrow-failed`. The chat store goes only at the chat engine's next sweep. See owner question Q1.

## Checked and fine

- **Rule (`retention.ts`).**
  - Invalid dates keep the trade.
  - Dispute close is counted from `max(disputes.closed_at, trades.closed_at)` + 90 days.
  - The refund window comes from `TIMERS.disputeAfterRefundHours`.
  - `awaitingCancelConfirm` keeps a pending cancel.
  - `watchEndsAt` holds back only the delete, not the date shown.
  - The chat is always due no later than the trade.
- **Open things are never deleted.**
  - The scan excludes `closed_at is null` and `state = 'disputed'`. `DISPUTE_FACTS_SQL` counts every status other than `closed` as open.
  - Tests cover open, awaiting-approval, published, appealed, final and complying, plus a later second dispute, maintenance and the 31-day watch.
- **Races.** The trade is locked `for update`, then its disputes and chats, and the facts are re-read under the lock at the same `now`. A concurrent dispute insert or child insert needs a key-share lock on the trade row, so it waits and then fails its foreign key; nothing is orphaned and nothing open is deleted. A late payout (`recordRulingExecution`) only applies to a dispute that is not closed, which keeps the trade. The late-funds watch keeps a closed, attested trade for 31 days, and the purge waits past that.
- **What survives.**
  - liens and fees_owed (no foreign key, no grant; tested byte-equal);
  - revenue_ledger (add-only trigger; `revenue_booked` cascades, which is fine because the ledger names no trade; tested);
  - staff_pay_items (`set null` is allowed by its trigger);
  - trading_holds and held_trades (no foreign key; `syncHeldTrades` tolerates a missing trade, since applyEvent's 404 is caught);
  - activity_log.
- **Trade codes** are 16 random characters (`newTradeCode`), so `k.includes(code)` in `dropKeys` cannot hit another trade's keys, and reuse cannot collide with leftover lien or shred rows.
- **Profiles and stage (apart from I1).** `COMPLETED_TRADES_SQL`, `FINAL_SALES_SQL`, `WON_DISPUTES_SQL` and `LOST_DISPUTES_SQL` add back `purged_*`. The dollar and XMR totals, cancels, fast payments and times are already running totals. The tests show summary and `tradeCap` equal before and after.
- **Weakened tests? None.**
  - purge.test, schema.test and view.test only extend their expectations.
  - dispute-tripwires replaces the "not landed" tripwire with positive checks of what landed: the delete order, the role, the job, and the footer copy.
- **team.test tripwire change: justified.** The two points still open are the team log's owner role, and its cascade when an account is deleted. Both concern Plan 7 Task 18 (Delete my account), not the trade purge. The new tripwire watches Task 18's own file, `apps/api/src/account/delete.ts`, which is the path the plan names.

## Tests run (review worktree at d80a25c1, no lock, `nice -n 10`, per the 18 Nov lock rule)

- `packages/trade/test/retention.test.ts`: 22/22 pass.
- `@x2f/api`: tradePurge, retention, purge, chat, view, schema, disputes/lien, staff/revenue, profiles, team. 10 files, 362/362 pass.
- `@x2f/web`: dispute-tripwires and selfDestruct. 2 files, 24/24 pass.
- `npm run typecheck` (all workspaces): pass.
- Reviewer's scratch race test for I1: **fails as predicted** (expected 2, got 1). It was not committed.
- Full `npm run check`: **not run**. The verdict is CHANGES NEEDED, so it is due on the fixed head before APPROVED.

## Owner questions

- **Q1 (copy, m5).** "Nothing about it is kept on this device" is not always true when the screen shows: the escrow record can outlive the date, by design, for coin safety. Recommendation: "This trade has self-destructed. Its messages and details are gone from this device; the wallet keeps the escrow only while coins could still be in it."
