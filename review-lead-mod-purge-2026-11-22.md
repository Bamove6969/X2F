# Review: wip/lead-mod-purge @ 9a24ac57 (Plan 7 Task 2 follow-up: the moderation trade shred)

Reviewer: independent security reviewer for the lead, 22 Nov 2026. One round.
Base: main 2da4f93d. The branch is 8 commits on top of it (25615586 .. 9a24ac57).
Scope: `git diff origin/main...9a24ac57`: API migration 761, `GET /internal/v1/trade-shred` and the `trade-shredded` report, the purge's order insert, `tradeShredTick`/`tradeShredHold` in apps/moderation, the gate's `tradeRulingPending`/`forgetTrade`, `watchShowsEmpty` in @x2f/trade, and the tests. The worktree was `.claude/worktrees/rev-mod-purge` (detached). It has been removed.
Read first: review-p7-retention round 2 (R2-I2: key material only on "shown empty", never on the API's word) and round 3. There is no "R3-I1" in review-p7-retention round 3; round 3 closes R2-I1 and R2-I2. The R3-I1 that this branch's docs cite is the watcher's both-parties sweep rule (`watcher.ts` spendEvidence, review round 3), and I used that one for Q3.

## Verdict: APPROVE WITH MINORS

I found no path that deletes keys or signed terms for an open, funded, disputed or unswept trade.
- The API's order and the API's watch list only ever add holds. They never release one.
- The key material goes only when two things are both true: the moderator's own `mod_watch` row says `watching = false`, and `watchShowsEmpty` holds on the moderator's own watch state. The watch state is built from the moderator's own wallet view and from sweeps shown to it (its own signature, or both parties' sealed spend.info plus a tx-key proof).
- An API that lies can at most close an escrow that never received a coin, which is the Q4 residual below.
- Clock skew, a restart mid-shred and a failed gate save all fail closed or repeat harmlessly.

The Minors cover three things. One is a retention gap larger than the docs say (M1, confirmed with a probe). One is a cheap fix for Q3 (M2). The rest are test and tripwire sharpness. Q4 is an owner question.

## What I checked, by the brief's hunt list

**1. Can keys or terms of a live trade be deleted?** No.
- **Forged or replayed order.** The order is only a code. `tradeShredTick` (main.ts:681) normalises it, then checks, in order: watch list unreadable (`unknown`, :708), listed, `watcher.active`, gate payout pending, then `tradeShredHold` (main.ts:935). `tradeShredHold` checks young, dispute, chat, `watching = true`, and finally `watching = false` without `watchShowsEmpty` (escrow). An escrow state with no watch row is also held as escrow.
  - A replayed order for a shredded trade finds nothing to delete and is reported again (tested).
  - A lying API that re-feeds the code as new work gets a fresh attestation and a new escrow, unrelated to the old one. The old ruling taps stay refused, because `usedNonces` is kept.
- **A lying API.** It can hide the trade from the watch list. Then the watcher treats a trade it saw close as cancelled (watcher.ts unlisted path), and a trade it never saw close is skipped.
  - A funded escrow that the API "closes" without a shown sweep never gets `channelsClosed` (watch.ts:357: `settledTx` or no incoming at all). So it is never empty, and it is held forever.
  - Late coins set `escalationPending`. Only a `disputed` from the API clears it, and `lateReported` must then be covered by a later shown sweep (watch.ts:219-222).
  - Both are pinned by tests that fail under mutation (table rows 8-16).
- **Clock skew.**
  - A moderation clock jumped forward defeats `young` and `dispute`, and drops closed watches early. That is also true on main.
  - It cannot make `watchShowsEmpty` true, so only escrows already shown empty lose their keys sooner.
  - `young` compares the DB clock (`created_at default now()`) with the app clock (main.ts:937, :950). The chat shred does the same (:909). See m3.
- **Restart mid-shred.** The ten table deletes are one transaction (main.ts:716). Then the gate forget runs (`store.exclusive`, with a retry flag for a failed save), then the report.
  - A crash after the commit: the next pass finds no rows (no `made`, no watch, no escrow), deletes nothing, forgets and reports.
  - A failed save: `trade-shred-failed`, no report, retried next pass (tested).
- **Partial transaction.** The transaction is real. The delete order (terms, party, wallet secrets, escrow, then watch) also means a partial delete could never leave an escrow that looks "shown empty". The transaction itself is not tested (row 22).
- **Ruling in flight.** `tradeRulingPending` holds a recorded, unsettled payout. A ruling recorded but not yet executed is covered by `dispute` (mod_dispute_seen, 90 days) and by `watching`: a disputed, funded escrow is still watched. Executions run only inside watcher passes, and the shred's check and delete run in `watcher.between`.

