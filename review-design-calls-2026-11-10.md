# Review: wip/lead-design-calls (design's final calls, Jetpost 10 Nov 01:38)

Reviewer: independent helper, read-only on code. 10 Nov 2026.
Branch: origin/wip/lead-design-calls, worktree .claude/worktrees/design-calls, four commits on main d421706c:
32c48a4e (one price wording, ui/margin.ts), de7871ac (staff News preview = trader NewsPost),
b5452852 (CancelFinalSheet unfunded variant), 5eae9952 (courtesy sheet over the trade room).

## Verdict

READY TO LAND, with no blocker. One copy question needs the owner or design (F1, the "Already paid?"
sentence). It is not new to this branch, but this branch makes it more visible. The other findings
are low and can follow later.

## What ran

- vitest @x2f/web, 15 files, 412/412 passed: margin, bands, browse, browse-buy, browse-tripwire,
  quoteScreen, tradeRoom, tradeRoom-tripwires, tradeFund, buyerPay, news, news-tripwire, myOffers,
  offerAmounts, postOffer.
- vitest @x2f/staff-web, screens + oneDoor, 24/24 passed.
- `tsc --noEmit` for apps/web and apps/staff-web: clean.
- `npm run copy-lint`: clean (apps/web/src, apps/staff-web/src).
- Not run: Playwright (myOffers, post, quote, browse-buy and offer-units specs, and the parity
  checks). The branch edits them, but nothing here executed them.

## (1) margin.ts

- The maths is right. Everything is whole-number work on basis points: `Math.trunc`, `/100` with
  `floor`, `%100`, then trailing zeros are trimmed. No float division, so no rounding error and no
  rounding direction to get wrong (2 decimals of a bps integer is always exact).
- Results at the boundaries: 1 → "0.01% above market"; -1 → "0.01% below market"; 50 → "0.5% above
  market"; 9999 → "99.99% above market"; -5000 → "50% below market"; 0 and -0 → "at market" (`=== 0`
  catches -0). The sign never shows: the words carry the direction.
- Low (L1): `!Number.isFinite(bps)` returns "at market", so NaN or Infinity would read as a real
  price. This cannot happen today: every source is an integer (browse/api.ts parses marginBps,
  offerForm.marginBpsOf builds it from digits, the stored draft is checked with Number.isInteger).
  It would still be safer for a non-integer or non-finite value to render nothing (or throw in dev)
  than to claim "at market". A fractional bps such as 0.5 would read "0% above market". Again
  unreachable.
- Coverage: grep of apps/web/src and apps/staff-web/src for marginBps, markup, above/below/at
  market, `%` renders and toFixed. The only margin renders left are OfferCard.markupOf,
  QuoteBands, PostOffer (both the "margin reads" line and the other-unit line) and
  myoffers/model.offerPrice, and all four go through ui/margin.ts. The old formatters are deleted:
  bands.marginText, bands.markupText, offerForm.marginText and offerForm.marginWord. No margin
  render is left in staff-web or in the trade screens. "Vendor markup" survives only in the browse
  toggle "Display amounts including vendor markup", in the quote's "With markup / Without" chips,
  and in tradeTerms ("shown with or without the vendor's markup"). These are toggle labels, not
  margin renders, so they are outside the call. Design may want to know they remain.
- Behaviour change worth noting: on the offer card, `favourable` is now `bps !== 0 &&
  copy.favourable(bps)`, which is the same as before because 0 was never favourable. The escrow tone
  stays on the figure only.

## (2) Staff kit door / NewsPost

- kit.ts adds one door, `export { NewsPost } from '../../../web/src/screens/NewsPost.js'`.
  NewsEditor imports NewsPost from `../ui/kit.js` only. The one-door tripwire still passes, and the
  new oneDoor tests pin all three things: the kit's door, the editor's import, and News.tsx
  rendering the same module.
- NewsPost.tsx imports only ui/icons, ui/When (which pulls in only ui/dates and ui.css) and the
  NewsItem type. It has no API client, router, session or trader store. It renders only the
  `item` it is given: title, body, publishedAt and editedAt. No trader-only data reaches staff-web.
  The `.x2f-post` styles are in ui.css, which comes with the component, so the staff app shows
  them without changing its main.tsx stylesheet list.
- Low (L2): duplicate DOM ids while editing. The preview uses `id: editing?.id`, so when the owner
  edits item 7, both the preview (NewsPost) and the published row (NewsMessage) carry
  `id="news-7-title"`, and the preview also carries `news-7-body`. The two `aria-labelledby`s then
  resolve to one element. This was already true of the old NewsMessage preview. Fix: give the
  preview a distinct id (for example `preview`), or prefix the ids in NewsPost with useId.
- Low (L3): the preview is not quite what traders will see. While editing, the preview passes
  `editedAt: null`, but after the save traders see "Updated <date>". For an exact "As traders will
  see it", pass `editedAt: editing ? now : null` while editing. This is a small fidelity point,
  not a data issue.

## (3) CancelFinalSheet unfunded variant

