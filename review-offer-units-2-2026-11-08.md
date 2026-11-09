# Review 2: origin/wip/lead-offer-units (offer units fixes, trust row, folded landing)

- Head reviewed: 001b32d52fae17b95b32193bcdacee991abc644b (worktree branch `ou` = origin/wip/lead-offer-units), `git diff origin/main...HEAD`
- Reviewer: independent (Opus), read-only worktree /home/flem/x2f/.claude/worktrees/agent-aadf6d1f426acccb2. Nothing changed.
- Prior review: review-offer-units-2026-11-08.md (H1, M1, L1, L2). H1, M1 and L2 are fixed as asked. L1 still stands (no change needed).
- Verdict: **CHANGES REQUESTED, three Important findings.** The server money path is sound: no trade can land outside the poster's range. I1 is a new web break: a taker of an XMR-set market offer can get "deal-mismatch" in the trade room. I2 lets a slow trader earn Fast. I3 shows Trusted at 100 trades, but the owner ruled 200+.

## What holds (verified)

- **The server re-checks every take.** take.ts:290-297: `lockRate` (409 if the price moved past the tolerance or the feed is down), then `rangeAllows(rangeOf(r), amountAtomic, lockedRate)`. For an XMR range this compares the atomic amount, so the rate doesn't matter. For a fiat range it compares the total at the locked rate. A rate change between quote and take can only refuse a trade at the edge (409 out-of-range); it can't let one through. Unit mixing is closed at three layers. `parseRange` refuses the other unit's keys. The DB `offers_amount_pair` requires exactly one pair. `rangeOf` reads `amount_unit`.
- **Rounding directions.** `rangeInBoth`: XMR to fiat rounds half up, fiat to XMR floors. Card `xmrBound`: min rounds up, max down, at 6 places. `switchUnit`/`convertBox`: min up (`divUp`), max down. Quote snap: when fiat is typed on an XMR range, the amount moves to the bound only when `fiatCents(bound) === typed`, so `rangeAllows` still decides. Max on the quote: XMR range, XMR unit gives the exact `xmrText(max)` (formatXmrExact). XMR range, fiat unit gives `fiatCents(max)`, which snaps to max. Fiat range, XMR unit gives `formatXmr(atomicForFiat(max))`, floored. Every one passes `rangeAllows` at the same rate.
- The quote now runs the take's own check, `rangeAllows`, at the rate now (quoteModel.ts:129-145), so the review M1 edge cases now agree. quote.test.ts covers them (29 pass).
- **Migrations.** 315, 324 and 325 are unique across every origin branch. The only others in 313-339 are 313/314 (wip/lead-sessions) and 316 (wip/lead-terms-signature). 315 drops the auto-named `offers_min_trades_check` (inline check in 102), maps the values down, then re-adds the check. 324 defaults existing rows to 'fiat', and 102's `max >= min` check passes on nulls. 325's new `trade_totals_counted` kind doesn't disturb 312's backfill, which filters `kind = 'completed'`. No other branch touches that constraint or the new table.
- **account_action_minutes.** No trade code, no date, no timestamp column. Capped at 20 by a CHECK; non-negative. The slice `(old || new)[greatest(1, card(old)+2-20):]` keeps exactly the last 20 (traderTrust "keeps the last 20" passes). Idempotent per trade through the `action-times` marker, which cascades with the trade. Written only on the transition to `released` with `settling='release'`, `dispute_by is null`, and both `paid_at` and a `release-started` event present. A release before "I've paid" adds nothing.
- % positive: 4-5 stars over 4-5 plus 1-2, floored. Neutral and 3 stars are left out. That matches `@x2f/reputation positivePct`. Overturned trades already erase their reviews (C12), so "every review counts" is right until Task 19.
- Badge visibility: `resolveVisibility(earned, {chosen:false})` follows the spec 5.4 defaults. New comes first; the API sends featured then more, and the card takes the first 2. Sound.
- Folded landing (MethodList.tsx): the methods with no live offers fold into one toggle with `aria-expanded`. Search is unchanged (the `q !== ''` branch). The API's `live` list isn't capped (methods/routes.ts:95), so nothing with offers gets folded under "No USD buyers right now".
- Tests run (4 files): packages/trade offerRange.test.ts 14/14, apps/web quote.test.ts 29/29, apps/web offerAmounts.test.tsx 21/21, apps/api traderTrust.test.ts 8/8 (under check.lock).

## Findings

