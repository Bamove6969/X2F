# Review: Plan 3 Task 5 (taking an offer), round 2 (fix round), 2026-10-29

**Branch reviewed:** `origin/wip/lead-p3-task5` @c7e49d2. The fix round is three commits:
- bbccb84: main 1b2bb3a merged in.
- 6d347cc: the API fixes.
- c7e49d2: the web side.

**Round 1:** `review-task5-2026-10-29.md`.

**How I tested:** read-only, in my own detached worktree `~/x2f-worktrees/rv-t5r2` (now removed). I merged the main line into it twice:
- First 990affe, which already has Tasks 24 and 27.
- Then 047b4f3 (News), as the coordinator asked after the pause.
- All test results below are on the 047b4f3 merge.

## Verdict: APPROVED (0 Important, 4 Minor, none blocking)

Every round-1 finding is fixed and has a test that fails without the fix.

## Round-1 findings

### I1 (deal and addresses): fixed
Trigger `trades_set_once_deal` (`112_take.sql`) applies to every role.

**What it freezes:**
- The offer, parties, poster, method, locked rate and currency.
- The confirm window, the offer range, and `taken_at`.
- The take's amount and total, compared as `coalesce(grown_from_*, amount/fiat)`, so growth still works:
  - growing (from null to the original amount) passes;
  - the machine's `back ? null` revert also passes;
  - a rewrite of `grown_from_*` is refused.

**What it does with addresses:**
- `buyer_payout`, `seller_refund` and `seller_wallet_app` can be set from null only while the trade is in `setup`.
- Once set, they cannot change. The one exception: `x2f_purge` may null an address on a closed trade.
- A purged address can never be written again.

**Every `UPDATE trades` on the merged tree, checked against the trigger:**

| Write | Columns it writes | Allowed by the trigger? |
|---|---|---|
| `store.ts:319` `applyEvent` (Tasks 6/9/24/27: state, escrow, settle, dispute, growth) | `stateColumns` only | Yes. Amount and fiat only change together with `grown_from_*`. |
| `trades/routes.ts:116` | the final-alert columns | Yes |
| `purge.ts:26` | nulls addresses, runs as `x2f_purge`, `closed_at < cutoff and state <> 'disputed'` | Yes, it is the allowed purge case |
| `take.ts` wallet route | address from null, in `setup` | Yes |

- Task 27's disputes code does not write `trades` directly, and migrations 108, 110 and 115 add no trades columns or triggers.
- The full API suite passes with the trigger in place, which covers every main-line test helper that writes trades.
- The trigger function is not `security definer`, so `current_user` really is `x2f_purge` under `set local role`.

### I2 (rate): fixed, as the lead decided

**The API side:**
- `lockRate` returns the server's `offerRate`; the client's rate only detects a move (more than 0.5% on a market offer, any difference on a fixed one).
- The client's total must still equal its own amount at its own rate, or the request is 400.
- `out-of-range` and the caps use the server's total.
- The answer is `{ code, centsPerXmr, fiatCents }`.
- The round-1 probe is now a test: a quote 0.5% better for the taker still locks $330.00.

**Against the device's attestation check (deal-mismatch):**
- Task 12's `Deal` is `{ poster, takeAmountAtomic, currency, centsPerXmr, maxFiatCents }`. It has no fiat total.
- `viewMatches` (`escrow/runtime.ts:262`) compares currency, `centsPerXmr` and `maxFiatCents`.
- `useTake` now stores `deal.centsPerXmr = taken.centsPerXmr`, so the attested rate equals the confirmed one.
- The poster's deal is built from their own trade view (`AcceptedSheet.posterDeal`), so it uses the locked rate too.
- Nothing else in `Deal` depends on the quoted rate, so `deal-mismatch` cannot come from this change.

### M1 (holds): fixed
- Both accounts are now locked `for update`.
- A new deterministic test (the take parked after its locks, then `for key share nowait`, then a hold insert with `lock_timeout`) shows the hold waits.
- Mutant B (`for no key update` put back) fails that test.

### M2 (race tests): fixed
- Mutant A (account lock deleted) fails both the three-round Starter race and the deterministic test.
- Mutant B fails the deterministic one.
- Both mutants were caught on their first run; the round-1 version was caught only 3 times in 4.

### M3 (block): fixed
- `assertNotBlocked` checks both directions and answers 404.
- It runs right after the offer is found and before any refusal that would show the offer exists. The test confirms an out-of-range amount still gets 404.
- Compared with Task 37's `traders/blocks.ts` helper (6e02e10): same name, same signature, same SQL in both directions, same 404 `not-found`.
- I trial-merged 6e02e10 on top. The API side merged cleanly and tsc api is clean. `take.test`, `block-tripwires` (including NEEDS_TASK_5_BLOCK), `blocks.test` and `offers.test`: 4 files, 82 passed.
- The local copy and the import do not clash. The coordination note says whichever task lands second switches to the import.

### M4 (wallet route): fixed
- It now runs in one transaction, in this order:
  1. the trade row `for update`;
  2. the poster's account `for update`;
  3. the hold check;
  4. the wallet `for share`;
  5. `pickWallet`;
  6. the guarded UPDATE.
