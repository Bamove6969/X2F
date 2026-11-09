# Money-path review: `wip/lead-flex-launch` @ 9909121f (9 Nov 2026)

Reviewer: independent money-path reviewer, read-only on code. Worktree `/home/user/X2F/.claude/worktrees/flex-launch`, head `9909121f`, clean. Commits reviewed: `814776d5` (merge of flex-offers `513370d1` and launch-rules `fb99c0de`, 20 conflicts, the launch cap rewritten in `apps/api/src/trades/launchCap.ts`) and `9909121f` (6 cap tests in `flexOffers.test.ts`). Prior reviews read: `review-flex-offers-2026-11-09.md` (I3: this merge is a logic rewrite) and `review-launch-rules-2026-11-09.md` (F1 growth ceiling, F2, migration 125).

The container restarted at about 23:10 while this review was being written; every test run and both typechecks had already finished and their logs survived (paths below), the worktree head was unchanged, so nothing was re-run.

## Verdict: APPROVED WITH MINOR

No money-safety defect. The $5,000 cap is applied at every write path to `offers.status` and at the only take entry; the band's top edge is valued exactly as the take values the trade's XMR (same quote, same rounding, never under-valued); growth is clamped to the cap at the take's own prices; the take uses the chosen currency's quote and the chosen method's profile; the written-once trade terms hold; the conflict resolutions keep both sides' behaviour; the two fixture changes weaken nothing; the migrations are in order. The two Minor findings are both "a band can advertise more than a take allows" cases that fail closed at the take, and one of them is the owner question p11-95 the builder already marked.

## Tests run (serialised runner, this worktree; logs in `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/logs/`)

| Run | Result | Log |
|---|---|---|
| `apps/api/test/flexOffers.test.ts` | 30/30 pass | `rvFL-flexOffers-230840.log` |
| `apps/api/test/take.test.ts` | 52/52 pass | `rvFL-take-230847.log` |
| `apps/api/test/offers.test.ts` | 37/37 pass | `rvFL-offers-230857.log` |
| `apps/api/test/offersBulk.test.ts` | 18/18 pass | `rvFL-offersBulk-230906.log` |
| `apps/api/test/schema.test.ts` | 74/74 pass | `rvFL-schema-230913.log` |
| `apps/web/test/quoteScreen.test.tsx` | 36/36 pass | `rvFL-quoteScreen-230922.log` |
| `npx tsc -p apps/api --noEmit` | clean (exit 0) | `rvFL-tsc-api-230951.log` |
| `npx tsc -p apps/web --noEmit` | clean (exit 0) | `rvFL-tsc-web-230957.log` |

Not run (job scope): Playwright, `packages/trade`, moderation. The builder's red run for the 6 new tests is claimed in the commit message (`scratchpad/logs/flex-launch-RED-flexOffers-*.log`); I did not reproduce it.

## The seven checks

### (1) `bandTopUsdCents` values an XMR band exactly as the take values XMR

- `launchCap.ts:48-53`: for an XMR band, `usdCentsOf(fiatCents(maxAmount, q.price), { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr })` with `q = prices.quote(currency)`.
- `take.ts:168-173` (`usdValue`): the market leg is `usd(fiatCents(amountAtomic, q.price))` where `usd` is the same `usdCentsOf` call with the same `q = deps.prices.quote(b.currency)` (`take.ts:369`). Same formula, same quote object.
- Same source: `market.ts:107` defines `current(currency)` as `quote(currency)?.price`, so `lockRate`'s `prices.current` and the cap's `prices.quote` cannot disagree.
- Rounding direction: `fiatCents` is half-up (`money.ts:55-59`), then `usdCentsOf` rounds up (`stage.ts:134-137`, `(x*usd + cents - 1)/cents`). The band's top is never under-valued relative to the take: the band at `maxAmount` gives exactly the take's market leg for a take of `maxAmount`.
- Units: an XMR `Tier.max` is atomic (`flexOffer.ts:84-90`, `ATOMIC` edge regex at :97, `bandsToTiers` keeps XMR edges as typed at :178); a fiat `Tier.max` is minor units (`:179-186`), and `usdCentsFor` (`launchCap.ts:34-39`) treats it as such (USD: the cents themselves; other: `usdCentsOf`). At post the cap sees `o.currencies` from `parseNewOffer` (already `bandsToTiers`, `routes.ts:627`); at relist and bulk it sees `loadFlex`'s tiers (`routes.ts:355-358`, `max_amount::text`). Same unit both ways.
- The take values the trade as the LARGER of the total at the locked rate and the XMR at market; the band check uses only the market leg (see finding 1).

### (2) Every write path to `offers.status`, every take entry

Grep of the whole repository (`update offers`, `insert into offers`, outside tests):

