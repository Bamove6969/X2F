# Security review: wip/lead-staff-pay (Plan 4 Task 33 / J-12, D-041..D-045), 12 Nov 2026

Reviewed: origin/wip/lead-staff-pay at 18df8e26, base main 6ebed537 (19 files, +1733/-4), in a detached
worktree of my own. I changed no code. Docker was up the whole time.

## Verdict

**Approve after the must-fixes: 2 must-fix (both small), 3 should-fix, and minors.**

The money paths themselves hold:
- Pay cannot be sent to an address that was never tapped.
- A tap cannot be replayed for a different address.
- Two clock-outs run one after the other, and accrual cannot run twice for the same dispute.
- A clawback debt carries over.
- The pay settings are the owner's alone, and changing them needs a tap.
- Without a price, the clock-out pays nothing.
- The send is a stub that always refuses.

The gaps are in defence in depth: TRUNCATE on the ledger, and the payout and address rows are mutable. There
is also one deadlock window.

## Must-fix

### M1: `staff_pay_items` can be emptied with TRUNCATE
`staff_pay_items_settle_only` is a `before update or delete ... for each row` trigger. Row triggers do not fire
on TRUNCATE. `trade_events` (104), `team_audit` (015, review M4) and `activity_log` (201) each refuse TRUNCATE
with a statement trigger; this ledger does not. The API's database user runs the migrations and owns the
table, so `truncate staff_pay_items` succeeds. One statement erases every clawback debt and every unpaid
item. Fix: add `before truncate ... for each statement` raising `insufficient_privilege`, the same as 104,
plus a test.

As the table owner, the app role can also `alter table ... disable trigger` or drop the trigger. That is true
of every append-only table here (the same trust level as 201), so I am not raising it as new.

### M2: the payout and address rows are mutable, so a later send could be redirected
The ledger is protected, but the rows that say where money goes are not:
- `staff_payouts`: `address_id` and `amount_atomic` can be updated while `waiting-send`.
- `staff_payout_addresses`: `address` can be updated in place, and the tap that approved it is kept.

No route does either today. But Plan 6's send will read `payout → address` and would send to whatever the
row says. Fix:
- `staff_payouts`: let only `status`, `tx_hash` and `settled_at` change, and only away from `waiting-send`.
  Refuse DELETE and TRUNCATE.
- `staff_payout_addresses`: let only `removed_at` change, from null to a value. Refuse DELETE and TRUNCATE.

Also write into the Plan 6 tripwire comment (`sendStaffPayout`) that the send must re-check the address
against its tap's stored intent (`key_taps.intent.address`), and that the address must still be live.

## Should-fix

### S1: a clock-out racing an overruled appeal can deadlock (Postgres detects it, so one request fails rather than hangs)
`unpaidItems(..., lock=true)` takes `FOR UPDATE` on the member's unpaid items. At the same moment, the
appeal-final save runs inside `withDispute`, which often already holds the log advisory lock because the
route appended `ruling.*` first. That save inserts a clawback whose `source_item` foreign key takes `FOR KEY
SHARE` on the same item, and `FOR UPDATE` conflicts with `FOR KEY SHARE`. So:
- the dispute transaction waits for the clock-out;
- the clock-out then calls `appendLog` (`pay.paid` / `shift.clocked-out`) and waits for the log lock;
- Postgres detects the deadlock and aborts one of them (40P01). Either the final ruling or the clock-out
  fails with a 500.

This needs the round-1 item to still be unpaid when the clock-out and the appeal ruling land at the same
instant, which is rare. Fix: `for no key update` in `unpaidItems`. The `staff_members` row lock already
serialises clock-outs, and `FOR NO KEY UPDATE` does not conflict with `FOR KEY SHARE`.

