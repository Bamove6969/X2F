# Security review: wip/lead-revenue-ledger (2026-11-09)

- Branch: wip/lead-revenue-ledger, worktree `.claude/worktrees/revenue-ledger`, head **91c1af68** (336467f3 revenue ledger, 91c1af68 fee-wallet sweep) on 0c6f3f16.
- Reviewer: independent security reviewer. I did not change any code.
- Owner rules checked: the poster pays 1% on released trades and settled disputes, and never on a cancel. A loser with no escrow money still owes 1%, taken from future trades. The hot wallet always keeps "one day plus one night of staff pay".

## Verdict

**Ready to land after the mechanical merge with origin/main. No blocker and no High or Medium finding.**

- The ledger books inside the settlement transaction and cannot double-book.
- No cancel of any kind books anything.
- The ledger holds no identity.
- The revenue route is owner-only.
- The tap binds all three sweep values, so a tap cannot be reused with a different address.
- No code path can reach a real send.

There are four Low findings on the sweep pass (F1 to F4). F1 needs a lead or owner decision. F2 to F4 are hardening to do before Plan 6 wires the send. F5 is a Low on the owed-fee seam, for Task 12. The rest is information. The branch does **not** merge cleanly with current origin/main (F7). The conflicts are mechanical, but whoever resolves them must keep the booking inside the transaction.

## Tests run (serialised runner, single files, on 91c1af68)

- `apps/api/test/staff/revenue.test.ts`: 1 file, **27 passed**, 0 failed.
- `apps/api/test/staff/feeSweep.test.ts`: 1 file, **17 passed**, 0 failed.
- I did not run `schema.test.ts` or the full check (it holds the test lock). I checked the schema lists by reading the code.

## Checklist

1. **Booking is inside the settlement transaction and idempotent: yes.** `trades/store.ts:378-383` calls `bookTradeRevenue(client, code)` on the locked-row client. The call comes after the `update trades` (so `closed_at` and `settling` are the new values) and before `within`, `appendLog` and the commit. A crash rolls back the booking and the settlement together. The idempotency key is `revenue_booked (trade_code, kind)`, the primary key in migration `430:28-34`. The marker insert and the ledger upsert run in one statement (`revenue.ts:84-96`), and the ledger row is added only when the marker insert returned a row. A replayed `settled` event is refused by the machine: `released` is not in `SETTLED_FROM`. A trade that is escalated after release and settles again (released → disputed → released) hits the marker and books nothing. A settlement that paid no fee returns before inserting a marker (`revenue.ts:82`). That is what lets Task 14 book `dispute-seller` later in the same transaction.
2. **No cancel kind books anything: yes.** `trades.settling` only ever holds a `SettleKind` (`machine.ts:497-498`). `feeOutputAtomic` (`revenue.ts:40-50`) returns the fee only for `release` and `dispute-buyer`, and for `dispute-seller` on a seller's ad. `mutual-cancel`, `buyer-cancel`, `auto-refund` and `lapse-refund` all fall to 0. This mirrors `payoutsFor` (`packages/trade/src/payouts.ts:68-96`). Walk-away and a cancel before funding end in `cancelled` and never reach the hook (`revenue.ts:113`). Nothing outside `applyEvent` sets `released` or `refunded`, on this branch or on origin/main. `revenue.test.ts:112` covers all six cases.
3. **No identity, and the ledger survives the purge: yes.** The `revenue_ledger` columns are day, currency, kind, counts and amounts only. The ledger is add-only by trigger: a lowering update, a delete or a truncate is refused with 42501, and this is tested. See F8 for the per-trade marker.
4. **Permissions: correct.** The route uses `earnings.read` (`revenue.ts:265-266`). Only the owner's role holds it, and it is not in `GRANTABLE_PERMS` (`packages/staff/src/roles.ts:42`). The route-matrix row is in `test/staff/routes.ts`, and `revenue.test.ts:266` checks that a senior moderator, a moderator and a helper get 403. The fee-sweep routes use `settings.write`, which is also owner-only, and `tapPermOf('fee-sweep')` is `settings.write` (`keyTap.ts:430`). The query parser refuses unknown keys, malformed or impossible dates and ranges that are too long. The SQL interpolates only fixed literals.
5. **The tap binds threshold, float and address: yes.** `changeFeeSweep` builds the intent from all three new values (`feeSweep.ts:295`). `consumeKeyTap` matches `canonicalJson(intent)` exactly, in one conditional UPDATE that also checks one use, the 2-minute TTL, the same session and that the key is still registered (`keyTap.ts:256-267`). A change to any field, including an address-only change, needs a tap over all three. `parseKeyTapIntent` takes exactly those keys (`keyTap.ts:380-384`). Re-using a consumed tap fails, and this is tested.
6. **The sweep pass: sound, with F1 to F4.** A session advisory lock serialises passes across instances, because it lives in the database. A second pass gets `busy`, and this is tested. A pending or failed attempt holds later passes. Alerts go to live `owner` accounts only. Their detail is amounts only, and the push text is generic. The default send is the tripwire, which always throws. Only tests override `send`. Nothing in `apps/` or `packages/` calls `runFeeSweep`, and `main.ts` is pinned by a test (`feeSweep.test.ts:74-81`). No real send is reachable.
7. **Migration numbering: OK.** 430 and 431 are inside J-13's reserved 430-439. They do not collide with batch 3 (120, 121, 123, 204, 208) or with the others (124, 125, 332, 345, 350, 355, 440, 450). The migrator applies files by name set, so landing out of order is fine. 430 depends on `trades`, and 431 on `settings` (206) and `key_taps` (203); both exist. The three lists in `schema.test.ts` are updated for this branch's base, but see F7.
8. **Logging: clean.**
   - Request bodies are redacted (`app.ts:189`).
   - `settings.changed` logs the address by its field only (`feeSweep.ts:303`), and a test asserts that the address never appears.
   - `treasury.*` logs the amount and the tx hash and is owner-only (`OWNER_ONLY_PREFIXES`). A Monero tx hash does not reveal the destination.
   - `fee_sweeps` and the alerts hold no address.
   - The ledger logs nothing for each trade.

