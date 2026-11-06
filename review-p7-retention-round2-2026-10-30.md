# Review round 2: Plan 7 Tasks 1-4 (retention, whole-trade purge, self-destruct date, Settings → Privacy)

Branch `wip/lead-p7-retention` @ c8fc2b3 (fix round 262aa5f, 4ddfc20, c8fc2b3 on top of 83fd652). Round 1: `~/x2f-comms/review-p7-retention-2026-10-30.md`. Read-only. Tests ran in a detached worktree (`~/x2f-worktrees/rv-p7r2`), now removed.

## Verdict: CHANGES REQUIRED (small: tripwires and docs, no purge-code change)

The code fixes for I1, I2 and I3 are correct and tested, and they follow the lead's decisions. I4 and I5 are recorded as must-land-before items, with local-tree tripwires. Two problems remain:

- The branch cannot land green on the current main line. Two of its new tripwires go red at the merge (R2-I1).
- The owner's new surplus rule is not covered by any gate (R2-I2).

Neither can delete anything today, because `X2F_TRADE_PURGE` is off. Both need small changes before the merge: tripwire, docs and SEAMS text only.

## Round-1 findings: status

- **I1: fixed.** `apps/api/src/trades/routes.ts:96` returns `deleteAt` only when `deps.config.tradePurge` is on. `tradeDeleteDate` is used nowhere else. With a null view, the web shows no line, no "has self-destructed" swap, and keeps the keys, even when a past date is stored (`localPurge.test.tsx`, "purge off" case). The API test covers both flags and both traders (`tradePurge.test.ts`).
- **I2: fixed.** The page reads `GET /v1/privacy` (`apps/api/src/retention/privacyRoute.ts`). Public, no session, and it returns a single boolean.
  - Off: "Trades do not self-destruct yet. Until self-destruct is switched on, X2F keeps your trades." This is true.
  - On: the 30/90 rule.
  - Unreadable: "could not load", with no claims.
  - No backup, blurring, reviews or proofs, and `BACKUP_KEEP_DAYS` is not read. All copy is marked COPY-UNSIGNED (5 or more markers, tested).
- **I3: fixed.** `packages/trade/src/retention.ts:89` gives the 48 h window to every refunded trade with a valid `closedAt`, and `tradePurge.ts` (toFacts, line 100 onward) calls it without `disputed`. The pure test and the DB test (dispute on day 0, refund on day 95: kept at the window end, deleted 1 ms after) are correct.
  - **Red at 262aa5f verified:** both new tests fail there on the I3 assertions. The pure test gets `expected null to deeply equal 2027-01-06…`. The DB test gets the old date (day 90 + …), not window + 1 ms. The other 23 tests passed.
- **I4 and I5: recorded as must-land-before.** They are in `docs/coordination.md` (Plan 7 section), `docs/dev-setup.md:18` and the `tradePurge.ts` SEAMS comment. The tripwires NEEDS_I4_WATCH_DROP, NEEDS_I4_LIENS and NEEDS_I5_MOD_ROWS read the local tree only. A last gate refuses a default of `on` until the seams exist. See R2-I1 for how the tripwires behave on the main line.
- **M1 (start-up purge): fixed.** `runConfirmedLocalPurge` reads the server time from `/v1/news` and deletes only on a 404, or on a date that is still set and has passed. Offline or any other error deletes nothing. A residual edge remains (R2-m3).
- **M2, M4, M5, M6: done.** The M5 ledger tripwire now strips comments and requires `from|join|into|update revenue_ledger`. NEEDS_PLAN_5_RUNNING_TOTALS was added.
- **M3: done.** Passes are skipped during maintenance, also re-checked under the trade lock. A missing `site_flags` row counts as maintenance (fails closed). Tested.

## Important

**R2-I1. Merging with the main line turns two of the branch's own tripwires red, and shows three more x2f_moderation tables that key a trade.**
- Where:
  - `apps/api/test/tradePurge-tripwires.test.ts:82` (NEEDS_I4_WATCH_DROP)
  - `:52` (`MOD_OWED`) and `:100` (NEEDS_I5_MOD_ROWS)
