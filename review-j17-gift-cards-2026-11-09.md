# Security review: J-17 gift-card rules, `wip/second-gift-cards` ed3ceecf

Reviewer: independent security reviewer (cloud helper), 9 Nov 2026. Read-only on code.
Base: wip/lead-design-results 3e70488e, plus a main merge 71e30222 (22b379e8). The branch's own work is 71e30222..ed3ceecf (38 files).
Register rows: T-055, T-056, T-057, T-081. Owner words: p5-6, G50-G53, F13 (owner-decisions-2026-11-06.md lines 41, 69, 105).

## Verdict: APPROVE WITH NOTES

I found no Critical or Major issue. Nothing on this branch lets a gift-card trade skip the escrow rules. The new checks only add refusals to the post and take paths. The escrow, release, cancel and dispute paths are untouched. There are two merge hazards for whoever lands this with launch-rules (M1, M2) and a few Minor gaps.

## What was checked

- **Rules are data, not scattered constants.** Yes, mostly:
  - The brand list is in `data/payment-methods.json`: 32 brands + Other, in the owner's order. Razer Gold and PaysafeCard are gone. Every entry has `giftCard: true`, and the loader checks that against the group.
  - The 30-day age (G51), the 45-minute check (G50), the terms version and the per-side tick boxes and evidence lists are all in one module, `packages/trade/src/giftCards.ts`. The API and the web both import it.
  - The country-to-currency table (T-081) is in the same module, ISO 4217 as of Nov 2026.
  - Every sentence is in `apps/web/src/screens/giftcard/giftCardCopy.ts`, marked COPY-UNSIGNED. `unsigned: true` is pinned by a test.
- **The 45-minute window feeds the existing profile machinery.** `MIN_GIFT_CARD_CONFIRM_WINDOW_MIN` is now `GIFT_CARD_CHECK_MIN`, so the loader's minimum and the rule are one number. The actual window still comes from the `OTHER_GIFT_CARD` profile (confirmWindowMin 45, from the base). `tradeProfile()` gives every gift card that profile. `profiles.test.ts` asserts `tradeProfile(id).confirmWindowMin === 45` for every gift-card id, and `take.test.ts` asserts `confirm_window_min = 45` on a gift-card trade. Good: a merge that drops the profile fails these tests.
- **Moderation shadow and `payWindowMin` in attested terms (launch-rules d98e2f60).** There is no direct collision:
  - This branch does not touch `AttestedTerms`, the shadow, `pay_window_min` or the internal routes.
  - The shadow (launch-rules `apps/moderation/src/shadow.ts`) uses `MAX_CONFIRM_WINDOW_MIN` for its confirm window and the attested `payWindowMin` for time to pay. A shorter real confirm window (45) therefore makes the shadow more conservative, not less safe.
  - The gift-card terms version is not in the attested terms. It does not need to be: it moves no money.
  - Migration 355 does not clash with launch-rules' 123/124/125.
  - See M1 for the one place where the two do meet.
- **Escrow cannot be skipped.**
  - `POST /v1/offers` adds the currency-follows-country and terms-version checks inside the gift-card branch only. A terms field on a non-gift offer is refused.
  - `POST /v1/trades` (take.ts) requires `giftCardTerms === GIFT_CARD_TERMS_VERSION` exactly when `isGiftCard(method)`, and requires it to be absent otherwise. The check runs after the block check (no information leak) and inside the existing transaction.
  - `insertTrade` stores the version. Migration 355 adds a set-once trigger (`trades_gift_card_terms_fixed`) and a length check.
  - No trade-machine, escrow or settle code changed.
- **Copy marked.** Yes: giftCardCopy.ts (file header and `// DESIGN: wording ... COPY-UNSIGNED`), plus the two new inline lines in offerForm.ts.
- **Video proof not built.** Correct. `GIFT_CARD_EVIDENCE` carries `seam: 'video-proof'` and `NEEDS(lead, T-054)` comments, and the UI says "Video upload is coming."

## Findings

