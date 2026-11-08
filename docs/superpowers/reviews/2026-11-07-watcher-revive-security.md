# Watcher revival: security review (7 Nov 2026)

Reviewer: independent security helper for the lead (read only, plus this file).
Branch `wip/lead-watcher-revive` at 2bebf814 against main cbf8e50e (merge base 6ccb3e2d, 37 commits, 78 files).
Scope: Plan 3 Task 9 I/O (moderation chain watcher, `release-claimed`, the 6 h `spend-unshown` fallback, `mod_sweeps`), the Task 9 view (`releaseClaimedAt`, `SettleWait`), Task 10 (the desk, the shadow trade, the auto-refund and buyer-cancel guards, the shadow veto), the API side (`/internal/v1/watch`, watcher reports, the timer loop, `assertOneSiteFlagsRow`, the `cancelReturn.ts` change), and the earlier fixes M1, M3, M4 and R4-M2.

Checks run: `npm test -- --project @x2f/moderation` passed (6 files, 94 tests). I also ran one throwaway probe test for finding 1 through the moderation harness. It passed, which confirms the finding. I deleted it afterwards and did not commit it.

## Verdict

**CHANGES REQUIRED.** There is one Important finding with funds-level impact. It breaks owner rule g62 (maintenance freezes trade timers) and the "API brake" assumption the auto-refund depends on. The fix is small. One more Important finding is a deployment hazard that needs a cheap guard before production. The rest are Minor.

## Findings

### 1. Important (funds-level impact). The auto-refund is armed from a watch item that may be minutes old, and once armed it is never checked again

Where:
- `apps/moderation/src/watcher.ts:437-439`: one `pullWatch()` per tick.
- `watcher.ts:451-518`: every trade is then handled in turn. Each one does `handle.funds()`, a full wallet sync on the party's chain, plus `proveSweep` and report POSTs. On the first tick after a restart, `start(args)` also opens each wallet in this same loop.
- `watcher.ts:400-409`: `desk.step({ api: item, ... })` gets that old item.
- `apps/moderation/src/desk.ts:363`: `now = o.now()` is read at step time.
- `apps/moderation/src/autoRefund.ts:85-87,106`: the `paused` check and the window check compare the old `api.paused`, `api.state` and `api.finalAlertAt` with the current clock.
- `desk.ts:418-456`: an armed `auto-refund` is handed to the party on every pass. Nothing checks the API state, `paused` or `paidSeen` again. Only `buyer-cancel` gets the N2 recheck (`blocked`, `desk.ts:443-447`).

The margin `AUTO_REFUND_MARGIN_MS` (60 s, `autoRefund.ts:43`) is documented as "one watch pass plus clock skew". But the API facts are as old as the whole tick has run when the loop reaches this trade, not one pass. That age has no bound: N trades × (wallet sync + daemon calls, each up to `DAEMON_TIMEOUT_MS` 15 s). The first tick after a restart is the worst case, because it opens every wallet in turn, and deploys tend to happen around maintenance.

Scenario. The trade is `refund_requested` and the buyer saw the alert at once.
1. The tick pulls at alert + 14.5 min. The trade is not paused.
2. Maintenance starts at alert + 14.6 min. The web app is replaced by the Maintenance screen and `/v1/*` answers 503, so the buyer can neither mark paid nor send `trade.paid`. The API pauses the trade with 0.4 min of its mark-paid window left.
3. The tick reaches this trade at alert + 16.5 min. `autoRefundStep` sees "not paused, refund_requested, alert + 15 min + margin passed" and returns `sign`. The desk saves `armed: auto-refund` and hands the seller-built refund to the party.
4. Maintenance ends. The API shifts `finalAlertAt` and the buyer still has 0.4 min, so the buyer taps "I've paid" and the API accepts it (`paid`). The buyer's `trade.paid` reaches the desk (`paidSeen = true`), but the armed auto-refund ignores it.
5. During the 0.4 min after the resume, the seller's app (the honest one, whose view still reads `refund_requested`, or a patched one at any time) builds the refund, and the mod co-signs it.

Result: the seller gets the coins back after the buyer paid fiat. The `settled` report then hits `paid`, where `settleKindFor` is null, so it backs off `settle-kind-unknown` forever and a person has to unpick it.

