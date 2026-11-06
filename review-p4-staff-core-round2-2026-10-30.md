# Round-2 review: Plan 4 Tasks 1–3 (`@x2f/staff`, the activity log), wip/third-p4-staff-core @21d1754, 2026-10-30

Reviewer: lead reviewer (helper), read only. This round checks the lead's fix round against round 1 (`review-p4-staff-core-2026-10-30.md`, I1–I3 and M1–M8).

Scope: `git diff 3f7e2e6 21d1754` restricted to packages/staff, apps/api/src/log, `201_activity_log.sql`, trades/store.ts, the touched tests, docs/coordination.md and the Plan 4 note. The commits are d6b2949 (red tests), 4eea0aa (the fixes), 70ab892 (docs), 86e3361 (merge of f13f574), 724816e and 21d1754.

## Verdict: APPROVED WITH MINOR

There are 0 Critical, 0 Important and 4 Minor findings. Every round-1 finding is fixed and pinned by a test. None of the Minors blocks landing.

## Tests

All runs were in a detached worktree `~/x2f-worktrees/rv-staff-r2` @21d1754, after `npm ci`, each run under `flock ~/x2f-comms/check.lock`. The worktree has since been removed.

- `tsc --noEmit` in packages/staff and in apps/api: clean.
- `vitest --project @x2f/staff`: 5 files, **181/181 passed**.
- `vitest --project @x2f/api` on log, schema, news-tripwire and disputes: 4 files, **115/115 passed**.
- store, take and dispute-count: passed (exit 0).
- **Trial merge of main 5c4d35b**, not committed and aborted afterwards:
  - schema.test.ts conflicts textually. Resolution: each of the three lists gets `116_fund_started.sql` and `201_activity_log.sql`.
  - apps/api tsc then fails at `log/actions.ts:28` (see N1).
  - With N1's four entries added, tsc for api and staff is clean.
  - vitest on cancel-rules, disputes, purge, schema, log and store: 6 files, **143/143 passed**.

## Round-1 findings: all fixed

| # | Fixed? | Where and how |
|---|---|---|
| I1 fork outside READ COMMITTED | **Yes** | `201_activity_log.sql:27`: unique index `activity_log_one_child` on `coalesce(prev_hash,'\x')`, so there is exactly one first row and exactly one child per row. `:65-68`: the trigger refuses a non-READ-COMMITTED transaction before it takes the lock. Tests at `log.test.ts:143-191`: the stale-snapshot probe under both REPEATABLE READ and SERIALIZABLE, followed by verify ok; and the index refusing a second child or a second root with the triggers disabled. The uniqueness check is not bound to the snapshot, so the guarantee holds even for a superuser who bypasses the trigger. |
| I2 involved staff acting in round 2 | **Yes** | `dispute.ts:376` refuses every staff event (assign, reply, propose, approve, send-back) when `round === 2` and the actor is in `round1.involved`. Tests at `dispute.test.ts:398-410`, covering an involved owner too: reply, assign-other and send-back all give `not-eligible`. Task 11's chat routes are told the same rule in coordination.md. |
| I3 `involvedIn` cut-off and single source | **Yes** | `appealReviewers.ts:28` adds `{ beforeId }` with a BigInt comparison; an invalid id throws. The appeal event now carries `involved` and unions it with `seen` (`dispute.ts:320`), so a missed `markSeen` can only widen the list. Tests: a reviewer's own round-2 entries; ids compared as numbers, not text. coordination.md tells the API to append `appeal.opened` first and use its id. |
| M1 DST repeated hour | **Yes** | `hours.ts:124`: the smallest hit after `now`. Test: every minute of the 2027-11-07 night, the end is after `now`. The lead picked "reopen in the repeated hour". That is less strict than the other option (it gives up to one extra login hour on fall-back night). This is acceptable because login hours are an operational limit, not a security boundary. |
| M2 lock held across the trade transaction | **Yes** | `store.ts:330-335`: `appendLog` is now last before the commit. There is a test where a `within` hook appends on a second connection and does not hang. The rule is written in `append.ts:66-70`. See N3 for the appeal path. |
| M3 round 1 kept | **Yes** | `Round1 extends RulingDraft` (id, outcome, accountAction, proposer, approver, needsSecond) plus `firstReplyAt` and `involved`. The action is cloned. The Plan 4 note for Tasks 13/14 says the executor reads `round1`, never `ruling`, in round 2. |
| M4 `shiftDeadlines(since)` and round-2 reply deadline | **Yes** | Only deadlines after `since` are moved. Round 2 resets `firstReplyAt` and `replyDueAt = appealedAt + firstResponseH`, and `DisputeSettings` now requires `firstResponseH`. Tested. |
| M5 seq and system opener | **Yes** | `Dispute.seq` (default 1, safe integer ≥ 1) and `openedBy: 'system'`. Tested. |
| M6 uuid kinds, flattened action, upper-case checkpoint | **Yes** | Every `accountId`/`staffId` detail is a lower-case uuid; a grep finds no account or staff field left as `'id'`. `RULING` is flattened to `accountAction` (kind), `until` (iso or null) and `reasonCode`. `verify.ts:51` lower-cases the checkpoint hash and the head reports the stored hash. Tested. |
| M7 action shape | **Yes** | `validAction` checks the exact key set, `BAN_REASON_CODES`, an exact ISO-ms `until` after `now`, and null for permanent. The approver goes through `can()`: `rulings.approve` plus `accounts.freeze` or `accounts.ban` (`canApprove`). Tested (`invalid-action`). |
| M8 SHA-256 vectors | **Yes** | Every length from 0 to 1024 bytes with seeded random content, against node:crypto (`intent.test.ts:55`). |

## The extra checks you asked for