| Path | Where | Cap |
|---|---|---|
| Post (`status = 'live'` on insert) | `offers/routes.ts:845-847` | `offerLaunchCapRefusal(o.unit, o.currencies, prices, false)` inside the posting transaction, after `assertMayPost`, before the insert. Fails closed on any unpriced currency. |
| PATCH `/v1/offers/:id` to `live` | `offers/routes.ts:907-932` | `loadFlex` under the account lock, then `offerLaunchCapRefusal(..., true)` at :929, before the `update` at :930. |
| Bulk `POST /v1/account/offers/status` to `live` | `offers/routes.ts:1189-1224` | per offer at :1211 after methods, account guards and caps; refused offers are not in `switched`, and only `switched` is written at :1221. |
| PATCH to `paused` / `removed`, bulk to `paused` | same two statements | no cap (correct: turning off). |
| Migration 125 | `125_launch_cap_offers.sql` | pauses live USD offers with `max_fiat_cents > 500000` (runs before 490 drops the column). |
| Migration 315 | `update offers set min_trades` | not a status write. |

Take entries: exactly one route, `POST /v1/offers/:id/take` (`take.ts:281`), and `insertTrade` has exactly one caller (`take.ts:408`). The cap is `assertWithinLaunchCap(usd)` at `take.ts:374`, after the starter caps, on the same `usd` (null → `price-unavailable`), for every stage. Then `growthCeiling` at :376.

Tests pinning this: `flexOffers.test` "posting: every band's top edge…" (second currency over → whole offer refused, 5,001 of a 1:1 currency refused, 16 XMR refused at a $330 market), "posting fails closed…", "relisting checks every band again…" (PATCH and bulk, EUR moved 0.9 → 0.818), "the bulk switch judges each offer on its own", and `take.test` "the launch cap" block ($5,000.00 exactly passes, one atomic unit more refuses; −50% margin counts the XMR at market; EUR from a pre-cap offer). `offers.test` / `offersBulk.test` launch-rules cases ported to the J-16 shape (a pre-cap offer inserted as 490 moved it; €4,500 exactly relists).

### (3) The take: chosen currency's quote, chosen method's profile, stored terms, ceiling

- Currency and method: `take.ts:313-316` requires `b.currency` to be one of the offer's currencies and `b.methodId` one of its methods offered in that currency (400 otherwise). `lockRate(b.currency, pick.tier, method, …, prices)` (:358) prices the band + method in that currency; `q = deps.prices.quote(b.currency)` (:369) feeds both `usdValue` and `growthCeiling`. One quote, the chosen currency's.
- Method profile: `profileOrFallback(method.methodId)` (:382), `confirmWindowMin` and `payWindowMin` on the trade (:393-394), written by `insertTrade` (`store.ts:228-229`), set-once by 112's `trades_deal_fixed` (confirm) and 124's trigger (pay). `take.test` "fixes the payment method's time to pay…" pins SWIFT 180/4320, CHIME → Custom 180/1440, and the `23000` refusal.
- What the buyer saw: `GET /v1/methods` answers `payWindowMin` and `upToMin` from the same `profileOrFallback` (`methods/routes.ts:96-100`); My offers shows each method's `payWindowMin` from it too (`offers/routes.ts:1105-1108`). So the stored windows come from the same table the client is shown. The quote screen itself does not display the time to pay (launch-rules owner question 1, unchanged here).
- `minFiatCents`/`maxFiatCents`: the server stores `tradeFiatLimits(tierRange(unit, pick.tier), rate)` (:362-365), the band the server picked; the web's deal takes `tradeFiatLimits(a.range, lockedRate)` of the band the quote showed and clamps to the server's `maxFiatCents` (`useTake.tsx:116-119`). If the server picked a different band (the 0.5% tolerance case of flex-offers M2) the attested deal mismatches and fails closed: that is the pre-existing design, not changed by the merge.
- `growthCeiling` (:190-209) clamps `limits.maxFiatCents` to the largest total within the cap by `usdValue` at the take's quote; never below the take's own total (R1 of the launch-rules review, unchanged). `flexOffers.test` "taking: the trade's USD value…" pins the EUR case: €4,400 refused, €4,000 taken, ceiling 409090 answered and stored (€4,090.90 = $5,000.00 at 1.2222, rounded up to the last cent within).

### (4) Relist with `unpricedHidden = true` (OWNER QUESTION p11-95)

Scenario: a two-currency offer (PLN priced, EUR unpriced) relists; the PLN bands pass, EUR is skipped (`launchCap.ts:86-94`: `unpriced < currencies.length` → null). The EUR rate returns and the EUR band's top is now over $5,000.

