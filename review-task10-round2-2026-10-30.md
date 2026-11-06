# Review round 2: Plan 3 Task 10 (shadow trade, auto-refund, buyer-cancel co-sign, signals): CHANGES REQUIRED (1 Important, 3 Minor)

Branch `origin/wip/second-p3-task10` @6228584. The fixes are in bf2bafe. It merges the main line at d48033f (94c37b0; the commit message says 414e722, but d48033f is what was merged) and task9-io 8cfdbe6 (6228584; Task 9 round-2 fixes, which have their own round-3 review). Reviewer: read-only helper, 2026-10-30. Round 1: `review-task10-2026-10-29.md`. Lead decisions: 13:23 line in `to-second.log`.

I checked every item in the code and in the tests, not from the builder's messages. Test runs were in the detached worktree `~/x2f-worktrees/rv-t10r2`: 6228584 plus a trial merge of da2d3c9, never committed, removed afterwards. Each run was one command under `check.lock`.

## Verdict: CHANGES REQUIRED (1 Important, 3 Minor)

I1, I3 and M1–M7 are fixed and tested. The builder's file:line claims are accurate. I2 is fixed for the case the tests cover, but it compares the receipt with the **later** of the shadow's and the API's alert. In practice the later one is usually the shadow's, because the seller's client posts `request-refund` to the API first and only then sends the `trade.refund-request` signal. So a receipt that arrives after the API's `mark-paid` window has already closed can still be auto-refunded (N1). I confirmed this with a scratch test. It is a one-line fix.

**R2-M1 is not closed by this branch.** The watcher still checks sweeps against the API's `settleKind` (see the coverage note below).

Lead-accepted items: (1) after an escalation the API shows `disputed`, so no buyer-cancel co-sign; (2) deploy API first; (3) the constants. I checked all three, and they are implemented as described.

## Round-1 items

