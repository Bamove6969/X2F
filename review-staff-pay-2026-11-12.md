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

## Re-verify (12 Nov, wip/lead-staff-pay at 41e8e1e5)

Reviewed `git diff 18df8e26 41e8e1e5` (10 files, +382/-31) in a detached worktree of my own
(`.claude/worktrees/rv-staffpay2`). I changed no code there except two mutation runs, both reverted;
`git status` is clean. dockerd was not restarted.

### Verdict

**Approve. M1, M2, S1, S2 and S3 are fixed. Nothing new is must-fix.** Two minors and one test gap
below; none blocks the merge.

### The fixes
- **M1 (TRUNCATE).** `staff_pay_items_no_truncate` is a `before truncate ... for each statement` trigger
  sharing the row function. The function now refuses any `tg_op` other than UPDATE before touching
  `new`/`old`, so DELETE and TRUNCATE both raise `insufficient_privilege`. Tested, including
  `truncate ... cascade`. Fixed.
- **M2 (mutable payout and address rows).**
  - `staff_payouts_settle_only`: an update passes only from `waiting-send` to another status, with every
    other column unchanged. I checked this against the table: id, staff_id, at, shift_id, address_id,
    usd_cents, usd_cents_per_xmr, atomic and amount_atomic are all compared. Only status, tx_hash and
    settled_at can move. The check constraints still tie `sent` to a tx hash and a settled payout to a
    time. A settled payout can never move again.
  - `staff_payout_addresses_remove_only`: only `removed_at`, from null to a value, once; id, staff_id,
    address, added_at and tap_id are all compared.
  - DELETE and TRUNCATE are refused on both tables.
  - No code path or foreign-key action needs to change these rows. The only writes are the two inserts
    and the removal update. The `shift_id` and `tap_id` foreign keys are no-action, sessions are never
    deleted out from under shifts (the trigger only updates), and only unused key taps are purged.
  - The Plan 6 tripwire comment on `sendStaffPayout` now says the send must re-check the address against
    its tap's `intent.address` and that it is still live, failing the payout otherwise.
  - Fixed.
- **S1 (deadlock).** `unpaidItems(..., lock)` now takes `for no key update`. The new race test holds the
  log lock in a second transaction, waits until the clock-out is blocked on the advisory lock, then
  inserts the clawback.
  - Mutation check: with `for update` put back, the test fails (500, the deadlock). With the fix it
    passes.
  - The clawback stays unpaid for the next clock-out, as D-044 wants.
  - Fixed.
- **S2 (bind the clock-out to the preview).** Fixed. See "The quote" below.
- **S3 (address removal).** `DELETE /pay/addresses/:id` now takes the same `staff_members` row lock as
  add and clock-out, so a removal and a clock-out choosing that address run one after the other. No tap
  is added, as recommended. Fixed.

### The quote (S2)
`GET /pay/clock-out` returns `quote` = base64url(JSON) "." base64url(HMAC-SHA-256). The key is
`subkey(config, 'pay-quote')` (HKDF of the server key, its own label) and the MAC input is prefixed
`pay-quote/`. The body holds:
- `v`;
- `staffId` and `sessionId`;
- `items`: SHA-256 of the sorted ids of the unpaid items;
- `price`: the USD price used, or null;
- `expiresAt`: now + 5 min.

On POST, `openQuote` runs before the transaction:
- the MAC is checked in constant time, with a length check first;
- exactly two parts are required;
- JSON is parsed only after the MAC passes;
- `v`, `staffId` and `sessionId` must match the caller (`quote-invalid` 400 otherwise);
- the quote must not have expired (`quote-expired` 409).

Then `clockOut` locks the member row and the items. It re-hashes the items it locked (`quote-changed` 409
if they differ) and pays them at the **quoted** price. The quote is at most 2048 characters, and unknown
body keys are refused. `sessionId` is the session row's id, not the token, so showing it to the client
leaks nothing.

- **Replay across members:** refused, because `staffId` is bound and signed. Tested with another
  member's quote.