**2. Is the delete list complete?** Yes, for every moderation table with a `trade` column. The tripwire (tradeShred.test.ts:306) checks `information_schema.columns.column_name = 'trade'` against `TRADE_SHRED_TABLES` and `TRADE_SHRED_KEPT`.
- Per-trade stores outside Postgres: only gate.bin (`executions`, `rulingsSeen`), which is handled.
- The gate's checkpoints and `usedNonces` name no trade. Ruling ids are UUIDs (API 401), so they cannot be linked once the API has purged.
- Logs carry reason strings only.
- The chat-keyed rows (`mod_chat_identities`, `signed_chats`, `mod_chat_grants`, `mod_countersign_requests`) go with the chat shred (main.ts:631-638). `mod_chat_seq` is in neither list (see m5).
- Tripwire weakness: see m2.

**3. What the kept list leaks.**
- `used_log_entries.trade` (007) is written (internal/server.ts:256, :297) but never read. Replay protection reads only `id` (server.ts:191).
  - So the trade code adds no safety. It is a second copy, out of the API's reach, of "staff action X concerned trade T".
  - Keeping it until owner p12-7 decides is defensible, but it can be blanked on shred at no cost to safety. Owner question Q-B.
- Gate `usedNonces`: the values are `ruling:<uuid>:<step>`, `certify-device:<id>` and similar. No trade code and no time. Justified, as a replay guard.

**4. The builder's Q3 and Q4.**
- **Q3, an old sweep tx counted again once `mod_sweeps` is gone: real, but narrow. Minor M2, with a fix.**
  - After trade A's shred, A's sweep tx T_A is no longer refused as `sweep-counted-elsewhere` (watcher.ts:254 `claimSweep`).
  - Another trade B could then count T_A, but only on the import-only path (spendEvidence/proven). That path needs all of these:
    - B is settling with a `settleKind`;
    - B's buyer AND seller both name T_A in sealed spend.info (R3-I1);
    - T_A has an input whose ring holds one of B's outputs, with matching forged partials, which means A's builder chose B's output as a decoy when A was released;
    - a tx key proves T_A pays B's `sweepMinimums`.
  - So it takes colluding parties on both sides, planned at A's release, with B kept open for about 31 days or more.
  - The gain:
    - B is counted settled while its coins stay in the escrow. The colluders control those coins 2-of-3 anyway.
    - The platform fee is counted once for two trades, because T_A's fee output satisfies B's minimums.
    - B adds one completed trade, and later B's moderator keys are shredded.
  - No third party's coins are at risk.
  - Fix (engineering): do not delete the sweep's identity, tombstone it.
    - Replace B's `mod_sweeps` rows on shred with a keyed tag: a new `mod_sweeps_spent(tag bytea primary key check (length(tag) = 32))`, where tag = HMAC-SHA256(modSubkey(keystoreKey, 'sweeps'), tx_hash). This is the same pattern as the API's `chat_purged_marks` (123).
    - `claimSweep` refuses a tx whose tag exists.
    - That keeps the one-tx-one-trade rule for good, without keeping the trade code, and without a clear on-chain tx list in a DB dump.
    - Add the RED test: shred A, then present T_A for B, and expect `sweep-counted-elsewhere`.
- **Q4, coins sent after the drop: not an attack. A residual loss-of-recourse. OWNER QUESTION Q-A.**
  - Nobody profits except a counterparty who then holds the coins hostage.
  - On main, coins sent to an escrow after its watch dropped are already unseen (review-p7-retention R3-m4: a quiet 404).
  - The shred changes "staff could still recover them by hand with the moderator's key" into "only buyer and seller together can move them".
  - The same applies to the one way a lying API can get keys destroyed: it calls an unfunded trade cancelled, keeps it off the list for 30 days or more, and the buyer funds afterwards.
  - Options:
    - (a) Accept it, and document it on the Privacy page ("coins sent to an escrow after a trade has self-destructed can only be moved by both traders", COPY-UNSIGNED).
    - (b) Keep only `mod_escrow_state` and `mod_wallet_secrets`, sealed, for a longer key-only window (for example 1 year), and shred everything else (terms, addresses, watch) on schedule.
    - (c) Keep a view-only watch of dropped escrows longer, with a loud alert.
  - I recommend (b), with (a)'s line. It is cheap, the keys hold no personal data beyond the escrow itself, and it keeps staff recourse for mistakes.