- The branch's base is 5c4d35b. The local main line (36e728a, Plan 3 Task 9 I/O merged) already contains:
  - `'late-funds'` handling in `apps/api/src/internal/routes.ts:247` and `apps/moderation/src/watcher.ts:261`;
  - `apps/moderation/migrations/003_watch.sql`: `mod_escrow_state` (the moderator's sealed escrow wallet) and `mod_watch` (escrow address, watch state);
  - `005_sweeps.sql`: `mod_sweeps` (sweep tx hashes per trade).
- Reproduced with a trial merge in my worktree (`git merge --no-commit c8fc2b3` onto 36e728a, then aborted). `vitest run apps/api/test/tradePurge-tripwires.test.ts` gives 2 failed / 5 passed:
  - `late-funds is wired in apps/api/src/internal/routes.ts, apps/moderation/src/watcher.ts … expected … to match /WATCH_CLOSED_DAYS|watchDropped|watch_dropped/`
  - `mod_escrow_state keys a trade in x2f_moderation: add it to the Owed item`
- The merge also has a textual conflict in `apps/api/test/schema.test.ts`, to be resolved by hand.
- Failure scenario: the lead merges and gets red tests. The rules forbid deliberately red tests. The quick fix would be to delete or weaken the tripwire, and then I4a would no longer be guarded.
- Fix at the merge:
  - (a) Add `mod_escrow_state`, `mod_watch` and `mod_sweeps` to `MOD_OWED` and to the Owed text in all three places.
    - `mod_escrow_state` together with `mod_wallet_secrets` is the moderator's escrow key material. Deleting it is final: see R2-I2 for why it must wait until the escrow is shown empty.
    - `mod_sweeps` should go only after the watch has dropped the trade, because it prevents a sweep from being counted for two trades.
  - (b) I4a is no longer "future": late funds are wired today. Keep the lead's decision (recorded, not built, while the flag is off), but stop the tripwire from going red at the merge.
    - Move the `late-funds` condition into the "stays off by default" gate, which already requires `WATCH_CLOSED_DAYS|watchDropped`.
    - Replace NEEDS_I4_WATCH_DROP with a check that fires when the moderation service gains a drop report (for example a `'watch-dropped'` kind, or `watching = false` being reported to the API) and the purge does not read it.
  - Then run the tripwires and `schema.test.ts` on the merged tree.

**R2-I2. The new owner rule (surplus stays in the escrow until the seller disputes) is not covered by any gate. With the flag on, the purge would delete a trade whose escrow still holds coins, and the I5 moderation purge would destroy the key the moderator needs to send them.**
- Where:
  - `apps/api/src/retention/tradePurge.ts:85` (`factsSql`): facts come only from `trades` and `disputes`, with no escrow-balance fact.
  - `packages/trade/src/retention.ts:57/75` (`tradeDeleteAt`/`tradeDeleteDue`): no "escrow may hold coins" exception.
  - The must-land-before lists in coordination.md, dev-setup.md and SEAMS.
- Do today's gates cover it? No.
  - `closed_at` is set when a trade is released or refunded. The automatic payout will pay only the expected amount, so the trade is `released` with a surplus still in the escrow, and it is due at closed_at + 30 d.
  - I4a's alternative "keep `WATCH_CLOSED_DAYS` plus a margin" ignores the balance completely.
  - "Purge after the watch drops the escrow" only helps while the watch refuses to drop an escrow with unswept coins. Today it would instead report the surplus as late funds and escalate (the watch.ts exact-prefix rule). The surplus feature must change that, since the coins wait for the seller's dispute rather than an automatic escalation, so nothing guarantees the drop waits.
  - No tripwire watches for the feature.
- Failure scenario (flag on, surplus feature built):
  1. A buyer overpays by 0.2 XMR. The automatic payout releases the expected amount, and the trade is `released` on day 0.
  2. The seller has not disputed by day 30. The purge deletes the trade and its disputes, so the seller can no longer open the dispute the rule depends on.
  3. Under I5 (Owed), the moderation purge deletes `mod_wallet_secrets`, `mod_escrow_state` and `mod_party_state` for the trade.
  4. The moderator can no longer sign: the 0.2 XMR can only move if buyer and seller both cooperate, which is the outcome the rule exists to avoid.
- Without the surplus feature, the same gap already exists for any coin left unswept that the watch does not escalate.
- Must add, as a MUST-LAND-BEFORE `X2F_TRADE_PURGE=on` item, without building the surplus feature:
  - (1) The purge keeps a trade unless the escrow is **shown empty**: the watcher's last facts show every incoming tx swept, and nothing in the pool or newer, recorded on the API. Example: a per-trade `escrow_empty_at` set by a new watcher report, or the `chain` facts showing `receivedAtomic` fully covered by the counted sweeps.
    - Unknown counts as "may hold coins", so the trade is kept (fail closed).
    - Add `escrowEmpty`/`mayHoldCoins` to `RetentionFacts`, with `tradeDeleteAt` returning null while coins may remain.
  - (2) The moderation purge (I5) deletes `mod_wallet_secrets`, `mod_escrow_state` and `mod_party_state` only after the same "shown empty" fact and the watch drop. It must never key off the API's deletion alone.
  - (3) Once the surplus rule ships, the Privacy "on" copy needs a line saying a trade whose escrow still holds coins is kept until they are sent (COPY-UNSIGNED).
- Tripwires (local tree only):
  - `NEEDS_ESCROW_EMPTY_GATE`: fires when `/surplus/i` appears in `packages/trade/src`, `apps/*/src` or any migration (the surplus feature landing), or when a watcher report kind such as `'escrow-empty'` appears. When it fires, it requires the purge (`tradePurge.ts`, comments stripped) to reference the fact (`escrow_empty|escrowEmpty|mayHoldCoins`).
  - Also add that regex to the "stays off by default" gate, so a default of `on` is refused until the gate exists.
  - Record the item in all three places (coordination.md, dev-setup.md, SEAMS).

## Minor

- **R2-m1. `on` is only a documented gate.** `apps/api/src/config.ts:221` accepts `X2F_TRADE_PURGE=on` from the environment whatever seams exist. The tripwires guard only the *default*.
  - Scenario: an operator sets `on` in production, for example to "test self-destruct". The purge then runs without the watch-drop gate, the escrow-empty gate or the moderation-row purge.
  - With R2-I2 that risks lost coins, which cannot be undone. Consider a code constant (`TRADE_PURGE_READY = false`) that makes config refuse `on` outside tests until the seams land, and a tripwire that ties the constant to the seams.
- **R2-m2. Maintenance and the room.** `routes.ts:96` still returns `deleteAt` during maintenance, while the purge skips (M3).
  - Scenario: with the flag on, the date passes during a maintenance that lasts a day. The room (`SelfDestruct.tsx` `useSelfDestruct`) shows "This trade has self-destructed" and drops the local keys, while the server still holds the trade until the first pass after maintenance.
  - Only display and local `x2f.*` keys are affected (escrow keys are kept), and the gap is temporary. Return null during maintenance, or accept this and note it.
- **R2-m3. A 404 from another account.** `apps/web/src/chat/localPurge.ts:169/194` treats any 404 as "gone". On a shared device, account B's session gets 404 for A's trade, because non-parties see the same 404 as for an unknown code.
  - A's stored date must already have passed by the server clock, so the trade is normally deleted within one pass anyway.
  - The gap is maintenance (R2-m2), or a late-funds escalation after A last opened the room. In those cases A's funding marks and release marker go early. No escrow keys are lost.
  - Store the account id with each entry and confirm it against `/v1/account/me` before trusting a 404. Claude2 already flagged this edge.

## Commands run (worktree at c8fc2b3, `npm ci` with npm 11.21.0, all under flock)

- `tsc -p apps/api`, `-p apps/web` and `-p packages/trade` with `--noEmit`: no errors.
- `vitest run --project @x2f/api` on tradePurge, tradePurge-tripwires, retention, schema and purge tests: 5 files, 108/108 passed.
- `vitest run` on `packages/trade/test/retention.test.ts`, `apps/web/test/privacy.test.tsx`, `privacy-tripwire.test.ts` and `localPurge.test.tsx`: 4 files, 28/28 passed.
- At 262aa5f, `vitest run` on `packages/trade/test/retention.test.ts` and `apps/api/test/tradePurge.test.ts`: 2 failed (both the I3 tests, on the I3 assertions), 23 passed.
- Trial merge onto 36e728a (not committed, aborted), then `vitest run apps/api/test/tradePurge-tripwires.test.ts`: 2 failed (NEEDS_I4_WATCH_DROP and NEEDS_I5_MOD_ROWS), 5 passed. Conflict in `apps/api/test/schema.test.ts`.
- Not run: full suites and Playwright.