**NEEDS_PLAN4_STAFF_API** (`apps/api/test/news-tripwire.test.ts:21`): OK.
- It reads the local checkout only (`existsSync`/`readFileSync` under ROOT): no git, no network.
- It is green at 21d1754, so it is not deliberately red.
- It now fires on `apps/api/src/staff` or `buildStaffApi` in app.ts. Plan 4 Task 4 creates exactly `apps/api/src/staff/app.ts` and the other staff files (plan line 341), so it fires when the News routes become buildable.
- Narrowing it is correct: Tasks 1–3 add no routes.

**Lead decision 4** (the assignee's role always comes from the database): OK in the machine.
- `DisputeEvent.assign.role` is now required (`dispute.ts:99`), with no fallback to the actor's role.
- A self-assignment whose role is not the actor's role is `wrong-party` (`:384`). This fails closed when a stale session role and the database role disagree.
- coordination.md tells Tasks 10–12 to load the role from the database.
- Gap: the actor's own role is not covered. See N2.

**Migration 201:** unique. No other branch on origin has a `2xx_` migration besides `201_activity_log.sql`. The main line has 116 (`116_fund_started.sql`), which does not clash.

**Tamper resistance and privacy:** unchanged from round 1 and still good.
- UPDATE, DELETE and TRUNCATE are refused.
- The chain trigger recomputes the hash, and the one-child index is added.
- Details pass a per-action schema. Traders appear by side only. Account and staff ids are now forced to uuids, so no names can be logged.
- A new trade event is safe too: `tradeLogDetail` (`append.ts:122`) keeps only the keys in the schema that fit.

## The lead's conservative calls

Neither the commit messages nor coordination.md lists "the 4 conservative calls", so I judged every conservative choice I found in 4eea0aa:

| Call | Safe? | Why |
|---|---|---|
| (a) `round1.involved = involved(log) ∪ seen` | **Safe** | It can only widen R37's list. The worst case is that an uninvolved person is wrongly excluded, which is a liveness cost, never an escalation. |
| (b) The trigger refuses every non-READ-COMMITTED append (round 1 had made this optional) | **Safe** | It fails closed. A later SERIALIZABLE business transaction cannot log in the same transaction. That is a design constraint, not a hole, and the unique index is the real backstop. |
| (c) I2 blocks every round-2 staff event for anyone involved, the owner included, with no fallback | **Safe** | It matches the owner's R37 words ("nobody involved", no owner fallback). The cost: if every senior and the owner touched round 1, the appeal waits until someone new joins. That was already accepted in round 1. |
| (d) An approver needs senior or owner **and** `can(rulings.approve)` **and** the action's own perm | **Safe** | It is strictly narrower than before and follows later grant changes. |
| (e) A self-assignment must declare the actor's own role | **Safe** | It fails closed on a mismatch. |
| (f) R37 counts entries from every seq of the trade | **Safe** | Conservative in the excluding direction, as in (a). |

## Minor

**N1. Landing clash with main 5c4d35b: four new trade events have no log schema.**
- Where: `apps/api/src/log/actions.ts:28-46`.
- What happens: Task 38 adds `fund-started`, `walk-away`, `confirm-cancel {returnConfirmations}` and `return-confirmed {confirmations}` to `TradeEvent`. `TRADE` is a `Record` over every event type, so tsc fails after the merge. It is loud, not silent.
- Fix at the merge: add `'trade.fund-started': {}`, `'trade.walk-away': {}`, `'trade.confirm-cancel': { returnConfirmations: 'number' }` and `'trade.return-confirmed': { confirmations: 'number' }`.
- Also add `116_fund_started.sql` and `201_activity_log.sql` to all three migration lists in schema.test.ts (a textual conflict).
- I verified this resolution: tsc clean; cancel-rules, disputes, purge, schema, log and store 143/143.

**N2. Decision 4 covers the assignee's role but not the actor's.**
- Where: `dispute.ts:21-22` (`Actor.role`) and `:419` (`canApprove(by.role, …)`).
- Scenario: a senior is demoted to mod (Task 7's `staff.role-set`) while their session holds a role cached at login, or a role taken from a signed token. They can still `approve` or `send-back` a two-person ruling, including a ban or freeze, until the session ends.
- The machine cannot see this. Add to coordination.md, for Tasks 4 and 10–12: `requireStaff` loads the role from `staff_members` on every request, and every `Actor` passed to `applyDispute` uses that load, never a session or token copy. Add one matrix test where the role is demoted mid-session, then an approve gives `forbidden`.

**N3. The appeal path conflicts with the wording "append LAST".**
- Where: `apps/api/src/log/append.ts:66-70` against coordination.md's API note ("append `appeal.opened` first, in the same transaction").
- To get `beforeId`, the appeal transaction must append, then read the log and update the dispute row while holding the global log lock. That is safe on one connection, but a Task 24 author who follows `append.ts` literally might compute `involvedIn` before appending. Then a staff entry committed between that read and the append is missed, which breaks R37.
- Fix: reword the doc comment to: never await another connection or anything slow while the lock is held; keep the tail short; the appeal path appends `appeal.opened` first and then reads the log on the same connection.

**N4. The fix round's own calls are not written down.**
- coordination.md's fix-round line says "I1-I3, M1-M8 and decision 4 applied" but does not list the calls judged above. The most notable are (b), the trigger refusing non-READ-COMMITTED (a constraint every later Plan 4 task must know), and the M1 choice (the window reopens in the repeated hour).
- Add one line for each to the Plan 4 Tasks 1–3 section.

## Housekeeping

The dead round-2 reviewer left a detached worktree `~/x2f-worktrees/rv-staff2` @21d1754. It is not mine, so I left it for the lead to remove. My own worktree `rv-staff-r2` is removed.
