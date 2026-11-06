# Review: Plan 3 Task 4 (Offers API), origin/wip/lead-p3-task4 @2a37fbd

Reviewer: helper subagent (read-only), 2026-10-28.
Scope: 28a2834, 3c88ef5, 5923da9, d92c9b3 (merge of 059325d), 2a37fbd, checked against Plan 3 Task 4 and its revisions (2026-10-20 decimals, 2026-10-24 starter limits/tradeCap, 2026-10-26 stage, 2026-10-27 gift-card country), the spec (2.2, 2.3, 6.1, emergency stop) and Plan 4's use of `trading_holds` and `site_flags`.
Tests run (under flock, in ~/x2f-worktrees/lead-t4): `npx vitest run --project @x2f/api apps/api/test/offers.test.ts apps/api/test/view.test.ts apps/api/test/schema.test.ts`: 3 files, 89/89 passed.

## Verdict: CHANGES REQUIRED (1 Important, the rest Minor)

## Important

**I1. Browsing reads only the 500 newest offers and sorts after that, so one account can push every other offer out of the list.**
`apps/api/src/offers/routes.ts:341-354` (`order by o.created_at desc, o.id limit ${LIST_LIMIT}`, then sorts by best, online or trades in JS). POST has no limit on offers per account (`routes.ts:267-295`).
How it fails: once there are more than 500 live offers for a side, method and currency, "best" means best of the 500 newest, so the cheapest older offer disappears. The attack is cheap: one trader with a usable wallet posts 500 offers in, say, sell/ZELLE/USD, and every other poster's offer leaves that list. Nothing rate-limits POST /v1/offers. The same unbounded set also feeds `liveOfferStats` (`routes.ts:233-249`), which reads every live row for a side and currency, `terms` included (up to 4000 characters each), on every logged-out `/v1/methods` call.
Fix (both parts are small):
(a) Cap live and paused offers per account, for example 409 `too-many-offers` above N per (side, method, currency) and M in total, checked when posting and relisting.
(b) Sort in SQL before the LIMIT, or raise the limit and say it is a backstop. Within one currency every market offer shares one market price, so the rate can be computed in SQL from a bound `$market`: `case when price_mode='fixed' then fixed_cents_per_xmr else round($market*(10000+margin_bps)/10000) end`, with nulls last.
Also select only the columns `liveOfferStats` needs, without `terms`, or aggregate the counts in SQL.
The owner may want to pick N. Until then a generous default with a test is enough.

## Minor

**M1. Posting or relisting can race a new hold or pause.** `routes.ts:195-206` and `routes.ts:315-324`: `assertMayPost` and the insert or update are separate statements outside a transaction. A hold or emergency stop that commits between them still lets the offer in as `live`. The impact is low: listing hides held posters through `LISTED`, and Task 5's take must refuse a held poster and a paused site anyway. Either run the check and the write in one transaction (`select … for share` on the `site_flags` row and on the account) or add a comment saying the listing and take guards are the real enforcement. **Task 5 note:** take must lock the offer row (`for share`/`for update`) and re-read status, hold and pause inside its transaction, because a PATCH to paused or removed can race a take.

**M2. The terms check rejects ordinary pasted text with a bare 400 the web form cannot explain.** `routes.ts:66,178`: `\p{Cf}` also catches ZWJ (U+200D, inside emoji sequences such as family or profession emoji), the soft hyphen (U+00AD, common in copy-paste) and the tag characters (subdivision flags). `\p{Cc}` catches `\r`. `apps/web/src/screens/post/offerForm.ts:262` checks only the length, so the user gets "bad request" with no hint. Blocking bidi controls is right: U+202A-202E and U+2066-2069 are Cf. Suggested fix: refuse only the bidi controls and C0/C1 except `\n\t`, and strip or normalise `\r\n` to `\n`. Or keep the rule, mirror it in `validate()` with a message, and return a specific code (`bad-terms`). Test gaps: only U+202E is tested. Add a NUL, a C1 control and a zero-width character, and allowed emoji, to pin the rule down.