The same old item also drives the non-maintenance case. The buyer marks paid at the API in the last seconds of the window, the pulled `refund_requested` is out of date, and the `trade.paid` signal is late or dropped (by the relay, or by a buyer app that crashed after the POST). Here the API brake is the one that fails.

It also drives the escalations. `alert-unseen`, `refund-unverified` and the watcher's `spend-unshown` (`watch.ts` reads `trade.paused` from the same item) can fire after maintenance began. That direction fails safe, but it still goes against g62.

The probe confirmed it. Through the harness, the API was set paused and the clock moved forward inside `handle.funds()`, that is, after the pull. The desk armed and handed the auto-refund in that same pass (`settles.length === 1`, `armed.kind === 'auto-refund'`).

Recommended fix (any one closes the window; (a) plus (c) is the most robust):
- (a) Judge every API-dependent condition at the time the facts were true. Pass `pulledAt` with the item and use `min(now, pulledAt)` as the clock for the auto-refund's window checks. Equivalently, require `pulledAt >= max(alerts) + 15 min + margin` and `!paused` at `pulledAt`. For escalations, do not escalate when `now - pulledAt` exceeds about 10 s; wait for a fresh pull instead.
- (b) Or re-pull the item (a one-trade internal read, or the list again) just before `save(armed)` and before any escalation report.
- (c) Give the armed auto-refund the same recheck that N2 gave the armed buyer cancel. Do not hand it again (after a restart or a payout change) once `paidSeen`, or while the API shows `paid`, `disputed` or paused. R3-M1 (no withdraw) still applies, but a restart then stops it.
- Add tests: maintenance switched on between the pull and the desk step, and the API turning `paid` between them, with and without a `trade.paid` signal.

### 2. Important (deployment hazard). Nothing stops two moderation processes running at once, and the desk record has no concurrency control

Where:
- `apps/moderation/src/main.ts:123` and onward: there is no single-instance lock. The only advisory lock is the migrator's (`keystore.ts:61`).
- `desk.ts:189,199-213`: the desk keeps `record` in memory from `openDesk` and every `save` overwrites the row, with no version or `updated_at` check.
- `watcher.ts:422-424`: `mod_watch.state` is overwritten the same way.
- `main.ts:380`: `watch()` is exposed on the handle and can run alongside the loop.

Scenario: a rolling deploy, a supervisor restart while the old process is still draining, or an operator starting a second copy.
1. The relay replaces the older socket per role with 4409, which is fatal for `wsTransport` (`transport.ts:26`). The old process's signals loop and party end for good, but its watcher loop keeps stepping its desks.
2. While both run, the new desk opens the buyer's `trade.paid`. The old desk's next `save(r)` writes its out-of-date in-memory record back: `paidSeen: false`, an older ReplayGuard, no `armed`, `escalated: null`.
3. The next restart loads the reverted record. The auto-refund guard has then lost the buyer's payment signal (only the API state still brakes, see finding 1). The ReplayGuard has moved back, and an armed refund or a recorded escalation can disappear or come back.

The `mod_watch` overwrite can likewise roll back `spendUnshownReported` or `claimReported`. The API's `wrong-state` makes those mostly idempotent.

Recommended fix:
- At startup, take `pg_try_advisory_lock(<moderation key>)` on a dedicated connection, held for the life of the process, and refuse to start if it is held. Document "one moderation process" next to the API's one-process note in coordination.md.
- Optionally, add an optimistic check to the desk save (`where trade = $1 and updated_at = $old`, reload and redo on a miss).
- Do not expose `watch()` outside tests, or route it through the loop's promise chain so ticks never overlap.

### 3. Minor. The `settled` kind is read outside the trade's lock and can differ from the kind the mod proved

Where: `apps/api/src/internal/routes.ts:270-277`. `loadTrade` and `settleKindFor` run without a lock, then `applyEvent` takes the row lock and applies `settled` with that kind. The machine accepts `settled` of any kind from every `SETTLED_FROM` state (`machine.ts:182,484-490`). On the moderation side, the kind the proof used (`watcher.ts:373-376`) comes from the tick's earlier pull.