- **Replay across sessions:** refused, because `sessionId` is bound. Even without that check, another
  session of the same member would pay that member the same items at a server-signed price, so no money
  is at stake.
- **Reuse after a payout:** impossible.
  - A payout settles every item it covers, and the ledger trigger never lets `payout_id` go back to null.
    So a non-empty set of items can never be unpaid again, and the hash cannot match (`quote-changed`).
  - The clock-out also revokes the session, which kills the quote's binding.
  - A nothing-due, owed or no-price clock-out settles nothing but still revokes the session.
  - The two-session race test proves exactly one payout, and the other session gets `quote-changed`.
- **Paying more than the items:**
  - The amount is computed on the server from the locked items, whose amounts the ledger trigger keeps
    unchanged, so they match the hash.
  - The price is one the server signed within the last 5 minutes.
  - The client controls neither. A null-price quote with a dollar part still pays nothing (`no-price`).
  - The only extra a member can get is the 5-minute price option (r2-m1).

### New minors
- **r2-m1: the 5-minute price option.** A member can open the sheet several times, keep every quote, and
  use the one with the lowest USD/XMR price (the most XMR) seen in the last 5 minutes. The most they gain
  is XMR's move within 5 minutes on their own pay. This is a small cost of S2's "pay what you saw", on
  top of the round-1 note that the member picks the conversion moment.
  - If the lead wants it closed, store the latest quote per session (or its MAC) and accept only that
    one.
  - Otherwise, tell the owner.
- **r2-m2: the staff-web retry path.**
  - `quote-expired` shows "Your pay changed while this was open", which is wrong for a sheet that simply
    timed out with unchanged figures. Suggest separate wording (COPY-UNSIGNED either way).
  - If the reload in that branch fails, its fault message is overwritten and the sheet keeps the stale
    quote, so the next tap fails the same way. It is display only and recoverable by reopening.
- **Test gap:** no test covers the session binding by itself. I removed the `sessionId` check and all 22
  pay tests still passed, because the "other member" case fails on `staffId` first. Suggest one case: the
  same member, a quote from session A posted from session B, expecting `quote-invalid`. Not urgent, for
  the reason given under replay across sessions.

### Tests run (serialised, one file at a time, at 41e8e1e5)
All passed:
- api staff/pay: 22/22 (15 before, +7)
- api staff/matrix: 112/112
- api schema: 77/77
- api purge: 8/8
- api staff/keyTap: 28/28
- staff-web clockOut: 6/6

The m1 purge test (a deleted trade nulls `trade_code`, the amount stays) is now in staff/pay and passes.

Mutation runs, both reverted:
- `for update` in `unpaidItems` makes the S1 test fail (500).
- Without the session check, pay still passes 22/22 (the test gap above).

Semgrep (p/typescript, p/nodejs, p/secrets, tools/semgrep) on the 9 changed code files: 0 findings.
Logs are in the scratchpad's `logs/rv2-staffpay-*`.

### Still open for the owner or lead (from round 1, unchanged)
m1 (coarsen `earned_at` at purge), m2 (rates on the first save after deploy), m3 (stranded positive pay of
someone who leaves), m4, m5, m6 as before. New: r2-m1.

## Re-verify 2 (12 Nov, wip/lead-staff-pay at 3b2eaa2c, on 41e8e1e5) (MONEY)

Independent reviewer. No code edits and no mutation runs. Detached worktree `rv-pay` from origin, fresh `npm ci`, removed afterwards. dockerd was not restarted.

### Verdict: PASS. r2-m1, r2-m2 and the session-binding test gap are closed; no new Must-fix or Should-fix.

### 1. Can the nonce be raced? No.
- **How it works.** Each preview stores a fresh `randomUUID()` in its own open shift (`update staff_shifts set latest_quote = … where session_id = $1 and staff_id = $3 and ended is null`). The nonce is also put inside the HMAC-signed quote, so it cannot be forged or edited.
  - `openQuote` refuses a quote without a string nonce.
  - The POST, inside its transaction, locks the member's row (`staff_members … for update`, as before) and then the shift row (`for update`). Only then does it compare `latest_quote` with the quote's nonce.
  - An unset nonce (`null`) never matches.
  - Both sides are lower-case UUID text.
