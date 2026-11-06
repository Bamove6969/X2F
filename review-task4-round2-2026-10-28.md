# Review: wip/lead-p3-task4 @02bb5ba (Task 4 fix round, round 2) — APPROVED WITH MINOR (second's reviewer, 2026-10-28)

Branch did not move after `git fetch` (origin/wip/lead-p3-task4 = 02bb5ba). Scope: d30c25e, 1b590d5, 911242c, 8013366 (merge of 648493b), 02bb5ba, against round 1 (`review-task4-2026-10-28.md` @2a37fbd), Plan 3 Task 4 with its Revisions, and the coordination.md "Task 4 (offers) notes".

Tests run in my own worktree `~/x2f-worktrees/rv-t4` (detached at 02bb5ba, removed at the end), under `flock ~/x2f-comms/check.lock`:
- `npx vitest run --project @x2f/api offers account stage-tripwire view methods`: 5 files, 121/121 passed.
- Mutation: with the `select 1 from accounts … for update` line (routes.ts:250) deleted, the race test failed 3 runs out of 3 (`[201,201,201,201,409,409]`). So the test is really concurrent and does catch a missing lock.
- A scratch parity test (deleted afterwards) compared `rateSql`'s expression in Postgres with `offerRate` for 314 markets × 30 margins: details under Minor 1.
- Trial merge of main 5dd43e2 (not committed or pushed): conflicts resolved by hand, then `npm ci`, tsc for api, web and auth-client all clean, api `offers account schema stage-tripwire view identity` 6 files 162/162, web `chat-tripwire postOffer post-tripwires browse-tripwire quote-tripwires tradeRoom-tripwires tradeFund attestation-flow` 8 files 205/205.

Passes:
1. **Caps:** 3 per (side, method, currency) and 20 in total. Live and paused offers count, removed ones do not, and a relist leaves itself out of the count (`except`). The limits come from `owner_settings` keys `offers_max_per_market` and `offers_max_total`. A missing, non-integer or out-of-range (1..1000) value falls back to the default (routes.ts:79-82, 220-229). The check runs after `select 1 from accounts where id=$1 for update` (routes.ts:250, 257-264) in the posting transaction. The race test (offers.test.ts:477) sends 6 `Promise.all` posts through `inject`. The test pool has `max: 4` (helpers/db.ts:18), so at least 4 of them run on separate connections at the same time, and the mutation run above shows the test fails without the lock. Tests at :430 and :447 cover the per-market cap, paused/removed, the total of 20, the owner setting and relisting.
2. **SQL sort before LIMIT:** `order by ${order}, o.created_at desc, o.id limit 500` (routes.ts:423-434). The sort uses the bound market price, `nulls last`, and the direction depends on the side. The `online` and `trades` sorts break ties on rate. The rate expression equals `rateFor`'s `divHalfUp` algebraically and for every real price, but not in Postgres for rates of 10^16 and up (Minor 1). The suite has no parity test across modes and rounding edges: the only sort test (:485) uses ±100 bps on 33000, so no rounding happens.
3. **liveOfferStats** counts and takes min/max in SQL, with `group by o.method_id`, no `terms`, and the same `LISTED` filter (routes.ts:299-315).
4. **One transaction:** POST runs `assertMayPost` and the insert in `inTransaction` (routes.ts:350-363). The relist path re-reads the row, then runs the checks and the update in one transaction (:390-399). Pause and remove stay single statements, which is fine. Only static checks run outside the transaction (body shape, method profile, gift-card country).
5. **Terms rule:** `BAD_TERMS_CHAR` (routes.ts:72) refuses C0 except `\t\n`, DEL, C1, U+202A-202E and U+2066-2069. CR and CRLF become LF before the check and the length count (:207-208). ZWJ, soft hyphen and tag characters are allowed. The web form copies the same regex and cleaning (offerForm.ts:160-173, 202-216) and shows a message the user can act on. Both sides are tested (offers.test.ts M2; postOffer.test.ts "validate: terms"). `[...s].length` counts code points, the same as the DB's `char_length` check.
6. **lastSeenAt** is floored to 5 minutes in `traderSummaries` (summary.ts:58), which is the only public source: browse, detail and the trade view all use it. `/v1/account/sessions` gives exact times only to the session's owner. Tested at :506. One timing leak is left through `online` (Minor 2).
7. **Emergency stop:** `LISTED` now has `and not coalesce((select f.trading_paused from site_flags f), true)` (routes.ts:109-111). The list and `/v1/methods` are empty during a stop, and the detail route answers only the poster (offers.test.ts M6). `site_flags` has exactly one row (`id boolean primary key check (id)`), so the scalar subquery cannot fail.
8. **`stage` on `GET /v1/account/me`:** `tradeCap(...).stage` for traders and null for staff and owner (account.ts:145). It is optional in `@x2f/auth-client` and tested (account.test.ts, offers.test.ts M10).
9. **Lock order:** no deadlock today. Traced paths:
   - Post: accounts(A) `for update`, then site_flags `for share`. Next come plain reads (holds, wallets, owner_settings, counts) and the insert into offers, whose FK takes a key-share on accounts(A), already held.
   - Relist: the same, then the update on offer O.
   - A hold insert takes a key-share on accounts(A), which conflicts with `for update`, so it waits or is seen (the code comment is correct). It holds nothing the post needs.
   - The FU-A login-name update (account.ts:215) is one autocommit `update accounts`. The logout timer locks accounts(A) and then sessions; the post never locks sessions inside its transaction, and the session touch runs in the preHandler outside it.
   - Wallet add (wallets/routes.ts:212), push (:84), webauthn (:804), methods (:342) and Task 30's pgp confirm (t3-p3-task30 pgp.ts:321) each lock one account row first and take nothing the post holds. Nudge locks two accounts in id order.
   - Task 5 take (`wip/lead-p3-task5` take.ts:222-233, which contains 02bb5ba) locks both accounts in id order `for no key update`, then offer O `for share`, then site_flags `for share`. A relist holding accounts(A) and waiting on O cannot meet a take holding O, because the take locks O only after accounts(A).
   - Nothing in src writes site_flags, so nothing holds it exclusively while waiting on an account row. Plan 4 note under landing.