**I1: fixed.** The API watch list carries the pause-shifted `final_alert_at` (`apps/api/src/internal/routes.ts:296-314`, the machine's `move` on resume). `link.ts:131-136` parses it, and a bad or missing date becomes null. With a null API alert, `autoRefundStep` waits (`autoRefund.ts:102-103`, `api-final-alert-missing`), and the 60-min fallback then escalates. Signing waits until `max(shadow.finalAlertAt, api.finalAlertAt) + 15 min + 60 s` (`:104-105`), and then until `seen + 15 min + 60 s` (`:109`).
- Tests: I1 (a) mod down across the pause start; I1 (b) early signal plus missed maintenance; ±1 ms at the margin.
- Note: `mark-paid` is allowed during maintenance (machine.ts:151 `WHILE_PAUSED`; `base()` = `pausedAt`), so a pause only ever gives the buyer more time. The pause-shifted alert never shortens the buyer's real window.

**M1 (clock skew): fixed within the 60 s margin.** The shadow's alert is on the mod's own clock. It is set when the seller's signal is opened, which is after the API post (refundFlow.ts: API first, then the signal). In the normal order, skew therefore doesn't matter. Only the API alert term depends on the mod and API clocks agreeing within 60 s. Residual: an ops requirement (NTP on both hosts), which should be written down in the deploy notes.

**I2: partly fixed. See N1.** `ALERT_LATE_MS` = 2 min (`autoRefund.ts:44`). The `alert-late` escalation is at `:108`, the API accepts `alert-late` as `escalate` (`routes.ts:254`), and the watchReports test covers it. The problem is which alert the receipt is compared with.

**I3: fixed.**
- `buyerCancelStep` refuses `buyer-paid` on every pass, before any other check (`buyerCancel.ts:42`).
- It co-signs only while the API shows `funding`/`securing`/`secured`/`refund_requested`, or `settling` with `settleKind === 'buyer-cancel'` (`:35-38`). So it never co-signs on `paid`, a release or other settlement, `disputed`, `lapsed` or a closed trade.
- `paidSeen` is set whenever a valid `trade.paid` is opened, even when the shadow refuses it (`desk.ts:213`, before `feed`).
- A `trade.cancel` the shadow refuses does not set `cancelSeen` (`desk.ts:222-225`). Note that the shadow machine still accepts `buyer-cancel` from `paid` (`BUYER_CANCEL_SETTLE` includes `paid`, machine.ts:143); `paidSeen` is what blocks it.
- Tests: paid→cancel, cancel→paid before unlock, each blocked API state, and a shadow-refused cancel.
- One gap: an *armed* buyer-cancel is not rechecked (N2).

**M2: fixed.** Every pass catches up on chain facts and `settledTx` (`desk.ts:302-313`, `watcher.ts:379-380`). `ensureDesk` is retried every pass (`watcher.ts:271-279`). Tested.

**M3: fixed.** `autoRefundStep` runs whether the cancel waits or is refused (`desk.ts:366-368`). Tested.

**M4: fixed.** `over` covers an API or shadow closed state, a shown `settledTx`, or a `settled` report (`desk.ts:334-340`), and then nothing is signed. Tested (late coins after the sweep).

**M5: fixed.** `desk.ts:233`.

**M6: recorded for Task 31** in coordination.md. Accepted.

**M7: fixed.** When `paidSeen` holds and the API still shows `refund_requested` 2 min later, the trade escalates `refund-unverified` (`autoRefund.ts:92-95`). The fallback hour restarts while the trade is paused (`desk.ts:331`). Both escalate only and never sign; a lying API can only make them happen sooner. Tested, including the race within the grace.

**Landing (round 1): done.** `main.ts:116` passes `maintenanceSince: () => siteMaintenanceSince(db)` (`timers.ts:34-37`). The tripwire is deleted. Moderation migrations are 001, 003_watch, 004_signals, 005_sweeps.

## New items

### Important

**N1. The I2 check compares the receipt with the later alert, so a receipt that came after the API's `mark-paid` closed is still auto-refunded.** `apps/moderation/src/autoRefund.ts:104,108`.
- `alertAt = max(shadow.finalAlertAt, api.finalAlertAt)`. The buyer's 15 minutes are counted by the API from **its own** `finalAlertAt` (machine.ts:446). The shadow's alert is set when the mod opens the seller's `trade.refund-request` signal, and the seller's client sends that signal after the API post (`apps/web/src/screens/trade/refundFlow.ts`). The shadow's alert is also late whenever the early signal is held in `pending` until the shadow's own payBy. So `max` is normally the shadow's alert, and it can be much later: a relay delay, a moderation restart, or a mod outage.
- Failure scenario (I reproduced the pure step in a scratch test, and it returns `sign`):
  - API alert at 12:00; its `mark-paid` closes at 12:15.
  - The moderation service is down from 12:00 to 12:30, so the shadow's alert is 12:30.
  - The buyer's push is delayed and the receipt arrives at 12:20, after the window has already closed, so the buyer never had a chance to tap "I've paid".
  - The check `12:20 > 12:30 + 2 min` is false, so there is no `alert-late`.
  - At 12:46:01 the mod co-signs the refund.
  - This is exactly the case the lead's I2 (b) decision sends to a person. The review copy's claim that "the later of the two alerts … i.e. the API's window" is wrong in this ordering.
- Fix: compare with the earlier alert, so that it fails safe:
  - `if (seen.getTime() > Math.min(t.finalAlertAt.getTime(), apiAlert.getTime()) + ALERT_LATE_MS) return escalate('alert-late')`
  - Keep `max` for the wait at `:105`.
- Test: a shadow alert 30 min after the API alert, with a receipt at API alert + 20 min → `alert-late`, nothing signed. Also: shadow alert = API alert + 10 s (the normal order) with a receipt at API alert + 2 min 5 s → `alert-late`.

### Minor

**N2. An armed buyer-cancel is never rechecked against `paidSeen` or the API state.** `apps/moderation/src/desk.ts:341-350`.
- The lead's I3 decision says "check every pass". Once `armed.kind === 'buyer-cancel'` is saved, later passes go only through the armed branch. That branch calls `settle` again after a restart, or whenever the payouts change (a late surplus), without looking at `r.paidSeen` or `apiAllows`.
- Scenario: cancel → mod arms (the coins are unlocked) → the buyer's tx set has not come in yet → the buyer's old client sends `trade.paid` → the mod restarts → the armed refund is handed to the party again, and the seller keeps the fiat and gets the XMR back.
- Impact is small: the builder is the buyer, so the buyer's own client still has to build the set, and an honest API refuses `mark-paid` after `buyer-cancel` (`settling`).
- Fix: in the armed branch, for `kind === 'buyer-cancel'`, skip `settle` and `logOnce('armed', 'buyer-cancel-buyer-paid')` when `r.paidSeen`, or when the API is not in `API_CANCEL_OK` / `settling(buyer-cancel)`. Export `apiAllows` for this.
- The armed auto-refund needs no recheck: it is armed only after both `mark-paid` windows have closed.

**N3. The shadow's alert-time gap also affects the deploy note.** This is documentation only. For trades in flight at the first deploy, the shadow's payBy (and so its alert) is later than the API's by as much as the deploy delay. With N1 fixed (`min`), a buyer whose receipt was within 2 min of the API alert still auto-refunds, only later, so nothing more is needed. Without N1, those trades are the most exposed. Make sure the deploy note in coordination.md says "delayed, not lost", and that this holds only once N1 is in.

**N4. When the escalate report is refused, the trade is still marked escalated.** `desk.ts:106`, `:387-389`. `accepted()` treats `409 wrong-state` as accepted, so `r.escalated` is set, and auto-refund is then off for good on this desk. That fails safe (it can't sign). But if the 409 came from a transient state (for example, the API moved to `paid` in the same instant), nobody is alerted by this desk afterwards. Log the 409 reason with a distinct reason (`escalate-wrong-state`) so ops can tell the two cases apart. No behaviour change needed.

Not findings (checked):
- **Double signing.** At most one `armed` per desk. `armed` is saved before `settle` (`desk.ts:361-362`, `:381-382`), `inFlight` de-duplicates within one process, and the party refuses a second outcome (`committed`).
- **Restart mid-decision.** The desk record is saved in one transaction per frame and per step. The signal guard and ack seq are saved before the ack goes out. A crash between saving the record and calling `settle` re-sends the same outcome.
- **Replayed or reordered signals.** The guard is persisted per channel. `paid` then `cancel` gives a shadow-refused cancel or `paidSeen`. `cancel` then `paid` gives `paidSeen`, which blocks the sign.
- **A compromised API.** It can delay anything (state, `paused`, a later alert, a missing receipt). It cannot cause an auto-refund before the shadow's own alert + 15 min + 60 s, and it cannot redirect the payout (seller-signed address only). It can fake a receipt, but then it also controls `mark-paid` itself, which was accepted in round 1. For a buyer-cancel the binding checks are the mod's own `cancelSeen`/`paidSeen`. A lying API can only add a co-sign the buyer asked for while hiding `paid`, and `paidSeen` covers that whenever the buyer's `trade.paid` signal arrived.
- **The 60-min fallback** only escalates and never signs.
- **Gap between the timer pass and a pause.** The API backdates a pause to `maintenance_since`, and the 60 s margin covers a timer loop shorter than 60 s.

## R2-M1 coverage note (Task 9: a compromised API naming a kind that pays the forger)

**Not covered.** `watcher.ts:354-356` still passes `settleKind: item.settleKind`, the API's value, to `spendEvidence`/`proven` (`watcher.ts:231-235`). The desk's shadow is never consulted for the sweep's kind. Task 10 adds `settleKindFor(r.shadow)` only to feed the shadow itself (`desk.ts:298`, `:311`).

What the shadow *could* cover now (suggested fix, in watchOne before `spendEvidence`): accept the API's kind only when the desk's own facts agree, otherwise pass null, which gives `sweep-unproven` and then the 6 h escalation.
- `auto-refund`: only if this desk armed `auto-refund`.
- `buyer-cancel`: only if `cancelSeen` and not `paidSeen`.
- `lapse-refund`: only if the shadow is `lapsed`.

This closes the attack in which a compromised API names a refund kind during a release, or the reverse in which it names `release` while this desk armed a refund.

What the shadow **cannot** cover: `release` versus `mutual-cancel`. The shadow receives no signal for either. The seller's release and both sides' cancel accept are API events only (signals.ts types: terms, paid, cancel, extend, refund-request, ack). So a compromised API that names `mutual-cancel` during a seller's release, or `release` during a mutual cancel, still matches a forged sweep. Closing that needs a seller-signed `trade.release` signal and a both-signed cancel accept on the signals channel, with the shadow fed from them. That is a follow-up task, and it should be recorded as still owed in the Task 9 R2-M1 entry, not marked done by Task 10.

## Landing and conflict notes

- `git merge-tree` against `origin/claude/compassionate-johnson-k95ssr` (27e96df): **clean**.
- Against da2d3c9 (FU-D): one conflict, `apps/api/test/schema.test.ts` (one hunk). Resolution: the main line's list (with `012_login_tags.sql`) plus `113_release_claim.sql` before `115_news.sql`. The other two lists in that file auto-merged correctly. `package-lock.json` is unchanged.
- Cross-branch heads-up (from the Task 38/39 round-2 review): when Task 38 lands after this, its `NEEDS_TASK_9_TIMER_LOOP` tripwire fires on `apps/api/src/trades/timers.ts:44` (`closed_at is null or paused_at is not null`). The query must then add the awaiting-cancel-confirm predicate.
- Deploy order: API first (accepted).

## Test results (6228584 + trial merge da2d3c9, every run under `flock ~/x2f-comms/check.lock`)

- tsc --noEmit: trade 0, moderation 0, api 0, web 0 errors.
- vitest @x2f/trade + @x2f/moderation: 16 files, **406/406**.
- vitest @x2f/api schema, watchReports, timers, push: 4 files, **186/186**.
- vitest @x2f/web, full project: 69 files, **982/982**.
- Scratch probe for N1 (pure `autoRefundStep`, never committed): returns `sign` for the scenario above.
- Not run:
  - Regtest: Task 10 changes no escrow code. The escrow changes come from task9-io 8cfdbe6, which its own round-3 reviewer was running (rv-t9r3 spend-info) at the same time.
  - Playwright: Task 10's fix round changed no web code beyond the merges.
  - The full check.
