# Review: wip/third-trade-wallet, the delta d3dc3c4f..d5651819 (claude3, 17 Nov 2026, second pass)

Branch head reviewed: `d5651819` (origin/wip/third-trade-wallet). Base `d3dc3c4f` was reviewed earlier in
`review-third-trade-wallet-2026-11-17.md` (APPROVE WITH MINORS). This pass covers only the 10 commits
after it: the default wallet (migration 630, `PUT /v1/wallets/:id/default`), the three-level rating with
the "?" tip, one-time wallets given back when their trade ends in setup (migration 640,
`restoreOneTimeWallets`), and the race and rollback tests. I checked `docs/trade-wallet-note6.md` against
the code and did not rely on it.

## VERDICT: CHANGES NEEDED

There are no S findings. No path lets an address pay out before main's confirm-wait or hold rules
allow, and escrow, payouts and attestation are untouched. Two B items are small, and each has a tested
fix below:

- **B1:** setting the default steers payouts without the hold model. A weak session can do it without
  staging, it can name a wallet that is still waiting, and it raises no in-app alert.
- **B2:** the deadlock the builder admits is real. I reproduced it on every run, and a 4-line lock-order
  change removes it.

## Findings

### B1. The default can be pointed at a waiting wallet, from a weak session, unstaged and with no alert
`apps/api/src/wallets/routes.ts:72-73` (`effectiveDefault`: `chosen` ignores `usable_from`),
`:506-521` (`defaultHandler`: checks only `removed_at is null` and `one_time`), `:511` (raw account lock,
with no `requireLiveSessionInTx` and no `gateChange`), and `apps/api/src/auth/hold.ts:663` (listed
`LIVE_SESSION_EXEMPT`, "changes no ... security state").

Probe (local, not committed):

- A session with `strength = 'weak-single'` sends PUT default on a wallet whose `usable_from` is
  now + 24 h.
- The answer is 204, with 0 `hold_changes` rows staged and no alert row (only `new-login`).
- `GET /v1/wallets` then marks the waiting wallet `isDefault: true` and the usable one `false`.

Attack, by an attacker with a stolen weak or medium session:

1. They add their address (staged 24 h from a weak login, or waiting 24 h if confirmed with a
   password).
2. They make it the default now.
3. The Quote (`Quote.tsx:204`) and the AcceptedSheet (`AcceptedSheet.tsx:130`) skip it while it waits,
   then preselect it the moment the wait ends.

The wait is kept, so nothing pays early. But the one step that turns a parked address into the payout
the victim confirms without looking is exempt from the staging, the alert and the live-session
re-check that every other wallet write has. `DELETE /v1/wallets/:id` (`:480-491`) does all three. A
removal "cannot redirect money" and still gets staged; choosing the default can redirect money.

**Fix (all four):**

1. `defaultHandler`: replace the raw lock with `await requireLiveSessionInTx(client, req.auth, now)`.
   Select `usable_from` too, and answer 409 `wallet-not-ready` when `usable_from > now`.
2. `effectiveDefault`: `chosen` also requires `r.usable_from.getTime() <= now.getTime()`, otherwise
   fall through to the sole-usable rule. A wallet chosen before this fix then never outranks.
3. Route it through `gateChange(client, req, { kind: 'default-wallet', walletId, label, addressEnd })`,
   so a waiting login stages it, the same as a removal. Then move the route from `LIVE_SESSION_EXEMPT`
   to `SECURITY_CHANGE_ROUTES`, which updates the `coolingOff.test.ts` gate count.
   - If the owner wants it never staged, at least refuse it from a waiting login with 403
     `weak-session` (`weakOf`).
4. `addAlert(client, accountId, 'wallet-default', { app, label, addressEnd }, now)`, so the in-app list
   shows it next to `wallet-added`. The Jabber notice already goes out via the `wallets` trigger.

Add tests for: default on a waiting wallet refused; weak login staged or refused; alert written;
recovery hold answers 403 (no behavioural test covers the hold today; I probed it: 403
`recovery-hold`).