### M1 (Minor, merge hazard with launch-rules): `OTHER_GIFT_CARD` has no `payWindowMin`
Launch-rules' `loadProfiles` makes `payWindowMin` mandatory on every profile (range `TIMERS.payMin`..`MAX_PAY_WINDOW_MIN`). Launch-rules' `data/payment-method-profiles.json`, and every land branch I checked (wip/lead-land, wip/lead-land-3, launch-rules), has no `OTHER_GIFT_CARD` profile at all. This branch's base has one, with confirmWindowMin 45 and no payWindowMin.

When the two meet, the merger has two bad options:
- Keep the profile: the API refuses to start until someone picks a payWindowMin for gift cards, which is a product number (how long the buyer has to hand over the card).
- Drop the profile: every gift card falls back to CUSTOM, a 1440-minute confirm, and G50 is silently lost. This branch's tests catch that (profiles.test.ts, take.test.ts), so do not "fix" those tests at merge.

Owner/lead question: the gift-card time to pay. Recommendation: the lead's instant default of 90 minutes, labelled as a lead default on the owner page.

### M2 (Minor, merge): `apps/api/src/methods/profiles.ts` import line
This branch and launch-rules both edit the same import and constants block. It is a textual conflict only. Keep both: `GIFT_CARD_CHECK_MIN`, plus launch-rules' `TIMERS` and pay-window constants.

### M3 (Minor): existing gift-card offers skip the new post checks
Offers posted before migration 355 have `gift_card_terms = null` and may have a currency that does not match their country. They stay live, and `PATCH /v1/offers/:id {status:'live'}` relists them without the currency check or the poster's terms. The taker still ticks their own terms on every take, so no trade starts without the taker's agreement.

Pre-launch this is probably only dev data. If any real offers exist at landing, either pause gift-card offers whose `gift_card_terms` is null in the migration, or run the same two checks on relist. This is the lead's call; the code fix is mechanical.

A related point: when `GIFT_CARD_TERMS_VERSION` is bumped (design's signed words), live offers keep the old poster version. That is acceptable (it records what they agreed to), but say so on the owner page.

### M4 (Minor): G52 range cards are not enforced, only described
Nothing records whether a card is a range card. Offers and trades have no field for it, and `giftCardValueRule` and `giftCardEvidence` are exported but unused in app code. G52 ("a range card may be partial, and that requires video proof") is therefore only a tick-box sentence for the sender plus an evidence line, and a moderator cannot tell from the record that video was required.

That is consistent with video proof being the lead's (T-054), but the T-054 work needs a "range card / partial value" fact on the trade (or the offer) for the requirement to bite. Note it on T-054.

### M5 (Minor): removed methods and old rows
RAZER_GOLD_GIFT_CARD and PAYSAFE are removed from the catalog. Any old offer or trade row naming them now gets `isAvailable` false (fine for offers), and `tradeProfile` falls back to CUSTOM, because `isGiftCard` is now false for them. Pre-launch this only matters for dev databases. PaysafeCard's removal is inferred from "the list" in p5-6, not stated by the owner: mention it on the owner page.

### M6 (Info): the ticks are client-side; the API sees only the version
This is expected. The server cannot see ticks, and the version string is an attestation of which words were shown. Fine for a record. The trade keeps the taker's version and the offer keeps the poster's, so a dispute sees both.

## Tests run (3 single files, serialised runner)
- `apps/api/test/take.test.ts`: 44/44 passed.
- `apps/api/test/offers.test.ts`: 36/36 passed.
- `apps/web/test/giftCards.test.tsx`: 7/7 passed.

Not run (capacity rule): profiles.test.ts, packages/trade giftCards.test.ts, quoteScreen and postOffer web tests, and the e2e specs.

## Owner / lead questions
1. The gift-card time to pay (payWindowMin for OTHER_GIFT_CARD) once launch-rules lands (M1). Recommend 90 minutes as a lead default.
2. Confirm PaysafeCard leaves with Razer Gold (M5).
3. T-054: the range/partial-card fact on the trade so video proof can be required (M4).