**5. The internal route and the x2f_purge grants.**
- `GET /internal/v1/trade-shred` (routes.ts:555) and the report (routes.ts:721) sit behind the same `guard`/`verify` as every internal route. Unsigned requests get 401 (tested).
- The report takes exactly `{ kind, trade }` and normalises the code. It only deletes the order row, so a forged report could only lose an order (a retention gap, never deletion).
- The GET's `served_at` side effect is harmless.
- x2f_purge gets `insert` plus `select (trade)`, which the `on conflict (trade)` arbiter needs. No delete, no other select (tested both ways, rows 32-33). This is minimal, and it matches 123.

**6. The migration.**
- 761 sits after main's 760 and before wip/lead-sanctions 770 and wip/lead-bans-2 780. No number clash.
- It is a plain `create table` like 123. It is applied once by the runner, and the second `migrate()` returns [] (schema.test). The table is new and empty, and has no FK.
- Merge note: all three branches append to the same three lines of `apps/api/test/schema.test.ts` (:48, :197, :275). That is a mechanical conflict; keep 761, 770 and 780 in order.
- The order insert is in the same statement as the trade delete (tradePurge.ts:242), so 701's `before delete` triggers still guard it.

## Findings

### Minor

**M1. Every trade cancelled in setup, before an escrow address existed, keeps all its moderation records forever: signed terms with both payout addresses, the party identity, the wallet password and any escrow state. The docs understate this.**
- Where:
  - watcher.ts:581-583 (`plan.stop` sets `watching = false` without a watch step, so the state stays `newWatchState()`, with `closedAt` null);
  - main.ts:954-960 (`watching = false` and not empty, so `escrow`);
  - after a restart, `modPartyPlan` starts nothing and stops nothing for a closed trade with no address, so the row stays `watching = true` and the result is `watching` forever.
- Probe (scratch test, not committed): attest, set state `setup`, run a watch, set `cancelled`, run a watch, then wait 400 days with the trade off the list and an order present. The result was `party-stopped`, then `trade-shred-held-escrow`, with signed_terms still there.
- Coordination.md:907 residual (1) says "cancelled in setup after a restart". It happens without a restart too, and setup-cancelled trades are probably common (a counterparty who never shows).
- Fail closed: no coin risk. But it is a growing retention gap against the self-destruct promise.
- Suggested fix (lead or security call): treat as empty a row with `watching = false`, `escrow_address` null and `setup_done_at` null, where the sealed escrow state is absent or shows the multisig was never finalised.
  - The last condition matters, because the mod's party could have sent its final round and crashed before recording the address.
  - Add RED tests for the running case and the restart case. At minimum, correct the residual text.

**M2. Q3 above: tombstone the sweep instead of deleting it.** The fix and the test are described above.

### Minor (tests and tripwires)

- **m1. Three guards are not pinned by any test** (rows 12, 22 and 23 of the table).
  - The `closedAt` check in `watchShowsEmpty` is redundant today, because `channelsClosed` is only set after a close. It is still worth a one-line test: a state with `channelsClosed` true and `closedAt` null is not empty.
  - The shred's transaction: inject a failure in the 5th delete, and expect every row still there.
  - `watcher.between`: run a shred while a pass is in flight, and expect it to wait.
- **m2. The tripwire only knows `column_name = 'trade'`.** A future per-trade table keyed `trade_code`, `code`, `escrow_address` or `tx_hash`, or a sweep table keyed only by tx, would slip past it.
  - Widen it to columns matching `/^(trade|trade_code|code|escrow_address|tx_hash)$/`, with every hit classified.
  - Also add a check that gate.bin's `GateState` fields carrying a trade code are listed in `forgetTrade`.
- **m3. Mixed clocks in `young`.** `created_at` is the DB clock, and `at` is the service clock (main.ts:937/950). Use one clock: store the service's `now()` at attest, or compare with `now()` in SQL.
- **m4. No regtest of a released, swept escrow being shredded.** The regtest covers only a cancelled, unfunded escrow and an open, funded one. The swept path rests on the unit tests of `watchShowsEmpty`. One real release, then the watch drops it, then the shred, would cover the R2-I2 path end to end.
- **m5. `mod_chat_seq` (chat-keyed) is deleted by neither shred.** It existed before this branch and holds only a chat id and a counter. Note it, or delete it in the chat shred.
- **m6. "Destroyed" is logical.** Deleted rows stay in Postgres dead tuples, WAL and backups, and the old gate.bin blocks stay on disk, until vacuum, rotation and the D6 backup window. The coordination text should say so, next to the D6 item.