### I1 (Important). XMR-set market offer: the taker's trade room fails with `deal-mismatch` whenever the locked rate differs from the quoted one
- apps/web/src/screens/quote/Quote.tsx:249 builds `deal.maxFiatCents = dealMaxFiat(o, ok.rate)`, which is `tradeFiatLimits` at the **quote's** rate. apps/web/src/screens/quote/useTake.tsx:101 then swaps in only `centsPerXmr: taken.centsPerXmr` and keeps that `maxFiatCents`. The server records `maxFiatCents = fiatCents(maxAtomic, lockedRate)` (take.ts:297, offerRange.ts `tradeFiatLimits`). The escrow runtime then requires `v.maxFiatCents === d.maxFiatCents` (apps/web/src/escrow/runtime.ts:272, checked at :476) and fails `deal-mismatch` before it makes or signs anything.
- Scenario: an XMR offer of 0.1 - 1 XMR at a market price. The taker's quote is at 1,500,033; the feed ticks and the server locks 1,500,034, which is within the 0.5% tolerance, so `lockedWithinQuote` passes. Server maxFiat = 1,500,034 and the device's = 1,500,033. The take succeeds on the server, then the taker's device refuses the trade, and a live trade is stuck until someone cancels. Any rate change of 1 minor unit with max >= 1 XMR changes the figure, so this happens whenever the feed moves between the quote and the take. Fiat-set offers are unaffected (their limits don't depend on the rate). So are fixed prices (the locked rate always equals the quote).
- Money is safe (nothing is signed), but trades break.
- Fix: in useTake, recompute the max at the locked rate. Either carry the offer's range in `TakeArgs`/the deal and set `maxFiatCents: tradeFiatLimits(range, {currency, centsPerXmr: taken.centsPerXmr}).maxFiatCents`, or have the take response return `maxFiatCents` and accept it only if it equals that local figure. Add a test: XMR offer, quote at R, take locks R+1, and the stored deal's `maxFiatCents` equals the server's.