### B2. Lock-order deadlock between a cancel that restores the other side's wallet and a take by that side
`apps/api/src/trades/store.ts:376` (`before` runs `requireLiveSessionInTx`, which locks the canceller's
account, `trades/routes.ts:180`), then `:410` (`restoreOneTimeWallets` locks the wallet owner's account,
`wallets/routes.ts:430`). Against that, `apps/api/src/trades/take.ts:306` locks `[taker, poster]` in id
order and holds no trade row.

The cycle:

- The cancel holds trade row T, then poster S, and waits for taker B.
- A take by B of any offer of S (with `B.id < S.id`) holds B and waits for S.

Reproduced on every run:

- Setup: buyer B takes S's sell ad with a one-time wallet. A holder tx takes
  `lock table trade_events in share mode` to line the two up. S sends `walk-away`, and B takes a second
  offer of S's at the same time.
- Result: the cancel answered 200, the take 500 `internal`, and `pg_stat_database.deadlocks` went 0 → 1.
- State is consistent: T1 is `cancelled`, and the wallet is open with `used_by_trade` null. The aborted
  take wrote nothing.

So it does not corrupt state. Both sides are single transactions, and `applyEvent` publishes only
after commit. The victim may be either side: a user's cancel or take gets a 500 and works on retry. The
timer path (`tick`) and the hold path (`system-cancel`) lock no account before the restore and lock the
owners in id order, so they cannot form this cycle.

The builder's race test (`take.test.ts:1379`) misses it because the canceller and the wallet owner are
the same account there.

**Fix (verified locally; reverted):** in `applyEvent`, right after `loadTradeRow(client, code, true)` and
before `before`, lock both parties in id order when there may be something to give back:

```ts
if (prev.state === 'setup') {
  const used = await client.query('select 1 from wallets where used_by_trade = $1 limit 1', [code]);
  if (used.rows.length > 0) await client.query('select id from accounts where id = any($1) order by id for update', [[prev.sellerId, prev.buyerId]]);
}
```

The lock order becomes "trade row, then both accounts in id order", the order of migration 016. The
later locks in `before`, `restoreOneTimeWallets` and `countCancel` are then re-entrant, and the take,
which holds no trade row, cannot close a cycle. Results with the patch:

- the probe gives cancel 200, take 200, 0 deadlocks;
- take, store, events-route, cancel-rules, holdV3 and timers give 6 files / 158 passed.

A bounded retry on SQLSTATE 40P01 in `applyEvent` and the take is optional on top. It is not a
substitute.

Add the probe as a regression test in `take.test.ts`: poster cancels, taker's one-time wallet, with
`taker.id < poster.id`.

### M1. A used-up one-time wallet is invisible and cannot be removed while its trade is in setup; the restore is silent
`apps/api/src/wallets/routes.ts:421-438` (no `addAlert`), and the `removeHandler` select at `:484`
(`removed_at is null`, so it answers 404).

Probe:

- While T is in setup, the wallet is not listed and `DELETE` answers 404.
- After a walk-away it is back, `usable: true`, and there is no in-app alert (the Jabber notice still
  fires).

The "removal applied meanwhile wins" rule (`:448`) therefore only covers a removal that was staged
before the use-up. An owner cleaning up after a compromise cannot remove a wallet an attacker parked in
a setup trade. It comes back (up to 60 min later, `setupMin`) usable at once, with no new wait.

The attacker must already have had a usable address on the account, so this is defence in depth.

**Fix:**

- List used-up wallets whose `used_by_trade` trade is still in `setup` as "in use by trade X".
- Let `DELETE` reach them: select `removed_at is null or used_by_trade is not null`;
  `applyWalletRemoval` already clears `used_by_trade` and alerts.
- Write a `wallet-restored` alert in `restoreOneTimeWallets`.

### M2. Missing tests for the new route's security rules
There is no behavioural test that the hold blocks `PUT /v1/wallets/:id/default`.

The `coolingOff.test.ts:1695` tripwire string-matches only the DELETE route. It does not test default
on a waiting wallet or from a weak login (B1), or the cross-account deadlock (B2).

Add them with the B1 and B2 fixes.