## Guard-revert table

Each mutation was applied alone, the named test file(s) were run, and the code was restored (`git status` clean afterwards). Harness: scratchpad `rmp-mutate.mjs`.

| # | Mutation | Result |
|---|---|---|
| 0 | hold `unknown` removed (unreadable list) | CAUGHT (1) |
| 1 | hold `listed` removed | CAUGHT (1) |
| 2 | hold `running` removed | CAUGHT (1) |
| 3 | hold `ruling` removed | CAUGHT (1) |
| 4 | hold `young` removed | CAUGHT (1) |
| 5 | hold `dispute` removed | CAUGHT (1) |
| 6 | hold `chat` removed | CAUGHT (1) |
| 7 | hold `watching` removed | CAUGHT (1) |
| 8 | hold `escrow` (watch dropped, not empty) removed | CAUGHT (2) |
| 9 | hold `escrow` (escrow state, no watch row) removed | CAUGHT (2) |
| 10 | unreadable watch state taken as empty | CAUGHT (1) |
| 11 | `watchShowsEmpty` always true | CAUGHT (5) |
| 12 | `watchShowsEmpty` without the `closedAt` check | SURVIVED (redundant today, m1) |
| 13 | without the `escalationPending` check | CAUGHT (1) |
| 14 | without the `reopened` check | CAUGHT (1) |
| 15 | without the `channelsClosed` check | CAUGHT (1) |
| 16 | without the late-coin check | CAUGHT (1) |
| 17 | delete list without `signed_terms` | CAUGHT (3) |
| 18 | without `mod_wallet_secrets` | CAUGHT (2) |
| 19 | without `mod_escrow_state` | CAUGHT (2) |
| 20 | without `mod_sweeps` | CAUGHT (2) |
| 21 | without `mod_chat_notices` | CAUGHT (1, tripwire) |
| 22 | no transaction around the deletes | SURVIVED (m1) |
| 23 | check and delete outside `watcher.between` | SURVIVED (m1) |
| 24 | gate forget skipped | CAUGHT (2) |
| 25 | `forgetTrade` without the pending refusal | CAUGHT (1) |
| 26 | `forgetTrade` keeps `rulingsSeen` | CAUGHT (1) |
| 27 | report sent although held | CAUGHT (10) |
| 28 | API purge writes no order | CAUGHT (3) |
| 29 | the report removes no order | CAUGHT (1) |
| 30 | list not least-recently-served first | CAUGHT (1) |
| 31 | the report accepts extra keys | CAUGHT (1) |
| 32 | x2f_purge also granted delete | CAUGHT (1) |
| 33 | x2f_purge granted full select | CAUGHT (1) |

31 of 34 mutations were caught. The 3 survivors are test gaps only, with no defect behind them.

## Tests run

- Targeted vitest at 9a24ac57, `nice -n 10`, outside the lock (per the 18 Nov lock rule):
  - `apps/moderation/test/tradeShred.test.ts`: 16/16
  - `apps/api/test/tradeShred.test.ts`: 6/6
  - `apps/api/test/tradePurge.test.ts`: 26/26
  - `apps/api/test/schema.test.ts`: 82/82
  - `packages/trade/test/watch.test.ts`: 69/69
  - 5 files, 199/199 passed.
- `tsc --noEmit` for apps/moderation, apps/api and packages/trade: clean.
- Under `~/x2f-comms/check.lock`: `vitest run --project @x2f/moderation-regtest apps/moderation/test/regtest/tradeShred.regtest.test.ts`: 1 file, 1/1 passed, in 87 s. It waited about 2 h for the lock (01:53 to 03:52 UTC).
- Probe for M1 (scratch, deleted): confirmed `trade-shred-held-escrow` for a setup-cancelled trade with no address, after 400 days.
- Not run: the full `npm run check` (lock queue; the reviewer rule asks for it before APPROVED). Nothing in this diff touches the web, staff-web or copy.

## Owner questions

- **Q-A (Q4).** Coins sent to an escrow after its trade self-destructed. Today they can be moved only by both traders together, and staff lose the moderator key that could help. Recommend: keep the moderator's sealed escrow keys (only those) for a longer key-only window, for example 1 year, and add a Privacy line (COPY-UNSIGNED).
- **Q-B.** `used_log_entries.trade`: blank it at shred? Only the id is needed for safety. Recommend blanking. Otherwise it follows p12-7.
