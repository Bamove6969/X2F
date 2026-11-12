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

Tests (results below): moderation and logchain 202/202, moderation-regtest SEE-BELOW, API SEE-BELOW.

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
- `npx vitest run --project @x2f/moderation-regtest`: SEE-BELOW
- `npx vitest run --project @x2f/api`: SEE-BELOW
