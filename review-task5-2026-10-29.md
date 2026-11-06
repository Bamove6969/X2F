# Review: Plan 3 Task 5 (taking an offer), first full review, 2026-10-29

Branch `origin/wip/lead-p3-task5` @f6f2167 (contains Task 4 @ed27ad3 and main 0e92cb6). I reviewed Task 5's own commits: 5b24ea6, 099d5ee, 1160608, f0ba1ad, 64ed833, a26cd67 and f6f2167. They cover `apps/api/src/trades/take.ts`, `112_take.sql`, the poster wallet route, `take.test.ts`, `take-tripwire.test.ts`, `helpers/db.ts`, the web take-refusal copy, the coordination "Task 5 notes" and auth-client `NOT_AUTH_CLIENT`.
Reviewer: read-only helper. All test runs were in a detached worktree (`~/x2f-worktrees/rv-t5`, since removed). There I trial-merged `origin/claude/compassionate-johnson-k95ssr` @7c43bf0 (which does not contain Task 4 yet) into f6f2167.

## Verdict: CHANGES REQUIRED (2 Important, 6 Minor)

The core is sound:
- The take locks the account rows in id order, then the offer row `for share`, then `site_flags` `for share`.
- Inside the transaction it re-reads the offer status, the poster's listing state, both holds and the pause.
- The partial unique indexes act as backstops.
- The wallet route puts its conditions in the UPDATE.
- `acceptedEvent` carries only `{type, code, by: display name}`.
- I found no deadlock against Task 4. POST and relist lock the poster's account `for update` before the offer row, and the take also locks accounts first. Pause and remove touch only the offer row. Nudges use the same id-ordered account lock.

The two Important findings are about money and addresses.

## Important

**I1: the set-once address trigger does not stop the app role from nulling an address and writing a new one.** `apps/api/migrations/112_take.sql:32-33`
- The trigger refuses only a change from one non-null value to a different non-null value.
- The API's own database role (the table owner) may set `buyer_payout`/`seller_refund` to NULL at any time, in any state. On the next UPDATE, NULL → new address passes.
- The wallet route's own guard (`buyer_payout is null`, take.ts:323-324) would also accept a fresh address after such a null.
- Failure scenario: any app bug or later code path issues `update trades set buyer_payout = null ...` on an open trade, for example a mistaken "reset setup" or a Task 7/9 cleanup. After that, `POST /v1/trades/:code/wallet`, or any UPDATE, writes a different payout address after Task 8 has attested the first one.
- This breaks the Plan 3 rule "addresses ... written once and never updated while the trade is open (only the 90-day purge nulls them after close)". The as-built note ("only the purge may null them", coordination Task 5 notes) and the migration comment (112_take.sql:24-27) claim a guarantee the trigger does not give.
- `take.test.ts:508-514` ("the purge may still null it") actually nulls as the app role, so it pins the hole as intended behaviour.
- Reproduced with a probe test: null as the app role, then set `fakeAddress()`, and the row holds the new address.
- Fix: in `trades_addresses_fixed`, refuse whenever `old.X is not null and new.X is distinct from old.X`, unless `current_user = 'x2f_purge'` and `new.X is null`. Optionally, also require `closed_at is not null` for the purge null.
- Change the test so the app-role null is refused (23000), and the null succeeds only under `set local role x2f_purge`, as `purgeTradeAddresses` does.
- Also consider: `seller_wallet_app` is not covered. The "deal fixed at take" columns (`locked_currency`, `locked_cents_per_xmr`, `fiat_cents`, `method_id`, `offer_id`, the parties, `poster`) have no DB guard at all. The probe wrote `locked_cents_per_xmr = 1, fiat_cents = 1` as the app role on an open trade. `amount_atomic` and `fiat_cents` legitimately change on growth (`grown_*`), so that guard needs care, but `locked_cents_per_xmr`, `locked_currency`, the parties and `method_id` can be frozen now.

