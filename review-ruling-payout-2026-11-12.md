# Security review: Plan 4 Task 14, the ruling payout (wip/lead-ruling-payout 544cf81c)

Reviewer: independent helper, 2026-11-12. Scope: `git log 23e36785..544cf81c` (the payout diff on top of
wip/lead-mod-gate 23e36785), and how it uses the gate. The gate itself (`authorizeRuling`, `syncRegistry`,
taps) is out of scope; it is being fixed separately. Threat model: the API process and its database are
compromised. Reviewed in a detached worktree at 544cf81c with a fresh `npm ci`.

## Verdict

**APPROVE WITH MINORS: no blocking finding.** I found no way, under a compromised API and database, to get a
payout to an address the gate did not compute, to pay twice, to pay an unauthorised, after-refund or round-2
ruling, or to book a fee on a refund. Five minors are worth fixing before this lands on main. M1 (a refused
second instance overwrites gate.bin) is a regression this diff introduces, and the fix is a one-line move.
M2 to M4 are about the checkpoints: they detect less than the code comment claims, and the alarm can be
silenced.

Tests: moderation and logchain 202/202, moderation-regtest 1/1, API 2578 passed (1 todo); no failures.

## What holds (the attacks I tried)

- **Payout to an address that isn't the gate's.** `execute.ts` hands `auth.settle.payouts`, and only those,
  to `settle`. They come from `payoutsFor` on `recordedFor(args, shadow)`: the attested terms in this
  service's own `signed_terms`, the desk's shadow trade and the env `feeWallet`. None of these inputs comes
  from the API. An existing record is honoured only when `keyOf(rulingId, winner, payouts)` matches
  exactly, addresses and amounts as strings. Anything else is `mismatch`, and nothing is handed.
- **Double payout across restarts or races.** (a) In one process, the record is check-and-set under
  `store.exclusive`, and the `inFlight` check-and-set that follows has no await in between, so two
  concurrent passes hand at most once. (b) Across restarts, the record is sealed in gate.bin before
  `settle()` is called, and only an identical payout is handed again. The party also dedups by outcome
  digest and never rebuilds after `done` (party.ts `advanceRelease`). The builder's `settle()` resolves
  only once the escrow is empty and the tx is confirmed, so `settledAt` means paid. (c) Late funds after
  a payout change the balance, so the key changes and the result is `mismatch`. An identical deposit
  after an unsaved `done` reaches a party whose release is already `done`, so it is not paid again.
  (d) A desk refund that committed first makes the executor's `settle` reject. The kind then comes from
  `committedBuilder()` (`seller`, so `auto-refund`), not from the execution record.
- **Unauthorised, appealed or after-refund ruling.** The ruling must pass `gateCheck` with its stored
  taps. Its code is bound to `s.code`, because `storedRulings(code)` stamps the code, the taps must name
  it, and `amountAtomic` must equal the recorded amount. After-refund outcomes are separate names
  (`AFTER_REFUND_OUTCOMES`) and fail `isEscrow`. Round 2 never reaches settle. Round 1 paying while
  appealed is the owner's rule (Note 2026-10-30 M3, A1 dropped), not a hole.
- **Wrong kind, so the trade is recorded as released when it was refunded, or the reverse.** The watcher's
  kind for a mod-built own tx comes only from the sealed record (`winner`). The API checks it again under
  the dispute row lock, against the published round-1 ruling (`release-to-buyer` maps to `dispute-buyer`
  and the reverse). The machine refuses a ruling kind once `txHash` is set, for example after a cancel
  refund that landed first. A ruling sweep cannot be "proven" through the non-own path as another kind:
  `proven()` needs spend.info from both buyer and seller, and the loser never sends one. (A compromised
  API can of course write any state into its own database. That is outside what the moderation process
  can guard.)
- **Fee on a refund.** `bookTradeRevenue` books only for `state = 'released'`, and `dispute-seller`
  closes the trade as `refunded`. `feeOutputAtomic('dispute-buyer')` returns the fee, which matches what
  `payoutsFor` pays the fee wallet.
- **Forged checkpoint.** The API logs `log.checkpoint` only for a row that still has that hash. The
  checkpoints that count are the ones in gate.bin. `log.checkpoint` rows in the log are only as trustworthy
  as the API; that is expected.