## Findings

### F1 (Low; lead or owner decision): the hold is lifted by any settings save, and cannot be lifted by an identical save
- `feeSweep.ts:149` lifts a pending or failed hold as soon as `fee_sweep_set_at` is later than the attempt. Any change sets `fee_sweep_set_at`, including an unrelated threshold tweak. Nothing records that the owner checked the wallet first.
- In the other direction, an identical re-save is a no-op: no tap, no `set_at` bump (`feeSweep.ts:293-294`). So the documented "save the settings again" does not unblock anything through the API. The owner must change a value, or turn the sweep off and on again with two taps.
- The tests unblock with a direct `UPDATE settings` (`feeSweep.test.ts:167-170, 256-258`), so they never exercise the API path.
- Scenario: the process dies mid-send and the row stays `pending`. Weeks later the owner raises the threshold for an unrelated reason, and the next pass sends without anyone reconciling the earlier attempt.
- Money-wise the second send is sized from the live unlocked balance, so the float is still kept. What is lost is the record of the earlier attempt.
- Fix (decision needed, because it changes what the owner does): add an explicit tapped "resume after checking" action, for example a `fee-sweep-resume` intent that names the attempt id, and keep it separate from a settings edit. As a smaller alternative, a PUT with identical values could consume a tap and bump `set_at` while the latest attempt is held. Either way, the drawn UI should show the held attempt.

### F2 (Low; before Plan 6): an in-flight pass uses the settings it read at step 1
- `feeSweep.ts:142` reads the settings without a lock, and the send uses `started.coldAddress` (`feeSweep.ts:160, 171`).
- If the owner changes the address or turns the sweep off between the step-1 commit and the send, the send still goes to the old address. That address was tapped earlier, but the owner may be changing it because it is compromised.
- Fix when the send is wired:
  - read the settings `for share` in step 1, so that a concurrent PUT serialises with it;
  - re-read `set_at` and the threshold just before the send;
  - if either changed, settle the attempt as `failed` with reason `settings-changed`.

### F3 (Low): a push error after step 1 leaves the attempt stuck as pending
- `pushOwnerAlert` (`feeSweep.ts:165`) runs after the pending row is committed and before the send. If `push.send` throws, the pass throws and nothing is sent. No `failed` alert is written either, and the row stays `pending`, so every later pass returns `held-unfinished`, which is wrong because nothing was sent.
- Fix: make both pushes best-effort (try/catch with a counter), or push after step 3.

