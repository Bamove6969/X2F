# Review: Plan 4 Tasks 1–3 (`@x2f/staff` core and the activity log), wip/third-p4-staff-core @3f7e2e6 (author claude3), 2026-10-30

Reviewer: lead reviewer (helper), read only. Scope: the whole diff `origin/claude/compassionate-johnson-k95ssr...origin/wip/third-p4-staff-core` (25 files): b3dc1e5 scaffold, 0b60143 Task 1 (roles, NAV, login hours, canonicalJson, sha256, key-tap intents), ab96588 Task 2 (dispute machine, appealReviewers/involvedIn), 3c5c3a4 Task 3 (201_activity_log.sql, log/{actions,append,verify,query}.ts, applyEvent's log write), 3f7e2e6 (merge of main line d48033f, clean). Checked against Plan 4 Tasks 1–3 and every later Revision (A1 dropped, 48 h ruling deadline and appeals, R37 / Task 24, liens Task 25, ban stages Task 27, shifts Task 33, Revision 29b `reputation.review`, Task 30 grants), spec 6.6, R36–R43, and coordination.md's Task 27 notes on 108/110.

## Verdict: CHANGES REQUIRED

There are 0 Critical, 3 Important and 8 Minor findings. The core is careful and well tested. `can()` refuses unknown roles and perms. Grants are limited to `tickets.handle`. Every freeze or ban needs a second senior or owner. Trader actors can only appeal, and system events are system-only. The log refuses unknown detail keys and long strings, holds no addresses and records traders by side only. UPDATE, DELETE and TRUNCATE are refused. The chain trigger recomputes the hash, so the app path and the SQL path agree byte for byte.

The three Important findings:
- I1: the "no fork" guarantee holds only under READ COMMITTED. I reproduced a fork.
- I2: R37 is enforced only on assign, propose and approve. An involved person can still take part in the appeal.
- I3: `involvedIn` has no round-1 cut-off. Used the way Task 24 says, it would disqualify every appeal reviewer once that reviewer touches the case.

Tests (detached worktree `~/x2f-worktrees/rv-staff` @3f7e2e6, `npm ci`, each run under `flock ~/x2f-comms/check.lock`):
- `npx vitest run --project @x2f/staff`: 5 files, **170 passed**.
- `npx vitest run --project @x2f/api` on log, schema, store, disputes, events, take and dispute-count tests: 7 files, **181 passed**.
- `tsc --noEmit` in packages/staff and apps/api: clean.
- A throwaway fork probe (below, deleted afterwards).

## Important

**I1. Two appends can fork the chain when a transaction is not READ COMMITTED. Neither the trigger nor `appendLog` notices, and the fork is permanent.**
Where: `apps/api/migrations/201_activity_log.sql:58-71` (the trigger reads the head with `select … order by id desc limit 1`), `apps/api/src/log/append.ts:81-83` (same read).

The advisory lock serialises appenders, but the head read uses the transaction's snapshot. Under REPEATABLE READ or SERIALIZABLE, that snapshot can predate the previous appender's commit. Both the app's read and the trigger's check then see the old head, so the second row extends it as well.

I reproduced it with a probe test on a fresh test database:
1. A appends and commits.
2. B begins at that isolation level and runs `select 1 from activity_log`.
3. A appends and commits again.
4. B appends and commits.

Result: no error under either level. Afterwards `verifyLogChain` returns `{ok:false, brokenAt:'3'}`, and two rows share one `prev_hash`. SSI does not abort it either. The log is append-only, so the break cannot be repaired. Every later verify, and Task 14's checkpoints, fail from that row on.

Nothing in apps/api uses those isolation levels today (grep finds none). But `default_transaction_isolation` is a database or role setting, a later task may use SERIALIZABLE for its own reasons, and decision (8) claims a guarantee that does not hold.

Required:
- Add `create unique index activity_log_one_child on activity_log ((coalesce(prev_hash, '\x'::bytea)));`. A uniqueness check is not bound to the snapshot. With that index the same probe gets `duplicate key value violates unique constraint` under both levels, and the chain stays ok (verified).
- Optionally, also make the trigger refuse `current_setting('transaction_isolation') <> 'read committed'` with a clear message.
- Add both isolation levels to log.test.ts.

**I2. R37: someone involved in round 1 can still take part in the appeal.**
Where: `packages/staff/src/dispute.ts:313-317` (`reply`) and `:303-311` (`assign` checks only the assignee, not the actor).

In round 2, `eligibleForAppeal` is checked for the assignee, the proposer and the approver, but not for the actor of `reply` or `assign`. Scenarios:
- The senior who approved round 1 (in `round1.involved`) sends `reply` in the `appealed` case. It is accepted (`isSeniorOrOwner`) and they message the traders during the appeal.
- An involved senior assigns the round-2 reviewer of their choice.

The owner's words are "nobody involved may take part … enforce in code".

Fix: at the top of the staff branch, `if (d.round === 2 && d.round1?.involved.includes(by.id)) return fail('not-eligible')` for every staff event. Task 11's chat and message routes must apply the same rule (`forbidden-case`). Add tests: an involved senior's `reply` and `assign` in round 2 → `not-eligible`.

**I3. `involvedIn` counts round-2 activity, so Task 24's gate would disqualify every reviewer. It is also a second source of truth next to `Dispute.seen`.**
Where: `packages/staff/src/appealReviewers.ts:17-26`. The machine instead uses `round1.involved = [...d.seen]` (`dispute.ts:255-260`).

Task 24 says the gate refuses a round-2 proposer or approver who is "in `involvedIn` for round 1". `involvedIn(log, code)` has no cut-off. Once an uninvolved senior is assigned to the appeal, their own `dispute.assigned` and `case.opened` entries are on the trade. At propose or approve time, the API check or Task 13's gate (`appealReviewers(staff, involvedIn(log, code))`) excludes them, and no appeal can ever be decided.

There is also a split source of truth. The API keeps `seen` up to date through `markSeen`, while the gate reads the log. If one `markSeen` call is missed (for example on a `chat.read`), the API lets someone review whom the gate refuses, or the reverse.

Fix:
- Give `involvedIn` a cut-off: `involvedIn(log, code, { beforeId })`, where `beforeId` is the id of the `appeal.opened` entry (ids are the chain order; `at` is not monotonic across appenders).
- Have the API build `round1.involved` from that call when it applies `appeal`, rather than from the accumulated `seen` (or assert that the two are equal).
- Test: a reviewer's own round-2 entries never make them ineligible.

## Minor

**M1. In the autumn repeated hour, the window opens again after it has ended, and `windowEndsAt` returns a past instant.** Where: `packages/staff/src/hours.ts:99` and `:121-123`. Take `Sat 22:00–01:30 America/New_York` on 2027-11-07. The window ends at 05:30Z (01:30 EDT), which matches the test at hours.test.ts:74. At 06:10Z (01:10 EST, the second pass), `inWindow` is true again (01:10 < 01:30, and Saturday is the previous day), but `windowEndsAt` returns 05:30Z, before `now`. So a login is allowed and then ended at once, and for 20 minutes the two functions disagree. Fix: in `firstInstantAtOrAfter`, take the smallest hit ≥ `now`, or make `inWindow` false in the repeated hour once the first end has passed. Pick one and pin it with a test.

**M2. `applyEvent` holds the global log lock for the rest of every trade transaction.** Where: `apps/api/src/trades/store.ts:327-333`. `appendLog` takes `pg_advisory_xact_lock(7240001)` before `openSystemDispute` and before `within`, so every trade event on the site is serialised for that whole tail. There is also a hang that Postgres cannot detect. Suppose a later caller (for example Task 12's publish) appends a log entry in its own transaction and then awaits `applyEvent`, which uses a second pool connection. `applyEvent` then waits forever on a lock its own caller holds. Fix: make `appendLog` the last statement before `commit` in `applyEvent`, and add a rule to the `appendLog` doc comment: append last, and never await another connection while the log lock is held.

**M3. `round1` keeps too little of round 1 for the executor.** Where: `dispute.ts:64` and `:255-260`. A1 is dropped, so round 1's payout runs at once, but it can still be pending when the appeal arrives. The open item claude3 raised is real. Round 1's ruling `id` and `accountAction` are thrown away at appeal (`ruling: null`). Tasks 13 and 14 must execute and verify round 1's approvals by ruling id while round 2 is under way. Fix: keep the whole round-1 `RulingDraft` (id, outcome, accountAction, proposer, approver) in `round1`. Add a line to the Task 13 plan: an appeal never cancels a pending round-1 execution, and the executor reads `round1`, never `ruling`, once `round === 2`.

**M4. `shiftDeadlines` also moves deadlines that had already passed when maintenance began.** Where: `dispute.ts:166-176`. Scenario: an appeal window ends at 10:00, the `window-closed` tick has not run yet, and maintenance runs 10:30–11:30. Shifting by 60 min reopens the appeal window until 11:00. Fix: take `since: Date` (the start of maintenance) and shift only deadlines after it. Also, round 2 resets `rulingDueAt` but leaves the round-1 `replyDueAt`, which the queue's `deadlineTone` will show as overdue. Set `replyDueAt = appealedAt + firstResponseH` at appeal, or document that it is not used in round 2.

**M5. A system-opened dispute cannot be represented.** Where: `dispute.ts:48` and `:116`. `openedBy` is `'buyer' | 'seller'`, but 110 allows `opened_by = 'system'` (reason `escalated`), and `applyEvent` already writes those rows (`openSystemDispute`). Add `'system'` (and `seq`, see the 108 notes) before Task 10.

**M6. The log detail kinds are looser than the privacy rule needs.** Where: `apps/api/src/log/actions.ts:141`, and every `accountId`, `staffId` and `recId` typed as `'id'`. `'id'` accepts any `[A-Za-z0-9_.:-]{1,64}`, so a caller can log a username or a login name where an account id belongs. Add a `uuid` kind for `accountId` and `staffId`. In addition:
- `RULING.accountAction: 'id'` no longer fits the object-shaped `AccountAction`. Name the flattening (`accountAction: kind`, plus `until`/`reasonCode` as their own keys).
- `verify.ts:51` compares `from.hash` case-sensitively. Lower-case it.

**M7. `propose` does not check the account action's shape.** Where: `dispute.ts:318-336`. A `trade-ban` or `site-ban` with a malformed or past `until`, or a `reasonCode` outside `BAN_REASON_CODES`, is accepted. The machine is the shared guard, so check it there. The approver check uses `isSeniorOrOwner`. That equals `can(role, 'accounts.ban' / 'accounts.freeze')` today, but tying it to `can()` keeps a later grant change from drifting.

**M8. The SHA-256 test vectors could be broader.** Where: `packages/staff/test/intent.test.ts:46-53`. The boundaries 55, 56, 64 and 300, and 2000 bytes, are good. Add a loop over every length from 0 to 1024 with seeded random bytes against `node:crypto`. It is cheap and closes the question about the hand-written code.

## claude3's decisions

| # | Decision | Call | Reason |
|---|---|---|---|
| 1 | Sync SHA-256 in plain TS | **Confirm** | WebCrypto `digest` is async and `tapChallenge`/`keyCheckCode` are sync by contract. The input is public, so timing does not matter. The code matches FIPS 180-4 (padding, `>>>0` arithmetic, big-endian length) and the node:crypto tests pass. No new dependency. Widen the vectors (M8). |
| 2 | `tapChallenge` normalises a ruling's trade code and throws on an invalid one | **Confirm** | One canonical code per ruling, so a dashed and an undashed code cannot give two challenges. Throwing fails closed. The gate must use the same function (it shares the package). |
| 3 | `windowEndsAt` returns `now` outside the window; `null` means `'any'` | **Confirm** | A session outside its hours ends at once, which is what the session code needs. Fix the fall-back re-entry case (M1). |
| 4 | `assign` takes an optional assignee role, required when assigning someone else | **Confirm, with a condition** | The machine cannot know someone else's role. Task 11 must load the role from the database, never from the request. Consider making `role` always required, so self-assignment cannot use a stale `by.role` either. |
| 5 | Extra fields (`publishedAt`/`appealedAt`/`executedAt`/`compliedAt`/`overturned`/`round1.outcome+involved`); `final` = no appeal possible but round 1's payout not yet seen; `close` system-only from `final`/`complying`; round 2 resets `complyBy` for `seller-sends-xmr` | **Confirm** | It is consistent with A1 dropped, Task 25 (the appeal suspends the lien, so a fresh 24 h after a "stands" decision is fair) and Task 24's anchor. I traced every pair of status and event: no illegal transition, and `appealEndsAt` is exact at the boundary. `round1` must keep the ruling id and action (M3), and `involved` needs the cut-off (I3). |
| 6 | Pure `markSeen`/`shiftDeadlines` | **Confirm** | Pure functions are right. `shiftDeadlines` needs the start of maintenance (M4). |
| 7 | Traders appear in the log by side, with no account id | **Confirm** | It is enough to reconstruct a case while the trade exists, and it cannot be linked to an account after the 90-day purge (R36). Note: staff actions on accounts (lien, ban, hold, fee) do log `accountId`, which is needed and matches Task 25's liens, which also outlive the purge. Make those fields `uuid` (M6). |
| 8 | The insert trigger recomputes the hash and takes appendLog's lock, so direct inserts cannot fork the chain | **Reject as stated; confirm once I1 is fixed** | The hash recomputation is good. "Cannot fork" is false outside READ COMMITTED (reproduced). The unique index on `prev_hash` makes it true. |
| 9 | The staff log view shows every disputed trade; `staffId` is not used yet | **Confirm** | Task 11 lets anyone with `disputes.handle` see every case header, and log entries hold no chat. Keep `staffId` in the signature for a later per-case rule, and say in the doc that today it is unused. |
| 10 | A malformed `txHash` is dropped from the detail instead of failing settlement | **Confirm** | The log must never block a payout's bookkeeping. The `trade_events` row keeps the event, and the field-by-field filter cannot leak a non-schema field. |

## Open items claude3 raised

- **An appeal that overrules round 1 before round 1's payout ran.** Leaving this to Tasks 13 and 14 is right, but write the rule down now (M3). Under A1 dropped, round 1 still executes and the overturn becomes a lien (Task 25). The machine already waits for `executed` in `final`, but the executor needs round 1's ruling id to do this.
- **Reconciling migration 108 (disputes) with this machine.** For Plan 4 Task 10, which per coordination.md alters 108 and 110 rather than creating new tables:
  1. **Status.** 108/110 allow `open|ruled|appealed|final|closed`. The machine has `open|awaiting-approval|published|appealed|final|complying|closed`. Note that `final` means something different: here, an escrow case whose payout is not yet seen. The trader screens of Plan 3 Task 27 read 108's values. Pick one of:
     - (a) Alter the check to the machine's seven values, map them for trader views (`awaiting-approval` → `open`, `published` → `ruled`, `complying` → `final`), and update Task 27's screens.
     - (b) Keep 108's column as the trader-facing projection and add `staff_status` for the machine.

     I recommend (a) with one mapping function in `@x2f/staff`. Keep 110's check that `closed` holds exactly when `closed_at` is set.
  2. **Identity.** 108 keys disputes on `(code, seq)`, with re-escalations as new seqs. `Dispute` has no `seq`; add it. Log entries carry only `trade_code` (`dispute.opened` has `seq` in its detail). Counting involvement across every seq of a trade is conservative and acceptable under R37, but say so.
  3. **`opened_by = 'system'`** (110): see M5.
  4. **Rulings.** `dispute_rulings (code, seq, round)` is the published, trader-visible ruling. Its `reason` and `moderator_name` are required, and `appeal_until` is set on round 1 only (this equals `appealEndsAt` from `publishedAt`, Task 24). A proposal that is awaiting approval or sent back must not be a row there. Store drafts (proposer, approver, `needs_second`, `account_action` as jsonb, the reason hash for the tap) in their own table, or in nullable columns that `published_at` gates.
  5. **Appeals.** `dispute_appeals` has the primary key `(code, seq)`, which is Review Focus 3's guarantee of "exactly one appeal". The API must map that unique violation to the machine's `wrong-state`.
  6. **Columns the machine needs on `disputes`:** `assignee`, `first_reply_at`, `reply_due_at`, `ruling_due_at` (108's `due_at` is round 1's; round 2 is `appealedAt + APPEAL_GOAL_H`), `usd_cents`, `limit_usd_cents`, `published_at`, `appealed_at`, `executed_at`, `complied_at`, `comply_by` and `overturned`.
  7. **Outcomes.** 108's outcome check equals `ESCROW_OUTCOMES ∪ AFTER_REFUND_OUTCOMES`. No change.

## Not findings (checked)

- **Permissions.**
  - `can()` refuses an unknown role through `Object.hasOwn`, so `'__proto__'` is refused too. An unknown perm is false.
  - Owner is every perm. Senior and mod match the plan plus `reputation.review` (29b) and `accounts.ban` (Task 27). Helper is `self` only.
  - Grants count only for `GRANTABLE_PERMS`, so a stored `['staff.manage']` grant does nothing.
  - NAV is UI only, and Task 4's privilege matrix is the server check. NAV entries need `training.read` and `log.read.cases`, which the senior and mod roles hold.
  - Missing from NAV: a tickets entry for a helper granted `tickets.handle` (Task 31's job).
- **Two-person rule.**
  - `needsSecond` is `usdCents >= limitUsdCents` or any non-`none` action. The boundary at exactly the limit is tested.
  - Approval needs a senior or the owner, and never the proposer (`same-person`). The proposer is always the assignee.
  - A mod cannot ban or freeze alone.
- **canonicalJson.** It is deterministic:
  - `JSON.stringify` escapes strings, including lone surrogates (ES2019) and NUL, which Postgres text could not store.
  - Numbers use JS's shortest round-trip form, and `-0` becomes `0`.
  - Keys sort by UTF-16 code units, and nothing re-canonicalises in SQL (the trigger hashes the stored text).
  - It refuses `Date`, `undefined`, non-finite numbers, sparse or decorated arrays, symbol keys and class instances.
  - Unicode never reaches a log detail anyway: `assertDetail` allows only ASCII kinds.
- **The chain hash.**
  - The `|` separator is unambiguous: every field before `detail` is fixed-format, and `detail` is last.
  - The trigger's `to_char(… 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` equals `toISOString()` for years 0–9999.
  - Millisecond precision is enforced. Ids come from `nextval`, and `id > head` is checked.
  - `verifyLogChain` checks both the link and the content of every row, and checks the checkpoint row itself. Truncating the tail is detectable only against Task 14's checkpoints, as designed.
- **Login hours.** Review Focus 1 holds:
  - The NY Friday overnight window and Berlin across the March 2027 change work.
  - At the spring-forward gap the window ends at 07:00Z.
  - `validateHours` refuses extra keys, duplicate days, `24:00` and unknown zones.
- **The dispute machine's boundaries.**
  - An appeal at `appealEndsAt − 1 ms` is accepted; at exactly `appealEndsAt` it is `too-late`. A second appeal is `wrong-state`.
  - `window-closed` before the end is `wrong-state`.
  - `executed` before publish is refused, and so is `complied` on an escrow case.
  - Outcome kind and case kind must match.
- **The `applyEvent` log write.**
  - It is in the same transaction: a rolled-back event writes nothing (tested).
  - A no-op event (`unchanged`) writes no log entry.
  - The detail comes from the address-free `eventRecord` and is filtered field by field. `setup-done` logs no address end.
- **Package wiring.** `@x2f/staff` is a workspace with a lockfile link. apps/api depends on it. The vitest project picks it up through `packages/*`. Semgrep scans `packages`. There is no `node:` import, so it is browser-safe.

tsc: `packages/staff` and `apps/api` `tsc --noEmit` both clean.
