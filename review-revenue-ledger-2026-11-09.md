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