### F4 (Low): a failed advisory unlock returns a locked connection to the pool
- `feeSweep.ts:200` swallows an unlock error and then calls `client.release()`. The pooled connection keeps the session lock, so every later pass returns `busy` until that connection is closed. This fails safe, but the sweep stops silently.
- Fix: if the unlock fails, call `client.release(err)` so the connection is destroyed.

### F5 (Low; for Task 12): the owed-fee seam books at most one collection per collecting trade
- `bookOwedFeeCollected` is keyed `(trade_code, 'owed')` (migration `430:28-34`, `revenue.ts:129-138`). If one later trade collects two separate `fees_owed` debts with two calls, the second is silently dropped and the ledger under-counts.
- The function also does not check that the collecting trade is `released`. If Task 12 called it at take time and the trade was later cancelled, it would book revenue that was never paid.
- Fix: document "call once, with the sum, in the release transaction" and assert `state = 'released'`, or key the marker by the `fees_owed` row.

### F6 (Info): a seller's win on a seller's ad books nothing today
On this tree the moderator's refund to the seller is built as a refund kind with no fee output, so no fee is paid or booked. The ledger matches the fee wallet. Task 14 must pass `dispute-seller` to `bookTradeRevenue` in the ruling's settlement transaction (`revenue.test.ts:139` shows this works), and its payout set must actually carry the fee. Until then, the owner rule that settled disputes pay the fee is not met on-chain for this case. That is Task 14's job, not a ledger bug.

### F7 (Info; merge): conflicts with current origin/main
- origin/main is 129 commits ahead of 0c6f3f16. `git merge-tree` reports conflicts in `apps/api/src/trades/store.ts` (main added `countActionTimes` on release), `apps/api/src/alerts.ts` and `apps/api/test/schema.test.ts`.
- When resolving:
  - keep `bookTradeRevenue` inside the `released`/`refunded` state-change block, before `within` and `appendLog`;
  - add main's migrations 017, 198, 200, 210, 307, 311, 313, 314, 315, 324 and 325 to the three expected lists, in name order before 430.
- Re-run `revenue.test.ts`, `feeSweep.test.ts` and `schema.test.ts` after the merge.

### F8 (Info): the per-trade marker stays while trades stay
- `revenue_booked` keeps a code, an amount and the close time for each booked trade. It is deleted with its trade (on delete cascade), but the current purge only nulls addresses and never deletes trades (`trades/purge.ts:28`). Until Plan 7's whole-trade purge, the claim that only amounts remain after the purge is not yet true.
- This is no new exposure, because `trades` already holds `fee_atomic`. Plan 7 must delete the trade rows, or this table, for the claim to hold.
- Ledger rows with `trades = 1` for a day and market show a single trade's fee, but only the owner can read them.

### F9 (Info): a ledger error fails the settlement record
A database error in the booking rolls back the whole `settled` event. This fails closed, the same as `countTradeTotals`. The inputs are constrained (the currency is checked on the offer, and the amounts are non-negative numerics), so I see no realistic trigger. The comment at `revenue.ts:38` refers only to unknown kinds.

## Owner or lead questions
- F1: how should the owner clear a held (pending or failed) sweep? Recommendation: a separate tapped "resume after checking the wallet" action that names the attempt, with an identical settings save leaving the hold in place.

## Re-verify 64fc8c56

- Branch: wip/lead-revenue-ledger, worktree `.claude/worktrees/revenue-ledger`, head **64fc8c56**. Commits verified: 56d50652 (merge of origin/main 22b379e8, F7), c01fef44 (F2), 27e2d374 (F3), 37c565af (F4), 70b363ce (F5), 64fc8c56 (F1 comment).
- Reviewer: independent security re-verifier, read-only on code. I changed nothing but this section.

### Verdict

**APPROVED WITH MINOR.** Every finding F1 to F7 is closed or correctly deferred, no test was weakened (the test diffs since 91c1af68 are additions only, plus the `debtId` argument the F5 fix requires), the merge keeps the booking inside the settlement transaction, and the routes stay owner-only and tapped. Four minor findings (R1 to R4), all before Plan 6 wires the send; none blocks landing.

### Tests run (serialised runner, single files, on 64fc8c56)