Scenario: the pull shows `settling/release` and the sweep is proven against the release minimums. Before the report, the signing window reverts the trade to `secured` and the buyer cancels (`settling/buyer-cancel`). The trade is then recorded `refunded` as a buyer cancel, which cannot be disputed and waits for the seller's Confirm cancel, although the buyer received the coins. The window is narrow, both parties signed the tx, and no coin goes anywhere a signer did not agree to. The trade record and the dispute rules are what end up wrong.

Recommended fix: the watcher sends the kind it counted the sweep for (the proven kind, or its own armed kind for an own tx). The API checks `settleKindFor(prev) === kind` inside the transaction (`applyEvent`'s `within`) and answers 409 `settle-kind-changed` otherwise.

### 4. Minor (liveness). An armed auto-refund while the API shows the buyer's cancel settling

Where: `desk.ts:418-456`. R3-N1 covers an armed buyer cancel while the API is not settling it, but the mirror case is not handled.

Scenario: the desk armed the seller-built auto-refund, then the buyer taps Cancel and the API enters `settling/buyer-cancel`. The buyer's app builds the cancel with the mod as co-signer. The mod's party holds the seller-built outcome and refuses it. The seller's app does not build in that state. If `settleBy` is null (not releasable) or a claim pins the trade, the 6 h `spend-unshown` fallback sends it to a person. No coin is at risk, because both outcomes pay the same seller-signed address.

Recommended fix: none needed for money. Document it, or accept the buyer-built set as the same payout when armed `auto-refund` and the API is settling `buyer-cancel` (only if the party has not committed).

## What I confirmed safe

- The mod party's terms, addresses and fee wallet come only from `signed_terms` and `mod_party_state`, never from the API (`partyArgsFor`, `main.ts`). Only the seller-signed `trade.terms` address, equal to the attested one, is ever paid (`termsMatch`, `refundFor`).
- Import-only sweeps count only when both parties' sealed `spend.info` name the tx and a tx key proves `sweepMinimums` from the mod's own terms (`watcher.ts:236-258`). `mod_sweeps` gives one trade per tx (primary key plus `on conflict do nothing`, safe under concurrent inserts). The `auto-refund` and `buyer-cancel` kinds can never be proven by import. Own txs are claimed too.
- Shadow veto: with desks configured, a desk that failed to open falls back to `NO_DESK_FACTS` (fail safe). Once a refund is armed, only that kind is accepted. `lapse-refund` needs the shadow's own lapse. I found no bypass beyond buyer and seller colluding, which they can do anyway.
- Watch state is persisted only after every report, the desk step and the channel close went through. `wrong-state` counts as done. Every report is safe to repeat. The channels close only after a sweep this mod showed, or for an escrow that never received a coin, and never with a late coin outstanding.
- API reports: exact keys, attested trades only, signed internal requests with the replay guard. `release-claimed` only while settling, once. `escalate` only with coins in the escrow.
- Maintenance at the API: `/internal/v1/watch` reports `paused` as soon as `maintenance_since` is set (open trades). The timer loop pauses at `maintenance_since`. `cancelReturn.ts` reads a missing row as no maintenance, which is safe only because of `assertOneSiteFlagsRow` at startup (tested). No code deletes the row. Buyer cancel and mark-paid are allowed while paused by design (`WHILE_PAUSED`), and the gate blocks the routes anyway.
- M3: a throwing pass is logged and the work loop and watch loop both continue. R4-M2: a party committed to the buyer-built cancel refuses the re-arm (tested).
- Web: `releaseClaimedAt` is sent only while `settling` and is the same for both traders. `finalAlertSeenAt` is still buyer-only. `SettleWait` never tells a team member (`member`) to sign. Nothing about the moderator beyond the claim time reaches either trader.
- Clock trust: the shadow runs on the moderation clock. The API's pause-shifted alert is combined with `max` for waiting and `min` for lateness. The NTP requirement is documented (coordination.md). Chain heights come only from the mod's own wallet. Missing heights mean nothing is reported or signed.

## Known and accepted (not re-raised)

- R3-M1: an outcome already handed to the party is not withdrawn.
- R3-M2: the shadow's `fundBy` lag vetoes an honest lapse refund, which then goes to a person.
- Lead decision (b): a claim is one signed party's word. A party can send a bare `spend.claim` to keep `settling` from reverting and to show the counterparty "Release sent, waiting for the network" with no countdown, until the 6 h fallback. Disputes stay open after `settleBy`. This delays and griefs; it does not misdirect coins.
- A trade whose buyer and seller collude can claim another trade's tx first (Task 9 round 3 residual). That only griefs the other trade.
- The mod sees a pause up to one pass late (coordination.md). Finding 1 shows the real figure is one whole tick, not 15 s.

## Not tested

- Any interleaving between the per-tick pull and a trade's desk step. Every desk test changes the network between `watch()` calls, never during one (finding 1).
- Two moderation processes, or overlapping `watch()` calls (finding 2).
- The API-side `settled` race against the timer loop or a client event (finding 3). `watchReports.test.ts` applies reports to a static trade.
- An armed auto-refund while the API is `settling/buyer-cancel`, `paid` or `disputed`, and after a restart in those states (findings 1c and 4).
- Real monero-ts timing for a tick with many trades (wallet sync per trade). There is no load or timing test of the watch loop.
- The relay dropping or delaying `trade.paid` while the API state is out of date. Signals are tested only as delivered.
- Playwright and e2e (`refund.spec.ts`, `fund.spec.ts`): read only, not run here.

## Re-verify 2ead888c (8 Nov 2026)

Fixes checked: 6c56e775 (F1), e446266b (F2), f60b2e13 (F3), e5550f9d (F4, docs). Checks run: `npm test -- --project @x2f/moderation --project @x2f/api` passed (85 files, 1957 tests). I also ran one throwaway probe test through the moderation harness for R1 below. It passed, which confirms the stuck path. I deleted it afterwards and did not commit it.

### Verdict

**CHANGES REQUIRED, one item (R1).** F1 closes the original scenario, but its permanent block opens a path where a seller's refund is stuck for good. The fix is small. F2 and F3 are sound. R2 to R5 are Minor and can land later.

### What F1 closes (confirmed)

- **The original scenario.** The watch list's read time is taken before the request. After the slow `funds()`, the watcher reads the list again if it is older than `WATCH_FRESH_MS` (10 s). `autoRefundStep` is judged at `min(now, read time)`, and arming or escalating needs facts no older than 10 s (`current()`). So the API's mark-paid window must already have closed at a time the API was seen unpaused. A pause after that read cannot reopen a window that had already closed; only clock skew is left, and the 60 s margin covers it. Tested: maintenance and API `paid` both arriving inside `funds()`.
- **Escalations during maintenance.** `alert-unseen`, `alert-late`, `refund-unverified` and `spend-unshown` all use a refreshed, unpaused item, so they can fire at most about 10 s into maintenance (before: one whole tick).
- **A refresh that fails.** Nothing is armed, escalated or handed that pass, and the watch state is not persisted. The next pass retries. Not stuck.
- **A restart with an armed refund.** `armedRefundBlock` runs every pass before the outcome is handed to the party. Tested for paid, disputed, paused and `trade.paid`, each across a restart.
- **Temporary blocks.** A pause that ends, another API state, or the API's pause-shifted mark-paid window still being open all clear by themselves. Tested.
- **`paid` and `disputed` as permanent blocks.** API `paid` never returns to `refund_requested` (the machine has no such edge), and the seller can dispute from `paid` at any time. `disputed` is a person's job. So these two permanent blocks leave the trade with a dispute route.

### R1. Important (new, introduced by F1 c). The buyer's `trade.paid` after arming blocks the auto-refund for good, and nothing escalates

Where:
- `desk.ts:100`: `auto-refund-buyer-paid` is in `FINAL_BLOCKS`.
- `desk.ts:509-556`: the armed branch for an `auto-refund` never runs `autoRefundPass`, so the `PAID_CONFLICT_MS` and `refund-unverified` escalations that cover this case before arming are skipped.

Scenario:
1. The desk arms the auto-refund correctly, after the API's mark-paid window closed.
2. Before the seller's build lands, the buyer sends a sealed `trade.paid`. This can be a lie, or a late tap whose API POST is refused `too-late`.
3. The API stays `refund_requested`.
4. The moderation service restarts. That is routine, and R3-M1 only keeps the handed outcome within one process.
5. From then on:
   - the refund is never handed to the party again;
   - the desk never escalates;
   - the API has no timer in `refund_requested`;
   - `onDispute` refuses `refund_requested`, so the seller cannot open a dispute either.

The seller's coins stay in the escrow with no automatic or manual route out. The buyer can trigger this at will.

Probe: an armed refund, then `trade.paid` with the API still `refund_requested`, then a restart, then 5 h of passes. Nothing was settled and nothing was escalated; the record stays `blocked: auto-refund-buyer-paid`.

Fix: when the armed auto-refund is blocked by `auto-refund-buyer-paid` while the fresh API item shows `refund_requested` (not paused) and `escalated` is null, escalate `refund-unverified` and record `escalated`. Waiting `PAID_CONFLICT_MS` first, as before arming, is fine. The machine already accepts `escalate` from `refund_requested` with coins. Add a test with the probe above.

### R2. Minor. For an own tx, the `settled` kind comes from the desk's record, and the API can refuse it forever

Where: `watcher.ts:430-431`. `settledKind` for an own tx is `deskNow.record().armed.kind`.

Scenario: the R4-M2 path. The party had already committed to the buyer-built cancel, but the record says `armed: auto-refund`. The buyer cancels again at the API (`settling/buyer-cancel`, and the buyer's `spend.info` claim keeps the trade there). The committed cancel lands as the mod's own tx. The watcher reports `settleKind: 'auto-refund'`, the API answers `settle-kind-changed`, and this repeats every pass with no back-off. `spend-unshown` never fires because a sweep is shown. The escrow is empty and the seller has the coins, so only the trade record is stuck; a party must open a dispute by hand (allowed after `settleBy`).

Fix: name an own tx's kind from the outcome the party actually signed (builder `buyer` means `buyer-cancel`, builder `seller` means `auto-refund`). Alternatively, let the API accept either of those two for an own tx, since their payouts are identical. Also back off on `settle-kind-changed`.

### R3. Minor. When the instance lock is lost, the process stops but does not exit

Where: `main.ts`, `lock.on('error')` calls `stop()`.

The loops stop but the process stays up doing nothing, so nothing restarts it. A half-open connection (no TCP keepalive) may also never emit `error`. The server would eventually drop the session and release the lock, while the old process keeps working. The `version` checks still protect the desk and watch rows. `mod_escrow_state` has no version check, but the relay's 4409 ends the old party.

Fix:
- On lock loss, exit non-zero from the entry point.
- Set `keepAlive` on the pool, or check the lock connection every pass (`select 1`).
- Remove the `error` listener in `stop()`. The tests print `MaxListenersExceededWarning: 11 error listeners added to [Client]`, because the pooled lock client keeps one listener per start.

### R4. Minor. Plan 3 has no ruling path once the armed refund is blocked by `paid` or `disputed`

`verifyRuling` refuses every ruling in Plan 3. A disputed trade whose armed refund is blocked therefore waits for Plan 4's rulings. This is consistent with the plan; recorded so the dependency is not forgotten.

### R5. F4

Documented as a delay-only limit in coordination.md. Accepted.

### F2 and F3 (sound)

**F2:**
- `pg_try_advisory_lock` is taken on a dedicated pool connection for the life of the process, and a second process refuses to start (exit 1).
- The key `x2mi` differs from the migrator's `x2mo`.
- The pool's `max` went from 4 to 5, so 4 connections are still free for the work, as before.
- `mod_trade_desk` and `mod_watch` gain `version`, and saves happen only over the version read. On a miss the desk reloads its record and the signal is not acked (the sender resends), and the watch state is dropped (every report is safe to repeat).
- `tick()` is serialised, so `watch()` never overlaps the loop.
- Migration `006_versions.sql` is in the moderation schema's own folder (001 to 006). It is not part of the API's 1xx/2xx/3xx numbering. Across all 65 remote branches, `006` exists only on this branch, so there is no clash.

**F3:**
- The report carries `settleKind` (exact keys).
- The API refuses a null kind with `settle-kind-unknown` and a different kind with `settle-kind-changed`.
- The kind is checked again inside `applyEvent` (`within`, under the row lock, before the commit; a throw rolls back). Tested.
- The note "Deploy the API first" is recorded in coordination.md. Until the API is deployed, an old API refuses the new key set with 400, which delays settlement but loses nothing.

### Still not tested

- A seller-side escalation after the buyer-paid block (R1).
- An own tx whose recorded armed kind differs from the API's (R2).
- Losing the lock connection in a real Postgres failover (R3).
- Real monero-ts tick timing.