## Important
None.

## Minor
1. **The SQL rate is not `offerRate` for rates of 10^16 minor units per XMR and up.** routes.ts:118-122: `floor((m*(10000+bps)*2 + 10000) / 20000)`. Postgres numeric `/` rounds its result to a scale chosen from the quotient's size (`select_div_scale`: 16 significant digits). From about 10^16 that scale is 0, so the division rounds half up and `floor` has nothing left to floor.
   - Measured: 551 of 9420 cases differ. The smallest is market=10820100000498616, margin=4999: JS 16229067990747874, SQL …875. Another is market=24565500000621051, margin=0: SQL returns market+1.
   - Scenario: these values are out of reach for any listed currency today (the largest is IDR at about 5×10^8 minor per XMR), but `decimalToMinor` accepts up to 15 integer digits plus the exponent, so a feed glitch can produce one. Then `/v1/methods`' `bestCentsPerXmr` (taken from the SQL `min`/`max`) is 1 off the card's `rate`, and the sort can disagree with the cards.
   - Fix: `div(m*(10000+bps)*2 + 10000, 20000)`. I checked it: 0 differences on the same 9420 cases. Add a parity test that runs the SQL expression against `offerRate` over margins -5000, -1, 0, 1, 5000 and markets 1, 3, 10^8, 10^12, 10^16+3, 10^18-1, plus one sort test with a half-up case (for example market 33333 at +5 bps).
2. **`online` still shows the exact time of the last request.** summary.ts:56 (and the online sort at routes.ts:425) use the exact `last_seen_at`. Every trader request touches it (sessions.ts:242-251, with no throttle).
   - Scenario: a logged-out visitor polls `GET /v1/offers/:id` every few seconds. `online` turns false exactly 5 minutes after the poster's last request, so that request time is known to the polling interval, which is what flooring `lastSeenAt` was meant to hide. The coordination note says this on purpose ("online still uses the exact time"), so it is a known trade-off, not a regression.
   - Fix, if wanted: compute `online` from the floored value (`now - floored < ONLINE_MS + step`, or "seen in the current or previous 5-minute bucket"), or record it as accepted in the Task 4 notes as a privacy decision for the owner.