### S2: the clock-out amount is not bound to the preview
The member confirms the figure from `GET /pay/clock-out`. The POST then recomputes at the price of that
moment, over whatever items exist by then. The member can be paid a different amount (or zero if the
price feed just paused) than the one they confirmed. Option: POST carries the previewed `amountAtomic` and
gets 409 when it differs. This changes behaviour, so it is an owner/lead call. (Related: the member chooses
the moment of conversion, so they can time the clock-out against the XMR price. This follows from "converted
at the clock-out's price"; worth telling the owner.)

### S3: payout addresses can be removed without a tap
`DELETE /staff/v1/pay/addresses/:id` needs no tap and does not take the `staff_members` lock that add and
clock-out take.
- Someone with only a stolen staff session can remove every address. The member then cannot be paid until
  they add one again with their key. This only blocks payment; it never redirects it.
- Racing a clock-out, it can leave a payout naming an address removed a moment later (the member's own).

Recommend taking the same row lock. Whether a removal needs a tap is an owner call; I lean no.

## Minors
- m1 (purge, item 8): `trade_code ... on delete set null` is dormant today. Main never deletes a trade row:
  the purge only nulls `buyer_payout`/`seller_refund`, and `disputes.code` references `trades` with no
  cascade. The trigger does allow the null, and a referential action runs as the table owner, so it will
  work once Plan 7's whole-trade purge (wip/lead-p7-retention) deletes trades. No test covers it, so add one
  on that branch.
  Linkage: `earned_at` keeps the exact instant of the ruling and `seq` is kept too. Reviews truncate
  `created_at` to the month at purge for the same reason (`REVIEW_DETACH_GRANULARITY`). Ask the owner/lead
  whether pay items should be coarsened the same way.
- m2: `roleOf` in `payAccrual.ts` reads the role at save time and ignores `removed_at`/`switched_off_at`. A
  removed proposer still has an item recorded. The rate is also the role's rate at that moment, not at
  ruling time; the first save after publish is normally the publish itself, so the difference is
  theoretical.
  Disputes published before 420 is deployed earn on their next save (window close / appeal) at the rates
  in force then. Lead default or owner question.
- m3: a member who leaves or is switched off with positive unpaid items cannot clock out, so that pay waits
  indefinitely. Debts are recorded (D-044) but stranded earnings have no path. Owner question.
- m4: when there is no price, the owner's `/pay/staff` view shows `owed` from signs only. `usd>0, atomic<0`
  reads as not owed even if the XMR debt is larger. This is display only.
- m5: `pay.clawback` logs `usdCents` but not the atomic amount of a large-trade clawback. The ledger has
  the figure; the log is less complete.
- m6: lock order next to the reputation branch (item 9). Accrual takes no new row lock of its own. Its
  insert's `trade_code` foreign key takes `FOR KEY SHARE` on the trade after the dispute lock, but only on
  the first save that earns (later saves stop at the existence check). On main that is dispute→trade, the
  same order `eraseReviewsOfTrade` already uses. Under the reputation branch's trade→dispute→totals order,
  the trade lock is already held, so there is no new risk. Accrual touches no totals.

## The ten questions
1. **Redirecting pay.**
   - Adding an address needs `consumeKeyTap`, bound to the account, the exact intent `{kind:'payout-address',
     address}`, the session, single use, the TTL, and a still-registered security key. A tap for address A
     cannot add B.
   - The tap is consumed before the 409 checks, but in the same transaction, so a refused add does not
     burn it.
   - The address is checked against the network (`addresses.check`); integrated addresses are refused.
   - At clock-out, the address must belong to the member and be live.
   - Add and clock-out both lock the `staff_members` row; remove does not (S3).
   - The rows are mutable (M2).
2. **Double collecting.**
   - Concurrent clock-outs both lock the `staff_members` row and re-check `payout_id is null` under the
     lock, so the second one finds nothing.
   - There is no clock-out window: every unpaid item counts, so there is no boundary to exploit. An item
     committed during a clock-out waits for the next one.
   - Accrual: an existence check plus the partial unique index `(kind, trade_code, seq)` with `on conflict
     do nothing`, run under the dispute row lock. Clawbacks are unique by `source_item`.
   - `amount_atomic > 0` is enforced by a check.
3. **Avoiding a clawback.**
   - A net debt pays nothing and keeps every item unsettled. A clawback is settled only into a positive
     payout that nets it off.
   - The items keep `staff_id` (the accounts foreign key has no cascade), so leaving does not erase them,
     and the owner's view lists removed or switched-off members.
   - Negative rounding is toward zero, which is under 1 atomic unit.
   - TRUNCATE is the gap (M1).
4. **Raising one's own pay.**
   - GET and PUT `/pay/settings` need `settings.write`, which only the owner has. The matrix row confirms
     senior/mod/helper get 403.
   - PUT needs a `pay-settings` tap carrying the exact values after the change, with `tapPermOf` =
     `settings.write`. A PUT that changes nothing needs no tap.
   - Values are bounded both in the parser and by DB checks. Items keep their amounts when the rates
     change.
5. **The ledger trigger.**
   - UPDATE is allowed only to set `payout_id` (from null) and/or set `trade_code` to null; every other
     column must be unchanged. DELETE is always refused.
   - The app role gets around it with TRUNCATE (M1), or as owner by disabling the trigger (same trust
     level as elsewhere).
   - The trigger does not check that the `payout_id` belongs to the same staff member. Only application
     code sets it.
6. **Session triggers.**
   - A shift opens on every `app='staff'` session insert. Token rotation updates in place, so it opens no
     extra shift.
   - A revoke ends an open shift as `ended`. A delete of a live session ends it as `auto-logout` at
     `expires_at`. The hours sweep marks `auto-logout` first.
   - Only `POST /pay/clock-out` writes `clock-out`. Shifts never affect the amount (pay is per item, not per
     hour), so a spurious or faked shift cannot raise pay. R43 (pay is calculated only at a correct
     clock-out) holds.
   - The functions pin `search_path` and are not SECURITY DEFINER. The sessions and purge tests pass with
     them in place.
7. **No price.** `usdPrice` returns null when the quote is null or ≤0. A non-zero dollar part then gives
   `no-price`: nothing is paid and the shift still ends. A zero dollar part (XMR-only items) needs no price.
   This fails closed.
8. **Purge.** See m1. Dormant on main; it would work at a trade delete; there is no test.
9. **saveDispute.** The new line is idempotent. Lock risk: S1 (against clock-out) and m6 (order).
10. **Weakened tests.**
    - The diff removes no test line except the three schema-test migration lists, which only gain
      `420_staff_pay.sql`.
    - The relaxed "addresses in either order" assertion (pay.test.ts ~323) is in the new test file. The API
      orders by `(added_at, id)` with random UUIDs, so two addresses added in the same instant have no
      defined order. Sorting before comparing is correct.
    - It still proves both IDs and nothing else are listed. It is not a weakening, since the only thing
      relaxed is an order the API never promises.
    - Gaps worth adding: concurrent clock-outs, TRUNCATE refused, the clock-out/clawback race, and the
      purge nulling `trade_code`.

## Tests run (serialised runner, my worktree at 18df8e26)
All passed:
- api staff/pay: 15/15
- api staff/matrix: 112/112
- api staff/keyTap: 28/28
- api staff/settings: 10/10
- api disputes/staff: 27 passed, 1 todo (the todo is already on main)
- api purge: 8/8
- api sessions: 28/28
- api schema: 77/77
- packages/staff intent: 15/15
- staff-web clockOut: 5/5

Logs are in the scratchpad's `logs/rv-staffpay-*`. Semgrep `--config auto` on the 18 changed code files:
0 results, 0 errors.

## Must-fix list
1. M1: a TRUNCATE-refusing statement trigger on `staff_pay_items`, with a test.
2. M2: immutability triggers on `staff_payouts` (only the status, tx hash and settled time move, away from
   `waiting-send`; no delete or truncate) and on `staff_payout_addresses` (only `removed_at`, from null; no
   delete or truncate). Plus the Plan 6 note: the send re-checks the address against its tap's intent, and
   that it is still live.

## Owner or lead questions
- S2: bind the clock-out to the previewed amount? Also, the member chooses the conversion moment.
- S3: should removing a payout address need a tap? (I recommend no, but take the row lock.)
- m1: coarsen `earned_at` at the trade purge, as reviews do?
- m2: disputes published before deploy earn at the rates in force on their next save.
- m3: what happens to the positive unpaid pay of someone who leaves or is switched off?
