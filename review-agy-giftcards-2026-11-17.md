# Review: wip/agy-giftcards @3dbdb630 (agy Job 11) — 17 Nov 2026, claude3

Branch: `origin/wip/agy-giftcards` 3dbdb630, one commit on wip/third-demo-r3 b1172d63 (one commit behind the tip, 94337781).
Order: AGY-ORDERS-2.md Job 11 ("Top 30 + Home Hardware + Canadian Tire + Other ... make the list match, UI/data only,
with tests"). Owner text checked: owner-decisions-2026-11-06.md p5-6 (line 105), p4-3, G50-G53, F13; the Team Room relay of
12 Nov (MIR, SBP, YooMoney and Capitual removed at launch; gift-card methods priced only in the card country's currency).

## VERDICT: APPROVE WITH MINORS

The whole diff is one line in a demo/e2e fixture: `apps/web/src/fixtures/boards.ts:149`, `AMAZON_GIFT_CARD` in
`BOARD_BUY_LIVE_USD` goes from `giftCard: false` to `giftCard: true`. That is correct: the real catalogue
(`data/payment-methods.json`) already marks it `giftCard: true`, so the fixture now says what `/v1/methods` would send.

Scope is safe:
- Nothing in packages/trade, apps/api, data/, pricing, fees, escrow, payouts or the trade state machine changes. No migration,
  no method id change, no rename. Existing offers and methods are unaffected (the file is only imported by e2e specs and web
  tests; bundle.test.ts keeps it out of production builds).
- The browse screens do not read `giftCard` for display, so the flip changes no rendered output; the post form (the only
  reader) uses the method list from its own stub.
- The brand list itself already matched the owner's p5-6 text before this branch: J-17 (wip/second-gift-cards ed3ceecf, merged)
  put exactly 32 brands + Other in `data/payment-methods.json` (Amazon ... Target, Home Hardware, Canadian Tire, Other; no
  Razer Gold, no PaysafeCard), and `apps/api/test/profiles.test.ts:169-182` pins that list, its count (33) and the 45-minute
  window. I checked the 33 names one by one against p5-6: same brands, same order.
- Card-country currency (12 Nov relay) is enforced by `giftCardCurrencyOk` (offerForm.ts:657, API post/take); untouched here.
  The fixture puts Amazon on the USD board, which is consistent with a US card.

## Minor

**M1. The commit message and READY line say more than the branch does.** Commit "feat(trade): gift card brand list matching
owner decision" and the to-lead.log READY line ("32 + Other, Razer Gold dropped") read as if this branch built the list. It did
not: the list was J-17's, and this branch only fixes one fixture flag; nothing in trade code changes.
Fix (no force-push, no amend): post the FIXED line as "wip/agy-giftcards: catalogue already matched owner p5-6 (J-17, pinned by
apps/api/test/profiles.test.ts:169); this branch only corrects the board fixture's AMAZON_GIFT_CARD giftCard flag", and use
`test(web)`/`fix(web-fixtures)` style prefixes for fixture-only commits in future.

**M2. No test for the change (the job said "with tests").** Nothing fails if a fixture row's `giftCard` drifts from the
catalogue again. Fix: add a case to `apps/web/test/boards-fixture.test.ts`: read `data/payment-methods.json`, and for every
row of `BOARD_BUY_LIVE_USD` and `BOARD_SELL_LIVE_USD` expect `row.giftCard` to equal `catalog.find(m => m.id === row.id)?.giftCard === true`
(and expect each id to exist in the catalogue).

## Notes for the lead (not agy's to change)
- `CAPITUAL` is still in `data/payment-methods.json` on wip/third-demo-r3 although the 12 Nov relay removes it at launch
  (MIR, SBP, YOOMONEY are already gone). Catalogue/money-adjacent data: lead or claude2, not agy.
- The catalogue says "Esso and Mobil gift card" where the owner's p5-6 list says "Esso" (J-17, T-057). Leave it unless the owner
  wants the shorter name; if anyone asks, it is an owner wording question, not a fix.

## Checks (fresh detached worktree /home/user/rv3-giftcards @3dbdb630, npm ci, node 24)
- typecheck: 0 errors (20 workspaces)
- copy-lint: clean; separation-check: ok
- vitest packages/trade: 19 files, 502/502 passed
- vitest apps/api (Docker Postgres; offers, methods, profiles, take, flexOffers, offerMigrations, offersBulk, schema): 8 files, 316/316 passed
- vitest apps/web full: 2220 passed, 4 failed (153 files). None caused by this branch: tour.test.tsx x3 timed out under parallel
  load and pass when run alone; serve-boards.test.ts "BuyMain/Main board changed since refs" also fails on the tip of
  wip/third-demo-r3 (pre-existing).
- Playwright (browse-buy, offer-units, post, quote; the specs that use BOARD_BUY_LIVE_USD or gift-card methods): 83 passed, 1 failed:
  post.spec.ts:466 "trade size in XMR by default" (weight 500 < 600). Pre-existing at this branch's base b1172d63 and fixed on
  the tip by 94337781 (DM Mono's heaviest face is 500); not related. A first attempt collided with another reviewer's run on
  port 4317 and was discarded. design-shots.spec.ts (screenshot pack) not run.