- `apps/api/test/staff/feeSweep.test.ts`: 1 file, **22 passed**, 0 failed (17 before, plus the five F2/F3/F4 tests).
- `apps/api/test/staff/revenue.test.ts`: 1 file, **29 passed**, 0 failed (27 before, plus the two F5 tests).
- `apps/api/test/schema.test.ts`: 1 file, **73 passed**, 0 failed (the three migration lists now carry main's 017 to 325 and then 430, 431).
- `npx tsc -p apps/api --noEmit`: exit 0.

### Findings F1 to F7, one by one

- **F1 (resume rule): deferred correctly.** 64fc8c56 adds a four-line comment at `feeSweep.ts:164-167` naming owner question p11-77 and freezing the rule as built. No behaviour change, no test change. The question stays open for the owner (below).
- **F2 (stale settings at the send): closed, with R1 and R2.** Step 1 reads the row `for share` (`feeSweep.ts:157`, `getFeeSweepConfig(..., { forShare: true })`), so a concurrent PUT's `for update` (`changeFeeSweep` line 344, `changeSettings` in `settings.ts:139`) waits; the test proves it with `lock_timeout` → 55P03. `settingsStillAllow` (lines 245-255) re-reads `for share` in a short transaction right before the send and fails the attempt `settings-changed` when the sweep is off or the address differs; two tests cover the address change and the switch-off, and both assert `sent` is empty, the row is `failed` with no tx hash, the owner alert and the log carry the reason. The next pass then sends to the new address (tested). See R1 for the window that remains and R2 for what the re-read does not compare.
- **F3 (push failure leaves the row pending): closed.** `bestEffortPush` (lines 257-261) swallows a push error; both pushes go through it. The test makes `push.send` throw and asserts the attempt still settles (`failed not-wired`, then `sent` after a re-save). The in-app alert is written before the push either way. No counter was added (the review suggested one); information only.
- **F4 (locked connection back to the pool): closed.** The `finally` (lines 229-238) catches the unlock error and calls `client.release(unlockError)`, which destroys the connection. The test proxies the pool so `pg_advisory_unlock` rejects, asserts `release` was called once with an Error, and then that a later pass is not `busy`.
- **F5 (owed-fee seam): closed.** See section (4) below.
- **F6 (Info, Task 14): unchanged**, as expected.
- **F7 (merge): closed.** See section (3) below.

### (2) The F2 window, exactly

Lock timeline of a due pass: step 1 holds `settings` `for share` from line 157 to the commit at line 178 (across `wallet.unlockedAtomic()`, see R3). The lock is gone after the commit. `bestEffortPush` runs unlocked. `settingsStillAllow` takes `for share` again (line 248) and releases it at its own commit (line 249). Then `send(...)` runs at line 199 with **no lock and no transaction**, by design ("the send never runs inside an open transaction").

So the owner's change is caught whenever his PUT commits before line 249 (the re-read either waits for his `for update` to commit and then sees the new row, or sees it already committed). The window that remains is **from the commit at line 249 to the moment the wallet has broadcast the transaction inside `send`**: a few microseconds of JavaScript plus the wallet RPC's build, sign and relay time (seconds on Monero). A PUT that acquires `for update` in that window commits the new address while the coins go to the old one. No database-side check can close it, because the send is already in flight; only holding the share lock across the send would (the owner's save would then wait those seconds, and a hung RPC would block every settings save, see R3).

Acceptable pre-launch: yes. Today `send` is the tripwire and throws before any transfer, so the window cannot move coins. Even when wired, the exposure is bounded to one sweep's excess (balance less float), the destination is the address the owner tapped last, and the race needs his save to land inside a seconds-long window of a pass that happens to be sending. The code comments overstate the protection ("under the same lock", lines 133-134 and 186): the re-read is under *a* lock in a separate short transaction, and nothing is held across the send. Plan 6 should pick (a) hold the share lock across the send with a bounded RPC timeout, or (b) keep the window and say so in the comment; either is defensible, (b) is simpler. Recorded as R1.

### (3) The merge resolution in `trades/store.ts`

`applyEvent` (lines 378-385 at head) runs, on the one locked-row `client` inside `begin` ... `commit`: `update trades`, `insert trade_events`, `openSystemDispute` (escalate only), then on a state change to `released` or `refunded` `countTradeTotals` and `bookTradeRevenue` in one block, then main's `countActionTimes` on `released`, then `within`, then `appendLog` last (the log lock is taken only for the tail), then `commit`. Any throw rolls everything back (`catch` → `rollback`). Both imports are present. The diff against main (22b379e8) is only the import and the five-line block; the diff against the branch parent (91c1af68) is only main's import and `countActionTimes` line. Nothing else in `store.ts` changed.

No double booking on retry: a retried `settled` event after a rollback finds no `revenue_booked` row (it rolled back too) and books once; a retried event after a commit is refused by the machine (`released` is not in `SETTLED_FROM`) and, if it somehow reached the block, hits the `(trade_code, 'fee', '')` primary key. `countActionTimes` is idempotent by its own `trade_totals_counted (code, 'action-times')` marker, so the ordering (ledger before action times) only decides which failure rolls the other back, and both fail closed together. Correct.

### (4) F5: the owed-fee seam

- Migration 430 (new on this branch, not on main, so changing it in place is fine): `revenue_booked` primary key is now `(trade_code, kind, debt_id)`, `debt_id text not null default ''` with `length(debt_id) <= 64`, and `check ((kind = 'fee') = (debt_id = ''))`. So a trade's own fee is exactly one row with `debt_id = ''`, and an owed booking must name a debt. `fee_atomic > 0` matches `book`'s early return on zero.
- `bookOwedFeeCollected` (`revenue.ts:139-150`) refuses a negative amount (RangeError), an empty or over-long `debtId` (RangeError), an unknown trade (RangeError), and **throws unless `state = 'released'`**. The test books on a `secured` trade and on an `auto-refund` `refunded` trade and asserts both throw `/not released/` and no marker exists.
- Idempotent per (collecting trade, debt): the `insert ... on conflict do nothing` marker gates the ledger insert. Two debts on one trade both book (tested: amounts add, `trades` stays 1 because the `exists` subquery reads the markers as of the statement's snapshot, so the first debt's marker is not visible to the second's `case`), and a repeat of the same debt books nothing (tested).
- Paths I looked for and did not find: nothing but `bookOwedFeeCollected` writes `kind = 'owed'`; `bookTradeRevenue` always passes `debtId: ''` and `kind: 'fee'`, so the two kinds cannot collide; no caller exists yet (Task 12 will be the only one). A debt partly collected by two different trades is two rows with two amounts, which is correct, not a double booking. The marker is cascaded with its trade, so after a purge a replay cannot happen (the trade is gone).
- What the seam does not and cannot check: that `collectedAtomic` is what the release's payout set actually carried to the fee wallet, and that `debtId` is a real `fees_owed` row (no FK, the table does not exist yet). Task 12 must call it in the release transaction with the amount the payout set sends. Documented in the function's comment; information only.

### (5) Deadlock between step 1's share lock and the owner's save

Lock sets: the owner's PUT (`/staff/v1/fee-sweep` or `/staff/v1/settings`, one `withTx`) takes `settings` row `for update`, then updates `key_taps` (consume) and `settings`, then the log advisory xact lock in `appendLog`. Step 1 takes the session advisory lock `x2f-fee-sweep` (never contended by the PUT), then `settings` `for share`, then inserts `fee_sweeps` and `alerts` (select on `accounts`); it never touches `key_taps` or the log lock. Step 3 (`withTx` on a second pool connection) updates `fee_sweeps`, inserts `alerts`, then takes the log lock; it never touches `settings`. `settingsStillAllow` takes only `settings` `for share`. There is no pair of resources taken in opposite order, so no deadlock; a PUT blocked on the share lock holds no lock itself. A second pass is `busy`, never a second share lock. Trade settlements take the log lock and never `settings`, so they are not involved. The only liveness hazard is R3 (the share lock held across the wallet RPC).

### (6) What a malicious staff or team member could do through these routes

- `GET /staff/v1/revenue` is `earnings.read`; `GET`/`PUT /staff/v1/fee-sweep` are `settings.write`. After the merge `roles.ts` still gives both only to `owner`, `GRANTABLE_PERMS` is still `['tickets.handle', 'feedback.read']`, and `can()` ignores a stored grant outside that list, so a senior, mod or helper cannot be granted either perm even by a corrupted `staff_members.grants` row. The route matrix (`test/staff/routes.ts:101-104`) pins all three rows to `OWNER`, and both suites assert 403 for the other roles.
- The tap: `tapPermOf('fee-sweep')` is still `settings.write`, so a non-owner cannot even start a fee-sweep tap (403 `forbidden` at `keyTap.ts:516`). `consumeKeyTap` binds the tap to the actor's account, the exact canonical intent (all three values), one use, the 2-minute TTL, the starting session and a security key still registered to the account. A staff member cannot use the owner's tap, and the owner's own tap for other values is refused (tested).
- Team members (trader-side `team_members`) never reach the staff app: every route here is behind `requireStaff`, which loads `staff_members` on each request.
- Input: the PUT body must have exactly the four keys; amounts are decimal strings of at most 30 digits; the address is 95 base58 characters and then checked by the wallet (`addresses.check`), so no injection or SSRF vector through the address. The revenue query refuses unknown keys and interpolates only fixed literals.
- Data a non-owner could learn: nothing. The cold address is returned only to the owner; `settings.changed` logs the address field without its value; `fee_sweeps`, the alerts and the ledger hold amounts only; `treasury.*` log entries are owner-only. A moderator with `log.read.cases` sees no treasury or settings entries.
- What the owner alone can do that matters: point the sweep at any valid address, with a tap. That is the design. An attacker holding the owner's session and one of his registered security keys could redirect the sweep; that is the existing owner-account threat model (G4's two-key rule covers key changes, not settings), not new to this branch.

### Minor findings

#### R1 (Minor; Plan 6): the send itself runs outside the share lock, and the comments say otherwise
- Exact window in section (2): from the commit at `feeSweep.ts:249` to the wallet's broadcast inside `send` (line 199). A PUT that commits in that window changes the address after the pass decided to send to the old one.
- Acceptable pre-launch (the send is the tripwire). Before Plan 6 wires it: either hold the share lock across the send with a bounded RPC timeout, or keep the window and fix the comments at lines 133-134 and 186 ("under the same lock" → "in a separate short transaction; nothing is held across the send"). Lead's call; I recommend keeping the window and fixing the comment.

#### R2 (Minor; Plan 6): the re-read compares the address and the on/off state only, not `set_at`, the threshold or the float
- `settingsStillAllow` (line 250) returns true while `thresholdAtomic !== null && coldAddress === started.coldAddress`. If the owner raised the float mid-pass (wants the hot wallet to keep more), the pass still sends the amount sized from the old float, so the hot wallet ends below the new float. The coins go to the owner's own tapped address, so this is a sizing miss, not a loss.
- The review asked for a `set_at` comparison. One line: `now.setAt?.getTime() === started.setAt?.getTime()` (return `setAt` from step 1), which fails the attempt on any save. Suggested before the send is wired.

#### R3 (Minor; Plan 6): step 1 holds the share lock across the wallet RPC
- `wallet.unlockedAtomic()` (line 158) is awaited inside the step-1 transaction, after the `for share` read. A hung or slow wallet RPC holds the share lock, and every owner settings save (`/staff/v1/fee-sweep` and `/staff/v1/settings`, both `for update` on the one `settings` row) waits until the RPC returns or its connection drops. Today the wallet is a test stub.
- Fix: read the balance before `begin` (it does not depend on the settings; `planFeeSweep` combines both after), or give the RPC a timeout. Two-line change, no behaviour change otherwise.

#### R4 (Info): the F1 question is open and the hold tests still bypass the API
- The F1 rule is frozen by comment pending p11-77; the tests still lift the hold with a direct `update settings` (`setSweep`), so the "save the settings again" path through the PUT remains untested until the owner's answer settles what that path is. Nothing to do now.

### Owner or lead questions
- p11-77 (F1) is unchanged: how a held (pending or failed) sweep resumes. Recommendation stands: a separate tapped "resume after checking the wallet" action that names the attempt.
- R1: hold the share lock across the send, or accept the seconds-long window and say so. Recommendation: accept and fix the comment.

## Lead note, 22:50 UTC
R1-R3 applied on wip/lead-revenue-ledger: 6ebb94d0 (R1 comments: window accepted), f7ec96b5 (R2: any settings save after the pass starts stops the send, via fee_sweep_set_at), 02762a02 (R3: wallet balance read before the share lock). feeSweep 24/24, revenue 29/29, tsc clean. Head 02762a02 pushed; lands in batch 4. p11-77 (F1) still open.