**M3. `lastSeenAt` is public to the millisecond.** `apps/api/src/traders/summary.ts:44,54`. Any logged-out visitor can log a poster's last request time to the millisecond, and every request a poster makes moves it. The field is in the plan, but rounding it (for example to 5 minutes, matching `ONLINE_MS`) loses nothing the UI shows and makes activity correlation harder. Tests at `offers.test.ts:114,180` would need adjusting.

**M4. The owner_settings rows are not seeded.** `102_offers.sql:63-66` and `stage.ts:126-138`. Defaults are a safe fallback, and the ordering reason is right: 102 runs before 109 on a new database, and `migrate.ts` applies missing files in name order, so an existing database that already ran 109 also takes 102 cleanly. But the plan revision (2026-10-24) and `docs/coordination.md:53` say each starter setting "is stored as a row the owner can change". If Plan 4's Settings screen lists or updates existing rows, the seven starter settings will be missing from it. Add the seven rows in a later migration with an unused number (110 is taken by `wip/lead-p3-task27`'s `110_dispute_system_retention.sql`; check `docs/coordination.md` before picking one), or record in coordination.md that Plan 4 must upsert from `STARTER_SETTING_KEYS`/`STARTER_DEFAULTS`.

**M5. Completed trades count every released trade, and nothing reminds Task 27 to change that.** `stage.ts:77-80,178-179`. The comment says Task 27 must subtract lost disputes, and `wip/lead-p3-task27` already carries `108_disputes.sql`. Add a tripwire, in the style the repo already uses and local-tree-only (R-rules): `NEEDS_TASK_27` fails once `apps/api/migrations/108_disputes.sql` exists. Otherwise the starter-limit stage silently ignores lost disputes after both land. The interim decision (released = completed) is acceptable.

**M6. Offers stay listed during an emergency stop.** `routes.ts:91-92` (`LISTED` does not read `site_flags`). Spec 9 says the stop "pauses every new trade and offer site-wide", and every user sees a notice. Listing offers that cannot be taken is defensible if the web shows the notice, but it is a product call. Either hide them (add `and not (select trading_paused from site_flags)`) or record the decision in coordination.md so Task 16/18 shows the stop notice on browse.

**M7. `opensAt` is set on the viewer's own offers in the list but not on the single-offer route.** `routes.ts:357` versus `routes.ts:377` (`!mine`). It is harmless but inconsistent. Skip `account_id === viewerId` rows in `markOpensAt`.

**M8. Task 5 must convert the starter cap the same way `opensAt` does.** `markOpensAt` (`routes.ts:253-264`) converts the offer's minimum fiat to USD at market FX (`usdCentsOf`, local/USD market prices), also for fixed-price offers (test `offers.test.ts:413-415`). Task 5 checks "the USD equivalent of the trade amount at the locked rate". If it computes XMR × USD market instead, a fixed-price offer far from market is greyed on the card and passes the take, or the reverse. Record in coordination.md that Task 5 uses `usdCentsOf(fiatCents, quote)` exactly.

**M9. Stale or wrong comments.**
- `apps/web/test/quote-tripwires.test.ts:6` says "poster.username is the public name". The field is `poster.displayName`.
- `apps/web/test/chat-tripwire.test.ts:15` (`NEEDS_TASK_4`) checks the chat files, not the offers table, so it never fires. Its premise ("waits for Task 4's offers table") is now false. Update the comment and coordination.md:148 so Task 20's API is shown as unblocked.

**M10. `GET /v1/me` has no `stage` yet.** Revision 2026-10-26 says `TraderSummary.stage` is "the same field `GET /v1/me` returns", but no `/v1/me` route in `apps/api/src` carries it. This is not necessarily Task 4's job. Record who adds it (via `tradeCap`) in coordination.md.

**M11. Small test gaps** (`apps/api/test/offers.test.ts`):
- No test that `GET /v1/offers/:id` answers 404 to others for a held or disabled poster (only the list is tested), or for a method under legal review.
- No test that browsing with a session does not touch `last_seen_at` (`touch: false`).
- No test that `side=sell&method=SBP` returns `[]`.
- No test for a repeated `sort` key.