**I2: the 0.5% tolerance is symmetric, so any client can always lock a rate 0.5% in the taker's favour.** `apps/api/src/trades/take.ts:119-126` (line 124)
- `lockRate` accepts any quoted `centsPerXmr` within ±0.5% of the offer's rate now, and then locks exactly the quoted value. The server never checks that the quote was a rate that actually existed.
- Failure scenario: a taker buying on a sell ad edits `centsPerXmr` to `now × 0.995`, with `fiatCents` recomputed. The take succeeds and the seller receives 0.5% less fiat than their own offer price. This happens on every trade, with the market not having moved at all.
- Probe: market $330.00, margin 0. A take at $328.35 for 1 XMR locks `32835`.
- On a buy ad, a selling taker does the same in the other direction (quotes +0.5%).
- For a poster with a 1% margin, that is half their margin, taken silently.
- This follows the letter of Revision 2026-10-27, so it needs a lead (or owner) ruling. Options:
  - (a) Make the tolerance one-sided: accept a quote that is worse for the taker by up to 0.5%, but refuse with `price-changed` any quote better for the taker than the rate now. Honest stale quotes that moved in the taker's favour then just re-quote.
  - (b) The server issues the quote, as an HMAC token over offer id, rate and time that `/take` must echo back. Then only rates the server really showed can lock, and the tolerance applies to feed movement since that token.
- Fixed-price offers are unaffected (exact compare).

## Minor

**M1: holds are not serialised with the take.** `take.ts:222`
- The take locks accounts `for no key update`. A `trading_holds` insert only takes a `for key share` lock on the account through its foreign key, and the two do not conflict. So a hold placed while a take is between its hold check (take.ts:231-239) and its commit does not wait. The take commits a trade for an account that was already on hold when the trade became visible. Probe: a hold insert under a held `for no key update` lock returns at once.
- Task 4's `assertMayPost` deliberately uses `for update` so that a hold insert waits (offers/routes.ts:241-244).
- The window is milliseconds, but it is the opposite of what Task 4 documented as the rule.
- Fix: use `for update` on the taker's and poster's rows (the take already serialises everything touching both accounts, so the cost is only blocking other foreign-key inserts for a few ms), or document the accepted window.

**M2: the race tests catch a removed account lock only most of the time.** `take.test.ts:115-147`, `:424-431`
- The barrier does make the racers overlap in Postgres: all n backends are verified blocked in `pg_stat_activity` before release.
- But once released, the offer/site_flags locks are shared, and the Starter open-count read happens many round trips later, so the window is a timing race.
- Mutation run (the `for no key update` line deleted): the full `take.test.ts` passed 1 of 4 runs (25/25 green), and the `-t race` runs failed 3 of 3 (4 trades instead of 3).
- So commit 64ed833's "Removing the take's account lock now fails the Starter open-trade race" is true only most of the time.
- Suggest repeating the five-taker race a few times in a loop, or asserting the stronger property: no trade on the offer has an open count above the cap at any point.

**M3: a blocked user can take the blocker's offer** (owner 2026-10-29; owed by Plan 3 Task 37, which lists `take.ts` in its files).
- `take.ts:225-226` does not consult `account_blocks`. Probe: A blocks B, and B's take of A's offer returns 200 with a code.
- `account_blocks` (107_nudge.sql) already exists and `summary.ts` already reads it for presence. A one-line `not exists (select 1 from account_blocks where account_id = poster and blocked_id = taker)` in `OFFER_SQL`'s 404 condition would close it now.
- If it stays with Task 37, add a local-tree tripwire or a coordination line, so Task 37's builder knows the take is the open door.

**M4: the poster wallet route reads the trade, then the wallet list, outside a transaction, and does not re-check the poster's hold, disabled state or `setup_by`.** `take.ts:297-329`
- The UPDATE conditions do make it once-only and poster-only (both verified).
- But a poster on a trading hold, or past `setup_by` before the timer flips the state, can still complete setup.
- A wallet removed between `pickWallet` and the UPDATE is still written.
- Low risk: decide whether a hold should block completing setup, and add `setup_by > now` to the UPDATE.

