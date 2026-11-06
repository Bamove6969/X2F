# Review round 3: Plan 7 Tasks 1-4 (retention, whole-trade purge, self-destruct date, Settings → Privacy)

Branch `wip/lead-p7-retention` @ 24c7489 (new since c8fc2b3: c051182 = claude2's WIP, 24c7489 = the rest). Round 2: `~/x2f-comms/review-p7-retention-round2-2026-10-30.md`. Read-only. Tests ran in a detached worktree (`~/x2f-worktrees/rv-p7r3`), now removed. Task 9 is on OWNER HOLD and is not required here; I used the held branch `land/t9io-held` (36e728a) only for a trial merge.

## Verdict: APPROVED (with 4 Minor findings)

Every round-2 item is done, and the branch now lands green next to Task 9 I/O. The hard gate is now code, not only documentation: `TRADE_PURGE_READY = false` refuses `X2F_TRADE_PURGE=on` at start-up. With it, nothing can be deleted until the seams exist, whatever the early-warning tripwires catch.

The Minors are about how sharp those early warnings are, and about two side-effects of the R2-m2/R2-m3 fixes on the web. None can lose coins, and none deletes anything while the flag is off.

## Round-2 findings: status

- **R2-I1: fixed.**
  - `MOD_OWED` now lists `mod_escrow_state`, `mod_party_state`, `mod_sweeps`, `mod_wallet_secrets`, `mod_watch` and `signed_terms` (`apps/api/test/tradePurge-tripwires.test.ts:63`). The text matches in SEAMS, coordination.md and dev-setup.md, including the ordering rules: key material only once the escrow is shown empty, and `mod_sweeps` only after the watch drop.
  - Late funds moved into the unconditional gate (`expectSeamsLanded`, `:166`). That gate requires `WATCH_CLOSED_DAYS|watchDropped|watch_dropped` in the comment-stripped purge.
  - NEEDS_I4_WATCH_DROP (`:108`) now fires on a future drop report.
  - **Verified on a trial merge** with `land/t9io-held`. I resolved the `schema.test.ts` conflict by hand: the migration lists need both `113_release_claim.sql` and `701_trade_purge.sql`, in 3 places. tsc api and trade are clean. `tradePurge-tripwires`, `schema` and `tradePurge`: 3 files, 101/101 passed. The merge was aborted afterwards.
- **R2-I2: fixed (recorded and gated).**
  - The rule is recorded in all three places: "never purge unless the escrow is shown empty; unknown = may hold coins, so the trade is kept". The moderation purge deletes key material only after the same fact and the watch drop. COPY-UNSIGNED Privacy line once the surplus rule ships.
  - NEEDS_ESCROW_EMPTY_GATE (`:143`) is in place, and `ESCROW_EMPTY` is in the unconditional gate.
  - The moderation-purge half (a `delete from mod_wallet_secrets|mod_escrow_state|mod_party_state` requires the escrow-empty fact and a watch-drop reference) is a good structural check.
  - How sharp the trigger is: see R3-m1.
- **R2-m1: fixed.**
  - `tradePurgeFlag` (`apps/api/src/config.ts:80`) refuses `on` unless `TRADE_PURGE_READY` (`:74`, false) or `process.env.VITEST === 'true'` (`:243`).
  - Tests: `schema.test.ts:539`. `schema.test.ts:540` also asserts the **imported value** is false. That check is value-based, so `= !false`, `= Boolean(1)` and similar spellings cannot get past it, even though the regex tripwire at `tradePurge-tripwires.test.ts:77` would miss them.
  - Bypass analysis:
    - (a) Env: `X2F_TRADE_PURGE=on` alone is refused.
    - (b) `NODE_ENV` is not read, so it cannot open the gate.
    - (c) `VITEST=true` in the production environment would open it. That needs an operator to set a test-runner variable on the API service by hand, so it is not a realistic accident. Optional hardening: also require `process.env.NODE_ENV !== 'production'`. `loadConfig` reads `process.env.VITEST` instead of its `env` argument, which is harmless but inconsistent.
    - (d) No other path turns the flag on. `setTradePurge` is called only in `main.ts:82`, `tradePurge: true` appears only in `test/helpers/app.ts:46`, and nothing outside tests calls `purgeTrades` directly.
  - The guard holds.
- **R2-m2: fixed on the server** (`apps/api/src/retention/tradePurge.ts:147`), and tested at `tradePurge.test.ts:291`. It has a side-effect on the web: see R3-m2.
- **R2-m3: fixed as asked.**
  - `accountId` is added to `/v1/account/me` (`apps/api/src/routes/account.ts:146`).
  - Each `x2f.deleteAt` entry records its account, and the start-up purge trusts a 404 only for the same account (`apps/web/src/chat/localPurge.ts:242`). Tested.
  - Does exposing `accountId` leak anything new?
    - Logs: no. The pino `res` serializer logs only `statusCode` (`app.ts:164`).
    - Other accounts: no. The route returns only the caller's own id. No service worker or CacheStorage keeps API responses.
    - The id is a random `gen_random_uuid()`, not a serial, so it reveals no account count or sign-up order.
    - Two new things, though:
      - Until now the internal account UUID never reached a trader's browser. WebAuthn deliberately uses a separate random `webauthn_user_id`.
      - The UUID is now **stored persistently in localStorage**, next to trade codes, and survives logout. See R3-m3.

## Minor

**R3-m1. Two early-warning tripwires match one spelling, and the realistic ways Task 9's drop report and the surplus rule will be written slip past them.**
- Where: `apps/api/test/tradePurge-tripwires.test.ts:108-119` (NEEDS_I4_WATCH_DROP) and `:143-157` (NEEDS_ESCROW_EMPTY_GATE, with `TODAY_SURPLUS` at `:75`).
- Probe: on the trial-merged tree, I made two plausible edits. Both tripwires stayed green: 9/9 passed.
  - **Drop report:** I added `{ kind: 'watch-ended', trade }` to `reportBody` in `apps/moderation/src/watcher.ts` (next to `late-funds`), plus a migration adding `trades.watch_ended_at`. NEEDS_I4_WATCH_DROP looks only for `'watch-dropped'`, `report({ … watching:` or a `'watching'` literal in API src. Real reports go through `reportBody(...)`, not `report({`, and the name can be anything (`watch-ended`, `unwatched`, `watch-done`, `escrow-closed`).
  - **Surplus rule:** the most likely change is in `packages/trade/src/payouts.ts:58,63`: stop paying the surplus at release by deleting `const surplus = …` and the `{ address: f.sellerRefund, amountAtomic: surplus }` output. That is a deletion, so no `surplus` word is added. `TODAY_SURPLUS` only excludes those lines, so their removal fires nothing. Names like `excess`, `overpaid` or `leftover` also miss.
- Impact: low. The hard gate (`TRADE_PURGE_READY` and `expectSeamsLanded`) still requires the escrow-empty fact and the watch reference before `on`. What is lost is the early warning the lead asked for, at the moment the feature lands.
- Fix:
  - (a) Make the surplus tripwire structural. Require that the release case of `payouts.ts` still contains both `TODAY_SURPLUS` lines; if either line is gone or changed, fire, and expect `ESCROW_EMPTY` in the purge.
  - (b) For the drop report, keep an allowlist of the watcher's report kinds as the API accepts them. On the held branch these are `setup-done`, `chain`, `settled`, `spend-unshown`, `release-claimed` and `late-funds`, read from the internal route's kind switch. Fail on any new kind until it is classified as purge-relevant or not. Do the same for new `mod_watch` or `trades` columns matching `/watch|drop|unwatch/`.
  - Both checks read the local tree only.

**R3-m2. R2-m2 side-effect: a trade view read during maintenance makes the device forget the trade's self-destruct entry, so its local copies can outlive the trade.**
- Where:
  - `apps/web/src/screens/trade/SelfDestruct.tsx:45` (`rememberDeleteAt(code, at)` with `at === null` deletes the entry);
  - `apps/web/src/chat/localPurge.ts:252` (the start-up "view" branch does the same);
  - with `tradePurge.ts:147` now returning null during maintenance.
- The API serves trade views during maintenance; there is no global block.
- Failure scenario (flag on):
  1. During a maintenance window, trader A opens trade T's room, or starts the app while T's stored date has passed.
  2. The view has `deleteAt: null`, which the client reads as "kept, no date" (the I1 rule, test `localPurge.test.tsx:122`), so it removes T from `x2f.deleteAt`.
  3. Maintenance ends, and the next pass deletes T on the server.
  4. A never reopens T's room, because the trade is over. T's funding marks, release marker and chat copy (once Task 20's deleter is registered) stay on A's device for good: nothing lists T any more.
- I suggested the null in round 2 without seeing this; the fix is small. Either:
  - the view says why there is no date (for example `selfDestructPaused: true`, or the client reads maintenance from `/v1/news`), and the client keeps the stored entry; or
  - the server keeps sending the date during maintenance, and the room does not purge while maintenance is on.
- Add a test: a maintenance view does not drop the entry.

**R3-m3. R2-m3 trades one leftover for another on shared devices, and stores the raw account UUID locally. OWNER CHOICE.**
- Where: `apps/web/src/chat/localPurge.ts:240-243` and the `Entry.account` field in `x2f.deleteAt`.
- Failure scenario:
  - A trades on a family laptop, signs out (logout does not clear `x2f.*`), and never signs in there again. B uses the laptop daily.
  - Before R2-m3, B's start-up got 404 for A's purged trade and cleaned A's local copies.
  - Now they stay until A signs in on that device again, which may be never: A's chat copy, funding marks and release marker, plus A's account UUID linking all of A's trade codes.
  - The same applies to any entry stored while `/v1/account/me` could not be read (the room's `accountId()` failed).
- What R2-m3 protected: A's funding marks and release marker going early in a maintenance or late-funds gap, with no escrow keys involved.
- Options:
  - Keep the current rule: no early loss of markers, but leftovers on shared devices.
  - Or, on a 404 for another or unknown account, purge once the stored date is more than N days past (for example 7, by which time maintenance has ended). A late-funds-escalated trade would then lose only markers, never escrow keys.
- Either way, store a one-way tag rather than the raw id, for example SHA-256 of `accountId + ':' + code`, compared at start-up. The stable account id then stops being a cross-trade link sitting in localStorage. This needs no API change beyond today's.

**R3-m4. A must-land item is in the docs but in no gate: "a `late-funds` report for an unknown trade code fails LOUDLY to staff".**
- Where: `expectSeamsLanded`, `tradePurge-tripwires.test.ts:166`. On the held Task 9 branch, `apps/api/src/internal/routes.ts:261` answers an unknown trade with `Refused(404, 'not-found')`, and the watcher only logs `watch-report-refused-404`.
- Failure scenario:
  1. All the gated seams land, and `TRADE_PURGE_READY` is set true.
  2. A buyer sends coins to a purged trade's escrow. Nothing in the gate required the loud path, so it is still a quiet 404 in a log line.
  3. The coins sit unseen.
- Fix: add it to `expectSeamsLanded`. For example, require that the internal route's unknown-trade path for `late-funds` raises an owner or staff alert (`ownerAlert`/`alerts` reference), or a `NEEDS_LATE_FUNDS_UNKNOWN_LOUD` check once `'late-funds'` is wired.

## Notes (no action needed)

- The regex `ready` tripwire (`:77`) is weaker than the value assertion at `schema.test.ts:540`, but the value assertion covers it. When the seams land, both `schema.test.ts:540` and the constant must change together. That is a deliberate second hand, which is fine.
- NEEDS_I5_MOD_ROWS still recognises only `trade|trade_code|code` key columns. This is unchanged from round 2 and fine for every moderation table today.

## Commands run (worktree at 24c7489, `npm ci` with npm 11.21.0, all under flock)

- `tsc --noEmit` for `apps/api`, `apps/web` and `packages/trade`: no errors.
- `vitest run --project @x2f/api` on `tradePurge`, `tradePurge-tripwires`, `schema`, `account` and `retention`: 5 files, 149/149 passed.
- `vitest run` on `apps/api/test/purge.test.ts`, `packages/trade/test/retention.test.ts`, `apps/web/test/localPurge.test.tsx`, `privacy.test.tsx` and `privacy-tripwire.test.ts`: 5 files, 38/38 passed.
- Trial merge of `land/t9io-held` (36e728a, not committed, then reset), with `schema.test.ts` resolved by hand:
  - tsc api and trade: clean.
  - `tradePurge-tripwires`, `schema` and `tradePurge`: 3 files, 101/101 passed.
- Probe edits on the trial merge (a `watch-ended` report kind with a `watch_ended_at` column; the surplus lines deleted from `payouts.ts`), then the tripwires again: 9/9 passed, so neither probe was caught (R3-m1). Reverted afterwards.
- Not run: full suites and Playwright.
