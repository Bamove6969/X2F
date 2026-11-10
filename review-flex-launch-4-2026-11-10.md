# Money-path review: `wip/lead-flex-launch-4` @ 43333a3a (10 Nov 2026)

Reviewer: independent money-path reviewer, read-only on code. Worktree `/home/user/X2F/.claude/worktrees/flex-launch-4`, head `43333a3a`, clean. Base: batch 4 `257e11b7`. Commits reviewed: `7a331930` (merge of `tmp/flex-launch-jabber` `bfc46319` = flex-launch `9909121f` plus the two revert-the-reverts of Jabber), `7a91e3a7` (red tests), `f6859c10` (gift-card rulings B and C), `9be90ecc`, `bebcb339`, `43333a3a` (test ports). Prior reviews read: `review-flex-launch-2026-11-09.md`, `review-flex-offers-2026-11-09.md`, `review-launch-rules-2026-11-09.md`, `review-j17-gift-cards-2026-11-09.md`, `review-jabber-notices-2026-11-08.md`.

The container restarted at about 00:55 UTC; every run below had finished and its log survived (the chain wrote its last line at 00:53:44), the head was unchanged, so only the three typechecks were re-run afterwards (noted in the table).

## Verdict: CHANGES REQUESTED (no money-path defect)

Every money guarantee of `review-flex-launch-2026-11-09.md` holds after the merge onto batch 4: the $5,000 cap at post, relist, bulk relist and take, the growth ceiling, the chosen currency's quote and the chosen method's profile; the gift-card rules are applied per method exactly as the lead ruled; the one `tradeProfile` table carries all 18 profiles with a time to pay; the Jabber payer notice still fires through the 331 trigger on both dispute paths. What blocks landing is one Major integration defect outside the money path (finding 1: a team member's relist is a 500, because `team/audit.ts` still reads offer columns that migration 490 drops) and three test-port gaps in files the branch did not port (findings 2 and 3). All four are mechanical and in the integrator's hands; one owner/lead question (finding 4, the "$15 minimum" that exists nowhere).

## Tests run (serialised runner, this worktree; logs in `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/logs/`)

| Run | Result | Log |
|---|---|---|
| `apps/api/test/profiles.test.ts` | 47/47 pass | `rvFL4-profiles-003428.log` |
| `apps/api/test/offers.test.ts` | 40/40 pass | `rvFL4-offers-005144.log` |
| `apps/api/test/take.test.ts` | 57/57 pass | `rvFL4-take-005230.log` |
| `apps/api/test/flexOffers.test.ts` | 30/30 pass | `rvFL4-flexOffers-005248.log` |
| `apps/api/test/offersBulk.test.ts` | 19/19 pass | `rvFL4-offersBulk-005256.log` |
| `apps/api/test/schema.test.ts` | 77/77 pass | `rvFL4-schema-005303.log` |
| `apps/api/test/jabber-paths.test.ts` | 26/26 pass | `rvFL4-jabber-paths-005313.log` |
| `apps/api/test/jabber.test.ts` | 16/23, **7 failed** (batch 4's own, finding 5; the 3 dispute-trigger cases pass) | `rvFL4-jabber-005317.log` |
| `apps/api/test/disputes.test.ts` | 24/24 pass | `rvFL4-disputes-005324.log` |
| `apps/api/test/team.test.ts` (added: the audit path) | 67/70, **3 failed** (findings 1, 2) | `rvFL4-team-003732.log` |
| `apps/api/test/holdV3.test.ts` (added: pre-490 fixture) | 44/45, **1 failed** (finding 3) | `rvFL4-holdV3-003820.log` |
| `apps/api/test/disputes/staff.test.ts` (added: pre-490 fixture) | 26/28 + 1 todo, **1 failed** (finding 3) | `rvFL4-staffDisputes-005220.log` |
| `packages/trade/test/flexOffer.test.ts` | 19/19 pass | `rvFL4-trade-flexOffer-005331.log` |
| `packages/trade/test/giftCards.test.ts` | 10/10 pass | `rvFL4-trade-giftCards-005332.log` |
| `apps/web/test/quoteScreen.test.tsx` | 59/59 pass | `rvFL4-web-quoteScreen-005333.log` |
| `apps/web/test/postOffer.test.ts` | 36/36 pass | `rvFL4-web-postOffer-005337.log` |
| `apps/web/test/giftCards.test.tsx` | 7/7 pass | `rvFL4-web-giftCards-005338.log` |
| `npx tsc -p apps/api --noEmit` | clean (exit 0); re-run after the restart: clean, 73 s | `rvFL4-tsc-api-005340.log`, `rvFL4b-tsc-api-005905.log` |
| `npx tsc -p apps/web --noEmit` | clean (exit 0); re-run after the restart: clean, 11 s | `rvFL4-tsc-web-005342.log`, `rvFL4b-tsc-web-010018.log` |
| `npx tsc -p packages/trade --noEmit` | clean (exit 0); re-run after the restart: clean, 9 s | `rvFL4-tsc-trade-005344.log`, `rvFL4b-tsc-trade-010029.log` |

Not run (job scope): Playwright, moderation, the whole-project check. The red runs of `7a91e3a7` are claimed in the commit message; I did not reproduce them.

## The seven checks

### (1) Every cap, price and band guarantee of review-flex-launch still holds

- `apps/api/src/trades/launchCap.ts` is byte-identical to flex-launch `bfc46319` (empty diff), as is `packages/trade/src/flexOffer.ts`. `bandTopUsdCents` (:48-53) still values an XMR band exactly as `take.ts usdValue` (:173-178) values XMR: same `fiatCents` then `usdCentsOf` at `prices.quote(currency)`.
- Post: `offers/routes.ts:865` `offerLaunchCapRefusal(o.unit, o.currencies, deps.prices, false)` inside the posting transaction after `assertMayPost` (:861), before the insert (:867). Relist: `:951` with `true`, under the account lock, before the `update` (:952). Bulk: `:1239` per offer, refused offers never reach `switched` (:1248). Fail-closed on an all-unpriced offer unchanged (`launchCap.ts:94`).
- Take: one route (`take.ts:287`), one `insertTrade` call (:420). `lockRate(b.currency, pick.tier, method, …)` (:369) prices the band and method in the chosen currency; `q = deps.prices.quote(b.currency)` (:380) feeds `usdValue` (:381), the starter caps (:382), `assertWithinLaunchCap(usd)` (:385) and `growthCeiling` (:387-389), so one quote judges the cap and the ceiling. `tradeProfile(method.methodId)` (:394) fixes `confirmWindowMin` and `payWindowMin` (:405-406), written by `insertTrade` (`store.ts:236-237`), set-once by 112/490's `trades_deal_fixed` and 124's `trades_set_once_pay_window` (`124_pay_window.sql:11-23`; `take.test` pins the `23000`).
- The merge dropped nothing from either parent's money path: the lines removed from `take.ts` relative to batch 4 are the pre-J-16 single-method offer row, `offerRate`-based `lockRate`, `rangeOf` and the `minTrades` check, all replaced by `pickTier` / `tierRate` / `tradeFiatLimits`; relative to flex-launch only `profileOrFallback` → `tradeProfile`, the recovery-hold `poster_ok` term (:146-148, batch 4's hold v3) and the gift-card lines changed.
- Pinned by: `take.test` "the launch cap" (4) and "the growth ceiling" (4) blocks, `flexOffers.test` "posting: every band's top edge", "relisting checks every band again", "the bulk switch judges each offer on its own", "OWNER QUESTION p11-95", "taking: the trade's USD value in the chosen currency"; `offers.test` "relisting checks the launch cap as posting does"; `offersBulk.test` "the launch cap is checked per offer". All green above.
- Finding 1 of the prior review (post judges the top edge at market, take by the larger of total and market; owner question p11-126) and finding 2 (p11-95 card clamp) are unchanged by this branch.

### (2) Gift-card rules per method

- Post (`offers/routes.ts:845-857`): `giftMethods = o.methods.filter(isGiftCard)`; with any, the country must be `[A-Z]{2}` (:847), `giftCardCurrencyOk(country, c)` for **every currency each card method is offered in** (:849; `packages/trade/src/giftCards.ts:154-156` over the ISO 4217 table :110-146), `giftCardTermsGiven === GIFT_CARD_TERMS_VERSION` (:852), both stored (`:867-869`, `offers.country`, `offers.gift_card_terms`, migration 355). A country or terms on an offer with no card method is 400 (:855-857). Non-card methods on the same offer are not constrained: `offers.test` "a gift-card method among several" posts Zelle in USD+EUR with a Steam card in USD only, refuses the card in EUR (default and explicit), a DE country on the US-dollar card, and the missing version; the list shows the card under `STEAM_GIFT_CARD`/USD, not EUR, and the offer under Zelle/EUR.
- Take (`take.ts:324-328`): `giftCardTerms = isGiftCard(method.methodId) ? VERSION : null` on the **chosen** method; `b.giftCardTerms !== (giftCardTerms ?? undefined)` → 400, so a Zelle take carrying terms and a card take without them are both refused; stored by `insertTrade(…, giftCardTerms)` (:420), set-once by 355's trigger. `parseTake` lets only `giftCardTerms` be optional (:103-104). `take.test` "a two-method offer (J-16 x J-17)" pins both refusals, then Zelle `{null, 90, 90}` and the card `{VERSION, 45, 90}`.
- Confirm 45 / pay 90: `data/payment-method-profiles.json` `OTHER_GIFT_CARD` `confirmWindowMin 45, payWindowMin 90`, marked LEAD DEFAULT pending p11-130 in the file note and at `profiles.ts:57-62`; `profiles.test` pins `tradeProfile('STEAM_GIFT_CARD')` → `[45, 90]` and every catalog gift card → 45.
- Web: `offerForm.ts:655-661` treats the offer as a gift-card offer when any picked method is one (`ctx.giftCard(m.methodId)`), requires the country, and refuses the whole currency list unless every picked currency is the card country's (`CURRENCY_NOT_CARD` on `currencies`), which is stricter than the API (the form offers every method in every currency: owner question p11-131, already logged). `Quote.tsx:171,484` sends the version only when the picked method is a gift card. `giftCards.test.tsx` 7/7.
- **The "$15 minimum" named in my brief exists nowhere** (finding 4).

### (3) One `tradeProfile` table

- `apps/api/src/methods/profiles.ts:180-184`: own profile, else `OTHER_GIFT_CARD` for any catalog gift card, else `CUSTOM`; `profileOrFallback` is gone everywhere (`take.ts:394`, `offers/routes.ts:1133,1136`, `methods/routes.ts:98`). No method lost a profile: HEAD's 18 ids are exactly batch 4 `257e11b7`'s 18 (`LAUNCH_PROFILE_IDS` :50-53) and a superset of flex-launch `bfc46319`'s 17 (no `OTHER_GIFT_CARD` there).
- `MIN_PAY_WINDOW_MIN = TIMERS.payMin` (90) and `MAX_PAY_WINDOW_MIN` (1440) enforced at `profiles.ts:134-141` on every profile (not just the launch set); `profiles.test` "refuses a profile file whose time to pay is missing or out of range" pins `undefined, 89, 1441, 90.5, '90'`.
- `data/payment-method-profiles.json`: `git diff 257e11b7 HEAD` on the file is the note plus one `payWindowMin` line per profile (18 lines), nothing else; the values are the launch-rules lead defaults (90 app/instant, 180 bank, 1440 cash by mail, 90 gift card). Against `bfc46319` the diff is the batch-4 wording and field keys (UPI `vpa` not `upiId`, SWIFT with a `bank` field, one-line field objects) plus `OTHER_GIFT_CARD`: the builder kept batch 4's text and added the launch-rules number, which is the right side to keep (batch 4 is what main becomes). Note: **main `58f3d186` has 8 profiles, not 18**; the 18 are batch 4's (`257e11b7`), which is what the brief meant.
- Attested terms carry `payWindowMin` (`internal/routes.ts:93-108`, `sameTerms` :116) and moderation's shadow reads it (`apps/moderation/src/shadow.ts:45`), as launch-rules had it.

### (4) Jabber

- HEAD's `apps/api/src/jabber/*` (outbox, sender, xmpp, omemo, socks, scram, rewrap, retention) is batch 4's: `git diff 257e11b7 HEAD -- apps/api/src/jabber apps/api/src/team apps/api/src/auth` is empty. `queueTradeAttention` appears nowhere in HEAD (it was `bfc46319`'s code path in `disputes/routes.ts:242` and `trades/store.ts:391`); `disputes/routes.ts` and `disputes/store.ts` are unchanged from batch 4.
- The payer notice is the 331 trigger: `jabber_dispute_opened` (`331_jabber_notices.sql:140-155`) `after insert on disputes`, queuing `'trade-attention'` to the trade's buyer when enabled. Both dispute paths insert through `startDispute` (`disputes/store.ts:167`, the insert at :186): a trader's dispute at `disputes/routes.ts:262`, the timer loop's escalation at `trades/store.ts:405` → `openSystemDispute` (`store.ts:211-212`) → `startDispute`. `jabber.test` "a dispute tells the payer" runs `startDispute` for buyer, seller and system: 3/3 pass in the otherwise failing file; `disputes.test` 24/24; `jabber-paths.test` 26/26 (the change-path classification, with 334).
- `332_jabber_notice_kinds.sql` and `jabber-trade.test.ts` are absent (`git ls-tree HEAD`); HEAD's `332_jabber_review.sql` is batch 4's, and the kind column, its check and the `(account, txid, kind)` key live in 331 (:49). `sender.ts:18-22` keeps `trade-attention` and its COPY-UNSIGNED sentence.

### (5) `offers/routes.ts` resolution

- `requireInside` on the list (:979) and the detail (:1044); viewer is `req.auth!.accountId` (:1003, :1054); the flex-launch `viewer()` helper is gone. `assertMemberMay(req.auth, status === 'removed' ? 'offers-delete' : 'offers-pause')` at :913; the batch-4 session boxes (`offers-post`, `offers-see`, `offers-pause`, `offers-delete`, :757-767) and the member Terms check (:771-783) are all kept.
- My offers `hidden` is the union: `'recovery-hold'` in the type (:178), `recoveryHoldHidesSql` in the `why` query (:1097-1101) and the chain `paused → held → recovery → review-pending` (:1105-1112), then flex-offers' `method-unavailable` / `no-price` (:1142-1146). `LISTED` carries the recovery-hold term (:295) and so does the take's `OFFER_SQL` (`take.ts:146-148`).
- `tooManyOffers(caps)` answers `{ buy, sell }` (:667-669, :702), batch 4's shape; `flexOffers.test` and `offersBulk.test` were ported to it.
- Audit rows: see finding 1 (the one place the two sides were not reconciled).

### (6) `take.ts` resolution

Seven hunks, all verified above: imports (`GIFT_CARD_TERMS_VERSION`, `recoveryHoldHidesSql`, `isGiftCard`/`tradeProfile`), `parseTake` with the optional `giftCardTerms` (:101-113), `OFFER_SQL`'s recovery-hold term (:145-149), the member boxes on `requireTrader` (:284), the gift-card check on the chosen method (:324-328), `tradeProfile` (:394), `insertTrade(…, giftCardTerms)` (:420). `paymentInstructions` is still held until secured: `trades/view.ts:141` `t.securedAt === null ? null : (ctx.paymentInstructions ?? '')`, fed from `trades/routes.ts:111` `row.method_instructions`; `flexOffers.test` M1b pins it.

### (7) No test weakened in the ports (compared against both parents)

- `offers.test` vs batch 4: every post goes through `flexBody` (the helper keeps a malformed body malformed, `helpers/offers.ts:10-13`); "while the feed is down" now asserts the list is empty **and** the detail shows `rate: null` (owner Q5, more than before); the two gift-card cases keep every refusal and add the two-method case; the fixed-price legacy row is inserted in 490's shape and still asserted kept. Vs flex-launch: `anon` reads became the signed-in bystander (the front door; `frontDoor.test` covers 401) and `too-many-offers` now asserts the caps. Nothing dropped without an equivalent.
- `flexOffers.test` vs flex-launch: the bystander has 20 trades, so headline-band expectations moved from +1% to +0.5% **and** a 0-trade viewer still asserts the +1% band; `viewerTrades` asserted as 20 instead of absent. Same coverage.
- `offersBulk.test`, `offerUnits.test`, `take.test`, `profiles.test`: the pre-cap fixtures are `insertOffer` rows in 490's shape with the same amounts; `profiles.test` consolidates the per-method confirm table into one test that still pins all 18 values and adds the pay-window and fallback cases. `take.test` adds the two-method case; the J-17 cases now name the method in the body, same assertions.
- `giftCards.test.tsx`: the form shape changed to J-16's; the T-081 assertions are the same plus the mixed-currency refusal and Panama.
- The one place a port was **missed** is `team.test.ts` (findings 1 and 2), and two fixtures in files the branch did not touch (finding 3).

## Findings

**1. Major (integration defect, not money). `apps/api/src/team/audit.ts` `offerTerms` reads `offers.currency, method_id, margin_bps, min_atomic, max_atomic, min_fiat_cents, max_fiat_cents` (:99-105), which migration 490 drops (`490_flex_offers.sql:134-141`).** `auditMember` calls it whenever `offerId` is passed (:139-141), which HEAD does for a member's relist (`offers/routes.ts:953`) and bulk switch (:1254), while post, pause and remove pass `detail: { offerId }` only (:899, :964, :971): the merge took flex-launch's calls for three routes and batch 4's for two, and kept batch 4's `audit.ts` untouched (empty diff vs `257e11b7`). Effect: a **team member's** relist by PATCH or by the bulk route is a 500 `internal` and the transaction rolls back (the owner is unaffected: `audit.ts:137` returns before the query). Proven: `team.test.ts:352-353` "an Offers-only member posts and turns off an offer" gets 500 on the member's bulk relist, and :448 "each effectful member action writes exactly one row" sees `['offer-posted', 'offer-paused']` without `offer-relisted`. Fix (engineering): rewrite `offerTerms` over `offers` + `offer_currencies` + `offer_tiers` + `offer_methods` (side, amount unit, each currency's bands, each method and adjustment), pass `offerId` from all five calls so every offer row carries the terms as review 2026-11-09 M2 of team-perms-port intended, and port `team.test.ts:451-453` (`terms`) to that shape (it also still says `maxFiatCents: '1000000'` while `OFFER` at :156 was lowered to `'500000'`). What the audit row records is the lead's call; the 500 is not.

**2. Minor (test port). `team.test.ts:1478` posts `OFFER` without `flexBody` → 400 instead of 201** ("no box can be stored that grants a hard owner-only ability"). Wrap it as the other eleven posts in the file were.

**3. Minor (test port, files the branch did not touch). Two fixtures insert pre-490 offer rows:** `holdV3.test.ts:1004` ("the held account's offers are not listed or taken") and `disputes/staff.test.ts:506` ("freezes a party who ignored the dispute"), both failing with `column "method_id" of relation "offers" does not exist`. Use `insertOffer` from `test/helpers/offers.ts`. The staff test's take body at :511-512 also lacks `methodId` and `currency`, so after the fixture port it would answer 400 (`parseTake`) instead of the expected 409 `trading-hold`; add `methodId: 'ZELLE', currency: 'USD'`. `schema.test.ts:74` and `offerMigrations.test.ts` insert the old shape on purpose (they run migrations up to a point before 490) and pass.

**4. Owner/lead question. The "$15 minimum" for gift cards is not in the code, the tests, `owner-decisions-2026-11-06.md` (F13, G50-G53, p4-3, p5-6), `giftCards.ts`, `giftCardCopy.ts` or `rulings-and-lessons.md`.** Nothing refuses a gift-card band or take below any amount beyond the band's own minimum. If this is a ruling I could not find, it is unbuilt (a card-method band minimum at post, checked in the card's currency, is a small change in `offers/routes.ts:845-857` plus the form); if it is not, drop it from the checklist. Recommendation: ask the owner once; do not block the landing on it.

**5. Note. `jabber.test.ts`'s 7 failures are batch 4's own**, as the handoff says: `PUT /v1/account/security/logout-timer` answers 404 (6 cases, e.g. :141) and `team_members.roles` no longer exists (:281). The merge touched no Jabber, team, auth or settings source (empty diffs), and the three dispute-trigger cases pass. Re-check after lead-land-4's fix lands under this branch.

**6. Low. Profile wording: HEAD keeps batch 4's text for the ten F9 profiles** (e.g. UPI "Payment ID (for example name@bank)", key `vpa`; SWIFT with a "Bank name and country" field), not launch-rules' (`upiId`, "Pix key", the PayPal/Venmo "pending is not yours" check prompts). Right side to keep, since batch 4 is main-to-be, but the launch-rules check prompts for PayPal and Venmo ("completed, not pending or on hold") said something useful that batch 4's do not. Copy item for the owner's wording pass, COPY-UNSIGNED either way.

**7. Low (carried, unchanged). review-flex-launch findings 1 (p11-126: post values the band's top at market, the take by the larger of total and market) and 2 (p11-95 card clamp), launch-rules R1 and owner question 1 (time to pay not on the quote screen), flex-offers I2/M4, and J-17 M3 (offers posted before 355 relist without the terms check) and M4 (range-card fact) are as they were.** `offerLaunchCapRefusal`'s relist default (`unpricedHidden = true`) is still the lead's p11-95 default at both call sites.

**8. Nit. `offers/routes.ts:1142-1146`: a live gift-card offer whose only currency lost its price shows `no-price`, and the take refuses `price-unavailable`;** fine, just noting the card currency rule gives such offers one currency in practice, so a single rate outage hides the whole offer. No action.

## Owner / lead questions

- **Q1 (finding 4).** Is there a $15 minimum on gift-card trades? Not found in any ruling or code. Recommendation: owner to confirm or drop; if confirmed, a band minimum of 15 in the card currency on card methods at post, owner page entry, COPY-UNSIGNED text.
- **Q2 (finding 1, lead).** What a member's offer audit row records under J-16 (side, unit, currencies with bands, methods with adjustments), since the single-row terms of review M2 no longer exist. Recommendation: all of it, from the four tables, in the action's transaction as before.

## Landing notes

- Fix finding 1 and port findings 2-3 on this branch before batch 5; re-run `team.test.ts`, `holdV3.test.ts`, `disputes/staff.test.ts`, then the whole `@x2f/api` project once.
- Then re-run `jabber.test.ts` after lead-land-4's logout-timer / abilities fix is merged under it (finding 5).
- Migration order and the schema lists are right: `120, 121, 122, 123, 124, 125 … 331, 332, 334, 345, 350, 355, … 490` in all three `schema.test.ts` lists; 125 reads `offers.max_fiat_cents` before 490 drops it; 355 adds `gift_card_terms` to `offers` before 490 recreates `trades_deal_fixed`.
- Deploy order unchanged (API before moderation).

## Re-verify 6afb56b8 (10 Nov 2026)

Re-verifier, independent, read-only on code. Worktree `/home/user/X2F/.claude/worktrees/flex-launch-4`, head `6afb56b8`, clean. Commits checked: `46d3ab5f` (red), `1c57e729` (fix), `6511971a`, `1ab7b831`, merge `8e34771a` (main `d421706c`), `6afb56b8`.

### Verdict: APPROVED

Finding 1 is fixed, findings 2 and 3 are ported, the merge is a clean union of both parents, and nothing is weakened. Findings 4-8 are unchanged (owner Q1, the $15 minimum, still open; finding 5 is now closed by the batch-4 fixes merged in, since the whole `@x2f/api` run is green).

### Runs (serialised runner, logs in `.../scratchpad/logs/`)

| Run | Result | Log |
|---|---|---|
| `apps/api/test/team.test.ts` + `apps/api/test/flexOffers.test.ts` | 2/2 files, 100/100 pass (70 + 30) | `rv4-api-022345.log` |
| `apps/web/test/quoteScreen.test.tsx`, `postOffer.test.ts`, `giftCards.test.tsx`, `quoteFocus.test.ts` (added: main's quote.css change meets flex's Quote.tsx) | 4/4 files, 108/108 pass | runner output |
| `npx tsc -p apps/api --noEmit` (src + test) | clean | - |
| `npx tsc -p apps/web --noEmit` | clean | - |
| Whole `@x2f/api` (lead's run, not repeated) | 102/102 files, 2442 pass + 1 todo | `fl4-api-021939.log` |

### (1) The audit row

- `team/audit.ts` `offerTerms` (`1c57e729`) reads only `offers.side, amount_unit, price_mode` (all three survive 490), then `offer_currencies` (by position), `offer_tiers` (`min_amount, max_amount, margin_bps, min_trades, method_ids`: range in the unit's minor units, margin, trade rule, method restriction, grouped under each currency), `offer_methods` (`method_id, adjust_bps`) and `offer_method_currencies` (`method_id, currency`, ordered by the currency's position). No `instructions` column is selected from either table that holds one, so payment instructions never reach `team_audit.detail` (jsonb, so the nested shape stores as is; `listAudit` returns `detail: unknown`). `fixed_cents_per_xmr` is no longer logged; 490's `offers_market_only` makes it always null, so nothing is lost.
- All five calls pass `offerId`: post `offers/routes.ts:900` (after all four child inserts, same transaction), relist `:954`, remove `:965`, pause `:972`, bulk `:1255`. `assertLiveMember` still runs first; the owner still returns before any query.
- The member's relist no longer 500s: `team.test` "an Offers-only member posts and turns off an offer" (member's bulk relist 200) and "each effectful member action writes exactly one row" (post, pause, relist each logged, each `detail` `toEqual` the J-16 terms, so no extra key such as instructions can be present) pass. The test's expected `max` is now `'500000'`, matching `OFFER`.
- Nit, no action needed: the audit test's offer has one currency, one band, one method and empty instructions, so the multi-currency grouping and the instructions exclusion are shown by reading the code, not pinned by a test. A two-currency, two-method member post with non-empty instructions in a later team test would pin both.

### (2) The merge 8e34771a

- `git show --remerge-diff 8e34771a` is **empty**: the commit is exactly git's automatic merge, with no hand resolution. The only file both sides changed since the base `257e11b7` is `apps/web/e2e/quote.spec.ts`, and the auto-merge keeps flex's `methodId`/`currency` take-body assertions and main's "no wallet yet" rename of the $50 phone test (hunks do not overlap).
- `git diff 1ab7b831 8e34771a -- apps/api/src/trades apps/api/src/offers apps/api/src/methods apps/api/src/team packages/trade data` is empty: the cap at post/relist/bulk/take, the growth ceiling, the per-method gift-card rules and the one `tradeProfile` table are byte-identical to what the review checked. `git diff d421706c 8e34771a -- apps/api/src/auth apps/api/src/team/abilities* apps/api/src/accountInactivity.ts` is empty: batch 4's front door, abilities, hold v3 and the 60-day Terms-signature erase come through untouched. The 15 files the merge brings over are main's 14 drift fixes only.

### (3) GET /v1/currencies behind requireInside

- `price/routes.ts:24` `preHandler: requireInside` (trader session, full, set up; member 'any'), same as `/v1/price`, `/v1/methods`, `/v1/offers`. Its only web caller is `PostOffer.tsx:161` via `post/api.ts:114`, a screen already behind the door, so no logged-out page breaks. `frontDoor.test` (`6afb56b8`) adds it to `READS`, so it is now checked logged out, half set up and on a recovery session, and its "READS covers every requireInside route" tripwire includes it; the same commit ports the file's offer post to `flexBody`. Correct.

### (4) Nothing weakened

- `6511971a`: one post wrapped in `flexBody`, assertion unchanged (201). `1ab7b831`: the two fixtures use `insertOffer` with the same side, range and minimum; the staff take adds only the two fields `parseTake` now requires, so the case still reaches and asserts 409 `trading-hold`; holdV3's method id became `ZELLE` (a real catalog id), assertion unchanged (404). `46d3ab5f` makes the audit expectation stricter (post and pause rows now carry the terms too). `6afb56b8` adds a route to the checked list. No test removed, skipped or loosened.