**M5: the Starter cap counts fiat only.** `take.ts:134-139`, `:160-169`
- A fixed-price offer far below market lets a Starter move many XMR inside the USD cap. Example: a fixed price of 1% of market gives 100× the XMR for the same $200.
- This follows the M8 note (convert the trade's fiat total), so it is an observation for the lead. If the cap is meant to bound risk, also check `usdCentsOf(fiatCents(amount, market))`, or the max of the two.

**M6: `starter-limit` with `{}` and an amount below the public stage cap tells the taker that the poster has 3 or more open trades.**
- It is a small presence and activity leak about the poster. Stage itself is public on cards.
- Acceptable if intended. Otherwise fold it into a generic refusal.

## Checked and fine

- **Double takes and overselling.** Sell ad: one waiting trade per buyer (index `trades_waiting_per_buyer`). Buy ad: one per amount (`trades_waiting_per_amount`). Both map 23505 to `already-waiting`/`ad-busy`. A sell ad has no total quantity, so there is nothing to oversell. Retries are idempotent through the same indexes.
- **Pause and remove racing a take.** `for share of o` conflicts with the PATCH UPDATE. Under READ COMMITTED, the re-check returns the updated status, so a paused offer gives 404.
- **The taker gets exactly the locked rate.** `fiatCents(amount, rate) === quoted fiatCents` is required, and the stored trade carries exactly the quoted rate and total.
- **Price checks.** Fixed-price offers compare exactly. A market offer while the feed is down gets `price-unavailable`. A non-USD cap with no quote fails closed.
- **Starter caps on both sides.** They use `usdCentsOf` at the market quote, including for fixed-price offers. The other side's refusal carries nothing.
- **Inside the transaction:** the emergency stop (no row fails closed), the taker's hold, the poster's hold and disabled state (as 404), and `method-unavailable`.
- **Wallet route.** The taker gets `wrong-party`, a stranger 404, a second call `wrong-state`, and two calls at once give one 204 and one 409.
- **`acceptedEvent`** has no amount, address or login name, and nothing is sent to the taker.
- **Deadlocks.** There are no lock-order inversions with Task 4 (POST, relist, pause), nudges, wallet add, push or webauthn. Each of those locks a single account or the same id order. The session touch's `for share` on accounts only waits.
- **Lost disputes.** `COMPLETED_TRADES_SQL` counts `released` only. Under the owner's 2026-10-29 rule (a settled dispute counts whoever won), a seller-won ruling that ends `refunded` must count too. That is Task 27's job, guarded by `stage-tripwire` (NEEDS_TASK_27). The take's `min_trades` uses the same SQL and will follow.
- **`take-tripwire` (NEEDS_TASK_20_LINK)** checks the local tree only. The auth-client `NOT_AUTH_CLIENT` additions are exact and sorted.
- **Web copy.** `takeErrors.ts` names no stage for the other side's limit.

## Trial merge with the main line (7c43bf0)

There were textual conflicts in three files, resolved by hand (local only, not pushed):
- `apps/web/test/post-tripwires.test.ts`: the main line retired NEEDS_TASK_28 and the branch retired NEEDS_TASK_4, which leaves the file with no tripwires, so it is deleted. This matches the lead's staged Task 4 merge.
- `apps/web/test/quote-tripwires.test.ts`: both NEEDS_TASK_28 and NEEDS_TASK_4/5 are retired, and the comment combines both sides.
- `docs/coordination.md`: both sides kept.

## Tests (trial-merge tree, under the check lock)

- `npm ci`: ok.
- `tsc --noEmit`: apps/api, apps/web and packages/auth-client all clean.
- API vitest:
  - Files: take, take-tripwire, offers, schema, tradePublish, view, stage-tripwire, plus my 4-test probe file.
  - Result: 8 files, 147 passed, which is 143 project tests plus 4 probes. All 4 probes "passed", which confirms I1, I2, M1 and M3.
  - The probe file was deleted with the worktree.
- auth-client vitest: 5 files, 70 passed.
- web vitest (full project):
  - Result: 52 files, 748 passed and 1 failed.
  - The failure was `attestation-flow.test.ts` › settling › "buyerCancel saves its intent before trade.cancel leaves", under load. Rerun alone twice, it passed 93/93 both times.
  - That test came from the main line (Task 5 touches no web escrow code), so it is a timing flake, not a Task 5 issue. Worth a note to whoever owns it.
- Mutation (account lock removed): see M2.
- Worktree `~/x2f-worktrees/rv-t5` removed.