- The offer is live and the EUR card lists it with the band's full range (`LISTED` only needs a market price, `routes.ts:286`).
- What refuses the trade: the take, at `take.ts:374`, for any trade whose `usdValue` is over $5,000, in whatever currency; and `growthCeiling` caps growth of a smaller trade at $5,000. Nothing else does. The test "OWNER QUESTION p11-95…" covers the relist and the re-listing when the rate returns; the over-cap take in that exact state is not in that test, but the next test ("taking: …") sets up the identical state (posted at 0.9, EUR strengthened to 0.818, €4,400 over) and proves the refusal with no trade row.
- Abuse: the poster gains nothing. No trade above $5,000 can start or grow. The cost is on takers, who see a range the take will not honour above the cap (finding 2).
- The all-unpriced case fails closed (`price-unavailable`) in PATCH and bulk; tested.

### (5) Conflict resolutions keep both sides

- `trades/take.ts` (diff vs `fb99c0de`): launch-rules' `assertWithinLaunchCap`, `usdValue`, `growthCeiling`, `profileOrFallback` windows and the `maxFiatCents` answer are all present; flex-offers' `pickTier`, `tierRate`-based `lockRate`, `rangeAllows`, `tradeFiatLimits`, `instructionsFor` and `MARKET_PRICED` are all present. The only semantic change from either parent is the intended one (`offerMaxCents: limits.maxFiatCents`, the band's maximum).
- `offers/routes.ts`: the three launch-rules cap calls are replaced one-for-one by `offerLaunchCapRefusal` (post :845, PATCH :929, bulk :1211); `OfferSwitchRefusal` keeps `launch-cap` / `price-unavailable` and adds flex-offers' `not-vendor`. No other cap-related line was dropped.
- `trades/view.ts`: `paymentInstructions: securedAt === null ? null : …` (:120, flex) and `payWindowMin` (:154, launch-rules) both present; `finalAlertAt` / `finalAlertSeenAt` gone (launch-rules' removal). `trades/routes.ts` passes `paymentInstructions: row.method_instructions` (:104) and the `final-alert-seen` route is gone (:115). `events/finalAlert.ts` is deleted; the remaining mentions in `apps/api/src` are comments, `store.ts`'s `TradeRow` type (the columns still exist, 120 says they are no longer read or written) and moderation's `reviveShadow` drop of the retired field. `teamCopy.ts` keeps the label for old audit rows.
- `web quote/useTake.tsx`: `maxFiatCents = min(taken.maxFiatCents, tradeFiatLimits(a.range, lockedRate).maxFiatCents)` (:116-119): flex-offers' recomputation at the locked rate and launch-rules' clamp to the server's ceiling, both kept. `quoteScreen.test` 36/36.
- `alerts.ts`: union of both sides' alert kinds (`became-vendor`, `auto-close-capped`, `dispute-refund-after-ruling`).

### (6) The two fixture changes

- `take.test.ts` `body(who, amount, centsPerXmr, over)`: the 4th argument lets the launch-rules test name the offer's method (`{ methodId: 'SWIFT' }`, `{ methodId: 'CHIME' }`, `{ methodId: 'SBP' }`), which the J-16 take body must carry (the default is `ZELLE`, the fixture offer's method). Necessary, and the assertions (180/4320, 180/1440, the `23000` refusal, `method-unavailable`) are unchanged. Other edits in that file follow the cap: the fixture offer's maximum is $5,000 (was $10,000), the Graduated take is 15 XMR ($4,950) instead of 100 XMR, the euro test's maximum €4,500; each still asserts what it did. "€4,500.01 is over" became "€4,501 is over" because J-16 band edges are whole units: still the smallest expressible step over the cap.
- `team.test.ts` re-login: the launch-rules side moved the member's dispute to after "I've paid" plus the 2-hour confirm window (p11-16), `setNow(dp.confirmBy!)` jumps the clock 2 hours, and `UNCHOSEN_SESSION_HOURS = 2` (`packages/accounts/src/sessionLength.ts:38`) ends the member's session exactly then, so the test logs the member in again before opening the dispute. The audit assertions (`dispute-opened`, `appeal-filed`, no private note in `detail`) are unchanged; the `final-alert-seen` row and route scan entry are gone with the feature. Not a weakening.

### (7) Migrations 120/121/124/125/490 and the schema lists

- Files present: `120_cancel_reversal.sql`, `121_confirm_window_days.sql`, `122_chat_retention_disputes.sql`, `124_pay_window.sql`, `125_launch_cap_offers.sql`, `490_flex_offers.sql`. No 123 (chat-shred-2's), no duplicate numbers.
- All three `schema.test.ts` lists (lines 46, 156, 232) carry `120, 121, 122, 124, 125 … 345, 490` in that order.
- Order matters and is right: 125 reads `offers.currency` and `offers.max_fiat_cents`, which 490 drops (`490:134-141`); 490's backfill (`490:118-126`) copies the paused pre-cap offer's range into its one band exactly (`max_fiat_cents` → `max_amount` in minor units), so the relist refuses it until the poster posts a smaller one (bands are written once). 124 adds `pay_window_min` and its trigger before 490 recreates `trades_deal_fixed` with `method_instructions`; both triggers exist on the final schema (take.test proves the pay-window one, flexOffers.test the deal one).

## Findings

**1. Minor (owner question A). Post and relist value a band's top edge at the market rate; the take values a trade by the larger of its total at the locked rate and its XMR at market.** A band that passes the cap at post can have an untakeable top:
- a sell offer at −50% (margin + adjustment) with a fiat band to $5,000: a $2,501 take moves XMR worth $5,002 at market → 409 `launch-cap`; everything above about $2,500 of the advertised band is refused;
- a sell offer at +50% with a 15 XMR band ($4,950 at market): a 15 XMR take totals $7,425 → refused.
Where: `launchCap.ts:48-53` vs `take.ts:168-173`. Fails closed, so no money risk; it is the same asymmetry launch-rules had for fixed prices. But the poster is never told and takers hit `launch-cap` on amounts the card advertises. Recommendation: at post and relist, value the top edge by the take's own rule for each method that applies to the band (fiat band: `max(top, XMR at market that `top` buys at that band+method rate)`; XMR band: `max(XMR at market, total at that rate)`), so a posted band is takeable to its top. That narrows what posters may post at large margins, hence an owner/lead call. Add a test either way (a −50% band to $5,000 at post).

**2. Minor (owner question B, the builder's p11-95). A relisted offer with a hidden unpriced currency advertises a band the take will not honour once the rate returns.** As in check (4): the take refuses and the ceiling clamps, so no trade exceeds $5,000, but the card and the quote show the full band until the poster pauses. The same is true of any live non-USD offer after a rate move (migration 125 pauses USD only, acknowledged in the file) and of a live offer whose rate moves while it is listed. Recommendation: either (a) the lead's default stands and the list clamps the displayed maximum to the cap at the card's rate (a copy/design item, COPY-UNSIGNED), or (b) a relist fails closed on any unpriced currency (flip the two `true` call sites and the test named for it, as the code comment says). I would keep (a) plus the default: a poster with one dark currency should not lose the others. Not a landing blocker.

**3. Low. `bandTopUsdCents`'s XMR edge is not pinned at a one-cent boundary.** The post test uses 15 vs 16 XMR ($4,950 vs $5,280); the take's "$5,000.00 exactly / one atomic more" test pins the take's rounding, and the two share the formula, so this is a test gap, not a defect. Optional: post an XMR band whose top is `(XMR * 500_000n) / 33_000n` (passes) and `+1n` (refused).

**4. Low. `offers.test`'s ported relist case no longer edits `max_fiat_cents` in place** (it posts at 0.9 and moves the rate), which is the right port since bands are written once; the "exactly $5,000 relists" edge is kept via `insertOffer` at 450,000 minor units of a 0.9 currency in `offersBulk.test`. No action.

**5. Nit. `store.ts:77-79` `TradeRow` still names `final_alert_at` / `final_alert_seen_at`.** The columns exist (103, 105; 120 says they are no longer read or written) and `select *` returns them, so the type is accurate. Drop them when the columns go.

**6. Note (carried over, not this merge's).** Launch-rules R1 (the ceiling's sub-cent floor at an extreme rate), launch-rules owner question 1 (the time to pay is not in the device-confirmed deal and not on the quote screen), flex-offers I2 (retention of `trades.method_instructions`, p11-94) and M4 (the web shows `paymentInstructions` nowhere) are unchanged by the merge.

## Owner questions, with recommendations

- **A (finding 1).** Should a band's top edge be judged at post by the take's rule (so every advertised amount is takeable), which stops a poster at a large margin from posting a $5,000 band? Recommendation: yes; it only removes bands nobody can take, and it keeps the card honest.
- **B (finding 2, = the builder's p11-95).** A relist with one unpriced currency: relist the priced ones and hide the dark one (lead default, in code and test), or fail closed? Recommendation: keep the default, and have the card clamp the shown maximum to the cap at today's rate (design/copy), so what a taker sees is what the take allows.

## Landing notes

- Land this in place of flex-offers `513370d1` and launch-rules `fb99c0de` (the merge contains both). After it, revert `967ac03c` (and `b28b6291`) before landing Jabber, as the launch-rules review said.
- Deploy order unchanged (API before moderation; wipe dev `signed_terms` / `mod_trade_desk` rows).
- Copy: the `launch-cap` and `price-unavailable` refusals already map in `apps/web/src/ui/cantDoCodes.ts`; any card clamp from B needs COPY-UNSIGNED text.
