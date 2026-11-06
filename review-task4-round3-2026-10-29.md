# Review: wip/lead-p3-task4 @ed27ad3 (Task 4 minor-fix round, round 3) — APPROVED (lead reviewer, 2026-10-29)

Scope: 15e712c (Minor 1) and ed27ad3 (Minors 2+3) against round 2 (`review-task4-round2-2026-10-28.md` @02bb5ba). Minor 4 (caps not recorded as an owner decision) left on purpose: the owner is replacing caps with "flexible offers"; caps stay as built.

Counts: Important 0, Minor 1 (plus 1 note).

## Checked

1. **SQL rate == offerRate (Minor 1 fixed).** routes.ts:124 is now `div(m*(10000+bps)*2 + 10000, 20000)`. Postgres `div` on numeric is exact integer division truncating toward zero; the numerator is always > 0 (market price > 0, `margin_bps between -5000 and 5000` in 102_offers.sql:15, so 10000+bps >= 5000), so truncation = floor = `divHalfUp`'s `(n*2+d)/(d*2)` in money.ts:32-34. Numeric multiplication of the bound text price is exact at any size, so no scale rounding remains. Fixed offers still return `fixed_cents_per_xmr` untouched.
2. **The parity test truly runs in Postgres and catches the old formula.** offers.test.ts (round-2 describe) builds the rows with `unnest(...) with ordinality` and evaluates the exported `rateSql('o.m')` through `deps.db.query`, then compares text-for-text with `offerRate`: 11 margins (-5000, -4999, -101, -5, -1, 0, 1, 5, 49, 4999, 5000) x 15 markets (1 .. 10^20-1, incl. round 2's two failing values) + 3000 seeded random pairs (1-20 digit markets, margins -5000..5000), plus fixed mode at a 20-digit price. **Mutation:** with `floor((… ) / 20000)` restored, the test fails (and so does the online mutation below). The half-up sort test (33333 at +5 bps sorts between fixed 33349 and 33351) passes.
3. **`online` leaks nothing finer than the 5-minute bucket (Minor 2 fixed).** `onlineSince(now) = floor5(now) - 5 min` (summary.ts:39-41); online iff `last_seen >= onlineSince`. Because `onlineSince` is a bucket boundary, `last_seen >= boundary` iff `floor5(last_seen) >= boundary`, so `online` is a pure function of the public floored `lastSeenAt` and the clock bucket: it can only change at :00/:05 boundaries. Every route:
   - offers list cards and offer detail: `traderSummaries` (summary.ts:84). 
   - `online` sort: SQL `coalesce(lastSeenSql(...) >= $5, false)` with `$5 = onlineSince(now)` (routes.ts:436, 440) — same rule, same clock (`deps.clock`, not DB `now()`), so sort and cards agree; ties fall to rate / created_at / id, none of which carry time-of-request. Mutation: reverting summary.ts to the exact `now - last_seen < 5 min` fails the Minor 2 test (cards flip at 12:04:59.999 for a request at 11:59:59.999).
   - trade view counterparty: `traderSummary(..., me)` (trades/routes.ts:79).
   - `/v1/account/me` carries no presence; `/v1/account/sessions` gives exact `last_seen_at` only to the session owner (account.ts:307-318, unchanged).
   - `/v1/events` is own-account only and `touch: false` (events/routes.ts:33); no presence event exists.
   - No ETag / Last-Modified: no `@fastify/etag` or manual header anywhere in apps/api/src (grep), so responses carry no timestamp of the poster.
   - No other reader of `sessions.last_seen_at` in src on the merged tree except auth/sessions.ts (touch/idle), routes/account.ts (own sessions) and traders/summary.ts. Main's new Task 8 code (internal listener, identity routes) reads none.
4. **Blocked viewer (owner ruling 2026-10-28, added by claude2).** `lastSeenSql(account, viewer)` returns null when `account_blocks(account_id = poster, blocked_id = viewer)` exists; a null viewer (logged out) compares `blocked_id = null` → never matches → shown. Applied consistently on cards, detail, the online sort and the trade view; tested (incl. sort order). The `not exists` uses the table's PK (account_id, blocked_id). See Minor 1 for the gap.
5. **Minor 3 fixed:** coordination.md:148 names `NEEDS_TASK_20_API` (`apps/web/test/chat-tripwire.test.ts`). The Task 4 notes replace "online uses the exact time" and add the "presence goes through lastSeenSql/traderSummaries" rule.
6. **Signature change:** `traderSummaries`/`traderSummary` now take a required `viewerId` before `settings`. On the merged tree the only callers are offers/routes.ts:442, 463 and trades/routes.ts:79 (all updated); main 0e92cb6 adds no new caller; tsc clean. `viewer()` moved before the list query: same call, same no-touch behaviour (the "browsing does not touch the session" test still passes).

No regressions found.

## Important
None.

## Minor
1. **The owner's block ruling is only partly enforced, and the partial part can be seen through.** owner-answers-2026-10-28.md Q8: "Blocked person can't see your offers, take them, message you, or even see that you're online." ed27ad3 hides only presence. `LISTED` (routes.ts:109-111) and the detail route do not exclude a poster who blocked the viewer, so the blocked person still sees the offers; and since a logged-out view of the same card shows a real `lastSeenAt`, the blocked person can detect the block by comparing their signed-in view (`lastSeenAt: null`) with a private window. Scenario: harasser B, blocked by A, opens A's offer signed in (Offline, never seen) and logged out (seen 12:05): learns of the block and A's presence anyway. Not a regression (before this round B saw everything). Fix, or record as owed: hide offers of a poster who blocked the viewer from list and detail (404) — `and not exists (select 1 from account_blocks b where b.account_id = o.account_id and b.blocked_id = $viewer)` in the list/detail query — and Task 5's take refuses it; until then the coordination.md Task 4 note should not say the block is "not revealed" and should name the remaining owner requirement (offers hidden, take refused) with its owner task.

Note (no action): `ONLINE_MS` is still exported via index.ts / trades/view.ts; it is now only the bucket width used by `onlineSince`, which its doc comment says. Fine.

## Tests (own worktree ~/x2f-worktrees/rv-t4, detached at ed27ad3 + trial merge of 0e92cb6, not committed; all under flock check.lock)
- `npm ci` (npm@11.21.0): ok.
- tsc --noEmit: apps/api, apps/web, packages/auth-client all exit 0.
- api `vitest run --project @x2f/api offers account schema stage-tripwire view identity nudge trades`: 9 files, 221/221 passed.
- web `vitest run --project @x2f/web`: 51 files, 730/730 passed.
- Mutations (reverted afterwards): old `floor(/)` rate and exact-time online → `offers -t "round 2"`: 2 failed (Minor 1 parity, Minor 2 bucket), 2 passed.

## Conflict resolutions for the landing (merge 0e92cb6 into wip/lead-p3-task4, or the reverse)
Two textual conflicts, both tests; everything else (app.ts, errors.ts, index.ts, quote-tripwires.test.ts, coordination.md) auto-merges.
1. `apps/api/test/schema.test.ts`, three lists — union, in number order:
   - first list (fresh migrate, ~line 44): `'101_method_suggestions.sql', '102_offers.sql', '103_trades.sql', '104_trade_retention.sql', '105_push.sql', '107_nudge.sql', '109_owner_settings.sql',` then a line `'111_trade_identities.sql',`
   - second list (~line 66): `'009_login_names.sql', '010_wallet_wait_logout_timer.sql', '011_secret_keys.sql', '101_method_suggestions.sql', '102_offers.sql', '103_trades.sql',` / `'104_trade_retention.sql', '105_push.sql', '107_nudge.sql', '109_owner_settings.sql', '111_trade_identities.sql',`
   - third list (~line 131): `'010_wallet_wait_logout_timer.sql', '011_secret_keys.sql', '101_method_suggestions.sql', '102_offers.sql', '103_trades.sql',` / `'104_trade_retention.sql', '105_push.sql', '107_nudge.sql', '109_owner_settings.sql', '111_trade_identities.sql',`
2. `apps/web/test/chat-tripwire.test.ts` header lines 2-3: take the branch's text with main's ending:
   ```
   // and packages/trade/src/chat.ts). Task 20's routes, migration and panel are unblocked: Task 4's
   // offers table (102_offers.sql) and Task 6's trades and startRetention exist; the chat's mod identity can now use Task 8's
   ```
   (line 4 `// attestation; the device store for Task 12. ...` is shared). The body auto-merges to main's imports (`existsSync, readdirSync, readFileSync`, no `@x2f/trade`) and the three checks NEEDS_TASK_20_API, NEEDS_TASK_20_ATTEST, NEEDS_TASK_12 — keep as is.
- Lockfile differs: run `npm ci` after the merge. Then run the full check before pushing the landing.
- Semantic: tsc catches any future 3-arg `traderSummary(...)` caller; on 0e92cb6 there is none.
- Deploy order unchanged from round 2 (Task 4 before Task 5; Plan 4 emergency-stop lock-order note).

Worktree removed after the run.