3. **Stale coordination line.** docs/coordination.md:148 still ends with "tripwire `NEEDS_TASK_4` fires when Task 4 lands", but the tripwire is now `NEEDS_TASK_20_API` (chat-tripwire.test.ts:15) and the line itself says the Task 4 part is unblocked. Scenario: a Task 20 builder looks for a tripwire that no longer exists. Fix: name `NEEDS_TASK_20_API` on that line.
4. **The cap values are not recorded as an owner decision.** Round 1 said "the owner may want to pick N". 3 per market and 20 in total are now enforced, but the Task 4 notes (coordination.md:219) only tell Plan 4 to upsert them. The plan's Task 4 text and the spec do not mention a per-account offer cap. Scenario: a power seller with 4 currencies × 2 sides on one method hits 409 `too-many-offers` without knowing why. Fix: add a line to the Task 4 notes (or the plan's Revisions) that the caps 3/20 are a starter default awaiting the owner, and say whether Plan 4's Settings screen shows them.

## Round-1 status

| Round 1 | Status | Where |
|---|---|---|
| I1 (a) per-account caps | Fixed | routes.ts:79-82, 220-265; tests :430, :447, :477 (race tested; the mutation fails it) |
| I1 (b) sort before LIMIT | Fixed (exact up to 10^16, Minor 1) | routes.ts:118-122, 419-436; test :485 |
| I1 liveOfferStats columns | Fixed (counted in SQL, no `terms`) | routes.ts:299-315 |
| M1 check and write in one transaction | Fixed; Task 5 lock note recorded and followed by task5 take.ts:222-237 | routes.ts:243-281, 350, 390; coordination.md Task 4 notes |
| M2 terms rule | Fixed, web copies it, both sides tested; no `bad-terms` code, which is not needed now that the form explains it | routes.ts:72, 207-208; offerForm.ts:160-216 |
| M3 lastSeenAt ms | Fixed (floored to 5 min); `online` remains (Minor 2) | summary.ts:29-30, 58 |
| M4 settings not seeded | Deferred and recorded (Plan 4 upserts, no seed migration) | coordination.md:219 |
| M5 lost-disputes tripwire | Fixed: `NEEDS_TASK_27` on `108_disputes.sql`, which task27 carries | apps/api/test/stage-tripwire.test.ts |
| M6 stop hides lists | Fixed (hidden) and recorded | routes.ts:109-111; coordination.md Task 4 notes |
| M7 opensAt on own offers | Fixed and tested | routes.ts:323-324, 461 |
| M8 Task 5 USD conversion | Recorded | coordination.md Task 4 notes |
| M9 stale comments | Fixed (quote-tripwires, chat-tripwire); coordination.md:148 half done (Minor 3) | |
| M10 `stage` on /me | Fixed in Task 4 (`GET /v1/account/me`) | account.ts:26-27, 145; auth-client api.ts |
| M11 test gaps | Fixed: detail 404 for held, disabled and legal-review offers, SBP list `[]`, repeated sort 400, browsing does not touch the session | offers.test.ts M11 tests |

Nothing in the fix round broke what I checked. The merge 8013366 and 02bb5ba (`stage` on the web `TraderSummary`) typecheck clean, and the web tripwires that read `traders/summary.ts` pass.

## Landing notes (onto main 5dd43e2)
- There are 2 textual conflicts, both in tests. Resolve them by hand:
  - `apps/api/test/schema.test.ts`: all three migration lists need `102_offers.sql` and `111_trade_identities.sql`.
  - `apps/web/test/chat-tripwire.test.ts`: in the header comment, keep the branch's "unblocked: Task 4's offers table (102_offers.sql)…" and main's "the chat's mod identity can now use Task 8's attestation".
  - coordination.md merges cleanly.
- The lockfile differs between the branch and main: run `npm ci` after the merge.
- After resolving, I ran tsc for api, web and auth-client and the targeted tests listed above, all green. Run the full check before pushing the landing.
- Deploy order: 102 creates `site_flags` with `trading_paused = false` and `trading_holds`. Task 5's take (on `wip/lead-p3-task5`) depends on both, so Task 4 lands first.
- Plan 4 (lock order): the emergency-stop writer should update `site_flags` in its own short transaction, or lock it only after any account rows. A transaction that updates site_flags and then locks or inserts against an account row (such as a hold insert in the same transaction) can deadlock with a post or relist, which holds accounts(A) `for update` and then waits for site_flags `for share`.
- Minors 1-4 can be fixed during the landing or recorded. None blocks.