### M3. Doc nits in `docs/trade-wallet-note6.md`
- Item 8 says the route "changes no address and no wait". True, but it does change which address is
  preselected. Reword once B1 lands.
- The residual-risk paragraph of item 15 is accurate: full rollback, nothing lost. Replace it with the
  B2 fix.

## Checks against the brief

1. **Default and restore vs hold and confirm-wait:** neither creates an address or moves `usable_from`.
   - The take still refuses a waiting wallet (`pickWallet`; `take.ts` delta is only the extra
     `t.code` argument, 2 lines).
   - Hold: `requireNotHeld` blocks the default route (probe: 403 `recovery-hold`); it is in
     `HOLD_BLOCKED_ROUTES` (`hold.ts:709`).
   - Not routed through `gateChange`: B1.
   - The restore brings back a wallet that was already usable, with its old `usable_from`.
2. **Restore conditions:**
   - Only `prev.state === 'setup' && next.state === 'cancelled' && receivedAtomic === 0n &&
     fundingSeenAt === null` (`store.ts:409`).
   - In `setup` no escrow address exists yet (`machine.ts:523-526`: `setup-done` sets it and moves to
     `funding`), so no XMR can have been sent. Tests cover a funding → cancel and a funded trade.
   - It never resurrects:
     - a removed wallet whose removal applied (`used_by_trade` cleared);
     - a purged address (`address is not null`);
     - a duplicate open address (`not exists`).
   - Deadlock: B2. It does not corrupt state; the fix is a consistent lock order, verified.
3. **Take, payout attestation and escrow:** take still accepts only `walletId` of the taker's own usable
   wallet. The delta touches none of `internal/`, escrow, payouts, `packages/trade` or attestation
   files (`git diff --name-only` filtered: none).
4. **Rating:**
   - `accountRating` (`auth/rating.ts`) is used only by `routes/account.ts:318` for display. It
     authorises nothing.
   - The inline add is gated in the UI only (`Quote.tsx:419,422`, `rating === 'high'`).
   - The server rule is unchanged from main: `addHandler` and `STRONG_CONFIRM_METHODS` are untouched.
     A medium or weak account's add either waits 24 h (password confirm) or is staged (waiting login),
     and the take answers 409 `wallet-not-ready` (`take.test.ts` "a weak account's new address cannot
     reach a trade").
5. **Migrations and tests:**
   - Migrations 630 and 640 are unique across all remote branches. They appear only on
     wip/third-trade-wallet and its descendant wip/lead-trade-wallet, where the files are identical.
     Main ends at 540.
   - Safe defaults: `is_default boolean not null default false`, `used_by_trade text` null, plus check
     constraints and a partial unique index.
   - Jabber: `changePaths.ts` lists `is_default` and `used_by_trade` as changes. The wallets trigger
     (331) treats only `address` as bookkeeping, so both notify. jabber-paths passes.
   - Tests were not loosened:
     - The rating expectations moved to the owner's three levels.
     - The weak-account take test was strengthened: it now really posts a staged add.
     - schema.test only gained 630 and 640.
     - take.test's app gained an address-validator stub, needed for the real `POST /v1/wallets`. The
       take never calls it.

## Counts

- Typecheck: 19 workspaces, 0 errors.
- API vitest, as asked: wallets, take, account, rating, holdV3, jabber-paths, schema, store and
  coolingOff gave 9 files / 453 passed, 0 failed.
- API vitest, trade-store users: cancel-rules, cancelReversal, events-route, timers, tradePublish,
  tradedTotal, traderTrust, confirmations, purge, reputationLocks, dispute-count, disputes, team and
  blocks gave 14 files / 221 passed, 0 failed.
- Web vitest: AcceptedSheet, quoteAddress, wallets and holdChanges gave 4 files / 72 passed.
- Probes: 5 local, not committed.
  - P1 deadlock: reproduced; with the fix, 0 deadlocks.
  - P2/P3: default on a waiting wallet from a weak login gives 204, unstaged, no alert.
  - P4: hold gives 403.
  - P5: a used-up wallet is hidden, DELETE gives 404, and the restore is silent.
- With the B2 patch: 6 files / 158 passed.
- Worktree left clean, and the branch is not modified.