- It refuses `trading-hold` and a trade past `setup_by` (`wrong-state`). Both are tested.

**Lock order:**
- The take locks accounts and only inserts a new trade row. It never waits on an existing trade's row lock: a unique-index check waits only for an uncommitted insert, and that insert is itself a take that already holds its account locks.
- `applyEvent` (disputes, timers, Tasks 24/27) locks only the trade row, plus a `disputes` insert whose foreign key points back at that same trade.
- Appeals lock only `disputes`.
- Task 4's post and relist lock a single account, as do wallets, push and webauthn.
- **No cycle is possible.** A trade-then-account order (wallet route, or a future hold insert made after a trade lock) cannot meet an account-then-existing-trade order, because no path takes the second.

### M5 (cap at market): fixed, as the lead decided
- The cap counts the larger of the trade's fiat total and its XMR valued at the market price. Tested with a fixed price at 1% of market.
- The side effect is the right call, in my view. While the feed is down, a take where either side has a Starter or Building cap is refused with `price-unavailable`, even for a USD fixed-price offer. Without a market price the XMR value cannot be measured, so refusing is the only safe answer.
- Graduated-to-Graduated takes of fixed-price offers still work while the feed is down, because `usd()` is called only when a cap applies.
- The web shows "Price unavailable right now", which is acceptable.

### M6 (poster's open-trade count): fixed
- The poster's open-trade limit is now a generic 409 `offer-busy`. It is tested and has web copy.

## New Minor findings (none blocking)

**m1. A device-side refusal leaves a trade on the server.** `apps/web/src/screens/quote/useTake.tsx:91-94`
- Scenario: the take has already committed (taker's address set, poster notified with "accepted"), and then `lockedWithinQuote` fails.
- The device records nothing and shows the generic error.
- The trade waits in `setup` until it lapses, and meanwhile `already-waiting`/`ad-busy` block a retake by this taker.
- This can only happen if the server breaks its own 0.5% check, so the risk is low. The code comment could say so.

**m2. `lockedWithinQuote` uses 0.5% for fixed-price offers too.** `useTake.tsx:35-38`
- The block comment above it (useTake.tsx:15-16) says that for a fixed price the device checks that the rates are equal.
- The server already compares fixed prices exactly, so this is harmless. Either fix the comment or pass the pricing mode in.

**m3. A comment cites dispute code that does not exist.** `take.ts` wallet route comment, and coordination's Task 5 notes
- They say "trade before account, the order a dispute takes when it places a hold". No dispute code (Task 27, `disputes/routes.ts`) places a hold today.
- The order chosen is safe (see M4). Suggest rewording it as a rule for Plan 4: "a hold placed under a trade lock takes the trade row first".

**m4. Two web tests failed once under load.**
- `copy-lint.test.ts` (the CLI over a planted folder) and `fundSeams.test.ts` (`qrPath` quiet zone) each hit about 5.3 s, past the default timeout, in the full web run.
- Rerun alone: 2 files, 36 passed.
- Task 5 changes neither file, so these are load flakes and are for their owners, not this task.

## Landing notes
- **Main line 990affe** conflicted in three files, resolved by hand:
  - `apps/api/src/app.ts`: kept both imports (`confirmationsRoute` and `disputeRoutes` from main, `takeRoutes` from the branch) and the shared `tradePublish` call; `takeRoutes(app)` goes after `tradeRoutes` and before `disputeRoutes`.
  - `apps/api/test/schema.test.ts`: the migration lists in all three places become `…111_trade_identities.sql, 112_take.sql`.
  - `packages/auth-client/test/flows.test.ts`: kept both sides; the list keeps `POST /v1/offers/:id/take`, `POST /v1/trades/:code/wallet`, the appeal and the dispute, sorted.
- **Main line 047b4f3 (News)** conflicted only in `schema.test.ts`: the lists become `…111_trade_identities.sql, 112_take.sql, 115_news.sql`, in all three places.
- **Lockfile:** unchanged by both merges.
- **Task 37 (6e02e10) on top:**
  - The only conflict is `apps/web/src/App.tsx`, between News's `/news` route and Task 37's `/settings/blocked` route. Keep both. That conflict is Task 37 against News, not Task 5.
  - The API side merges cleanly.

## Tests

All on the 047b4f3 merge, each under the check lock with no nested flock.

| Check | Result |
|---|---|
| `npm ci` | ok |
| tsc: apps/api, apps/web, packages/auth-client | all clean |
| API vitest (full project) | 46 files, 1095 passed, 1 todo |
| auth-client vitest | 5 files, 70 passed |
| web vitest (full project) | 64 files, 934 passed, 2 failed (the m4 load flakes); those 2 files rerun alone: 36 passed |
| Playwright: quote, setup, pay, dispute, dispute-room | 105 passed |
| Mutants A and B (account lock deleted; `for no key update` put back) | each caught (see M1, M2) |
| Task 37 trial merge on top | 4 files, 82 passed, NEEDS_TASK_5_BLOCK green |

The same suites on the earlier 990affe merge were all green: API 1081 passed, web 923, Playwright 105.

The worktree is removed, and I have no server, Playwright or flock wait left running.