- **Two previews at once.** Both UPDATEs take the shift's row lock, so they run one after the other. Exactly one nonce is left as the latest, and only that preview's quote pays. The other gets `quote-changed`, and staff-web re-reads the sheet. Whichever response the browser shows last, the worst case is one extra re-read. It is never a second payment or a different amount.
- **A preview during a POST.**
  - If the preview committed first, the POST's `for update` read sees the new nonce, so the older sheet is refused.
  - If the POST holds the lock first, the preview's UPDATE waits. When the POST commits, the shift is `ended`, so the preview updates no rows. It returns a quote that can never pay, because the session is revoked and there is no open shift.
- **Two sessions.** Each nonce lives on its own session's shift. A quote from session A posted from session B fails on `sessionId` with `quote-invalid`, before any lock. This is the new test, which closes the round-2 test gap. The existing two-session race test still proves exactly one payout.

### 2. Can the preview's write be abused? No.
- It is scoped to the caller's own session, own staff id and open shift. It can only make that session's earlier sheets unredeemable, which is the point of the change.
- It cannot touch another member or another session, and it changes no amount.
- `staff_shifts` has no triggers, so the write has no side effects.
- A cross-site GET carries no session, because the cookie is `SameSite=Strict` (`COOKIE_ATTRS`). So a third party cannot use this GET to invalidate someone's sheet.
- Repeated previews only let the member pick the *moment* they are paid at, which was already accepted in round 1. They can no longer keep several quotes and choose among them: r2-m1 is closed, and the new test shows the older, cheaper sheet refused while the newest pays its own price.

### 3. Does the POST still pay exactly the quote? Yes.
- The order is: lock the member, lock the unpaid items, lock the shift and check the nonce, then check the items hash. The amount is `clockOutTotals(locked items, quote.price)`, the same as at 41e8e1e5.
- The new r2-m1 test checks the exact atomic amount: `3300 × XMR / 16 500`.
- `shift_id` is now always set. The old "no shift" path, which paid with a `null` `shift_id`, now returns 409. That is only a change in practice if a live staff session could have no open shift, and it cannot:
  - the session-insert trigger opens a shift for every staff session, and migration 420 backfills one for sessions already open;
  - the hours sweep ends a shift as `auto-logout` only in the same transaction that revokes the session.
  So the change cannot strand a member, and it makes R43 stricter.
- Migration 420 was edited in place. That is fine, because 420 is not on main yet (checked against origin/main 6ebed537).

### staff-web (r2-m2)
- `quote-expired` now has its own wording. `quote-changed` keeps the old wording.
- When a reload fails, its error is kept, and `sheet` is set to null, so no stale quote can be sent: the submit button is disabled with no sheet (tested).
- An empty sheet with an error now shows "Try again". Previously it showed "Working out your pay…" indefinitely.
- New copy is unsigned, as before.

### Info only
- **i1.** With no sheet and an error, the dialog's `describedBy={textId}` points at an element that is not rendered. The fault is still announced by the danger notice. Suggest moving the id onto the notice in that state.
- **i2.** "Try again" tapped twice quickly runs two previews. The sheet shown may then be the earlier nonce, and the next POST gets `quote-changed` and one more re-read. This heals itself and moves no money.

### Tests run (serialised runner, at 3b2eaa2c)
| Suite | File | Passed | Change since 41e8e1e5 |
|---|---|---|---|
| api | staff/pay | 24/24 | +2: r2-m1 latest sheet only; another session's quote refused |
| staff-web | clockOut | 7/7 | +1: the r2-m2 expired path |

Not re-run this round: matrix, schema, purge, keyTap. Only `staff_shifts` and pay.ts changed. schema.test only lists migration file names, so a new column does not affect it.

Still open for the owner or lead: m1 to m6 from round 1, unchanged. r2-m1 is resolved.