- `nothingHeld(view)` = state in {setup, funding} and `receivedAtomic` is not a positive integer.
  Both values come from the server's TradeView (api/trade.ts validates `receivedAtomic` as an
  amount string), so the variant is not a client guess. A part-funded trade (0.6 XMR received)
  keeps the held version with the received figure, and tradeFund.test pins that. Once the trade is
  secured (BuyerPay), it is never the unfunded line, and buyerPay.test pins that.
- Low (L4): the API's `receivedAtomic` can lag a seller's just-broadcast transaction. A buyer who
  cancels in that moment reads "nothing needs refunding" while coins may yet land. The server's
  late-arrival refund handles the money, so this is only a wording edge. No change asked.
- Gap (T1): no unit test for `nothingHeld` itself (state `setup`; `receivedAtomic` "0" in a
  non-funding state; secured with "0"). It is exported, so a three-line table test would pin it.
- Copy note: the unfunded variant drops "and this trade closes". Design's message says "9 Nov spec
  + unfunded line". If design meant to replace only the first sentence, "This trade closes." may
  belong after the new line. Design should confirm.

### F1, owner/design question: "Already paid? Don't cancel: tap I've paid instead."

The sheet opens from two places: BuyerPay (escrow secured, where the buyer has an "I've paid"
button) and TradeFund (the buyer waiting for the seller to fund). TradeFund has no "I've paid"
control, and the buyer must not pay before the escrow is funded. On the TradeFund route the
sentence therefore points at a button that does not exist and suggests a payment that should not
have happened. This applies to the unfunded variant and also to the part-funded held variant, since
both render from TradeFund.

Recommendation: show the "Already paid?" sentence only when the sheet comes from BuyerPay. A prop
such as `canMarkPaid` or `from: 'pay' | 'fund'` would carry that, or state `secured`. On the
funding route, consider instead "Don't send any money until the escrow is funded." (COPY-UNSIGNED,
for design's wording). This changes what users read, so it is not the builder's call. It needs the
owner or design to sign it off.

## (4) Courtesy sheet over the trade room

- It cannot block the room. "Got it", Escape, a backdrop tap and a swipe on the handle all call
  `done`, which closes the sheet. The trade is already open underneath (useTake navigates as soon
  as the take is recorded), and the browser's Back no longer loses the step into the room, which
  fixes review L2.
- Accessibility: it uses the shared Sheet (role=dialog, aria-modal=true, aria-labelledby the title,
  aria-describedby the body). Focus moves into the panel on open, Tab and Shift+Tab cycle inside
  it, Escape closes, and focus returns on close. In ReadyRoom the sheet renders after the screen,
  so its mount effect runs last and keeps focus. The room's other focus mover
  (focusComposerWhenReady) runs only on `#chat`, which the take never sets, and it never takes
  focus from something the user moved it to. The checkbox has a label, and the tick row is 44 px.
- Conditions: it shows only when the room was reached from the take (`navState.confirmed`), to the
  taker (`role !== poster`), unless ticked off on this device, and once per trade per tab. The
  tests cover all six cases.
- Storage: every sessionStorage and localStorage access, including the `window.sessionStorage`
  getter itself, sits inside try/catch, with an in-memory Set as the fallback. If storage is
  blocked, a full reload of the room would show the sheet again once. That is acceptable.
- Gap (T2): the room-level tests do not press Escape or check focus. Sheet's own tests cover
  those. A sessionStorage that throws is not tested either.

## (5) parity.ts exceptions

The changes are justified, and they make the list shorter.
- Removed for BuyOffers: "0.5% above market" and "0.9% above market". Removed for SellOffers:
  "0.4% above market" and "0.3% above market". The card now matches the board's text, so these
  exceptions should go.
- BuyOffers "$0.10 above market" keeps its exception, but the reason changes to owner Q1 (no fixed
  amounts, so the card reads "0.03% above market"). That is the correct reason.
- PostOffer gains "+0.5%" (the board's signed figure) under the design call. This is justified.
- None of this was executed here (no Playwright).

## (6) Tests

The tests are meaningful: they assert the user-visible text, not the implementation.
- margin.test has the boundaries, trimming, no-sign check and the parts/words round trip.
- bands.test: the duplicated-wording assertions are gone along with the formatter.
- quoteScreen: the take goes straight to the room with the confirmed state, and a refused take
  shows neither the room nor the sheet.
- tradeRoom: six courtesy cases.
- tradeFund and buyerPay: the variants.
- staff screens: the preview is a `.x2f-post`, marked New, open, toggles, and the "Preview"
  heading is gone.
- oneDoor: the import paths.
- postOffer.test lost 15 lines along with the deleted marginText. margin.test now covers that
  ground.

Optional additions: the 9999 bps case in margin.test, T1 and T2.

## Open questions

1. F1, owner/design: drop or condition "Already paid? Don't cancel: tap I've paid instead." when
   the sheet opens from TradeFund (both the unfunded and the part-funded variants).
   Recommendation above.
2. Design: should the unfunded variant keep "This trade closes."?
3. Design (FYI): "vendor markup" remains in the browse toggle, the quote chips and the trade terms.