- **Rewritten chain between two checkpoints.** `verifyChain` from the oldest checkpoint re-hashes every
  later row, and every checkpointed row must keep its hash, so this is caught at the next daily verify.
  Exception: the window after the newest checkpoint, up to 10 minutes, which the module comment declares
  as a residual.
- **Migration 212's wider read.** `assertDetail` restricts `detail` to ids, uuids, amounts, hex64,
  numbers, ISO times and short enums, at most 64 characters each. There is no text, no address and no IP
  address. The reader could already read `dispute_rulings.reason` (211) and the log's `id, at, action,
  trade_code, actor_*` (208, 211). New to it: amounts and account ids in details, including owner-only
  entries the staff scope hides (`pay.paid` usdCents and atomic per staff id, `treasury.swept` amount and
  txHash, `fee.owed`, `settings.changed`). I judge this acceptable for the process that holds the
  moderator key: see I1.
- **Tests weakened.** Only the declared `internal.test.ts` assertion changed meaning. It now asserts the
  read and asserts that an update is refused. Other test changes:
  - `autoRefund.test.ts`'s tripwire now allows `execute.ts`. That is necessary, and stricter: one call
    each, `builder: 'mod'`, and `cosigner: 'mod'` only in desk.ts.
  - `schema.test.ts` adds 212 to the migration lists, which is mechanical.
  - `gate.test.ts` lost 195 lines of fixtures, moved to `gateWorld.ts`. It has 38 tests before and after,
    and its expects went from 148 to 147. The one that left, `expect(pinned).toBe('pinned')`, moved into
    `gateWorld.ts:127`.
  - Nothing is skipped, and the moderation config excludes only `test/regtest/**`, which now has its own
    project.

## Findings

### Blocking

None.

### Minor

**M1 (regression): a second instance overwrites gate.bin before it learns that the instance lock is
held.** `main.ts` now opens the gate store and starts `startGateSync` before `startModeration`, which is
where `pg_try_advisory_lock(MOD_INSTANCE_LOCK)` is taken. On the base 23e36785 both ran after the start.
`startGateSync` runs its first pass immediately, which syncs and then `store.save()`s. On a refused start,
`gateSync.stop()` waits for that pass, so the save always happens.

Scenario: during a deploy overlap, or after a mistaken second `npm start`, instance B opens gate.bin at
snapshot S0. Instance A, which holds the lock, then records `executions[code]` for a payout it is about
to hand, or sets `settledAt`, or applies an owner tap and its counter (review M1), or `stopped`, or a new
checkpoint. B then saves S0 plus its own sync over A's file and exits. If A stops or crashes before its
next save (gate sync runs every 60 s), A restarts on the stale file. The result is a lost execution
record or a lost `settledAt`. The party's outcome dedup still blocks a double payout. But the
anti-rollback counters, `usedNonces`, `rulingsSeen` and checkpoints go back too, and the
"recorded before the party is asked" invariant no longer rests on gate.bin alone.

Fix: open the gate store and start its sync (and the executor) only after `startModeration` holds the
lock, as before. Alternatively, take an exclusive file lock (`flock`) on `MOD_STATE_DIR/gate.lock` in
`openGateStore`. Add a test that a refused start leaves gate.bin byte-identical.

**M2: rows before the oldest checkpoint are not verified at all.** `verify()` calls `verifyChain(chain,
cps[0])`, which checks that one row and then reads only `id > cps[0].id`. The module comment says
"rows before the oldest checkpoint are verified only as far as their links to it". In fact nothing before
it is read, not even its links.

Scenario: the first checkpoint is the head when the gate is first configured. All earlier history (every
`trade.*`, `ruling.*` and `staff.*` entry since Plan 4 Task 3) can be rewritten in the database, without
even re-chaining, as long as row `cps[0]` itself is untouched. The daily verify still passes. Only the
API's own verify, which the compromised API controls, would see it.

Fix: on the daily run, verify from genesis (`verifyChain(chain)` with no `from`, then check that every
checkpoint's row hash matches). This is cheap at this log's size, and it makes the first checkpoint
anchor all history before it: re-chaining a rewrite changes `cps[0]`'s `prev_hash`, so its hash. At
minimum, correct the comment.

**M3: the alarm can be silenced, and two direct signs of tampering do not raise it.**
- (a) `pass()` calls `logHead()` first. If the reader's queries fail, a pass ends with only
  `log-checkpoint-failed` at level 30, and `verify()` never runs. The compromised database can revoke
  212's grant, lock `activity_log` (there is no `statement_timeout` on the reader pool, so the loop stops
  for good), or drop the table. In each case no checkpoint is taken, no verification runs and nothing
  reaches stderr.
- (b) A 409 `checkpoint-mismatch` on `log-checkpoint` is only logged (`log-checkpoint-refused-409`).
  Rows are immutable, so in honest operation the API cannot disagree with a hash the reader read
  milliseconds earlier. A mismatch means the API's view and the reader's view of the log differ. That is
  exactly the event the alarm exists for.
- (c) The head can be frozen. The database can serve the reader role a frozen view, for example a
  row-level-security policy on `activity_log` `for select to x2f_mod_reader using (id <= N)`, while it
  rewrites the real rows above N. The head never moves, so no checkpoint is taken and the verify passes
  on the frozen part. A cheap tell exists: after a 201 for `log-checkpoint {id: N}`, the API has appended
  its own `log.checkpoint` row, so the next pass's head must be greater than N.

Fix:
- Raise the alarm (stderr, and `log-alarm` best effort) on a 409 `checkpoint-mismatch`.
- Raise it when the head did not advance after an accepted checkpoint.
- Raise it when no successful verification has run for longer than `verifyEveryMs` plus a margin.
- Set a `statement_timeout` on the reader pool.

Residual to state: a database that shows this role one consistent forged view can't be caught from inside
the database. The gate.bin checkpoints remain the evidence for an offline audit.

**M4: when the executor's record is missing, the watcher still guesses a mod-built sweep's kind.** In
`watcher.ts`, `settledKind = own ? (signedKind ?? deskNow?.record().armed?.kind ?? item.settleKind) :
...`. For `builder === 'mod'` with `rulingKind` null, `ownSweepKind` returns null, and the `??` falls
back to the desk's armed kind or to the API's `settleKind`. That contradicts its own comment ("null when
nothing names it (the API then refuses settle-kind-unknown)").

Scenario: a ruling's release was committed by the mod party, and the service restarts without
`MOD_STATE_DIR` (`rulings` absent, so `rulingKind` is undefined), or with a restored or replaced gate.bin.
Suppose the trade was disputed over the seller's cancel, so `settling = 'auto-refund'` and the desk had
armed it. The buyer-paying ruling sweep is then reported as `auto-refund`. On an honest API this takes the
I1 path: the tx is recorded on the disputed trade, and the dispute is flipped to after-refund (if still
`open`) or the owner is alerted with `dispute.refund-after-ruling`. After that, the correct
`dispute-buyer` report is refused with `wrong-state` for good. Money is not at risk, but this is the R-M2
mis-recording that this diff exists to prevent.

Fix: `const settledKind = own ? (builder === 'mod' ? signedKind : (signedKind ?? armed ?? item.settleKind))
: settleKind`. A mod-built sweep is named only by the record, or by nothing. Add a test with `rulingKind`
returning null.

**M5: the desk and the executor can displace each other's outcome on the same party.** `settle()`
replaces an uncommitted earlier outcome (party.ts). The desk blocks refunds once it sees `disputed`, but
the executor's record does not block the desk.

Scenario: the API is compromised and the seller colludes. The API alternates the watch item between
passes (`disputed` for the executor's pass, `refund_requested` with `settling: auto-refund` for the
next). The desk had not yet armed when it last saw `disputed`, and the seller's cancel conditions hold
(no `trade.paid` signal, timers). The desk can then arm and hand a seller-built auto-refund. That
replaces the executor's not yet committed buyer-paying release, and the seller wins the race by sending
its tx set first.

This needs several conditions (the desk's own arming rules, no paid signal from the buyer), so it is
minor. The fix is cheap: once `executions[code]` exists, the desk hands nothing for that trade. The
reverse also holds: once the desk has armed, the executor should hand nothing until that refund is
blocked.

### Info

- **I1 (migration 212).** The widening is acceptable: no text, addresses or IP addresses, and the reader
  already saw ruling reasons. It does expose owner-only entries to the moderation host: staff pay
  amounts per staff id (`pay.paid`, `pay.clawback`), treasury sweep amounts and tx hashes, and settings
  changes. If the owner wants owner-only details kept from that host, the chain could hash a per-row
  digest of `detail` that the reader can read instead of `detail` itself. That would need a schema
  change, so it is an owner call. My recommendation is to accept it as is.
- **I2 (growth).** Every accepted checkpoint makes the API append a `log.checkpoint` row, which is a new
  head, so an idle site still checkpoints every 10 minutes forever. That is 144 a day and about 52,000
  a year. Every entry stays in gate.bin, which is resealed and fsynced on every save (each gate sync
  minute and each `gateCheck`). The daily verify also issues one `row()` query per checkpoint. Suggest
  skipping a head whose only new row is its own `log.checkpoint`, and thinning old checkpoints (keep
  daily ones after 30 days; the chain verify covers the rows between).
- **I3.** `gateCheck` is re-run, and gate.bin re-saved, on every watcher pass for each disputed trade
  with an unfinished escrow ruling, also after `handed`/`in-flight`. That is harmless but adds write
  load. The `in-flight` check could run before `gateCheck` once a record exists for this process's
  handed key.
- **I4.** There is a small gap between `gateCheck` releasing `exclusive` and the record or hand: a stop
  applied in that window is not seen by this pass. This is equivalent to a stop arriving just after the
  hand (the known R3-M1-style limit, documented).
- **I5.** A record whose `settle()` was rejected because the desk's refund committed first stays in
  `executions` with `settledAt: null` forever. A later ruling on a new dispute `seq` for the same trade
  (late funds escalated as a system dispute) is then `mismatch` for good and needs a person. That is
  safe, and it is consistent with "late funds wait for a person" (R3-M1, declared not built).
- **I6.** The API's unlocked pre-read for idempotence means two identical concurrent `settled`
  reports can answer 201 and 409 `wrong-state`. The retry then gets 201. That is cosmetic.
- **I7.** `recordRulingExecution` maps a `DisputeRuleError` from `executed` (for example a dispute
  already `closed` by a senior's `close`) to `settle-kind-unknown`. The coins moved, but the trade stays
  `disputed` and the watcher backs off for good. A distinct reason, such as `dispute-closed`, plus an
  owner alert would make this visible.
- **I8.** Stale seam comments remain: `NEEDS_TASK_14` in `gate/store.ts:71` (checkpoints are built),
  `apps/api/src/disputes/rulings.ts:68,158`, and `NEEDS_PLAN_4_RULING_PAYOUT` in
  `apps/api/src/internal/routes.ts:326`. In `watcher.ts` the `executeRuling` doc block sits above
  `rulingKind`.
- **I9 (coverage).** The regtest covers buyer-wins only. The plan's "seller wins above the limit with two
  taps" on regtest (`dispute-seller`, the whole balance to the signed refund address) is covered
  hermetically only. The end-to-end watcher-to-API report on regtest goes through `apply()`, not the
  real route. Late-funds re-registration (R3-M1, a MAINNET PREREQUISITE) is declared not built in
  coordination.md.

## Tests run (worktree at 544cf81c, fresh npm ci, under ~/x2f-comms/check.lock, timeout inside flock)

- `npx vitest run --project @x2f/moderation --project @x2f/logchain`: 15 files, **202 passed, 0 failed**.
- `npx vitest run --project @x2f/moderation-regtest`: 1 file, **1 passed** (monerod fetched to the worktree's .regtest).
- `npx vitest run --project @x2f/api`: 106 files, **2578 passed, 1 todo, 0 failed**.

---

## Re-verify at 3617efee (red e6d08f1e on top of 544cf81c), 2026-11-12

**Verdict: M1, M2, M4, M5, I2, I7, I8 and I9 are fixed. M3 is only partly fixed: I broke it three ways
with runnable proofs, and a compromised database can still keep the alarm silent. I grade that one
minor, not blocking: no money is at risk, and it is the log-integrity layer's own residual. But it is
not closed as the module comment claims, so it should be fixed or the comment narrowed before landing.**

Tests (detached worktree at 3617efee, fresh `npm ci`, under ~/x2f-comms/check.lock with the timeout
inside the flock; worktree and node_modules removed afterwards):
- moderation + logchain: 15 files, **212 passed**.
- moderation-regtest: **2 passed** (buyer wins, seller wins).
- API: 106 files, **2579 passed, 1 todo, 0 failed**.
- My bypass proof (`m3-bypass-poc.test.ts`, a scratch file run alone in the moderation project and not
  committed; a copy is in the lead scratchpad): **3 of 3 attacks pass**, so the alarm stays silent in
  all three.

Test changes in the fix: `buyerCancel.test.ts` and `rulings.test.ts` changed only their comment and
test title (stale NEEDS_TASK_14). The other changes are new tests (instance, checkpoint, execute,
autoRefund, watchReports, regtest). Nothing is weakened or skipped.

### M1: fixed
- `startModeration` now calls `deps.gate()` only after `pg_try_advisory_lock` succeeded and the
  lock-loss and lock-end handlers are wired.
- The process entry passes the gate as a factory. Store open, attestation init, reader pool, gate sync
  and executor all live inside it. Nothing opens or saves gate.bin before the lock.
- A factory that throws unhooks both handlers, runs `pg_advisory_unlock`, releases the client and
  rethrows. The entry then ends the reader if it was made.
- `stop` runs `gate.stop()` (the sync's final save) before it unlocks.
- `instance.test.ts` covers a refused second process (gate.bin unchanged) and the entry's shape.

Residual (info): on a lost lock (connection terminated), `stopForLoss` runs the same stop. The gate's
sync and any pass already running can still save gate.bin after Postgres freed the lock, and a
supervisor-started successor may already have opened the file. The successor's next save overwrites
it, and the party still dedups outcomes. A `flock` on `MOD_STATE_DIR/gate.lock` held by the gate
store would fence this completely; it can be done later.

### M2: fixed
`verify()` calls `verifyChain(chain)` from the first row (`prev_hash` null), then re-checks every
checkpoint's row. Nothing in the API deletes `activity_log` rows (no retention), so there is no false
alarm from that. Test: "review M2".

### M3: partly fixed; still possible to silence (minor)
What was added and works:
- a 409 `checkpoint-mismatch` raises the alarm;
- a head not past the last *accepted* checkpoint raises it;
- an overdue verification (24 h plus 1 h since the last success, checked first in each pass) raises
  it once;
- `statement_timeout: 30_000` is set on the reader pool;
- stderr is always written.

What still keeps it silent:
- **A. Frozen view at the API's own checkpoint row, which now looks like an idle site.** As soon as the
  API appends its `log.checkpoint` for checkpoint N (row N+1), the database adds
  `create policy ... as restrictive for select to x2f_mod_reader using (id <= N+1)` on
  `activity_log`. On the next pass the head N+1 is past N, so no stuck-head alarm. Every later pass
  sees exactly that one row after N, and `onlyOwnCheckpoint` (the I2 fix) reads it as an idle site:
  no new checkpoint, no report, no `accepted`, and the daily verify passes on the frozen part.
  Meanwhile the real table keeps growing and can be rewritten at will.
  - Proof: 3 simulated days of activity, 1 checkpoint, 0 alarms.
  - The I2 change turned the frozen view into a normal-looking idle log.
- **B. The API refuses `log-checkpoint` with anything other than 201 or 409 `checkpoint-mismatch`**
  (503, 500, 400, or 409 with another code). The answer is only logged, `accepted` stays null, and
  the stuck-head check never arms. With the reader's view frozen at the checkpointed head, no new
  report is ever sent.
  - Proof: 3 days of 503s on a frozen head, 0 alarms.
- **C. The overdue timer lives only in memory.** `lastOk` starts at `now()` on every start. The
  database can revoke 212's grant and also end the moderation lock session (`pg_terminate_backend`)
  every 20 h or so. The process exits on `lockLost`, the supervisor restarts it, and the overdue clock
  resets each time.
  - Proof: 5 restarts × 20 h = 100 h with no successful verification, 0 alarms.
  - The restarts show only as level-30 `moderation-instance-lock-lost` lines.

Fixes I recommend:
- (A) Bound the I2 skip: take and report a checkpoint at least every few hours even when the only new
  row is the API's own `log.checkpoint`. Each report forces an append, which arms the stuck-head
  check. A filter-only view can then hide new rows only by breaking `prev_hash` links, which the
  verify catches. Forged content still needs a substituted relation, the declared residual.
- (B) Count consecutive refused `log-checkpoint` reports of any kind, and alarm after a few, say 3
  passes or 30 minutes.
- (C) Seal `lastOkAt` (and whether an overdue alarm has been raised) in gate.bin, and judge the
  overdue state from that across restarts. Also consider alarming when a start's first verify cannot
  read the log.

The declared residual (a consistently forged view, rows after the newest checkpoint) stays as stated.

### M4: fixed
`settledKind = own ? (builder === 'mod' ? signedKind : …) : settleKind`. With no record, a mod-built
sweep is reported with kind `null`, and the API refuses `settle-kind-unknown`. Test: "review M4" (the
API's `auto-refund` is ignored).

### M5: fixed
- The desk does nothing once `rulingRecorded` (`rulingKind(code) !== null`), checked before its armed
  branch, so it neither arms nor hands.
- The executor returns `desk-armed` while the desk's auto-refund is armed and unblocked and no
  execution is recorded.
- Under the alternating-state attack: on the pass where the API shows `disputed`, the desk's
  auto-refund becomes `auto-refund-api-disputed`. That is a final block, so the executor goes ahead
  and replaces the uncommitted refund, and the desk never hands again.
- A refund that already committed wins (the executor's settle is rejected and the kind comes from the
  builder), as before.
- A buyer cancel handed before the dispute is replaced by the ruling, and the desk does not hand it
  again.
- Tests in `autoRefund.test.ts` and `execute.test.ts`.

### I7: fixed, written once
- `recordRulingExecution` returns `dispute-closed` when `executed` is refused on a `closed` case.
- The route then refuses 409 and, in its own transaction, locks the latest dispute row `for update`,
  checks for an existing `ruling-payout-dispute-closed` alert for that trade and adds the owner alert
  only if there is none.
- Concurrent reports serialise on the row lock, so the alert is written once. The test sends two
  reports and gets exactly one alert with `{trade, seq, txHash}`.
- Caveat (info): it is once per trade for good. A later payout on a newer `seq` that also hits a
  closed case would not alert again. Keying the check on `seq` too would cover it; this is rare.

### I2, I8, I9
- I2: fixed, but see M3 A: the skip must be bounded.
- I8: the stale `NEEDS_TASK_14` and `NEEDS_PLAN_4_RULING_PAYOUT` comments are updated, and the
  `executeRuling` doc block is in its right place.
- I9: the regtest now runs seller wins above the limit with two taps (propose and owner approve):
  - the record is `[{sellerRefund, BALANCE}]`, co-signed by the seller;
  - the fee wallet and the buyer get 0, and the seller gets the balance less the network fee;
  - the watcher's kind is `dispute-seller`, and the trade ends `refunded`;
  - it passed on regtest.

---

## Final M3 re-verify at a42dad1b (red 6d6f331e on top of 3617efee), 2026-11-12

**Final verdict: APPROVE. Bypasses A, B and C are closed. M3 is closed apart from one gap at the
start, plus the declared residual (a database that serves this role one consistently forged chain).
The gap at the start (N1) and the gate.lock caveat (N2) are minors that do not block; fix them before
mainnet.**

Tests (detached worktree at a42dad1b, fresh `npm ci`, under ~/x2f-comms/check.lock with the timeout
inside the flock; worktree and node_modules removed afterwards):
- moderation + logchain: 17 files, **218 passed**. This includes the committed `checkpointBypass.test.ts`
  (my A, B and C, now asserting the alarm) and `gateLock.test.ts`.
- moderation-regtest: **2 passed**.
- API: not re-run; this delta touches only apps/moderation.
- New reviewer proof D (a scratch file run alone in the moderation project, not committed; a copy is
  `m3-empty-view-poc.test.ts` in the lead scratchpad): **passes**, so the alarm stays silent (N1).

### The fixes, checked
- **A: the idle skip is bounded at 3 h (`CHECKPOINT_IDLE_MAX_MS`).** Once an idle log's newest
  checkpoint is 3 h old, the head (the API's own `log.checkpoint` row) is checkpointed and reported.
  The API appends again, so a reader view frozen at that row trips the stuck-head check on the next
  pass. A frozen view therefore hides at most 3 h 10 min before the alarm.
  - I tried to defeat it by moving the freeze forward one row at a time to show only the API's new
    `log.checkpoint` rows (`using (id <= N or action = 'log.checkpoint')`). Those rows link to the
    hidden rows (`prev_hash`), so the daily verify from the first row breaks: the alarm is raised.
  - Defeating that needs rows the API writes itself, chained onto the visible head, under a policy
    that picks visible ids from a side table. That is the declared residual of a consistent forged
    view.
- **B: 3 refused or failed reports in a row raise the alarm (`CHECKPOINT_REFUSALS_MAX`).** Every
  status counts, including 0 (network error). A 409 `checkpoint-mismatch` still alarms at once. A
  refused checkpoint is sent again on every pass that has no new head.
  - Alternating two refusals with one acceptance resets the count. But each acceptance makes the API
    append and arms the stuck-head check, so nothing can be hidden that way.
- **C: the overdue clock is sealed in gate.bin (`logVerifiedAt`, `logOverdueAlarmAt`).** It is
  stamped at the first start and re-stamped only by a successful verify, which clears the alarm
  marker. Restarting no longer resets it: the committed test C runs 5 × 20 h restarts and the alarm
  fires once.
- **gate.lock (M1 residual): a pid file, made exclusively, taken before gate.bin is read, released
  by `close()`.** `close()` waits for any queued save and then refuses later ones, so a pass still
  running after stop cannot write. `stop` closes the store after the sync stops. A lock left by a
  dead pid is taken over. A successor on the same host is now refused while the old process still
  stops after a lost instance lock. Accepted for a single host, as the lead says (a pid means
  nothing across hosts).

### What can still silence it
**N1 (minor): an empty reader view from the first start.**
- If the database hides every row from `x2f_mod_reader` before the first checkpoint, the head stays
  null: `create policy ... as restrictive for select to x2f_mod_reader using (false)`.
- Then no checkpoint is ever taken, `accepted` never arms, no report is ever refused, and `verify()`
  returns ok without reading anything (`cps.length === 0`).
- That ok stamps `logVerifiedAt` every day, so the overdue clock never fires.
- Proof D: 3 days, 3 restarts, more than 50 real rows, 0 checkpoints, 0 alarms.
- It needs the database compromised before the moderation gate's first checkpoint, for example at
  deployment, or a gate.bin started afresh.
- Fix (small):
  - Run `verifyChain(chain)` even with no checkpoints.
  - Do not count a verify as successful while `checkpoints` is empty and the head is null. A live
    site's log is never empty: `owner.setup-completed` is written at owner setup, before the gate is
    pinned. So an empty view should alarm, for example once `logVerifiedAt` is overdue, the same as
    a reader that cannot read.

**N2 (minor, availability, fail-closed): a gate.lock left behind can block restarts when the pid is
reused.**
- `alive(pid)` treats any running process with that pid as the holder, the current process included.
- In a container the service usually has the same pid on every start (1, or the same number under
  an init). After an unclean exit (SIGKILL, OOM, crash) the lock file stays. On the next start it
  names the process's own pid, `alive()` is true, the open is refused with "locked by process 1", and
  the supervisor restart loop never gets the gate up. Rulings are then never paid and checkpoints
  stop until someone deletes the file.
- On a plain host, pid reuse after a reboot can do the same.
- Fix: treat a lock that names this process's own pid as stale, since a real holder in this process
  would be an open store, which the in-process path can track. Better, also record the boot id
  (`/proc/sys/kernel/random/boot_id`) and the holder's start time (`/proc/<pid>/stat`) in the lock and
  compare them.
- There is no deploy config in the repo yet, so this belongs on the deploy checklist if it is not
  fixed now.

The residual stays as stated in the module comment: a consistently forged chain served to this role,
and rewrites after the newest checkpoint (now up to 10 minutes, or 3 h 10 min against a frozen view,
before the alarm). The gate.bin checkpoints remain the evidence for an offline audit.