## The builder's flagged decisions

- **displayName via PUBLIC_NAME_COLUMN:** right. The login name is never selected, the test proves it is absent from the list and detail bodies, and the column name is a constant, so there is no SQL-injection surface.
- **No owner_settings rows, defaults used:** safe and the migration order is right, but see M4.
- **Completed trades = all released:** acceptable for now. Add the tripwire (M5).
- **API limits (±50% margin, 4000-character terms, 14 digits, any supported currency, no fixed-price sanity check):** fine. They match `rateFor`, the DB checks (`numeric(30,0)`) and the web form, which is stricter (2-decimal currencies, ±10%). Having no fixed-price sanity check is acceptable because the poster sets their own price and Task 5's 0.5% quote check compares fixed prices exactly. The terms character rule is too broad (M2).
- **Browse does not touch the optional session:** right (`touch: false`, `allowStaleTerms`, and 401/403 swallowed to logged-out). A recovery or disabled session browses as logged out.
- **GET /v1/offers/:id added:** good. A paused offer is shown only to its poster, and a removed one is 404 to everyone. It uses the same `LISTED` filter plus `isAvailable`, and a non-UUID id gives 404, never a 500.
- **opensAt only for a signed-in trader, omitted without a market price:** right per Revision 2026-10-24. The take re-checks the cap. Also see M7 and M8.
- **trading_holds and site_flags created here:** no clash. Plan 4 (`plan-4-staff.md:119,528,601`) expects exactly `trading_holds(account_id, created_at, lifted_at)` and `site_flags(trading_paused, maintenance_since)`, and only adds columns (`kind`, `dispute_code`, `placed_by`; `banner_*`, `stopped_at`, `log_alarm`, `maintenance_message`). The extra `id` primary keys are additive. A Plan 4 `freeze` row with no `lifted_at` counts as held here. `packages/trade` `timerLoop` reads `maintenance_since` as built. No other branch (task5, task27) creates either table.

## Checked and fine

- **Merge d92c9b3:** `trades/view.ts` now re-exports `ONLINE_MS`, `traderSummary` and `TraderSummary` from `traders/summary.ts`. Same fields plus `stage`, the same completed-trades SQL (now shared as `COMPLETED_TRADES_SQL`), and `display_name` through the constant. `schema.test.ts` lists 102 in all three orderings. The `view.test.ts` txHash "fee" flake fix is sound. The web tripwire retirements match the real shapes: `parseOffers` and `parsePoster` read `displayName`, `stage` and `opensAt`, and tolerate `country`; post `validate()` matches the body and the 201 `{id}` and 409 `{error}` answers.
- **Authz:** POST and PATCH need a trader session; staff get 403. PATCH lets only the poster change an offer (403 `wrong-party`, and the update also filters on `account_id`). Removed is final (404). Relisting re-runs the method, hold, pause and wallet checks, and pausing or removing works under a hold.
- **Listing hides:** paused, removed, disabled-poster, held-poster and non-trader offers, and unavailable methods (list and detail).
- **SQL safety:** every value is bound. The only interpolations are constants (`OFFER_COLUMNS`, `LISTED`, `PUBLIC_NAME_COLUMN`, `LIST_LIMIT`).
- **Validation:** exact keys on the body and on `pricing`. `marginBps` is a safe integer within ±5000. `centsPerXmr` is a 1-20 digit string above 0. Fiat amounts are 1-14 digit strings above 0 with min ≤ max. `minTrades` is one of 0, 5, 10, 50. The currency must have a known exponent. Gift-card `country` is required exactly on gift-card methods and refused elsewhere, mirrored by DB checks. A repeated query key gives 400.
- **Best sort:** sell ads (the browser pays) sort lowest first and buy ads highest first, with no price last. `liveOfferStats`' best uses the same comparator, and `/v1/methods` drops unavailable methods.
- **Rate:** `offerRate`. A fixed offer shows its own price while the feed is down, and a market offer shows `null`.