### I2 (Important). Fast is worked out from the release list alone once a trader has 20 releases, so a slow payer earns Fast
- apps/api/src/traders/summary.ts:144-155 does `both = [...pay, ...release]`, then `typicalMinutes(both)`. `typicalMinutes` keeps only the **last 20** (packages/reputation/src/stats.ts:75), and those are all release samples once `release.length >= 20`. The two lists are just concatenated, not in time order, so "last 20" has no meaning across them anyway. `typicalSamples: min(both.length, 40)` also counts samples the median never sees.
- Verified with @x2f/reputation: 20 payments at 240 min and 20 releases at 1 min gives `typicalMinutes(both) = 1`, and `earnedBadges` returns `['trades-10', 'fast']`. The true median of both lists is 120. On that trader's buy ad the card says "Pays in ~240 min" next to a Fast badge ("Usually pays or releases within 10 min"). With fewer than 20 releases the window is still skewed toward releases. The role-less summaries (chat/routes.ts:287, 303) use the same `both`.
- Fix: P5-A8 says "over their last 20 completed trades", so keep one combined running list (add a kind such as 'any' to 325, appended once per trade for each side's own action), and use it for Fast and the role-less time. It isn't merged yet, so 325 can still change. The smaller fix: `median([...pay.slice(-20), ...release.slice(-20)])` with `typicalSamples` = that length. Add a traderTrust test with lopsided lists.

### I3 (Important). Trusted is earned at 100 trades; the owner ruled 200+
- Owner decisions (7 Nov, p5-3): "Trusted badge: 200+ trades and 98%+ positive." packages/reputation/src/badges.ts:28 has `TRUSTED_MIN_TRADES = 100` and :56 the meaning "100+ trades and 98%+ positive". apps/web/src/screens/browse/OfferCard.tsx:27 has the meaning "100+ trades, 98%+ positive". Until this branch nothing earned badges on a card. This branch makes `earnedBadges` live (summary.ts), so a trader with 100-199 trades shows Trusted in public against the owner's rule. The constant is 100 on main and on every wip branch, so no other branch fixes it.
- Fix: 200 in badges.ts, both meanings "200+ trades and 98%+ positive", and a badges test at 199 and 200. The meaning text comes from the owner's own words.

### M1 (Minor). Clean record from live rulings will turn into a false claim once the trade delete runs
- summary.ts `LOST_DISPUTES_SQL` joins `dispute_rulings` to `trades`. The comment admits that after the 30-day delete "it can only undercount". An undercount here means a trader with a lost dispute and 100 trades gets "100 trades with no lost disputes". No trade purge exists yet (nothing in apps/api/src deletes trades), so nobody sees this today.
- Fix: before the Plan 7 trade purge lands, either Task 20's `lost_disputes` running total must exist or `clean-record` must be withheld. Put that in the purge task's checklist. The default itself is sound: it takes the latest round, the seller loses release/send/return, and the buyer loses refund-to-seller.

### M2 (Minor). Switching units with equal or near-equal boxes gives smallest > largest
- offerForm.ts `switchUnit`: min rounds up and max rounds down. With CA$500 / CA$500 at 1,500,033 the result is 0.033333 / 0.033332, and the form then shows a min > max error the poster didn't cause. Not a money issue.
- Fix: if the converted min > max, set min = max (or convert both the same way when they started equal).

### M3 (Minor, owner rule P5-A8). Fast for a buyer measures the "I've paid" tap, not the payment
- A buyer who taps "I've paid" right after the escrow is secured and pays later records 0 minutes on every trade the seller releases. P5-A8 defines it this way, so this isn't the builder's bug. It is the one way to game Fast without a second account. Worth one line to the owner if Fast matters as a trust signal. % positive and Fast can otherwise only be inflated with self-trades between two accounts (each trade costs fees, and `reviewer_id <> subject_id` holds). That is a general sybil limit, not new here.

### M4 (Minor). One test assertion loosened
- apps/web/e2e/parity.spec.ts:351 changed `toEqual(['Bank transfer (ACH)'])` to `toContain(...)`, because PostOffer now has more exceptions. The why-length and stale checks still guard each entry. Pinning the exact list again would keep a new PostOffer exception from passing silently. All the other test edits follow intended behaviour (`badges: ['new']`, the minTrades choices, the v142 card strings, the owner-ruled orange selector) and none drops a check.

### Carried over
- L1 (prior review): growth after funding can pass `max_atomic` by under one minor unit. Unchanged; no change needed.
- Info (prior review): with the markup box off, the converted row is at market, so for a +margin fiat offer the XMR max shown is more than the take allows. That is the owner's rule, and the hint text says so.

## Strings added

Flagged COPY-UNSIGNED in code:
- "N more payment methods" / "N payment methods" (MethodList.tsx `allMethodsLine`)
- "Vendor markup" (OfferCard.tsx)
- "Display amounts including vendor markup" (owner's words; OfferList.tsx)
- "Converted at each offer's price, markup included." / "Converted at the market rate, before markup." (offerAmounts.ts `withMarkupHint`)
- "One unit for the whole offer. Traders see both, converted at your price." (offerForm.ts `UNIT_HELP`)
- "Enter an amount in XMR, like 0.5 or 2." (offerForm.ts `XMR_AMOUNT_ERROR`)
- "No minimum" (offerForm.ts)
- "Veteran · 3 years" / "Veteran · 5 years" and their meanings (OfferCard.tsx; already unsigned in @x2f/reputation)

New on screen but NOT flagged (should be flagged, or confirmed against v142):
- "Market rate · updated HH:MM UTC" (offerAmounts.ts `marketUpdated`, shown on Browse and Post an offer; comment says "anticipated from owner #3")
- "≈ $165.77 at your price (+0.5%)" / "≈ … at your price" under each range box (PostOffer.tsx `otherLine`), and the "≈ " prefix on converted rows
- The markup marks "+0.4%", "−$0.90", "0%" over "At market" / "Fixed price" (labels existed; the marks are new)
- "Releases in ~N min" / "Pays in ~N min" now appear with real data (strings already existed in copy)
- Trusted meaning "100+ trades…" must change to 200+ (I3)

## Re-verify 225cfd5a

- Head: 225cfd5a7878944221641b526e5268a3e0527d47 (worktree branch `ou` = origin/wip/lead-offer-units; confirmed, tree clean, nothing changed). Diff read in full: `git diff 001b32d5 225cfd5a` (3 commits, 16 files).
- Tests run (3 files): packages/reputation stats.test.ts 27/27, apps/web quoteScreen.test.tsx 31/31, apps/api traderTrust.test.ts 9/9 (under check.lock).
- **Verdict: APPROVED.** I1, I2, I3, M1, M2 and M4 are fixed as asked. One lead decision is left open on Fast (N1). It doesn't block the merge. One docs/design follow-up (N2).

### I1: fixed, same formula and same inputs as the server
- Device (useTake.tsx): `tradeFiatLimits(a.range, { currency: deal.currency, centsPerXmr: taken.centsPerXmr }).maxFiatCents`. Server (take.ts:290-297): `tradeFiatLimits(rangeOf(r), lockRate(...))`. It's the same @x2f/trade function, so the rounding is the same: `fiatCents` half up, and the max is never below the min, which is at least 1.
- Same rate: the server returns `trade.lockedRate.centsPerXmr`, which is the `now` that `lockRate` returned, and the device uses exactly that figure. `fiatCents` uses only `centsPerXmr`, so the currency field doesn't affect the result.
- Same range: `quoteRange(o)` reads the poster's own pair. The API sends that pair exactly (`amountsOf`, from `rangeOf`), and api.ts parses it to bigint. Offer ranges can't change after posting: `PATCH /v1/offers/:id` only sets the status. So the device's range is the server's range.
- The +0.5% tolerance: `lockedWithinQuote` still runs first. A locked rate past 0.5% (or any change on a fixed price) is refused before the deal is built. Inside the tolerance, the max now follows the locked rate rather than the quoted one, which was the bug. Fiat-set offers are unchanged: `tradeFiatLimits` returns their own max.
- `range` is a required field of `TakeArgs`, and Quote.tsx:402 is the only caller. The new quoteScreen test (quote at 1,500,033, lock at 1,500,034, max 1 XMR) expects 1,500,034, so it would have failed before the fix.

### I2: fixed as specified. Residual question N1 for the lead
- `bothRolesTypical` takes the median of `pay.slice(-20)` and `release.slice(-20)` together. `samples` is exactly that length, the count the median used. The role-less path and Fast both use it, and the role views still use their own list. Tests cover the 20/20 lopsided case in both orders, including through the API.
- **Your example** (1 payment at 240, 20 releases at 1): median of 21 is 1, so Fast. I think that is acceptable. One slow payment in 21 actions is "usually within 10 min". The buy card shows no "Pays in" line, because 1 is fewer than `TYPICAL_MIN_SAMPLES` = 3.
- **A minimum sample per role would be wrong.** It would deny Fast to sell-only traders, who never pay, and they are the main case for Fast.
- **N1 (Minor, a user-facing rule, so the lead's call or the owner's):** a contradiction still appears on the card with 3 to 19 slow payments and 20 fast releases. With 3 payments at 240 and 20 releases at 1, the median is 1, so Fast. But `typicalMinutes(pay)` = 240, so that trader's buy ad says "Pays in ~240 min" next to a Fast badge that reads "Usually pays or releases within 10 min". A guard that would fit: Fast also needs every role with at least `TYPICAL_MIN_SAMPLES` samples, meaning any role whose time shows on a card, to have its own typical time at or under 10. This isn't gaming: the fast releases are real trades with fees. It's an honesty question about what the card displays. It isn't a money or security issue.

### I3: fixed. 200 everywhere in code and tests
- badges.ts `TRUSTED_MIN_TRADES = 200` with the owner's quote, and the meaning reads "200+ trades and 98%+ positive". OfferCard.tsx has the same meaning. Badge tests run at 100, 199 and 200, and the R38 and M4 tests moved to 200. `git grep` finds no 100 threshold or "100+" Trusted text left in apps/ or packages/.
- **N2 (docs/design follow-up, not code):** these still say Trusted at 100+: HANDOFF.md:77, docs/superpowers/specs/2026-10-14-x2f-design.md:474, plan-5-reputation.md:234 and :236, and design/x2f-app BadgeSettings.dc.html:103, BuyOffers.dc.html:54 and SellOffers.dc.html:54. The lead should update the spec and plan lines, and design should update the boards. If a parity test ever checks the Trusted meaning, the boards will disagree with the code.

### M1, M2, M4
- M1: the tripwire comment `NEEDS_TASK_20_LOST_DISPUTES` is in summary.ts, and docs/coordination.md says the purge must not land before Task 20's running total. That is what was asked.
- M2: if the converted min > max, max is set to the min. This only fires when the two cross, so the range still never grows past what the poster set except by that one rounding unit at the crossing point. Tested both ways: fiat to XMR CA$500/500 gives 0.033333/0.033333 and no min error, and XMR to fiat gives 1500.04/1500.04.
- M4: parity.spec.ts:353 pins `toEqual(['Bank transfer (ACH)', 'Anyone', '5+', '10+', '50+', '$50 – $2,000'])`. That is the exact order and content of parity.ts `KNOWN_EXCEPTIONS.PostOffer` (lines 194-206). I didn't run the e2e.
- The strings that weren't flagged in review 2 are now marked COPY-UNSIGNED (PostOffer `otherLine`, `APPROX`, `otherUnit`, `marketUpdated`, the markup marks).
